/**
 * Step-up minting routes (POST /api/auth/reauth/totp, POST /api/auth/reauth):
 *  - the TOTP route mints a factor=totp cookie;
 *  - a refused code answers with the throttle's response and mints nothing;
 *  - an unsignable cookie (secret missing) answers 503 server_config;
 *  - the password route never replaces a live TOTP step-up with a weaker
 *    factor=password cookie (reveal-modal always POSTs it, which used to make
 *    the next approval / user / retention action ask for TOTP again).
 */
import { NextRequest, NextResponse } from "next/server";
import { buildReauthCookieValue, verifyReauthCookie } from "@/lib/auth/step-up";

const USER = { id: "a1a1a1a1-0000-4000-8000-000000000001", email: "admin@x.test" };
const mockJar = new Map<string, string>();
const mockCheckTotp = jest.fn();
const mockSignIn = jest.fn();

jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (mockJar.has(n) ? { name: n, value: mockJar.get(n)! } : undefined) }),
}));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: async () => ({ user: USER, profile: { role: "admin", totp_enabled: true } }),
  isAuthErr: () => false,
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: { totp_enabled: true, totp_secret: "S" } }) }) }),
    }),
  }),
}));
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: mockSignIn, signOut: async () => ({}) } }),
}));
jest.mock("@/lib/rate-limit", () => ({
  REAUTH_LIMIT: { action: "REAUTH", windowSec: 60, max: 5 },
  checkRateLimit: async () => ({ ok: true, count: 1, resetSec: 60 }),
  releaseRateLimit: async () => undefined,
  rateLimitResponse: () => NextResponse.json({ error: "rate" }, { status: 429 }),
  checkTotpCode: (...a: unknown[]) => mockCheckTotp(...a),
  totpCheckResponse: () => NextResponse.json({ error: "Invalid code" }, { status: 401 }),
}));

import { POST as totpStepUp } from "@/app/api/auth/reauth/totp/route";
import { POST as passwordStepUp } from "@/app/api/auth/reauth/route";

function req(url: string, body: unknown) {
  return new NextRequest(`https://app.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setCookieValue(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  const m = raw ? /mongolz-reauth=([^;]+)/.exec(raw) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

const realSecret = process.env.REAUTH_COOKIE_SECRET;
beforeEach(() => {
  process.env.REAUTH_COOKIE_SECRET = "test-reauth-secret-0123456789"; // pragma: allowlist secret
  mockJar.clear();
  mockCheckTotp.mockReset();
  mockSignIn.mockReset();
});
afterAll(() => {
  if (realSecret === undefined) delete process.env.REAUTH_COOKIE_SECRET;
  else process.env.REAUTH_COOKIE_SECRET = realSecret;
});

describe("POST /api/auth/reauth/totp", () => {
  it("mints a factor=totp cookie", async () => {
    mockCheckTotp.mockResolvedValue({ ok: true });
    const res = await totpStepUp(req("/api/auth/reauth/totp", { code: "123456" }));
    expect(res.status).toBe(200);
    const value = setCookieValue(res);
    expect(verifyReauthCookie(value ?? undefined, USER.id)?.factor).toBe("totp");
  });

  it("a refused code mints nothing", async () => {
    mockCheckTotp.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await totpStepUp(req("/api/auth/reauth/totp", { code: "000000" }));
    expect(res.status).toBe(401);
    expect(setCookieValue(res)).toBeNull();
  });

  it("answers 503 server_config when the cookie cannot be signed", async () => {
    mockCheckTotp.mockResolvedValue({ ok: true });
    delete process.env.REAUTH_COOKIE_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      const res = await totpStepUp(req("/api/auth/reauth/totp", { code: "123456" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "server_config" });
    } finally {
      Object.assign(process.env, { NODE_ENV: prevNodeEnv });
    }
  });
});

describe("POST /api/auth/reauth (password)", () => {
  it("never replaces a live TOTP step-up", async () => {
    const totp = buildReauthCookieValue(USER.id, new Date(Date.now() + 10 * 60_000), "totp");
    mockJar.set("mongolz-reauth", totp);
    mockSignIn.mockResolvedValue({ error: null });
    const res = await passwordStepUp(req("/api/auth/reauth", { password: "correct" })); // pragma: allowlist secret
    expect(res.status).toBe(200);
    expect((await res.json()).factor).toBe("totp");
    expect(setCookieValue(res)).toBeNull();
  });

  it("mints a password cookie when no TOTP step-up is live", async () => {
    mockSignIn.mockResolvedValue({ error: null });
    const res = await passwordStepUp(req("/api/auth/reauth", { password: "correct" })); // pragma: allowlist secret
    expect(verifyReauthCookie(setCookieValue(res) ?? undefined, USER.id)?.factor).toBe("password");
  });

  it("a wrong password mints nothing", async () => {
    mockSignIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const res = await passwordStepUp(req("/api/auth/reauth", { password: "wrong" })); // pragma: allowlist secret
    expect(res.status).toBe(401);
    expect(setCookieValue(res)).toBeNull();
  });
});
