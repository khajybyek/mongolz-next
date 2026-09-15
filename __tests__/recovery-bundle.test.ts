import {
  createCipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RECOVERY_FORMAT,
  createKeyEscrow,
  openKeyEscrow,
  recoveryDatabaseRelative,
  recoveryObjectRelative,
  recoveryManifestHmac,
  sealRecoveryDatabaseFile,
  sealRecoveryObject,
  sha256,
  validateRecoveryBundle,
  type RecoveryApplicationKeys,
  type RecoveryDatabaseFile,
  type RecoveryManifest,
  type UnsignedRecoveryManifest,
} from "@/lib/recovery-bundle";

const PASSPHRASE = "correct horse battery staple";
const RECORDING_ID = "22222222-2222-4222-8222-222222222222";

function encryptCameraUrl(key: Buffer, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

function encryptRecording(master: Buffer, recordingId: string): Buffer {
  const plaintext = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom0000mongolz-test-video", "ascii"),
  ]);
  const key = Buffer.from(hkdfSync(
    "sha256",
    master,
    Buffer.from("mongolz-recording-v1"),
    Buffer.from(recordingId),
    32,
  ));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

function writeJson(file: string, value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  writeFileSync(file, body);
  return body;
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "mongolz-recovery-test-"));
  const bundle = path.join(root, "bundle");
  const escrow = path.join(root, "keys.escrow.json");
  mkdirSync(bundle, { recursive: true });

  const cameraKey = randomBytes(32);
  const recordingKey = randomBytes(32);
  const dataKey = randomBytes(32);
  const keys: RecoveryApplicationKeys = {
    CAMERA_URL_KEY: cameraKey.toString("base64"),
    ML_ENCRYPTION_KEY: recordingKey.toString("base64"),
  };
  const cameraRows = [{
    id: "11111111-1111-4111-8111-111111111111",
    name: "Recovery camera",
    url: encryptCameraUrl(cameraKey, "demo://recovery"),
  }];
  const cameraFile = Buffer.from(JSON.stringify(cameraRows, null, 2), "utf8");
  const bucketBody = Buffer.from(JSON.stringify({
    bucket: "recordings",
    total_objects: 1,
    complete: true,
    objects: [{ path: `${RECORDING_ID}/original.enc`, source: "recordings", row_id: RECORDING_ID }],
  }, null, 2), "utf8");
  const databaseManifest = {
    format: "mongolz-backup/3",
    complete: true,
    include_biometrics: true,
    tables: { cameras: { rows: 1, restorable: true } },
    buckets: { recordings: { objects: 1 } },
    file_sha256: {
      "tables/cameras.json": sha256(cameraFile),
      "buckets/recordings.manifest.json": sha256(bucketBody),
    },
  };
  const databaseManifestBytes = Buffer.from(JSON.stringify(databaseManifest, null, 2), "utf8");
  const databaseSources = [
    { path: "manifest.json", body: databaseManifestBytes },
    { path: "tables/cameras.json", body: cameraFile },
    { path: "buckets/recordings.manifest.json", body: bucketBody },
  ];
  const databaseFiles: RecoveryDatabaseFile[] = [];
  for (const source of databaseSources) {
    const file = recoveryDatabaseRelative(source.path);
    const sealedDatabase = sealRecoveryDatabaseFile(source.body, dataKey, source.path);
    mkdirSync(path.dirname(path.join(bundle, file)), { recursive: true });
    writeFileSync(path.join(bundle, file), sealedDatabase);
    databaseFiles.push({
      path: source.path,
      file,
      source_bytes: source.body.length,
      source_sha256: sha256(source.body),
      sealed_bytes: sealedDatabase.length,
      sealed_sha256: sha256(sealedDatabase),
    });
  }
  const original = encryptRecording(recordingKey, RECORDING_ID);
  const objectPath = `${RECORDING_ID}/original.enc`;
  const relative = recoveryObjectRelative("recordings", objectPath);
  mkdirSync(path.dirname(path.join(bundle, relative)), { recursive: true });
  const sealed = sealRecoveryObject(original, dataKey, "recordings", objectPath);
  writeFileSync(path.join(bundle, relative), sealed);
  const escrowBytes = createKeyEscrow(keys, dataKey, PASSPHRASE);
  writeFileSync(escrow, escrowBytes);
  const unsignedManifest: UnsignedRecoveryManifest = {
    format: RECOVERY_FORMAT,
    complete: true,
    full_restore: true,
    created_at: new Date().toISOString(),
    source_project_sha256: sha256("https://source.example"),
    database_manifest_sha256: sha256(databaseManifestBytes),
    database_file_count: databaseFiles.length,
    database_source_bytes: databaseFiles.reduce((sum, item) => sum + item.source_bytes, 0),
    database_sealed_bytes: databaseFiles.reduce((sum, item) => sum + item.sealed_bytes, 0),
    database_files: databaseFiles,
    key_escrow_sha256: sha256(escrowBytes),
    object_count: 1,
    source_bytes: original.length,
    sealed_bytes: sealed.length,
    objects: [{
      bucket: "recordings",
      object_path: objectPath,
      row_id: RECORDING_ID,
      file: relative,
      source_bytes: original.length,
      source_sha256: sha256(original),
      sealed_bytes: sealed.length,
      sealed_sha256: sha256(sealed),
    }],
  };
  const recoveryManifest: RecoveryManifest = {
    ...unsignedManifest,
    manifest_hmac_sha256: recoveryManifestHmac(unsignedManifest, dataKey),
  };
  writeJson(path.join(bundle, "recovery-manifest.json"), recoveryManifest);
  return { root, bundle, escrow, keys, dataKey, relative };
}

