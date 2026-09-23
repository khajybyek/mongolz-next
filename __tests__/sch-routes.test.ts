/**
 * HTTP-level tests for the two SCH Esports API routes:
 *   GET /api/sch/export          — organiser CSV export
 *   GET /api/sch/receipt/[id]    — audited payment-receipt viewer
 *
 * Auth, the RLS client and the service client are mocked at the module
 * boundary (same pattern as secure-crop-route.test.ts); the route code itself
 * runs for real. No network, no database.
 */
import { NextRequest, NextResponse } from "next/server";

type RegistrationRow = {
  id: string;
  submission_id: string;
  game: string;
  full_name: string;
  email: string;
  facebook: string;
  phone: string | null;
  in_game_id: string;
  rank_label: string | null;
  rank_score: number;
  roles: string[];
  answers: unknown;
  status: string;
  paid_at: string | null;
  checked_in_at: string | null;
  notes: string | null;
  receipt_path: string | null;
  receipt_mime: string | null;
  created_at: string;
  source: string;
  receipt_url: string | null;
  submitted_at: string | null;
  team: { name: string } | { name: string }[] | null;
};

type AuditInsert = Record<string, unknown>;

const state: {
  auth: "ok" | "unauthorized" | "forbidden" | "totp_required";
  rows: RegistrationRow[];
  queryError: boolean;
  receiptRow: RegistrationRow | null;
  receiptRowError: boolean;
  storageBytes: Uint8Array | null;
  auditInserts: AuditInsert[];
  auditThrows: boolean;
  queryFilters: Array<[string, unknown]>;
  downloadedPaths: string[];
} = {
  auth: "ok",
  rows: [],
  queryError: false,
  receiptRow: null,
  receiptRowError: false,
  storageBytes: null,
  auditInserts: [],
  auditThrows: false,
  queryFilters: [],
  downloadedPaths: [],
};

jest.mock("@/lib/supabase/auth", () => ({
  requireSchOrganiserApi: jest.fn(async () => {
    if (state.auth === "unauthorized") return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
    if (state.auth === "forbidden") {
      return { error: NextResponse.json({ error: "forbidden: organiser or admin only" }, { status: 403 }) };
    }
    if (state.auth === "totp_required") return { error: NextResponse.json({ error: "totp_required" }, { status: 403 }) };
    return { user: { id: "org-1", email: "org@x" }, profile: { role: "organiser", totp_enabled: false } };
  }),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

/** Thenable list-query builder: select → order → order → limit → [eq] → await. */
function listBuilder() {
  const b = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq: (col: string, val: unknown) => {
      state.queryFilters.push([col, val]);
      return b;
    },
    then: (
      resolve: (v: { data: RegistrationRow[] | null; error: { message: string } | null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve(
        state.queryError
          ? { data: null, error: { message: "database offline" } }
          : { data: state.rows, error: null },
      ).then(resolve, reject),
  };
  return b;
}

/** Single-row builder: select → eq → maybeSingle. */
function rowBuilder() {
  const b = {
    select: () => b,
    eq: () => b,
    maybeSingle: async () =>
      state.receiptRowError
        ? { data: null, error: { message: "database offline" } }
        : { data: state.receiptRow, error: null },
  };
  return b;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "sch_registrations") throw new Error(`unexpected RLS table ${table}`);
      // The export route awaits the chain directly; the receipt route calls
      // maybeSingle(). One object exposes both shapes.
      const list = listBuilder();
      const row = rowBuilder();
      return {
        select: () => ({ ...list, ...row, select: undefined }),
      };
    },
  }),
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: async (payload: AuditInsert) => {
        if (table !== "audit_log") throw new Error(`unexpected service table ${table}`);
        if (state.auditThrows) throw new Error("ledger offline");
        state.auditInserts.push(payload);
        return { data: null, error: null };
      },
    }),
    storage: {
      from: () => ({
        download: async (path: string) => {
          state.downloadedPaths.push(path);
          return state.storageBytes
            ? { data: new Blob([state.storageBytes as BlobPart]), error: null }
            : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  }),
}));

