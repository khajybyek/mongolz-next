import { createHash } from "node:crypto";

type Report = {
  rows?: number;
  objects?: number;
  restorable?: boolean;
  truncated?: boolean;
  error?: string;
};
export type BackupManifest = {
  format?: string;
  complete?: boolean;
  include_biometrics?: boolean;
  tables?: Record<string, Report>;
  buckets?: Record<string, Report>;
  file_sha256?: Record<string, string>;
};

/** Reject missing/partial/corrupt exports before any restore write, even
 * with --skip-unrestorable. Hashes detect corruption, not authenticity. */
export function validateBackupIntegrity(
  manifest: BackupManifest | null,
  read: (relativePath: string) => Buffer,
): string[] {
  const errors: string[] = [];
  if (!manifest || !["mongolz-backup/2", "mongolz-backup/3"].includes(manifest.format ?? "")) {
    return ["A supported manifest is required; re-export this backup."];
  }
  if (manifest.complete === false) errors.push("Export is incomplete.");
  if (!manifest.tables || !Object.keys(manifest.tables).length || !manifest.buckets) {
    return [...errors, "Table or storage manifest is missing."];
  }
  const v3 = manifest.format === "mongolz-backup/3";
  if (v3 && manifest.complete !== true) errors.push("Export completeness was not verified.");
  for (const [kind, reports] of [["tables", manifest.tables], ["buckets", manifest.buckets]] as const) {
    for (const [name, report] of Object.entries(reports)) {
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) { errors.push("Invalid manifest entry name."); continue; }
      const file = `${kind}/${name}${kind === "tables" ? ".json" : ".manifest.json"}`;
      if (report.truncated || report.error) errors.push(`${file}: incomplete export.`);
      try {
        const bytes = read(file);
        const expectedHash = manifest.file_sha256?.[file];
        if ((v3 && !expectedHash) || (expectedHash && createHash("sha256").update(bytes).digest("hex") !== expectedHash)) {
          errors.push(`${file}: checksum missing or mismatched.`);
        }
        const content = JSON.parse(bytes.toString("utf8"));
        const rows = kind === "tables" ? content : content.objects;
        const expected = kind === "tables" ? report.rows : report.objects;
        if (!Number.isSafeInteger(expected) || expected! < 0 || !Array.isArray(rows) || rows.length !== expected) {
          errors.push(`${file}: exported count does not match manifest.`);
        }
        if (kind === "buckets" && (content.truncated || content.error || content.complete === false || content.total_objects !== expected)) {
          errors.push(`${file}: incomplete object list.`);
        }
      } catch {
        errors.push(`${file}: missing or invalid file.`);
      }
    }
  }
  return errors;
}
