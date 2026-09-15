import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { createClient } from "@/lib/supabase/server";
import { vectorParam } from "@/lib/pgvector";
import { recordAccess, READ_ACTIONS } from "@/lib/audit";
import { parseSearchFilters } from "@/lib/search-filters";
import type { FilteredFaceSearchResult } from "@/lib/database.types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const fd = await request.formData();
  const file = fd.get("file");
  const filters = parseSearchFilters({
    cameraId: fd.get("camera_id"), from: fd.get("from"), to: fd.get("to"),
    threshold: fd.get("threshold"), limit: fd.get("limit"),
  });
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }
  if (!filters) return NextResponse.json({ error: "invalid_filters" }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const embedding = await mlEmbed(buffer);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_faces_filtered", {
      query_embedding: vectorParam(embedding),
      match_threshold: filters.threshold,
      match_limit: filters.limit,
      p_camera_id: filters.cameraId ?? undefined,
      p_from: filters.from ?? undefined,
      p_to: filters.to ?? undefined,
    });
    if (error) return NextResponse.json({ error: "search_unavailable" }, { status: 503 });

    const matches = (data ?? []) as FilteredFaceSearchResult[];
    await recordAccess({
      action: READ_ACTIONS.FACE_SEARCH,
      detail: `1:N face search · threshold=${filters.threshold} · limit=${filters.limit} · camera=${filters.cameraId ?? "all"} · from=${filters.from ?? "any"} · to=${filters.to ?? "any"} · matches=${matches.length}${
        matches[0] ? ` · top=${matches[0].id} (${Number(matches[0].similarity).toFixed(3)})` : ""
      }`,
      userId: auth.user.id,
      userEmail: auth.user.email,
      request,
    });

    return NextResponse.json({ matches });
  } catch {
    return NextResponse.json({ error: "search_unavailable" }, { status: 503 });
  }
}
