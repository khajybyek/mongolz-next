/**
 * 2026-09-17 admin-privilege review — executable proof for the fixes:
 *  - the step-up cookie records WHICH factor minted it; a password step-up
 *    no longer opens "needs the second factor" gates
 *  - retention edits / manual sweep / camera-permission grants need step-up
 *  - the permission-revoke ledger row names the camera and the user
 *  - push subscriptions are written server-side, step-up gated, audited
 *  - passkey challenges are consumed by value (no anonymous clobbering)
 */
import { buildReauthCookieValue, ensureFreshReauth, hasFreshReauth, verifyReauthCookie } from "@/lib/auth/step-up";
import { challengeFromClientData } from "@/lib/auth/webauthn";
import { buildSecurityEventPush, buildSecurityEventTelegramPayload } from "@/lib/notify";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const CAMERA = "b0000000-0000-4000-8000-000000000001";
const PERM_ROW = "d0000000-0000-4000-8000-000000000009";

const state = {
  role: "admin" as "admin" | "viewer",
  reauthCookie: undefined as string | undefined,
  pushRows: [] as Array<{ id: string; user_id: string; endpoint: string }>,
  permRows: [] as Array<{ id: string; camera_id: string; user_id: string; permission: string }>,
};
type Op = { table: string; op: string; values?: unknown; filters?: Record<string, unknown> };
const ops: Op[] = [];
const events: Array<{ action: string; detail?: string | null }> = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({
    get: (name: string) => (name === "mongolz-reauth" && state.reauthCookie ? { value: state.reauthCookie } : undefined),
  }),
}));
jest.mock("@/lib/notify", () => ({
  ...jest.requireActual("@/lib/notify"),
  scheduleSecurityEvent: (e: { action: string; detail?: string | null }) => {
    events.push(e);
  },
}));
jest.mock("@/lib/webhooks", () => ({ dispatchEvent: jest.fn() }));
jest.mock("@/lib/push", () => ({ sendPushToAdminsExcept: jest.fn(), sendPushToUser: jest.fn() }));
jest.mock("@/lib/retention", () => ({ runRetentionSweep: jest.fn(async () => ({ recordings: 3 })) }));
jest.mock("@/lib/supabase/auth", () => ({
  isAuthErr: (r: object) => "error" in r,
  requireAdmin: jest.fn(async () => ({
    user: { id: ADMIN, email: "admin@test" },
    profile: { id: ADMIN, role: "admin", totp_enabled: true, is_super_admin: false },
  })),
  requireUserApi: jest.fn(async () => ({
    user: { id: ADMIN, email: "admin@test" },
    profile: { id: ADMIN, role: state.role, totp_enabled: state.role === "admin", is_super_admin: false },
  })),
}));

function query(table: string, op: string, values?: unknown) {
  // `filters` is filled in by .eq() / .neq() after the push; "!col" = neq.
  const filters: Record<string, unknown> = {};
  ops.push({ table, op, values, filters });
  const result = () => {
    if (table === "push_subscriptions" && op === "select") {
      const hit = state.pushRows.find((r) => r.endpoint === filters.endpoint);
      return { data: hit ?? null, error: null, count: state.pushRows.filter((r) => r.user_id === filters.user_id).length };
    }
    if (table === "push_subscriptions" && op === "upsert") {
      return { data: { id: "sub-1", endpoint: (values as { endpoint: string }).endpoint, enabled: true, created_at: "now" }, error: null };
    }
    if (table === "camera_permissions" && op === "upsert") {
      const v = values as { camera_id: string; user_id: string; permission: string };
      const dup = state.permRows.some(
        (r) => r.camera_id === v.camera_id && r.user_id === v.user_id && r.permission === v.permission,
      );
      if (!dup) state.permRows.push({ id: `row-${state.permRows.length + 1}`, ...v });
      return { data: null, error: null };
    }
    if (table === "camera_permissions" && op === "delete") {
      const match = (r: Record<string, string>) =>
        Object.entries(filters).every(([k, v]) => (k.startsWith("!") ? r[k.slice(1)] !== v : r[k] === v));
      const removed = state.permRows.filter(match);
      state.permRows = state.permRows.filter((r) => !match(r));
      return { data: removed, error: null };
    }
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "lt", "range"]) q[m] = () => q;
  q.eq = (col: string, v: unknown) => {
    filters[col] = v;
    return q;
  };
  q.neq = (col: string, v: unknown) => {
    filters[`!${col}`] = v;
    return q;
  };
  q.single = async () => result();
  q.maybeSingle = async () => result();
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return q;
}
const rpcCalls: Array<{ client: "user" | "service"; fn: string; args: Record<string, unknown> }> = [];
const rpcState = { releaseDeployed: true };
const fakeClient = (client: "user" | "service" = "user") => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ client, fn, args });
    if (fn === "release_incident_recording_hold" && !rpcState.releaseDeployed) {
      return { data: null, error: { code: "PGRST202", message: "not found" } };
    }
    return { data: args.p_evidence_id, error: null };
  },
  from: (table: string) => ({
    select: () => query(table, "select"),
    insert: (v: unknown) => query(table, "insert", v),
    upsert: (v: unknown) => query(table, "upsert", v),
    update: (v: unknown) => query(table, "update", v),
    delete: () => query(table, "delete"),
  }),
});
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeClient("user"),
  createServiceClient: () => fakeClient("service"),
}));

