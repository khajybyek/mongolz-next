/** @jest-environment node */
/**
 * HTTP-level tests for /api/alerts/apply-threshold — the active-learning
 * "apply" control.
 *
 * The contract under test is deliberately narrow: the endpoint sets an
 * alert-rule FLOOR (which rule governs a match), it is not a detection
 * filter, and it says so in the response. `uncovered_band` is the part an
 * operator has to see: with a floor above the ML detection gate, matches in
 * between still alert — just outside this rule's dedup window and quiet
 * hours. Asserting it here keeps the UI copy honest.
 */
import { NextRequest, NextResponse } from "next/server";

type Row = Record<string, unknown>;

const state: {
  auth: "ok" | "unauthorized" | "forbidden";
  suspect: { data: Row | null; error: { message: string } | null };
  rulesList: { data: Row[]; error: { message: string } | null };
  rulesFind: { data: Row[]; error: { message: string } | null };
  ruleWrite: { data: Row | null; error: { message: string } | null };
  writes: Array<{ op: "insert" | "update"; payload: Row }>;
  audit: Row[];
} = {
  auth: "ok",
  suspect: { data: { id: "s1", name: "Jane" }, error: null },
  rulesList: { data: [], error: null },
  rulesFind: { data: [], error: null },
  ruleWrite: { data: { id: "rule-1" }, error: null },
  writes: [],
  audit: [],
};

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => {
    if (state.auth === "unauthorized") return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
    if (state.auth === "forbidden") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    return { user: { id: "admin-1", email: "admin@x" }, profile: { role: "admin" } };
  }),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

/** Chainable stub: `.limit()` marks the POST lookup, insert/update mark a write. */
function alertRulesBuilder() {
  let mode: "list" | "find" | "write" = "list";
  const b: Record<string, unknown> = {};
  const self = () => b;
  Object.assign(b, {
    select: self,
    eq: self,
    is: self,
    ilike: self,
    order: self,
    limit: () => {
      if (mode !== "write") mode = "find";
      return b;
    },
    insert: (payload: Row) => {
      mode = "write";
      state.writes.push({ op: "insert", payload });
      return b;
    },
    update: (payload: Row) => {
      mode = "write";
      state.writes.push({ op: "update", payload });
      return b;
    },
    maybeSingle: async () => state.ruleWrite,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mode === "find" ? state.rulesFind : state.rulesList).then(res, rej),
  });
  return b;
}

