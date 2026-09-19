/**
 * Sheet import server actions — app/(app)/sch/admin/import-actions.ts.
 *
 * The action code, the parser (lib/sch/import.ts) and the id derivation run
 * for real; only module boundaries are faked, the way
 * sch-admin-actions.test.ts does it: `requireSchOrganiser` (driven by the
 * REAL role rule in lib/sch/access.ts and a configurable profile),
 * `next/cache` + `next/headers`, and both Supabase clients. The Supabase fake
 * records every `from(table).<op>` call and models the two unique indexes the
 * import leans on — (game, lower(email)) and (submission_id, game) — with the
 * atomic multi-row insert PostgREST performs (one clash rejects the batch,
 * code 23505).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { schOrganiserVerdict } from "@/lib/sch/access";
import { guessMapping, parseDelimited } from "@/lib/sch/import";
import { IMPORT_MAX_COLS, IMPORT_MAX_ROWS, type ImportMapping } from "@/lib/sch/import-types";
import { UUID_V4_RE } from "@/lib/sch/schema";

/* ───────────────────────── fixtures ───────────────────────── */

const ORGANISER = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const ORGANISER_EMAIL = "organiser@sch.test";

const MAPPING: ImportMapping = [
  "timestamp", "full_name", "email", "facebook", "phone", "game",
  "ml_rank", "ml_roles", "ml_id",
  "cs2_premier", "cs2_steam", "cs2_faceit",
  "dota_roles", "dota_rank", "dota_steam",
  "receipt",
];
const HEADER = MAPPING.map((f) => f.toUpperCase());

type Person = { n: number; email?: string; ts?: string; facebook?: string; phone?: string; receipt?: string };
const base = (p: Person, game: string) => [
  p.ts ?? `9/17/2026 10:00:${String(p.n % 60).padStart(2, "0")}`,
  `Тоглогч ${p.n}`,
  p.email ?? `player${p.n}@example.test`,
  p.facebook ?? `fb.com/player${p.n}`,
  p.phone ?? "+82-10-5555-0000",
  game,
];
const receiptOf = (p: Person) => p.receipt ?? `https://drive.google.com/open?id=r${p.n}`;
const ml = (p: Person) => [...base(p, "Mobile Legends"), "Mythic (Mythical Honor)", "Gold Lane, Jungle", `ml-${p.n}`, "", "", "", "", "", "", receiptOf(p)];
const cs2 = (p: Person, steam = `https://steamcommunity.com/id/p${p.n}`) =>
  [...base(p, "CS2"), "", "", "", "15000", steam, "Байгаа", "", "", "", receiptOf(p)];
const dota = (p: Person) =>
  [...base(p, "Dota 2"), "", "", "", "", "", "", "Position 1 (Carry)", "Legend 3", `https://steamcommunity.com/id/d${p.n}`, receiptOf(p)];
/** One response naming two games: a valid ML section and a CS2 section with the given Steam cell. */
const mlAndCs2 = (p: Person, steam: string) =>
  [...base(p, "Mobile Legends, CS2"), "Epic II", "Roamer", `ml-${p.n}`, "", steam, "yes", "", "", "", receiptOf(p)];

const sheet = (...rows: string[][]) => ({ table: [HEADER, ...rows], mapping: MAPPING, hasHeader: true });

/* ───────────────────────── supabase fake ───────────────────────── */

type Row = Record<string, unknown>;
type Client = "rls" | "service";
type Call = { client: Client; table: string; op: "select" | "insert"; payload?: unknown; inEmails?: string[] };
type DbError = { message: string; code?: string };
type Fault = (call: Call) => DbError | "throw" | null | undefined;

const db: { sch_registrations: Row[] } = { sch_registrations: [] };
const calls: Call[] = [];
const audits: Row[] = [];
const state = {
  profile: { role: "organiser", totp_enabled: false },
  forwardedFor: "203.0.113.7",
  faults: [] as Fault[],
};

