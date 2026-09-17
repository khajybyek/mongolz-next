/**
 * Behavioural tests for the public SCH Esports server actions
 * (app/sch/actions.ts): event loader, receipt-upload minting and the
 * submit path. Storage, the database, the rate limiter and the request
 * context are hand-written in-memory fakes at the module boundary; the
 * action code itself runs for real.
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { SCH_PREPARE_LIMIT, SCH_SUBMIT_LIMIT } from "@/lib/sch/submit";
import { RECEIPT_MAX_BYTES, SCH_RECEIPT_BUCKET, UUID_V4_RE, receiptPath } from "@/lib/sch/schema";
import { prepareReceiptUpload, readSchEvent, submitSchRegistration } from "@/app/sch/actions";

/* ─────────────────────────── fakes ─────────────────────────── */

type Row = Record<string, unknown>;
type DbError = { code?: string; details?: string; message: string };
type Payload<T = unknown> = { data: T; error: DbError | null };

type StorageObject = { name: string; metadata?: Record<string, unknown> | null };

const state = {
  request: { ip: "203.0.113.7, 10.0.0.1", userAgent: "jest-ua" as string | null },
  /** `count: -1` is how checkRateLimit reports "counter unreachable" (fail-closed). */
  rate: { ok: true, throws: false, count: 99 },
  event: {
    row: null as Row | null,
    error: null as DbError | null,
    throws: false,
  },
  registrations: {
    rows: [] as Row[],
    selectError: null as DbError | null,
    /** Runs at insert time (can mutate `rows` to model a race) and returns the insert error. */
    onInsert: null as null | ((rows: Row[]) => DbError | null),
  },
  storage: {
    signed: { data: { token: "signed-token", signedUrl: "https://storage.test/upload?token=signed-token" }, error: null } as
      | Payload<{ token?: string; signedUrl?: string } | null>
      | "throw",
    list: { data: [] as StorageObject[], error: null } as Payload<StorageObject[] | null> | "throw",
  },
};

const calls = {
  selects: [] as { table: string; columns: string; filters: [string, string, unknown][] }[],
  inserts: [] as Row[][],
  signedUrl: [] as { bucket: string; path: string; opts: unknown }[],
  list: [] as { bucket: string; folder: string; opts: unknown }[],
  remove: [] as { bucket: string; paths: string[] }[],
};

function resetState() {
  state.request = { ip: "203.0.113.7, 10.0.0.1", userAgent: "jest-ua" };
  state.rate = { ok: true, throws: false, count: 99 };
  state.event = { row: openEventRow(), error: null, throws: false };
  state.registrations = { rows: [], selectError: null, onInsert: null };
  state.storage = {
    signed: { data: { token: "signed-token", signedUrl: "https://storage.test/upload?token=signed-token" }, error: null },
    list: { data: [], error: null },
  };
  calls.selects = [];
  calls.inserts = [];
  calls.signedUrl = [];
  calls.list = [];
  calls.remove = [];
  jest.clearAllMocks();
}

function openEventRow(over: Row = {}): Row {
  return {
    id: 1,
    title: "  Chuseok test  ",
    intro: "Rules text",
    registration_open: true,
    registration_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    fee_krw: 7000,
    fee_mnt: 15000,
    payment_info: "Bank line",
    contact: "@org",
    game_dates: { mobile_legends: "2026-10-01" },
    teams_published: { cs2: true },
    updated_at: null,
    updated_by: null,
    ...over,
  };
}

function project(row: Row, columns: string): Row {
  const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0 || cols.includes("*")) return { ...row };
  return Object.fromEntries(cols.map((c) => [c, row[c]]));
}

