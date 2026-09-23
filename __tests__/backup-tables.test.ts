/**
 * Drift guard for the admin backup. Every public table and column in the
 * generated schema must be either exported by /api/admin/backup or excluded
 * with a written reason (lib/backup-tables.ts). Before this test the SCH
 * tournament tables, face_search_presets and two new faces columns were
 * silently missing from a manifest that said `complete: true`.
 *
 * It also holds scripts/restore-from-backup.ts to the same list: a table the
 * backup exports but the restore tool does not know is dropped on restore,
 * and the complete-recovery verifier then fails on its row count.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_EXCLUDED_COLUMNS,
  BACKUP_NOT_EXPORTED,
  BACKUP_STORAGE_SOURCES,
  BACKUP_TABLES,
} from "@/lib/backup-tables";

const ROOT = path.join(__dirname, "..");

/** table → Row column names, parsed from lib/database.generated.ts (public schema). */
function generatedTables(): Map<string, string[]> {
  const src = readFileSync(path.join(ROOT, "lib/database.generated.ts"), "utf8");
  const start = src.indexOf("  public: {\n    Tables: {");
  const end = src.indexOf("    Views: {", start);
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, end);
  const out = new Map<string, string[]>();
  const re = /\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    out.set(m[1], [...m[2].matchAll(/\n {10}(\w+)\??:/g)].map((c) => c[1]));
  }
  return out;
}

const split = (list?: string) =>
  (list ?? "").split(",").map((c) => c.trim()).filter(Boolean);

describe("backup table coverage", () => {
  const schema = generatedTables();

  it("parses the generated schema", () => {
    expect(schema.size).toBeGreaterThan(30);
    expect(schema.get("sch_registrations")).toContain("receipt_path");
  });

  it("exports or explicitly excludes every public table", () => {
    const unaccounted = [...schema.keys()].filter(
      (t) => !(t in BACKUP_TABLES) && !(t in BACKUP_NOT_EXPORTED),
    );
    expect(unaccounted).toEqual([]);
    const both = Object.keys(BACKUP_TABLES).filter((t) => t in BACKUP_NOT_EXPORTED);
    expect(both).toEqual([]);
    for (const reason of Object.values(BACKUP_NOT_EXPORTED)) expect(reason.length).toBeGreaterThan(10);
  });

  it("names only tables that exist", () => {
    for (const t of [...Object.keys(BACKUP_TABLES), ...Object.keys(BACKUP_NOT_EXPORTED)]) {
      expect(schema.has(t) ? t : `${t} (not in schema)`).toBe(t);
    }
  });

  it("covers every column of an explicit allow-list, or says why not", () => {
    const problems: string[] = [];
    for (const [table, spec] of Object.entries(BACKUP_TABLES)) {
      if (spec.columns === "*") continue;
      const cols = schema.get(table) ?? [];
      const listed = new Set([...split(spec.columns), ...split(spec.biometric)]);
      const excluded = BACKUP_EXCLUDED_COLUMNS[table] ?? {};
      for (const c of cols) {
        if (!listed.has(c) && !(c in excluded)) problems.push(`${table}.${c} is neither exported nor excluded`);
      }
      for (const c of listed) {
        if (!cols.includes(c)) problems.push(`${table}.${c} is listed but not in the schema`);
        if (c in excluded) problems.push(`${table}.${c} is both exported and excluded`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("derives every storage manifest from an exported table", () => {
    for (const sources of Object.values(BACKUP_STORAGE_SOURCES)) {
      for (const s of sources) expect(Object.keys(BACKUP_TABLES)).toContain(s.table);
    }
    expect(Object.keys(BACKUP_STORAGE_SOURCES)).toContain("sch-receipts");
  });
});

describe("restore tool knows every exported table", () => {
  const src = readFileSync(path.join(ROOT, "scripts/restore-from-backup.ts"), "utf8");
  const orderBlock = src.slice(src.indexOf("const ORDER = ["), src.indexOf("] as const;"));
  const order = [...orderBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  it("restores every exported table", () => {
    expect(Object.keys(BACKUP_TABLES).filter((t) => !order.includes(t))).toEqual([]);
  });

  it("loads FK parents before their children", () => {
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before("profiles", "sch_event");
    before("sch_teams", "sch_registrations"); // sch_registrations.team_id → sch_teams
    before("incidents", "face_search_presets");
    before("suspects", "face_search_presets");
    before("cameras", "face_search_presets");
  });
});