const UNIQUE: DbError = { code: "23505", message: 'duplicate key value violates unique constraint "sch_registrations_game_email_key"' };

function clashes(item: Row, rows: Row[]): boolean {
  return rows.some(
    (r) =>
      r.game === item.game &&
      (String(r.email).toLowerCase() === String(item.email).toLowerCase() || r.submission_id === item.submission_id),
  );
}

function execute(call: Call): { data: unknown; error: DbError | null } {
  for (const fault of state.faults) {
    const verdict = fault(call);
    if (verdict === "throw") throw new Error("connection reset");
    if (verdict) return { data: null, error: verdict };
  }
  if (call.table === "audit_log") {
    audits.push({ ...(call.payload as Row) });
    return { data: null, error: null };
  }
  if (call.table !== "sch_registrations") throw new Error(`fake: unknown table ${call.table}`);
  if (call.op === "select") {
    const wanted = new Set(call.inEmails ?? []);
    return { data: db.sch_registrations.filter((r) => wanted.has(String(r.email))).map((r) => ({ game: r.game, email: r.email })), error: null };
  }
  const items = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
  // Atomic: validate the whole statement before any row lands.
  const staged: Row[] = [];
  for (const item of items) {
    if (clashes(item, db.sch_registrations) || clashes(item, staged)) return { data: null, error: UNIQUE };
    staged.push({ ...item });
  }
  db.sch_registrations.push(...staged);
  return { data: null, error: null };
}

function makeClient(client: Client) {
  return {
    from: (table: string) => ({
      select: () => ({
        in: (col: string, value: string[]) => {
          if (col !== "email") throw new Error(`fake: unexpected in(${col})`);
          const call: Call = { client, table, op: "select", inEmails: value };
          calls.push(call);
          return Promise.resolve().then(() => execute(call));
        },
      }),
      insert: (payload: unknown) => {
        const call: Call = { client, table, op: "insert", payload };
        calls.push(call);
        return Promise.resolve().then(() => execute(call));
      },
    }),
  };
}

/* ───────────────────────── module mocks ───────────────────────── */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": state.forwardedFor }),
  cookies: async () => ({ get: () => undefined }),
}));
jest.mock("@/lib/supabase/auth", () => ({
  requireSchOrganiser: jest.fn(async () => {
    // The real role rule decides; redirect() throws in Next and the actions
    // call the gate outside their try/catch.
    if (schOrganiserVerdict(state.profile) !== "ok") throw new Error("NEXT_REDIRECT");
    return {
      user: { id: ORGANISER, email: ORGANISER_EMAIL },
      profile: { id: ORGANISER, email: ORGANISER_EMAIL, ...state.profile },
    };
  }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient("rls"),
  createServiceClient: () => makeClient("service"),
}));
jest.mock("@/lib/log", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn(), debug: jest.fn() },
}));

import { commitSchImportAction, previewSchImportAction } from "@/app/(app)/sch/admin/import-actions";
import { log } from "@/lib/log";

/* ───────────────────────── helpers ───────────────────────── */

const inserts = () => calls.filter((c) => c.table === "sch_registrations" && c.op === "insert");
const lookups = () => calls.filter((c) => c.table === "sch_registrations" && c.op === "select");
const revalidated = () => jest.mocked(revalidatePath).mock.calls.map((c) => c[0]);
const stored = (email: string, game: string) =>
  db.sch_registrations.find((r) => r.email === email && r.game === game);

function okPreview(r: Awaited<ReturnType<typeof previewSchImportAction>>) {
  if (!("ok" in r)) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}
function okCommit(r: Awaited<ReturnType<typeof commitSchImportAction>>) {
  if (!("ok" in r)) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}

beforeEach(() => {
  db.sch_registrations = [];
  calls.length = 0;
  audits.length = 0;
  state.profile = { role: "organiser", totp_enabled: false };
  state.forwardedFor = "203.0.113.7";
  state.faults = [];
  jest.mocked(revalidatePath).mockClear();
  jest.mocked(log.error).mockClear();
  jest.mocked(log.exception).mockClear();
});

