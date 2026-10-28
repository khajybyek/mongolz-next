/**
 * HTTP-level tests for the TOTP enrolment, regeneration and disable routes.
 * Auth, database, rate limiter and step-up are mocked at the module boundary;
 * the recovery-code generator is real.
 *
 * Regressions covered: verify/disable used to ignore the profiles UPDATE
 * error — enrolment then signed the user out holding recovery codes for a
 * factor that was never enabled, and disable audited TOTP_DISABLED, dropped
 * push subscriptions and alerted the other admins about a removal that never
 * happened.
 */
import { NextRequest, NextResponse } from "next/server";

type Row = Record<string, unknown>;
interface Op {
  table: string;
  ops: string[];
  args: unknown[][];
}

const db: {
  profile: Row | null;
  updateResult: { data: Row[] | null; error: { message: string } | null };
  ops: Op[];
  inserts: { table: string; row: Row }[];
} = { profile: null, updateResult: { data: [{ id: "u-1" }], error: null }, ops: [], inserts: [] };

function from(table: string) {
  const op: Op = { table, ops: [], args: [] };
  db.ops.push(op);
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "update", "delete"]) {
    q[name] = (...args: unknown[]) => {
      op.ops.push(name);
      op.args.push(args);
      return q;
    };
  }
  q.single = async () => ({ data: db.profile, error: null });
  q.insert = async (row: Row) => {
    db.inserts.push({ table, row });
    return { error: null };
  };
  q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const result = op.ops.includes("update") && table === "profiles" ? db.updateResult : { data: null, error: null };
    return Promise.resolve(result).then(resolve, reject);
  };
  return q;
}

const signOut = jest.fn(async () => ({ error: null }));
const probeSignIn = jest.fn(async () => ({ error: null as { message: string } | null }));
const checkTotpCode = jest.fn();
const releaseRateLimit = jest.fn(async () => {});
const scheduleSecurityEvent = jest.fn();
let freshReauth = true;

jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => ({
    user: { id: "u-1", email: "u@x" },
    profile: { role: "admin" },
  })),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from }),
  createClient: async () => ({ auth: { signOut } }),
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: probeSignIn, signOut: async () => ({}) } }),
}));

jest.mock("@/lib/rate-limit", () => ({
  REAUTH_LIMIT: { scope: "reauth", max: 5, windowSec: 60 },
  checkTotpCode: (...a: unknown[]) => checkTotpCode(...a),
  totpCheckResponse: (r: { status: number; error: string; reason?: string }) =>
    NextResponse.json({ error: r.error, code: r.reason }, { status: r.status }),
  checkRateLimit: async () => ({ ok: true, remaining: 4, resetSec: 60 }),
  releaseRateLimit: (...a: unknown[]) => (releaseRateLimit as unknown as (...x: unknown[]) => Promise<void>)(...a),
  rateLimitResponse: () => NextResponse.json({ error: "rate limited" }, { status: 429 }),
}));

jest.mock("@/lib/auth/step-up", () => ({ hasFreshReauth: async () => freshReauth }));
jest.mock("@/lib/notify", () => ({ scheduleSecurityEvent: (...a: unknown[]) => scheduleSecurityEvent(...a) }));

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* eslint-disable @typescript-eslint/no-require-imports */
const verify = () => require("@/app/api/auth/totp/verify/route") as { POST: (r: NextRequest) => Promise<Response> };
const disable = () => require("@/app/api/auth/totp/disable/route") as { POST: (r: NextRequest) => Promise<Response> };
const regenerate = () =>
  require("@/app/api/auth/totp/recovery/regenerate/route") as { POST: (r: NextRequest) => Promise<Response> };
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  db.profile = { totp_secret: "SECRET", totp_enabled: false, totp_recovery_codes: [] }; // pragma: allowlist secret
  db.updateResult = { data: [{ id: "u-1" }], error: null };
  db.ops = [];
  db.inserts = [];
  freshReauth = true;
  signOut.mockClear();
  probeSignIn.mockReset();
  probeSignIn.mockResolvedValue({ error: null });
  checkTotpCode.mockReset();
  checkTotpCode.mockResolvedValue({ ok: true });
  releaseRateLimit.mockClear();
  scheduleSecurityEvent.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

const actions = () => db.inserts.filter((i) => i.table === "audit_log").map((i) => i.row.action);