const REG = "11111111-2222-4333-8444-555555555555";
const SUB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function baseRow(over: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: REG,
    submission_id: SUB,
    game: "cs2",
    full_name: "Bat Bold",
    email: "bat@example.com",
    facebook: "fb.com/batbold",
    phone: "+82 10 1234 5678",
    in_game_id: "https://steamcommunity.com/id/batbold",
    rank_label: "Premier 15000",
    rank_score: 50,
    roles: [],
    answers: { premier_rank: "15000", faceit: "yes" },
    status: "paid",
    paid_at: "2026-09-17T01:00:00.000Z",
    checked_in_at: null,
    notes: null,
    receipt_path: `submissions/${SUB}/receipt.png`,
    receipt_mime: "image/png",
    created_at: "2026-09-16T12:00:00.000Z",
    source: "web",
    receipt_url: null,
    submitted_at: null,
    team: { name: "Team 3" },
    ...over,
  };
}

function callExport(query = "", headers: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/sch/export/route") as {
    GET: (req: NextRequest) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/api/sch/export${query}`, { headers }));
}

function callReceipt(id: string, headers: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/sch/receipt/[id]/route") as {
    GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/api/sch/receipt/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

/** Minimal RFC 4180 line splitter — enough for the cells this export emits. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function csvOf(res: Response) {
  const text = await res.text();
  const lines = text.split("\n");
  expect(lines[lines.length - 1]).toBe(""); // trailing newline
  lines.pop();
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i]])) as Record<string, string>;
  });
  return { text, header, rows };
}

beforeEach(() => {
  state.auth = "ok";
  state.rows = [];
  state.queryError = false;
  state.receiptRow = null;
  state.receiptRowError = false;
  state.storageBytes = null;
  state.auditInserts = [];
  state.auditThrows = false;
  state.queryFilters = [];
  state.downloadedPaths = [];
});

describe("GET /api/sch/export", () => {
  it("passes the auth helper's 401/403 responses through untouched", async () => {
    state.auth = "unauthorized";
    expect((await callExport()).status).toBe(401);

    state.auth = "forbidden"; // viewer / auditor
    const forbidden = await callExport();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden: organiser or admin only" });

    state.auth = "totp_required"; // admin without a second factor
    const totp = await callExport();
    expect(totp.status).toBe(403);
    expect(await totp.json()).toEqual({ error: "totp_required" });

    expect(state.auditInserts).toHaveLength(0);
  });

  it("rejects an unknown ?game= with 400 and accepts empty / all / each game", async () => {
    const bad = await callExport("?game=valorant");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid game" });
    expect(state.auditInserts).toHaveLength(0);

    expect((await callExport("?game=")).status).toBe(200);
    expect((await callExport("?game=all")).status).toBe(200);
    expect(state.queryFilters).toHaveLength(0); // no .eq() for the unfiltered forms

    for (const g of ["mobile_legends", "cs2", "dota2"]) {
      state.queryFilters = [];
      expect((await callExport(`?game=${g}`)).status).toBe(200);
      expect(state.queryFilters).toEqual([["game", g]]);
    }
  });

  it("emits the documented header, one row per registration, download headers", async () => {
    state.rows = [
      baseRow(),
      baseRow({
        id: "22222222-2222-4333-8444-555555555555",
        game: "mobile_legends",
        rank_label: "Mythic",
        rank_score: 70,
        roles: ["Jungle", "Mid Lane"],
        answers: {},
        status: "pending",
        paid_at: null,
        notes: "call back",
        receipt_path: null,
        receipt_mime: null,
        team: null,
      }),
    ];
    const res = await callExport();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="sch-registrations-all-\d{4}-\d{2}-\d{2}\.csv"$/,
    );

    const { header, rows } = await csvOf(res);
    expect(header).toEqual([
      "id", "reference", "submission_id", "game", "full_name", "email", "facebook", "phone",
      "in_game_id", "rank_label", "rank_score", "roles", "premier_rank", "faceit", "status",
      "paid_at", "checked_in_at", "team", "notes", "has_receipt", "created_at",
      // Sheet-import columns are appended so existing column positions stay stable.
      "source", "receipt_url", "submitted_at",
    ]);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      id: REG,
      reference: "AAAAAAAA",
      submission_id: SUB,
      game: "CS2",
      full_name: "Bat Bold",
      email: "bat@example.com",
      facebook: "fb.com/batbold",
      // "+"-prefixed phones are a formula trigger → csvCell() marks them as text.
      phone: "'+82 10 1234 5678",
      in_game_id: "https://steamcommunity.com/id/batbold",
      rank_label: "Premier 15000",
      rank_score: "50",
      roles: "",
      premier_rank: "15000",
      faceit: "yes",
      status: "paid",
      paid_at: "2026-09-17T01:00:00.000Z",
      checked_in_at: "",
      team: "Team 3",
      notes: "",
      has_receipt: "yes",
      created_at: "2026-09-16T12:00:00.000Z",
      source: "web",
      receipt_url: "",
      submitted_at: "",
    });
    expect(rows[1]).toMatchObject({
      game: "Mobile Legends",
      rank_label: "Mythic",
      roles: "Jungle | Mid Lane",
      premier_rank: "",
      faceit: "",
      status: "pending",
      paid_at: "",
      team: "",
      notes: "call back",
      has_receipt: "no",
    });
  });

  it("neutralises player-typed cells that start with = + @ -", async () => {
    state.rows = [
      baseRow({ id: "a1111111-2222-4333-8444-555555555555", full_name: '=HYPERLINK("http://evil")' }),
      baseRow({ id: "a2222222-2222-4333-8444-555555555555", full_name: "+1234", facebook: "@handle" }),
      baseRow({ id: "a3333333-2222-4333-8444-555555555555", full_name: "-cmd", in_game_id: "=1+1", notes: "@SUM(A1)" }),
    ];
    const res = await callExport();
    const { text, rows } = await csvOf(res);

    // Raw file: every risky cell is quoted and prefixed with a single quote.
    expect(text).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(text).toContain("\"'+1234\"");
    expect(text).toContain("\"'@handle\"");
    expect(text).toContain("\"'-cmd\"");
    expect(text).toContain("\"'=1+1\"");
    expect(text).toContain("\"'@SUM(A1)\"");
    // No line starts a cell with a bare formula trigger.
    for (const line of text.split("\n").slice(1).filter(Boolean)) {
      for (const cell of parseCsvLine(line)) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
    }
    // The decoded cells carry the marker, i.e. the data survives.
    expect(rows[0].full_name).toBe("'=HYPERLINK(\"http://evil\")");
    expect(rows[2].in_game_id).toBe("'=1+1");
  });

  it("reports has_receipt as yes/no and never leaks the storage path", async () => {
    state.rows = [
      baseRow({ receipt_path: `submissions/${SUB}/receipt.png` }),
      baseRow({ id: "b2222222-2222-4333-8444-555555555555", receipt_path: null, receipt_mime: null }),
      baseRow({ id: "b3333333-2222-4333-8444-555555555555", receipt_path: "" }),
    ];
    const res = await callExport();
    const { text, header, rows } = await csvOf(res);
    expect(header).not.toContain("receipt_path");
    expect(header).not.toContain("receipt_mime");
    expect(text).not.toContain("submissions/");
    expect(text).not.toContain("receipt.png");
    expect(text).not.toContain("image/png");
    expect(rows.map((r) => r.has_receipt)).toEqual(["yes", "no", "no"]);
  });

  it("appends source / receipt_url / submitted_at for sheet imports and neutralises the link cell", async () => {
    state.rows = [
      baseRow({
        source: "import",
        receipt_path: null,
        receipt_mime: null,
        receipt_url: "https://drive.google.com/open?id=abc",
        submitted_at: "2026-09-17T05:03:22.000Z",
      }),
      baseRow({ id: "b4444444-2222-4333-8444-555555555555", source: "import", receipt_path: null, receipt_url: "=cmd|' /C calc'!A0" }),
    ];
    const { header, rows } = await csvOf(await callExport());
    expect(header.slice(-3)).toEqual(["source", "receipt_url", "submitted_at"]);
    expect(rows[0]).toMatchObject({
      source: "import",
      // A trusted Drive link is a receipt, the same rule the console applies.
      has_receipt: "yes",
      receipt_url: "https://drive.google.com/open?id=abc",
      submitted_at: "2026-09-17T05:03:22.000Z",
    });
    expect(rows[1].receipt_url).toBe("'=cmd|' /C calc'!A0");
    expect(rows[1].has_receipt).toBe("no");
  });

  it("starts the body with a UTF-8 BOM so Excel decodes Cyrillic and Hangul", async () => {
    state.rows = [baseRow()];
    const res = await callExport();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    // Exactly one BOM, followed directly by the header row.
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).startsWith("\uFEFFid,reference,")).toBe(true);
  });

  it("writes one SCH_REGISTRATIONS_EXPORTED audit row with game + row count, ids only", async () => {
    state.rows = [baseRow(), baseRow({ id: "c2222222-2222-4333-8444-555555555555", game: "dota2" })];
    expect((await callExport("?game=cs2", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    const row = state.auditInserts[0];
    expect(row).toMatchObject({
      action: "SCH_REGISTRATIONS_EXPORTED",
      detail: "game=cs2 rows=2",
      user_id: "org-1",
      user_email: "org@x",
      ip: "203.0.113.9",
    });
    expect(String(row.detail)).not.toContain("bat@example.com");
    expect(String(row.detail)).not.toContain("Bat Bold");

    state.auditInserts = [];
    expect((await callExport()).status).toBe(200);
    expect(state.auditInserts[0]).toMatchObject({ action: "SCH_REGISTRATIONS_EXPORTED", detail: "game=all rows=2" });
  });

  it("stores the export audit ip only when it parses (inet column) — mirrors the receipt route", async () => {
    // audit_log.ip is `inet`; an unparsable value rejects the whole ledger row
    // and the route swallows that error, so the export would go unrecorded.
    state.rows = [baseRow()];
    expect((await callExport("", { "x-forwarded-for": "garbage" })).status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0].ip).toBeNull();
  });

  it("does not fail the export when the ledger write throws", async () => {
    state.rows = [baseRow()];
    state.auditThrows = true;
    const res = await callExport();
    expect(res.status).toBe(200);
    expect((await csvOf(res)).rows).toHaveLength(1);
  });

  it("answers 503 when the registrations query fails", async () => {
    state.queryError = true;
    const res = await callExport();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(state.auditInserts).toHaveLength(0);
  });
});

describe("GET /api/sch/receipt/[id]", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  it("rejects a malformed id with 400 before auth, storage or the ledger", async () => {
    state.auth = "unauthorized";
    for (const bad of ["nope", "../../etc/passwd", `${SUB}x`, "submissions%2Fx"]) {
      const res = await callReceipt(bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid registration id" });
    }
    expect(state.downloadedPaths).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it("passes the auth helper's 401/403 through and never touches storage", async () => {
    state.receiptRow = baseRow();
    state.storageBytes = PNG;
    state.auth = "unauthorized";
    expect((await callReceipt(REG)).status).toBe(401);
    state.auth = "forbidden";
    expect((await callReceipt(REG)).status).toBe(403);
    state.auth = "totp_required";
    expect((await callReceipt(REG)).status).toBe(403);
    expect(state.downloadedPaths).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it("404s an unknown registration without a ledger row", async () => {
    state.storageBytes = PNG;
    const res = await callReceipt(REG);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "registration not found" });
    expect(state.downloadedPaths).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it("404s a registration without a receipt (null, empty or malformed path)", async () => {
    state.storageBytes = PNG;
    for (const receipt_path of [null, "", "../../secrets", `submissions/${SUB}/receipt.exe`, "receipt.png"]) {
      state.receiptRow = baseRow({ receipt_path });
      const res = await callReceipt(REG);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "no receipt" });
    }
    expect(state.downloadedPaths).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it("404s when the object download fails and writes no ledger row", async () => {
    state.receiptRow = baseRow();
    state.storageBytes = null;
    const res = await callReceipt(REG);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "receipt unavailable" });
    expect(state.downloadedPaths).toEqual([`submissions/${SUB}/receipt.png`]);
    expect(state.auditInserts).toHaveLength(0);
  });

  it("answers 503 when the row lookup errors", async () => {
    state.receiptRowError = true;
    state.storageBytes = PNG;
    expect((await callReceipt(REG)).status).toBe(503);
    expect(state.downloadedPaths).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(0);
  });

  it("streams the bytes inline with the stored mime and private caching", async () => {
    state.receiptRow = baseRow({ receipt_path: `submissions/${SUB}/receipt.png`, receipt_mime: "image/png" });
    state.storageBytes = PNG;
    const res = await callReceipt(REG.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="receipt-${REG.slice(0, 8)}.png"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(state.downloadedPaths).toEqual([`submissions/${SUB}/receipt.png`]);
  });

  it("uses each stored mime's extension and falls back to octet-stream/.bin for an unknown one", async () => {
    state.storageBytes = PNG;
    const cases: Array<[string | null, string, string]> = [
      ["image/jpeg", "image/jpeg", "jpg"],
      ["image/webp", "image/webp", "webp"],
      ["image/heic", "image/heic", "heic"],
      ["text/html", "application/octet-stream", "bin"],
      [null, "application/octet-stream", "bin"],
    ];
    for (const [stored, mime, ext] of cases) {
      state.receiptRow = baseRow({ receipt_mime: stored });
      const res = await callReceipt(REG);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(mime);
      expect(res.headers.get("content-disposition")).toBe(`inline; filename="receipt-${REG.slice(0, 8)}.${ext}"`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("writes one SCH_RECEIPT_VIEWED ledger row carrying the registration id only", async () => {
    state.receiptRow = baseRow();
    state.storageBytes = PNG;
    expect((await callReceipt(REG, { "x-forwarded-for": "203.0.113.5, 10.0.0.1" })).status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    const row = state.auditInserts[0];
    expect(row).toMatchObject({
      action: "SCH_RECEIPT_VIEWED",
      detail: `registration=${REG} game=cs2`,
      user_id: "org-1",
      user_email: "org@x",
      ip: "203.0.113.5",
    });
    const detail = String(row.detail);
    expect(detail).not.toContain("bat@example.com");
    expect(detail).not.toContain("Bat Bold");
    expect(detail).not.toContain("submissions/");
    expect(detail).not.toContain(SUB);
  });

  it("stores the ip only when it parses (inet column): garbage → null, IPv6 → kept", async () => {
    state.receiptRow = baseRow();
    state.storageBytes = PNG;

    expect((await callReceipt(REG, { "x-forwarded-for": "garbage" })).status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0].ip).toBeNull();

    state.auditInserts = [];
    expect((await callReceipt(REG)).status).toBe(200); // header absent
    expect(state.auditInserts[0].ip).toBeNull();

    state.auditInserts = [];
    expect((await callReceipt(REG, { "x-forwarded-for": "2001:db8::1" })).status).toBe(200);
    expect(state.auditInserts[0].ip).toBe("2001:db8::1");
  });

  it("still serves the receipt when the ledger write throws", async () => {
    state.receiptRow = baseRow();
    state.storageBytes = PNG;
    state.auditThrows = true;
    const res = await callReceipt(REG);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});