/* ───────────────────────── auth gate ───────────────────────── */

describe("auth gate", () => {
  it.each([
    ["viewer", { role: "viewer", totp_enabled: true }],
    ["auditor", { role: "auditor", totp_enabled: true }],
    ["admin without TOTP", { role: "admin", totp_enabled: false }],
  ])("%s is refused by both actions before any read or write", async (_label, profile) => {
    state.profile = profile;
    await expect(previewSchImportAction(sheet(ml({ n: 1 })))).rejects.toThrow("NEXT_REDIRECT");
    await expect(commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "paid" })).rejects.toThrow("NEXT_REDIRECT");
    expect(calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(db.sch_registrations).toHaveLength(0);
  });

  it("the gate runs before input validation (a refused caller learns nothing about the payload)", async () => {
    state.profile = { role: "viewer", totp_enabled: false };
    await expect(commitSchImportAction("garbage")).rejects.toThrow("NEXT_REDIRECT");
  });

  it.each([
    ["organiser without TOTP", { role: "organiser", totp_enabled: false }],
    ["admin with TOTP", { role: "admin", totp_enabled: true }],
  ])("%s passes", async (_label, profile) => {
    state.profile = profile;
    expect(okCommit(await commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "pending" })).inserted).toBe(1);
  });
});

/* ───────────────────────── input validation ───────────────────────── */