describe("POST /api/auth/totp/verify (enrolment)", () => {
  it("enables TOTP with a compare-and-set, returns ten codes once and ends the session", async () => {
    const res = await verify().POST(post("/api/auth/totp/verify", { code: "123456" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relogin_required).toBe(true);
    expect(body.recovery_codes).toHaveLength(10);
    const update = db.ops.find((o) => o.ops.includes("update"))!;
    expect(update.args).toContainEqual(["totp_enabled", false]);
    expect(actions()).toEqual(["TOTP_ENABLED"]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("answers 500 with no codes, no audit row and no sign-out when the update fails", async () => {
    db.updateResult = { data: null, error: { message: "db down" } };
    const res = await verify().POST(post("/api/auth/totp/verify", { code: "123456" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "enable_failed" });
    expect(actions()).toEqual([]);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("answers 409 when a parallel enrolment already flipped the flag", async () => {
    db.updateResult = { data: [], error: null };
    const res = await verify().POST(post("/api/auth/totp/verify", { code: "123456" }));
    expect(res.status).toBe(409);
    expect((await res.json()).recovery_codes).toBeUndefined();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("passes a wrong code's refusal through without touching the profile", async () => {
    checkTotpCode.mockResolvedValue({ ok: false, status: 401, error: "wrong", reason: "invalid" });
    const res = await verify().POST(post("/api/auth/totp/verify", { code: "000000" }));
    expect(res.status).toBe(401);
    expect(db.ops.some((o) => o.ops.includes("update"))).toBe(false);
  });

  it("skips the replay ledger only for first-time enrolment", async () => {
    await verify().POST(post("/api/auth/totp/verify", { code: "123456" }));
    expect(checkTotpCode.mock.calls[0][0]).toMatchObject({ skipReplayCheck: true });
    checkTotpCode.mockClear();
    db.profile = { totp_secret: "SECRET", totp_enabled: true }; // pragma: allowlist secret
    const res = await verify().POST(post("/api/auth/totp/verify", { code: "123456" }));
    expect(checkTotpCode.mock.calls[0][0]).toMatchObject({ skipReplayCheck: false });
    expect((await res.json()).recovery_codes).toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1); // only the enrolment call above
  });
});

describe("POST /api/auth/totp/recovery/regenerate", () => {
  beforeEach(() => {
    db.profile = { totp_secret: "SECRET", totp_enabled: true }; // pragma: allowlist secret
  });

  it("re-issues ten codes after a valid TOTP code", async () => {
    const res = await regenerate().POST(post("/api/auth/totp/recovery/regenerate", { code: "123456" }));
    expect(res.status).toBe(200);
    expect((await res.json()).recovery_codes).toHaveLength(10);
    expect(actions()).toEqual(["TOTP_RECOVERY_REGENERATED"]);
  });

  it("does not leak the database error text", async () => {
    db.updateResult = { data: null, error: { message: "relation profiles secret detail" } };
    const res = await regenerate().POST(post("/api/auth/totp/recovery/regenerate", { code: "123456" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "regenerate_failed" });
    expect(actions()).toEqual([]);
  });
});

describe("POST /api/auth/totp/disable", () => {
  beforeEach(() => {
    db.profile = { totp_secret: "SECRET", totp_enabled: true }; // pragma: allowlist secret
  });

  it("refuses without a TOTP-minted step-up and refunds the throttle unit", async () => {
    freshReauth = false;
    const res = await disable().POST(post("/api/auth/totp/disable", { password: "pw" })); // pragma: allowlist secret
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("REAUTH_REQUIRED");
    expect(releaseRateLimit).toHaveBeenCalledTimes(1);
    expect(probeSignIn).not.toHaveBeenCalled();
  });

  it("keeps the throttle unit and audits a wrong password", async () => {
    probeSignIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const res = await disable().POST(post("/api/auth/totp/disable", { password: "bad" })); // pragma: allowlist secret
    expect(res.status).toBe(401);
    expect(releaseRateLimit).not.toHaveBeenCalled();
    expect(actions()).toEqual(["TOTP_DISABLE_FAILED"]);
  });

  it("clears the factor, drops push subscriptions and alerts the other admins", async () => {
    const res = await disable().POST(post("/api/auth/totp/disable", { password: "pw" })); // pragma: allowlist secret
    expect(res.status).toBe(200);
    expect(actions()).toEqual(["TOTP_DISABLED"]);
    expect(db.ops.some((o) => o.table === "push_subscriptions" && o.ops.includes("delete"))).toBe(true);
    expect(scheduleSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "TOTP_DISABLED" }));
  });

  it("answers 500 and changes nothing else when the update fails", async () => {
    db.updateResult = { data: null, error: { message: "db down" } };
    const res = await disable().POST(post("/api/auth/totp/disable", { password: "pw" })); // pragma: allowlist secret
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "disable_failed" });
    expect(actions()).toEqual([]);
    expect(db.ops.some((o) => o.table === "push_subscriptions")).toBe(false);
    expect(scheduleSecurityEvent).not.toHaveBeenCalled();
  });
});
