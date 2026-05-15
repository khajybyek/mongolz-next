import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { mlEmbed } from "@/lib/ml-client";
import { createServiceClient } from "@/lib/supabase/server";

interface MatchRow {
  id: string;
  filename: string;
  image_path: string;
  detected_at: string;
  similarity: number;
}

const SIGNED_URL_TTL_SEC = 600;

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
    query_embedding: embedding,
    match_threshold: 0.5,
    match_limit: 50,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const matches = (rows ?? []) as MatchRow[];
  if (matches.length === 0) return NextResponse.json({ matches: [] });

  const ids = matches.map((m) => m.id);
  const paths = matches.map((m) => m.image_path);

  const [metaRes, signedRes] = await Promise.all([
    svc
      .from("faces")
      .select("id, recording_id, camera_id, bbox, recordings:recordings(filename), cameras:cameras(name)")
      .in("id", ids),
    svc.storage.from("faces").createSignedUrls(paths, SIGNED_URL_TTL_SEC),
  ]);

  const metaById = new Map<string, {
    recording_filename: string | null;
    camera_name: string | null;
    bbox: unknown;
  }>();
  for (const row of metaRes.data ?? []) {
    const r = row as {
      id: string;
      bbox: unknown;
      recordings: { filename: string } | { filename: string }[] | null;
      cameras: { name: string } | { name: string }[] | null;
    };
    const rec = Array.isArray(r.recordings) ? r.recordings[0] : r.recordings;
    const cam = Array.isArray(r.cameras) ? r.cameras[0] : r.cameras;
    metaById.set(r.id, {
      recording_filename: rec?.filename ?? null,
      camera_name: cam?.name ?? null,
      bbox: r.bbox,
    });
  }

  const urlByPath = new Map<string, string>();
  for (const item of signedRes.data ?? []) {
    if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
  }

  const enriched = matches.map((m) => {
    const meta = metaById.get(m.id);
    return {
      ...m,
      image_url: urlByPath.get(m.image_path) ?? null,
      recording_filename: meta?.recording_filename ?? null,
      camera_name: meta?.camera_name ?? null,
      bbox: meta?.bbox ?? null,
    };
  });

  return NextResponse.json({ matches: enriched });
}
