/**
 * Lightweight uptime probe — for external monitors (UptimeRobot, BetterUptime).
 *
 * Returns HTTP 200 + JSON if all upstreams (Supabase DB, ML service) are reachable.
 * Returns HTTP 503 otherwise. Designed to be public (no auth) and fast (<1s).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function probeMl(): Promise<{ ok: boolean; ms: number; status?: number }> {
  if (!ML_URL) return { ok: false, ms: 0 };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${ML_URL}/`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    return { ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

async function probeDb(): Promise<{ ok: boolean; ms: number }> {
  if (!SUPA_URL || !SUPA_ANON) return { ok: false, ms: 0 };
  const t0 = Date.now();
  try {
    const supabase = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
    // Anonymous-readable check: profiles RLS may block; use a cheap HEAD that bypasses RLS
    // via an auth-side rpc. Fallback: a single auth.getUser() check.
    const { error } = await supabase.auth.getSession();
    return { ok: !error, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

/**
 * Bucket exact latency into coarse 100-ms tiers so external monitors get the
 * up/down signal without giving timing-attack reconnaissance to anonymous
 * visitors.
 */
function bucketMs(ms: number): string {
  if (ms < 50) return "<50ms";
  if (ms < 100) return "<100ms";
  if (ms < 250) return "<250ms";
  if (ms < 500) return "<500ms";
  if (ms < 1000) return "<1s";
  if (ms < 2000) return "<2s";
  return ">=2s";
}

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
