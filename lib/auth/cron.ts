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
 *     monitoring/error-rate endpoint historically used its own secret).
 *   • Fail-closed in production: if NEITHER secret is set, refuse every
 *     request (`return false`) regardless of the supplied header. This
 *     used to silently allow non-prod traffic — fine for dev, terrifying
 *     for prod if an env-var unset shipped accidentally.
 *
 * Returns true iff the caller is authorised. Callers respond 401 on false.
 */
export function authorizeCron(req: NextRequest): boolean {
  const secret =
    process.env.CRON_SECRET ?? process.env.MONITORING_CRON_SECRET ?? null;

  if (!secret) {
    return (
      process.env.VERCEL_ENV !== "production" &&
      process.env.NODE_ENV !== "production"
    );
  }

  const got = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    ?? "";

  // Equal-length buffers before timingSafeEqual — Node throws otherwise.
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
