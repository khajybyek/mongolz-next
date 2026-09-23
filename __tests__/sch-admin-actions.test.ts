/**
 * Organiser console server actions — app/(app)/sch/admin/actions.ts.
 *
 * The action code runs for real; only its module boundaries are faked:
 * `requireSchOrganiser` (a fixed organiser, or a redirect-style rejection),
 * `next/cache` + `next/headers`, and both Supabase clients. The Supabase
 * fake is a small in-memory table store that records EVERY
 * `from(table).<op>` call with its filters and payload, so a test can
 * assert both the end state and the exact calls that produced it. The one
 * piece of database behaviour it models is the foreign key
 * `sch_registrations.team_id → sch_teams(id) on delete set null`
 * (20260917100000_sch_esports.sql), because the save-teams action relies
 * on it to clear the seats of players who are no longer in a team.
 */
import { isIP } from "node:net";
import { revalidatePath } from "next/cache";
import { ML_ROLES, SCH_TEAM_SIZE } from "@/lib/sch/schema";
import { drawTeams } from "@/lib/sch/teams";
import { scheduleSecurityEvent } from "@/lib/notify";

/* ───────────────────────── fixtures ───────────────────────── */

const ORGANISER = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const ORGANISER_EMAIL = "organiser@sch.test";
const rid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UNKNOWN_ID = "e0000000-0000-4000-8000-000000000999";

type Row = Record<string, unknown>;

function reg(n: number, over: Row = {}): Row {
  return {
    id: rid(n),
    submission_id: sid(n),
    game: "mobile_legends",
    full_name: `Player ${n}`,
    email: `player${n}@example.test`,
    facebook: `fb.com/player${n}`,
    phone: `+82-10-0000-${String(n).padStart(4, "0")}`,
    in_game_id: `ml-${n}`,
    rank_label: "Epic",
    rank_score: 50,
    roles: ["Jungle"],
    answers: {},
    status: "pending",
    paid_at: null,
    checked_in_at: null,
    notes: null,
    team_id: null,
    receipt_path: `submissions/${sid(n)}/receipt.jpg`,
    receipt_mime: "image/jpeg",
    receipt_bytes: 1234,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, n)).toISOString(),
    updated_at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

function team(n: number, game: string, seed: number, over: Row = {}): Row {
  return { id: tid(n), game, name: `Team ${seed}`, seed, strength: 200, created_by: null, created_at: "2026-09-10T00:00:00.000Z", ...over };
}

function event(over: Row = {}): Row {
  return {
    id: 1,
    title: "Chuseok 2026 SCH Esport тэмцээн",
    intro: null,
    registration_open: true,
    registration_deadline: null,
    fee_krw: 5000,
    fee_mnt: 12000,
    payment_info: "Toss 1001-9949-6201",
    contact: "fb.com/organiser",
    game_dates: { mobile_legends: "2026-09-25", cs2: "2026-09-26", dota2: "2026-09-27" },
    teams_published: {},
    updated_at: "2026-09-10T00:00:00.000Z",
    updated_by: null,
    ...over,
  };
}

/* ───────────────────────── supabase fake ───────────────────────── */

type Filter = { kind: "eq" | "in"; col: string; value: unknown };
type Op = "select" | "update" | "delete" | "insert";
type Client = "rls" | "service";
type Call = {
  client: Client;
  table: string;
  op: Op;
  payload?: unknown;
  columns?: string;
  count?: string;
  head?: boolean;
  returning?: string;
  filters: Filter[];
  orders: Array<{ col: string; ascending: boolean }>;
  limit?: number;
};
type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null; count: number | null };
/** Runs before a call executes: may return an error, ask for a throw, or mutate state and return null. */
type Fault = (call: Call) => DbError | "throw" | null | undefined;

const db: Record<string, Row[]> = { sch_registrations: [], sch_teams: [], sch_event: [] };
const calls: Call[] = [];
const audits: Row[] = [];
const storageRemovals: Array<{ client: Client; bucket: string; paths: string[] }> = [];
const rpcCalls: Array<{ client: Client; fn: string; args: unknown }> = [];
const state = {
  authReject: false,
  role: "organiser" as "organiser" | "admin",
  reauthFresh: true,
  forwardedFor: "203.0.113.7",
  faults: [] as Fault[],
  rpc: { data: null as unknown, error: null as DbError | null },
  storageRemoveError: null as DbError | null,
  seq: 0,
};

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) =>
    f.kind === "eq" ? row[f.col] === f.value : (f.value as unknown[]).includes(row[f.col]),
  );
}

function compare(a: unknown, b: unknown): number {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function execute(call: Call): Result {
  for (const fault of state.faults) {
    const verdict = fault(call);
    if (verdict === "throw") throw new Error("connection reset");
    if (verdict) return { data: null, error: verdict, count: null };
  }
  if (call.table === "audit_log") {
    if (call.op === "insert") audits.push({ ...(call.payload as Row) });
    return { data: null, error: null, count: null };
  }
  const rows = db[call.table];
  if (!rows) throw new Error(`fake: unknown table ${call.table}`);
  const matched = rows.filter((r) => matches(r, call.filters));
  switch (call.op) {
    case "select": {
      let out = matched.slice();
      for (const o of call.orders.slice().reverse()) {
        out.sort((a, b) => compare(a[o.col], b[o.col]) * (o.ascending ? 1 : -1));
      }
      if (call.limit !== undefined) out = out.slice(0, call.limit);
      if (call.head) return { data: null, error: null, count: out.length };
      return { data: out.map((r) => ({ ...r })), error: null, count: call.count ? out.length : null };
    }
    case "update": {
      for (const r of matched) Object.assign(r, call.payload as Row);
      return { data: call.returning ? matched.map((r) => ({ ...r })) : null, error: null, count: null };
    }
    case "delete": {
      for (const r of matched) rows.splice(rows.indexOf(r), 1);
      if (call.table === "sch_teams") {
        // FK sch_registrations.team_id → sch_teams(id) ON DELETE SET NULL.
        const gone = new Set(matched.map((t) => t.id));
        for (const r of db.sch_registrations) if (gone.has(r.team_id)) r.team_id = null;
      }
      return { data: call.returning ? matched.map((r) => ({ ...r })) : null, error: null, count: null };
    }
    case "insert": {
      const items = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
      const inserted = items.map((item) => ({
        id: `d0000000-0000-4000-8000-${String(++state.seq).padStart(12, "0")}`,
        created_at: new Date().toISOString(),
        ...item,
      }));
      rows.push(...inserted);
      return { data: call.returning ? inserted.map((r) => ({ ...r })) : null, error: null, count: null };
    }
  }
}

class Query {
  constructor(private readonly call: Call) {}
  select(columns = "*") {
    this.call.returning = columns;
    return this;
  }
  eq(col: string, value: unknown) {
    this.call.filters.push({ kind: "eq", col, value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.call.filters.push({ kind: "in", col, value });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.call.orders.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.call.limit = n;
    return this;
  }
  private run(): Promise<Result> {
    return Promise.resolve().then(() => execute(this.call));
  }
  async maybeSingle(): Promise<Result> {
    const r = await this.run();
    return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
  }
  async single(): Promise<Result> {
    const r = await this.maybeSingle();
    return r.data === null && !r.error ? { ...r, error: { message: "no rows" } } : r;
  }
  then<A, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.run().then(onFulfilled, onRejected);
  }
}

function fromTable(client: Client, table: string) {
  const start = (op: Op, extra: Partial<Call> = {}) => {
    const call: Call = { client, table, op, filters: [], orders: [], ...extra };
    calls.push(call);
    return new Query(call);
  };
  return {
    select: (columns = "*", opts?: { count?: string; head?: boolean }) =>
      start("select", { columns, count: opts?.count, head: opts?.head }),
    update: (payload: unknown) => start("update", { payload }),
    delete: () => start("delete"),
    insert: (payload: unknown) => start("insert", { payload }),
  };
}

function makeClient(client: Client) {
  return {
    from: (table: string) => fromTable(client, table),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ client, fn, args });
      return { data: state.rpc.data, error: state.rpc.error };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          storageRemovals.push({ client, bucket, paths });
          return state.storageRemoveError
            ? { data: null, error: state.storageRemoveError }
            : { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
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
    // redirect() throws in Next; the actions call the gate outside their try/catch.
    if (state.authReject) throw new Error("NEXT_REDIRECT");
    return {
      user: { id: ORGANISER, email: ORGANISER_EMAIL },
      profile: { id: ORGANISER, email: ORGANISER_EMAIL, role: state.role, totp_enabled: state.role === "admin" },
    };
  }),
}));
jest.mock("@/lib/auth/step-up", () => ({
  ensureFreshReauth: jest.fn(async () => (state.reauthFresh ? null : { error: "REAUTH_REQUIRED" })),
}));
jest.mock("@/lib/notify", () => ({ scheduleSecurityEvent: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient("rls"),
  createServiceClient: () => makeClient("service"),
}));