import { runSweepAction, updateRetentionAction } from "@/app/(app)/retention/actions";
import { grantCameraPermissionAction, revokeCameraPermissionAction } from "@/app/(app)/cameras/[id]/permissions/actions";
import { POST as subscribePush, DELETE as unsubscribePush } from "@/app/api/push/subscribe/route";
import { setEvidenceHoldAction } from "@/app/(app)/incidents/actions";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const soon = () => new Date(Date.now() + 15 * 60_000);
const audits = (action: string) =>
  ops.filter((o) => o.table === "audit_log" && o.op === "insert" && (o.values as { action: string }).action === action);

beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET = "admin-privilege-hardening-test-secret";
});
beforeEach(() => {
  ops.length = 0;
  events.length = 0;
  rpcCalls.length = 0;
  rpcState.releaseDeployed = true;
  state.role = "admin";
  state.reauthCookie = undefined;
  state.pushRows = [];
  state.permRows = [{ id: PERM_ROW, camera_id: CAMERA, user_id: OTHER, permission: "view" }];
});

describe("step-up cookie is bound to the factor that minted it", () => {
  it("labels the factor and a password cookie cannot be re-labelled", () => {
    const pw = buildReauthCookieValue(ADMIN, soon(), "password");
    const totp = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(verifyReauthCookie(pw, ADMIN)?.factor).toBe("password");
    expect(verifyReauthCookie(totp, ADMIN)?.factor).toBe("totp");
    expect(buildReauthCookieValue(ADMIN, soon())).not.toBe(totp); // default is the weaker factor
    expect(verifyReauthCookie(buildReauthCookieValue(ADMIN, soon()), ADMIN)?.factor).toBe("password");
  });

  it("a password step-up does NOT satisfy the default gate (TOTP disable, passkeys, users, retention…)", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "password");
    expect(await hasFreshReauth(ADMIN)).toBe(false);
    expect(await ensureFreshReauth(ADMIN)).toEqual({ error: "REAUTH_REQUIRED" });
    // …but still lets an admin REQUEST a reveal (a second admin + TOTP approves it).
    expect(await hasFreshReauth(ADMIN, { allowPassword: true })).toBe(true);
  });

  it("a TOTP step-up satisfies every gate, and only for its own user", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await hasFreshReauth(ADMIN)).toBe(true);
    expect(await hasFreshReauth(OTHER)).toBe(false);
  });
});

describe("destructive retention changes need the second factor", () => {
  it("refuses a bare session, audits the refusal and touches no policy", async () => {
    const res = await updateRetentionAction(fd({ resource: "recordings", retention_days: "1", enabled: "true" }));
    expect(res).toEqual({ error: "REAUTH_REQUIRED" });
    expect(await runSweepAction()).toEqual({ error: "REAUTH_REQUIRED" });
    expect(ops.filter((o) => o.table === "retention_policies")).toEqual([]);
    expect(audits("RETENTION_STEP_UP_REQUIRED")).toHaveLength(2);
    expect(events).toEqual([]);
  });

  it("refuses a password-minted step-up too", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "password");
    expect(await runSweepAction()).toEqual({ error: "REAUTH_REQUIRED" });
  });

  it("with a TOTP step-up it applies, audits and notifies the other admins", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await updateRetentionAction(fd({ resource: "faces", retention_days: "30", enabled: "true" }))).toEqual({ ok: true });
    expect(await runSweepAction()).toEqual({ ok: true });
    expect(ops.some((o) => o.table === "retention_policies" && o.op === "update")).toBe(true);
    expect(events.map((e) => e.action)).toEqual(["RETENTION_POLICY_UPDATE", "RETENTION_SWEEP_MANUAL"]);
  });
});

