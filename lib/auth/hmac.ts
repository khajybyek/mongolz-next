import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Domain-separated HMAC-SHA256 for the cookie helpers (step-up, pre-TOTP,
 * session pin, stream tickets).
 *
 * Every signer used to MAC the bare payload with the same secret, so a
 * pre-TOTP cookie (`userId|exp`) re-encoded as a step-up cookie verified —
 * a password-only login could mint a permanent reauth credential. Prefixing
 * a purpose tag and a NUL separator makes signatures from one purpose
 * meaningless for every other.
 */
export function hmacSign(secret: string, purpose: string, payload: string, encoding: "hex" | "base64url" = "hex"): string {
  return createHmac("sha256", secret).update(`${purpose}\0${payload}`).digest(encoding);
}

/** Constant-time comparison of two encoded digests (false on length mismatch). */
export function hmacEqual(a: string, b: string, encoding: "hex" | "base64url" = "hex"): boolean {
  let aa: Buffer;
  let bb: Buffer;
  try {
    aa = Buffer.from(a, encoding);
    bb = Buffer.from(b, encoding);
  } catch {
    return false;
  }
  return aa.length > 0 && aa.length === bb.length && timingSafeEqual(aa, bb);
}

/**
 * ISO-8601 expiry check; anything that does not parse as a date is treated
 * as expired. Epoch-seconds strings (the pre-TOTP cookie format) are
 * deliberately NOT accepted here so one cookie format can never be replayed
 * as another.
 */
export function isExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const ts = Date.parse(expiresAt);
  return !Number.isFinite(ts) || ts <= nowMs;
}