function client() {
  return {
    from: (table: string) => {
      if (table === "alert_rules") return alertRulesBuilder();
      if (table === "suspects") {
        const b: Record<string, unknown> = {};
        Object.assign(b, { select: () => b, eq: () => b, maybeSingle: async () => state.suspect });
        return b;
      }
      if (table === "audit_log") {
        return {
          insert: async (row: Row) => {
            state.audit.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => client(),
  createServiceClient: () => client(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const route = require("@/app/api/alerts/apply-threshold/route") as {
  GET: () => Promise<Response>;
  POST: (req: NextRequest) => Promise<Response>;
};

const SUSPECT = "11111111-2222-4333-8444-555555555555";

function post(body: unknown) {
  return route.POST(
    new NextRequest("http://localhost/api/alerts/apply-threshold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.auth = "ok";
  state.suspect = { data: { id: SUSPECT, name: "Jane" }, error: null };
  state.rulesList = { data: [], error: null };
  state.rulesFind = { data: [], error: null };
  state.ruleWrite = { data: { id: "rule-1" }, error: null };
  state.writes = [];
  state.audit = [];
});

describe("GET /api/alerts/apply-threshold", () => {
  it("refuses a non-admin", async () => {
    state.auth = "forbidden";
    expect((await route.GET()).status).toBe(403);
  });

  it("reports the detection gate, the global floor and every suspect floor", async () => {
    state.rulesList = {
      data: [
        { id: "g1", name: "Global default", suspect_id: null, camera_id: null, min_similarity: "0.700", enabled: true },
        { id: "r1", name: "auto-tune: Jane", suspect_id: SUSPECT, camera_id: null, min_similarity: "0.620", enabled: true },
        { id: "r2", name: "John — manual", suspect_id: "s2", camera_id: null, min_similarity: "0.550", enabled: true },
      ],
      error: null,
    };
    const body = await (await route.GET()).json();
    expect(body.detection_gate).toBe(0.45);
    expect(body.global_floor).toBe(0.7);
    expect(body.floors).toEqual([
      { suspect_id: SUSPECT, rule_id: "r1", name: "auto-tune: Jane", min_similarity: 0.62, enabled: true, managed: true },
      { suspect_id: "s2", rule_id: "r2", name: "John — manual", min_similarity: 0.55, enabled: true, managed: false },
    ]);
  });
});

describe("POST /api/alerts/apply-threshold", () => {
  it("rejects a malformed body", async () => {
    expect((await post({ suspect_id: "nope", threshold: 0.5 })).status).toBe(400);
    expect((await post({ suspect_id: SUSPECT, threshold: 2 })).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it("404s an unknown suspect instead of writing a rule", async () => {
    state.suspect = { data: null, error: null };
    expect((await post({ suspect_id: SUSPECT, threshold: 0.6 })).status).toBe(404);
    expect(state.writes).toEqual([]);
  });

  it("creates the rule and names the band its floor leaves uncovered", async () => {
    const res = await post({ suspect_id: SUSPECT, threshold: 0.62 });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The endpoint describes itself as a rule floor — never as a filter.
    expect(body.effect).toBe("rule_floor");
    expect(body.updated).toBe(false);
    expect(body.min_similarity).toBe(0.62);
    expect(body.above_detection_gate).toBe(true);
    expect(body.uncovered_band).toEqual([0.45, 0.62]);

    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].op).toBe("insert");
    expect(state.writes[0].payload).toMatchObject({
      suspect_id: SUSPECT,
      camera_id: null,
      min_similarity: 0.62,
      enabled: true,
      dedup_window_sec: 300,
    });
    expect(String(state.writes[0].payload.name)).toMatch(/^auto-tune:/);

    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe("ALERT_RULE_FLOOR_CREATE");
    expect(JSON.parse(String(state.audit[0].detail))).toMatchObject({
      min_similarity: 0.62,
      uncovered_band: [0.45, 0.62],
    });
  });

  it("leaves no uncovered band when the floor sits at or below the gate", async () => {
    const body = await (await post({ suspect_id: SUSPECT, threshold: 0.4 })).json();
    expect(body.above_detection_gate).toBe(false);
    expect(body.uncovered_band).toBeNull();
  });

  it("updates the rule it already owns instead of inserting a duplicate", async () => {
    state.rulesFind = { data: [{ id: "rule-1", name: "auto-tune: Jane" }], error: null };
    const body = await (await post({ suspect_id: SUSPECT, threshold: 0.58 })).json();

    expect(body.updated).toBe(true);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].op).toBe("update");
    expect(state.writes[0].payload).toMatchObject({ min_similarity: 0.58, enabled: true });
    expect(state.audit[0].action).toBe("ALERT_RULE_FLOOR_UPDATE");
  });

  it("does not report success when RLS silently refuses the write", async () => {
    // PostgREST returns zero rows and no error when a policy blocks the write.
    state.ruleWrite = { data: null, error: null };
    const res = await post({ suspect_id: SUSPECT, threshold: 0.6 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "rule insert was refused" });
    expect(state.audit).toEqual([]);
  });

  it("surfaces a failed lookup instead of creating a second rule", async () => {
    state.rulesFind = { data: [], error: { message: "connection reset" } };
    const res = await post({ suspect_id: SUSPECT, threshold: 0.6 });
    expect(res.status).toBe(500);
    expect(state.writes).toEqual([]);
  });
});
