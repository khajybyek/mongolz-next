import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const faceId = searchParams.get("face_id") ?? "";
  if (!UUID_RE.test(faceId)) {
    return NextResponse.json({ error: "invalid face_id" }, { status: 400 });
  }

  const threshold = clamp(parseFloat(searchParams.get("threshold") ?? "0.45"), 0.2, 0.95);
  const windowHours = clampInt(parseInt(searchParams.get("window_hours") ?? "24", 10), 1, 720);
  const maxResults = clampInt(parseInt(searchParams.get("max_results") ?? "200", 10), 1, 500);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("camera_trail", {
    p_face_id: faceId,
    p_threshold: threshold,
    p_window_hours: windowHours,
    p_max_results: maxResults,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    face_id: string;
    camera_id: string | null;
    camera_name: string | null;
    detected_at: string;
    similarity: number;
    bbox: unknown;
    recording_id: string | null;
  }>;

  // ADR 0009 / Tier 2: crop thumbnail-уудыг хариунд орохгүй — UI <FaceThumb
  // faceId> ашиглан unified endpoint-аас унш.
  return NextResponse.json({
    threshold,
    windowHours,
    count: rows.length,
    trail: rows.map((r) => ({
      face_id: r.face_id,
      camera_id: r.camera_id,
      camera_name: r.camera_name ?? "—",
      detected_at: r.detected_at,
      similarity: Number(r.similarity.toFixed(4)),
      recording_id: r.recording_id,
    })),
  });
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(v)));
}
