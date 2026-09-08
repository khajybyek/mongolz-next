/**
 * @jest-environment node
 *
 * Throttling (2026-09-08 audit, findings 5.9 + 5.10).
 *
 * The old counter read `audit_log`, decided, and wrote later — so parallel
 * attempts all read the same pre-attempt count and all passed, and a failing
 * count query read as "nobody has tried yet". These tests pin the two
 * properties that fix: the decision comes from an ATOMIC post-increment count,
 * and every way of not getting an answer is refused rather than allowed.
 *
 * `public.rate_limit_hit` / `rate_limit_release` are simulated here with the
 * same semantics the SQL has (single-statement insert-or-increment, window
 * roll-over, refund floored at zero) — see
 * supabase/migrations/20260908112000_atomic_rate_limits.sql.
 */
import { NextRequest } from "next/server";

type Bucket = { hits: number; startedAt: number; windowSec: number };

const state = {
  buckets: new Map<string, Bucket>(),
  audit: [] as Array<Record<string, unknown>>,
  /** Rows the legacy audit-log counter reports. `null` = that query fails. */
  legacyCount: 0 as number | null,
  /** Error the RPC returns (null = success). */
  rpcError: null as { code?: string; message?: string } | null,
  /** Make the RPC throw, the way a network failure does. */
  rpcThrows: false,
  rpcCalls: [] as string[],
  profile: null as Record<string, unknown> | null,
};

type Query = {
  eq: (...a: unknown[]) => Query;
  in: (...a: unknown[]) => Query;
  gte: (...a: unknown[]) => Query;
  like: (...a: unknown[]) => Query;
  single: () => Promise<{ data: unknown; error: unknown }>;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
};

function makeQuery(): Query {
  const q: Query = {
    eq: () => q,
    in: () => q,
    gte: () => q,
    like: () => q,
    single: async () => ({ data: state.profile, error: null }),
    maybeSingle: async () => ({ data: state.profile, error: null }),
    then: (resolve, reject) =>
      Promise.resolve(
        state.legacyCount === null
          ? { count: null, error: { message: "count failed" } }
          : { count: state.legacyCount, error: null },
      ).then(resolve, reject),
  };
  return q;
}

/** Mirrors the SQL: one atomic insert-or-increment returning the new count. */
function rateLimitHit(args: Record<string, unknown>) {
  const key = String(args.p_key);
  const windowSec = Number(args.p_window_sec);
  const max = Number(args.p_max);
  const cost = Number(args.p_cost ?? 1);
  const now = Date.now();
  const cur = state.buckets.get(key);
  const rolled = !cur || cur.startedAt + windowSec * 1000 <= now;
  const hits = rolled ? cost : cur.hits + cost;
  const startedAt = rolled ? now : cur.startedAt;
  state.buckets.set(key, { hits, startedAt, windowSec });
  return {
    count: hits,
    limited: hits > max,
    reset_sec: Math.max(1, Math.ceil((startedAt + windowSec * 1000 - now) / 1000)),
    window_sec: windowSec,
  };
}

function rateLimitRelease(args: Record<string, unknown>) {
  const key = String(args.p_key);
  const cur = state.buckets.get(key);
  if (cur) state.buckets.set(key, { ...cur, hits: Math.max(0, cur.hits - Number(args.p_cost ?? 1)) });
  return null;
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => makeQuery(),
      insert: async (row: Record<string, unknown>) => {
        state.audit.push(row);
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(fn);
      if (state.rpcThrows) throw new Error("connection reset");
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (fn === "rate_limit_hit") return { data: rateLimitHit(args), error: null };
      if (fn === "rate_limit_release") return { data: rateLimitRelease(args), error: null };
      return { data: null, error: null };
    },
  }),
}));

jest.mock("@/lib/totp", () => ({
  verifyTOTP: (_secret: string, code: string) => code === "123456",
  verifyTOTPWithReplayCheck: async (_userId: string, _secret: string, code: string) =>
    code === "123456" ? "ok" : code === "999999" ? "replayed" : "invalid",
}));

const USER = "11111111-2222-4333-8444-555555555555";

