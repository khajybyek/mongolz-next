/**
 * Restore the JSON row dumps produced by /api/admin/backup (or /backup in
 * the app) into a Supabase project. Completes the documented RTO drill in
 * docs/RUNBOOK.md §3.
 *
 *   unzip mongolz-backup-<ts>.zip -d ./restore
 *   npx tsx scripts/restore-from-backup.ts ./restore              # preflight + dry-run
 *   npx tsx scripts/restore-from-backup.ts ./restore --apply      # upsert rows
 *   npx tsx scripts/restore-from-backup.ts ./restore --apply --skip-unrestorable
 *   # Complete recovery uses --strict-manifest-skips as well: only tables the
 *   # signed recovery manifest predicted as unrestorable may be skipped.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Preflight (always runs first, before a single write)
 *   Every table file is checked against the NOT NULL columns that have no
 *   default. A dump produced without ?include_biometrics=1 has no
 *   suspects.embedding / faces.embedding, so those tables are reported as
 *   NOT RESTORABLE up front instead of dying on a NOT NULL violation halfway
 *   through the run. --apply refuses to start while any table is
 *   unrestorable; --skip-unrestorable restores everything else and says so.
 *
 * Notes
 *   • Tables are restored in FK order; rows are upserted by primary key, so
 *     re-running is idempotent.
 *   • audit_log is append-only with a hash chain: rows are inserted only when
 *     the table is EMPTY (a partial restore would break the chain).
 *   • auth.users is NOT in the backup. profiles.id is a FK onto it — recreate
 *     or re-invite the accounts (or restore the auth schema from PITR) BEFORE
 *     loading profiles, or every profile row is rejected.
 *   • Auth material and secrets are not in the backup by design (TOTP seeds,
 *     recovery codes, passkeys, webhook url + secret, push endpoints/keys) —
 *     users re-enrol 2FA, webhooks and push subscriptions are recreated.
 *   • Storage blobs are not restored here. For the complete two-part recovery
 *     flow use scripts/create-recovery-bundle.ts followed by
 *     scripts/restore-recovery-bundle.ts; it restores and verifies the bytes.
 */

import { validateBackupIntegrity, type BackupManifest } from "../lib/backup-integrity";
import { upgradeLegacyBackupRows } from "../lib/backup-tables";
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