import {
  closeOutEventAction,
  deleteRegistrationAction,
  saveTeamsAction,
  setCheckInAction,
  setRegistrationNoteAction,
  setRegistrationStatusAction,
  setTeamsPublishedAction,
  sweepOrphanReceiptsAction,
  updateEventSettingsAction,
  updateRegistrationAction,
  type SchEventSettingsInput,
  type SchRegistrationEditInput,
} from "@/app/(app)/sch/admin/actions";

/* ───────────────────────── helpers ───────────────────────── */

const revalidated = () => jest.mocked(revalidatePath).mock.calls.map((c) => c[0]);
const writes = () => calls.filter((c) => c.op !== "select");
const row = (id: string) => db.sch_registrations.find((r) => r.id === id);
const teams = (game: string) => db.sch_teams.filter((t) => t.game === game);

/** Strings that belong to a registrant and must never reach the ledger. */
const REGISTRANT_PII = ["@example.test", "+82-10", "fb.com/player", "Player "];

function expectLedgerClean(expectedActions: string[]) {
  expect(audits.map((a) => a.action)).toEqual(expectedActions);
  for (const a of audits) {
    expect(a.user_id).toBe(ORGANISER);
    expect(a.user_email).toBe(ORGANISER_EMAIL);
    const detail = String(a.detail);
    expect(detail.length).toBeLessThanOrEqual(500);
    for (const pii of REGISTRANT_PII) expect(detail).not.toContain(pii);
  }
  // The ledger and the data are written with the service role after the
  // organiser gate: the sch_* tables are service-role-write only (20260923170000).
  for (const c of calls.filter((c) => c.table === "audit_log")) expect(c.client).toBe("service");
  for (const c of writes()) expect(c.client).toBe("service");
}

function settings(over: Partial<SchEventSettingsInput> = {}): SchEventSettingsInput {
  return {
    title: "Chuseok 2026 SCH Esports",
    intro: "  Balanced draw, pay first.  ",
    registration_open: true,
    registration_deadline: "2026-09-20T18:00",
    fee_krw: 5000,
    fee_mnt: 12000,
    payment_info: "Toss 1001-9949-6201",
    contact: "fb.com/organiser",
    game_dates: { mobile_legends: "2026-09-25", cs2: "2026-09-26", dota2: "2026-09-27" },
    teams_published: { mobile_legends: false, cs2: false, dota2: false },
    ...over,
  };
}

