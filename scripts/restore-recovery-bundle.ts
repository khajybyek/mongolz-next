/** Validate a complete recovery bundle, then restore it to a different project. */
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import {
  closeSync,
  chmodSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { BackupManifest } from "../lib/backup-integrity";
import {
  decryptRecordingBlob,
  decryptCameraUrlCiphertext,
  openRecoveryDatabaseFile,
  openRecoveryObject,
  projectFingerprint,
  recoveryDatabaseRelative,
  sha256,
  validateRecoveryBundle,
} from "../lib/recovery-bundle";

for (const file of [".env.production.tmp", ".env.local"]) {
  if (existsSync(file)) loadEnv({ path: file, quiet: true });
}

function usage(): never {
  console.error(
    "Usage: npm run recovery:restore -- <bundle-dir> --key-escrow=<separate-file> [--apply] [--report=<file>]",
  );
  process.exit(2);
}

function atomicWrite(file: string, body: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.partial-${process.pid}`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}

function contentTypeFor(objectPath: string): string {
  if (objectPath.endsWith(".enc")) return "application/octet-stream";
  const extension = path.extname(objectPath).toLowerCase();
  return ({
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
const TUS_CHUNK = 6 * 1024 * 1024;

function tusEndpoint(projectUrl: string): string {
  const url = new URL(projectUrl);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  url.pathname = "/storage/v1/upload/resumable";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function tusMetadata(bucket: string, objectPath: string, contentType: string): string {
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
  return [
    `bucketName ${encode(bucket)}`,
    `objectName ${encode(objectPath)}`,
    `contentType ${encode(contentType)}`,
    `cacheControl ${encode("3600")}`,
  ].join(",");
}

async function resumableUpload(
  projectUrl: string,
  serviceKey: string,
  bucket: string,
  objectPath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const authHeaders = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "tus-resumable": "1.0.0" };
  const created = await fetch(tusEndpoint(projectUrl), {
    method: "POST",
    headers: {
      ...authHeaders,
      "upload-length": String(body.length),
      "upload-metadata": tusMetadata(bucket, objectPath, contentType),
      "x-upsert": "false",
    },
  });
  if (!created.ok) throw new Error(`Resumable Storage upload could not start (${created.status})`);
  const location = created.headers.get("location");
  if (!location) throw new Error("Resumable Storage upload returned no location");
  const uploadUrl = new URL(location, tusEndpoint(projectUrl)).toString();

  let offset = 0;
  let failures = 0;
  while (offset < body.length) {
    try {
      const end = Math.min(offset + TUS_CHUNK, body.length);
      const patched = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "content-type": "application/offset+octet-stream",
          "upload-offset": String(offset),
        },
        body: body.subarray(offset, end) as unknown as BodyInit,
      });
      if (!patched.ok) throw new Error(`chunk status ${patched.status}`);
      const acknowledged = Number(patched.headers.get("upload-offset"));
      if (!Number.isSafeInteger(acknowledged) || acknowledged < end || acknowledged > body.length) {
        throw new Error("invalid upload offset");
      }
      offset = acknowledged;
      failures = 0;
    } catch (error) {
      failures++;
      if (failures >= 3) {
        throw new Error(`Resumable Storage upload failed after retries: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      const status = await fetch(uploadUrl, { method: "HEAD", headers: authHeaders });
      const remoteOffset = Number(status.headers.get("upload-offset"));
      if (!status.ok || !Number.isSafeInteger(remoteOffset) || remoteOffset < 0 || remoteOffset > body.length) {
        throw new Error("Resumable Storage upload state could not be recovered");
      }
      offset = remoteOffset;
    }
  }
}

