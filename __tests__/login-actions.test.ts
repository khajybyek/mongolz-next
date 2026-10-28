/**
 * Login server actions — password step, TOTP / recovery-code step, lockout
 * charge/refund and session-scope behaviour. Every dependency with side
 * effects is mocked; redirect() throws a tagged error so each test can assert
 * where the flow ended.
 */
import { signInAction, verifyTotpAction } from "@/app/login/actions";
import {
  startLoginAttempt,
  checkRateLimit,
  releaseRateLimit,
  checkTotpCode,
} from "@/lib/rate-limit";
import { setPreTotpCookie, readPreTotpCookie, clearPreTotpCookie } from "@/lib/auth/pre-totp";
import { bindSessionPin } from "@/lib/auth/session-pin";
import { hashCode } from "@/lib/totp-recovery";

jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", host: "aicctv.dev", "user-agent": "jest" }),
}));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({
  startLoginAttempt: jest.fn(),
  checkRateLimit: jest.fn(),
  releaseRateLimit: jest.fn(),
  checkTotpCode: jest.fn(),
  TOTP_LOGIN_LIMIT: { action: "TOTP_LOGIN_FAILED", max: 5, windowSec: 900 },
}));
jest.mock("@/lib/auth/pre-totp", () => ({
  setPreTotpCookie: jest.fn(),
  readPreTotpCookie: jest.fn(),
  clearPreTotpCookie: jest.fn(),
}));
jest.mock("@/lib/auth/session-pin", () => ({ bindSessionPin: jest.fn() }));

// ─── Supabase fakes ───
const signInWithPassword = jest.fn();
const signOut = jest.fn();
const verifyOtp = jest.fn();
const generateLink = jest.fn();
const rpc = jest.fn();
const auditInsert = jest.fn();
let profileRow: Record<string, unknown> | null = null;

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, signOut, verifyOtp } }),
  createServiceClient: () => ({
    rpc,
    auth: { admin: { generateLink } },
    from: (table: string) => {
      if (table === "audit_log") return { insert: auditInsert };
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: profileRow, error: null }) }),
        }),
      };
    },
  }),
}));

const release = jest.fn();

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("redirect:")) return msg.slice("redirect:".length);
    throw err;
  }
  throw new Error("action did not redirect");
}

