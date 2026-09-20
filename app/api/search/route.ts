import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { createClient } from "@/lib/supabase/server";
import { vectorParam } from "@/lib/pgvector";
import { recordAccess, READ_ACTIONS } from "@/lib/audit";
import { paginateSearchResults, parseSearchFilters } from "@/lib/search-filters";
import type { FilteredFaceSearchResult } from "@/lib/database.types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const fd = await request.formData();
  const file = fd.get("file");
  const filters = parseSearchFilters({
    cameraId: fd.get("camera_id"), from: fd.get("from"), to: fd.get("to"),
    threshold: fd.get("threshold"), limit: fd.get("limit"), offset: fd.get("offset"),
    recordingStatus: fd.get("recording_status"), minConfidence: fd.get("min_confidence"),
    suspectId: fd.get("suspect_id"), incidentId: fd.get("incident_id"),
  });
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }
  if (!filters) return NextResponse.json({ error: "invalid_filters" }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const embedding = await mlEmbed(buffer);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_faces_advanced_page", {
      query_embedding: vectorParam(embedding),
      match_threshold: filters.threshold,
      p_limit: filters.limit + 1,
      p_offset: filters.offset,
      p_camera_id: filters.cameraId ?? undefined,
      p_from: filters.from ?? undefined,
      p_to: filters.to ?? undefined,
      p_recording_status: filters.recordingStatus ?? undefined,
      p_min_confidence: filters.minConfidence ?? undefined,
      p_suspect_id: filters.suspectId ?? undefined,
      p_incident_id: filters.incidentId ?? undefined,
    });
    if (error) return NextResponse.json({ error: "search_unavailable" }, { status: 503 });

    const page = paginateSearchResults((data ?? []) as FilteredFaceSearchResult[], filters.limit, filters.offset);
    await recordAccess({
      action: READ_ACTIONS.FACE_SEARCH,
      detail: `1:N face search · threshold=${filters.threshold} · limit=${filters.limit} · offset=${filters.offset} · camera=${filters.cameraId ?? "all"} · recording=${filters.recordingStatus ?? "all"} · confidence=${filters.minConfidence ?? "any"} · suspect=${filters.suspectId ?? "all"} · incident=${filters.incidentId ?? "all"} · from=${filters.from ?? "any"} · to=${filters.to ?? "any"} · matches=${page.matches.length}${
        page.matches[0] ? ` · top=${page.matches[0].id} (${Number(page.matches[0].similarity).toFixed(3)})` : ""
      }`,
      userId: auth.user.id,
      userEmail: auth.user.email,
      request,
    });

    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "search_unavailable" }, { status: 503 });
  }
}
