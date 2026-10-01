/**
 * Drift guard for the admin backup. Every public table and column in the
 * generated schema must be either exported by /api/admin/backup or excluded
 * with a written reason (lib/backup-tables.ts). Before this test whole
 * tables, face_search_presets and two new faces columns were silently
 * missing from a manifest that said `complete: true`.
 *
 * It also holds scripts/restore-from-backup.ts to the same list: a table the
 * backup exports but the restore tool does not know is dropped on restore,
 * and the complete-recovery verifier then fails on its row count.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_EXCLUDED_COLUMNS,
  BACKUP_NOT_EXPORTED,
  BACKUP_STORAGE_SOURCES,
  BACKUP_TABLES,
  upgradeLegacyBackupRows,
} from "@/lib/backup-tables";

const ROOT = path.join(__dirname, "..");

/**
 * Public tables whose most recent migration statement is a DROP. The
 * generated types are regenerated only after a migration is applied, so for
 * a while they can still list a table the repository has already dropped;
 * such a table is neither backed up nor restored.
 */
function droppedTables(): Set<string> {
  const dir = path.join(ROOT, "supabase/migrations");
  const last = new Map<string, "create" | "drop">();
  const re = /\b(create|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?(?:public\.)?"?(\w+)"?/gi;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(re)) last.set(m[2].toLowerCase(), m[1].toLowerCase() as "create" | "drop");
  }
  return new Set([...last].filter(([, action]) => action === "drop").map(([t]) => t));
}

/** table → Row column names, parsed from lib/database.generated.ts (public schema). */
function generatedTables(): Map<string, string[]> {
  const src = readFileSync(path.join(ROOT, "lib/database.generated.ts"), "utf8");
  const start = src.indexOf("  public: {\n    Tables: {");
  const end = src.indexOf("    Views: {", start);
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, end);
  const out = new Map<string, string[]>();
  const dropped = droppedTables();
  const re = /\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    if (dropped.has(m[1])) continue;
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
    expect(schema.get("faces")).toContain("image_path");
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
    expect(Object.keys(BACKUP_STORAGE_SOURCES)).toContain("faces");
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
    before("recordings", "faces");
    before("incidents", "face_search_presets");
    before("suspects", "face_search_presets");
    before("cameras", "face_search_presets");
  });
});

describe("older backups stay restorable after ADR 0012", () => {
  it("drops cameras.mask_default and keeps every other column", () => {
    const rows = upgradeLegacyBackupRows("cameras", [
      { id: "c1", name: "Gate", mask_default: "masked" },
      { id: "c2", name: "Lobby", privacy_default: "private" },
    ]);
    expect(rows).toEqual([
      { id: "c1", name: "Gate" },
      { id: "c2", name: "Lobby", privacy_default: "private" },
    ]);
  });

  it("maps the retired window modes the way the migration did", () => {
    const rows = upgradeLegacyBackupRows("masking_schedules", [
      { id: "w1", window_mode: "masked" },
      { id: "w2", window_mode: "revealed" },
      { id: "w3", window_mode: "private" },
      { id: "w4", window_mode: "standard" },
    ]);
    expect(rows.map((r) => r.window_mode)).toEqual(["private", "standard", "private", "standard"]);
  });

  it("leaves unrelated tables untouched", () => {
    const rows = [{ id: "a1", mask_default: "masked", window_mode: "revealed", recording_mode: "standard" }];
    expect(upgradeLegacyBackupRows("alerts", rows)).toBe(rows);
  });
});

describe("backups taken while the face-encrypted mode existed stay restorable", () => {
  // 20260930100000 added cameras.recording_mode and recordings.face_envelope_path;
  // 20261001100000 dropped both. PostgREST rejects a whole upsert batch that
  // names a column that no longer exists (PGRST204).
  it("drops cameras.recording_mode together with mask_default", () => {
    const rows = upgradeLegacyBackupRows("cameras", [
      { id: "c1", name: "Gate", privacy_default: "standard", recording_mode: "standard" },
      { id: "c2", name: "Lobby", mask_default: "masked", recording_mode: "face_encrypted" },
      { id: "c3", name: "Yard", privacy_default: "private" },
    ]);
    expect(rows).toEqual([
      { id: "c1", name: "Gate", privacy_default: "standard" },
      { id: "c2", name: "Lobby" },
      { id: "c3", name: "Yard", privacy_default: "private" },
    ]);
  });

  it("drops a null recordings.face_envelope_path and keeps every other column", () => {
    const rows = upgradeLegacyBackupRows("recordings", [
      { id: "r1", blur_strategy: "on_demand", original_path: "a_original.mp4.enc", face_envelope_path: null },
      { id: "r2", blur_strategy: "baked", storage_path: "b.mp4" },
    ]);
    expect(rows).toEqual([
      { id: "r1", blur_strategy: "on_demand", original_path: "a_original.mp4.enc" },
      { id: "r2", blur_strategy: "baked", storage_path: "b.mp4" },
    ]);
    for (const r of rows) expect(r).not.toHaveProperty("face_envelope_path");
  });

  it("refuses a face_encrypted recording with a message that names it", () => {
    expect(() =>
      upgradeLegacyBackupRows("recordings", [
        { id: "r1", blur_strategy: "on_demand", face_envelope_path: null },
        { id: "r9", blur_strategy: "face_encrypted", face_envelope_path: null },
      ]),
    ).toThrow(/1 face-encrypted recording\(s\) \(r9\).*20261001100000.*Nothing was changed/);
  });

  it("refuses a recording that still names a face envelope", () => {
    expect(() =>
      upgradeLegacyBackupRows("recordings", [
        { id: "r5", blur_strategy: "on_demand", face_envelope_path: "cam/x_faces.env" },
      ]),
    ).toThrow(/face-encrypted recording\(s\) \(r5\)/);
  });

  it("names at most five refused recordings", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, blur_strategy: "face_encrypted" }));
    expect(() => upgradeLegacyBackupRows("recordings", rows)).toThrow(
      /7 face-encrypted recording\(s\) \(r0, r1, r2, r3, r4 and 2 more\)/,
    );
  });
});
