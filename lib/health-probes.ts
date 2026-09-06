import { createClient } from "@supabase/supabase-js";

/**
 * Upstream liveness probes shared by the public /api/uptime route and the
 * dashboard "system status" card, so the UI shows what the monitors see
 * instead of a hard-coded "Operational".
 */
export type Probe = { ok: boolean; ms: number; status?: number };

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function probeMl(timeoutMs = 4000): Promise<Probe> {
  if (!ML_URL) return { ok: false, ms: 0 };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${ML_URL}/`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    return { ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

export async function probeDb(timeoutMs = 4000): Promise<Probe> {
  if (!SUPA_URL || !SUPA_ANON) return { ok: false, ms: 0 };
  const t0 = Date.now();
  try {
    const supabase = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
    // auth.getSession() never leaves the process, so it cannot detect an
    // outage. public.ping() is a real PostgREST → Postgres round-trip that
    // anon may execute (table policies call private helpers anon cannot).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const { data, error } = await supabase.rpc("ping").abortSignal(ctrl.signal);
    clearTimeout(timer);
    return { ok: !error && data === true, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

/**
 * Bucket exact latency into coarse tiers so external monitors get the
 * up/down signal without giving timing-attack reconnaissance to anonymous
 * visitors.
 */
export function bucketMs(ms: number): string {
  if (ms < 50) return "<50ms";
  if (ms < 100) return "<100ms";
  if (ms < 250) return "<250ms";
  if (ms < 500) return "<500ms";
  if (ms < 1000) return "<1s";
  if (ms < 2000) return "<2s";
  return ">=2s";
}
