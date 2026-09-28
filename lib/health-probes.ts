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

/**
 * The ML capability the web needs before it presents privacy schedules as
 * enforced (ml-service/main.py PRIVACY_SCHEDULES_CAPABILITY). The web
 * auto-deploys on push; the ML service is deployed by hand, and an older
 * build ignores schedules completely.
 */
export const REQUIRED_PRIVACY_SCHEDULES_CAPABILITY = 1;

export type PrivacyEnforcement = "enforced" | "not_enforced" | "unreachable";

/** Classify the ML `GET /` body (pure — unit-tested). */
export function privacyEnforcementFromHealth(body: unknown): Exclude<PrivacyEnforcement, "unreachable"> {
  if (body && typeof body === "object") {
    const flag = (body as { privacy_schedules?: unknown }).privacy_schedules;
    if (typeof flag === "number" && Number.isFinite(flag) && flag >= REQUIRED_PRIVACY_SCHEDULES_CAPABILITY) {
      return "enforced";
    }
  }
  return "not_enforced";
}

/**
 * Does the running ML build enforce privacy schedules? "unreachable" when it
 * does not answer (recognition is not running then either), "not_enforced"
 * when it answers without the capability (an older build / rollback).
 */
export async function probeMlPrivacyEnforcement(timeoutMs = 3000): Promise<PrivacyEnforcement> {
  if (!ML_URL) return "unreachable";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${ML_URL}/`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return "unreachable";
    return privacyEnforcementFromHealth(await res.json().catch(() => null));
  } catch {
    return "unreachable";
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
