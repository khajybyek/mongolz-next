import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:";
const AUTH_TAG_BYTES = 16; // 128-bit tag (max for GCM, NIST-recommended)

function getKey(): Buffer {
  const raw = process.env.CAMERA_URL_KEY;
  if (!raw) throw new Error("CAMERA_URL_KEY env not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("CAMERA_URL_KEY must be 32 bytes (base64-encoded)");
  return buf;
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

export function decryptCameraUrl(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 12 + AUTH_TAG_BYTES);
  const encrypted = buf.subarray(12 + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
