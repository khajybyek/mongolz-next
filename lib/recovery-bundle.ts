import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { validateBackupIntegrity, type BackupManifest } from "./backup-integrity";

const ESCROW_AAD = Buffer.from("mongolz-key-escrow-v1", "utf8");
const OBJECT_AAD_PREFIX = "mongolz-recovery-object-v1";
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export const RECOVERY_FORMAT = "mongolz-recovery/1";
export const ESCROW_FORMAT = "mongolz-key-escrow/1";

export type RecoveryApplicationKeys = {
  CAMERA_URL_KEY: string;
  CAMERA_URL_KEY_PREV?: string;
  ML_ENCRYPTION_KEY: string;
  ML_ENCRYPTION_KEY_PREV?: string;
};

export type RecoverySecrets = {
  recovery_data_key: string;
  application_keys: RecoveryApplicationKeys;
};

export type RecoveryObject = {
  bucket: string;
  object_path: string;
  row_id: string;
  file: string;
  source_bytes: number;
  source_sha256: string;
  sealed_bytes: number;
  sealed_sha256: string;
};

/**
 * A path a database row references but Storage no longer holds. Recorded in
 * the signed recovery manifest instead of aborting the whole mirror:
 * `flagged_in_backup` — the backup's existence check already marked it
 * `missing: true`; `not_found` — Storage answered "object not found".
 */
export type RecoveryMissingObject = {
  bucket: string;
  object_path: string;
  row_id: string;
  reason: "flagged_in_backup" | "not_found";
};

export type RecoveryDatabaseFile = {
  path: string;
  file: string;
  source_bytes: number;
  source_sha256: string;
  sealed_bytes: number;
  sealed_sha256: string;
};

export type RecoveryManifest = {
  format: typeof RECOVERY_FORMAT;
  complete: true;
  full_restore: true;
  created_at: string;
  source_project_sha256: string;
  database_manifest_sha256: string;
  database_file_count: number;
  database_source_bytes: number;
  database_sealed_bytes: number;
  database_files: RecoveryDatabaseFile[];
  key_escrow_sha256: string;
  object_count: number;
  source_bytes: number;
  sealed_bytes: number;
  objects: RecoveryObject[];
  /** Referenced objects that did not exist at mirror time (optional: older bundles omit it). */
  missing_objects?: RecoveryMissingObject[];
  manifest_hmac_sha256: string;
};

export type UnsignedRecoveryManifest = Omit<RecoveryManifest, "manifest_hmac_sha256">;

type KeyEscrowEnvelope = {
  format: typeof ESCROW_FORMAT;
  kdf: { name: "scrypt"; n: number; r: number; p: number; salt: string };
  cipher: { name: "aes-256-gcm"; iv: string; tag: string };
  ciphertext: string;
};

export type RecoveryValidation = {
  manifest: RecoveryManifest;
  secrets: RecoverySecrets;
  camera_urls_verified: number;
  encrypted_recordings_verified: number;
  database_files_verified: number;
};

export function sha256(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Bind DB hashes, object hashes and the source project to the escrowed data
 * key. Plain SHA-256 catches corruption; this HMAC also rejects a rewritten
 * manifest/database dump from someone who cannot open the key escrow. */
export function recoveryManifestHmac(
  manifest: RecoveryManifest | UnsignedRecoveryManifest,
  dataKey: Buffer,
): string {
  if (dataKey.length !== 32) throw new Error("Recovery data key must be 32 bytes");
  const { manifest_hmac_sha256: _signature, ...unsigned } = manifest as RecoveryManifest;
  return createHmac("sha256", dataKey).update(JSON.stringify(unsigned)).digest("hex");
}

function decodeKey(raw: string | undefined, name: string): Buffer {
  if (!raw) throw new Error(`${name} is required`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

export function validateApplicationKeys(keys: RecoveryApplicationKeys): void {
  decodeKey(keys.CAMERA_URL_KEY, "CAMERA_URL_KEY");
  decodeKey(keys.ML_ENCRYPTION_KEY, "ML_ENCRYPTION_KEY");
  if (keys.CAMERA_URL_KEY_PREV) decodeKey(keys.CAMERA_URL_KEY_PREV, "CAMERA_URL_KEY_PREV");
  if (keys.ML_ENCRYPTION_KEY_PREV) decodeKey(keys.ML_ENCRYPTION_KEY_PREV, "ML_ENCRYPTION_KEY_PREV");
}

export function projectFingerprint(url: string): string {
  const normalized = new URL(url).origin.toLowerCase();
  return sha256(normalized);
}

export function recoveryObjectRelative(bucket: string, objectPath: string): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(bucket)) throw new Error("Invalid recovery bucket name");
  if (!objectPath || objectPath.startsWith("/") || objectPath.includes("\\") || objectPath.includes("\0")) {
    throw new Error("Invalid recovery object path");
  }
  const segments = objectPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid recovery object path");
  }
  return path.posix.join("objects", bucket, ...segments) + ".mzr";
}