function verifyRestoredVideos(bundle: string, validation: ReturnType<typeof validateRecoveryBundle>): void {
  const dataKey = Buffer.from(validation.secrets.recovery_data_key, "base64");
  const probeDir = mkdtempSync(path.join(os.tmpdir(), "mongolz-recovery-probe-"));
  chmodSync(probeDir, 0o700);
  try {
    let index = 0;
    for (const item of validation.manifest.objects) {
      if (item.bucket !== "recordings" || !item.object_path.endsWith(".enc")) continue;
      const sealed = readFileSync(path.join(bundle, item.file));
      const encrypted = openRecoveryObject(sealed, dataKey, item.bucket, item.object_path);
      const video = decryptRecordingBlob(encrypted, item.row_id, validation.secrets.application_keys);
      const probeFile = path.join(probeDir, `${index++}.video`);
      writeFileSync(probeFile, video, { flag: "wx", mode: 0o600 });
      const probe = spawnSync(
        "ffprobe",
        [
          "-v", "error", "-count_frames", "-select_streams", "v:0",
          "-show_entries", "stream=codec_type,nb_read_frames", "-of", "csv=p=0", probeFile,
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      if (probe.error) throw new Error(`ffprobe is required for recovery preflight: ${probe.error.message}`);
      if (probe.status !== 0 || !probe.stdout.split(/[\s,]+/).includes("video")) {
        throw new Error("Decrypted recording failed the ffprobe video check");
      }
    }
  } finally {
    dataKey.fill(0);
    rmSync(probeDir, { recursive: true, force: true });
  }
}

async function main() {
  const [bundleArg, ...flags] = process.argv.slice(2);
  const escrowFlag = flags.find((flag) => flag.startsWith("--key-escrow="));
  const reportFlag = flags.find((flag) => flag.startsWith("--report="));
  const apply = flags.includes("--apply");
  if (!bundleArg || !escrowFlag) usage();

  const bundle = path.resolve(bundleArg);
  const escrowPath = path.resolve(escrowFlag.slice("--key-escrow=".length));
  const passphrase = process.env.RECOVERY_ESCROW_PASSPHRASE?.trim();
  const targetUrl = process.env.RESTORE_SUPABASE_URL?.trim();
  if (!passphrase) throw new Error("RECOVERY_ESCROW_PASSPHRASE is required");
  if (!targetUrl) throw new Error("RESTORE_SUPABASE_URL is required");

  // This authenticates every DB file, sealed object, original object, encrypted
  // recording and camera URL before the first remote write.
  const validation = validateRecoveryBundle(bundle, escrowPath, passphrase);
  if (projectFingerprint(targetUrl) === validation.manifest.source_project_sha256) {
    throw new Error("Restore target must be a different Supabase project from the backup source");
  }
  verifyRestoredVideos(bundle, validation);
  console.log(
    `Preflight passed: ${validation.database_files_verified} DB file(s), ${validation.manifest.object_count} storage object(s), ${validation.camera_urls_verified} camera URL(s), ${validation.encrypted_recordings_verified} encrypted recording(s).`,
  );
  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to write to the isolated restore project.");
    return;
  }

  const targetKey = process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!targetKey) throw new Error("RESTORE_SUPABASE_SERVICE_ROLE_KEY is required with --apply");
  const restoreSvc = createClient(targetUrl, targetKey, { auth: { persistSession: false } });
  const dataKey = Buffer.from(validation.secrets.recovery_data_key, "base64");

  // Upload and read back all blobs before rows point at them. A clean isolated
  // project is required, so an existing path aborts instead of being replaced.
  let restoredBytes = 0;
  try {
    for (const [index, item] of validation.manifest.objects.entries()) {
      const bucket = item.bucket;
      const sealed = readFileSync(path.join(bundle, item.file));
      const source = openRecoveryObject(sealed, dataKey, item.bucket, item.object_path);
      const contentType = contentTypeFor(item.object_path);
      if (source.length > RESUMABLE_THRESHOLD) {
        await resumableUpload(targetUrl, targetKey, bucket, item.object_path, source, contentType);
      } else {
        const { error: uploadError } = await restoreSvc.storage.from(bucket).upload(item.object_path, source, {
          upsert: false,
          contentType,
          cacheControl: "3600",
        });
        if (uploadError) throw new Error(`Storage restore failed at object ${index + 1}: ${uploadError.message}`);
      }
      const { data: downloaded, error: downloadError } = await restoreSvc.storage.from(bucket).download(item.object_path);
      if (downloadError || !downloaded) {
        throw new Error(`Storage verification failed at object ${index + 1}: ${downloadError?.message ?? "missing data"}`);
      }
      const roundTrip = Buffer.from(await downloaded.arrayBuffer());
      if (roundTrip.length !== item.source_bytes || sha256(roundTrip) !== item.source_sha256) {
        throw new Error(`Storage verification checksum failed at object ${index + 1}`);
      }
      restoredBytes += source.length;
    }
  } finally {
    dataKey.fill(0);
  }

  const databaseDir = mkdtempSync(path.join(os.tmpdir(), "mongolz-recovery-database-"));
  chmodSync(databaseDir, 0o700);
  let databaseManifest: BackupManifest;
  const databaseKey = Buffer.from(validation.secrets.recovery_data_key, "base64");
  try {
    for (const item of validation.manifest.database_files) {
      if (item.file !== recoveryDatabaseRelative(item.path)) {
        throw new Error("Recovery database file mapping changed after preflight");
      }
      const sealed = readFileSync(path.join(bundle, item.file));
      const source = openRecoveryDatabaseFile(sealed, databaseKey, item.path);
      const output = path.join(databaseDir, item.path);
      mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      writeFileSync(output, source, { flag: "wx", mode: 0o600 });
    }
    databaseManifest = JSON.parse(
      readFileSync(path.join(databaseDir, "manifest.json"), "utf8"),
    ) as BackupManifest;
    const restore = spawnSync(
      process.execPath,
      [
        "--import", "tsx", path.join(process.cwd(), "scripts", "restore-from-backup.ts"), databaseDir,
        "--apply", "--skip-unrestorable", "--strict-manifest-skips",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: targetUrl,
          SUPABASE_SERVICE_ROLE_KEY: targetKey,
        },
        encoding: "utf8",
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    if (restore.error) throw restore.error;
    if (restore.status !== 0) throw new Error(`Database row restore exited with status ${restore.status ?? "unknown"}`);
  } finally {
    databaseKey.fill(0);
    rmSync(databaseDir, { recursive: true, force: true });
  }

  const verifiedRows: Record<string, number> = {};
  for (const [table, report] of Object.entries(databaseManifest.tables ?? {})) {
    if (report.restorable !== true || !Number.isSafeInteger(report.rows)) continue;
    const { count, error } = await restoreSvc.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`Could not verify ${table} row count: ${error.message}`);
    if (count !== report.rows) {
      throw new Error(`${table} row count mismatch: expected ${report.rows}, found ${count ?? "unknown"}`);
    }
    verifiedRows[table] = count ?? 0;
  }

  const { data: cameras, error: cameraError } = await restoreSvc.from("cameras").select("url");
  if (cameraError) throw new Error(`Could not verify restored cameras: ${cameraError.message}`);
  for (const camera of cameras ?? []) {
    decryptCameraUrlCiphertext(validation.secrets.application_keys, String(camera.url));
  }
  if ((cameras?.length ?? 0) !== validation.camera_urls_verified) {
    throw new Error("Restored camera count does not match the recovery preflight");
  }

  const recoveryManifestHash = sha256(readFileSync(path.join(bundle, "recovery-manifest.json")));
  const { error: auditError } = await restoreSvc.from("audit_log").insert({
    action: "BACKUP_RESTORE_DRILL",
    detail: `complete recovery verified; manifest=${recoveryManifestHash}; tables=${Object.keys(verifiedRows).length}; objects=${validation.manifest.object_count}; bytes=${restoredBytes}`,
  });
  if (auditError) throw new Error(`Recovery succeeded but audit record failed: ${auditError.message}`);

  const report = {
    format: "mongolz-recovery-report/1",
    status: "passed",
    completed_at: new Date().toISOString(),
    source_project_sha256: validation.manifest.source_project_sha256,
    target_project_sha256: projectFingerprint(targetUrl),
    recovery_manifest_sha256: recoveryManifestHash,
    tables_verified: verifiedRows,
    database_files_verified: validation.database_files_verified,
    storage_objects_verified: validation.manifest.object_count,
    storage_bytes_verified: restoredBytes,
    camera_urls_verified: validation.camera_urls_verified,
    encrypted_recordings_verified: validation.encrypted_recordings_verified,
  };
  const defaultReport = path.join(
    path.dirname(bundle),
    `recovery-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const reportPath = path.resolve(reportFlag ? reportFlag.slice("--report=".length) : defaultReport);
  if (existsSync(reportPath)) throw new Error("Recovery report already exists; refusing to overwrite it");
  atomicWrite(reportPath, Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8"));
  console.log(
    `Full recovery passed: ${Object.keys(verifiedRows).length} table(s), ${validation.database_files_verified} DB file(s), ${validation.manifest.object_count} storage object(s), all decrypt checks valid.`,
  );
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
