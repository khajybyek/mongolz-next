/**
 * Pre-TOTP session cookie.
 *
 * After step 1 (password verified) on the login flow, we still need to
 * collect a TOTP code before granting access. Rather than re-prompting for
 * password on step 2, we issue a short-lived HMAC-signed cookie that carries
 * the user_id. The Supabase auth session is signed out between steps so this
 * cookie is the only thing tying the two requests together.
 *
 * **Design tradeoffs:**
 *   - 2-minute TTL — TOTP codes refresh every 30s anyway; 2 min is plenty.
 *   - Single-use — cleared on successful verification.
 *   - HMAC-signed so the client can't forge the user_id.
 *   - No PII in the cookie (just opaque uuid).
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "mongolz-pre-totp";
const TTL_SECONDS = 120;
const SEP = "|";

function signingSecret(): string | null {
  return process.env.REAUTH_COOKIE_SECRET
    ?? process.env.SESSION_PIN_SECRET
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? null;
}

function sign(payload: string): string {
  const secret = signingSecret();
  if (!secret) throw new Error("REAUTH_COOKIE_SECRET not set");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Issue a pre-TOTP cookie for `userId`. Returns nothing — sets cookie via Next response. */
export async function setPreTotpCookie(userId: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${userId}${SEP}${expiresAt}`;
  const sig = sign(payload);
  const value = `${payload}${SEP}${sig}`;

  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export type PreTotpResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "no-cookie" | "bad-signature" | "expired" | "no-secret" };

/** Read + verify the cookie. Does NOT clear it — caller decides when. */
export async function readPreTotpCookie(): Promise<PreTotpResult> {
  if (!signingSecret()) return { ok: false, reason: "no-secret" };
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return { ok: false, reason: "no-cookie" };

  const parts = raw.split(SEP);
  if (parts.length !== 3) return { ok: false, reason: "bad-signature" };
  const [userId, expStr, sig] = parts as [string, string, string];

  const expectedSig = sign(`${userId}${SEP}${expStr}`);
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expectedSig, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > Number(expStr)) return { ok: false, reason: "expired" };

  return { ok: true, userId };
}

/** Clear the cookie (after successful TOTP verify or login abort). */
export async function clearPreTotpCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