describe("camera permissions", () => {
  it("granting unmasked live access needs the second factor", async () => {
    const grant = () => grantCameraPermissionAction(fd({ camera_id: CAMERA, user_id: OTHER, permission: "view" }));
    expect(await grant()).toEqual({ error: "REAUTH_REQUIRED" });
    expect(ops.filter((o) => o.table === "camera_permissions")).toEqual([]);
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await grant()).toEqual({ ok: true });
    expect(events.map((e) => e.action)).toEqual(["CAM_PERM_GRANT"]);
  });

  it("the revoke ledger row names the camera and the user that lost access", async () => {
    expect(await revokeCameraPermissionAction(CAMERA, OTHER)).toEqual({ ok: true });
    const [row] = audits("CAM_PERM_REVOKE");
    const detail = String((row!.values as { detail: string }).detail);
    expect(detail).toContain(`camera=${CAMERA}`);
    expect(detail).toContain(`user=${OTHER}`);
    expect(detail).toContain("perm=view");
    expect(detail).toContain(PERM_ROW);
    expect(events.map((e) => e.action)).toEqual(["CAM_PERM_REVOKE"]);
  });

  it("a grant replaces the user's other kind instead of adding a second row (one row per person)", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    state.permRows = [
      { id: "op-row", camera_id: CAMERA, user_id: OTHER, permission: "operate" },
      { id: "keep", camera_id: CAMERA, user_id: ADMIN, permission: "operate" },
    ];
    expect(await grantCameraPermissionAction(fd({ camera_id: CAMERA, user_id: OTHER, permission: "view" }))).toEqual({
      ok: true,
    });
    const mine = state.permRows.filter((r) => r.user_id === OTHER && r.camera_id === CAMERA);
    expect(mine.map((r) => r.permission)).toEqual(["view"]);
    // Nobody else's rows are touched.
    expect(state.permRows.find((r) => r.id === "keep")).toBeDefined();
    // The new row is written BEFORE the old one goes, so access never lapses.
    const permOps = ops.filter((o) => o.table === "camera_permissions").map((o) => o.op);
    expect(permOps).toEqual(["upsert", "delete"]);
    const [row] = audits("CAM_PERM_GRANT");
    expect(String((row!.values as { detail: string }).detail)).toContain("perm=view (replaced operate)");
  });

  it("re-granting the same kind is idempotent and says nothing was replaced", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await grantCameraPermissionAction(fd({ camera_id: CAMERA, user_id: OTHER, permission: "view" }))).toEqual({
      ok: true,
    });
    expect(state.permRows).toEqual([{ id: PERM_ROW, camera_id: CAMERA, user_id: OTHER, permission: "view" }]);
    const [row] = audits("CAM_PERM_GRANT");
    expect(String((row!.values as { detail: string }).detail)).not.toContain("replaced");
  });

  it("revoke removes EVERY row the user holds on the camera — a leftover row would keep live access", async () => {
    state.permRows = [
      { id: "a", camera_id: CAMERA, user_id: OTHER, permission: "view" },
      { id: "b", camera_id: CAMERA, user_id: OTHER, permission: "operate" },
      { id: "other-cam", camera_id: "c0000000-0000-4000-8000-000000000002", user_id: OTHER, permission: "view" },
    ];
    expect(await revokeCameraPermissionAction(CAMERA, OTHER)).toEqual({ ok: true });
    expect(state.permRows.map((r) => r.id)).toEqual(["other-cam"]);
    const del = ops.find((o) => o.table === "camera_permissions" && o.op === "delete");
    expect(del?.filters).toEqual({ camera_id: CAMERA, user_id: OTHER });
    const [row] = audits("CAM_PERM_REVOKE");
    expect(String((row!.values as { detail: string }).detail)).toContain("perm=view,operate");
  });

  it("revoke refuses malformed ids without touching any row", async () => {
    const res = await revokeCameraPermissionAction("not-a-uuid", OTHER);
    expect(res).toHaveProperty("error");
    expect(ops.filter((o) => o.table === "camera_permissions")).toEqual([]);
  });
});

describe("push subscriptions are a server-written, audited channel", () => {
  const body = { endpoint: "https://push.example.test/abc", keys: { p256dh: "p".repeat(40), auth: "a".repeat(20) } };
  const post = () =>
    subscribePush(new Request("https://app.test/api/push/subscribe", { method: "POST", body: JSON.stringify(body) }));

  it("an admin must present TOTP before a channel is registered", async () => {
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "REAUTH_REQUIRED" });
    expect(ops.filter((o) => o.table === "push_subscriptions")).toEqual([]);
  });

  it("registers with an audit row once stepped up; viewers need no step-up", async () => {
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect((await post()).status).toBe(200);
    expect(audits("PUSH_SUBSCRIBED")).toHaveLength(1);
    state.reauthCookie = undefined;
    state.role = "viewer";
    expect((await post()).status).toBe(200);
  });

  it("never re-points an endpoint that belongs to someone else, and caps rows per user", async () => {
    state.role = "viewer";
    state.pushRows = [{ id: "x", user_id: OTHER, endpoint: body.endpoint }];
    expect((await post()).status).toBe(409);
    state.pushRows = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, user_id: ADMIN, endpoint: `https://push.example.test/${i}` }));
    expect((await post()).status).toBe(409);
    expect(ops.filter((o) => o.op === "upsert")).toEqual([]);
  });

  it("rejects non-https endpoints and lets anyone remove their own channel", async () => {
    state.role = "viewer";
    const res = await subscribePush(
      new Request("https://app.test/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ ...body, endpoint: "http://10.0.0.5/hook" }),
      }),
    );
    expect(res.status).toBe(400);
    const del = await unsubscribePush(
      new Request(`https://app.test/api/push/subscribe?endpoint=${encodeURIComponent(body.endpoint)}`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);
  });
});

