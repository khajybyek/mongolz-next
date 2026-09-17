import { cookies } from "next/headers";
import { pickHmacSecret } from "@/lib/auth/hmac-secret";
import { hmacEqual, hmacSign, isExpired } from "@/lib/auth/hmac";

const COOKIE = "mongolz-reauth";
const SEP = "|";
/**
 * Which factor minted the step-up. The cookie used to be factor-agnostic, so
 * a password step-up (POST /api/auth/reauth) satisfied gates that are
 * documented as "needs the second factor" — TOTP disable, passkey enrolment,
 * user management. A stolen session plus a phished password was enough to
 * replace the victim's 2FA without ever presenting it. The factor is bound
 * into the HMAC purpose, so a password cookie cannot be re-labelled.
 */
export type ReauthFactor = "totp" | "password";

const PURPOSES: Record<ReauthFactor, string> = {
  // Unchanged purpose: cookies minted by the TOTP route before this change
  // stay valid for their remaining minutes.
  totp: "mongolz-reauth:v2",
  password: "mongolz-reauth-password:v1",
};

export type ReauthOptions = {
  /**
   * Accept a password-minted step-up as well. Only the reveal request flow
   * opts in (it still needs a second admin, who must present TOTP). Every
   * other gate requires the second factor itself.
   */
  allowPassword?: boolean;
};

function signingSecret(): string | null {
  // Fail-closed in production: REAUTH_COOKIE_SECRET must be set explicitly.
  // SERVICE_ROLE_KEY fallback retained for local dev only.
  return pickHmacSecret("REAUTH_COOKIE_SECRET", "SUPABASE_SERVICE_ROLE_KEY");
}

function sign(userId: string, expiresAt: string, factor: ReauthFactor): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return hmacSign(secret, PURPOSES[factor], `${userId}${SEP}${expiresAt}`, "hex");
}

/**
 * `factor` defaults to the WEAKER one on purpose: a future caller that
 * forgets the argument gets a cookie that opens less, not more.
 */
export function buildReauthCookieValue(
  userId: string,
  expiresAt: Date,
  factor: ReauthFactor = "password",
): string {
  const expires = expiresAt.toISOString();
  const signature = sign(userId, expires, factor);
  if (!signature) {
    throw new Error("REAUTH_SIGNING_SECRET_MISSING");
  }
  return [userId, expires, signature].join(SEP);
}

export function verifyReauthCookie(
  value: string | undefined,
  userId: string,
): { expiresAt: string; factor: ReauthFactor } | null {
  if (!value) return null;
  const [cookieUserId, expiresAt, signature, extra] = value.split(SEP);
  if (!cookieUserId || !expiresAt || !signature || extra || cookieUserId !== userId) {
    return null;
  }

  let factor: ReauthFactor | null = null;
  for (const candidate of ["totp", "password"] as const) {
    const expected = sign(cookieUserId, expiresAt, candidate);
    if (expected && hmacEqual(expected, signature, "hex")) {
      factor = candidate;
      break;
    }
  }
  if (!factor) return null;
  // NaN-safe: a non-ISO expiry (e.g. epoch seconds smuggled from another
  // cookie format) must fail, not pass as "never expires".
  if (isExpired(expiresAt)) return null;
  return { expiresAt, factor };
}

/** Any-factor check, kept for callers that only need the expiry. */
export function verifyReauthCookieValue(value: string | undefined, userId: string): string | null {
  return verifyReauthCookie(value, userId)?.expiresAt ?? null;
}

/**
 * Reveal болон бусад мэдрэмтгий үйлдлүүдийн өмнө хэрэглэгч сүүлийн 15 минут
 * дотор нууц үг / TOTP-ээ дахин баталгаажуулсан эсэхийг шалгана. Cookie нь
 * user id болон expiry timestamp-аа HMAC signature-тай хадгалдаг тул гараар
 * сунгаж бичих боломжгүй.
 */
export async function getFreshReauth(
  userId: string,
): Promise<{ expiresAt: string; factor: ReauthFactor } | null> {
  const c = await cookies();
  return verifyReauthCookie(c.get(COOKIE)?.value, userId);
}

/** Default: the second factor itself. `allowPassword` is the reveal-request opt-in. */
export async function hasFreshReauth(userId: string, opts: ReauthOptions = {}): Promise<boolean> {
  const fresh = await getFreshReauth(userId);
  if (!fresh) return false;
  return fresh.factor === "totp" || opts.allowPassword === true;
}

export async function requireFreshReauth(userId: string, opts: ReauthOptions = {}): Promise<true> {
  if (!(await hasFreshReauth(userId, opts))) {
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
  opts: ReauthOptions = {},
): Promise<{ error: "REAUTH_REQUIRED" } | null> {
  if (await hasFreshReauth(userId, opts)) return null;
  return { error: "REAUTH_REQUIRED" };
}
