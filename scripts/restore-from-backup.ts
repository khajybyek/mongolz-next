/**
 * Restore the JSON row dumps produced by /api/admin/backup (or /backup in
 * the app) into a Supabase project. Completes the documented RTO drill in
 * docs/RUNBOOK.md — this script did not exist before 2026-09-06.
 *
 *   unzip mongolz-backup-<ts>.zip -d ./restore
 *   npx tsx scripts/restore-from-backup.ts ./restore            # dry-run (default)
 *   npx tsx scripts/restore-from-backup.ts ./restore --apply    # upsert rows
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Notes
 *   • Tables are restored in FK order; rows are upserted by primary key, so
 *     re-running is idempotent.
 *   • audit_log is append-only with a hash chain: rows are inserted only when
 *     the table is EMPTY (a partial restore would break the chain).
 *   • Auth material and secrets are not in the backup by design
 *     (TOTP seeds, recovery codes, passkeys, webhook secrets) — users must
 *     re-enrol 2FA / passkeys and webhook secrets must be re-created.
 *   • Storage blobs are not restored here; recover them from the Supabase
 *     storage backup / PITR.
 */

import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

if (existsSync(".env.production.tmp")) loadEnv({ path: ".env.production.tmp" });
else if (existsSync(".env.local")) loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// FK order: parents first.
const ORDER = [
  "profiles",
  "cameras",
  "suspects",
  "recordings",
  "faces",
  "clusters",
  "alert_rules",
  "alerts",
  "reveal_jobs",
  "webhooks",
  "camera_permissions",
  "masking_schedules",
  "privacy_zones",
  "retention_policies",
  "push_subscriptions",
  "audit_log",
] as const;

const PK: Record<string, string> = { retention_policies: "resource" };

async function main() {
  const [dirArg, ...flags] = process.argv.slice(2);
  if (!dirArg) {
    console.error("Usage: tsx scripts/restore-from-backup.ts <backup-dir> [--apply]");
    process.exit(2);
  }
  const apply = flags.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const svc = createClient(url, key, { auth: { persistSession: false } });

  const tablesDir = path.join(dirArg, "tables");
  let total = 0;
  for (const table of ORDER) {
    const file = path.join(tablesDir, `${table}.json`);
    if (!existsSync(file)) {
      console.log(`  – ${table.padEnd(20)} (no file, skipped)`);
      continue;
    }
    const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`  – ${table.padEnd(20)} 0 rows`);
      continue;
    }

    if (table === "audit_log") {
      const { count } = await svc.from("audit_log").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) {
        console.log(`  ! audit_log            skipped — table not empty (${count} rows); the hash chain must not be spliced`);
        continue;
      }
      // Insert in id order so the chain trigger links rows the way they were.
      rows.sort((a, b) => Number(a.id) - Number(b.id));
    }

    console.log(`  ${apply ? "↑" : "·"} ${table.padEnd(20)} ${rows.length} rows${apply ? "" : " (dry-run)"}`);
    total += rows.length;
    if (!apply) continue;

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const q =
        table === "audit_log"
          ? svc.from("audit_log").insert(chunk as never)
          : svc.from(table).upsert(chunk as never, { onConflict: PK[table] ?? "id" });
      const { error } = await q;
      if (error) {
        console.error(`    ✗ ${table} batch ${i / 200 + 1}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
  console.log(`\n${apply ? "Restored" : "Would restore"} ${total} rows across ${ORDER.length} tables.`);
  if (!apply) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