function registrationsQuery(columns: string) {
  const filters: [string, string, unknown][] = [];
  calls.selects.push({ table: "sch_registrations", columns, filters });
  const resolve = (): Payload<Row[] | null> => {
    if (state.registrations.selectError) return { data: null, error: state.registrations.selectError };
    const rows = state.registrations.rows.filter((r) =>
      filters.every(([op, col, value]) =>
        op === "eq" ? r[col] === value : (value as unknown[]).includes(r[col]),
      ),
    );
    return { data: rows.map((r) => project(r, columns)), error: null };
  };
  const builder = {
    eq(col: string, value: unknown) {
      filters.push(["eq", col, value]);
      return builder;
    },
    in(col: string, values: unknown[]) {
      filters.push(["in", col, values]);
      return builder;
    },
    maybeSingle: async () => {
      const r = resolve();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    then: (onFulfilled: (v: Payload<Row[] | null>) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return builder;
}

function eventQuery(columns: string) {
  const filters: [string, string, unknown][] = [];
  calls.selects.push({ table: "sch_event", columns, filters });
  const builder = {
    eq(col: string, value: unknown) {
      filters.push(["eq", col, value]);
      return builder;
    },
    maybeSingle: async () => {
      if (state.event.throws) throw new Error("connection reset");
      return { data: state.event.error ? null : state.event.row, error: state.event.error };
    },
  };
  return builder;
}

function fakeServiceClient() {
  return {
    from: (table: string) => ({
      select: (columns = "*") => {
        if (table === "sch_event") return eventQuery(columns);
        if (table === "sch_registrations") return registrationsQuery(columns);
        throw new Error(`unexpected table ${table}`);
      },
      insert: async (rows: Row[]) => {
        if (table !== "sch_registrations") throw new Error(`unexpected insert into ${table}`);
        calls.inserts.push(rows);
        const error = state.registrations.onInsert ? state.registrations.onInsert(rows) : null;
        if (!error) state.registrations.rows.push(...rows);
        return { data: null, error };
      },
      delete: () => {
        throw new Error("delete is not part of the public path");
      },
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string, opts?: unknown) => {
          calls.signedUrl.push({ bucket, path, opts });
          if (state.storage.signed === "throw") throw new Error("storage down");
          return state.storage.signed;
        },
        list: async (folder: string, opts?: unknown) => {
          calls.list.push({ bucket, folder, opts });
          if (state.storage.list === "throw") throw new Error("storage down");
          return state.storage.list;
        },
        remove: async (paths: string[]) => {
          calls.remove.push({ bucket, paths });
          return { data: null, error: null };
        },
      }),
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => fakeServiceClient(),
  createClient: async () => {
    throw new Error("the public path must not use the RLS client");
  },
}));

jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: jest.fn(async () => {
    if (state.rate.throws) throw new Error("counter offline");
    return state.rate.ok
      ? { ok: true, count: 1, resetSec: 3600 }
      : { ok: false, count: state.rate.count, resetSec: state.rate.count < 0 ? 60 : 3600, message: state.rate.count < 0 ? "rl_unavailable" : "rl_too_many_attempts" };
  }),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

jest.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers();
    if (state.request.ip !== null) h.set("x-forwarded-for", state.request.ip);
    if (state.request.userAgent !== null) h.set("user-agent", state.request.userAgent);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

/* ─────────────────────────── fixtures ─────────────────────────── */

const SUBMISSION_ID = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const PATH_JPG = `submissions/${SUBMISSION_ID}/receipt.jpg`;
const EMAIL = "player@sch.ac.kr";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const mlEntry = {
  game: "mobile_legends",
  rank: "Epic",
  roles: ["Jungle", "Roamer"],
  in_game_id: "12345678 (1234)",
};
const dotaEntry = {
  game: "dota2",
  rank: "Ancient",
  roles: ["Position 1 (Carry)"],
  steam_url: "steamcommunity.com/id/player_one",
};
const cs2Entry = {
  game: "cs2",
  premier_rank: "15000",
  steam_url: "https://steamcommunity.com/profiles/76561198000000000",
  faceit: "yes",
};

function submission(over: Row = {}): Row {
  return {
    submission_id: SUBMISSION_ID,
    receipt_path: PATH_JPG,
    person: { full_name: "Bat Bold", email: "Player@SCH.ac.kr", facebook: "fb.com/batbold", phone: "" },
    entries: [mlEntry, dotaEntry],
    website: "",
    ...over,
  };
}

function receiptInBucket(over: Partial<StorageObject> = {}, meta: Record<string, unknown> = {}) {
  state.storage.list = {
    data: [{ name: "receipt.jpg", metadata: { size: 123_456, mimetype: "image/jpeg", ...meta }, ...over }],
    error: null,
  };
}

function storedRow(over: Row = {}): Row {
  return {
    submission_id: SUBMISSION_ID,
    game: "mobile_legends",
    email: EMAIL,
    full_name: "Bat Bold",
    ...over,
  };
}

beforeEach(resetState);

/* ─────────────────────────── readSchEvent ─────────────────────────── */

describe("readSchEvent", () => {
  it("returns the defaults (open, 5 000 / 12 000, no payment info) when the read errors", async () => {
    state.event.error = { message: "permission denied" };
    const view = await readSchEvent();
    expect(view).toMatchObject({
      loaded: false,
      isOpen: true,
      feeKrw: 5000,
      feeMnt: 12000,
      paymentInfo: null,
      deadline: null,
      gameDates: { mobile_legends: "2026-09-25", cs2: "2026-09-26", dota2: "2026-09-27" },
      teamsPublished: { mobile_legends: false, cs2: false, dota2: false },
    });
  });

  it("returns the defaults when the row is missing or the client throws", async () => {
    state.event.row = null;
    expect((await readSchEvent()).loaded).toBe(false);
    state.event.throws = true;
    expect((await readSchEvent()).loaded).toBe(false);
  });

  it("reads the singleton row (id = 1) and trims the organiser texts", async () => {
    const view = await readSchEvent();
    expect(calls.selects[0]).toMatchObject({ table: "sch_event", filters: [["eq", "id", 1]] });
    expect(view).toMatchObject({
      loaded: true,
      title: "Chuseok test",
      intro: "Rules text",
      isOpen: true,
      feeKrw: 7000,
      feeMnt: 15000,
      paymentInfo: "Bank line",
      contact: "@org",
    });
  });

  it("falls back to the default title and null texts when the organiser blanked them", async () => {
    state.event.row = openEventRow({ title: "   ", intro: "  ", payment_info: "", contact: null });
    const view = await readSchEvent();
    expect(view.title).toBe("Chuseok 2026 SCH Esport тэмцээн");
    expect(view.intro).toBeNull();
    expect(view.paymentInfo).toBeNull();
    expect(view.contact).toBeNull();
  });

  it("treats a deadline in the past as closed even when the switch is on", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    state.event.row = openEventRow({ registration_open: true, registration_deadline: past });
    const view = await readSchEvent();
    expect(view.isOpen).toBe(false);
    expect(view.deadline).toBe(past);
  });

  it("honours the organiser's switch regardless of the deadline", async () => {
    state.event.row = openEventRow({ registration_open: false });
    expect((await readSchEvent()).isOpen).toBe(false);
    state.event.row = openEventRow({ registration_open: true, registration_deadline: null });
    expect((await readSchEvent()).isOpen).toBe(true);
  });

  it("ignores an unparsable deadline instead of closing registration", async () => {
    state.event.row = openEventRow({ registration_deadline: "not-a-date" });
    expect((await readSchEvent()).isOpen).toBe(true);
  });

  it("merges jsonb game_dates over the defaults and drops bad keys/values", async () => {
    state.event.row = openEventRow({
      game_dates: { mobile_legends: "2026-10-01", cs2: "1/10/2026", valorant: "2026-10-02", dota2: 20261003 },
    });
    expect((await readSchEvent()).gameDates).toEqual({
      mobile_legends: "2026-10-01",
      cs2: "2026-09-26",
      dota2: "2026-09-27",
    });
  });

  it("only accepts boolean true for teams_published", async () => {
    state.event.row = openEventRow({ teams_published: { cs2: true, dota2: "true", mobile_legends: 1, lol: true } });
    expect((await readSchEvent()).teamsPublished).toEqual({ mobile_legends: false, cs2: true, dota2: false });
  });

  it("tolerates non-object jsonb (arrays, strings, null)", async () => {
    for (const bad of [[], "x", null, 5]) {
      state.event.row = openEventRow({ game_dates: bad, teams_published: bad });
      const view = await readSchEvent();
      expect(view.gameDates).toEqual({ mobile_legends: "2026-09-25", cs2: "2026-09-26", dota2: "2026-09-27" });
      expect(view.teamsPublished).toEqual({ mobile_legends: false, cs2: false, dota2: false });
    }
  });
});

