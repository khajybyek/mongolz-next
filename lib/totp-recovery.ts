/**
 * TOTP recovery codes — one-time backup codes for 2FA lockout.
 *
 * Codes are generated as 10 × 10-character base32 strings (≈ 50 bits entropy each).
 * Only SHA-256 hashes are stored in the DB; plaintext is shown to the user exactly
 * once at generation time. Each code is consumed on use (removed from the hash array).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omits 0/O, 1/I/L for legibility
const CODE_LENGTH = 10;
const CODE_COUNT = 10;
const GROUP = 5; // formatted as XXXXX-XXXXX

export interface GeneratedRecovery {
  plaintext: string[];
  hashes: string[];
}

function randomCode(): string {
  const buf = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return `${out.slice(0, GROUP)}-${out.slice(GROUP)}`;
}

function normalize(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashCode(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}

export function generateRecoveryCodes(count = CODE_COUNT): GeneratedRecovery {
  const plaintext: string[] = [];
  const hashes: string[] = [];
  const seen = new Set<string>();
  while (plaintext.length < count) {
    const c = randomCode();
    if (seen.has(c)) continue;
    seen.add(c);
    plaintext.push(c);
    hashes.push(hashCode(c));
  }
  return { plaintext, hashes };
}

/**
 * Try to consume a recovery code. Returns the updated hashes array (with the
 * used code removed) on success, or null if no match.
 */
export function consumeRecoveryCode(stored: string[], submitted: string): string[] | null {
  const submittedHash = hashCode(submitted);
  const submittedBuf = Buffer.from(submittedHash, "hex");

  for (let i = 0; i < stored.length; i++) {
    const candidateBuf = Buffer.from(stored[i], "hex");
    if (
      candidateBuf.length === submittedBuf.length &&
      timingSafeEqual(candidateBuf, submittedBuf)
    ) {
      return [...stored.slice(0, i), ...stored.slice(i + 1)];
    }
  }
  return null;
}
