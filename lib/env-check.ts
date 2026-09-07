/**
 * Production secret presence check.
 *
 * Pure module — no `next/*` imports — so it can run from
 * `instrumentation.ts` (boot), API routes, server components and Jest.
 *
 * Why: `lib/auth/hmac-secret.ts` is fail-closed in production. When a
 * signing secret is unset the cookie helpers throw at request time, which
 * (before this check) surfaced as an unstyled crash page on /login for
 * TOTP users and a 500 on step-up. This module lets boot, `/api/health/auth`
 * and `/health` say *which* secret is missing — loudly and by NAME only.
 *
 * Only names ever leave this module. Values are never read into results,
 * logged, or included in error text.
 */

export interface ProductionSecret {
  /** Environment variable name. */
  name: string;
  /** What breaks without it (human-readable, safe to display to admins). */
  purpose: string;
}

export const PRODUCTION_SECRETS: readonly ProductionSecret[] = [
  {
    name: "REAUTH_COOKIE_SECRET",
    purpose: "pre-TOTP + step-up cookies; TOTP users cannot sign in without it",
  },
  { name: "SESSION_PIN_SECRET", purpose: "session pin cookie" },
  { name: "STREAM_TICKET_SECRET", purpose: "HLS stream tickets" },
  { name: "CAMERA_URL_KEY", purpose: "RTSP URL encryption at rest" },
  { name: "ML_SERVICE_TOKEN", purpose: "bearer token for the ML service" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", purpose: "server-side Supabase service role" },
  { name: "CRON_SECRET", purpose: "Vercel Cron bearer token" },
];

type Env = Record<string, string | undefined>;

/**
 * Mirrors `isProd()` in lib/auth/hmac-secret.ts — the same predicate that
 * decides whether the cookie helpers fail closed.
 */
export function isProductionRuntime(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

/**
 * Names of production secrets that are unset, empty, or whitespace-only.
 * Returns `[]` when everything is configured.
 */
export function missingProductionSecrets(env: Env = process.env): string[] {
  return PRODUCTION_SECRETS.filter((s) => !(env[s.name] ?? "").trim()).map((s) => s.name);
}
