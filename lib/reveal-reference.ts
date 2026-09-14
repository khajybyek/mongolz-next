import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { readRevealScope } from "@/lib/reveal-scope";

const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;

export class RevealReferenceConfigurationError extends Error {
  constructor() {
    super("Reveal reference encryption is not configured");
    this.name = "RevealReferenceConfigurationError";
  }
}

function key(raw: string | undefined, jobId: string) {
  const master = Buffer.from(raw ?? "", "base64");
  if (master.length !== 32) throw new RevealReferenceConfigurationError();
  return Buffer.from(hkdfSync("sha256", master, jobId, "mongolz:reveal-reference:v1", 32));
}

/** A separate HKDF purpose binds this encrypted approval reference to its job.
 * It expires with the reveal row and is never embedded into server-rendered HTML. */
export function sealRevealReference(jobId: string, bytes: Buffer, mime: string): string {
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES
    || !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("Invalid reveal reference");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(process.env.CAMERA_URL_KEY, jobId), iv);
  cipher.setAAD(Buffer.from(jobId));
  const body = Buffer.from(JSON.stringify({ mime, data: bytes.toString("base64") }));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function openRevealReference(jobId: string, sealed: string): { mime: string; bytes: Buffer } {
  const payload = Buffer.from(sealed, "base64");
  for (const raw of [process.env.CAMERA_URL_KEY, process.env.CAMERA_URL_KEY_PREV]) {
    if (!raw) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key(raw, jobId), payload.subarray(0, 12));
      decipher.setAuthTag(payload.subarray(12, 28));
      decipher.setAAD(Buffer.from(jobId));
      const body = JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString());
      if (!["image/jpeg", "image/png", "image/webp"].includes(body.mime) || typeof body.data !== "string") {
        throw new Error("Invalid reference type");
      }
      const bytes = Buffer.from(body.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) throw new Error("Invalid reference size");
      return { mime: body.mime, bytes };
    } catch { /* Try the previous rotation key, never return plaintext fallback. */ }
  }
  throw new Error("Reveal reference unavailable");
}

export function revealReferenceMatchesScope(scopeValue: unknown, bytes: Buffer): boolean {
  const scope = readRevealScope(scopeValue);
  return Boolean(scope && scope.method === "upload"
    && createHash("sha256").update(bytes).digest("hex") === scope.reference_sha256);
}