describe("input validation", () => {
  const good = sheet(ml({ n: 1 }));
  const BAD: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "timestamp,name"],
    ["an array", [["a"]]],
    ["no table", { mapping: MAPPING, hasHeader: true }],
    ["empty table", { ...good, table: [] }],
    ["table of non-arrays", { ...good, table: ["a,b"] }],
    ["non-string cell", { ...good, table: [HEADER, [1, 2, 3]] }],
    ["unknown mapping field", { ...good, mapping: ["full_name", "password"] }],
    ["field mapped twice", { ...good, mapping: ["email", "email"] }],
    ["hasHeader not boolean", { ...good, hasHeader: "yes" }],
    ["too many rows", { ...good, table: Array.from({ length: IMPORT_MAX_ROWS + 2 }, () => ["x"]) }],
    ["too many columns", { ...good, table: [Array.from({ length: IMPORT_MAX_COLS + 1 }, () => "x")] }],
  ];

  it.each(BAD)("%s → invalid from both actions without touching the database", async (_label, input) => {
    expect(await previewSchImportAction(input)).toEqual({ error: "invalid" });
    expect(await commitSchImportAction(typeof input === "object" && input ? { ...input, status: "paid" } : input)).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it.each(["waitlist", "rejected", "cancelled", "", "PAID", undefined, 1])("commit status %p → invalid", async (status) => {
    expect(await commitSchImportAction({ ...good, status })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("ignores widest-row cells beyond the mapping instead of rejecting the sheet", async () => {
    const wide = sheet([...ml({ n: 1 }), "extra", "cells"]);
    expect(okPreview(await previewSchImportAction(wide)).totals.ready).toBe(1);
  });

  it("a payload over the JSON cap → too_large, checked before the schema", async () => {
    // Every cell is within the per-cell cap; only the sum is too big.
    const fat = Array.from({ length: 500 }, () => ["x".repeat(1900)]);
    const input = { table: fat, mapping: ["ignore"], hasHeader: false };
    expect(await previewSchImportAction(input)).toEqual({ error: "too_large" });
    expect(await commitSchImportAction({ ...input, status: "paid" })).toEqual({ error: "too_large" });
    // Oversized AND malformed still answers too_large.
    expect(await previewSchImportAction({ junk: "y".repeat(1_000_000) })).toEqual({ error: "too_large" });
    expect(calls).toHaveLength(0);
  });
});

/* ───────────────────────── preview ───────────────────────── */

describe("previewSchImportAction", () => {
  it("classifies rows and never writes — no insert, no ledger row, no revalidation", async () => {
    db.sch_registrations.push({ game: "cs2", email: "player3@example.test", submission_id: "x" });
    const input = sheet(
      ml({ n: 1 }),                                   // ready
      mlAndCs2({ n: 2 }, "миний steam: p2"),          // partial (CS2 section broken)
      cs2({ n: 3 }),                                  // already_registered
      ml({ n: 1, email: "PLAYER1@example.test" }),    // duplicate_in_file
      ml({ n: 5, email: "not-an-email" }),            // invalid
    );
    const r = okPreview(await previewSchImportAction(input));
    expect(r.rows.map((v) => [v.row, v.state])).toEqual([
      [2, "ready"], [3, "partial"], [4, "already_registered"], [5, "duplicate_in_file"], [6, "invalid"],
    ]);
    expect(r.totals).toEqual({
      rows: 5, ready: 1, partial: 1, invalid: 1, duplicate_in_file: 1, already_registered: 1, entries_new: 2,
    });
    expect(r.rows[1]).toMatchObject({ games_new: ["mobile_legends"], games_existing: [], has_receipt: true });
    expect(r.rows[1].issues).toEqual([expect.objectContaining({ code: "bad_steam", game: "cs2" })]);
    expect(r.rows[2]).toMatchObject({ games_new: [], games_existing: ["cs2"] });
    expect(r.rows[3]).toMatchObject({ games_new: [], games_existing: ["mobile_legends"], email: "player1@example.test" });
    expect(r.rows[4].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "bad_email" })]));

    expect(inserts()).toHaveLength(0);
    expect(calls.filter((c) => c.table === "audit_log")).toHaveLength(0);
    expect(revalidated()).toEqual([]);
    expect(db.sch_registrations).toHaveLength(1);
  });

  it("a verdict carries name + e-mail only — no phone, no Facebook", async () => {
    const r = okPreview(await previewSchImportAction(sheet(ml({ n: 1, phone: "+82-10-9999-1234", facebook: "fb.com/secret.handle" }))));
    expect(Object.keys(r.rows[0]).sort()).toEqual(
      ["email", "games_existing", "games_new", "has_receipt", "issues", "name", "row", "state"],
    );
    const wire = JSON.stringify(r);
    expect(wire).not.toContain("9999-1234");
    expect(wire).not.toContain("secret.handle");
    expect(wire).not.toContain("drive.google.com");
  });

  it("looks existing pairs up in chunks of 200 e-mails, not per row", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ml({ n: i + 1 }));
    okPreview(await previewSchImportAction(sheet(...rows)));
    expect(lookups().map((c) => c.inEmails!.length)).toEqual([200, 200, 50]);
    for (const c of lookups()) expect(c.client).toBe("rls");
  });

  it("skips the lookup for e-mails of unusable rows", async () => {
    okPreview(await previewSchImportAction(sheet(ml({ n: 1, email: "nope" }), ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""])));
    expect(lookups()).toHaveLength(0);
  });

  it("lookup error → unavailable; a thrown client → unavailable", async () => {
    state.faults = [(c) => (c.op === "select" ? { message: "timeout" } : null)];
    expect(await previewSchImportAction(sheet(ml({ n: 1 })))).toEqual({ error: "unavailable" });
    state.faults = [() => "throw"];
    expect(await previewSchImportAction(sheet(ml({ n: 1 })))).toEqual({ error: "unavailable" });
  });

  it("classifies the Google-Form fixture with the guessed mapping", async () => {
    const table = parseDelimited(readFileSync(join(__dirname, "fixtures", "sch-google-form.csv"), "utf8"));
    const r = okPreview(await previewSchImportAction({ table, mapping: guessMapping(table[0], table.slice(1, 6)), hasHeader: true }));
    expect(r.totals.rows).toBe(12);
    const byRow = new Map(r.rows.map((v) => [v.row, v.state]));
    expect(byRow.get(2)).toBe("ready");
    expect(byRow.get(7)).toBe("duplicate_in_file"); // Bat@Example.com again, Mobile Legends again
    expect(byRow.get(6)).toBe("invalid"); // not-an-email
    expect(r.totals.ready + r.totals.partial + r.totals.invalid + r.totals.duplicate_in_file + r.totals.already_registered).toBe(12);
  });
});

