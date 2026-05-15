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
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

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
