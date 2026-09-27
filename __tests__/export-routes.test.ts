/**
 * Export / label routes (2026-09-23 debugging pass).
 *
 *  1. The GDPR export read reveal_jobs with `select("*")` through the service
 *     role, shipping third-party ArcFace templates (query_embedding[s]),
 *     reference_sealed, output_path and worker lease fields to the subject.
 *  2. The alerts CSV answered 200 with a header-only file (and a ledger row
 *     claiming rows=0) when its query failed; the label route answered
 *     {ok:true} and audited a label for an alert that does not exist.
 *  3. PostgREST caps every response at max_rows = 1000, so `.limit(5000)` /
 *     `.limit(10000)` exports silently stopped at 1000 rows.
 *  4. The GDPR export left out tables that hold rows about the caller.
 *
 * Every route runs for real; auth and Supabase are faked at the module
 * boundary. The fake records each query's calls so the tests can assert on
 * the columns and filters a query actually used.
 */
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { fetchAllPaged } from "@/lib/paged-fetch";

const ME = "11111111-2222-4333-8444-555555555555";
const ALERT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CAM = "cccccccc-dddd-4eee-8fff-000000000000";
const SERVER_MAX_ROWS = 1000;

type Call = [string, ...unknown[]];
type Query = { table: string; client: "user" | "service"; calls: Call[] };

const state = {
  role: "admin",
  /** Full result set per table (before paging). */
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** Tables whose reads fail. */
  failing: new Set<string>(),
  /** Result of an alerts update ... select("id").maybeSingle(). */
  updated: null as { id: string } | null,
};
const queries: Query[] = [];
const audited: Array<Record<string, unknown>> = [];
const recordAccess = jest.fn(async (_: unknown) => undefined);