function auditActions(): string[] {
  return auditInsert.mock.calls.map((c) => (c[0] as { action: string }).action);
}

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "op@example.test" };
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** The access token GoTrue returns from verifyOtp (signature irrelevant here). */
function accessToken(claims: Record<string, unknown> = {}): string {
  const payload = { sub: USER.id, role: "authenticated", session_id: SESSION_ID, amr: [{ method: "otp" }], ...claims };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2ln`;
}

function mintedSession(claims: Record<string, unknown> = {}) {
  return { data: { session: { access_token: accessToken(claims) } }, error: null };
}

/** rpc() replies by function name; bind_mfa_session succeeds unless a test says otherwise. */
let rpcReplies: Record<string, { data: unknown; error: { code?: string; message?: string } | null }> = {};

function bindCalls() {
  return rpc.mock.calls.filter((c) => c[0] === "bind_mfa_session");
}

beforeEach(() => {
  jest.clearAllMocks();
  profileRow = null;
  auditInsert.mockResolvedValue({ error: null });
  jest.mocked(startLoginAttempt).mockResolvedValue({ ok: true, release });
  signOut.mockResolvedValue({ error: null });
});

describe("signInAction (password step)", () => {
  it("unknown username fails exactly like a wrong password, with no attempt spent", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const to = await redirectOf(signInAction(form({ email: "nobody", password: "x" })));
    expect(to).toBe("/login?error=invalid_credentials");
    expect(rpc).toHaveBeenCalledWith("email_for_username", { p_username: "nobody" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("wrong password keeps the charged attempt and records LOGIN_FAILED", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid login credentials" } });
    const to = await redirectOf(signInAction(form({ email: USER.email, password: "bad" }))); // pragma: allowlist secret
    expect(to).toBe("/login?error=invalid_credentials");
    expect(startLoginAttempt).toHaveBeenCalledWith({ ip: "203.0.113.7", email: USER.email });
    expect(release).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["LOGIN_FAILED"]);
  });

  it("a locked account is refused before the password is tried", async () => {
    jest.mocked(startLoginAttempt).mockResolvedValue({ ok: false, reason: "email_locked", message: "later", release });
    const to = await redirectOf(signInAction(form({ email: USER.email, password: "pw" }))); // pragma: allowlist secret
    expect(to).toBe("/login?error=too_many_attempts");
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["LOGIN_BLOCKED"]);
  });

  it("success without TOTP refunds the attempt, pins the session and goes to a safe next", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: USER }, error: null });
    profileRow = { id: USER.id, role: "viewer", totp_enabled: false, totp_secret: null };
    const to = await redirectOf(signInAction(form({ email: USER.email, password: "pw", next: "/cameras" }))); // pragma: allowlist secret
    expect(to).toBe("/cameras");
    expect(release).toHaveBeenCalledTimes(1);
    expect(bindSessionPin).toHaveBeenCalledWith(USER.id);
    expect(signOut).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["LOGIN"]);
  });

  it("never redirects off-origin even when next collapses to //host", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: USER }, error: null });
    profileRow = { id: USER.id, role: "viewer", totp_enabled: false, totp_secret: null };
    for (const next of ["/.//evil.example", "/.%2F%2Fevil.example", "/a/..//evil.example"]) {
      const to = await redirectOf(signInAction(form({ email: USER.email, password: "pw", next }))); // pragma: allowlist secret
      expect(to).toBe("/dashboard");
    }
  });

  it("TOTP user: signs out LOCALLY, sets the pre-TOTP cookie, goes to the TOTP step", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: USER }, error: null });
    profileRow = { id: USER.id, role: "admin", totp_enabled: true, totp_secret: "S" };
    const to = await redirectOf(signInAction(form({ email: USER.email, password: "pw", next: "/alerts" }))); // pragma: allowlist secret
    expect(to).toBe("/login?step=totp&next=%2Falerts");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(setPreTotpCookie).toHaveBeenCalledWith(USER.id);
    expect(release).toHaveBeenCalledTimes(1);
    expect(bindSessionPin).not.toHaveBeenCalled();
  });

  it("TOTP user with an unsigned pre-TOTP cookie → server_config, never the global error page", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: USER }, error: null });
    profileRow = { id: USER.id, role: "admin", totp_enabled: true, totp_secret: "S" };
    jest.mocked(setPreTotpCookie).mockRejectedValue(new Error("REAUTH_COOKIE_SECRET missing"));
    const to = await redirectOf(signInAction(form({ email: USER.email, password: "pw" }))); // pragma: allowlist secret
    expect(to).toBe("/login?error=server_config");
    expect(auditActions()).toEqual(["LOGIN_CONFIG_ERROR"]);
  });
});

describe("verifyTotpAction (second factor)", () => {
  const totpProfile = () => ({
    id: USER.id,
    email: USER.email,
    totp_enabled: true,
    totp_secret: "SECRET", // pragma: allowlist secret
    totp_recovery_codes: ["h1", "h2"],
  });

  beforeEach(() => {
    profileRow = totpProfile();
    jest.mocked(readPreTotpCookie).mockResolvedValue({ ok: true, userId: USER.id });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "tok" } }, error: null });
    verifyOtp.mockResolvedValue(mintedSession());
    rpcReplies = { bind_mfa_session: { data: null, error: null } };
    rpc.mockImplementation(async (fn: string) => rpcReplies[fn] ?? { data: null, error: null });
  });

  it("malformed code bounces back to the TOTP step without spending anything", async () => {
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "12ab", next: "/alerts" })));
    expect(to).toBe("/login?step=totp&error=code_format&next=%2Falerts");
    expect(startLoginAttempt).not.toHaveBeenCalled();
  });

  it("bad TOTP code keeps the login charge", async () => {
    jest.mocked(checkTotpCode).mockResolvedValue({ ok: false, reason: "invalid" } as never);
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456" })));
    expect(to).toBe("/login?step=totp&error=code_invalid&next=%2Fdashboard");
    expect(release).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(clearPreTotpCookie).not.toHaveBeenCalled();
  });

  it("valid TOTP refunds, mints a session via magic-link exchange (never a password grant)", async () => {
    jest.mocked(checkTotpCode).mockResolvedValue({ ok: true } as never);
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456", next: "/grid" })));
    expect(to).toBe("/grid");
    expect(release).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: USER.email });
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "tok" });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(clearPreTotpCookie).toHaveBeenCalled();
    expect(bindSessionPin).toHaveBeenCalledWith(USER.id);
    expect(auditActions()).toEqual(["LOGIN"]);
  });

  it("binds the freshly minted session to the TOTP factor for the data tier", async () => {
    jest.mocked(checkTotpCode).mockResolvedValue({ ok: true } as never);
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456", next: "/grid" })));
    expect(to).toBe("/grid");
    expect(bindCalls()).toEqual([
      ["bind_mfa_session", { p_session_id: SESSION_ID, p_user_id: USER.id, p_method: "totp" }],
    ]);
    // Bound after the mint, before the login is recorded.
    const verifyOrder = verifyOtp.mock.invocationCallOrder[0]!;
    const bindOrder = rpc.mock.invocationCallOrder[rpc.mock.calls.findIndex((c) => c[0] === "bind_mfa_session")]!;
    expect(bindOrder).toBeGreaterThan(verifyOrder);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("valid recovery code is consumed atomically and refunds both budgets", async () => {
    jest.mocked(checkRateLimit).mockResolvedValue({ ok: true } as never);
    rpcReplies.consume_recovery_code = { data: true, error: null };
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "abcde-fghjk" })));
    expect(to).toBe("/dashboard");
    expect(rpc).toHaveBeenCalledWith("consume_recovery_code", {
      p_user_id: USER.id,
      p_code_hash: hashCode("ABCDEFGHJK"),
    });
    expect(releaseRateLimit).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(checkTotpCode).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["TOTP_RECOVERY_USED", "LOGIN"]);
    expect(bindCalls()).toEqual([
      ["bind_mfa_session", { p_session_id: SESSION_ID, p_user_id: USER.id, p_method: "recovery_code" }],
    ]);
  });

  describe("session binding outcomes", () => {
    let consoleWarn: jest.SpyInstance;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      jest.mocked(checkTotpCode).mockResolvedValue({ ok: true } as never);
      consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
      consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    });

    it.each(["PGRST202", "42883"])(
      "bind RPC not deployed yet (%s): the login finishes unbound (web ships before the migration)",
      async (code) => {
        rpcReplies.bind_mfa_session = { data: null, error: { code, message: "Could not find the function" } };
        const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456", next: "/alerts" })));
        expect(to).toBe("/alerts");
        expect(signOut).not.toHaveBeenCalled();
        expect(bindSessionPin).toHaveBeenCalledWith(USER.id);
        expect(auditActions()).toEqual(["LOGIN"]);
      },
    );

    it("any other bind failure ends the new session locally and fails with signin_failed", async () => {
      rpcReplies.bind_mfa_session = {
        data: null,
        error: { code: "22023", message: "bind_mfa_session: session belongs to another user" },
      };
      const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456", next: "/alerts" })));
      expect(to).toBe("/login?error=signin_failed");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(signOut).not.toHaveBeenCalledWith({ scope: "global" });
      expect(clearPreTotpCookie).toHaveBeenCalled();
      expect(bindSessionPin).not.toHaveBeenCalled();
      expect(auditActions()).toEqual(["MFA_SESSION_BIND_FAILED"]);
    });

    it("a recovery-code login whose bind fails also ends in signin_failed (the code stays spent)", async () => {
      jest.mocked(checkRateLimit).mockResolvedValue({ ok: true } as never);
      rpcReplies.consume_recovery_code = { data: true, error: null };
      rpcReplies.bind_mfa_session = { data: null, error: { code: "XX000", message: "boom" } };
      const to = await redirectOf(verifyTotpAction(form({ totp_code: "ABCDEFGHJK" })));
      expect(to).toBe("/login?error=signin_failed");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(auditActions()).toEqual(["TOTP_RECOVERY_USED", "MFA_SESSION_BIND_FAILED"]);
    });

    it("a minted token without a session id is never left unbound", async () => {
      verifyOtp.mockResolvedValue(mintedSession({ session_id: undefined }));
      const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456" })));
      expect(to).toBe("/login?error=signin_failed");
      expect(bindCalls()).toEqual([]);
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("a minted token for another user is never bound", async () => {
      verifyOtp.mockResolvedValue(mintedSession({ sub: "22222222-2222-4222-8222-222222222222" }));
      const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456" })));
      expect(to).toBe("/login?error=signin_failed");
      expect(bindCalls()).toEqual([]);
    });
  });

  it("unknown recovery code keeps both charges", async () => {
    jest.mocked(checkRateLimit).mockResolvedValue({ ok: true } as never);
    rpc.mockResolvedValue({ data: false, error: null });
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "ABCDEFGHJK" })));
    expect(to).toBe("/login?step=totp&error=code_invalid&next=%2Fdashboard");
    expect(releaseRateLimit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["TOTP_RECOVERY_FAILED"]);
  });

  it("login lockout at the TOTP step burns the pre-TOTP cookie", async () => {
    jest.mocked(startLoginAttempt).mockResolvedValue({ ok: false, reason: "ip_locked", release });
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456" })));
    expect(to).toBe("/login?error=too_many_attempts");
    expect(clearPreTotpCookie).toHaveBeenCalled();
    expect(checkTotpCode).not.toHaveBeenCalled();
  });

  it("per-user TOTP lockout also burns the pre-TOTP cookie", async () => {
    jest.mocked(checkTotpCode).mockResolvedValue({ ok: false, reason: "rate_limited" } as never);
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456" })));
    expect(to).toBe("/login?error=too_many_attempts");
    expect(clearPreTotpCookie).toHaveBeenCalled();
    expect(auditActions()).toEqual(["LOGIN_BLOCKED"]);
  });

  it("expired pre-TOTP cookie → code_expired", async () => {
    jest.mocked(readPreTotpCookie).mockResolvedValue({ ok: false, reason: "expired" } as never);
    const to = await redirectOf(verifyTotpAction(form({ totp_code: "123456" })));
    expect(to).toBe("/login?error=code_expired");
    expect(clearPreTotpCookie).toHaveBeenCalled();
  });
});
