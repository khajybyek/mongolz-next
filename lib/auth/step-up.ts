import { cookies } from "next/headers";
import { pickHmacSecret } from "@/lib/auth/hmac-secret";
import { hmacEqual, hmacSign, isExpired } from "@/lib/auth/hmac";

const COOKIE = "mongolz-reauth";
const SEP = "|";
const PURPOSE = "mongolz-reauth:v2";

function signingSecret(): string | null {
  // Fail-closed in production: REAUTH_COOKIE_SECRET must be set explicitly.
  // SERVICE_ROLE_KEY fallback retained for local dev only.
  return pickHmacSecret("REAUTH_COOKIE_SECRET", "SUPABASE_SERVICE_ROLE_KEY");
}

function sign(userId: string, expiresAt: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return hmacSign(secret, PURPOSE, `${userId}${SEP}${expiresAt}`, "hex");
}

export function buildReauthCookieValue(userId: string, expiresAt: Date): string {
  const expires = expiresAt.toISOString();
  const signature = sign(userId, expires);
  if (!signature) {
    throw new Error("REAUTH_SIGNING_SECRET_MISSING");
  }
  return [userId, expires, signature].join(SEP);
}

export function verifyReauthCookieValue(value: string | undefined, userId: string): string | null {
  if (!value) return null;
  const [cookieUserId, expiresAt, signature, extra] = value.split(SEP);
  if (!cookieUserId || !expiresAt || !signature || extra || cookieUserId !== userId) {
    return null;
  }

  const expected = sign(cookieUserId, expiresAt);
  if (!expected || !hmacEqual(expected, signature, "hex")) return null;
  // NaN-safe: a non-ISO expiry (e.g. epoch seconds smuggled from another
  // cookie format) must fail, not pass as "never expires".
  if (isExpired(expiresAt)) return null;
  return expiresAt;
}

/**
 * Reveal болон бусад мэдрэмтгий үйлдлүүдийн өмнө хэрэглэгч сүүлийн 15 минут
 * дотор нууц үг / TOTP-ээ дахин баталгаажуулсан эсэхийг шалгана. Cookie нь
 * user id болон expiry timestamp-аа HMAC signature-тай хадгалдаг тул гараар
 * сунгаж бичих боломжгүй.
 */
export async function getFreshReauth(userId: string): Promise<{ expiresAt: string } | null> {
  const c = await cookies();
  const expiresAt = verifyReauthCookieValue(c.get(COOKIE)?.value, userId);
  return expiresAt ? { expiresAt } : null;
}

export async function hasFreshReauth(userId: string): Promise<boolean> {
  return Boolean(await getFreshReauth(userId));
}

export async function requireFreshReauth(userId: string): Promise<true> {
  if (!(await hasFreshReauth(userId))) {
    throw new Error("REAUTH_REQUIRED");
  }
  return true;
}

/**
 * Non-throwing variant for use in Server Actions. Returns either
 * `null` (reauth fresh, continue) or `{ error: "REAUTH_REQUIRED" }`
 * which clients detect to open the TOTP prompt.
 */
export async function ensureFreshReauth(
  userId: string,
): Promise<{ error: "REAUTH_REQUIRED" } | null> {
  if (await hasFreshReauth(userId)) return null;
  return { error: "REAUTH_REQUIRED" };
}
