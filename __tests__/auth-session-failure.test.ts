import { NextRequest } from "next/server";
import { checkSessionPin } from "@/lib/auth/session-pin";
import { flag } from "@/lib/flags";
import { updateSession } from "@/lib/supabase/middleware";
import {
  isAuthErr,
  requireAdmin,
  requireAdminApi,
  requireAdminOrAuditor,
  requireAdminOrAuditorApi,
  requireOperator,
  requireUser,
  requireUserApi,
} from "@/lib/supabase/auth";

const user = { id: "admin-1", email: "admin@example.test" };
const profile = { id: user.id, email: user.email, role: "admin", totp_enabled: true };
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const signOut = jest.fn();
const auditInsert = jest.fn();
const getSession = jest.fn();
const rpc = jest.fn();

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function accessToken(claims: Record<string, unknown> = {}): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub: user.id, session_id: SESSION_ID, ...claims })}.c2ln`;
}

jest.mock("next/navigation", () => ({
  redirect: (url: string): never => { throw new Error(`redirect:${url}`); },
}));
jest.mock("@/lib/auth/session-pin", () => ({ checkSessionPin: jest.fn() }));
jest.mock("@/lib/flags", () => ({ flag: jest.fn() }));
jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }), getSession, signOut },
    from: () => ({ select: () => ({ eq: () => ({
      single: async () => ({ data: profile, error: null }),
    }) }) }),
  }),
  createServiceClient: () => ({ from: () => ({ insert: auditInsert }), rpc }),
}));

const apiHelpers = [requireUserApi, requireAdminApi, requireAdminOrAuditorApi];
const pageHelpers = [requireUser, requireAdmin, requireAdminOrAuditor];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(flag).mockReturnValue(true);
  jest.mocked(checkSessionPin).mockResolvedValue({ ok: true });
  profile.totp_enabled = true;
  getSession.mockResolvedValue({ data: { session: { access_token: accessToken() } } });
  // A bound session unless a test says otherwise.
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("session verification availability", () => {
  it.each(["throws", "no-secret"] as const)("blocks protected APIs and pages when verification %s without revoking sessions", async (failure) => {
    if (failure === "throws") jest.mocked(checkSessionPin).mockRejectedValue(new Error("internal detail"));
    else jest.mocked(checkSessionPin).mockResolvedValue({ ok: false, reason: "no-secret" });

    for (const helper of apiHelpers) {
      const result = await helper();
      expect(isAuthErr(result)).toBe(true);
      if (!isAuthErr(result)) throw new Error("protected API granted access");
      expect(result.error.status).toBe(503);
      expect(await result.error.json()).toEqual({ error: "server_config" });
    }
    for (const helper of pageHelpers) {
      await expect(helper()).rejects.toThrow("redirect:/login?error=server_config");
    }
    expect(signOut).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("accepts a valid pin through every protected helper", async () => {
    for (const helper of [...apiHelpers, ...pageHelpers]) {
      expect(await helper()).toEqual({ user, profile });
    }
    expect(checkSessionPin).toHaveBeenCalledWith(user.id);
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["bad-signature", "global"],
    ["mismatch", "global"],
    ["no-cookie", "global"],
    // Benign: the pin aged out, or a legacy network-bound pin met the user's
    // own browser on a new network. Only THIS session ends — the account's
    // other devices must not be signed out with it.
    ["expired", "local"],
    ["stale", "local"],
  ] as const)("rejects an invalid %s pin and revokes the session (%s)", async (reason, scope) => {
    jest.mocked(checkSessionPin).mockResolvedValue({ ok: false, reason });
    const result = await requireUserApi();
    if (!isAuthErr(result)) throw new Error("invalid session granted access");
    expect(result.error.status).toBe(401);
    expect(await result.error.json()).toEqual({ error: "session_invalid" });
    await expect(requireUser()).rejects.toThrow("redirect:/login?error=session_pin");
    expect(signOut).toHaveBeenCalledWith({ scope });
    expect(signOut).not.toHaveBeenCalledWith({ scope: scope === "local" ? "global" : "local" });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: "SESSION_PIN_REJECTED", detail: `reason: ${reason}`,
    }));
  });

  it("preserves the explicit enforcement flag without checking the pin", async () => {
    jest.mocked(flag).mockReturnValue(false);
    jest.mocked(checkSessionPin).mockRejectedValue(new Error("must not run"));
    expect(await requireAdminApi()).toEqual({ user, profile });
    expect(checkSessionPin).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses a profile whose role this build does not serve", async () => {
    const original = profile.role;
    profile.role = "retired-role";
    try {
      const result = await requireUserApi({ ownAccount: true });
      if (!isAuthErr(result)) throw new Error("unknown role granted access");
      expect(result.error.status).toBe(401);
      await expect(requireUser()).rejects.toThrow("redirect:/login?error=no_profile");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(checkSessionPin).not.toHaveBeenCalled();
    } finally {
      profile.role = original;
    }
  });

  it("retains missing-cookie compatibility for an account without TOTP", async () => {
    profile.totp_enabled = false;
    jest.mocked(checkSessionPin).mockResolvedValue({ ok: false, reason: "no-cookie" });
    expect(await requireUserApi()).toEqual({ user, profile });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("renders the public configuration error page without redirecting a retained session back to the dashboard", async () => {
    const response = await updateSession(new NextRequest("https://app.test/login?error=server_config"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("renders the no-profile error instead of bouncing a retained session into a loop", async () => {
    // requireUser() redirects here without the session necessarily being gone,
    // so a bounce back to /dashboard hits the same failure forever.
    const response = await updateSession(new NextRequest("https://app.test/login?error=no_profile"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("renders the session_rebind error instead of bouncing a surviving session into a loop", async () => {
    // The loader signs the unbound session out locally; if that failed, the
    // session survives and a bounce to /dashboard would send it straight back.
    const response = await updateSession(new NextRequest("https://app.test/login?error=session_rebind"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/login", "/login?error=session_pin"])("preserves the authenticated login redirect for %s", async (path) => {
    const response = await updateSession(new NextRequest(`https://app.test${path}`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  });
});