/* ─────────────────────────── prepareReceiptUpload ─────────────────────────── */

describe("prepareReceiptUpload", () => {
  it.each([
    ["gif mime", { mime: "image/gif", bytes: 100 }],
    ["svg mime", { mime: "image/svg+xml", bytes: 100 }],
    ["missing mime", { bytes: 100 }],
    ["zero bytes", { mime: "image/png", bytes: 0 }],
    ["negative bytes", { mime: "image/png", bytes: -1 }],
    ["fractional bytes", { mime: "image/png", bytes: 1.5 }],
    ["string bytes", { mime: "image/png", bytes: "100" }],
    ["over the limit", { mime: "image/png", bytes: RECEIPT_MAX_BYTES + 1 }],
    ["null input", null],
    ["prototype key", { mime: "constructor", bytes: 100 }],
    // HEIC is a stored mime (legacy rows) but no longer an UPLOAD mime: only
    // Safari decodes it, so the organiser could never view the receipt.
    ["heic mime", { mime: "image/heic", bytes: 100 }],
  ])("rejects %s as invalid before touching the event, limiter or storage", async (_label, input) => {
    expect(await prepareReceiptUpload(input)).toEqual({ error: "invalid" });
    expect(calls.selects).toHaveLength(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(calls.signedUrl).toHaveLength(0);
  });

  it("accepts exactly the limit", async () => {
    const res = await prepareReceiptUpload({ mime: "image/png", bytes: RECEIPT_MAX_BYTES });
    expect(res).toMatchObject({ ok: true });
  });

  it("refuses when registration is closed, without spending rate budget", async () => {
    state.event.row = openEventRow({ registration_open: false });
    expect(await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 })).toEqual({ error: "closed" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(calls.signedUrl).toHaveLength(0);
  });

  it("refuses when the deadline has passed", async () => {
    state.event.row = openEventRow({ registration_deadline: new Date(Date.now() - 1000).toISOString() });
    expect(await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 })).toEqual({ error: "closed" });
  });

  it("rate-limits by the sha256 of the first forwarded ip using the prepare budget", async () => {
    state.rate.ok = false;
    expect(await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 })).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(`sch:${sha256("203.0.113.7")}`, SCH_PREPARE_LIMIT);
    expect(calls.signedUrl).toHaveLength(0);
  });

  it("uses the 'unknown' bucket when no forwarded ip is present", async () => {
    state.request.ip = null as unknown as string;
    await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 });
    expect(checkRateLimit).toHaveBeenCalledWith(`sch:${sha256("unknown")}`, SCH_PREPARE_LIMIT);
  });

  it("reports unavailable — not rate_limited — when the counter is unreachable (count -1)", async () => {
    // checkRateLimit fails closed with count: -1 when the database cannot be
    // asked. That is an outage, not the registrant's quota: the copy must say
    // "temporarily unavailable, answers kept", never "wait an hour".
    state.rate = { ok: false, throws: false, count: -1 };
    expect(await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 })).toEqual({ error: "unavailable" });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(calls.signedUrl).toHaveLength(0);
  });

  it("still refuses (as unavailable) when the limiter throws", async () => {
    state.rate.throws = true;
    expect(await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 })).toEqual({ error: "unavailable" });
    expect(calls.signedUrl).toHaveLength(0);
  });

  it("mints the signed URL with upsert so a retried PUT can overwrite a landed-but-unacknowledged object", async () => {
    // storage-js only puts x-upsert into the token when asked at mint time;
    // the x-upsert header the browser adds to its PUT is ignored. Without
    // this a retry after a lost response answers 409 forever.
    const res = await prepareReceiptUpload({ mime: "image/jpeg", bytes: 100 });
    expect(res).toMatchObject({ ok: true });
    expect(calls.signedUrl).toEqual([{ bucket: SCH_RECEIPT_BUCKET, path: expect.stringMatching(/^submissions\//), opts: { upsert: true } }]);
  });

  it("mints a lower-case v4 id, the matching receipt path and returns only the signed-url fields", async () => {
    const res = await prepareReceiptUpload({ mime: "image/webp", bytes: 4096 });
    if (!("ok" in res)) throw new Error(`expected ok, got ${JSON.stringify(res)}`);
    expect(Object.keys(res).sort()).toEqual(["ok", "path", "signedUrl", "submissionId", "token"]);
    expect(res.submissionId).toMatch(UUID_V4_RE);
    expect(res.submissionId).toBe(res.submissionId.toLowerCase());
    expect(res.path).toBe(receiptPath(res.submissionId, "image/webp"));
    expect(res.path).toBe(`submissions/${res.submissionId}/receipt.webp`);
    expect(res.token).toBe("signed-token");
    expect(res.signedUrl).toBe("https://storage.test/upload?token=signed-token");
    expect(calls.signedUrl).toEqual([{ bucket: SCH_RECEIPT_BUCKET, path: res.path, opts: { upsert: true } }]);
    // Nothing that looks like a service key or the bucket policy leaks.
    const serialised = JSON.stringify(res);
    expect(serialised).not.toMatch(/service_role|eyJ|SUPABASE/i);
  });

  it("mints a fresh id per call", async () => {
    const a = await prepareReceiptUpload({ mime: "image/jpeg", bytes: 10 });
    const b = await prepareReceiptUpload({ mime: "image/jpeg", bytes: 10 });
    if (!("ok" in a) || !("ok" in b)) throw new Error("expected ok");
    expect(a.submissionId).not.toBe(b.submissionId);
  });

  it.each([
    ["error", { data: null, error: { message: "bucket missing" } }],
    ["empty token", { data: { token: "", signedUrl: "https://x" }, error: null }],
    ["missing signedUrl", { data: { token: "t" }, error: null }],
    ["throw", "throw"],
  ] as const)("reports unavailable when the signed url cannot be minted (%s)", async (_label, signed) => {
    state.storage.signed = signed as typeof state.storage.signed;
    expect(await prepareReceiptUpload({ mime: "image/png", bytes: 100 })).toEqual({ error: "unavailable" });
  });
});

/* ─────────────────────────── submitSchRegistration ─────────────────────────── */

describe("submitSchRegistration — validation gate", () => {
  it("rejects a filled honeypot without reading or writing anything", async () => {
    expect(await submitSchRegistration(submission({ website: "http://spam.example" }))).toEqual({ error: "invalid" });
    expect(calls.selects).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.list).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["no entries", { entries: [] }],
    ["duplicate games", { entries: [mlEntry, mlEntry] }],
    ["receipt path of another submission", { receipt_path: "submissions/ffffffff-ffff-4fff-8fff-ffffffffffff/receipt.jpg" }],
    ["receipt path with a bad extension", { receipt_path: `submissions/${SUBMISSION_ID}/receipt.gif` }],
    ["upper-case receipt folder", { receipt_path: `submissions/${SUBMISSION_ID.toUpperCase()}/receipt.jpg` }],
    ["bad steam url", { entries: [{ ...dotaEntry, steam_url: "https://evil.example/steam" }] }],
    ["missing role", { entries: [{ ...mlEntry, roles: [] }] }],
    ["bad email", { person: { full_name: "Bat Bold", email: "nope", facebook: "fb" } }],
    ["not an object", null],
  ])("rejects %s as invalid", async (_label, over) => {
    expect(await submitSchRegistration(over === null ? null : submission(over as Row))).toMatchObject({ error: "invalid" });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.list).toHaveLength(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it.each<[string, Row, string[]]>([
    ["bad email", { person: { full_name: "Bat Bold", email: "a@b.c", facebook: "fb.com/x" } }, ["email"]],
    ["cyrillic local part", { person: { full_name: "Bat Bold", email: "батаа@example.com", facebook: "fb.com/x" } }, ["email"]],
    ["short name + bad email", { person: { full_name: "B", email: "nope", facebook: "fb.com/x" } }, ["full_name", "email"]],
    ["bad dota steam url", { entries: [mlEntry, { ...dotaEntry, steam_url: "https://evil.example/steam" }] }, ["dota_steam"]],
    ["bad cs2 steam url", { entries: [{ ...cs2Entry, steam_url: "nope" }] }, ["cs2_steam"]],
    ["missing ml role", { entries: [{ ...mlEntry, roles: [] }] }, ["ml_roles"]],
    ["unknown ml rank", { entries: [{ ...mlEntry, rank: "Diamond" }] }, ["ml_rank"]],
    ["receipt path of another submission", { receipt_path: "submissions/ffffffff-ffff-4fff-8fff-ffffffffffff/receipt.jpg" }, ["receipt"]],
    ["no entries", { entries: [] }, ["games"]],
    ["duplicate games", { entries: [mlEntry, mlEntry] }, ["games"]],
  ])("names the rejected field(s) for %s so the form can highlight them", async (_label, over, fields) => {
    expect(await submitSchRegistration(submission(over))).toEqual({ error: "invalid", fields });
  });

  it("does not name a field for the honeypot (nothing for a bot to fix)", async () => {
    expect(await submitSchRegistration(submission({ website: "x" }))).toEqual({ error: "invalid" });
  });
});

describe("submitSchRegistration — happy path", () => {
  it("writes one row per game in a single insert with the receipt facts and hashed request context", async () => {
    receiptInBucket();
    state.request.userAgent = "x".repeat(500);

    const res = await submitSchRegistration(submission());
    expect(res).toEqual({
      ok: true,
      submissionId: SUBMISSION_ID,
      games: ["mobile_legends", "dota2"],
      feeKrw: 7000,
      feeMnt: 15000,
      paymentInfo: "Bank line",
    });

    expect(calls.inserts).toHaveLength(1);
    const rows = calls.inserts[0]!;
    expect(rows).toHaveLength(2);

    const ipHash = sha256("203.0.113.7");
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    const common = {
      submission_id: SUBMISSION_ID,
      full_name: "Bat Bold",
      email: EMAIL, // lower-cased by the schema
      facebook: "fb.com/batbold",
      phone: null,
      status: "pending",
      ip_hash: ipHash,
      user_agent: "x".repeat(300),
      receipt_path: PATH_JPG,
      receipt_mime: "image/jpeg",
      receipt_bytes: 123_456,
    };
    expect(rows[0]).toEqual({
      ...common,
      game: "mobile_legends",
      in_game_id: "12345678 (1234)",
      rank_label: "Epic",
      rank_score: 50, // Epic = 5th of 10 on the ladder
      roles: ["Jungle", "Roamer"],
      answers: {},
    });
    expect(rows[1]).toEqual({
      ...common,
      game: "dota2",
      in_game_id: "https://steamcommunity.com/id/player_one", // scheme added by the schema
      rank_label: "Ancient",
      rank_score: 75, // Ancient = 6th of 8
      roles: ["Position 1 (Carry)"],
      answers: {},
    });
    for (const row of rows) {
      expect(row.ip_hash).not.toContain("203.0.113.7");
      expect(row).not.toHaveProperty("ip");
      expect((row.user_agent as string).length).toBeLessThanOrEqual(300);
    }

    expect(revalidatePath).toHaveBeenCalledWith("/sch/admin");
    expect(calls.remove).toHaveLength(0);
  });

  it("stores CS2 answers (premier + faceit), a Premier rank label and an empty roles list", async () => {
    receiptInBucket();
    const res = await submitSchRegistration(submission({ entries: [cs2Entry] }));
    expect(res).toMatchObject({ ok: true, games: ["cs2"] });
    const [row] = calls.inserts[0]!;
    expect(row).toMatchObject({
      game: "cs2",
      in_game_id: "https://steamcommunity.com/profiles/76561198000000000",
      rank_label: "Premier 15000",
      rank_score: 50, // 15 000 / 30 000
      roles: [],
      answers: { premier_rank: "15000", faceit: "yes" },
    });
  });

  it("stores a blank CS2 premier rank as null with the unknown score", async () => {
    receiptInBucket();
    await submitSchRegistration(submission({ entries: [{ ...cs2Entry, premier_rank: "  " }] }));
    const [row] = calls.inserts[0]!;
    expect(row).toMatchObject({ rank_label: null, rank_score: 40, answers: { premier_rank: null, faceit: "yes" } });
  });

  it("returns games in ladder order (ML, CS2, Dota 2) whatever order they were entered", async () => {
    receiptInBucket();
    const res = await submitSchRegistration(submission({ entries: [dotaEntry, cs2Entry, mlEntry] }));
    expect(res).toMatchObject({ ok: true, games: ["mobile_legends", "cs2", "dota2"] });
    expect(calls.inserts[0]!.map((r) => r.game)).toEqual(["dota2", "cs2", "mobile_legends"]);
  });

  it("verifies the receipt in the submission folder of the private bucket with the same limiter key as prepare", async () => {
    receiptInBucket();
    await submitSchRegistration(submission());
    expect(calls.list).toEqual([{ bucket: SCH_RECEIPT_BUCKET, folder: `submissions/${SUBMISSION_ID}`, opts: { limit: 20 } }]);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(`sch:${sha256("203.0.113.7")}`, SCH_SUBMIT_LIMIT);
  });

  it("derives the receipt mime from the path extension when storage reports none", async () => {
    receiptInBucket({ name: "receipt.png" }, { mimetype: undefined });
    await submitSchRegistration(submission({ receipt_path: `submissions/${SUBMISSION_ID}/receipt.png` }));
    expect(calls.inserts[0]![0]).toMatchObject({ receipt_mime: "image/png", receipt_bytes: 123_456 });
  });

  it("accepts a stringly-typed size from storage metadata", async () => {
    receiptInBucket({}, { size: "2048" });
    await submitSchRegistration(submission());
    expect(calls.inserts[0]![0]).toMatchObject({ receipt_bytes: 2048 });
  });

  it("stores null for a missing user agent", async () => {
    receiptInBucket();
    state.request.userAgent = null;
    await submitSchRegistration(submission());
    expect(calls.inserts[0]![0]).toMatchObject({ user_agent: null });
  });

  it("still submits with default fees when the event row cannot be read", async () => {
    receiptInBucket();
    state.event.error = { message: "offline" };
    const res = await submitSchRegistration(submission());
    expect(res).toMatchObject({ ok: true, feeKrw: 5000, feeMnt: 12000, paymentInfo: null });
  });
});

describe("submitSchRegistration — receipt", () => {
  it("reports receipt_missing (keeping nothing) when no object is in the folder", async () => {
    state.storage.list = { data: [], error: null };
    expect(await submitSchRegistration(submission())).toEqual({ error: "receipt_missing" });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
  });

  it("reports receipt_missing when the folder only holds a different name", async () => {
    receiptInBucket({ name: "receipt.png" });
    expect(await submitSchRegistration(submission())).toEqual({ error: "receipt_missing" });
  });

  it.each([
    ["zero size", { size: 0 }],
    ["over the limit", { size: RECEIPT_MAX_BYTES + 1 }],
    ["non-numeric size", { size: "big" }],
  ])("treats an object with %s as missing", async (_label, meta) => {
    receiptInBucket({}, meta);
    expect(await submitSchRegistration(submission())).toEqual({ error: "receipt_missing" });
    expect(calls.inserts).toHaveLength(0);
  });

  it("reports unavailable (not missing) when storage returns an error or throws, keeping the receipt", async () => {
    state.storage.list = { data: null, error: { message: "storage 500" } };
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
    state.storage.list = "throw";
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
  });
});

describe("submitSchRegistration — gates", () => {
  it("removes the receipt and refuses when registration is closed", async () => {
    receiptInBucket();
    state.event.row = openEventRow({ registration_open: false });
    expect(await submitSchRegistration(submission())).toEqual({ error: "closed" });
    expect(calls.remove).toEqual([{ bucket: SCH_RECEIPT_BUCKET, paths: [PATH_JPG] }]);
    expect(calls.inserts).toHaveLength(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("refuses after the deadline and removes the receipt", async () => {
    receiptInBucket();
    state.event.row = openEventRow({ registration_deadline: new Date(Date.now() - 1).toISOString() });
    expect(await submitSchRegistration(submission())).toEqual({ error: "closed" });
    expect(calls.remove).toHaveLength(1);
  });

  it("keeps the receipt when rate limited so the retry does not re-upload", async () => {
    receiptInBucket();
    state.rate.ok = false;
    expect(await submitSchRegistration(submission())).toEqual({ error: "rate_limited" });
    expect(calls.remove).toHaveLength(0);
    expect(calls.list).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });

  it("reports unavailable — not rate_limited — when the counter is unreachable, keeping the receipt", async () => {
    receiptInBucket();
    state.rate = { ok: false, throws: false, count: -1 };
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.remove).toHaveLength(0); // the retry only re-submits
    expect(calls.list).toHaveLength(0);
  });

  it("still refuses (as unavailable) when the limiter throws, keeping the receipt", async () => {
    receiptInBucket();
    state.rate.throws = true;
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
  });
});

describe("submitSchRegistration — duplicates", () => {
  it("names the clashing game from the pre-check and does not insert", async () => {
    receiptInBucket();
    state.registrations.rows = [
      storedRow({ submission_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", game: "dota2" }),
      storedRow({ submission_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", game: "cs2" }),
    ];
    expect(await submitSchRegistration(submission({ entries: [mlEntry, dotaEntry] }))).toEqual({
      error: "duplicate",
      game: "dota2",
    });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
    const dup = calls.selects.find((s) => s.table === "sch_registrations" && s.filters.some(([, c]) => c === "email"));
    expect(dup?.filters).toEqual([
      ["eq", "email", EMAIL],
      ["in", "game", ["mobile_legends", "dota2"]],
    ]);
  });

  it("names the first entered game when several clash", async () => {
    receiptInBucket();
    state.registrations.rows = [
      storedRow({ submission_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", game: "dota2" }),
      storedRow({ submission_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", game: "mobile_legends" }),
    ];
    expect(await submitSchRegistration(submission({ entries: [dotaEntry, mlEntry] }))).toEqual({
      error: "duplicate",
      game: "dota2",
    });
  });

  it("lets the same person register a game they have not taken yet", async () => {
    receiptInBucket();
    state.registrations.rows = [storedRow({ submission_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", game: "cs2" })];
    expect(await submitSchRegistration(submission({ entries: [mlEntry] }))).toMatchObject({ ok: true, games: ["mobile_legends"] });
  });

  it("reports unavailable when the pre-check itself fails", async () => {
    receiptInBucket();
    state.registrations.selectError = { message: "offline" };
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
    expect(calls.inserts).toHaveLength(0);
  });
});

describe("submitSchRegistration — replay", () => {
  it("returns the original success for the same id + same email without inserting or spending budget", async () => {
    state.registrations.rows = [storedRow({ game: "mobile_legends" }), storedRow({ game: "dota2" })];
    const res = await submitSchRegistration(submission({ entries: [cs2Entry] }));
    expect(res).toEqual({
      ok: true,
      submissionId: SUBMISSION_ID,
      games: ["mobile_legends", "dota2"], // what is stored, not what was re-sent
      feeKrw: 7000,
      feeMnt: 15000,
      paymentInfo: "Bank line",
    });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.list).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("matches the replay email case-insensitively", async () => {
    state.registrations.rows = [storedRow({ email: "PLAYER@sch.ac.kr" })];
    expect(await submitSchRegistration(submission())).toMatchObject({ ok: true });
  });

  it("answers a replay even after registration closed, leaving the receipt alone", async () => {
    state.event.row = openEventRow({ registration_open: false });
    state.registrations.rows = [storedRow()];
    expect(await submitSchRegistration(submission())).toMatchObject({ ok: true });
    expect(calls.remove).toHaveLength(0);
  });

  it("reports conflict when the id is already owned by a different email", async () => {
    receiptInBucket();
    state.registrations.rows = [storedRow({ email: "someone.else@sch.ac.kr" })];
    expect(await submitSchRegistration(submission())).toEqual({ error: "conflict" });
    expect(calls.inserts).toHaveLength(0);
  });

  it("reports unavailable when the replay lookup fails", async () => {
    state.registrations.selectError = { message: "offline" };
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
  });
});

describe("submitSchRegistration — insert errors", () => {
  it("classifies a (submission_id, game) unique violation as a replay and returns the winner's rows", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => {
      // The racing call already stored this person's rows.
      state.registrations.rows.push(storedRow({ game: "mobile_legends" }), storedRow({ game: "dota2" }));
      return {
        code: "23505",
        details: `Key (submission_id, game)=(${SUBMISSION_ID}, mobile_legends) already exists.`,
        message: 'duplicate key value violates unique constraint "sch_registrations_submission_game_idx"',
      };
    };
    expect(await submitSchRegistration(submission())).toEqual({
      ok: true,
      submissionId: SUBMISSION_ID,
      games: ["mobile_legends", "dota2"],
      feeKrw: 7000,
      feeMnt: 15000,
      paymentInfo: "Bank line",
    });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.remove).toHaveLength(0);
  });

  it("reports conflict when a replay violation is raised by rows of another email", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => {
      state.registrations.rows.push(storedRow({ email: "other@sch.ac.kr" }));
      return { code: "23505", details: `Key (submission_id, game)=(${SUBMISSION_ID}, mobile_legends) already exists.`, message: "dup" };
    };
    expect(await submitSchRegistration(submission())).toEqual({ error: "conflict" });
  });

  it("reports conflict when the replay violation leaves no rows to read back", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => ({
      code: "23505",
      details: `Key (submission_id, game)=(${SUBMISSION_ID}, mobile_legends) already exists.`,
      message: "dup",
    });
    expect(await submitSchRegistration(submission())).toEqual({ error: "conflict" });
  });

  it("classifies a (game, lower(email)) violation as duplicate naming the game Postgres reported", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => ({
      code: "23505",
      details: `Key (game, lower(email))=(dota2, ${EMAIL}) already exists.`,
      message: 'duplicate key value violates unique constraint "sch_registrations_game_email_idx"',
    });
    expect(await submitSchRegistration(submission())).toEqual({ error: "duplicate", game: "dota2" });
    expect(calls.remove).toHaveLength(0);
  });

  it("falls back to the first entered game when the violation does not name one", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => ({ code: "23505", message: "duplicate key value" });
    expect(await submitSchRegistration(submission({ entries: [dotaEntry, mlEntry] }))).toEqual({
      error: "duplicate",
      game: "dota2",
    });
  });

  it("reports unavailable for any other insert error and keeps the receipt", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => ({ code: "42501", message: "permission denied" });
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
    expect(calls.remove).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports unavailable when the insert throws", async () => {
    receiptInBucket();
    state.registrations.onInsert = () => {
      throw new Error("socket hang up");
    };
    expect(await submitSchRegistration(submission())).toEqual({ error: "unavailable" });
  });
});
