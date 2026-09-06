import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isPushConfigured, sendPushToAllAdmins } from "@/lib/push";
import { authorizeCron } from "@/lib/auth/cron";
import { flag } from "@/lib/flags";

/**
 * Anomaly sweep — runs once a day via Vercel Cron (Hobby tier limit).
 * Scans the past 24h for buckets with |z| >= ANOMALY_THRESHOLD (default 3)
 * and emits a single alert per (camera, hour-bucket) thanks to the dedup
 * helper. Upgrade to Pro to switch the cron to hourly if needed.
 */

const Z_THRESHOLD = Number(process.env.ANOMALY_THRESHOLD ?? "3");

type AnomalyRow = {
  camera_id: string;
  camera_name: string | null;
  bucket_start: string;
  observed: number;
  baseline_median: number;
  baseline_mad: number;
  z_score: number;
};

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!flag("anomaly_cron")) {
    return NextResponse.json({ status: "skipped", reason: "MONGOLZ_FF_ANOMALY_CRON is off" });
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("camera_anomaly_scores", {
    p_window_hours: 24,
    p_baseline_days: 28,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as AnomalyRow[]).map((r) => ({
    ...r,
    observed: Number(r.observed),
  }));
  const triggered = rows.filter((r) => Math.abs(r.z_score) >= Z_THRESHOLD);

  const inserted: { camera_id: string; alert_id: string; z: number }[] = [];
  const failed: { camera_id: string; error: string }[] = [];
  for (const r of triggered) {
    const { data: idResp, error: insErr } = await svc.rpc("insert_anomaly_alert", {
      p_camera_id: r.camera_id,
      p_camera_name: r.camera_name ?? "—",
      p_bucket_start: r.bucket_start,
      p_z: r.z_score,
      p_observed: r.observed,
      p_baseline: r.baseline_median,
    });
    if (insErr) {
      console.error("[anomaly-sweep] insert_anomaly_alert failed:", insErr.message);
      failed.push({ camera_id: r.camera_id, error: insErr.message });
      continue;
    }
    if (idResp) {
      inserted.push({ camera_id: r.camera_id, alert_id: idResp as string, z: r.z_score });
    }
  }

  // Push notification fan-out — only if we just-inserted (not for dedup
  // skips), so admins aren't woken twice for the same anomaly bucket.
  let pushSummary: { delivered: number; failed: number; gone: number } | null = null;
  if (inserted.length > 0 && isPushConfigured()) {
    const worst = triggered.reduce((a, b) => (Math.abs(b.z_score) > Math.abs(a.z_score) ? b : a));
    pushSummary = await sendPushToAllAdmins({
      title: `Anomaly · ${worst.camera_name ?? "Camera"}`,
      body: `z=${worst.z_score.toFixed(2)} · observed ${worst.observed} vs baseline ${worst.baseline_median.toFixed(1)}`,
      url: "/anomaly",
      tag: "mongolz-anomaly",
    });
  }

  return NextResponse.json({
    status: "ok",
    scanned: rows.length,
    triggered: triggered.length,
    inserted: inserted.length,
    threshold: Z_THRESHOLD,
    push: pushSummary,
  });
}
