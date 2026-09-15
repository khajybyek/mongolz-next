/**
 * Build the complete, offline half of disaster recovery from a biometric DB
 * export. Storage bytes are downloaded, independently sealed and checksummed;
 * the data key and application decrypt keys are written to a separate,
 * passphrase-protected escrow file.
 */
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { validateBackupIntegrity, type BackupManifest } from "../lib/backup-integrity";
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
  validateApplicationKeys,
  type RecoveryApplicationKeys,
  type RecoveryDatabaseFile,
  type RecoveryManifest,
  type UnsignedRecoveryManifest,
  type RecoveryObject,
} from "../lib/recovery-bundle";

for (const file of [".env.production.tmp", ".env.local", "ml-service/.env.railway"]) {
  if (existsSync(file)) loadEnv({ path: file, quiet: true });
}

type StorageEntry = { path: string; row_id: string };
type BucketFile = { bucket: string; complete?: boolean; objects: StorageEntry[] };

function usage(): never {
  console.error(
    "Usage: npm run recovery:create -- <unpacked-biometric-backup> <bundle-dir> --key-escrow=<separate-file>",
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

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const [sourceArg, bundleArg, ...flags] = process.argv.slice(2);
  const escrowFlag = flags.find((flag) => flag.startsWith("--key-escrow="));
  if (!sourceArg || !bundleArg || !escrowFlag) usage();

  const source = path.resolve(sourceArg);
  const bundle = path.resolve(bundleArg);
  const escrowPath = path.resolve(escrowFlag.slice("--key-escrow=".length));
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error("Backup directory does not exist");
  if (existsSync(bundle)) throw new Error("Bundle directory already exists; choose a new directory");
  if (existsSync(escrowPath)) throw new Error("Key escrow file already exists; refusing to overwrite it");
  if (escrowPath === bundle || escrowPath.startsWith(bundle + path.sep)) {
    throw new Error("Key escrow must be stored outside the recovery bundle");
  }

  const databaseManifestBytes = readFileSync(path.join(source, "manifest.json"));
  const databaseManifest = JSON.parse(databaseManifestBytes.toString("utf8")) as BackupManifest;
  const integrityErrors = validateBackupIntegrity(
    databaseManifest,
    (relative) => readFileSync(path.join(source, relative)),
  );
  if (integrityErrors.length) throw new Error(`Database backup is not complete: ${integrityErrors.join("; ")}`);
  if (databaseManifest.format !== "mongolz-backup/3" || databaseManifest.complete !== true) {
    throw new Error("A complete mongolz-backup/3 export is required");
  }
  if (databaseManifest.include_biometrics !== true) {
    throw new Error("Full recovery requires an export made with biometric embeddings included");
  }

  const sourceUrl = requireEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const passphrase = requireEnvironment("RECOVERY_ESCROW_PASSPHRASE");
  if (passphrase.length < 16) throw new Error("RECOVERY_ESCROW_PASSPHRASE must be at least 16 characters");
  const applicationKeys: RecoveryApplicationKeys = {
    CAMERA_URL_KEY: requireEnvironment("CAMERA_URL_KEY"),
    ...(process.env.CAMERA_URL_KEY_PREV?.trim()
      ? { CAMERA_URL_KEY_PREV: process.env.CAMERA_URL_KEY_PREV.trim() }
      : {}),
    ML_ENCRYPTION_KEY: requireEnvironment("ML_ENCRYPTION_KEY"),
    ...(process.env.ML_ENCRYPTION_KEY_PREV?.trim()
      ? { ML_ENCRYPTION_KEY_PREV: process.env.ML_ENCRYPTION_KEY_PREV.trim() }
      : {}),
  };
  validateApplicationKeys(applicationKeys);

  const svc = createClient(sourceUrl, serviceKey, { auth: { persistSession: false } });
  const dataKey = randomBytes(32);
  let escrowCreated = false;
  mkdirSync(bundle, { recursive: false, mode: 0o700 });
  try {
    const databasePaths = [
      "manifest.json",
      ...(existsSync(path.join(source, "README.txt")) ? ["README.txt"] : []),
      ...Object.keys(databaseManifest.tables ?? {}).map((name) => `tables/${name}.json`),
      ...Object.keys(databaseManifest.buckets ?? {}).map((name) => `buckets/${name}.manifest.json`),
    ];
    const recoveryDatabaseFiles: RecoveryDatabaseFile[] = [];
    for (const relative of databasePaths) {
      const sourceBody = readFileSync(path.join(source, relative));
      const sealed = sealRecoveryDatabaseFile(sourceBody, dataKey, relative);
      const file = recoveryDatabaseRelative(relative);
      atomicWrite(path.join(bundle, file), sealed);
      recoveryDatabaseFiles.push({
        path: relative,
        file,
        source_bytes: sourceBody.length,
        source_sha256: sha256(sourceBody),
        sealed_bytes: sealed.length,
        sealed_sha256: sha256(sealed),
      });
    }

    const recoveryObjects: RecoveryObject[] = [];
    const unique = new Set<string>();
    for (const bucket of Object.keys(databaseManifest.buckets ?? {}).sort()) {
      const parsed = JSON.parse(
        readFileSync(path.join(source, "buckets", `${bucket}.manifest.json`), "utf8"),
      ) as BucketFile;
      if (parsed.bucket !== bucket || parsed.complete !== true || !Array.isArray(parsed.objects)) {
        throw new Error(`Storage manifest for ${bucket} is incomplete`);
      }
      for (const entry of parsed.objects) {
        if (typeof entry.path !== "string" || typeof entry.row_id !== "string") {
          throw new Error(`Storage manifest for ${bucket} has an invalid object`);
        }
        const id = `${bucket}\0${entry.path}`;
        if (unique.has(id)) throw new Error(`Storage manifest for ${bucket} contains a duplicate path`);
        unique.add(id);
        const { data, error } = await svc.storage.from(bucket).download(entry.path);
        if (error || !data) throw new Error(`Could not mirror object ${recoveryObjects.length + 1}: ${error?.message ?? "missing data"}`);
        const sourceBody = Buffer.from(await data.arrayBuffer());
        const sealed = sealRecoveryObject(sourceBody, dataKey, bucket, entry.path);
        const relative = recoveryObjectRelative(bucket, entry.path);
        atomicWrite(path.join(bundle, relative), sealed);
        recoveryObjects.push({
          bucket,
          object_path: entry.path,
          row_id: entry.row_id,
          file: relative,
          source_bytes: sourceBody.length,
          source_sha256: sha256(sourceBody),
          sealed_bytes: sealed.length,
          sealed_sha256: sha256(sealed),
        });
      }
    }

    const escrow = createKeyEscrow(applicationKeys, dataKey, passphrase);
    atomicWrite(escrowPath, escrow);
    escrowCreated = true;
    const unsignedManifest: UnsignedRecoveryManifest = {
      format: RECOVERY_FORMAT,
      complete: true,
      full_restore: true,
      created_at: new Date().toISOString(),
      source_project_sha256: projectFingerprint(sourceUrl),
      database_manifest_sha256: sha256(databaseManifestBytes),
      database_file_count: recoveryDatabaseFiles.length,
      database_source_bytes: recoveryDatabaseFiles.reduce((sum, item) => sum + item.source_bytes, 0),
      database_sealed_bytes: recoveryDatabaseFiles.reduce((sum, item) => sum + item.sealed_bytes, 0),
      database_files: recoveryDatabaseFiles,
      key_escrow_sha256: sha256(escrow),
      object_count: recoveryObjects.length,
      source_bytes: recoveryObjects.reduce((sum, item) => sum + item.source_bytes, 0),
      sealed_bytes: recoveryObjects.reduce((sum, item) => sum + item.sealed_bytes, 0),
      objects: recoveryObjects,
    };
    const recoveryManifest: RecoveryManifest = {
      ...unsignedManifest,
      manifest_hmac_sha256: recoveryManifestHmac(unsignedManifest, dataKey),
    };
    atomicWrite(
      path.join(bundle, "recovery-manifest.json"),
      Buffer.from(JSON.stringify(recoveryManifest, null, 2) + "\n", "utf8"),
    );
    console.log(
      `Recovery bundle complete: ${recoveryDatabaseFiles.length} DB file(s) and ${recoveryObjects.length} storage object(s) sealed and verified for restore.`,
    );
    console.log("Key escrow created separately. Store the bundle, escrow and passphrase in separate locations.");
  } catch (error) {
    rmSync(bundle, { recursive: true, force: true });
    if (escrowCreated) rmSync(escrowPath, { force: true });
    throw error;
  } finally {
    dataKey.fill(0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
