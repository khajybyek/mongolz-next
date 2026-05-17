/**
 * TOTP 2FA helpers — RFC 6238 (Google Authenticator-той нийцтэй).
 *
 * Flow:
 *   1. /settings → "Enable 2FA" → generateSecret() → save секрет → show QR
 *   2. User scans QR with Google Authenticator
 *   3. User types 6-digit code → verifyTOTP(secret, code)
 *   4. Success → totp_enabled=true
 *
 * Login (subsequent):
 *   1. email + password
 *   2. If profile.totp_enabled → ask for 6-digit code
 *   3. verifyTOTP(secret, code) → grant session
 */
import { createHash } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { createServiceClient } from "@/lib/supabase/server";

export const ISSUER = "MONGOLZ Security";

/** Шинэ TOTP secret үүсгэх (base32, 32 character ~ 160 bit) */
export function generateSecret(): string {
  // OTPAuth.Secret.fromRandom-аар 20 byte (160 bit) random үүсгэнэ.
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** otpauth:// URI (QR code-д бичигдэх) */
export function buildOtpauthUri(secret: string, accountLabel: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  return totp.toString();
}

/** QR code-ыг data URI болгож буцаана (UI-д <img src=...> ашиглаж болно) */
export async function buildQrDataUri(otpauthUri: string): Promise<string> {
  return await QRCode.toDataURL(otpauthUri, {
    margin: 1,
    width: 256,
    color: { dark: "#0a0a1e", light: "#ffffff" },
  });
}

/** TOTP код шалгана. ±1 цаг (30 сек) clock drift зөвшөөрнө. */
export function verifyTOTP(secret: string, token: string): boolean {
  if (!secret || !token) return false;
  const cleaned = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    // window=1 → ±1 period (30s) drift зөвшөөрнө
    const delta = totp.validate({ token: cleaned, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

/**
 * Verify TOTP + atomically mark the code as used so it cannot be replayed
 * inside its 30-second validity window.
 *
 * Returns:
 *   - "ok"        → first-time use, accept
 *   - "replayed"  → same code presented again, reject
 *   - "invalid"   → fails RFC 6238 check
 */
export type TotpVerifyResult = "ok" | "replayed" | "invalid";

export async function verifyTOTPWithReplayCheck(
  userId: string,
  secret: string,
  token: string,
): Promise<TotpVerifyResult> {
  if (!verifyTOTP(secret, token)) return "invalid";

  // Hash the candidate before storing — keeps the DB row from leaking the
  // raw code if anyone ever sniffs the audit_log replication stream.
  const cleaned = token.replace(/\s/g, "");
  const codeHash = createHash("sha256")
    .update(`${userId}:${cleaned}`)
    .digest("hex");

  try {
    const svc = createServiceClient();
    const { data, error } = await svc.rpc("consume_totp_code", {
      p_user_id: userId,
      p_code_hash: codeHash,
      p_ttl_sec: 90,
    });
    if (error) {
      // DB-level failure should fail-closed: refuse the verify.
      return "invalid";
    }
    return data === true ? "ok" : "replayed";
  } catch {
    return "invalid";
  }
}