describe("session binding (migration 20260928120000)", () => {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("admits a bound TOTP session after asking the database once", async () => {
    expect(await requireUserApi()).toEqual({ user, profile });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("mfa_session_bound", { p_session_id: SESSION_ID });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs an unbound TOTP session out LOCALLY and sends pages to /login?error=session_rebind", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireUser()).rejects.toThrow("redirect:/login?error=session_rebind");
    await expect(requireAdmin()).rejects.toThrow("redirect:/login?error=session_rebind");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(signOut).not.toHaveBeenCalledWith({ scope: "global" });
    expect(signOut).not.toHaveBeenCalledWith();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: "SESSION_REBIND_REQUIRED", user_id: user.id,
    }));
  });

  it("answers API callers 401 session_rebind", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    for (const helper of apiHelpers) {
      const result = await helper();
      if (!isAuthErr(result)) throw new Error("unbound session granted access");
      expect(result.error.status).toBe(401);
      expect(await result.error.json()).toEqual({ error: "session_rebind" });
    }
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("still redirects when the local sign-out throws (Server Component cookie write)", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    signOut.mockRejectedValueOnce(new Error("cookies are read-only here"));
    await expect(requireUser()).rejects.toThrow("redirect:/login?error=session_rebind");
  });

  it.each([
    ["the RPC is not deployed yet (PGRST202)", { data: null, error: { code: "PGRST202", message: "Could not find the function" } }],
    ["the RPC is not deployed yet (42883)", { data: null, error: { code: "42883", message: "function does not exist" } }],
    ["the RPC errors", { data: null, error: { code: "57014", message: "statement timeout" } }],
    ["the RPC answers NULL", { data: null, error: null }],
  ])("signs nobody out when %s", async (_label, reply) => {
    rpc.mockResolvedValue(reply);
    for (const helper of [...apiHelpers, ...pageHelpers]) {
      expect(await helper()).toEqual({ user, profile });
    }
    expect(signOut).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("signs nobody out when the RPC call itself throws", async () => {
    rpc.mockRejectedValue(new Error("fetch failed"));
    expect(await requireUserApi()).toEqual({ user, profile });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs nobody out when the access token is unreadable or not this user's", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    for (const session of [null, { access_token: "garbage" }, { access_token: accessToken({ sub: "someone-else" }) }, { access_token: accessToken({ session_id: undefined }) }]) {
      getSession.mockResolvedValue({ data: { session } });
      expect(await requireUserApi()).toEqual({ user, profile });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("costs a non-TOTP account nothing: no token read, no RPC", async () => {
    profile.totp_enabled = false;
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await requireUserApi()).toEqual({ user, profile });
    expect(getSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not ask about binding once the pin has already rejected the session", async () => {
    jest.mocked(checkSessionPin).mockResolvedValue({ ok: false, reason: "mismatch" });
    await expect(requireUser()).rejects.toThrow("redirect:/login?error=session_pin");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("operator scope (admin | viewer)", () => {
  afterEach(() => {
    profile.role = "admin";
  });

  it.each(["admin", "viewer"])("requireOperator and requireUserApi() admit %s", async (role) => {
    profile.role = role;
    expect(await requireOperator()).toEqual({ user, profile });
    expect(await requireUserApi()).toEqual({ user, profile });
  });

  it("requireOperator sends an auditor to /audit (server actions bypass the middleware)", async () => {
    profile.role = "auditor";
    await expect(requireOperator()).rejects.toThrow("redirect:/audit");
  });

  it("requireUserApi() refuses an auditor by default and admits it for its own account", async () => {
    profile.role = "auditor";
    const refused = await requireUserApi();
    if (!isAuthErr(refused)) throw new Error("auditor admitted to operator-scope API routes");
    expect(refused.error.status).toBe(403);
    expect(await refused.error.json()).toEqual({ error: "forbidden: auditor scope is /audit only" });
    expect(await requireUserApi({ ownAccount: true })).toEqual({ user, profile });
    expect(await requireUserApi({ allowAuditor: true })).toEqual({ user, profile });
  });
});
