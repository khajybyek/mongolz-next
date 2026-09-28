/**
 * POST /api/auth/passkey/login/finish — after the WebAuthn assertion verifies
 * the route mints a session (generateLink + verifyOtp) and must bind it for
 * the data tier (migration 20260928120000) before reporting success.
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/passkey/login/finish/route";
import { finishAuthentication } from "@/lib/auth/webauthn";
import { bindSessionPin } from "@/lib/auth/session-pin";

jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", host: "aicctv.dev" }),
}));
jest.mock("@/lib/auth/webauthn", () => ({ finishAuthentication: jest.fn() }));
jest.mock("@/lib/auth/session-pin", () => ({ bindSessionPin: jest.fn() }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.test" };
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
const accessToken = `${b64url({ alg: "HS256" })}.${b64url({ sub: USER.id, session_id: SESSION_ID, amr: [{ method: "otp" }] })}.c2ln`;

const signOut = jest.fn();
const verifyOtp = jest.fn();
const generateLink = jest.fn();
const rpc = jest.fn();
const auditInsert = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp, signOut } }),
  createServiceClient: () => ({
    rpc,
    auth: { admin: { generateLink } },
    from: (table: string) => {
      if (table === "audit_log") return { insert: auditInsert };
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: USER, error: null }) }) }),
      };
    },
  }),
}));

function request(): NextRequest {
  return new NextRequest("https://aicctv.dev/api/auth/passkey/login/finish", {
    method: "POST",
    body: JSON.stringify({ user_handle: USER.id, response: { id: "cred", response: {} } }),
    headers: { "content-type": "application/json" },
  });
}

function auditActions(): string[] {
  return auditInsert.mock.calls.map((c) => (c[0] as { action: string }).action);
}

let consoleWarn: jest.SpyInstance;
let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  auditInsert.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
  jest.mocked(finishAuthentication).mockResolvedValue(undefined as never);
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: "tok" } }, error: null });
  verifyOtp.mockResolvedValue({ data: { session: { access_token: accessToken } }, error: null });
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  consoleWarn.mockRestore();
  consoleError.mockRestore();
});

describe("passkey login finish — session binding", () => {
  it("binds the minted session with method passkey, then audits and pins", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("bind_mfa_session", {
      p_session_id: SESSION_ID,
      p_user_id: USER.id,
      p_method: "passkey",
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["PASSKEY_LOGIN"]);
    expect(bindSessionPin).toHaveBeenCalledWith(USER.id);
  });

  it("finishes the login unbound while the bind RPC is not deployed yet", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(signOut).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["PASSKEY_LOGIN"]);
  });

  it("ends the new session locally and fails like a failed mint when the bind fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "bind_mfa_session: session not found" } });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "could not mint session" });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(auditActions()).toEqual(["MFA_SESSION_BIND_FAILED"]);
    expect(bindSessionPin).not.toHaveBeenCalled();
  });

  it("never mints or binds when the assertion fails", async () => {
    jest.mocked(finishAuthentication).mockRejectedValue(new Error("signature mismatch"));
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(generateLink).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["PASSKEY_LOGIN_FAILED"]);
  });
});
