/**
 * Lightweight uptime probe — for external monitors (UptimeRobot, BetterUptime).
 *
 * Returns HTTP 200 + JSON if all upstreams (Supabase DB, ML service) are reachable.
 * Returns HTTP 503 otherwise. Designed to be public (no auth) and fast (<1s).
 */
import { NextResponse } from "next/server";
import { bucketMs, probeDb, probeMl } from "@/lib/health-probes";

export async function GET() {
  const [ml, db] = await Promise.all([probeMl(), probeDb()]);
  const all_ok = ml.ok && db.ok;

  return NextResponse.json(
    {
      status: all_ok ? "ok" : "degraded",
      ts: new Date().toISOString(),
      checks: {
        ml: { ok: ml.ok, latency: bucketMs(ml.ms) },
        db: { ok: db.ok, latency: bucketMs(db.ms) },
      },
    },
    {
      status: all_ok ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
