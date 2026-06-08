/**
 * Pick the HMAC signing secret for cookie-based helpers
 * (step-up reauth, session-pin, pre-TOTP, …).
 *
 *   • In production, ONLY the dedicated primary secret is honoured. If it
 *     isn't set, this returns `null` — callers then refuse to sign or
 *     verify (fail-closed), forcing the operator to set the right env
 *     var instead of silently degrading to `SUPABASE_SERVICE_ROLE_KEY`.
 *     Sharing a key across the service-role boundary and cookie signing
 *     is a weak default that the previous fallback chain encoded.
 *
 *   • In development (`VERCEL_ENV != "production"` AND
 *     `NODE_ENV != "production"`), the historic fallback chain is kept
 *     so local dev stays one-step-setup. Listed fallbacks are tried in
 *     order until a non-empty value is found.
 *
 * Returns the chosen secret, or `null` when nothing usable was found.
 */
function isProd(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

export function pickHmacSecret(
  primary: string,
  ...devFallbacks: string[]
): string | null {
  const direct = (process.env[primary] ?? "").trim();
  if (direct) return direct;
  if (isProd()) return null;
  for (const k of devFallbacks) {
    const v = (process.env[k] ?? "").trim();
    if (v) return v;
  }
  return null;
}
