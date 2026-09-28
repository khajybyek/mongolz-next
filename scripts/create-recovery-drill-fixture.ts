/** Create a synthetic complete-recovery artifact for an isolated restore drill. */
import { createCipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RECOVERY_FORMAT,
  createKeyEscrow,
  projectFingerprint,
  recoveryDatabaseRelative,
  recoveryManifestHmac,
  recoveryObjectRelative,
  sealRecoveryDatabaseFile,
  sealRecoveryObject,
  sha256,
  type RecoveryApplicationKeys,
  type RecoveryDatabaseFile,
  type RecoveryManifest,
  type UnsignedRecoveryManifest,
  type RecoveryObject,
} from "../lib/recovery-bundle";

function usage(): never {
  console.error(
    "Usage: npm run recovery:fixture -- <bundle-dir> --key-escrow=<separate-file> [--large]",
  );
  process.exit(2);
}

function write(file: string, body: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, body, { flag: "wx", mode: 0o600 });
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
}

function cameraCiphertext(key: Buffer, url: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  return `enc:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

function encryptedRecording(key: Buffer, recordingId: string, video: Buffer): Buffer {
  const derived = Buffer.from(hkdfSync(
    "sha256",
    key,
    Buffer.from("mongolz-recording-v1"),
    Buffer.from(recordingId),
    32,
  ));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived, nonce);
  const ciphertext = Buffer.concat([cipher.update(video), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

function main() {
  const [bundleArg, ...flags] = process.argv.slice(2);
  const escrowFlag = flags.find((flag) => flag.startsWith("--key-escrow="));
  if (!bundleArg || !escrowFlag) usage();
  const passphrase = process.env.RECOVERY_ESCROW_PASSPHRASE?.trim();
  if (!passphrase) throw new Error("RECOVERY_ESCROW_PASSPHRASE is required");
  const bundle = path.resolve(bundleArg);
  const escrowPath = path.resolve(escrowFlag.slice("--key-escrow=".length));
  if (existsSync(bundle) || existsSync(escrowPath)) throw new Error("Fixture outputs already exist");
  if (escrowPath === bundle || escrowPath.startsWith(bundle + path.sep)) {
    throw new Error("Key escrow must be outside the bundle");
  }

  const cameraId = randomUUID();
  const recordingId = randomUUID();
  const cameraKey = randomBytes(32);
  const recordingKey = randomBytes(32);
  const dataKey = randomBytes(32);
  const keys: RecoveryApplicationKeys = {
    CAMERA_URL_KEY: cameraKey.toString("base64"),
    ML_ENCRYPTION_KEY: recordingKey.toString("base64"),
  };
  const generated = spawnSync(
    "ffmpeg",
    [
      "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=1",
      "-t", "1", "-an", "-c:v", "mpeg4", "-movflags", "frag_keyframe+empty_moov",
      "-f", "mp4", "pipe:1",
    ],
    { encoding: null, maxBuffer: 4 * 1024 * 1024 },
  );
  if (generated.error || generated.status !== 0 || !generated.stdout?.length) {
    throw new Error(`ffmpeg could not create the drill video: ${generated.error?.message ?? "encode failed"}`);
  }
  const encodedVideo = Buffer.from(generated.stdout);
  // --large exercises the TUS resumable path while keeping a valid MP4 header
  // and stream. Trailing padding is ignored by ffprobe and video players.
  const video = flags.includes("--large")
    ? Buffer.concat([encodedVideo, Buffer.alloc(7 * 1024 * 1024 - encodedVideo.length)])
    : encodedVideo;
  const storagePath = `${recordingId}/blurred.mp4`;
  const originalPath = `${recordingId}/original.enc`;
  const cameraRows = [{
    id: cameraId,
    name: "Synthetic recovery camera",
    url: cameraCiphertext(cameraKey, "http://recovery.invalid/video"),
    cam_type: "http",
    enabled: false,
    consent_required: false,
    consent_text: null,
    privacy_default: "standard",
    created_by: null,
    created_at: new Date().toISOString(),
  }];
  const recordingRows = [{
    id: recordingId,
    filename: "synthetic-recovery.mp4",
    storage_path: storagePath,
    original_path: originalPath,
    duration_sec: 1,
    size_bytes: video.length,
    encrypted: true,
    has_original: true,
    camera_id: cameraId,
    camera_name: "Synthetic recovery camera",
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    blur_strategy: "on_demand",
    capture_status: "ready",
    capture_error: null,
    session_id: null,
    chunk_index: null,
    is_chunk: false,
  }];
  // Browser exports deliberately omit webhook bearer URLs and HMAC secrets.
  // A complete recovery must skip this manifest-declared unrestorable table
  // while remaining strict about every unexpected missing column.
  const webhookRows = [{
    id: randomUUID(),
    name: "Synthetic excluded webhook",
    kind: "slack",
    enabled: false,
    events: ["alert.created"],
    created_by: null,
    created_at: new Date().toISOString(),
  }];
  const bucket = {
    bucket: "recordings",
    total_objects: 2,
    complete: true,
    objects: [
      { path: storagePath, source: "recordings", row_id: recordingId },
      { path: originalPath, source: "recordings", row_id: recordingId },
    ],
  };
  const cameraBytes = json(cameraRows);
  const recordingBytes = json(recordingRows);
  const webhookBytes = json(webhookRows);
  const bucketBytes = json(bucket);
  const databaseManifest = {
    format: "mongolz-backup/3",
    complete: true,
    include_biometrics: true,
    tables: {
      cameras: { rows: 1, restorable: true },
      recordings: { rows: 1, restorable: true },
      webhooks: { rows: 1, restorable: false },
    },
    buckets: { recordings: { objects: 2 } },
    file_sha256: {
      "tables/cameras.json": sha256(cameraBytes),
      "tables/recordings.json": sha256(recordingBytes),
      "tables/webhooks.json": sha256(webhookBytes),
      "buckets/recordings.manifest.json": sha256(bucketBytes),
    },
  };
  const databaseManifestBytes = json(databaseManifest);
  const databaseSources = [
    { relative: "manifest.json", body: databaseManifestBytes },
    { relative: "tables/cameras.json", body: cameraBytes },
    { relative: "tables/recordings.json", body: recordingBytes },
    { relative: "tables/webhooks.json", body: webhookBytes },
    { relative: "buckets/recordings.manifest.json", body: bucketBytes },
  ];
  const databaseFiles: RecoveryDatabaseFile[] = [];
  for (const source of databaseSources) {
    const file = recoveryDatabaseRelative(source.relative);
    const sealed = sealRecoveryDatabaseFile(source.body, dataKey, source.relative);
    write(path.join(bundle, file), sealed);
    databaseFiles.push({
      path: source.relative,
      file,
      source_bytes: source.body.length,
      source_sha256: sha256(source.body),
      sealed_bytes: sealed.length,
      sealed_sha256: sha256(sealed),
    });
  }

  const sources = [
    { bucket: "recordings", objectPath: storagePath, rowId: recordingId, body: video },
    { bucket: "recordings", objectPath: originalPath, rowId: recordingId, body: encryptedRecording(recordingKey, recordingId, video) },
  ];
  const objects: RecoveryObject[] = [];
  for (const source of sources) {
    const relative = recoveryObjectRelative(source.bucket, source.objectPath);
    const sealed = sealRecoveryObject(source.body, dataKey, source.bucket, source.objectPath);
    write(path.join(bundle, relative), sealed);
    objects.push({
      bucket: source.bucket,
      object_path: source.objectPath,
      row_id: source.rowId,
      file: relative,
      source_bytes: source.body.length,
      source_sha256: sha256(source.body),
      sealed_bytes: sealed.length,
      sealed_sha256: sha256(sealed),
    });
  }
  const escrow = createKeyEscrow(keys, dataKey, passphrase);
  write(escrowPath, escrow);
  const unsignedManifest: UnsignedRecoveryManifest = {
    format: RECOVERY_FORMAT,
    complete: true,
    full_restore: true,
    created_at: new Date().toISOString(),
    source_project_sha256: projectFingerprint("https://synthetic-recovery-source.invalid"),
    database_manifest_sha256: sha256(databaseManifestBytes),
    database_file_count: databaseFiles.length,
    database_source_bytes: databaseFiles.reduce((sum, item) => sum + item.source_bytes, 0),
    database_sealed_bytes: databaseFiles.reduce((sum, item) => sum + item.sealed_bytes, 0),
    database_files: databaseFiles,
    key_escrow_sha256: sha256(escrow),
    object_count: objects.length,
    source_bytes: objects.reduce((sum, item) => sum + item.source_bytes, 0),
    sealed_bytes: objects.reduce((sum, item) => sum + item.sealed_bytes, 0),
    objects,
  };
  const manifest: RecoveryManifest = {
    ...unsignedManifest,
    manifest_hmac_sha256: recoveryManifestHmac(unsignedManifest, dataKey),
  };
  write(path.join(bundle, "recovery-manifest.json"), json(manifest));
  dataKey.fill(0);
  cameraKey.fill(0);
  recordingKey.fill(0);
  console.log("Synthetic full-recovery fixture created. It contains no user or production data.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