describe("passkey challenge is looked up by the value the authenticator signed", () => {
  it("extracts the challenge from clientDataJSON and rejects junk", () => {
    const cdj = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: "abc_DEF-123", origin: "https://aicctv.dev" })).toString("base64url");
    expect(challengeFromClientData(cdj)).toBe("abc_DEF-123");
    expect(challengeFromClientData("not-json")).toBeNull();
    expect(challengeFromClientData(undefined)).toBeNull();
    expect(challengeFromClientData(Buffer.from(JSON.stringify({ challenge: 7 })).toString("base64url"))).toBeNull();
  });
});

describe("security-event notification wire format", () => {
  it("carries action, actor and the id-only detail", () => {
    const input = { action: "TOTP_DISABLED", actorId: ADMIN, actorEmail: "admin@test", detail: `account ${ADMIN}` };
    const at = new Date("2026-09-17T00:00:00.000Z");
    expect(buildSecurityEventTelegramPayload(input, at)).toEqual({
      kind: "security_event",
      action: "TOTP_DISABLED",
      actor_email: "admin@test",
      detail: `account ${ADMIN}`,
      at: at.toISOString(),
    });
    expect(buildSecurityEventPush(input).title).toContain("TOTP_DISABLED");
  });
});

describe("step-up-gated changes cannot be replayed through PostgREST", () => {
  const INCIDENT = "e0000000-0000-4000-8000-000000000001";
  const EVIDENCE = "e0000000-0000-4000-8000-000000000002";
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260917150000_admin_privilege_hardening.sql"),
    "utf8",
  ).replace(/\s+/g, " ");

  it("the migration removes direct DML on the tables behind the gated actions", () => {
    expect(sql).toContain(
      "revoke insert, update, delete, truncate, references, trigger on public.retention_policies, public.camera_permissions, public.cameras from anon, authenticated;",
    );
    expect(sql).toContain(
      "revoke delete, truncate, references, trigger on public.recordings, public.faces, public.alerts from anon, authenticated;",
    );
    expect(sql).toContain("releasing a hold requires step-up");
    expect(sql).toContain(
      "revoke all on function public.release_incident_recording_hold(uuid, uuid) from public, anon, authenticated;",
    );
  });

  it("no camera write uses the caller's own token", () => {
    const src = readFileSync(join(process.cwd(), "app/(app)/cameras/actions.ts"), "utf8");
    expect(src).not.toMatch(/createClient\(/);
  });

  it("releasing a hold needs TOTP and runs with the service role, naming the actor", async () => {
    expect(await setEvidenceHoldAction({ incidentId: INCIDENT, evidenceId: EVIDENCE, legalHold: false })).toEqual({
      error: "REAUTH_REQUIRED",
    });
    expect(rpcCalls).toHaveLength(0);

    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await setEvidenceHoldAction({ incidentId: INCIDENT, evidenceId: EVIDENCE, legalHold: false })).toEqual({
      ok: true,
      id: EVIDENCE,
    });
    expect(rpcCalls).toEqual([
      { client: "service", fn: "release_incident_recording_hold", args: { p_evidence_id: EVIDENCE, p_actor: ADMIN } },
    ]);
    expect(events.map((e) => e.action)).toContain("EVIDENCE_HOLD_RELEASED");
  });

  it("before the migration is applied the release falls back to the old RPC; applying a hold stays one click", async () => {
    rpcState.releaseDeployed = false;
    state.reauthCookie = buildReauthCookieValue(ADMIN, soon(), "totp");
    expect(await setEvidenceHoldAction({ incidentId: INCIDENT, evidenceId: EVIDENCE, legalHold: false })).toMatchObject({ ok: true });
    expect(rpcCalls.map((c) => `${c.client}:${c.fn}`)).toEqual([
      "service:release_incident_recording_hold",
      "user:set_incident_recording_hold",
    ]);

    rpcCalls.length = 0;
    state.reauthCookie = undefined;
    expect(await setEvidenceHoldAction({ incidentId: INCIDENT, evidenceId: EVIDENCE, legalHold: true })).toMatchObject({ ok: true });
    expect(rpcCalls.map((c) => `${c.client}:${c.fn}`)).toEqual(["user:set_incident_recording_hold"]);
  });
});
