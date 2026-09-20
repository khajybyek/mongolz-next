import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = Buffer.from("MZEVID1\0", "ascii");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const TAG_BYTES = 16;

type EvidenceHeader = {
  format: "mongolz-evidence/1";
  cipher: "aes-256-gcm";
  kdf: "scrypt-N16384-r8-p1";
  salt: string;
  iv: string;
  tag: string;
  incident_id: string;
  manifest_sha256: string;
  zip_bytes: number;
};

function aad(header: Pick<EvidenceHeader, "incident_id" | "manifest_sha256">): Buffer {
  return Buffer.from(`mongolz-evidence/1:${header.incident_id}:${header.manifest_sha256}`, "utf8");
}

function derive(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12 || passphrase.length > 128) throw new Error("invalid evidence passphrase");
  return scryptSync(passphrase, salt, KEY_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Encrypt a complete ZIP as one authenticated, portable evidence envelope. */
export function sealEvidenceZip(
  zip: Uint8Array,
  passphrase: string,
  identity: { incidentId: string; manifestSha256: string },
): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = derive(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad({ incident_id: identity.incidentId, manifest_sha256: identity.manifestSha256 }));
    const ciphertext = Buffer.concat([cipher.update(zip), cipher.final()]);
    const header: EvidenceHeader = {
      format: "mongolz-evidence/1",
      cipher: "aes-256-gcm",
      kdf: "scrypt-N16384-r8-p1",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      incident_id: identity.incidentId,
      manifest_sha256: identity.manifestSha256,
      zip_bytes: zip.byteLength,
    };
    const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.length);
    return Buffer.concat([MAGIC, length, headerBytes, ciphertext]);
  } finally {
    key.fill(0);
  }
}

export function openEvidenceZip(envelope: Uint8Array, passphrase: string): { zip: Buffer; header: EvidenceHeader } {
  const body = Buffer.from(envelope);
  if (body.length < MAGIC.length + 4 || !body.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("invalid evidence package");
  const headerLength = body.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const payloadStart = headerStart + headerLength;
  if (headerLength < 2 || payloadStart >= body.length) throw new Error("invalid evidence package");
  const header = JSON.parse(body.subarray(headerStart, payloadStart).toString("utf8")) as EvidenceHeader;
  if (header.format !== "mongolz-evidence/1" || header.cipher !== "aes-256-gcm" || header.kdf !== "scrypt-N16384-r8-p1") {
    throw new Error("unsupported evidence package");
  }
  const salt = Buffer.from(header.salt, "base64");
  const iv = Buffer.from(header.iv, "base64");
  const tag = Buffer.from(header.tag, "base64");
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("invalid evidence package");
  const key = derive(passphrase, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(header));
    decipher.setAuthTag(tag);
    const zip = Buffer.concat([decipher.update(body.subarray(payloadStart)), decipher.final()]);
    if (zip.length !== header.zip_bytes) throw new Error("invalid evidence package length");
    return { zip, header };
  } finally {
    key.fill(0);
  }
}