function edit(over: Partial<SchRegistrationEditInput> = {}): SchRegistrationEditInput {
  return {
    id: rid(1),
    full_name: "Player 1",
    email: "player1@example.test",
    facebook: "fb.com/player1",
    phone: "+82-10-0000-0001",
    game: "mobile_legends",
    in_game_id: "ml-1",
    rank_label: "Epic",
    roles: ["Jungle"],
    premier_rank: "",
    faceit: "",
    expected_updated_at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

const BAD_IDS: unknown[] = ["", "not-a-uuid", "../etc/passwd", "a0000000-0000-4000-8000-00000000000g", 42, null, undefined];

beforeEach(() => {
  db.sch_registrations = [];
  db.sch_teams = [];
  db.sch_event = [event()];
  calls.length = 0;
  audits.length = 0;
  storageRemovals.length = 0;
  rpcCalls.length = 0;
  state.authReject = false;
  state.role = "organiser";
  state.reauthFresh = true;
  jest.mocked(scheduleSecurityEvent).mockClear();
  state.forwardedFor = "203.0.113.7";
  state.faults = [];
  state.rpc = { data: null, error: null };
  state.storageRemoveError = null;
  state.seq = 0;
  jest.mocked(revalidatePath).mockClear();
});

/* ───────────────────────── auth gate ───────────────────────── */

describe("auth gate", () => {
  it("propagates a rejected requireSchOrganiser from every action before any read or write", async () => {
    state.authReject = true;
    db.sch_registrations.push(reg(1));
    await expect(setRegistrationStatusAction({ id: rid(1), status: "paid" })).rejects.toThrow("NEXT_REDIRECT");
    await expect(setCheckInAction({ id: rid(1), checkedIn: true })).rejects.toThrow("NEXT_REDIRECT");
    await expect(setRegistrationNoteAction({ id: rid(1), note: "x" })).rejects.toThrow("NEXT_REDIRECT");
    await expect(updateRegistrationAction(edit())).rejects.toThrow("NEXT_REDIRECT");
    await expect(deleteRegistrationAction({ id: rid(1) })).rejects.toThrow("NEXT_REDIRECT");
    await expect(updateEventSettingsAction(settings())).rejects.toThrow("NEXT_REDIRECT");
    await expect(saveTeamsAction({ game: "cs2", seed: 1, playerIds: [], teams: [] })).rejects.toThrow("NEXT_REDIRECT");
    await expect(setTeamsPublishedAction({ game: "cs2", published: false })).rejects.toThrow("NEXT_REDIRECT");
    await expect(sweepOrphanReceiptsAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(row(rid(1))?.status).toBe("pending");
  });
});

/* ───────────────────────── id validation ───────────────────────── */

describe("registration id validation", () => {
  it.each(BAD_IDS)("status: %p → invalid without touching the database", async (bad) => {
    expect(await setRegistrationStatusAction({ id: bad as string, status: "paid" })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it.each(BAD_IDS)("check-in: %p → invalid without touching the database", async (bad) => {
    expect(await setCheckInAction({ id: bad as string, checkedIn: true })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it.each(BAD_IDS)("note: %p → invalid without touching the database", async (bad) => {
    expect(await setRegistrationNoteAction({ id: bad as string, note: "hi" })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it.each(BAD_IDS)("delete: %p → invalid without touching the database", async (bad) => {
    expect(await deleteRegistrationAction({ id: bad as string })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it.each(BAD_IDS)("edit: %p → invalid without touching the database", async (bad) => {
    expect(await updateRegistrationAction(edit({ id: bad as string }))).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("accepts an upper-case uuid and filters by its lower-case form", async () => {
    db.sch_registrations.push(reg(1));
    expect(await setCheckInAction({ id: rid(1).toUpperCase(), checkedIn: true })).toEqual({ ok: true });
    const update = writes()[0];
    expect(update.filters).toEqual([{ kind: "eq", col: "id", value: rid(1) }]);
    expect(row(rid(1))?.checked_in_at).toEqual(expect.any(String));
  });
});

/* ───────────────────────── registration edits ───────────────────────── */

describe("updateRegistrationAction", () => {
  it("corrects personal and Mobile Legends fields, recalculates strength, and audits field names without PII", async () => {
    db.sch_registrations.push(reg(1));

    expect(await updateRegistrationAction(edit({
      full_name: "  Corrected Player  ",
      email: "CORRECTED@EXAMPLE.TEST",
      facebook: " corrected.facebook ",
      phone: " 010-1234-5678 ",
      in_game_id: " corrected-id ",
      rank_label: "Mythic",
      roles: ["Roamer", "Mid Lane"],
    }))).toEqual({ ok: true });

    expect(row(rid(1))).toMatchObject({
      full_name: "Corrected Player",
      email: "corrected@example.test",
      facebook: "corrected.facebook",
      phone: "010-1234-5678",
      in_game_id: "corrected-id",
      rank_label: "Mythic",
      rank_score: 70,
      roles: ["Roamer", "Mid Lane"],
      answers: {},
    });
    expectLedgerClean(["SCH_REGISTRATION_EDITED"]);
    expect(audits[0].detail).toContain(`registration=${rid(1)} game=mobile_legends→mobile_legends fields=`);
    expect(audits[0].detail).not.toContain("Corrected Player");
    expect(revalidated()).toEqual(expect.arrayContaining(["/sch/admin", "/sch", "/sch/teams"]));
  });

  it("changes the game, derives CS2 fields, and clears an incompatible team seat", async () => {
    db.sch_registrations.push(reg(1, { team_id: tid(1) }));

    expect(await updateRegistrationAction(edit({
      game: "cs2",
      in_game_id: "steamcommunity.com/id/corrected-player",
      rank_label: "",
      roles: [],
      premier_rank: "15000",
      faceit: "yes",
    }))).toEqual({ ok: true });

    expect(row(rid(1))).toMatchObject({
      game: "cs2",
      in_game_id: "https://steamcommunity.com/id/corrected-player",
      rank_label: "Premier 15000",
      rank_score: 50,
      roles: [],
      answers: { premier_rank: "15000", faceit: "yes" },
      team_id: null,
    });
    expect(String(audits[0].detail)).toContain("game=mobile_legends→cs2");
    expect(String(audits[0].detail)).toContain("team_id");
  });

  it.each([
    { email: "not-an-email" },
    { game: "valorant" },
    { rank_label: "Not a rank" },
    { roles: [] },
    { in_game_id: "" },
  ])("rejects an invalid correction %p before reading", async (over) => {
    db.sch_registrations.push(reg(1));
    expect(await updateRegistrationAction(edit(over))).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("returns conflict for a missing row or a concurrent edit and writes no audit", async () => {
    expect(await updateRegistrationAction(edit({ full_name: "Changed" }))).toEqual({ error: "conflict" });

    db.sch_registrations.push(reg(1));
    state.faults = [(call) => {
      if (call.op === "update" && call.table === "sch_registrations") row(rid(1))!.updated_at = "2026-09-11T00:00:00.000Z";
      return null;
    }];
    expect(await updateRegistrationAction(edit({ full_name: "Changed" }))).toEqual({ error: "conflict" });
    expect(row(rid(1))?.full_name).toBe("Player 1");
    expect(audits).toHaveLength(0);
  });

  it("maps the (game, e-mail) unique index to duplicate_email — not a retryable conflict", async () => {
    db.sch_registrations.push(reg(1));
    state.faults = [(call) => call.op === "update" && call.table === "sch_registrations"
      ? {
          code: "23505",
          message: 'duplicate key value violates unique constraint "sch_registrations_game_email_idx"',
          details: "Key (game, lower(email))=(mobile_legends, other@example.test) already exists.",
        } as DbError
      : null];
    expect(await updateRegistrationAction(edit({ email: "other@example.test" }))).toEqual({ error: "duplicate_email" });
    expect(audits).toHaveLength(0);
  });

  it("maps the (submission_id, game) unique index to duplicate_game", async () => {
    db.sch_registrations.push(reg(1));
    state.faults = [(call) => call.op === "update" && call.table === "sch_registrations"
      ? {
          code: "23505",
          message: 'duplicate key value violates unique constraint "sch_registrations_submission_game_idx"',
          details: `Key (submission_id, game)=(${sid(1)}, cs2) already exists.`,
        } as DbError
      : null];
    expect(await updateRegistrationAction(edit({
      game: "cs2",
      in_game_id: "steamcommunity.com/id/p1",
      rank_label: "",
      roles: [],
      premier_rank: "15000",
      faceit: "no",
    }))).toEqual({ error: "duplicate_game" });
    expect(audits).toHaveLength(0);
  });

  it("a dialog opened before another organiser's save → conflict, even when its draft equals the row now", async () => {
    // Organiser B already saved a correction: the row moved on to 09-11.
    db.sch_registrations.push(reg(1, { full_name: "Fixed By B", updated_at: "2026-09-11T00:00:00.000Z" }));
    // A's stale dialog would put the old name back.
    expect(await updateRegistrationAction(edit({ full_name: "Player 1" }))).toEqual({ error: "conflict" });
    // …and an identical draft is still stale, not a silent no-op.
    expect(await updateRegistrationAction(edit({ full_name: "Fixed By B" }))).toEqual({ error: "conflict" });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(row(rid(1))?.full_name).toBe("Fixed By B");
  });

  it("the same instant in another notation is not stale", async () => {
    db.sch_registrations.push(reg(1, { updated_at: "2026-09-10T00:00:00+00:00" }));
    expect(await updateRegistrationAction(edit({ full_name: "Renamed" }))).toEqual({ ok: true });
    expect(row(rid(1))?.full_name).toBe("Renamed");
  });

  it.each([undefined, "", "yesterday", "x".repeat(65), 42])("expected_updated_at %p → invalid before reading", async (bad) => {
    db.sch_registrations.push(reg(1));
    expect(await updateRegistrationAction(edit({ expected_updated_at: bad as string }))).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("an unchanged CS2 row read back with jsonb key order is a no-op (no write, no ledger row)", async () => {
    // jsonb returns keys shortest-first: {faceit, premier_rank}, not the
    // {premier_rank, faceit} order registrationRow() builds.
    db.sch_registrations.push(reg(1, {
      game: "cs2",
      in_game_id: "https://steamcommunity.com/id/p1",
      rank_label: "Premier 15000",
      rank_score: 50,
      roles: [],
      answers: { faceit: "yes", premier_rank: "15000" },
    }));
    expect(await updateRegistrationAction(edit({
      game: "cs2",
      in_game_id: "https://steamcommunity.com/id/p1",
      rank_label: "",
      roles: [],
      premier_rank: "15000",
      faceit: "yes",
    }))).toEqual({ ok: true });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("treats an unchanged save as a successful no-op", async () => {
    db.sch_registrations.push(reg(1));
    expect(await updateRegistrationAction(edit())).toEqual({ ok: true });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── status transitions ───────────────────────── */

describe("setRegistrationStatusAction", () => {
  it.each(["bogus", "cancelled", "", "PAID", 42, null, undefined])("status %p → invalid", async (status) => {
    db.sch_registrations.push(reg(1));
    expect(await setRegistrationStatusAction({ id: rid(1), status: status as string })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("pending → paid stamps paid_at, keeps the seat, and audits the transition", async () => {
    db.sch_registrations.push(reg(1, { team_id: tid(1) }));
    const before = Date.now();
    expect(await setRegistrationStatusAction({ id: rid(1), status: "paid" })).toEqual({ ok: true });

    const r = row(rid(1))!;
    expect(r.status).toBe("paid");
    expect(Date.parse(String(r.paid_at))).toBeGreaterThanOrEqual(before);
    expect(r.team_id).toBe(tid(1));

    const update = writes().find((c) => c.table === "sch_registrations")!;
    expect(update.client).toBe("service");
    expect(update.payload).toEqual({ status: "paid", paid_at: expect.any(String) });
    expect(update.payload).not.toHaveProperty("team_id");
    // Compare-and-set on the status the organiser saw.
    expect(update.filters).toEqual([
      { kind: "eq", col: "id", value: rid(1) },
      { kind: "eq", col: "status", value: "pending" },
    ]);

    expectLedgerClean(["SCH_REGISTRATION_STATUS"]);
    expect(String(audits[0].detail)).toBe(`registration=${rid(1)} game=mobile_legends pending→paid`);
    expect(revalidated()).toEqual(expect.arrayContaining(["/sch/admin", "/sch/teams"]));
  });

  it("re-marking a paid row keeps its original paid_at", async () => {
    db.sch_registrations.push(reg(1, { status: "paid", paid_at: "2026-09-02T00:00:00.000Z" }));
    expect(await setRegistrationStatusAction({ id: rid(1), status: "paid" })).toEqual({ ok: true });
    expect(row(rid(1))?.paid_at).toBe("2026-09-02T00:00:00.000Z");
  });

  it.each(["rejected", "waitlist", "pending"])(
    "paid → %s clears paid_at and the team seat, and the audit detail says so",
    async (next) => {
      db.sch_registrations.push(reg(1, { status: "paid", paid_at: "2026-09-02T00:00:00.000Z", team_id: tid(1) }));
      expect(await setRegistrationStatusAction({ id: rid(1), status: next })).toEqual({ ok: true });

      const r = row(rid(1))!;
      expect(r.status).toBe(next);
      expect(r.paid_at).toBeNull();
      expect(r.team_id).toBeNull();
      const update = writes().find((c) => c.table === "sch_registrations")!;
      expect(update.payload).toEqual({ status: next, paid_at: null, team_id: null });

      expectLedgerClean(["SCH_REGISTRATION_STATUS"]);
      expect(String(audits[0].detail)).toBe(`registration=${rid(1)} game=mobile_legends paid→${next} team=${tid(1)} cleared`);
      expect(revalidated()).toContain("/sch/teams");
    },
  );

  it("leaving paid without a seat does not mention a team", async () => {
    db.sch_registrations.push(reg(1, { status: "paid", paid_at: "2026-09-02T00:00:00.000Z" }));
    expect(await setRegistrationStatusAction({ id: rid(1), status: "waitlist" })).toEqual({ ok: true });
    const update = writes().find((c) => c.table === "sch_registrations")!;
    expect(update.payload).toEqual({ status: "waitlist", paid_at: null });
    expect(String(audits[0].detail)).not.toContain("team=");
  });

  it("unknown row → conflict, nothing written", async () => {
    expect(await setRegistrationStatusAction({ id: UNKNOWN_ID, status: "paid" })).toEqual({ error: "conflict" });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("a status changed under the organiser loses the compare-and-set → conflict, no audit", async () => {
    db.sch_registrations.push(reg(1));
    state.faults.push((call) => {
      if (call.op === "update" && call.table === "sch_registrations") row(rid(1))!.status = "rejected";
      return null;
    });
    expect(await setRegistrationStatusAction({ id: rid(1), status: "paid" })).toEqual({ error: "conflict" });
    expect(row(rid(1))?.status).toBe("rejected");
    expect(row(rid(1))?.paid_at).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("read errors, write errors and thrown clients all map to unavailable", async () => {
    db.sch_registrations.push(reg(1));
    state.faults = [(c) => (c.op === "select" ? { message: "offline" } : null)];
    expect(await setRegistrationStatusAction({ id: rid(1), status: "paid" })).toEqual({ error: "unavailable" });
    state.faults = [(c) => (c.op === "update" ? { message: "offline" } : null)];
    expect(await setRegistrationStatusAction({ id: rid(1), status: "paid" })).toEqual({ error: "unavailable" });
    state.faults = [() => "throw"];
    expect(await setRegistrationStatusAction({ id: rid(1), status: "paid" })).toEqual({ error: "unavailable" });
    expect(row(rid(1))?.status).toBe("pending");
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── check-in ───────────────────────── */

describe("setCheckInAction", () => {
  it.each([1, "true", null, undefined])("checkedIn %p → invalid", async (value) => {
    db.sch_registrations.push(reg(1));
    expect(await setCheckInAction({ id: rid(1), checkedIn: value as unknown as boolean })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("toggles checked_in_at on and off with one audit row each", async () => {
    db.sch_registrations.push(reg(1));
    expect(await setCheckInAction({ id: rid(1), checkedIn: true })).toEqual({ ok: true });
    expect(row(rid(1))?.checked_in_at).toEqual(expect.any(String));
    expect(await setCheckInAction({ id: rid(1), checkedIn: false })).toEqual({ ok: true });
    expect(row(rid(1))?.checked_in_at).toBeNull();

    const updates = writes().filter((c) => c.table === "sch_registrations");
    expect(updates.map((c) => c.payload)).toEqual([{ checked_in_at: expect.any(String) }, { checked_in_at: null }]);
    expectLedgerClean(["SCH_REGISTRATION_CHECKIN", "SCH_REGISTRATION_CHECKIN"]);
    expect(audits.map((a) => a.detail)).toEqual([
      `registration=${rid(1)} game=mobile_legends checked_in=true`,
      `registration=${rid(1)} game=mobile_legends checked_in=false`,
    ]);
    expect(revalidated()).toContain("/sch/admin");
  });

  it("unknown row → conflict", async () => {
    expect(await setCheckInAction({ id: UNKNOWN_ID, checkedIn: true })).toEqual({ error: "conflict" });
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── note ───────────────────────── */

describe("setRegistrationNoteAction", () => {
  it("stores a trimmed note up to 1000 characters and keeps its text out of the ledger", async () => {
    db.sch_registrations.push(reg(1));
    const note = `  Paid via Toss ref 4711 ${"x".repeat(1000 - 24)}`.slice(0, 1000);
    expect(note).toHaveLength(1000);
    expect(await setRegistrationNoteAction({ id: rid(1), note })).toEqual({ ok: true });
    expect(row(rid(1))?.notes).toBe(note.trim());

    expectLedgerClean(["SCH_REGISTRATION_NOTE"]);
    expect(audits[0].detail).toBe(`registration=${rid(1)} game=mobile_legends note=set`);
    expect(String(audits[0].detail)).not.toContain("Toss");
  });

  it("1001 characters → invalid before any read", async () => {
    db.sch_registrations.push(reg(1));
    expect(await setRegistrationNoteAction({ id: rid(1), note: "x".repeat(1001) })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
    expect(row(rid(1))?.notes).toBeNull();
  });

  it.each([42, null, undefined, ["a"]])("non-string note %p → invalid", async (note) => {
    expect(await setRegistrationNoteAction({ id: rid(1), note: note as unknown as string })).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a blank note clears the column and audits 'cleared'", async () => {
    db.sch_registrations.push(reg(1, { notes: "old" }));
    expect(await setRegistrationNoteAction({ id: rid(1), note: "   \n " })).toEqual({ ok: true });
    expect(row(rid(1))?.notes).toBeNull();
    expect(audits[0].detail).toBe(`registration=${rid(1)} game=mobile_legends note=cleared`);
  });

  it("unknown row → conflict", async () => {
    expect(await setRegistrationNoteAction({ id: UNKNOWN_ID, note: "x" })).toEqual({ error: "conflict" });
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── delete ───────────────────────── */

describe("deleteRegistrationAction", () => {
  it("removes the row, audits ids only, and drops the receipt once the submission has no rows left", async () => {
    // One submission, two games, one shared screenshot.
    db.sch_registrations.push(reg(1, { submission_id: sid(7), receipt_path: `submissions/${sid(7)}/receipt.png` }));
    db.sch_registrations.push(reg(2, { submission_id: sid(7), game: "cs2", receipt_path: `submissions/${sid(7)}/receipt.png` }));

    expect(await deleteRegistrationAction({ id: rid(1) })).toEqual({ ok: true });
    expect(row(rid(1))).toBeUndefined();
    expect(row(rid(2))).toBeDefined();
    expect(storageRemovals).toHaveLength(0); // the sibling still references it

    expect(await deleteRegistrationAction({ id: rid(2) })).toEqual({ ok: true });
    expect(db.sch_registrations).toHaveLength(0);
    expect(storageRemovals).toEqual([{ client: "service", bucket: "sch-receipts", paths: [`submissions/${sid(7)}/receipt.png`] }]);

    const deletes = writes().filter((c) => c.op === "delete");
    expect(deletes.map((c) => c.client)).toEqual(["service", "service"]);
    expectLedgerClean(["SCH_REGISTRATION_DELETED", "SCH_REGISTRATION_DELETED"]);
    expect(audits[0].detail).toBe(`registration=${rid(1)} game=mobile_legends submission=${sid(7)}`);
    expect(audits[1].detail).toBe(`registration=${rid(2)} game=cs2 submission=${sid(7)}`);
  });

  it("revalidates the public roster only when the row held a seat", async () => {
    db.sch_registrations.push(reg(1), reg(2, { team_id: tid(1) }));
    await deleteRegistrationAction({ id: rid(1) });
    expect(revalidated()).not.toContain("/sch/teams");
    jest.mocked(revalidatePath).mockClear();
    await deleteRegistrationAction({ id: rid(2) });
    expect(revalidated()).toContain("/sch/teams");
  });

  it("unknown row → conflict; a delete that matches nothing → conflict", async () => {
    expect(await deleteRegistrationAction({ id: UNKNOWN_ID })).toEqual({ error: "conflict" });
    db.sch_registrations.push(reg(1));
    state.faults.push((call) => {
      if (call.op === "delete") db.sch_registrations.length = 0; // gone between read and delete
      return null;
    });
    expect(await deleteRegistrationAction({ id: rid(1) })).toEqual({ error: "conflict" });
    expect(audits).toHaveLength(0);
    expect(storageRemovals).toHaveLength(0);
  });

  it("a failed delete never removes the receipt", async () => {
    db.sch_registrations.push(reg(1));
    state.faults.push((c) => (c.op === "delete" ? { message: "offline" } : null));
    expect(await deleteRegistrationAction({ id: rid(1) })).toEqual({ error: "unavailable" });
    expect(storageRemovals).toHaveLength(0);
    expect(row(rid(1))).toBeDefined();
  });

  it("keeps the shared receipt when the sibling count cannot be read", async () => {
    // Two rows of one submission share one screenshot. The count query
    // that decides whether the object is still referenced fails; the
    // object must stay — the surviving row still points at it.
    db.sch_registrations.push(reg(1, { submission_id: sid(7), receipt_path: `submissions/${sid(7)}/receipt.png` }));
    db.sch_registrations.push(reg(2, { submission_id: sid(7), game: "cs2", receipt_path: `submissions/${sid(7)}/receipt.png` }));
    state.faults.push((c) => (c.op === "select" && c.head ? { message: "offline" } : null));

    expect(await deleteRegistrationAction({ id: rid(1) })).toEqual({ ok: true });
    expect(row(rid(2))?.receipt_path).toBe(`submissions/${sid(7)}/receipt.png`);
    expect(storageRemovals).toHaveLength(0);
  });
});

/* ───────────────────────── event settings ───────────────────────── */

describe("updateEventSettingsAction", () => {
  it("writes the normalised settings: KST deadline → UTC instant, trimmed texts, jsonb maps, updated_by", async () => {
    expect(await updateEventSettingsAction(settings())).toEqual({ ok: true });

    const update = writes().find((c) => c.table === "sch_event")!;
    expect(update.client).toBe("service");
    expect(update.filters).toEqual([{ kind: "eq", col: "id", value: 1 }]);
    expect(update.payload).toEqual({
      title: "Chuseok 2026 SCH Esports",
      intro: "Balanced draw, pay first.",
      registration_open: true,
      registration_deadline: "2026-09-20T09:00:00.000Z", // 18:00 Asia/Seoul
      fee_krw: 5000,
      fee_mnt: 12000,
      payment_info: "Toss 1001-9949-6201",
      contact: "fb.com/organiser",
      game_dates: { mobile_legends: "2026-09-25", cs2: "2026-09-26", dota2: "2026-09-27" },
      teams_published: { mobile_legends: false, cs2: false, dota2: false },
      updated_by: ORGANISER,
    });

    expectLedgerClean(["SCH_EVENT_UPDATED"]);
    expect(audits[0].detail).toBe("open=true deadline=2026-09-20T09:00:00.000Z fee_krw=5000 fee_mnt=12000 published=none payment_info_changed=false");
    // Bank details and the organiser's contact are not ledger material either.
    expect(String(audits[0].detail)).not.toContain("Toss");
    expect(String(audits[0].detail)).not.toContain("organiser");
    expect(revalidated()).toEqual(expect.arrayContaining(["/sch/admin", "/sch", "/sch/teams"]));
  });

  it("an empty deadline is stored as null; blank texts become null; seconds are accepted", async () => {
    expect(await updateEventSettingsAction(settings({ registration_deadline: "", intro: "", payment_info: "  ", contact: "" }))).toEqual({ ok: true });
    const update = writes().find((c) => c.table === "sch_event")!;
    expect(update.payload).toMatchObject({ registration_deadline: null, intro: null, payment_info: null, contact: null });
    expect(String(audits[0].detail)).toContain("deadline=none");

    calls.length = 0;
    expect(await updateEventSettingsAction(settings({ registration_deadline: "2026-09-20T18:00:30" }))).toEqual({ ok: true });
    expect(writes().find((c) => c.table === "sch_event")!.payload).toMatchObject({ registration_deadline: "2026-09-20T09:00:30.000Z" });
  });

  it.each(["tomorrow", "2026-09-20", "2026-09-20 18:00", "2026-13-01T10:00", "2026-09-20T18:00Z", "2026-09-20T18:00+09:00"])(
    "deadline %p → invalid",
    async (deadline) => {
      expect(await updateEventSettingsAction(settings({ registration_deadline: deadline }))).toEqual({ error: "invalid" });
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    ["fee_krw", -1],
    ["fee_krw", 1.5],
    ["fee_krw", 100_000_001],
    ["fee_krw", "5000"],
    ["fee_mnt", -1],
    ["fee_mnt", NaN],
  ])("fee bound: %s = %p → invalid", async (key, value) => {
    expect(await updateEventSettingsAction(settings({ [key]: value } as Partial<SchEventSettingsInput>))).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("fees of 0 and 100 000 000 are the inclusive bounds", async () => {
    expect(await updateEventSettingsAction(settings({ fee_krw: 0, fee_mnt: 100_000_000 }))).toEqual({ ok: true });
    expect(writes().find((c) => c.table === "sch_event")!.payload).toMatchObject({ fee_krw: 0, fee_mnt: 100_000_000 });
  });

  it.each<[string, Partial<SchEventSettingsInput>]>([
    ["title too short", { title: "ab" }],
    ["title too long", { title: "x".repeat(121) }],
    ["game date not a day", { game_dates: { mobile_legends: "25/09/2026", cs2: "2026-09-26", dota2: "2026-09-27" } }],
    ["game date missing", { game_dates: { mobile_legends: "2026-09-25", cs2: "2026-09-26" } as never }],
    ["published flag not boolean", { teams_published: { mobile_legends: "yes", cs2: false, dota2: false } as never }],
    ["published map missing a game", { teams_published: { mobile_legends: false, cs2: false } as never }],
    ["registration_open not boolean", { registration_open: "true" as never }],
  ])("%s → invalid", async (_label, over) => {
    expect(await updateEventSettingsAction(settings(over))).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to publish a game that has no saved teams, naming the game, before any write", async () => {
    db.sch_teams.push(team(1, "mobile_legends", 1));
    const result = await updateEventSettingsAction(
      settings({ teams_published: { mobile_legends: true, cs2: true, dota2: false } }),
    );
    expect(result).toEqual({ error: "no_teams", game: "cs2" });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
    // The guard read the teams of exactly the ticked games.
    const guard = calls.find((c) => c.table === "sch_teams")!;
    expect(guard.filters).toEqual([{ kind: "in", col: "game", value: ["mobile_legends", "cs2"] }]);
  });

  it("publishing through settings writes the flags, audits the publish change once, and revalidates /sch/teams", async () => {
    db.sch_teams.push(team(1, "cs2", 1));
    expect(await updateEventSettingsAction(settings({ teams_published: { mobile_legends: false, cs2: true, dota2: false } }))).toEqual({ ok: true });
    expect(db.sch_event[0].teams_published).toEqual({ mobile_legends: false, cs2: true, dota2: false });
    expectLedgerClean(["SCH_EVENT_UPDATED", "SCH_TEAMS_PUBLISHED"]);
    expect(String(audits[0].detail)).toContain("published=cs2");
    expect(audits[1].detail).toBe("published=cs2 (via settings)");
    expect(revalidated()).toContain("/sch/teams");

    // Same flags again → no second SCH_TEAMS_PUBLISHED row.
    audits.length = 0;
    expect(await updateEventSettingsAction(settings({ teams_published: { mobile_legends: false, cs2: true, dota2: false } }))).toEqual({ ok: true });
    expect(audits.map((a) => a.action)).toEqual(["SCH_EVENT_UPDATED"]);
  });

  it("unpublishing needs no teams and is audited as a publish change", async () => {
    db.sch_event[0].teams_published = { cs2: true };
    expect(await updateEventSettingsAction(settings())).toEqual({ ok: true });
    expect(db.sch_event[0].teams_published).toEqual({ mobile_legends: false, cs2: false, dota2: false });
    expect(audits.map((a) => a.action)).toEqual(["SCH_EVENT_UPDATED", "SCH_TEAMS_PUBLISHED"]);
    expect(audits[1].detail).toBe("published=none (via settings)");
  });

  it("missing event row → conflict; write error → unavailable", async () => {
    db.sch_event = [];
    expect(await updateEventSettingsAction(settings())).toEqual({ error: "conflict" });
    db.sch_event = [event()];
    state.faults.push((c) => (c.op === "update" ? { message: "offline" } : null));
    expect(await updateEventSettingsAction(settings())).toEqual({ error: "unavailable" });
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── team save ───────────────────────── */

const SEED = 20260925;

/**
 * 12 paid Mobile Legends players (two full teams + two substitutes), one
 * pending ML player still holding a seat from an earlier draw, one paid CS2
 * player in a CS2 team, and two stale ML teams. Returns the preview exactly
 * as the console computes it (name-sorted pool).
 */
function seedDrawScenario() {
  db.sch_teams.push(team(1, "mobile_legends", 1), team(2, "mobile_legends", 2), team(3, "cs2", 1));
  for (let i = 1; i <= 12; i++) {
    db.sch_registrations.push(
      reg(i, {
        status: "paid",
        paid_at: "2026-09-02T00:00:00.000Z",
        rank_score: 10 + (i % 10) * 10,
        roles: [ML_ROLES[i % ML_ROLES.length]],
        team_id: i <= 10 ? tid(1 + (i % 2)) : null,
      }),
    );
  }
  db.sch_registrations.push(reg(13, { status: "pending", team_id: tid(1) }));
  db.sch_registrations.push(reg(14, { game: "cs2", status: "paid", roles: [], team_id: tid(3) }));

  const view = db.sch_registrations
    .filter((r) => r.game === "mobile_legends" && r.status === "paid")
    .map((r) => ({ id: r.id as string, name: r.full_name as string, score: r.rank_score as number, roles: r.roles as string[] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const preview = drawTeams(view, { seed: SEED, teamSize: SCH_TEAM_SIZE });
  expect(preview.teams).toHaveLength(2);
  expect(preview.substitutes).toHaveLength(2);
  // Make sure at least one substitute is currently seated, so "untouched" is observable.
  row(preview.substitutes[0].id)!.team_id = tid(2);
  const teamsIds = preview.teams.map((t) => t.players.map((p) => p.id));
  return { view, preview, playerIds: view.map((p) => p.id), teams: teamsIds };
}

describe("saveTeamsAction", () => {
  it("replaces the game's teams with exactly the previewed draw and re-links only the drafted players", async () => {
    const { preview, playerIds, teams: previewed } = seedDrawScenario();
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed })).toEqual({ ok: true });

    // Old ML teams gone, CS2 team untouched.
    expect(teams("mobile_legends").map((t) => t.id)).not.toEqual(expect.arrayContaining([tid(1), tid(2)]));
    expect(teams("cs2")).toEqual([expect.objectContaining({ id: tid(3) })]);

    // Inserted teams = preview teams, byte for byte on what the table stores.
    const insert = writes().find((c) => c.op === "insert" && c.table === "sch_teams")!;
    expect(insert.client).toBe("service");
    expect(insert.payload).toEqual(
      preview.teams.map((t) => ({ game: "mobile_legends", name: t.name, seed: t.seed, strength: t.strength, created_by: ORGANISER })),
    );
    expect(insert.returning).toContain("seed");

    // Membership = preview membership, per seed.
    const saved = teams("mobile_legends");
    expect(saved).toHaveLength(2);
    for (const t of preview.teams) {
      const savedTeam = saved.find((s) => s.seed === t.seed)!;
      expect(savedTeam).toMatchObject({ name: `Team ${t.seed}`, strength: t.strength });
      const members = db.sch_registrations.filter((r) => r.team_id === savedTeam.id).map((r) => r.id).sort();
      expect(members).toEqual(t.players.map((p) => p.id).sort());
    }

    // Substitutes: seat cleared by the FK, never named in an update.
    const linkCalls = writes().filter((c) => c.op === "update" && c.table === "sch_registrations");
    expect(linkCalls).toHaveLength(2);
    const linkedIds = linkCalls.flatMap((c) => c.filters.flatMap((f) => (f.kind === "in" ? (f.value as string[]) : [])));
    for (const sub of preview.substitutes) {
      expect(row(sub.id)?.team_id).toBeNull();
      expect(linkedIds).not.toContain(sub.id);
    }
    for (const c of linkCalls) {
      expect(c.filters).toEqual([{ kind: "in", col: "id", value: expect.any(Array) }]);
      expect(c.payload).toEqual({ team_id: expect.any(String) });
    }
    // The pending player lost the stale seat; the CS2 player kept theirs.
    expect(row(rid(13))?.team_id).toBeNull();
    expect(row(rid(14))?.team_id).toBe(tid(3));

    // Order: delete old → insert new → link.
    const order = writes().map((c) => `${c.op}:${c.table}`);
    expect(order.indexOf("delete:sch_teams")).toBeLessThan(order.indexOf("insert:sch_teams"));
    expect(order.indexOf("insert:sch_teams")).toBeLessThan(order.indexOf("update:sch_registrations"));
    const del = writes().find((c) => c.op === "delete")!;
    expect(del.filters).toEqual([{ kind: "eq", col: "game", value: "mobile_legends" }]);

    expectLedgerClean(["SCH_TEAMS_DRAWN"]);
    expect(audits[0].detail).toBe(`game=mobile_legends seed=${SEED} teams=2 substitutes=2 players=12`);
    expect(revalidated()).toEqual(expect.arrayContaining(["/sch/admin", "/sch", "/sch/teams"]));
  });

  it("only paid players of the chosen game are read, in created order, capped at 501", async () => {
    const { playerIds, teams: previewed } = seedDrawScenario();
    await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed });
    const pool = calls.find((c) => c.op === "select" && c.table === "sch_registrations")!;
    expect(pool.client).toBe("service");
    expect(pool.filters).toEqual([
      { kind: "eq", col: "game", value: "mobile_legends" },
      { kind: "in", col: "status", value: ["paid"] },
    ]);
    expect(pool.orders).toEqual([{ col: "created_at", ascending: true }]);
    expect(pool.limit).toBe(501);
  });

  it("a pool that changed since the preview → conflict, nothing written", async () => {
    const { playerIds, teams: previewed } = seedDrawScenario();
    // Someone else was marked paid after the organiser previewed.
    db.sch_registrations.push(reg(15, { status: "paid" }));
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed })).toEqual({ error: "conflict" });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(teams("mobile_legends").map((t) => t.id).sort()).toEqual([tid(1), tid(2)]);
  });

  it("a rank edit after the preview changes what the seed draws → conflict, nothing written", async () => {
    const { playerIds, teams: previewed, preview } = seedDrawScenario();
    // Same pool, same seed — but a ranked-up player reshapes the snake draft.
    const moved = preview.teams[0].players[0].id;
    row(moved)!.rank_score = 0;
    const redrawn = drawTeams(
      db.sch_registrations
        .filter((r) => r.game === "mobile_legends" && r.status === "paid")
        .map((r) => ({ id: r.id as string, name: r.full_name as string, score: r.rank_score as number, roles: r.roles as string[] })),
      { seed: SEED, teamSize: SCH_TEAM_SIZE },
    );
    const key = (ts: string[][]) => ts.map((t) => [...t].sort().join(",")).join("|");
    // Guard: the fixture must actually produce different rosters.
    expect(key(redrawn.teams.map((t) => t.players.map((p) => p.id)))).not.toBe(key(previewed));
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed })).toEqual({ error: "conflict" });
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("previewed rosters match regardless of member order inside a team", async () => {
    const { playerIds, teams: previewed } = seedDrawScenario();
    const shuffled = previewed.map((t) => [...t].reverse().map((id) => id.toUpperCase()));
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: shuffled })).toEqual({ ok: true });
  });

  it("a preview that names a player who is no longer eligible → conflict", async () => {
    const { playerIds, teams: previewed } = seedDrawScenario();
    row(playerIds[0])!.status = "rejected";
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed })).toEqual({ error: "conflict" });
    expect(writes()).toHaveLength(0);
  });

  it("fewer than one full team → invalid, nothing written", async () => {
    for (let i = 1; i <= 4; i++) db.sch_registrations.push(reg(i, { status: "paid" }));
    const ids = [rid(1), rid(2), rid(3), rid(4)];
    expect(await saveTeamsAction({ game: "mobile_legends", seed: 1, playerIds: ids, teams: [] })).toEqual({ error: "invalid" });
    expect(writes()).toHaveLength(0);
    expect(await saveTeamsAction({ game: "dota2", seed: 1, playerIds: [], teams: [] })).toEqual({ error: "invalid" });
    expect(writes()).toHaveLength(0);
  });

  it.each<[string, { game: string; seed: number; playerIds: string[]; teams: string[][] }]>([
    ["unknown game", { game: "valorant", seed: 1, playerIds: [], teams: [] }],
    ["negative seed", { game: "cs2", seed: -1, playerIds: [], teams: [] }],
    ["seed above uint32", { game: "cs2", seed: 0x1_0000_0000, playerIds: [], teams: [] }],
    ["fractional seed", { game: "cs2", seed: 1.5, playerIds: [], teams: [] }],
    ["non-uuid player id", { game: "cs2", seed: 1, playerIds: ["p1"], teams: [] }],
    ["too many player ids", { game: "cs2", seed: 1, playerIds: Array.from({ length: 501 }, (_, i) => rid(i)), teams: [] }],
    ["non-uuid roster id", { game: "cs2", seed: 1, playerIds: [], teams: [["p1"]] }],
    ["missing rosters", { game: "cs2", seed: 1, playerIds: [] } as unknown as { game: string; seed: number; playerIds: string[]; teams: string[][] }],
  ])("%s → invalid before any read", async (_label, input) => {
    expect(await saveTeamsAction(input)).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("insert and link failures map to unavailable without an audit row", async () => {
    const { playerIds, teams: previewed } = seedDrawScenario();
    state.faults = [(c) => (c.op === "insert" && c.table === "sch_teams" ? { message: "offline" } : null)];
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed })).toEqual({ error: "unavailable" });
    expect(audits).toHaveLength(0);

    calls.length = 0;
    db.sch_teams = [team(3, "cs2", 1)];
    state.faults = [(c) => (c.op === "update" && c.table === "sch_registrations" ? { message: "offline" } : null)];
    expect(await saveTeamsAction({ game: "mobile_legends", seed: SEED, playerIds, teams: previewed })).toEqual({ error: "unavailable" });
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── publish / unpublish ───────────────────────── */

describe("setTeamsPublishedAction", () => {
  it.each<[string, { game: string; published: boolean }]>([
    ["unknown game", { game: "valorant", published: true }],
    ["published not boolean", { game: "cs2", published: "yes" as never }],
    ["missing game", { game: undefined as never, published: true }],
  ])("%s → invalid", async (_label, input) => {
    expect(await setTeamsPublishedAction(input)).toEqual({ error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("publishing a game with no saved teams → invalid, nothing written", async () => {
    expect(await setTeamsPublishedAction({ game: "cs2", published: true })).toEqual({ error: "invalid" });
    const count = calls[0];
    expect(count).toMatchObject({ table: "sch_teams", op: "select", head: true, count: "exact" });
    expect(count.filters).toEqual([{ kind: "eq", col: "game", value: "cs2" }]);
    expect(writes()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("publish merges the flag into the existing map, audits, and revalidates /sch/teams", async () => {
    db.sch_teams.push(team(1, "cs2", 1));
    db.sch_event[0].teams_published = { mobile_legends: true };
    expect(await setTeamsPublishedAction({ game: "cs2", published: true })).toEqual({ ok: true });

    const update = writes().find((c) => c.table === "sch_event")!;
    expect(update.client).toBe("service");
    expect(update.payload).toEqual({ teams_published: { mobile_legends: true, cs2: true, dota2: false }, updated_by: ORGANISER });
    expect(update.filters).toEqual([{ kind: "eq", col: "id", value: 1 }]);
    expectLedgerClean(["SCH_TEAMS_PUBLISHED"]);
    expect(audits[0].detail).toBe("game=cs2 published=true");
    expect(revalidated()).toEqual(expect.arrayContaining(["/sch/admin", "/sch", "/sch/teams"]));
  });

  it("unpublish needs no teams, tolerates a malformed map, and revalidates /sch/teams", async () => {
    db.sch_event[0].teams_published = ["garbage"];
    expect(await setTeamsPublishedAction({ game: "dota2", published: false })).toEqual({ ok: true });
    expect(calls.some((c) => c.table === "sch_teams")).toBe(false);
    expect(db.sch_event[0].teams_published).toEqual({ mobile_legends: false, cs2: false, dota2: false });
    expect(audits[0].detail).toBe("game=dota2 published=false");
    expect(revalidated()).toContain("/sch/teams");
  });

  it("missing event row → conflict; update error → unavailable", async () => {
    db.sch_event = [];
    expect(await setTeamsPublishedAction({ game: "cs2", published: false })).toEqual({ error: "conflict" });
    db.sch_event = [event()];
    state.faults.push((c) => (c.op === "update" ? { message: "offline" } : null));
    expect(await setTeamsPublishedAction({ game: "cs2", published: false })).toEqual({ error: "unavailable" });
    expect(audits).toHaveLength(0);
  });
});

/* ───────────────────────── receipt sweep ───────────────────────── */

describe("sweepOrphanReceiptsAction", () => {
  it("asks sch_orphan_receipts with the service role, removes only submissions/* names, and audits the count", async () => {
    state.rpc.data = [
      { name: `submissions/${sid(1)}/receipt.jpg` },
      { name: "other/stray.jpg" }, // outside the receipt folder — never touched
      { name: 5 },
      null,
      "submissions/not-an-object",
      { name: `submissions/${sid(2)}/receipt.png` },
    ];
    expect(await sweepOrphanReceiptsAction()).toEqual({ ok: true, removed: 2 });

    expect(rpcCalls).toEqual([
      { client: "service", fn: "sch_orphan_receipts", args: { p_older_than_hours: 24, p_limit: 200 } },
    ]);
    expect(storageRemovals).toEqual([
      { client: "service", bucket: "sch-receipts", paths: [`submissions/${sid(1)}/receipt.jpg`, `submissions/${sid(2)}/receipt.png`] },
    ]);
    expectLedgerClean(["SCH_RECEIPTS_SWEPT"]);
    expect(audits[0].detail).toBe("removed=2 candidates=2 older_than=24h");
  });

  it("removes in batches of 100", async () => {
    state.rpc.data = Array.from({ length: 250 }, (_, i) => ({ name: `submissions/${sid(i)}/receipt.jpg` }));
    expect(await sweepOrphanReceiptsAction()).toEqual({ ok: true, removed: 250 });
    expect(storageRemovals.map((r) => r.paths.length)).toEqual([100, 100, 50]);
    expect(audits[0].detail).toBe("removed=250 candidates=250 older_than=24h");
  });

  it("nothing to sweep → removed 0, no storage call, still audited", async () => {
    state.rpc.data = [];
    expect(await sweepOrphanReceiptsAction()).toEqual({ ok: true, removed: 0 });
    expect(storageRemovals).toHaveLength(0);
    expect(audits[0].detail).toBe("removed=0 candidates=0 older_than=24h");
    state.rpc.data = { not: "an array" };
    expect(await sweepOrphanReceiptsAction()).toEqual({ ok: true, removed: 0 });
  });

  it("rpc error → unavailable with no removal and no audit; a removal error stops the sweep but keeps the ledger honest", async () => {
    state.rpc = { data: null, error: { message: "permission denied" } };
    expect(await sweepOrphanReceiptsAction()).toEqual({ error: "unavailable" });
    expect(storageRemovals).toHaveLength(0);
    expect(audits).toHaveLength(0);

    state.rpc = { data: [{ name: `submissions/${sid(1)}/receipt.jpg` }], error: null };
    state.storageRemoveError = { message: "storage down" };
    expect(await sweepOrphanReceiptsAction()).toEqual({ ok: true, removed: 0 });
    expect(audits[0].detail).toBe("removed=0 candidates=1 older_than=24h");
  });
});

/* ───────────────────────── ledger hygiene ───────────────────────── */

describe("audit ledger", () => {
  it("every mutation leaves one row with the organiser's identity, ids-only detail and the caller ip", async () => {
    db.sch_registrations.push(reg(1), reg(2, { status: "paid" }));
    db.sch_teams.push(team(1, "cs2", 1));
    state.rpc.data = [];

    await setRegistrationStatusAction({ id: rid(1), status: "paid" });
    await setCheckInAction({ id: rid(1), checkedIn: true });
    await setRegistrationNoteAction({ id: rid(1), note: "player1@example.test said they paid" });
    await updateRegistrationAction(edit({ in_game_id: "corrected-id" }));
    await deleteRegistrationAction({ id: rid(2) });
    await updateEventSettingsAction(settings());
    await setTeamsPublishedAction({ game: "cs2", published: true });
    await sweepOrphanReceiptsAction();

    expectLedgerClean([
      "SCH_REGISTRATION_STATUS",
      "SCH_REGISTRATION_CHECKIN",
      "SCH_REGISTRATION_NOTE",
      "SCH_REGISTRATION_EDITED",
      "SCH_REGISTRATION_DELETED",
      "SCH_EVENT_UPDATED",
      "SCH_TEAMS_PUBLISHED",
      "SCH_RECEIPTS_SWEPT",
    ]);
    for (const a of audits) expect(a.ip).toBe("203.0.113.7");
  });

  it("takes the first hop of a multi-hop x-forwarded-for", async () => {
    db.sch_registrations.push(reg(1));
    state.forwardedFor = "198.51.100.9, 10.0.0.2";
    await setCheckInAction({ id: rid(1), checkedIn: true });
    expect(audits[0].ip).toBe("198.51.100.9");
  });

  it("never hands a non-address to the inet ip column (that would reject the ledger row)", async () => {
    // audit_log.ip is `inet` (20260427000001_initial_schema.sql). The
    // receipt viewer route validates the header with isIP() before the
    // insert for exactly this reason; the console actions must too, or a
    // proxy that forwards a non-address turns every mutation into an
    // unlogged one (the insert fails and audit() swallows the error).
    db.sch_registrations.push(reg(1));
    state.forwardedFor = "unknown";
    expect(await setCheckInAction({ id: rid(1), checkedIn: true })).toEqual({ ok: true });
    expect(audits).toHaveLength(1);
    const ip = audits[0].ip;
    expect(ip === null || isIP(String(ip)) !== 0).toBe(true);
  });
});

/* ───────────────────────── close-out ───────────────────────── */

describe("closeOutEventAction", () => {
  const AFTER = new Date("2026-09-28T00:00:00+09:00").getTime();

  function seedEvent() {
    db.sch_registrations.push(
      reg(1, { submission_id: sid(1), receipt_path: `submissions/${sid(1)}/receipt.jpg` }),
      reg(2, { game: "cs2", submission_id: sid(1), receipt_path: `submissions/${sid(1)}/receipt.jpg` }),
      reg(3, { receipt_path: null, receipt_url: "https://drive.google.com/open?id=x" }),
    );
    db.sch_teams.push(team(1, "mobile_legends", 1), team(2, "cs2", 1));
  }

  afterEach(() => jest.useRealTimers());

  it("organisers (no second factor) are refused before any read", async () => {
    seedEvent();
    expect(await closeOutEventAction({ confirm: "DELETE" })).toEqual({ error: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("needs the typed word and a fresh TOTP step-up", async () => {
    state.role = "admin";
    expect(await closeOutEventAction({ confirm: "delete" })).toEqual({ error: "invalid" });
    state.reauthFresh = false;
    expect(await closeOutEventAction({ confirm: "DELETE" })).toEqual({ error: "REAUTH_REQUIRED" });
    expect(calls).toHaveLength(0);
  });

  it("refuses before the day after the last game (KST), writing nothing", async () => {
    state.role = "admin";
    seedEvent();
    jest.useFakeTimers({ now: new Date("2026-09-27T23:59:00+09:00") });
    expect(await closeOutEventAction({ confirm: "DELETE" })).toEqual({ error: "too_early" });
    expect(writes()).toHaveLength(0);
    expect(storageRemovals).toHaveLength(0);
    expect(db.sch_registrations).toHaveLength(3);
  });

  it("closes the form, removes receipts BEFORE rows, deletes rows and teams, and audits counts only", async () => {
    state.role = "admin";
    seedEvent();
    state.rpc.data = [{ name: `submissions/${sid(9)}/abandoned.png` }, { name: "elsewhere/x.png" }];
    jest.useFakeTimers({ now: AFTER });
    expect(await closeOutEventAction({ confirm: "DELETE" })).toEqual({ ok: true, registrations: 3, teams: 2, receipts: 2 });

    expect(db.sch_registrations).toHaveLength(0);
    expect(db.sch_teams).toHaveLength(0);
    expect(db.sch_event[0]).toMatchObject({
      registration_open: false,
      teams_published: { mobile_legends: false, cs2: false, dota2: false },
    });
    expect(storageRemovals).toEqual([
      { client: "service", bucket: "sch-receipts", paths: [`submissions/${sid(1)}/receipt.jpg`] },
      { client: "service", bucket: "sch-receipts", paths: [`submissions/${sid(9)}/abandoned.png`] },
    ]);
    const order = calls.filter((c) => c.op !== "select").map((c) => `${c.op}:${c.table}`);
    expect(order.slice(0, 3)).toEqual(["update:sch_event", "delete:sch_registrations", "delete:sch_teams"]);
    expectLedgerClean(["SCH_EVENT_CLOSED"]);
    expect(audits[0].detail).toBe("registrations=3 teams=2 receipts=2");
    expect(jest.mocked(scheduleSecurityEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SCH_EVENT_CLOSED", detail: "role=admin registrations=3 teams=2 receipts=2" }),
    );
  });

  it("a failed receipt removal keeps every row (their paths are the only way to find the images)", async () => {
    state.role = "admin";
    seedEvent();
    state.storageRemoveError = { message: "offline" };
    jest.useFakeTimers({ now: AFTER });
    expect(await closeOutEventAction({ confirm: "DELETE" })).toEqual({ error: "unavailable" });
    expect(db.sch_registrations).toHaveLength(3);
    expect(db.sch_teams).toHaveLength(2);
    expect(audits).toHaveLength(0);
  });
});
