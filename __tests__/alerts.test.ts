/**
 * Alert workflow (alerts.state): the pure state machine in lib/alerts.ts and
 * HTTP-level tests for POST /api/alerts/[id]/state. Auth and the service
 * client are mocked at the module boundary; the route code runs for real.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  ALERT_STATES,
  alertStateLabelKey,
  asAlertState,
  auditActionFor,
  canTransition,
  isAlertState,
  stateBadgeVariant,
} from "@/lib/alerts";

import type { AlertState } from "@/lib/database.types";

// ── route mocks ───────────────────────────────────────────────────────

type AlertRow = { id: string; state: string; suspect_name: string; acknowledged_at: string | null } | null;

const routeState: {
  auth: "ok" | "unauthorized";
  alert: AlertRow;
  casHit: boolean;
  updates: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
} = { auth: "ok", alert: null, casHit: true, updates: [], audits: [] };

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => {
    if (routeState.auth === "unauthorized") {
      return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
    }
    return { user: { id: "admin-1", email: "admin@x" }, profile: { role: "admin" } };
  }),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "alerts" ? routeState.alert : null, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        routeState.updates.push(patch);
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: routeState.casHit ? { id: "x" } : null, error: null }),
              }),
            }),
          }),
        };
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_log") routeState.audits.push(row);
        return { error: null };
      },
    }),
  }),
}));

const ALERT = "11111111-2222-4333-8444-555555555555";

function call(id: string, body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { POST } = require("@/app/api/alerts/[id]/state/route") as {
    POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  const req = new NextRequest(`http://localhost/api/alerts/${id}/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

// ── lib/alerts ────────────────────────────────────────────────────────

describe("alert workflow states", () => {
  it("exposes the three CHECK-constrained values", () => {
    expect([...ALERT_STATES]).toEqual(["new", "acknowledged", "closed"]);
  });

  it("narrows raw strings and falls back to new", () => {
    expect(isAlertState("closed")).toBe(true);
    expect(isAlertState("CLOSED")).toBe(false);
    expect(isAlertState(null)).toBe(false);
    expect(asAlertState("acknowledged")).toBe("acknowledged");
    expect(asAlertState("bogus")).toBe("new");
    expect(asAlertState(undefined)).toBe("new");
  });
});

describe("canTransition", () => {
  const allowed: Array<[AlertState, AlertState]> = [
    ["new", "acknowledged"],
    ["new", "closed"],
    ["acknowledged", "closed"],
    ["acknowledged", "new"],
    ["closed", "new"],
  ];

  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("rejects every other edge, including self-transitions", () => {
    const allowedSet = new Set(allowed.map(([f, t]) => `${f}>${t}`));
    for (const from of ALERT_STATES) {
      for (const to of ALERT_STATES) {
        if (allowedSet.has(`${from}>${to}`)) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
    expect(canTransition("closed", "acknowledged")).toBe(false);
  });
});

describe("auditActionFor", () => {
  it("maps each legal transition to its audit action", () => {
    expect(auditActionFor("new", "acknowledged")).toBe("ALERT_ACKNOWLEDGED");
    expect(auditActionFor("new", "closed")).toBe("ALERT_CLOSED");
    expect(auditActionFor("acknowledged", "closed")).toBe("ALERT_CLOSED");
    expect(auditActionFor("acknowledged", "new")).toBe("ALERT_REOPENED");
    expect(auditActionFor("closed", "new")).toBe("ALERT_REOPENED");
  });

  it("returns null for illegal transitions", () => {
    expect(auditActionFor("closed", "acknowledged")).toBeNull();
    expect(auditActionFor("new", "new")).toBeNull();
    expect(auditActionFor("closed", "closed")).toBeNull();
  });
});

describe("presentation helpers", () => {
  it("gives every state a badge variant and a translation key", () => {
    expect(stateBadgeVariant("new")).toBe("accent");
    expect(stateBadgeVariant("acknowledged")).toBe("warning");
    expect(stateBadgeVariant("closed")).toBe("muted");
    expect(alertStateLabelKey("new")).toBe("al_state_new");
    expect(alertStateLabelKey("acknowledged")).toBe("al_state_acknowledged");
    expect(alertStateLabelKey("closed")).toBe("al_state_closed");
  });
});

// ── POST /api/alerts/[id]/state ───────────────────────────────────────

describe("POST /api/alerts/[id]/state", () => {
  beforeEach(() => {
    routeState.auth = "ok";
    routeState.alert = { id: ALERT, state: "new", suspect_name: "Demo", acknowledged_at: null };
    routeState.casHit = true;
    routeState.updates = [];
    routeState.audits = [];
  });

  it("rejects a non-UUID id", async () => {
    expect((await call("not-a-uuid", { state: "acknowledged" })).status).toBe(400);
    expect(routeState.updates).toHaveLength(0);
  });

  it("returns the auth helper's response untouched", async () => {
    routeState.auth = "unauthorized";
    expect((await call(ALERT, { state: "acknowledged" })).status).toBe(401);
  });

  it("rejects an unknown state, an oversized note and malformed JSON", async () => {
    expect((await call(ALERT, { state: "bogus" })).status).toBe(400);
    expect((await call(ALERT, { state: "closed", note: "x".repeat(501) })).status).toBe(400);
    expect((await call(ALERT, "{not json")).status).toBe(400);
    expect(routeState.updates).toHaveLength(0);
  });

  it("404s when the alert does not exist", async () => {
    routeState.alert = null;
    expect((await call(ALERT, { state: "acknowledged" })).status).toBe(404);
  });

  it("409s on an illegal transition without writing", async () => {
    routeState.alert = { id: ALERT, state: "closed", suspect_name: "Demo", acknowledged_at: "2026-01-01T00:00:00Z" };
    const res = await call(ALERT, { state: "acknowledged" });
    expect(res.status).toBe(409);
    expect(routeState.updates).toHaveLength(0);
    expect(routeState.audits).toHaveLength(0);
  });

  it("acknowledges: stamps acknowledged_* and audits ALERT_ACKNOWLEDGED", async () => {
    const res = await call(ALERT, { state: "acknowledged" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: "acknowledged" });
    const patch = routeState.updates[0];
    expect(patch.state).toBe("acknowledged");
    expect(patch.acknowledged_by).toBe("admin-1");
    expect(typeof patch.acknowledged_at).toBe("string");
    expect(patch).not.toHaveProperty("closed_by");
    expect(patch).not.toHaveProperty("note");
    expect(routeState.audits[0]).toMatchObject({
      action: "ALERT_ACKNOWLEDGED",
      user_id: "admin-1",
      user_email: "admin@x",
    });
    expect(String(routeState.audits[0].detail)).toContain(ALERT);
    expect(String(routeState.audits[0].detail)).toContain("Demo");
  });

  it("closing from new also acknowledges, stores the trimmed note and audits ALERT_CLOSED", async () => {
    const res = await call(ALERT, { state: "closed", note: "  handled by guard  " });
    expect(res.status).toBe(200);
    const patch = routeState.updates[0];
    expect(patch.state).toBe("closed");
    expect(patch.closed_by).toBe("admin-1");
    expect(typeof patch.closed_at).toBe("string");
    expect(patch.acknowledged_by).toBe("admin-1");
    expect(patch.note).toBe("handled by guard");
    expect(routeState.audits[0].action).toBe("ALERT_CLOSED");
  });

  it("closing an already-acknowledged alert keeps the original acknowledgement", async () => {
    routeState.alert = { id: ALERT, state: "acknowledged", suspect_name: "Demo", acknowledged_at: "2026-01-01T00:00:00Z" };
    await call(ALERT, { state: "closed", note: "   " });
    const patch = routeState.updates[0];
    expect(patch).not.toHaveProperty("acknowledged_by");
    expect(patch.note).toBeNull();
  });

  it("reopening clears closed_* but not acknowledged_* and audits ALERT_REOPENED", async () => {
    routeState.alert = { id: ALERT, state: "closed", suspect_name: "Demo", acknowledged_at: "2026-01-01T00:00:00Z" };
    const res = await call(ALERT, { state: "new" });
    expect(res.status).toBe(200);
    const patch = routeState.updates[0];
    expect(patch).toMatchObject({ state: "new", closed_by: null, closed_at: null });
    expect(patch).not.toHaveProperty("acknowledged_by");
    expect(patch).not.toHaveProperty("acknowledged_at");
    expect(routeState.audits[0].action).toBe("ALERT_REOPENED");
  });

  it("409s when the compare-and-set loses (row changed concurrently)", async () => {
    routeState.casHit = false;
    const res = await call(ALERT, { state: "acknowledged" });
    expect(res.status).toBe(409);
    expect(routeState.audits).toHaveLength(0);
  });
});