function fakeClient(client: "user" | "service") {
  return {
    from(table: string) {
      const q: Query = { table, client, calls: [] };
      queries.push(q);
      const fail = () => state.failing.has(table);
      const rows = () => state.tables[table] ?? [];
      const b: Record<string, unknown> = {};
      const rec = (name: string) => (...args: unknown[]) => {
        q.calls.push([name, ...args]);
        return b;
      };
      for (const m of ["select", "eq", "is", "or", "ilike", "gte", "lte", "not", "in", "order", "limit", "update"]) {
        b[m] = rec(m);
      }
      b.range = async (from: number, to: number) => {
        q.calls.push(["range", from, to]);
        if (fail()) return { data: null, error: { message: "offline" } };
        const end = Math.min(to + 1, from + SERVER_MAX_ROWS);
        return { data: rows().slice(from, end), error: null };
      };
      b.maybeSingle = async () => {
        q.calls.push(["maybeSingle"]);
        if (fail()) return { data: null, error: { message: "offline", code: "XX000" } };
        const isUpdate = q.calls.some((c) => c[0] === "update");
        return { data: isUpdate ? state.updated : (rows()[0] ?? null), error: null };
      };
      b.insert = async (row: Record<string, unknown>) => {
        q.calls.push(["insert", row]);
        if (table === "audit_log") audited.push(row);
        return { error: null };
      };
      return b;
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeClient("user"),
  createServiceClient: () => fakeClient("service"),
}));
jest.mock("@/lib/supabase/auth", () => {
  const ok = async () => ({ user: { id: ME, email: "subject@example.test" }, profile: { id: ME, role: state.role } });
  return {
    requireUserApi: jest.fn(ok),
    requireAdminApi: jest.fn(ok),
    requireAdminOrAuditorApi: jest.fn(ok),
    isAuthErr: (r: object) => "error" in r,
  };
});
jest.mock("@/lib/audit", () => ({
  recordAccess: (a: unknown) => recordAccess(a),
  READ_ACTIONS: { ALERTS_EXPORTED: "ALERTS_EXPORTED" },
}));
jest.mock("@/lib/log", () => ({ log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { GET as gdprExport } from "@/app/api/gdpr/export/route";
import { GET as alertsCsv } from "@/app/api/alerts/csv/route";
import { POST as labelAlert } from "@/app/api/alerts/[id]/label/route";
import { GET as auditExport } from "@/app/api/audit/export/route";
import { GET as heatmap } from "@/app/api/heatmap/route";

/** Raw body bytes: `Response.text()` silently strips a leading BOM. */
async function bytes(res: Response) {
  return new Uint8Array(await res.arrayBuffer());
}
/** Number of UTF-8 BOM sequences (EF BB BF) anywhere in the body. */
function bomCount(b: Uint8Array) {
  let n = 0;
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xef && b[i + 1] === 0xbb && b[i + 2] === 0xbf) n++;
  return n;
}

function many(n: number, make: (i: number) => Record<string, unknown>) {
  return Array.from({ length: n }, (_, i) => make(i));
}
const queriesOn = (table: string) => queries.filter((q) => q.table === table);
const selected = (q: Query) => String(q.calls.find((c) => c[0] === "select")?.[1] ?? "");

beforeEach(() => {
  state.role = "admin";
  state.tables = {};
  state.failing = new Set();
  state.updated = null;
  queries.length = 0;
  audited.length = 0;
  recordAccess.mockClear();
});

// ── paging helper ─────────────────────────────────────────────────────────
describe("fetchAllPaged", () => {
  const source = (n: number, serverCap = SERVER_MAX_ROWS) => {
    const all = many(n, (i) => ({ i }));
    const calls: Array<[number, number]> = [];
    const page = async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: all.slice(from, Math.min(to + 1, from + serverCap)), error: null };
    };
    return { page, calls };
  };

  it("keeps fetching while the server returns full 1000-row pages", async () => {
    const { page, calls } = source(2500);
    const r = await fetchAllPaged(page, 10_000);
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
    expect(calls.slice(0, 3)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("marks a result past the cap as truncated and returns exactly cap rows", async () => {
    const { page } = source(1500);
    const r = await fetchAllPaged(page, 1200);
    expect(r.rows).toHaveLength(1200);
    expect(r.truncated).toBe(true);
  });

  it("does not call a table that is exactly cap rows long truncated", async () => {
    const { page } = source(1200);
    const r = await fetchAllPaged(page, 1200);
    expect(r.rows).toHaveLength(1200);
    expect(r.truncated).toBe(false);
  });

  it("stays complete when the server cap is lower than the page size", async () => {
    const { page } = source(1234, 300);
    const r = await fetchAllPaged(page, 10_000);
    expect(r.rows.map((x) => x.i)).toEqual(Array.from({ length: 1234 }, (_, i) => i));
  });

  it("surfaces an error instead of a short list", async () => {
    const r = await fetchAllPaged(async () => ({ data: null, error: { message: "boom" } }), 10);
    expect(r.error).toBe("boom");
  });
});

// ── finding 1 + 4: GDPR export ────────────────────────────────────────────
describe("GDPR subject export", () => {
  async function unzip(res: Response) {
    return JSZip.loadAsync(await res.arrayBuffer());
  }

  it("never selects `*` from reveal_jobs and leaves out biometric/internal columns", async () => {
    state.tables.reveal_jobs = [{ id: "job-1", status: "completed" }];
    const res = await gdprExport();
    expect(res.status).toBe(200);
    const [q] = queriesOn("reveal_jobs");
    const cols = selected(q);
    expect(cols).not.toContain("*");
    for (const hidden of ["query_embedding", "query_embeddings", "reference_sealed", "output_path", "worker_"]) {
      expect(cols).not.toContain(hidden);
    }
    expect(cols).toContain("requested_by");
    expect(q.calls.find((c) => c[0] === "or")?.[1]).toBe(
      `requested_by.eq.${ME},approved_by.eq.${ME},rejected_by.eq.${ME}`,
    );
  });

  it("names its columns on every service-role read and filters every one to the caller", async () => {
    await gdprExport();
    const reads = queries.filter((q) => q.client === "service" && q.calls.some((c) => c[0] === "select"));
    expect(reads.length).toBeGreaterThanOrEqual(10);
    for (const q of reads) {
      expect(selected(q)).not.toContain("*");
      const scoped = q.calls.some(
        (c) =>
          (c[0] === "eq" && ["id", "user_id", "labeled_by", "requested_by", "user_email", "created_by", "actor_id", "added_by", "reviewed_by", "updated_by"].includes(String(c[1]))) ||
          c[0] === "or",
      );
      expect({ table: q.table, scoped }).toEqual({ table: q.table, scoped: true });
    }
    for (const secret of ["totp_secret", "totp_recovery_codes"]) {
      expect(selected(queriesOn("profiles")[0])).not.toContain(secret);
    }
    expect(selected(queriesOn("webauthn_credentials")[0])).not.toMatch(/public_key|counter|credential_id/);
    expect(selected(queriesOn("push_subscriptions")[0])).not.toMatch(/endpoint|p256dh|auth/);
  });

  it("ships the tables that hold rows about the caller, listed in README.txt", async () => {
    state.tables.web_vitals = [{ id: 1, metric: "LCP", value: 1.2 }];
    state.tables.webauthn_credentials = [{ id: "pk-1", device_name: "laptop" }];
    const zip = await unzip(await gdprExport());
    const readme = await zip.file("README.txt")!.async("string");
    for (const name of [
      "web_vitals.json",
      "passkeys.json",
      "push_subscriptions.json",
      "face_search_presets.json",
      "upload_jobs.json",
    ]) {
      expect(zip.file(name)).not.toBeNull();
      expect(readme).toContain(name);
    }
    expect(JSON.parse(await zip.file("web_vitals.json")!.async("string"))).toHaveLength(1);
    expect(readme).toContain("Every file is complete.");
  });

  it("exports the alert workflow and the rows the caller authored", async () => {
    state.tables.alerts = [{ id: ALERT, state: "closed", note: "checked" }];
    state.tables.incidents = [{ id: "inc-1", status: "open" }];
    const zip = await unzip(await gdprExport());
    const [alerts] = queriesOn("alerts");
    expect(alerts.calls.find((c) => c[0] === "or")?.[1]).toBe(
      `labeled_by.eq.${ME},acknowledged_by.eq.${ME},closed_by.eq.${ME}`,
    );
    expect(selected(alerts)).toMatch(/acknowledged_by.*closed_by.*note/);
    expect(JSON.parse(await zip.file("alerts.json")!.async("string"))).toHaveLength(1);
    expect(queriesOn("incidents")[0].calls.find((c) => c[0] === "or")?.[1]).toBe(
      `created_by.eq.${ME},resolved_by.eq.${ME},assignee_id.eq.${ME}`,
    );
    expect(JSON.parse(await zip.file("incidents.json")!.async("string"))).toHaveLength(1);
    const readme = await zip.file("README.txt")!.async("string");
    for (const name of ["incident_events.json", "face_reviews.json", "webhooks.json"]) {
      expect(zip.file(name)).not.toBeNull();
      expect(readme).toContain(name);
    }
    expect(selected(queriesOn("webhooks")[0])).not.toMatch(/url|signing_secret/);
    expect(selected(queriesOn("faces")[0])).not.toMatch(/embedding|crop|image_path/);
  });

  it("pages past PostgREST's 1000-row cap and says when a file hit its own cap", async () => {
    state.tables.audit_log = many(10_001, (i) => ({ id: i, action: "LOGIN" }));
    const res = await gdprExport();
    expect(res.headers.get("x-export-truncated")).toBe("1");
    const zip = await unzip(res);
    // 10 000 rows by user id + the same fake rows again for the e-mail query.
    expect(JSON.parse(await zip.file("audit_log.json")!.async("string")).length).toBe(20_000);
    expect(await zip.file("README.txt")!.async("string")).toMatch(/Truncated at 10000 rows.*audit_log\.json/);
  });

  it("refuses with 503 instead of handing out a silently partial export", async () => {
    state.failing.add("reveal_jobs");
    const res = await gdprExport();
    expect(res.status).toBe(503);
    expect(audited.filter((r) => r.action === "GDPR_EXPORT")).toHaveLength(0);
  });
});

// ── finding 2 + 3: alerts CSV ─────────────────────────────────────────────
describe("alerts CSV", () => {
  const req = () => new NextRequest("https://app.test/api/alerts/csv");

  it("answers 503 on a query error and records no export", async () => {
    state.failing.add("alerts");
    const res = await alertsCsv(req());
    expect(res.status).toBe(503);
    expect(recordAccess).not.toHaveBeenCalled();
  });

  it("exports every alert past the 1000-row server cap", async () => {
    state.tables.alerts = many(2345, (i) => ({ id: `a${i}`, suspect_name: "s", created_at: "2026-09-01" }));
    const res = await alertsCsv(req());
    expect(res.status).toBe(200);
    expect((await res.text()).split("\n")).toHaveLength(2346);
    expect(res.headers.get("x-export-truncated")).toBe("0");
    expect(String((recordAccess.mock.calls[0][0] as { detail: string }).detail)).toContain("rows=2345");
  });

  it("marks the file partial when the export cap is hit", async () => {
    state.tables.alerts = many(10_001, (i) => ({ id: `a${i}`, created_at: "2026-09-01" }));
    const res = await alertsCsv(req());
    expect(res.headers.get("x-export-truncated")).toBe("1");
    expect(res.headers.get("content-disposition")).toContain("_partial.csv");
  });

  it("starts with the UTF-8 BOM exactly once and names the charset", async () => {
    state.tables.alerts = [
      { id: "a1", suspect_name: "Бат-Эрдэнэ", camera_name: "정문", created_at: "2026-09-01", state: "new" },
      { id: "a2", suspect_name: "=HYPERLINK(\"http://evil\")", created_at: "2026-09-01", state: "new" },
    ];
    const res = await alertsCsv(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const b = await bytes(res);
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bomCount(b)).toBe(1);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
    expect(text.slice(1).startsWith("suspect_name,")).toBe(true);
    expect(text).toContain("Бат-Эрдэнэ,");
    expect(text).toContain(",정문,");
    // Formula neutralisation survives the BOM.
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

// ── finding 2: alert label ────────────────────────────────────────────────
describe("alert label", () => {
  const post = (label = "true_positive") =>
    labelAlert(
      new NextRequest(`https://app.test/api/alerts/${ALERT}/label`, {
        method: "POST",
        body: JSON.stringify({ label }),
      }),
      { params: Promise.resolve({ id: ALERT }) },
    );

  it("answers 404 for a missing (or RLS-hidden) alert and audits nothing", async () => {
    state.updated = null;
    const res = await post();
    expect(res.status).toBe(404);
    expect(audited).toHaveLength(0);
  });

  it("answers 500 without leaking the database message, and audits nothing", async () => {
    state.failing.add("alerts");
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("offline");
    expect(audited).toHaveLength(0);
  });

  it("labels an existing alert and records it once", async () => {
    state.updated = { id: ALERT };
    const res = await post("false_positive");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, label: "false_positive" });
    expect(audited).toEqual([expect.objectContaining({ action: "ALERT_LABEL", detail: `${ALERT} → false_positive` })]);
    const [q] = queriesOn("alerts");
    expect(q.calls.find((c) => c[0] === "select")?.[1]).toBe("id");
  });
});

// ── finding 3: audit CSV + heatmap ────────────────────────────────────────
describe("audit CSV export", () => {
  it("pages past 1000 rows and re-applies the filters on every page", async () => {
    state.tables.audit_log = many(1500, (i) => ({ id: i, action: "LOGIN", created_at: "2026-09-01" }));
    const res = await auditExport(new NextRequest("https://app.test/api/audit/export?action=LOGIN"));
    expect(res.status).toBe(200);
    expect((await res.text()).trim().split("\n")).toHaveLength(1501);
    const pages = queriesOn("audit_log");
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const q of pages) expect(q.calls).toContainEqual(["eq", "action", "LOGIN"]);
    expect(res.headers.get("x-export-truncated")).toBe("0");
  });

  it("answers 503 without the raw database message on a query error", async () => {
    state.failing.add("audit_log");
    const res = await auditExport(new NextRequest("https://app.test/api/audit/export"));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("offline");
  });

  it("starts with the UTF-8 BOM exactly once and names the charset", async () => {
    state.tables.audit_log = [
      { id: 1, action: "LOGIN", detail: "Нэвтэрсэн · 로그인", created_at: "2026-09-01" },
      { id: 2, action: "LOGIN_FAILED", detail: "@SUM(A1)", user_email: "+1", created_at: "2026-09-01" },
    ];
    const res = await auditExport(new NextRequest("https://app.test/api/audit/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const b = await bytes(res);
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bomCount(b)).toBe(1);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
    expect(text.slice(1).startsWith("id,action,detail,")).toBe(true);
    expect(text).toContain("Нэвтэрсэн · 로그인");
    expect(text).toContain(`"'@SUM(A1)","'+1"`);
  });
});

describe("heatmap", () => {
  it("samples up to the requested limit instead of stopping at 1000", async () => {
    state.tables.faces = many(2500, () => ({ bbox: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }));
    const res = await heatmap(new Request(`https://app.test/api/heatmap?camera_id=${CAM}&limit=3000`));
    const body = await res.json();
    expect(body.samples).toBe(2500);
    expect(body.truncated).toBe(false);
  });
});