if (existsSync(".env.production.tmp")) loadEnv({ path: ".env.production.tmp", quiet: true });
else if (existsSync(".env.local")) loadEnv({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";

// FK order: parents first.
const ORDER = [
  "profiles",
  "cameras",
  "suspects",
  "recordings",
  "recording_privacy_spans",
  "faces",
  "clusters",
  "alert_rules",
  "alerts",
  "reveal_jobs",
  "incidents",
  "incident_alerts",
  "incident_faces",
  "incident_events",
  "incident_recordings",
  "incident_evidence_exports",
  "face_search_presets",
  "edge_agents",
  "edge_ingest_events",
  "webhooks",
  "camera_permissions",
  "masking_schedules",
  "privacy_zones",
  "retention_policies",
  "push_subscriptions",
  "audit_log",
] as const;

/** Tables whose `id` is GENERATED ALWAYS AS IDENTITY — PostgREST cannot insert it. */
const IDENTITY_TABLES = new Set(["incident_events", "recording_privacy_spans"]);

const PK: Record<string, string> = {
  retention_policies: "resource",
  // The identity id is regenerated; the pipeline's idempotency key is stable.
  recording_privacy_spans: "client_span_id",
  incident_alerts: "incident_id,alert_id",
  incident_faces: "incident_id,face_id",
};

/**
 * NOT NULL columns with no database default — a row missing any of these is
 * rejected by Postgres. Mirrors the live schema (information_schema.columns
 * where is_nullable='NO' and column_default is null).
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  profiles: ["id", "email"],
  face_search_presets: ["user_id", "name"],
  cameras: ["name", "url"],
  suspects: ["name", "image_path", "embedding"],
  recordings: ["filename", "storage_path"],
  recording_privacy_spans: ["recording_id", "start_offset_sec"],
  faces: ["filename", "image_path", "embedding"],
  clusters: ["cluster_id", "face_id"],
  alert_rules: ["name"],
  alerts: ["suspect_name", "similarity"],
  reveal_jobs: ["recording_id", "method"],
  incidents: ["title"],
  incident_alerts: ["incident_id", "alert_id"],
  incident_faces: ["incident_id", "face_id"],
  incident_events: ["incident_id", "event_type"],
  incident_recordings: ["incident_id", "recording_filename", "recording_started_at", "clip_start_sec", "clip_end_sec"],
  incident_evidence_exports: ["incident_id", "manifest_sha256", "file_count", "package_bytes"],
  edge_agents: ["id", "name", "camera_id", "version"],
  edge_ingest_events: ["id", "agent_id", "camera_id", "captured_at", "payload_sha256", "face_count"],
  webhooks: ["name", "kind", "url"],
  camera_permissions: ["user_id", "camera_id"],
  masking_schedules: ["camera_id", "starts_at", "ends_at", "window_mode"],
  privacy_zones: ["camera_id", "name", "x", "y", "w", "h"],
  retention_policies: ["resource", "retention_days"],
  push_subscriptions: ["user_id", "endpoint", "p256dh", "auth"],
  audit_log: ["action"],
};

/** Why a column is absent, so the message names the fix rather than the symptom. */
const BIOMETRIC_HINT =
  "biometric column — re-export with the 'Include biometric embeddings' box ticked (?include_biometrics=1)";
const PUSH_HINT = "push credential — never exported; users re-subscribe from their browser";
const MISSING_HINT: Record<string, string> = {
  "suspects.embedding": BIOMETRIC_HINT,
  "faces.embedding": BIOMETRIC_HINT,
  "webhooks.url":
    "credential — the Slack/Discord URL and the HMAC secret are never exported; recreate the destination on /webhooks",
  "cameras.url":
    "AES-GCM ciphertext — exported only by format mongolz-backup/2 or newer; re-export from a current build",
  "push_subscriptions.endpoint": PUSH_HINT,
  "push_subscriptions.p256dh": PUSH_HINT,
  "push_subscriptions.auth": PUSH_HINT,
};

type Row = Record<string, unknown>;
type Plan = {
  table: string;
  rows: Row[];
  missing: string[];
  present: boolean;
};

function readTable(tablesDir: string, table: string): { rows: Row[]; present: boolean } {
  const file = path.join(tablesDir, `${table}.json`);
  if (!existsSync(file)) return { rows: [], present: false };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${table}.json is not a JSON array`);
  return { rows: parsed as Row[], present: true };
}

/**
 * A column counts as present when the dump actually carries it. An empty
 * table cannot be checked (and needs no writes), so it never blocks a
 * restore. `null` in a required column is a real defect and is reported.
 */
function missingRequired(table: string, rows: Row[]): string[] {
  const required = [...(REQUIRED_COLUMNS[table] ?? [])];
  if (table === "reveal_jobs" && rows.some((r) => r.method === "upload" && r.status === "pending_approval" && r.request_scope != null)) {
    required.push("reference_sealed");
  }
  if (rows.length === 0) return [];
  const sample = rows[0];
  return required.filter(
    (col) => !(col in sample) || rows.some((r) => r[col] === null || r[col] === undefined),
  );
}

function readManifest(dir: string): Record<string, unknown> | null {
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const [dirArg, ...flags] = process.argv.slice(2);
  if (!dirArg) {
    console.error(
      "Usage: tsx scripts/restore-from-backup.ts <backup-dir> [--apply] [--skip-unrestorable] [--strict-manifest-skips]",
    );
    process.exit(2);
  }
  const apply = flags.includes("--apply");
  const skipUnrestorable = flags.includes("--skip-unrestorable");
  const strictManifestSkips = flags.includes("--strict-manifest-skips");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const svc = createClient(url, key, { auth: { persistSession: false } });

  const tablesDir = path.join(dirArg, "tables");
  if (!existsSync(tablesDir)) throw new Error(`No tables/ directory under ${dirArg}`);

  const manifest = readManifest(dirArg);
  const integrityErrors = validateBackupIntegrity(manifest as BackupManifest | null,
    (relative) => readFileSync(path.join(dirArg, relative)));
  if (integrityErrors.length) throw new Error(`Backup integrity preflight failed before any write:\n${integrityErrors.join("\n")}`);
  // A table this tool does not know would be silently left out, and the
  // complete-recovery verifier would then fail on its row count after the
  // writes. Refuse up front instead.
  const unknownTables = Object.keys(
    manifest?.tables && typeof manifest.tables === "object" ? manifest.tables : {},
  ).filter((t) => !(ORDER as readonly string[]).includes(t));
  if (unknownTables.length) {
    throw new Error(
      `Backup contains table(s) this restore tool does not know: ${unknownTables.join(", ")}. Update scripts/restore-from-backup.ts (ORDER) before restoring. Nothing was changed.`,
    );
  }
  const includeBiometrics = manifest?.include_biometrics === true;
  console.log(`Backup: ${path.resolve(dirArg)}`);
  console.log(
    `Manifest: ${manifest ? `${String(manifest.format ?? "unknown")} (biometrics ${includeBiometrics ? "included" : "excluded"})` : "absent — older dump, checking the rows themselves"}`,
  );

  // ── Preflight: read + check every table before writing anything ──
  const plans: Plan[] = [];
  for (const table of ORDER) {
    const read = readTable(tablesDir, table);
    // Older artifacts carry the pre-ADR-0012 privacy columns; map them first.
    const rows = upgradeLegacyBackupRows(table, read.rows);
    plans.push({ table, rows, present: read.present, missing: missingRequired(table, rows) });
  }

  console.log("\nPreflight");
  for (const p of plans) {
    if (!p.present) {
      console.log(`  – ${p.table.padEnd(20)} (no file in the dump)`);
      continue;
    }
    if (p.missing.length === 0) {
      console.log(`  ✓ ${p.table.padEnd(20)} ${String(p.rows.length).padStart(6)} rows`);
      continue;
    }
    const hints = p.missing
      .map((c) => {
        const hint = MISSING_HINT[`${p.table}.${c}`];
        return hint ? `${c} (${hint})` : c;
      })
      .join("; ");
    console.log(
      `  ✗ ${p.table.padEnd(20)} ${String(p.rows.length).padStart(6)} rows — NOT RESTORABLE, required column missing or null: ${hints}`,
    );
  }

  const blocked = plans.filter((p) => p.present && p.missing.length > 0);
  const manifestTables = manifest?.tables && typeof manifest.tables === "object"
    ? manifest.tables as Record<string, { restorable?: boolean }>
    : {};
  const unexpectedBlocked = blocked.filter((p) => manifestTables[p.table]?.restorable !== false);
  if (blocked.length > 0) {
    console.log(
      `\n${blocked.length} table(s) cannot be restored from this artifact: ${blocked
        .map((p) => p.table)
        .join(", ")}.`,
    );
    console.log(
      "Postgres would reject those rows with a NOT NULL violation. Fix the export (see the hints above) or re-run with --skip-unrestorable to load everything else.",
    );
    if (strictManifestSkips && unexpectedBlocked.length > 0) {
      console.error(
        `\nStrict restore refuses unplanned skips: ${unexpectedBlocked.map((p) => p.table).join(", ")}. Nothing was changed.`,
      );
      process.exit(3);
    }
    if (apply && !skipUnrestorable) {
      console.error("\nAborting before any write. Nothing was changed.");
      process.exit(3);
    }
  }

  // ── Apply ──
  const restored: Record<string, number> = {};
  const skipped: { table: string; reason: string }[] = [];

  /**
   * Foreign-key parents. A default export omits suspects and faces (their
   * embedding columns are opt-in), and every child row would then fail its FK
   * — noisily, one batch at a time. Skip the children up front and say why.
   */
  const FK_PARENTS: Record<string, string[]> = {
    faces: ["recordings"],
    recording_privacy_spans: ["recordings"],
    clusters: ["faces"],
    alerts: ["suspects", "faces"],
    reveal_jobs: ["recordings", "suspects", "faces"],
    incident_alerts: ["incidents", "alerts"],
    incident_faces: ["incidents", "faces"],
    incident_events: ["incidents"],
    incident_recordings: ["incidents", "recordings"],
    incident_evidence_exports: ["incidents"],
    face_search_presets: ["suspects", "incidents"],
    edge_agents: ["cameras"],
    edge_ingest_events: ["edge_agents", "cameras"],
  };
  const unavailable = new Set(
    plans.filter((p) => !p.present || p.missing.length > 0).map((p) => p.table),
  );
  let total = 0;
  let failedBatches = 0;

  console.log(`\n${apply ? "Restoring" : "Dry run"}`);
  for (const p of plans) {
    if (!p.present) {
      skipped.push({ table: p.table, reason: "no file in the dump" });
      continue;
    }
    if (p.missing.length > 0) {
      skipped.push({ table: p.table, reason: `missing required column(s): ${p.missing.join(", ")}` });
      continue;
    }
    const blockedBy = (FK_PARENTS[p.table] ?? []).filter((parent) => unavailable.has(parent));
    if (blockedBy.length > 0) {
      unavailable.add(p.table);
      skipped.push({
        table: p.table,
        reason: `blocked: parent table(s) not restorable — ${blockedBy.join(", ")}`,
      });
      continue;
    }
    if (p.rows.length === 0) {
      restored[p.table] = 0;
      continue;
    }

    // incident_events.id and recording_privacy_spans.id are GENERATED ALWAYS
    // and have no inbound references. Let PostgreSQL assign fresh IDs while
    // preserving the rows themselves.
    const rows = IDENTITY_TABLES.has(p.table)
      ? p.rows.map(({ id: _identity, ...row }) => row)
      : [...p.rows];
    if (p.table === "audit_log") {
      const { count } = await svc.from("audit_log").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) {
        skipped.push({
          table: "audit_log",
          reason: `table not empty (${count} rows); the hash chain must not be spliced`,
        });
        continue;
      }
      // Insert in id order so the chain trigger links rows the way they were.
      rows.sort((a, b) => Number(a.id) - Number(b.id));
    }

    console.log(
      `  ${apply ? "↑" : "·"} ${p.table.padEnd(20)} ${String(rows.length).padStart(6)} rows${apply ? "" : " (dry-run)"}`,
    );
    if (!apply) {
      total += rows.length;
      restored[p.table] = rows.length;
      continue;
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const q =
        p.table === "audit_log"
          ? svc.from("audit_log").insert(chunk as never)
          : svc.from(p.table).upsert(chunk as never, { onConflict: PK[p.table] ?? "id" });
      const { error } = await q;
      if (error) {
        console.error(`    ✗ ${p.table} batch ${i / 200 + 1}: ${error.message}`);
        process.exitCode = 1;
        failedBatches += 1;
        continue;
      }
      written += chunk.length;
    }
    // Count what Postgres accepted, never what we planned to send: a drill
    // where the auth users were not recreated first fails every FK batch, and
    // the old summary still reported the planned total as "Restored".
    total += written;
    restored[p.table] = written;
  }

  // ── Report ──
  console.log("\nPer-table result");
  for (const p of plans) {
    const n = restored[p.table];
    if (n === undefined) continue;
    console.log(`  ${p.table.padEnd(20)} ${String(n).padStart(6)} ${apply ? "rows written" : "rows would be written"}`);
  }
  if (skipped.length > 0) {
    console.log("\nSkipped");
    for (const s of skipped) console.log(`  ${s.table.padEnd(20)} ${s.reason}`);
  }

  const bucketsDir = path.join(dirArg, "buckets");
  if (existsSync(bucketsDir)) {
    console.log(
      "\nStorage: this row-only command does not restore blob bytes. Use recovery:restore for the complete encrypted bundle and verified object restore.",
    );
  }
  console.log(
    "Auth: Supabase auth.users is not in this artifact — profiles rows need their auth accounts to exist first, and every operator re-enrols TOTP/passkeys.",
  );
  const failureNote =
    failedBatches > 0 ? ` — ${failedBatches} batch(es) failed, see the ✗ lines above` : "";
  console.log(
    `\n${apply ? "Restored" : "Would restore"} ${total} rows across ${plans.length - skipped.length} table(s)${failureNote}.`,
  );
  if (!apply) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
