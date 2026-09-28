/**
 * Second-factor and usage gates for the claude-analysis edge function. Pure
 * (no Deno or network APIs beyond the client handed in) so Jest can load it:
 * __tests__/claude-analysis-gate.test.ts.
 *
 * The function is reachable straight from the internet with any valid user
 * JWT, bypassing the Next proxy (requireAdminApi), so it must apply the data
 * tier's own verdict rather than a copy of it.
 */

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };

/** The part of a supabase-js client these gates use. */
export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/**
 * Would the data tier accept the caller's token? Asks public.mfa_status()
 * (granted to authenticated since 20260908110000) with the CALLER's client,
 * so the answer is private.mfa_ok() itself: the amr = [password] refusal, the
 * session binding of 20260928120000 (an e-mail-minted session from
 * /auth/v1/otp or /auth/v1/recover has amr = otp but no binding row), both
 * kill switches and any later rule. A local amr mirror used to live here and
 * let unbound mailbox sessions through.
 *
 * Fails CLOSED: an RPC error, a throw or anything but `mfa_ok === true`
 * refuses. The admin's own session gets `true` from the same call.
 */
export async function secondFactorOk(caller: RpcClient): Promise<boolean> {
  try {
    const { data, error } = await caller.rpc("mfa_status");
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return false;
    return (data as { mfa_ok?: unknown }).mfa_ok === true;
  } catch {
    return false;
  }
}

/**
 * Model calls per admin per hour. A usage quota on the project's Anthropic
 * key (every request can carry 20 x 4000 characters of history), not a
 * brute-force lock: successes are never refunded. Same counter as the web's
 * REVEAL_LIMIT (public.rate_limit_hit, service role only).
 */
export const AI_RATE_LIMIT = { windowSec: 3600, max: 60 } as const;

export type RateVerdict =
  | { limited: false }
  | { limited: true; retryAfterSec: number };

/**
 * "The counter is not deployed" — PostgREST cannot see the function or
 * Postgres says it does not exist. Not attacker-inducible; degrades to no
 * quota (the second-factor gate still stands), like lib/rate-limit.ts.
 */
function isMissingFunction(error: RpcResult["error"]): boolean {
  const code = error?.code ?? "";
  if (code === "PGRST202" || code === "PGRST203" || code === "42883") return true;
  return (error?.message ?? "").toLowerCase().includes("could not find the function");
}

/**
 * Spend one unit of the caller's hourly AI quota with the SERVICE client.
 * A counter that exists and fails refuses (fail closed, like the web's
 * checkRateLimit); a counter that is not deployed allows.
 */
export async function aiRateLimit(service: RpcClient, userId: string): Promise<RateVerdict> {
  const refuse: RateVerdict = { limited: true, retryAfterSec: 60 };
  try {
    const { data, error } = await service.rpc("rate_limit_hit", {
      p_key: `ai_analysis:${userId}`,
      p_window_sec: AI_RATE_LIMIT.windowSec,
      p_max: AI_RATE_LIMIT.max,
      p_cost: 1,
    });
    if (error) return isMissingFunction(error) ? { limited: false } : refuse;
    const row = data as { limited?: unknown; reset_sec?: unknown } | null;
    if (!row || typeof row !== "object" || typeof row.limited !== "boolean") return refuse;
    if (!row.limited) return { limited: false };
    const reset = typeof row.reset_sec === "number" && row.reset_sec > 0
      ? Math.ceil(row.reset_sec)
      : AI_RATE_LIMIT.windowSec;
    return { limited: true, retryAfterSec: reset };
  } catch {
    return refuse;
  }
}
