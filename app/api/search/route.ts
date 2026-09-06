import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { createServiceClient } from "@/lib/supabase/server";
import { vectorParam } from "@/lib/pgvector";

interface MatchRow {
  id: string;
  filename: string;
  image_path: string;
  detected_at: string;
  similarity: number;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const fd = await request.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const embedding = await mlEmbed(buffer);

  const svc = createServiceClient();
  const { data: rows, error } = await svc.rpc("match_faces", {
    query_embedding: vectorParam(embedding),
    match_threshold: 0.5,
    match_limit: 50,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const matches = (rows ?? []) as MatchRow[];
  if (matches.length === 0) return NextResponse.json({ matches: [] });

  const ids = matches.map((m) => m.id);

  // ADR 0009 / Tier 2: client-ийн <FaceThumb faceId> нь crop-уудыг өөрөө
  // unified endpoint-аас унших тул signed URL бэлдэхгүй. Зөвхөн metadata-г
  // буцаана (camera/recording badge).
  const { data: metaRows, error: metaErr } = await svc
    .from("faces")
    .select("id, recording_id, camera_id, bbox, crop_sealed, recordings:recordings(filename), cameras:cameras(name)")
    .in("id", ids);

  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 });

  const metaById = new Map<string, {
    recording_filename: string | null;
    camera_name: string | null;
    bbox: unknown;
    crop_sealed: boolean;
  }>();
  for (const row of metaRows ?? []) {
    const r = row as {
      id: string;
      bbox: unknown;
      crop_sealed: boolean;
      recordings: { filename: string } | { filename: string }[] | null;
      cameras: { name: string } | { name: string }[] | null;
    };
    const rec = Array.isArray(r.recordings) ? r.recordings[0] : r.recordings;
    const cam = Array.isArray(r.cameras) ? r.cameras[0] : r.cameras;
    metaById.set(r.id, {
      recording_filename: rec?.filename ?? null,
      camera_name: cam?.name ?? null,
      bbox: r.bbox,
      crop_sealed: Boolean(r.crop_sealed),
    });
  }

  const enriched = matches.map((m) => {
    const meta = metaById.get(m.id);
    return {
      ...m,
      recording_filename: meta?.recording_filename ?? null,
      camera_name: meta?.camera_name ?? null,
      bbox: meta?.bbox ?? null,
      crop_sealed: meta?.crop_sealed ?? false,
    };
  });

  return NextResponse.json({ matches: enriched });
}
