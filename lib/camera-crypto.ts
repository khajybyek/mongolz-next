import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:";
const AUTH_TAG_BYTES = 16; // 128-bit tag (max for GCM, NIST-recommended)

function parseKey(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes (base64-encoded)`);
  return buf;
}

function getKey(): Buffer {
  const key = parseKey(process.env.CAMERA_URL_KEY, "CAMERA_URL_KEY");
  if (!key) throw new Error("CAMERA_URL_KEY env not set");
  return key;
}

/**
 * Dual-key rotation: new URLs are sealed with CAMERA_URL_KEY; on decrypt the
 * previous key (CAMERA_URL_KEY_PREV) is tried after the active one, so a
 * rotation never leaves existing cameras undecryptable. Re-encrypt with
 * `npm run encrypt:camera-urls -- --reencrypt`, then drop the PREV var.
 */
function getPrevKey(): Buffer | null {
  return parseKey(process.env.CAMERA_URL_KEY_PREV, "CAMERA_URL_KEY_PREV");
}

export function allowPlaintextCameraUrls(): boolean {
  return process.env.ALLOW_PLAINTEXT_CAMERA_URLS === "1";
}

export function protectCameraUrlForStorage(plaintext: string): string {
  if (process.env.CAMERA_URL_KEY) return encryptCameraUrl(plaintext);
  if (allowPlaintextCameraUrls()) return plaintext;
  throw new Error("CAMERA_URL_KEY env not set");
}

export function unwrapCameraUrlForRuntime(stored: string): string {
  if (stored.startsWith(PREFIX)) return decryptCameraUrl(stored);
  if (allowPlaintextCameraUrls()) return stored;
  throw new Error("PLAINTEXT_CAMERA_URL_NOT_ALLOWED");
}

export function encryptCameraUrl(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  // Explicit authTagLength locks the tag size (NIST SP 800-38D requires
  // a single, agreed-upon t for every (key, IV) pair).
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return PREFIX + payload;
}

function decryptWith(key: Buffer, buf: Buffer): string {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 12 + AUTH_TAG_BYTES);
  const encrypted = buf.subarray(12 + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function decryptCameraUrl(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  try {
    return decryptWith(getKey(), buf);
  } catch (e) {
    const prev = getPrevKey();
    if (!prev) throw e;
    return decryptWith(prev, buf);
  }
}

/** True when the value was sealed with the PREVIOUS key (needs re-encryption). */
export function isSealedWithPrevKey(stored: string): boolean {
  if (!stored.startsWith(PREFIX)) return false;
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  try {
    decryptWith(getKey(), buf);
    return false;
  } catch {
    const prev = getPrevKey();
    if (!prev) return false;
    try {
      decryptWith(prev, buf);
      return true;
    } catch {
      return false;
    }
  }
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