import {
  checkRateLimit,
  releaseRateLimit,
  checkTotpCode,
  totpCheckResponse,
  rateLimitResponse,
  checkLoginRateLimit,
  startLoginAttempt,
  REAUTH_LIMIT,
  TOTP_LOGIN_LIMIT,
} from "@/lib/rate-limit";

function reset() {
  state.buckets.clear();
  state.audit = [];
  state.legacyCount = 0;
  state.rpcError = null;
  state.rpcThrows = false;
  state.rpcCalls = [];
  state.profile = { totp_secret: "SEED", totp_enabled: true, totp_recovery_codes: [] };
  delete process.env.RATE_LIMIT_MODE;
}

beforeEach(reset);

// ── the atomic counter ────────────────────────────────────────────────
describe("checkRateLimit", () => {
  it("allows exactly `max` attempts, then refuses", async () => {
    const results = [];
    for (let i = 0; i < REAUTH_LIMIT.max + 2; i++) {
      results.push((await checkRateLimit(USER, REAUTH_LIMIT)).ok);
    }
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  it("does NOT let concurrent attempts all pass (the 5.10 hole)", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 25 }, () => checkRateLimit(USER, REAUTH_LIMIT)),
    );
    expect(outcomes.filter((r) => r.ok)).toHaveLength(REAUTH_LIMIT.max);
    // Every caller saw a distinct post-increment count — that is the property
    // the single SQL statement guarantees and the old read-then-write did not.
    const counts = outcomes.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("keeps separate users in separate buckets", async () => {
    for (let i = 0; i < REAUTH_LIMIT.max + 1; i++) await checkRateLimit(USER, REAUTH_LIMIT);
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(false);
    expect((await checkRateLimit("other-user", REAUTH_LIMIT)).ok).toBe(true);
  });

  it("fails CLOSED when the counter returns an error", async () => {
    state.rpcError = { code: "57014", message: "canceling statement due to statement timeout" };
    const res = await checkRateLimit(USER, REAUTH_LIMIT);
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it("fails CLOSED when the counter throws", async () => {
    state.rpcThrows = true;
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(false);
  });

  it("fails CLOSED even when the legacy audit count would say 'no attempts yet'", async () => {
    state.rpcError = { code: "57014", message: "statement timeout" };
    state.legacyCount = 0;
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(false);
  });

  it("falls back to the legacy counter when the function is not deployed yet", async () => {
    // Deploy gap: code is out, the migration is not applied. Locking every
    // operator out would be worse than the hole, so this one case fails open.
    state.rpcError = { code: "PGRST202", message: "Could not find the function public.rate_limit_hit" };
    state.legacyCount = 0;
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(true);

    state.legacyCount = REAUTH_LIMIT.max;
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(false);
  });

  it("treats a missing EXECUTE grant as 'not deployed', not as an outage", async () => {
    // A grant that did not land is a deploy accident, not an attack — locking
    // every operator out would be worse than throttling racily for a while.
    state.rpcError = { code: "42501", message: "permission denied for function rate_limit_hit" };
    state.legacyCount = 0;
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(true);
    state.legacyCount = REAUTH_LIMIT.max;
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(false);
  });

  it("refunds a spent unit on release()", async () => {
    for (let i = 0; i < REAUTH_LIMIT.max; i++) await checkRateLimit(USER, REAUTH_LIMIT);
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(false);
    await releaseRateLimit(USER, REAUTH_LIMIT);
    await releaseRateLimit(USER, REAUTH_LIMIT);
    expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(true);
  });

  it("RATE_LIMIT_MODE=off is a kill switch (and touches no counter)", async () => {
    process.env.RATE_LIMIT_MODE = "off";
    for (let i = 0; i < 50; i++) expect((await checkRateLimit(USER, REAUTH_LIMIT)).ok).toBe(true);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("RATE_LIMIT_MODE=legacy reproduces the old (racy) behaviour on purpose", async () => {
    process.env.RATE_LIMIT_MODE = "legacy";
    state.legacyCount = 0;
    const outcomes = await Promise.all(
      Array.from({ length: 25 }, () => checkRateLimit(USER, REAUTH_LIMIT)),
    );
    // Documented break-glass: the audit-log counter cannot see the attempts
    // running beside it. This is why it is no longer the default.
    expect(outcomes.every((r) => r.ok)).toBe(true);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

// ── the shared TOTP check ─────────────────────────────────────────────
describe("checkTotpCode", () => {
  const base = {
    userId: USER,
    userEmail: "admin@example.test",
    secret: "SEED",
    limit: REAUTH_LIMIT,
    failAction: "REAUTH_TOTP_FAILED",
    replayAction: "REAUTH_TOTP_REPLAY_BLOCKED",
  };

  it("writes a counted audit row for every wrong code", async () => {
    await checkTotpCode({ ...base, code: "000000" });
    await checkTotpCode({ ...base, code: "111111" });
    expect(state.audit.filter((r) => r.action === "REAUTH_TOTP_FAILED")).toHaveLength(2);
    expect(state.buckets.get(`reauth:${USER}`)?.hits).toBe(2);
  });

  it("labels a replayed code separately", async () => {
    const res = await checkTotpCode({ ...base, code: "999999" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("replayed");
    expect(state.audit.some((r) => r.action === "REAUTH_TOTP_REPLAY_BLOCKED")).toBe(true);
  });

  it("does NOT consume the budget when the code is correct", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await checkTotpCode({ ...base, code: "123456" });
      expect(res.ok).toBe(true);
    }
    expect(state.buckets.get(`reauth:${USER}`)?.hits).toBe(0);
    expect(state.audit).toHaveLength(0);
  });

  it("throttles BEFORE verifying, and answers 429 with Retry-After", async () => {
    for (let i = 0; i < REAUTH_LIMIT.max; i++) await checkTotpCode({ ...base, code: "000000" });

    // Even the CORRECT code is refused once the budget is gone — proof the
    // throttle runs before the verifier, so it cannot be used as an oracle.
    const res = await checkTotpCode({ ...base, code: "123456" });
    if (res.ok || res.reason !== "rate_limited") throw new Error("expected a 429 refusal");
    expect(res.status).toBe(429);
    expect(res.retryAfterSec).toBeGreaterThan(0);

    const http = totpCheckResponse(res);
    expect(http.status).toBe(429);
    expect(http.headers.get("retry-after")).toBe(String(res.retryAfterSec));
    const body = (await http.json()) as { code?: string; retry_after_sec?: number };
    expect(body.code).toBe("rate_limited");
    expect(body.retry_after_sec).toBe(res.retryAfterSec);
  });

  it("records at most one TOTP_BLOCKED row per window", async () => {
    for (let i = 0; i < REAUTH_LIMIT.max + 10; i++) await checkTotpCode({ ...base, code: "000000" });
    expect(state.audit.filter((r) => r.action === "TOTP_BLOCKED")).toHaveLength(1);
  });

  it("refuses when the counter is broken, without asking the verifier", async () => {
    state.rpcError = { code: "57014", message: "statement timeout" };
    const res = await checkTotpCode({ ...base, code: "123456" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(429);
  });

  it("rateLimitResponse() has the same 429 shape", async () => {
    for (let i = 0; i < REAUTH_LIMIT.max + 1; i++) await checkRateLimit(USER, REAUTH_LIMIT);
    const rl = await checkRateLimit(USER, REAUTH_LIMIT);
    const res = rateLimitResponse(rl);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

// ── login attempts ────────────────────────────────────────────────────
describe("login throttling", () => {
  const opts = { ip: "203.0.113.7", email: "operator@example.test" };

  it("locks the e-mail after `maxPerEmail` unreleased attempts", async () => {
    for (let i = 0; i < 5; i++) expect((await startLoginAttempt(opts)).ok).toBe(true);
    const locked = await startLoginAttempt(opts);
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe("email_locked");
    expect(locked.retryAfterSec).toBeGreaterThan(0);
  });

  it("does not lock an operator who keeps signing in successfully", async () => {
    for (let i = 0; i < 50; i++) {
      const attempt = await startLoginAttempt(opts);
      expect(attempt.ok).toBe(true);
      await attempt.release();
    }
  });

  it("cannot be walked through by concurrent attempts", async () => {
    const attempts = await Promise.all(Array.from({ length: 20 }, () => startLoginAttempt(opts)));
    expect(attempts.filter((a) => a.ok)).toHaveLength(5);
  });

  it("fails CLOSED when the counter errors", async () => {
    state.rpcError = { code: "57014", message: "statement timeout" };
    const attempt = await startLoginAttempt(opts);
    expect(attempt.ok).toBe(false);
    expect(attempt.reason).toBe("counter_unavailable");
  });

  it("checkLoginRateLimit() inspects without spending (passkey-safe)", async () => {
    for (let i = 0; i < 20; i++) expect((await checkLoginRateLimit(opts)).ok).toBe(true);
    expect(state.buckets.get(`login_email:${opts.email}`)?.hits).toBe(0);
  });

  it("scope 'passkey' never touches the e-mail bucket", async () => {
    for (let i = 0; i < 8; i++) await startLoginAttempt({ ...opts, scope: "passkey" });
    expect(state.buckets.has(`login_email:${opts.email}`)).toBe(false);
    expect(state.buckets.get(`login_ip:${opts.ip}`)?.hits).toBe(8);
  });

  it("an IP-level lock does not also burn the e-mail budget", async () => {
    for (let i = 0; i < 10; i++) await startLoginAttempt({ ...opts, email: `u${i}@example.test` });
    const locked = await startLoginAttempt(opts);
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe("ip_locked");
    expect(state.buckets.get(`login_email:${opts.email}`)?.hits).toBe(0);
  });

  it("keeps the historical audit-log lock as a secondary signal", async () => {
    state.legacyCount = 5; // five failures already on record for this e-mail
    const attempt = await startLoginAttempt(opts);
    expect(attempt.ok).toBe(false);
    expect(attempt.reason).toBe("email_locked");
  });

  it("ignores the secondary signal when its query fails", async () => {
    state.legacyCount = null; // the audit count errors …
    const attempt = await startLoginAttempt(opts);
    expect(attempt.ok).toBe(true); // … the atomic counter still decides
  });

  it("per-user TOTP budget is separate from the login buckets", async () => {
    for (let i = 0; i < TOTP_LOGIN_LIMIT.max; i++) await checkRateLimit(USER, TOTP_LOGIN_LIMIT);
    expect((await checkRateLimit(USER, TOTP_LOGIN_LIMIT)).ok).toBe(false);
    expect((await startLoginAttempt(opts)).ok).toBe(true);
  });
});

// ── HTTP level: the recovery-code oracle from finding 5.9 ─────────────
jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => ({
    user: { id: "11111111-2222-4333-8444-555555555555", email: "admin@example.test" },
    profile: { role: "admin" },
  })),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

function callRegenerate(code: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { POST } = require("@/app/api/auth/totp/recovery/regenerate/route") as {
    POST: (req: NextRequest) => Promise<Response>;
  };
  return POST(
    new NextRequest("http://localhost/api/auth/totp/recovery/regenerate", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  );
}

describe("POST /api/auth/totp/recovery/regenerate", () => {
  it("throttles wrong codes and answers 429 with Retry-After", async () => {
    for (let i = 0; i < REAUTH_LIMIT.max; i++) {
      expect((await callRegenerate("000000")).status).toBe(401);
    }
    const res = await callRegenerate("000000");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as { code?: string; recovery_codes?: unknown };
    expect(body.code).toBe("rate_limited");
    expect(body.recovery_codes).toBeUndefined();
  });

  it("audits every wrong code (the oracle used to be silent)", async () => {
    await callRegenerate("000000");
    expect(state.audit.filter((r) => r.action === "TOTP_REGEN_FAILED")).toHaveLength(1);
  });

  it("issues codes for a correct TOTP and spends nothing", async () => {
    const res = await callRegenerate("123456");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recovery_codes?: string[] };
    expect(body.recovery_codes).toHaveLength(10);
    expect(state.buckets.get(`reauth:${USER}`)?.hits).toBe(0);
  });

  it("refuses when TOTP is not enabled", async () => {
    state.profile = { totp_secret: null, totp_enabled: false };
    expect((await callRegenerate("123456")).status).toBe(400);
  });
});
