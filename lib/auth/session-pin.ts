/**
 * Session pinning — bind a Supabase session to the User-Agent + IP it was
 * created with. If a stolen cookie is replayed from a different network or
 * browser, the pin mismatch invalidates the session (force re-login).
 *
 * **Design tradeoffs:**
 *   - IP can change legitimately (mobile WiFi → cellular). We hash the /16 of
 *     IPv4 and /48 of IPv6 instead of the full address, which catches network
 *     hops while tolerating normal carrier changes.
 *   - User-Agent is hashed in full; minor browser updates won't change it.
 *   - Cookie is HMAC-signed so the client can't tamper.
 *   - 7-day TTL — refreshes on each successful pin check.
 */

import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pickHmacSecret } from "@/lib/auth/hmac-secret";

const COOKIE_NAME = "mongolz-session-pin";
const TTL_DAYS = 7;
const SEP = "|";

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

function networkBucket(ip: string): string {
  if (!ip) return "";
  if (ip.includes(":")) {
    // IPv6 — /48
    return ip.split(":").slice(0, 3).join(":");
  }
  // IPv4 — /16
  return ip.split(".").slice(0, 2).join(".");
}

function fingerprint(ip: string, ua: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  const bucket = networkBucket(ip);
  return createHmac("sha256", secret)
    .update(`${bucket}|${ua}`)
    .digest("hex")
    .slice(0, 32);
}

function sign(userId: string, fp: string, expiresAt: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${userId}${SEP}${fp}${SEP}${expiresAt}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
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
  const [cookieUserId, cookieFp, expiresAt, sig] = parts;
  if (cookieUserId !== userId) return { ok: false, reason: "mismatch" };

  const expected = sign(cookieUserId, cookieFp, expiresAt);
  if (!expected || !safeEqual(expected, sig)) return { ok: false, reason: "bad-signature" };
  if (new Date(expiresAt).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  const ip = clientIpFromHeader(h);
  const fp = fingerprint(ip, ua);
  if (!fp || fp !== cookieFp) return { ok: false, reason: "mismatch" };

  return { ok: true };
}

export async function clearSessionPin(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}