/* ───────────────────────── commit ───────────────────────── */

describe("commitSchImportAction", () => {
  it("writes each new valid entry exactly like a web registration, marked as an import", async () => {
    const r = okCommit(await commitSchImportAction({
      ...sheet(ml({ n: 1, ts: "9/17/2026 14:03:22", email: "Player1@Example.test" }), cs2({ n: 2, receipt: "" }), dota({ n: 3 })),
      status: "pending",
    }));
    expect(r.inserted).toBe(3);
    expect(r.totals).toMatchObject({ rows: 3, ready: 3, entries_new: 3 });
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].client).toBe("rls");

    const a = stored("player1@example.test", "mobile_legends")!;
    expect(a).toMatchObject({
      full_name: "Тоглогч 1",
      facebook: "fb.com/player1",
      phone: "+82-10-5555-0000",
      in_game_id: "ml-1",
      rank_label: "Mythical Honor", // longest ladder label contained in "Mythic (Mythical Honor)"
      roles: ["Gold Lane", "Jungle"],
      answers: {},
      source: "import",
      status: "pending",
      paid_at: null,
      receipt_path: null,
      receipt_url: "https://drive.google.com/open?id=r1",
      submitted_at: "2026-09-17T05:03:22.000Z", // zone-less cell read as Asia/Seoul
      ip_hash: null,
      user_agent: null,
    });
    expect(a.rank_score).toEqual(expect.any(Number));
    expect(String(a.submission_id)).toMatch(UUID_V4_RE);

    expect(stored("player2@example.test", "cs2")).toMatchObject({
      in_game_id: "https://steamcommunity.com/id/p2",
      rank_label: "Premier 15000",
      roles: [],
      answers: { premier_rank: "15000", faceit: "yes" },
      receipt_url: null,
    });
    expect(stored("player3@example.test", "dota2")).toMatchObject({ rank_label: "Legend", roles: ["Position 1 (Carry)"] });
    expect(revalidated()).toEqual(["/sch/admin"]);
  });

  it("status=paid stamps paid_at on every imported row; pending leaves it null", async () => {
    const before = Date.now();
    okCommit(await commitSchImportAction({ ...sheet(ml({ n: 1 }), cs2({ n: 2 })), status: "paid" }));
    for (const row of db.sch_registrations) {
      expect(row.status).toBe("paid");
      expect(Date.parse(String(row.paid_at))).toBeGreaterThanOrEqual(before);
    }
  });

  it("is idempotent: the same sheet again inserts 0, a grown sheet only adds the new people", async () => {
    const first = [ml({ n: 1 }), cs2({ n: 2 }), dota({ n: 3 })];
    expect(okCommit(await commitSchImportAction({ ...sheet(...first), status: "paid" })).inserted).toBe(3);
    const ids = db.sch_registrations.map((r) => r.submission_id);

    calls.length = 0;
    const again = okCommit(await commitSchImportAction({ ...sheet(...first), status: "paid" }));
    expect(again.inserted).toBe(0);
    expect(again.totals).toMatchObject({ already_registered: 3, ready: 0, entries_new: 0 });
    expect(inserts()).toHaveLength(0);
    expect(db.sch_registrations).toHaveLength(3);

    const grown = okCommit(await commitSchImportAction({ ...sheet(...first, ml({ n: 4 }), cs2({ n: 1 })), status: "paid" }));
    expect(grown.inserted).toBe(2);
    expect(db.sch_registrations).toHaveLength(5);
    expect(db.sch_registrations.slice(0, 3).map((r) => r.submission_id)).toEqual(ids);
    // Same person, same timestamp → same deterministic submission id across games.
    expect(stored("player1@example.test", "cs2")!.submission_id).toBe(stored("player1@example.test", "mobile_legends")!.submission_id);
  });

  it("partial rows: the valid game is registered, the broken one is not", async () => {
    db.sch_registrations.push({ game: "mobile_legends", email: "player2@example.test", submission_id: "web" });
    const r = okCommit(await commitSchImportAction({
      ...sheet(
        mlAndCs2({ n: 1 }, "not a steam url"),                       // ML new, CS2 invalid
        mlAndCs2({ n: 2 }, "steamcommunity.com/id/p2"),              // ML exists, CS2 new
      ),
      status: "pending",
    }));
    expect(r.inserted).toBe(2);
    expect(r.totals).toMatchObject({ partial: 2, ready: 0, entries_new: 2 });
    expect(stored("player1@example.test", "mobile_legends")).toBeDefined();
    expect(stored("player1@example.test", "cs2")).toBeUndefined();
    expect(stored("player2@example.test", "cs2")).toMatchObject({ in_game_id: "https://steamcommunity.com/id/p2" });
    expect(db.sch_registrations.filter((x) => x.email === "player2@example.test")).toHaveLength(2);
  });

  it("in-file duplicates: the FIRST occurrence wins, later ones are skipped", async () => {
    const r = okCommit(await commitSchImportAction({
      ...sheet(
        ml({ n: 1, ts: "9/17/2026 10:00:00" }),
        ml({ n: 9, email: "PLAYER1@EXAMPLE.TEST", ts: "9/18/2026 10:00:00" }),
        cs2({ n: 1 }), // other game, same person → not a duplicate
      ),
      status: "pending",
    }));
    expect(r.inserted).toBe(2);
    expect(r.totals).toMatchObject({ ready: 2, duplicate_in_file: 1 });
    expect(stored("player1@example.test", "mobile_legends")).toMatchObject({ full_name: "Тоглогч 1", in_game_id: "ml-1" });
    expect(db.sch_registrations.filter((x) => x.game === "mobile_legends")).toHaveLength(1);
  });

  it("invalid rows are never written", async () => {
    const r = okCommit(await commitSchImportAction({
      ...sheet(ml({ n: 1, email: "broken@" }), ml({ n: 2, facebook: "" }), ml({ n: 3 })),
      status: "pending",
    }));
    expect(r.inserted).toBe(1);
    expect(r.totals).toMatchObject({ invalid: 2, ready: 1 });
    expect(db.sch_registrations.map((x) => x.email)).toEqual(["player3@example.test"]);
  });

  it("inserts in batches of at most 100", async () => {
    const rows = Array.from({ length: 230 }, (_, i) => ml({ n: i + 1 }));
    expect(okCommit(await commitSchImportAction({ ...sheet(...rows), status: "pending" })).inserted).toBe(230);
    expect(inserts().map((c) => (c.payload as unknown[]).length)).toEqual([100, 100, 30]);
  });

  it("23505 on a batch falls back to row-by-row: one race does not drop the batch", async () => {
    // Player 2 registers on the web between the lookup and the insert.
    state.faults = [
      (c) => {
        if (c.op === "insert" && c.table === "sch_registrations" && Array.isArray(c.payload) && !stored("player2@example.test", "mobile_legends")) {
          db.sch_registrations.push({ game: "mobile_legends", email: "player2@example.test", submission_id: "web", source: "web" });
        }
        return null;
      },
    ];
    const r = okCommit(await commitSchImportAction({ ...sheet(ml({ n: 1 }), ml({ n: 2 }), ml({ n: 3 })), status: "paid" }));
    expect(r.inserted).toBe(2);
    expect(r.totals).toMatchObject({ ready: 2, already_registered: 1, entries_new: 2 });
    // 1 rejected batch + 3 single-row replays.
    expect(inserts().map((c) => (Array.isArray(c.payload) ? c.payload.length : 1))).toEqual([3, 1, 1, 1]);
    expect(stored("player2@example.test", "mobile_legends")).toMatchObject({ source: "web" });
    expect(stored("player1@example.test", "mobile_legends")).toMatchObject({ source: "import" });
    expect(stored("player3@example.test", "mobile_legends")).toMatchObject({ source: "import" });
    expect(String(audits[0].detail)).toContain("inserted=2 existing=1");
  });

  it("any other insert error → unavailable, never a success; rows already written are still audited", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ml({ n: i + 1 }));
    let n = 0;
    state.faults = [(c) => (c.op === "insert" && c.table === "sch_registrations" && ++n === 2 ? { code: "57014", message: "statement timeout" } : null)];
    expect(await commitSchImportAction({ ...sheet(...rows), status: "pending" })).toEqual({ error: "unavailable" });
    expect(db.sch_registrations).toHaveLength(100);
    expect(audits).toHaveLength(1);
    expect(String(audits[0].detail)).toContain("inserted=100");
    expect(String(audits[0].detail)).toContain("failed=1");
    expect(revalidated()).toEqual(["/sch/admin"]);
    expect(log.error).toHaveBeenCalled();
    for (const call of jest.mocked(log.error).mock.calls) expect(JSON.stringify(call)).not.toContain("@example.test");

    // The retry finishes the job.
    state.faults = [];
    expect(okCommit(await commitSchImportAction({ ...sheet(...rows), status: "pending" })).inserted).toBe(50);
  });

  it("first-batch failure, lookup failure and a thrown client → unavailable with no ledger row", async () => {
    state.faults = [(c) => (c.op === "insert" && c.table === "sch_registrations" ? { code: "42501", message: "rls" } : null)];
    expect(await commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "pending" })).toEqual({ error: "unavailable" });
    state.faults = [(c) => (c.op === "select" ? { message: "timeout" } : null)];
    expect(await commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "pending" })).toEqual({ error: "unavailable" });
    state.faults = [(c) => (c.table === "sch_registrations" ? "throw" : null)];
    expect(await commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "pending" })).toEqual({ error: "unavailable" });
    expect(audits).toHaveLength(0);
    expect(db.sch_registrations).toHaveLength(0);
    expect(revalidated()).toEqual([]);
  });

  it("writes ONE ledger row with counts + status only — no e-mail, no name, no phone", async () => {
    db.sch_registrations.push({ game: "cs2", email: "player3@example.test", submission_id: "web" });
    okCommit(await commitSchImportAction({
      ...sheet(ml({ n: 1 }), ml({ n: 1 }), cs2({ n: 3 }), ml({ n: 4, email: "x" }), dota({ n: 5 })),
      status: "paid",
    }));
    expect(audits).toHaveLength(1);
    const a = audits[0];
    expect(a).toMatchObject({ action: "SCH_REGISTRATIONS_IMPORTED", user_id: ORGANISER, user_email: ORGANISER_EMAIL, ip: "203.0.113.7" });
    expect(a.detail).toBe("inserted=2 existing=1 invalid=1 duplicate=1 rows=5 status=paid");
    const detail = String(a.detail);
    for (const pii of ["@", "Тоглогч", "player", "+82", "fb.com", "drive.google"]) expect(detail).not.toContain(pii);
    for (const c of calls.filter((c) => c.table === "audit_log")) expect(c.client).toBe("service");
  });

  it("an all-duplicate re-import still leaves a ledger row (inserted=0) and an unparsable forwarded-for stores no ip", async () => {
    state.forwardedFor = "not-an-ip";
    db.sch_registrations.push({ game: "mobile_legends", email: "player1@example.test", submission_id: "web" });
    expect(okCommit(await commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "pending" })).inserted).toBe(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ ip: null, detail: "inserted=0 existing=1 invalid=0 duplicate=0 rows=1 status=pending" });
  });

  it("a failing ledger write does not turn a finished import into an error", async () => {
    state.faults = [(c) => (c.table === "audit_log" ? "throw" : null)];
    expect(okCommit(await commitSchImportAction({ ...sheet(ml({ n: 1 })), status: "pending" })).inserted).toBe(1);
    expect(log.exception).toHaveBeenCalled();
  });
});