export function recoveryDatabaseRelative(relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.includes("\0")) {
    throw new Error("Invalid recovery database path");
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid recovery database path");
  }
  const allowed = relativePath === "manifest.json" || relativePath === "README.txt" ||
    /^tables\/[a-z][a-z0-9_-]*\.json$/.test(relativePath) ||
    /^buckets\/[a-z][a-z0-9_-]*\.manifest\.json$/.test(relativePath);
  if (!allowed) throw new Error("Unsupported recovery database path");
  return path.posix.join("database", relativePath) + ".mzr";
}

function objectAad(bucket: string, objectPath: string): Buffer {
  return Buffer.from(`${OBJECT_AAD_PREFIX}\0${bucket}\0${objectPath}`, "utf8");
}

export function sealRecoveryObject(body: Buffer, dataKey: Buffer, bucket: string, objectPath: string): Buffer {
  if (dataKey.length !== 32) throw new Error("Recovery data key must be 32 bytes");
  recoveryObjectRelative(bucket, objectPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv, { authTagLength: 16 });
  cipher.setAAD(objectAad(bucket, objectPath));
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function openRecoveryObject(sealed: Buffer, dataKey: Buffer, bucket: string, objectPath: string): Buffer {
  if (sealed.length < 28) throw new Error("Recovery object is truncated");
  recoveryObjectRelative(bucket, objectPath);
  const decipher = createDecipheriv("aes-256-gcm", dataKey, sealed.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(objectAad(bucket, objectPath));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

export function sealRecoveryDatabaseFile(body: Buffer, dataKey: Buffer, relativePath: string): Buffer {
  recoveryDatabaseRelative(relativePath);
  return sealRecoveryObject(body, dataKey, "database-backup", relativePath);
}

export function openRecoveryDatabaseFile(sealed: Buffer, dataKey: Buffer, relativePath: string): Buffer {
  recoveryDatabaseRelative(relativePath);
  return openRecoveryObject(sealed, dataKey, "database-backup", relativePath);
}

export function createKeyEscrow(
  applicationKeys: RecoveryApplicationKeys,
  recoveryDataKey: Buffer,
  passphrase: string,
): Buffer {
  validateApplicationKeys(applicationKeys);
  if (recoveryDataKey.length !== 32) throw new Error("Recovery data key must be 32 bytes");
  if (passphrase.length < 16) throw new Error("RECOVERY_ESCROW_PASSPHRASE must be at least 16 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  });
  const payload: RecoverySecrets = {
    recovery_data_key: recoveryDataKey.toString("base64"),
    application_keys: applicationKeys,
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(ESCROW_AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const envelope: KeyEscrowEnvelope = {
    format: ESCROW_FORMAT,
    kdf: { name: "scrypt", n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: salt.toString("base64") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope, null, 2) + "\n", "utf8");
}

export function openKeyEscrow(serialized: Buffer, passphrase: string): RecoverySecrets {
  if (!passphrase) throw new Error("RECOVERY_ESCROW_PASSPHRASE is required");
  let envelope: KeyEscrowEnvelope;
  try {
    envelope = JSON.parse(serialized.toString("utf8")) as KeyEscrowEnvelope;
  } catch {
    throw new Error("Key escrow is not valid JSON");
  }
  if (envelope.format !== ESCROW_FORMAT || envelope.kdf?.name !== "scrypt" ||
      envelope.kdf.n !== SCRYPT_N || envelope.kdf.r !== SCRYPT_R || envelope.kdf.p !== SCRYPT_P ||
      envelope.cipher?.name !== "aes-256-gcm") {
    throw new Error("Unsupported key escrow format");
  }
  try {
    const salt = Buffer.from(envelope.kdf.salt, "base64");
    const key = scryptSync(passphrase, salt, 32, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 128 * 1024 * 1024,
    });
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.cipher.iv, "base64"),
      { authTagLength: 16 },
    );
    decipher.setAAD(ESCROW_AAD);
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8")) as RecoverySecrets;
    decodeKey(payload.recovery_data_key, "recovery_data_key");
    validateApplicationKeys(payload.application_keys);
    return payload;
  } catch {
    throw new Error("Key escrow authentication failed");
  }
}

export function decryptCameraUrlCiphertext(keys: RecoveryApplicationKeys, stored: string): string {
  if (!stored.startsWith("enc:")) throw new Error("Camera URL is not encrypted");
  const payload = Buffer.from(stored.slice(4), "base64");
  if (payload.length < 29) throw new Error("Encrypted camera URL is truncated");
  for (const raw of [keys.CAMERA_URL_KEY, keys.CAMERA_URL_KEY_PREV]) {
    if (!raw) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", decodeKey(raw, "CAMERA_URL_KEY"), payload.subarray(0, 12), { authTagLength: 16 });
      decipher.setAuthTag(payload.subarray(12, 28));
      const value = Buffer.concat([
        decipher.update(payload.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      if (!/^(rtsp|rtsps|https?|demo):\/\//i.test(value)) throw new Error("Camera URL scheme is invalid");
      return value;
    } catch {
      // Try the previous rotation key without disclosing which key succeeded.
    }
  }
  throw new Error("Camera URL could not be authenticated with escrowed keys");
}

function looksLikeVideo(body: Buffer): boolean {
  if (body.length < 8) return false;
  const mp4 = body.subarray(0, Math.min(64, body.length)).includes(Buffer.from("ftyp"));
  const webm = body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3;
  return mp4 || webm;
}

export function decryptRecordingBlob(
  blob: Buffer,
  recordingId: string,
  keys: RecoveryApplicationKeys,
): Buffer {
  if (blob.length < 29) throw new Error("Encrypted recording is truncated");
  const nonce = blob.subarray(0, 12);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  for (const raw of [keys.ML_ENCRYPTION_KEY, keys.ML_ENCRYPTION_KEY_PREV]) {
    if (!raw) continue;
    try {
      const master = decodeKey(raw, "ML_ENCRYPTION_KEY");
      const derived = Buffer.from(hkdfSync(
        "sha256",
        master,
        Buffer.from("mongolz-recording-v1"),
        Buffer.from(recordingId, "utf8"),
        32,
      ));
      const decipher = createDecipheriv("aes-256-gcm", derived, nonce, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (!looksLikeVideo(plaintext)) throw new Error("Decrypted recording is not a recognized video");
      return plaintext;
    } catch {
      // Try the previous rotation key.
    }
  }
  throw new Error("Recording could not be authenticated with escrowed keys");
}

/**
 * True only for Storage's "this object does not exist" answer. A missing
 * BUCKET, an auth failure or a network error is a real fault and must abort
 * the mirror, so anything that mentions a bucket is never treated as absent.
 */
export function isStorageObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown; error?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (/bucket/i.test(message)) return false;
  if (/\bobject not found\b/i.test(message)) return true;
  return e.status === 404 || String(e.statusCode ?? "") === "404" || e.error === "not_found";
}

export type MirrorEntry = { path: string; row_id: string; missing?: boolean };

/**
 * Download every entry of one bucket manifest and hand the bytes to `store`.
 * Entries the backup flagged `missing: true` are not requested at all, and a
 * confirmed "object not found" is recorded instead of aborting; every other
 * failure (network, auth, bucket) still throws, so a flaky run can never
 * produce a bundle that silently lacks bytes that exist.
 */
export async function mirrorBucketObjects(
  bucket: string,
  entries: MirrorEntry[],
  download: (objectPath: string) => Promise<{ data: Buffer | null; error: unknown }>,
  store: (entry: MirrorEntry, body: Buffer) => void,
): Promise<{ mirrored: number; missing: RecoveryMissingObject[] }> {
  const missing: RecoveryMissingObject[] = [];
  let mirrored = 0;
  for (const [index, entry] of entries.entries()) {
    if (entry.missing === true) {
      missing.push({ bucket, object_path: entry.path, row_id: entry.row_id, reason: "flagged_in_backup" });
      continue;
    }
    const { data, error } = await download(entry.path);
    if (error || !data) {
      if (error && isStorageObjectNotFound(error)) {
        missing.push({ bucket, object_path: entry.path, row_id: entry.row_id, reason: "not_found" });
        continue;
      }
      const detail = error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "missing data";
      throw new Error(`Could not mirror ${bucket} object ${index + 1}: ${detail}`);
    }
    store(entry, data);
    mirrored++;
  }
  return { mirrored, missing };
}

function parseJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function validateRecoveryBundle(
  bundleDir: string,
  escrowPath: string,
  passphrase: string,
): RecoveryValidation {
  const root = path.resolve(bundleDir);
  const manifest = parseJsonFile<RecoveryManifest>(path.join(root, "recovery-manifest.json"));
  if (manifest.format !== RECOVERY_FORMAT || manifest.complete !== true || manifest.full_restore !== true) {
    throw new Error("Recovery bundle is incomplete or unsupported");
  }
  const escrow = readFileSync(escrowPath);
  if (sha256(escrow) !== manifest.key_escrow_sha256) throw new Error("Key escrow checksum mismatch");
  const secrets = openKeyEscrow(escrow, passphrase);
  const dataKey = decodeKey(secrets.recovery_data_key, "recovery_data_key");
  try {
  const expectedHmac = recoveryManifestHmac(manifest, dataKey);
  if (!/^[a-f0-9]{64}$/.test(manifest.manifest_hmac_sha256) ||
      !timingSafeEqual(Buffer.from(expectedHmac, "hex"), Buffer.from(manifest.manifest_hmac_sha256, "hex"))) {
    throw new Error("Recovery manifest authentication failed");
  }

  if (!Array.isArray(manifest.database_files) || manifest.database_files.length !== manifest.database_file_count) {
    throw new Error("Recovery database file count mismatch");
  }
  const databaseFiles = new Map<string, Buffer>();
  let databaseSourceBytes = 0;
  let databaseSealedBytes = 0;
  for (const item of manifest.database_files) {
    const expectedFile = recoveryDatabaseRelative(item.path);
    if (item.file !== expectedFile || databaseFiles.has(item.path)) {
      throw new Error("Recovery database file mapping mismatch");
    }
    const file = path.resolve(root, item.file);
    if (!file.startsWith(root + path.sep)) throw new Error("Recovery database file escaped bundle root");
    const sealed = readFileSync(file);
    if (sealed.length !== item.sealed_bytes || sha256(sealed) !== item.sealed_sha256) {
      throw new Error("Recovery database sealed checksum mismatch");
    }
    const source = openRecoveryDatabaseFile(sealed, dataKey, item.path);
    if (source.length !== item.source_bytes || sha256(source) !== item.source_sha256) {
      throw new Error("Recovery database source checksum mismatch");
    }
    databaseFiles.set(item.path, source);
    databaseSourceBytes += source.length;
    databaseSealedBytes += sealed.length;
  }
  if (databaseSourceBytes !== manifest.database_source_bytes ||
      databaseSealedBytes !== manifest.database_sealed_bytes) {
    throw new Error("Recovery database byte totals mismatch");
  }
  const databaseManifestBytes = databaseFiles.get("manifest.json");
  if (!databaseManifestBytes) throw new Error("Recovery database manifest is missing");
  if (sha256(databaseManifestBytes) !== manifest.database_manifest_sha256) {
    throw new Error("Database manifest checksum mismatch");
  }
  const databaseManifest = JSON.parse(databaseManifestBytes.toString("utf8")) as BackupManifest;
  const databaseErrors = validateBackupIntegrity(
    databaseManifest,
    (relative) => {
      const body = databaseFiles.get(relative);
      if (!body) throw new Error("missing recovery database file");
      return body;
    },
  );
  if (databaseErrors.length) throw new Error(`Database backup validation failed: ${databaseErrors.join("; ")}`);
  const expectedDatabaseFiles = new Set([
    "manifest.json",
    ...Object.keys(databaseManifest.tables ?? {}).map((name) => `tables/${name}.json`),
    ...Object.keys(databaseManifest.buckets ?? {}).map((name) => `buckets/${name}.manifest.json`),
  ]);
  for (const file of databaseFiles.keys()) {
    if (file !== "README.txt" && !expectedDatabaseFiles.has(file)) {
      throw new Error("Unexpected recovery database file");
    }
  }
  for (const file of expectedDatabaseFiles) {
    if (!databaseFiles.has(file)) throw new Error("Recovery database file is missing");
  }

  if (!Array.isArray(manifest.objects) || manifest.objects.length !== manifest.object_count) {
    throw new Error("Recovery object count mismatch");
  }
  let sourceBytes = 0;
  let sealedBytes = 0;
  let encryptedRecordings = 0;
  const seen = new Set<string>();
  for (const item of manifest.objects) {
    const expectedFile = recoveryObjectRelative(item.bucket, item.object_path);
    if (item.file !== expectedFile) throw new Error("Recovery object file mapping mismatch");
    const unique = `${item.bucket}\0${item.object_path}`;
    if (seen.has(unique)) throw new Error("Duplicate recovery object");
    seen.add(unique);
    const file = path.resolve(root, item.file);
    if (!file.startsWith(root + path.sep)) throw new Error("Recovery object escaped bundle root");
    const stat = statSync(file);
    const sealed = readFileSync(file);
    if (stat.size !== item.sealed_bytes || sha256(sealed) !== item.sealed_sha256) {
      throw new Error("Recovery object sealed checksum mismatch");
    }
    const source = openRecoveryObject(sealed, dataKey, item.bucket, item.object_path);
    if (source.length !== item.source_bytes || sha256(source) !== item.source_sha256) {
      throw new Error("Recovery object source checksum mismatch");
    }
    if (item.bucket === "recordings" && item.object_path.endsWith(".enc")) {
      decryptRecordingBlob(source, item.row_id, secrets.application_keys);
      encryptedRecordings++;
    }
    sourceBytes += source.length;
    sealedBytes += sealed.length;
  }
  if (sourceBytes !== manifest.source_bytes || sealedBytes !== manifest.sealed_bytes) {
    throw new Error("Recovery byte totals mismatch");
  }
  if (manifest.missing_objects !== undefined) {
    if (!Array.isArray(manifest.missing_objects)) throw new Error("Recovery missing-object list is invalid");
    for (const item of manifest.missing_objects) {
      recoveryObjectRelative(item.bucket, item.object_path);
      const unique = `${item.bucket}\0${item.object_path}`;
      if (seen.has(unique)) throw new Error("Recovery object is listed as both mirrored and missing");
      seen.add(unique);
    }
  }

  const cameraBytes = databaseFiles.get("tables/cameras.json");
  if (!cameraBytes) throw new Error("Camera backup table is missing");
  const cameras = JSON.parse(cameraBytes.toString("utf8")) as Array<{ url?: unknown }>;
  let cameraUrls = 0;
  for (const camera of cameras) {
    if (typeof camera.url !== "string") throw new Error("Camera backup row has no URL");
    decryptCameraUrlCiphertext(secrets.application_keys, camera.url);
    cameraUrls++;
  }
  return {
    manifest,
    secrets,
    camera_urls_verified: cameraUrls,
    encrypted_recordings_verified: encryptedRecordings,
    database_files_verified: databaseFiles.size,
  };
  } finally {
    dataKey.fill(0);
  }
}
