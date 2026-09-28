/**
 * lib/auth/mfa-session.ts — reading the session id out of a GoTrue access
 * token, binding a freshly minted session, and the loader's verdict. The
 * SQL side (private.mfa_ok, bind_mfa_session, mfa_session_bound) is covered
 * against real Postgres in supabase/tests/mfa_session_binding.test.sql.
 */
import {
  accessTokenClaims,
  bindMfaSession,
  bindMintedSession,
  currentSessionBinding,
  isMissingBindingRpc,
  mfaSessionBound,
  sessionIdFromAccessToken,
} from "@/lib/auth/mfa-session";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SID = "33333333-3333-4333-8333-333333333333";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A GoTrue-shaped access token (signature is irrelevant here). */
function jwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.c2ln`;
}

const token = (extra: Record<string, unknown> = {}) =>
  jwt({ sub: USER, role: "authenticated", session_id: SID, amr: [{ method: "otp", timestamp: 1 }], ...extra });

type Reply = { data: unknown; error: { code?: string; message?: string } | null };

function svcWith(reply: Reply | (() => Promise<Reply>)) {
  const rpc = jest.fn(typeof reply === "function" ? reply : async () => reply);
  const insert = jest.fn(async () => ({ error: null }));
  const from = jest.fn(() => ({ insert }));
  return { client: { rpc, from } as never, rpc, insert, from };
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("sessionIdFromAccessToken", () => {
  it("reads the session_id claim, lower-cased", () => {
    expect(sessionIdFromAccessToken(token({ session_id: SID.toUpperCase() }))).toBe(SID);
  });

  it("decodes UTF-8 payloads (names in user_metadata)", () => {
    const t = token({ user_metadata: { full_name: "Хажыбек 관리자" } });
    expect(accessTokenClaims(t)?.user_metadata).toEqual({ full_name: "Хажыбек 관리자" });
    expect(sessionIdFromAccessToken(t, USER)).toBe(SID);
  });

  it("refuses a token that belongs to another user when the caller says whose it must be", () => {
    expect(sessionIdFromAccessToken(token(), OTHER)).toBeNull();
    expect(sessionIdFromAccessToken(token(), USER)).toBe(SID);
  });

  it.each([
    ["no session_id", token({ session_id: undefined })],
    ["empty session_id", token({ session_id: "" })],
    ["non-uuid session_id", token({ session_id: "not-a-uuid" })],
    ["numeric session_id", token({ session_id: 42 })],
    ["two segments", "a.b"],
    ["garbage payload", "a.%%%.c"],
    ["JSON array payload", `x.${b64url([1, 2])}.y`],
    ["not a string", undefined],
  ])("returns null for %s", (_label, value) => {
    expect(sessionIdFromAccessToken(value)).toBeNull();
  });
});

describe("isMissingBindingRpc", () => {
  it("treats only a not-yet-deployed function as missing", () => {
    expect(isMissingBindingRpc({ code: "PGRST202", message: "Could not find the function public.bind_mfa_session" })).toBe(true);
    expect(isMissingBindingRpc({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingBindingRpc({ message: "Could not find the function public.mfa_session_bound(p_session_id)" })).toBe(true);
    expect(isMissingBindingRpc({ code: "22023", message: "bind_mfa_session: session belongs to another user" })).toBe(false);
    expect(isMissingBindingRpc({ code: "42501", message: "permission denied for function bind_mfa_session" })).toBe(false);
    expect(isMissingBindingRpc({ code: "PGRST203", message: "ambiguous" })).toBe(false);
    expect(isMissingBindingRpc(null)).toBe(false);
  });
});

describe("bindMfaSession", () => {
  it("calls the service-role RPC with the session, user and method", async () => {
    const s = svcWith({ data: null, error: null });
    await expect(bindMfaSession(s.client, { sessionId: SID, userId: USER, method: "totp" })).resolves.toEqual({ state: "bound" });
    expect(s.rpc).toHaveBeenCalledWith("bind_mfa_session", { p_session_id: SID, p_user_id: USER, p_method: "totp" });
  });

  it("reports a missing RPC as unavailable and anything else as failed; never throws", async () => {
    await expect(
      bindMfaSession(svcWith({ data: null, error: { code: "PGRST202" } }).client, { sessionId: SID, userId: USER, method: "passkey" }),
    ).resolves.toEqual({ state: "unavailable" });
    await expect(
      bindMfaSession(svcWith({ data: null, error: { code: "22023", message: "x" } }).client, { sessionId: SID, userId: USER, method: "passkey" }),
    ).resolves.toEqual({ state: "failed", reason: "rpc 22023" });
    await expect(
      bindMfaSession(svcWith(async () => { throw new Error("network down"); }).client, { sessionId: SID, userId: USER, method: "passkey" }),
    ).resolves.toEqual({ state: "failed", reason: "rpc threw" });
  });
});

describe("bindMintedSession", () => {
  const signOut = jest.fn(async () => ({ error: null }));
  const userClient = { auth: { signOut } };

  beforeEach(() => signOut.mockClear());

  it("binds and lets the login finish", async () => {
    const s = svcWith({ data: null, error: null });
    const ok = await bindMintedSession({ svc: s.client, userClient, accessToken: token(), userId: USER, method: "recovery_code" });
    expect(ok).toBe(true);
    expect(s.rpc).toHaveBeenCalledWith("bind_mfa_session", { p_session_id: SID, p_user_id: USER, p_method: "recovery_code" });
    expect(signOut).not.toHaveBeenCalled();
    expect(s.insert).not.toHaveBeenCalled();
  });

  it("continues unbound when the RPC is not deployed yet (web ships first)", async () => {
    const s = svcWith({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const ok = await bindMintedSession({ svc: s.client, userClient, accessToken: token(), userId: USER, method: "totp" });
    expect(ok).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ends the new session LOCALLY and audits when the bind fails", async () => {
    const s = svcWith({ data: null, error: { code: "22023", message: "bind_mfa_session: session not found" } });
    const ok = await bindMintedSession({
      svc: s.client, userClient, accessToken: token(), userId: USER, userEmail: "op@example.test", method: "totp", ip: "203.0.113.7",
    });
    expect(ok).toBe(false);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(s.from).toHaveBeenCalledWith("audit_log");
    expect(s.insert).toHaveBeenCalledWith({
      action: "MFA_SESSION_BIND_FAILED",
      detail: "method: totp · rpc 22023",
      user_id: USER,
      user_email: "op@example.test",
      ip: "203.0.113.7",
    });
  });

  it("fails without calling the RPC when the token carries no session id, or someone else's", async () => {
    for (const accessToken of [token({ session_id: undefined }), token({ sub: OTHER }), undefined]) {
      signOut.mockClear();
      const s = svcWith({ data: null, error: null });
      const ok = await bindMintedSession({ svc: s.client, userClient, accessToken, userId: USER, method: "passkey" });
      expect(ok).toBe(false);
      expect(s.rpc).not.toHaveBeenCalled();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    }
  });

  it("still fails the login when the local sign-out itself throws", async () => {
    const s = svcWith({ data: null, error: { code: "XX000" } });
    const throwing = { auth: { signOut: jest.fn(async () => { throw new Error("cookies are read-only"); }) } };
    await expect(
      bindMintedSession({ svc: s.client, userClient: throwing, accessToken: token(), userId: USER, method: "totp" }),
    ).resolves.toBe(false);
  });
});

describe("mfaSessionBound / currentSessionBinding", () => {
  it.each([
    [{ data: true, error: null }, "bound"],
    [{ data: false, error: null }, "unbound"],
    [{ data: null, error: null }, "unknown"],
    [{ data: "yes", error: null }, "unknown"],
    [{ data: null, error: { code: "PGRST202" } }, "unknown"],
    [{ data: null, error: { code: "42883" } }, "unknown"],
    [{ data: null, error: { code: "57014", message: "statement timeout" } }, "unknown"],
  ] as const)("maps %j to %s", async (reply, verdict) => {
    const s = svcWith(reply as Reply);
    await expect(mfaSessionBound(s.client, SID)).resolves.toBe(verdict);
    expect(s.rpc).toHaveBeenCalledWith("mfa_session_bound", { p_session_id: SID });
  });

  it("stays silent for a not-yet-deployed RPC and warns for a real failure", async () => {
    await mfaSessionBound(svcWith({ data: null, error: { code: "PGRST202" } }).client, SID);
    expect(warn).not.toHaveBeenCalled();
    await mfaSessionBound(svcWith({ data: null, error: { code: "57014" } }).client, SID);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is unknown when the RPC throws", async () => {
    await expect(mfaSessionBound(svcWith(async () => { throw new Error("fetch failed"); }).client, SID)).resolves.toBe("unknown");
  });

  it("reads the session id from the request's own access token", async () => {
    const s = svcWith({ data: false, error: null });
    const userClient = { auth: { getSession: async () => ({ data: { session: { access_token: token() } } }) } };
    await expect(currentSessionBinding(userClient, s.client, USER)).resolves.toBe("unbound");
    expect(s.rpc).toHaveBeenCalledWith("mfa_session_bound", { p_session_id: SID });
  });

  it("does not ask the database when the token is unreadable, missing or not this user's", async () => {
    for (const session of [null, { access_token: "garbage" }, { access_token: token({ sub: OTHER }) }]) {
      const s = svcWith({ data: false, error: null });
      const userClient = { auth: { getSession: async () => ({ data: { session } }) } };
      await expect(currentSessionBinding(userClient, s.client, USER)).resolves.toBe("unknown");
      expect(s.rpc).not.toHaveBeenCalled();
    }
    const s = svcWith({ data: false, error: null });
    const throwing = { auth: { getSession: async () => { throw new Error("storage"); } } };
    await expect(currentSessionBinding(throwing, s.client, USER)).resolves.toBe("unknown");
  });
});
