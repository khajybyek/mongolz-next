/**
 * GDPR self-erase guards (2026-09-08 audit, 5.3).
 *
 * README, COMPLIANCE.md and the /users console all say the super admin is
 * DB-locked and cannot be removed from the app. The DB trigger that promises
 * this exempts `service_role` — the role every app write uses — so the
 * account could erase itself through this route. The refusal lives in the
 * route now, and must land before a one-time TOTP code (or the caller's
 * shared step-up budget) is spent on a request that can never succeed.
 *
 * The paths that must keep working are pinned too: an ordinary admin with a
 * colleague still holding the role, and a viewer, can both erase themselves.
 */
import { NextRequest } from "next/server";
import { T } from "@/lib/i18n/translations";

const USER = "44444444-4444-4444-8444-444444444444";

type Profile = {
  id: string;
  email: string;
  role: string;
  totp_enabled: boolean;
  totp_secret: string | null;
  is_super_admin: boolean;
};

const state = {
  profile: null as Profile | null,
  adminCount: 2,
  totpResult: "ok" as "ok" | "invalid" | "replayed",
  rateLimited: false,
};

const writes = {
  audits: [] as Array<Record<string, unknown>>,
  profileDeletes: [] as string[],
  authDeletes: [] as string[],
  signOuts: 0,
};

const verifyTOTP = jest.fn(async () => state.totpResult);
const checkRateLimit = jest.fn(async () =>
  state.rateLimited ? { ok: false, message: "slow down", resetSec: 30 } : { ok: true },
);

jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => ({
    user: { id: USER, email: state.profile?.email ?? "subject@example.test" },
    profile: { id: USER, role: state.profile?.role ?? "viewer" },
  })),
  isAuthErr: (r: object) => "error" in r,
}));
jest.mock("@/lib/totp", () => ({ verifyTOTPWithReplayCheck: (...a: unknown[]) => verifyTOTP(...(a as [])) }));
// Accounts without TOTP re-authenticate with the password (probe client).
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async ({ password }: { password: string }) =>
        password === "correct-password" ? { error: null } : { error: { message: "Invalid login credentials" } },
      signOut: async () => ({ error: null }),
    },
  }),
}));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])),
  REAUTH_LIMIT: { max: 5, windowSec: 60 },
}));
jest.mock("@/lib/supabase/server", () => {
  const service = () => ({
    from: (table: string) => ({
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => ({
        eq: (col: string, _value: string) => {
          const value = { data: state.profile, error: null, count: state.adminCount };
          if (col === "role" && opts?.head) {
            return Promise.resolve({ data: null, error: null, count: state.adminCount });
          }
          return { single: async () => value, maybeSingle: async () => value };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_log") writes.audits.push(row);
        return { error: null };
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          writes.profileDeletes.push(id);
          return { error: null };
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          writes.authDeletes.push(id);
          return { error: null };
        },
      },
    },
  });
  return {
    createServiceClient: service,
    createClient: async () => ({
      auth: {
        signOut: async () => {
          writes.signOuts += 1;
          return { error: null };
        },
      },
    }),
  };
});

import { POST } from "@/app/api/gdpr/delete/route";

function erase(body: Record<string, unknown> = { confirm: "DELETE MY ACCOUNT", password: "correct-password" }) {
  return POST(
    new NextRequest("https://app.test/api/gdpr/delete", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: USER,
    email: "subject@example.test",
    role: "admin",
    totp_enabled: false,
    totp_secret: null,
    is_super_admin: false,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.profile = profile();
  state.adminCount = 2;
  state.totpResult = "ok";
  state.rateLimited = false;
  writes.audits = [];
  writes.profileDeletes = [];
  writes.authDeletes = [];
  writes.signOuts = 0;
});

describe("super admin cannot erase itself", () => {
  it("refuses with a translated reason and deletes nothing", async () => {
    state.profile = profile({ is_super_admin: true });
    const res = await erase();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: T.gdpr_err_super_admin.mn,
      code: "SUPER_ADMIN_LOCKED",
    });
    expect(writes.profileDeletes).toHaveLength(0);
    expect(writes.authDeletes).toHaveLength(0);
    expect(writes.signOuts).toBe(0);
  });

  it("records the refusal in the ledger", async () => {
    state.profile = profile({ is_super_admin: true });
    await erase();
    expect(writes.audits).toEqual([
      expect.objectContaining({ action: "GDPR_ERASE_DENIED", user_id: USER }),
    ]);
    expect(writes.audits.some((a) => a.action === "GDPR_ERASE")).toBe(false);
  });

  it("does not burn a TOTP code or the step-up budget on a doomed request", async () => {
    state.profile = profile({ is_super_admin: true, totp_enabled: true, totp_secret: "SEED" });
    const res = await erase({ confirm: "DELETE MY ACCOUNT", totp_code: "123456" });
    expect(res.status).toBe(403);
    expect(verifyTOTP).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("refuses a super admin who is not an admin by role either", async () => {
    state.profile = profile({ role: "viewer", is_super_admin: true });
    expect((await erase()).status).toBe(403);
    expect(writes.authDeletes).toHaveLength(0);
  });
});

describe("the paths that must keep working", () => {
  it("erases an ordinary admin while another admin remains", async () => {
    const res = await erase();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(writes.profileDeletes).toEqual([USER]);
    expect(writes.authDeletes).toEqual([USER]);
    expect(writes.signOuts).toBe(1);
    expect(writes.audits).toEqual([expect.objectContaining({ action: "GDPR_ERASE" })]);
  });

  it("erases a viewer", async () => {
    state.profile = profile({ role: "viewer" });
    state.adminCount = 1;
    expect((await erase()).status).toBe(200);
    expect(writes.authDeletes).toEqual([USER]);
  });

  it("erases an admin who passes a fresh TOTP code", async () => {
    state.profile = profile({ totp_enabled: true, totp_secret: "SEED" });
    const res = await erase({ confirm: "DELETE MY ACCOUNT", totp_code: "123456" });
    expect(res.status).toBe(200);
    expect(verifyTOTP).toHaveBeenCalled();
    expect(writes.authDeletes).toEqual([USER]);
  });
});

describe("the guards that were already there stay", () => {
  it("keeps the last admin", async () => {
    state.adminCount = 1;
    const res = await erase();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: T.gdpr_err_last_admin.mn, code: "LAST_ADMIN" });
    expect(writes.profileDeletes).toHaveLength(0);
  });

  it("requires a TOTP code when TOTP is enabled", async () => {
    state.profile = profile({ totp_enabled: true, totp_secret: "SEED" });
    expect((await erase()).status).toBe(401);
    expect(writes.authDeletes).toHaveLength(0);
  });

  it("rejects a replayed TOTP code and logs the failure", async () => {
    state.profile = profile({ totp_enabled: true, totp_secret: "SEED" });
    state.totpResult = "replayed";
    const res = await erase({ confirm: "DELETE MY ACCOUNT", totp_code: "123456" });
    expect(res.status).toBe(401);
    expect(writes.audits).toEqual([expect.objectContaining({ action: "REAUTH_TOTP_FAILED" })]);
    expect(writes.authDeletes).toHaveLength(0);
  });

  it("requires the exact confirmation phrase", async () => {
    expect((await erase({ confirm: "delete my account" })).status).toBe(400);
    expect(writes.authDeletes).toHaveLength(0);
  });

  it("honours the throttle for a non-super account", async () => {
    state.rateLimited = true;
    expect((await erase()).status).toBe(429);
    expect(writes.authDeletes).toHaveLength(0);
  });
});

describe("accounts without TOTP re-authenticate with the password", () => {
  it("refuses without a password and deletes nothing", async () => {
    state.profile = profile({ role: "viewer" });
    const res = await erase({ confirm: "DELETE MY ACCOUNT" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "PASSWORD_REQUIRED" });
    expect(writes.authDeletes).toHaveLength(0);
  });

  it("refuses a wrong password, audits it, deletes nothing", async () => {
    state.profile = profile({ role: "auditor" });
    const res = await erase({ confirm: "DELETE MY ACCOUNT", password: "guess" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "PASSWORD_INVALID" });
    expect(writes.audits).toEqual([
      expect.objectContaining({ action: "REAUTH_PASSWORD_FAILED", detail: "gdpr erase" }),
    ]);
    expect(writes.profileDeletes).toHaveLength(0);
    expect(writes.authDeletes).toHaveLength(0);
  });

  it("does not ask a TOTP account for the password", async () => {
    state.profile = profile({ totp_enabled: true, totp_secret: "SEED" });
    const res = await erase({ confirm: "DELETE MY ACCOUNT", totp_code: "123456" });
    expect(res.status).toBe(200);
  });
});
