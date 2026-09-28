/**
 * claude-analysis is reachable straight from the internet with any valid user
 * JWT (verify_jwt only checks the signature). Its second-factor gate must be
 * the data tier's verdict — public.mfa_status() -> private.mfa_ok() — so an
 * e-mail-minted session (amr = otp, not bound, 20260928120000) cannot spend a
 * model call on the project's key or write AI_ANALYSIS rows. It used to be a
 * local amr = [password] mirror that such a session passed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Loaded at run time, not imported: .vercelignore keeps /supabase/ out of
// the Vercel upload, and `next build` type-checks __tests__ too, so a static
// import of the edge function's module fails the production build (TS2307).
type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
type RateVerdict = { limited: false } | { limited: true; retryAfterSec: number };
const FN_DIR = path.join(__dirname, "..", "supabase", "functions", "claude-analysis");
const gate = jest.requireActual<{
  secondFactorOk: (caller: RpcClient) => Promise<boolean>;
  aiRateLimit: (service: RpcClient, userId: string) => Promise<RateVerdict>;
  AI_RATE_LIMIT: { windowSec: number; max: number };
}>(path.join(FN_DIR, "gate.ts"));
const { secondFactorOk, aiRateLimit, AI_RATE_LIMIT } = gate;

function client(result: RpcResult | (() => never)) {
  const rpc = jest.fn(async (_fn: string, _args?: Record<string, unknown>) => {
    if (typeof result === "function") return result();
    return result;
  });
  return { rpc, client: { rpc } as RpcClient };
}

describe("secondFactorOk (public.mfa_status verdict)", () => {
  it("accepts only mfa_ok === true, asked with the caller's client", async () => {
    const { rpc, client: c } = client({
      data: { amr_present: true, methods: ["otp"], session_id_present: true, mfa_ok: true },
      error: null,
    });
    await expect(secondFactorOk(c)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("mfa_status");
  });

  it("refuses an unbound e-mail-minted session (amr = otp, mfa_ok = false)", async () => {
    const { client: c } = client({
      data: { amr_present: true, methods: ["otp"], session_id_present: true, mfa_ok: false },
      error: null,
    });
    await expect(secondFactorOk(c)).resolves.toBe(false);
  });

  it("refuses a password-only token", async () => {
    const { client: c } = client({ data: { methods: ["password"], mfa_ok: false }, error: null });
    await expect(secondFactorOk(c)).resolves.toBe(false);
  });

  it.each([
    ["an RPC error", { data: null, error: { code: "PGRST301", message: "JWT expired" } }],
    ["a missing function", { data: null, error: { code: "PGRST202", message: "Could not find the function" } }],
    ["an error next to a verdict", { data: { mfa_ok: true }, error: { code: "XX000", message: "internal" } }],
    ["no data", { data: null, error: null }],
    ["a string verdict", { data: { mfa_ok: "true" }, error: null }],
    ["a missing verdict", { data: { amr_present: false }, error: null }],
    ["an array", { data: [{ mfa_ok: true }], error: null }],
  ])("fails closed on %s", async (_label, result) => {
    const { client: c } = client(result as RpcResult);
    await expect(secondFactorOk(c)).resolves.toBe(false);
  });

  it("fails closed when the client throws", async () => {
    const { client: c } = client(() => {
      throw new Error("network");
    });
    await expect(secondFactorOk(c)).resolves.toBe(false);
  });
});

describe("aiRateLimit (per-admin hourly quota)", () => {
  const USER = "11111111-1111-4111-8111-111111111111";

  it("spends one unit of the user's bucket through public.rate_limit_hit", async () => {
    const { rpc, client: c } = client({
      data: { count: 1, limited: false, reset_sec: 3599, window_sec: 3600 },
      error: null,
    });
    await expect(aiRateLimit(c, USER)).resolves.toEqual({ limited: false });
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: `ai_analysis:${USER}`,
      p_window_sec: AI_RATE_LIMIT.windowSec,
      p_max: AI_RATE_LIMIT.max,
      p_cost: 1,
    });
    // The SQL guard refuses keys over 200 characters.
    expect(`ai_analysis:${USER}`.length).toBeLessThanOrEqual(200);
  });

  it("refuses over the limit with the bucket's reset time", async () => {
    const { client: c } = client({
      data: { count: AI_RATE_LIMIT.max + 1, limited: true, reset_sec: 1234.2, window_sec: 3600 },
      error: null,
    });
    await expect(aiRateLimit(c, USER)).resolves.toEqual({ limited: true, retryAfterSec: 1235 });
  });

  it("falls back to the window length when reset_sec is unusable", async () => {
    const { client: c } = client({ data: { limited: true, reset_sec: null }, error: null });
    await expect(aiRateLimit(c, USER)).resolves.toEqual({
      limited: true,
      retryAfterSec: AI_RATE_LIMIT.windowSec,
    });
  });

  it("allows when the counter is not deployed (deploy gap, not an attack)", async () => {
    for (const code of ["PGRST202", "PGRST203", "42883"]) {
      const { client: c } = client({ data: null, error: { code, message: "missing" } });
      await expect(aiRateLimit(c, USER)).resolves.toEqual({ limited: false });
    }
  });

  it("fails closed when the counter exists and errors, answers oddly or throws", async () => {
    const cases: Array<RpcResult | (() => never)> = [
      { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      { data: null, error: null },
      { data: { count: 3 }, error: null },
      () => {
        throw new Error("network");
      },
    ];
    for (const result of cases) {
      const { client: c } = client(result);
      await expect(aiRateLimit(c, USER)).resolves.toEqual({ limited: true, retryAfterSec: 60 });
    }
  });
});

describe("claude-analysis wiring", () => {
  const source = readFileSync(path.join(FN_DIR, "index.ts"), "utf8");
  const body = source.slice(source.indexOf("Deno.serve("));

  it("gates on the data tier's verdict, not a local amr mirror", () => {
    expect(source).toMatch(/import \{[^}]*\bsecondFactorOk\b[^}]*\} from "\.\/gate\.ts";/);
    expect(source).not.toMatch(/passwordOnlyToken|\.amr\b|claims\?\.amr/);
    expect(body).toMatch(/if \(!\(await secondFactorOk\(supabase\)\)\)/);
  });

  it("refuses before the quota, the audit row, the context read and the model call", () => {
    const at = (needle: string) => {
      const i = body.indexOf(needle);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    const gateAt = at("secondFactorOk(supabase)");
    const quotaAt = at("aiRateLimit(ledger, user.id)");
    const auditAt = at('action: "AI_ANALYSIS"');
    const readAt = at('svc.from("faces")');
    const modelAt = at("fetch(ANTHROPIC_API_URL");
    expect(gateAt).toBeLessThan(quotaAt);
    expect(quotaAt).toBeLessThan(auditAt);
    expect(auditAt).toBeLessThan(readAt);
    expect(readAt).toBeLessThan(modelAt);
  });

  it("asks public.mfa_status, which authenticated may execute and which reports mfa_ok", () => {
    const dir = path.join(__dirname, "..", "supabase", "migrations");
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .reverse()
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .find((sql) => /create\s+or\s+replace\s+function\s+public\.mfa_status\s*\(/i.test(sql));
    expect(latest).toBeDefined();
    const sql = latest as string;
    const fn = sql.slice(sql.search(/create\s+or\s+replace\s+function\s+public\.mfa_status\s*\(/i));
    expect(fn).toMatch(/'mfa_ok',\s*private\.mfa_ok\(\)/);
    expect(fn).toMatch(/grant\s+execute\s+on\s+function\s+public\.mfa_status\(\)\s+to\s+authenticated/i);
  });
});