describe("recovery key escrow", () => {
  test("round-trips keys without exposing them in the serialized envelope", () => {
    const camera = randomBytes(32).toString("base64");
    const recording = randomBytes(32).toString("base64");
    const keys = { CAMERA_URL_KEY: camera, ML_ENCRYPTION_KEY: recording };
    const serialized = createKeyEscrow(keys, randomBytes(32), PASSPHRASE);
    expect(serialized.toString("utf8")).not.toContain(camera);
    expect(serialized.toString("utf8")).not.toContain(recording);
    expect(openKeyEscrow(serialized, PASSPHRASE).application_keys).toEqual(keys);
    expect(() => openKeyEscrow(serialized, "wrong passphrase value")).toThrow(
      "authentication failed",
    );
  });
});

describe("complete recovery bundle", () => {
  test("authenticates the DB, escrow, outer objects and inner application encryption", () => {
    const value = fixture();
    try {
      expect(validateRecoveryBundle(value.bundle, value.escrow, PASSPHRASE)).toMatchObject({
        camera_urls_verified: 1,
        encrypted_recordings_verified: 1,
        database_files_verified: 3,
      });
      const sealedCamera = readFileSync(
        path.join(value.bundle, recoveryDatabaseRelative("tables/cameras.json")),
      );
      expect(sealedCamera.toString("utf8")).not.toContain("Recovery camera");
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  test("rejects a corrupted sealed object before restore", () => {
    const value = fixture();
    try {
      const file = path.join(value.bundle, value.relative);
      const damaged = readFileSync(file);
      damaged[damaged.length - 1] ^= 1;
      writeFileSync(file, damaged);
      expect(() => validateRecoveryBundle(value.bundle, value.escrow, PASSPHRASE)).toThrow(
        "sealed checksum mismatch",
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  test("rejects a rewritten database checksum because the manifest is key-authenticated", () => {
    const value = fixture();
    try {
      const recoveryFile = path.join(value.bundle, "recovery-manifest.json");
      const recovery = JSON.parse(readFileSync(recoveryFile, "utf8")) as RecoveryManifest;
      recovery.database_manifest_sha256 = "a".repeat(64);
      writeJson(recoveryFile, recovery);
      expect(() => validateRecoveryBundle(value.bundle, value.escrow, PASSPHRASE)).toThrow(
        "manifest authentication failed",
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  test("refuses paths that could escape the recovery directory", () => {
    expect(() => recoveryObjectRelative("recordings", "../secret.enc")).toThrow(
      "Invalid recovery object path",
    );
    expect(() => recoveryObjectRelative("recordings", "/absolute.enc")).toThrow(
      "Invalid recovery object path",
    );
  });
});
