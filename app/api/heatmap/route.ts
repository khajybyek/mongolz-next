import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/paged-fetch";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const cameraId = searchParams.get("camera_id") ?? "";
  if (!UUID_RE.test(cameraId)) {
    return NextResponse.json({ error: "invalid camera_id" }, { status: 400 });
  }
  const hours = clampInt(parseInt(searchParams.get("hours") ?? "24", 10), 1, 168);
  const limit = clampInt(parseInt(searchParams.get("limit") ?? "5000", 10), 1, 10000);

  const supabase = await createClient();
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  // `limit` goes up to 10000 but PostgREST returns at most max_rows (1000)
  // per request, so a single `.limit(limit)` silently sampled only the newest
  // 1000 detections. Page up to the requested sample size instead.
  const { rows: data, truncated, error } = await fetchAllPaged(
    (from, to) =>
      supabase
        .from("faces")
        .select("id, bbox, detected_at")
        .eq("camera_id", cameraId)
        .gte("detected_at", since)
        .not("bbox", "is", null)
        .order("detected_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    limit,
  );

  if (error) return NextResponse.json({ error }, { status: 500 });

  const rows = data as unknown as Array<{ id: string; bbox: { x: number; y: number; w: number; h: number } | null; detected_at: string }>;

  const points: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const r of rows) {
    const b = r.bbox;
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.w) || !Number.isFinite(b.h)) continue;
    // Clip & accept only normalized [0,1] bboxes
    if (b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 1.2 || b.y + b.h > 1.2) continue;
    points.push({ x: b.x, y: b.y, w: b.w, h: b.h });
  }

  // 32x18 grid (16:9 aspect) — counts per cell using bbox center
  const GW = 32, GH = 18;
  const grid: number[] = new Array(GW * GH).fill(0);
  for (const p of points) {
    const cx = Math.min(0.999, Math.max(0, p.x + p.w / 2));
    const cy = Math.min(0.999, Math.max(0, p.y + p.h / 2));
    const gx = Math.floor(cx * GW);
    const gy = Math.floor(cy * GH);
    grid[gy * GW + gx]++;
  }
  const maxCount = grid.reduce((a, b) => (b > a ? b : a), 0);

  return NextResponse.json({
    cameraId,
    hours,
    samples: points.length,
    /** More detections matched than `limit`; the grid covers the newest `limit`. */
    truncated,
    grid: { w: GW, h: GH, cells: grid, max: maxCount },
    points,
  });
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(v)));
}
