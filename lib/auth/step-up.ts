import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pickHmacSecret } from "@/lib/auth/hmac-secret";

const COOKIE = "mongolz-reauth";
const SEP = "|";

function signingSecret(): string | null {
  // Fail-closed in production: REAUTH_COOKIE_SECRET must be set explicitly.
  // SERVICE_ROLE_KEY fallback retained for local dev only.
  return pickHmacSecret("REAUTH_COOKIE_SECRET", "SUPABASE_SERVICE_ROLE_KEY");
}

function sign(userId: string, expiresAt: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${userId}${SEP}${expiresAt}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
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
  if (!expected || !safeEqual(expected, signature)) return null;
  if (new Date(expiresAt).getTime() <= Date.now()) return null;
  return expiresAt;
}

/**
 * Reveal болон бусад мэдрэмтгий үйлдлүүдийн өмнө хэрэглэгч сүүлийн 15 минут
 * дотор нууц үгээ дахин баталгаажуулсан эсэхийг шалгана. Cookie нь user id
 * болон expiry timestamp-аа HMAC signature-тай хадгалдаг тул гараар сунгаж
 * бичих боломжгүй.
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
