/**
 * Session pinning — bind a Supabase session to the User-Agent + IP it was
 * created with. If a stolen cookie is replayed from a different network or
 * browser, the pin mismatch invalidates the session (force re-login).
 *
 * The pin cookie is only ever minted by our own login flows (password+TOTP,
 * passkey), so for users with TOTP enabled it doubles as proof that the
 * session went through the second factor: a Supabase session obtained
 * straight from the password grant has no pin and is rejected by
 * lib/supabase/auth.ts (see `pinVerdict` there).
 *
 * **Design tradeoffs:**
 *   - IP can change legitimately (mobile WiFi → cellular). We hash the /16 of
 *     IPv4 and /48 of IPv6 instead of the full address, which catches network
 *     hops while tolerating normal carrier changes.
 *   - User-Agent is hashed in full; minor browser updates won't change it.
 *   - Cookie is HMAC-signed (purpose-tagged) so the client can't tamper.
 *   - 7-day TTL.
 *   - Kill switch: MONGOLZ_FF_SESSION_PIN=0 (lib/flags.ts) disables enforcement.
 */

import { cookies, headers } from "next/headers";
import { isIPv4, isIPv6 } from "node:net";
import { pickHmacSecret } from "@/lib/auth/hmac-secret";
import { hmacEqual, hmacSign, isExpired } from "@/lib/auth/hmac";

const COOKIE_NAME = "mongolz-session-pin";
const TTL_DAYS = 7;
const SEP = "|";
const PURPOSE_FP = "mongolz-session-pin-fp:v2";
const PURPOSE_SIG = "mongolz-session-pin:v2";

function signingSecret(): string | null {
  // Fail-closed in production: SESSION_PIN_SECRET must be set explicitly.
  // REAUTH_COOKIE_SECRET / SERVICE_ROLE_KEY fallback retained for dev only.
  return pickHmacSecret(
    "SESSION_PIN_SECRET",
    "REAUTH_COOKIE_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
}

function clientIpFromHeader(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "";
  return h.get("x-real-ip") ?? "";
}

/** Expand an IPv6 address to its 8 hextets (lower-case, zone id dropped). */
function expandIPv6(ip: string): string[] | null {
  const bare = ip.split("%")[0]!;
  if (!isIPv6(bare)) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // Trailing dotted quad (::ffff:1.2.3.4) → two hextets.
  const target = tail.length ? tail : head;
  const last = target[target.length - 1];
  if (last && last.includes(".")) {
    const v4 = target.pop()!.split(".").map((n) => Number(n));
    target.push(((v4[0]! << 8) | v4[1]!).toString(16), ((v4[2]! << 8) | v4[3]!).toString(16));
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((h) => h.toLowerCase());
}

/**
 * Coarse network bucket: IPv4 /16, IPv6 /48. IPv4-mapped IPv6 addresses
 * (::ffff:a.b.c.d) are bucketed as the IPv4 they carry, so a client does not
 * change bucket depending on which stack the proxy reports.
 */
export function networkBucket(ip: string): string {
  if (!ip) return "";
  if (isIPv4(ip)) return ip.split(".").slice(0, 2).join(".");
  const hextets = expandIPv6(ip);
  if (!hextets) return ip; // unparsable — hash verbatim (still consistent per client)
  const mappedV4 = hextets.slice(0, 6).every((h, i) => parseInt(h, 16) === (i === 5 ? 0xffff : 0));
  if (mappedV4) {
    const a = parseInt(hextets[6]!, 16);
    return `${a >> 8}.${a & 0xff}`;
  }
  return hextets.slice(0, 3).map((h) => parseInt(h, 16).toString(16)).join(":");
}

function fingerprint(ip: string, ua: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return hmacSign(secret, PURPOSE_FP, `${networkBucket(ip)}|${ua}`, "hex").slice(0, 32);
}

function sign(userId: string, fp: string, expiresAt: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return hmacSign(secret, PURPOSE_SIG, `${userId}${SEP}${fp}${SEP}${expiresAt}`, "hex");
}

export type PinResult =
  | { ok: true }
  | { ok: false; reason: "no-cookie" | "expired" | "bad-signature" | "mismatch" | "no-secret" };

export async function bindSessionPin(userId: string): Promise<void> {
  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  const ip = clientIpFromHeader(h);
  const fp = fingerprint(ip, ua);
  if (!fp) return; // no secret → skip pin (fail-closed below)
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400_000).toISOString();
  const sig = sign(userId, fp, expiresAt);
  if (!sig) return;

  const value = [userId, fp, expiresAt, sig].join(SEP);
  const c = await cookies();
  c.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_DAYS * 86400,
  });
}

export async function checkSessionPin(userId: string): Promise<PinResult> {
  if (!signingSecret()) return { ok: false, reason: "no-secret" };

  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  if (!raw) return { ok: false, reason: "no-cookie" };

  const parts = raw.split(SEP);
  if (parts.length !== 4) return { ok: false, reason: "bad-signature" };
  const [cookieUserId, cookieFp, expiresAt, sig] = parts as [string, string, string, string];
  if (cookieUserId !== userId) return { ok: false, reason: "mismatch" };

  const expected = sign(cookieUserId, cookieFp, expiresAt);
  if (!expected || !hmacEqual(expected, sig, "hex")) return { ok: false, reason: "bad-signature" };
  if (isExpired(expiresAt)) return { ok: false, reason: "expired" };

  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  const ip = clientIpFromHeader(h);
  const fp = fingerprint(ip, ua);
  if (!fp || !hmacEqual(fp, cookieFp, "hex")) return { ok: false, reason: "mismatch" };

  return { ok: true };
}

export async function clearSessionPin(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}
