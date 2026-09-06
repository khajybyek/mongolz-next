import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";

/**
 * Single source of truth for Vercel-Cron / monitoring authorisation.
 *
 *   • Header: `Authorization: Bearer <CRON_SECRET>` (Vercel injects this
 *     automatically when a cron is configured via vercel.json).
 *   • timingSafeEqual instead of `===` — leaks no info via response time
 *     even if a token guess happens to share a prefix with the real one.
 *   • Either `CRON_SECRET` or `MONITORING_CRON_SECRET` is accepted (the
 *     monitoring/error-rate endpoint historically used its own secret) —
 *     both are compared, not just the first one that happens to be set.
 *   • Fail-closed in production: if NEITHER secret is set, refuse every
 *     request regardless of the supplied header.
 *
 * Returns true iff the caller is authorised. Callers respond 401 on false.
 */
export function authorizeCron(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.MONITORING_CRON_SECRET]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);

  if (secrets.length === 0) {
    return (
      process.env.VERCEL_ENV !== "production" &&
      process.env.NODE_ENV !== "production"
    );
  }

  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got, "utf8");

  return secrets.some((secret) => {
    const b = Buffer.from(secret, "utf8");
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
