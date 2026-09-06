#!/usr/bin/env node
/**
 * Forward-only migration safety lint.
 *
 * The rule: a migration file must be additive or guarded. Anything that
 * could break a running app (DROP COLUMN, DROP TABLE, NOT NULL on an
 * existing column without a default) needs an inline `-- safety:` waiver
 * comment explaining the rollout plan. Fail with non-zero exit so CI
 * blocks the PR otherwise.
 *
 * This is a *first-line* check — it's regex-based and dumb on purpose
 * (a real shop would use Reshape/Squawk). It catches the 80% of
 * obvious foot-guns.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "..", "supabase", "migrations");

const PATTERNS = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "DROP CONSTRAINT", re: /\bDROP\s+CONSTRAINT\b/i },
  { name: "ALTER COLUMN ... SET NOT NULL (no default)", re: /\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b(?!.*\bDEFAULT\b)/is },
  { name: "TYPE ... USING (data conversion)", re: /\bALTER\s+COLUMN\b[^;]*\bUSING\b/is },
  { name: "RENAME COLUMN", re: /\bRENAME\s+COLUMN\b/i },
  { name: "RENAME TABLE / ALTER TABLE ... RENAME TO", re: /\bRENAME\s+TO\b/i },
];

const WAIVER_RE = /--\s*safety:\s*ok\b/i;

// Only real migration files (NNNNNNNNNNNNNN_name.sql) — iCloud's "x 2.sql"
// duplicates and editor scratch files must not be linted or counted.
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d{14}_[^ ]+\.sql$/.test(f))
  .sort();

/** Strip `-- …` line comments so commented-out SQL cannot trip a pattern. */
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

let problems = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(migrationsDir, f), "utf8");
  const hasWaiver = WAIVER_RE.test(raw);
  const body = stripComments(raw);
  for (const p of PATTERNS) {
    if (p.re.test(body) && !hasWaiver) {
      const line = body.split("\n").findIndex((l) => p.re.test(l)) + 1 || 1;
      console.error(
        `[31m✗[0m ${f}:${line} — unsafe statement (${p.name}). Add a "-- safety: ok — <plan>" comment to waive.`,
      );
      problems++;
    }
  }
}

if (problems > 0) {
  console.error(`\nFound ${problems} unsafe statement(s) without a safety waiver.`);
  console.error("Forward-only migrations must either:");
  console.error("  (a) be additive (CREATE / ADD COLUMN ... DEFAULT ... / CREATE INDEX CONCURRENTLY),");
  console.error("  (b) ship behind a three-phase deploy (double-write → cut over → drop), or");
  console.error("  (c) document the rollout plan with an inline '-- safety: ok — ...' comment.");
  process.exit(1);
}

console.log(`✓ ${files.length} migration file(s) clean`);
