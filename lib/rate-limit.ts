/**
 * Credential and usage throttling.
 *
 * ── What changed and why (2026-09-08 audit, findings 5.9 + 5.10) ──────────
 * Every throttle here used to be a read-then-write counter over `audit_log`:
 * count the rows an earlier attempt left behind, decide, and write this
 * attempt's row later (from the caller, if the caller remembered). That is
 * broken in two ways that matter:
 *
 *   • Concurrency walks through it. N requests fired at once all read the same
 *     pre-attempt count, all conclude "under the limit", and all proceed. The
 *     "5 per 15 minutes" login lock only ever sees round 1.
 *   • It failed OPEN. `const used = count ?? 0` turned an errored count query
 *     into "nobody has tried yet", so the protection vanished during exactly
 *     the database stress an attacker can induce — and audit_log inserts
 *     serialise behind the hash-chain trigger's advisory lock, so inducing it
 *     is cheap.
 *
 * The decision now comes from `public.rate_limit_hit`, an atomic
 * insert-or-increment that returns the post-increment count in one statement
 * (supabase/migrations/20260908112000_atomic_rate_limits.sql). Racing callers
 * serialise on the row lock and get 1, 2, 3 … N — never the same number twice.
 *
 * ── Fail-closed rules ────────────────────────────────────────────────────
 *   • Counter answers        → obey it.
 *   • Counter ERRORS         → treat as over-limit (429 / locked). "Cannot
 *                              count" must never mean "let them through".
 *   • Counter NOT DEPLOYED   → this is the deploy gap (code out, migration not
 *     (missing function)       applied yet), not an attack. Fall back to the
 *                              legacy audit-log counter so a deploy-ordering
 *                              accident cannot lock five operators out of
 *                              their own console. Logged loudly every time.
 *
 * ── Budget semantics ─────────────────────────────────────────────────────
 * Buckets count FAILURES, not honest use: a call spends one unit up-front and
 * `releaseRateLimit()` hands it back when the credential verified. Usage
 * quotas (REVEAL_LIMIT) simply never release, so they stay quotas.
 *
 * ── Kill switch (env `RATE_LIMIT_MODE`) ──────────────────────────────────
 *   unset / "enforce"  atomic counter, fail-closed (default)
 *   "legacy"           ignore the counter, use the old audit-log counting
 *                      (fail-open) — break-glass if the counter misbehaves
 *   "off"              throttling disabled entirely — ONLY to recover from an
 *                      operator lockout; every call logs a warning. Put it
 *                      back to `enforce` as soon as the operator is back in.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { verifyTOTP, verifyTOTPWithReplayCheck } from "@/lib/totp";
import { t as translateFallback, type TranslationKey } from "@/lib/i18n/translations";

// ── mode / kill switch ─────────────────────────────────────────────────
export type RateLimitMode = "enforce" | "legacy" | "off";

/** Reads `RATE_LIMIT_MODE` on every call so the switch works without a rebuild. */
export function rateLimitMode(): RateLimitMode {
  const raw = (process.env.RATE_LIMIT_MODE ?? "").trim().toLowerCase();
  return raw === "legacy" || raw === "off" ? raw : "enforce";
}

let warnedDisabled = false;
function warnDisabledOnce(where: string): void {
  if (warnedDisabled) return;
  warnedDisabled = true;
  log.warn("rate limiting is DISABLED (RATE_LIMIT_MODE=off)", { where });
}

// ── localisation ───────────────────────────────────────────────────────
/**
 * Messages are shown in dialogs, so they follow the operator's language
 * cookie. `next/headers` is unavailable outside a request scope (and in
 * tests), hence the dynamic import and the Mongolian fallback.
 */
async function tr(key: TranslationKey): Promise<string> {
  try {
    const { getT } = await import("@/lib/i18n/server");
    const { t } = await getT();
    return t(key);
  } catch {
    return translateFallback(key);
  }
}

function formatWindow(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} d`;
}

async function limitedMessage(resetSec: number): Promise<string> {
  return `${await tr("rl_too_many_attempts")} (${formatWindow(resetSec)})`;
}

// ── the atomic counter ─────────────────────────────────────────────────
type CounterOutcome =
  | { state: "ok"; count: number; limited: boolean; resetSec: number }
  /** The SQL function is not in the database yet — deploy gap, not an attack. */
  | { state: "unavailable" }
  /** The counter exists and failed. Callers MUST treat this as over-limit. */
  | { state: "error"; message: string };

type RpcResponse = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type RpcCapableClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResponse> };

/**
 * `rate_limit_hit` / `rate_limit_release` only appear in
 * lib/database.generated.ts after `npm run gen:types` runs against a database
 * that has the migration applied. Until then the generated `Database` type
 * does not know them — so the call goes through a narrow structural type
 * rather than `any`. Drop the cast once the types are regenerated.
 */
function rpcClient(): RpcCapableClient {
  return createServiceClient() as unknown as RpcCapableClient;
}

/**
 * "This deployment cannot use the counter" — as opposed to "the counter tried
 * and failed", which fails closed.
 *
 * Covers every way the migration can be absent or unusable: PostgREST cannot
 * see the function (PGRST202/203), Postgres says it does not exist (42883),
 * the table is missing (42P01), the schema is missing (3F000), or the grant
 * did not land (42501). None of these is attacker-inducible — an attacker
 * cannot drop a function or revoke a grant — while all of them would lock
 * five operators out of their own console if they failed closed. So this one
 * class degrades to the legacy counter instead, loudly.
 */
function isMissingFunction(err: { code?: string | null; message?: string | null } | null): boolean {
  const code = err?.code ?? "";
  if (
    code === "PGRST202" ||
    code === "PGRST203" ||
    code === "42883" ||
    code === "42P01" ||
    code === "3F000" ||
    code === "42501"
  ) {
    return true;
  }
  const msg = (err?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("permission denied for function")
  );
}

/** Keys are built from ids and e-mails; keep them inside the SQL 200-char guard. */
function bucketKey(prefix: string, subject: string): string {
  const raw = `${prefix}:${subject}`;
  if (raw.length <= 180) return raw;
  return `${prefix}:h:${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`;
}

/**
 * Spend `cost` from a bucket. `cost = 0` peeks without spending — used where
 * the caller cannot settle the attempt (see `checkLoginRateLimit`).
 */
async function counterHit(
  key: string,
  windowSec: number,
  max: number,
  cost = 1,
): Promise<CounterOutcome> {
  try {
    const { data, error } = await rpcClient().rpc("rate_limit_hit", {
      p_key: key,
      p_window_sec: Math.max(1, Math.round(windowSec)),
      p_max: Math.max(0, Math.round(max)),
      p_cost: cost,
    });
    if (error) {
      if (isMissingFunction(error)) return { state: "unavailable" };
      return { state: "error", message: error.message ?? "rate_limit_hit failed" };
    }
    const row = data as { count?: unknown; limited?: unknown; reset_sec?: unknown } | null;
    if (!row || typeof row.count !== "number" || typeof row.limited !== "boolean") {
      return { state: "error", message: "rate_limit_hit returned an unexpected shape" };
    }
    return {
      state: "ok",
      count: row.count,
      limited: row.limited,
      resetSec: typeof row.reset_sec === "number" ? row.reset_sec : windowSec,
    };
  } catch (err) {
    // Network / client failure. Fail closed: the caller turns this into a 429.
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Give a spent unit back after a SUCCESSFUL credential check. Failures here
 * are swallowed: a refund that does not land costs the operator budget, it
 * never opens the gate.
 */
async function counterRelease(key: string, windowSec: number, cost = 1): Promise<void> {
  try {
    const { error } = await rpcClient().rpc("rate_limit_release", {
      p_key: key,
      p_window_sec: Math.max(1, Math.round(windowSec)),
      p_cost: cost,
    });
    if (error && !isMissingFunction(error)) {
      log.warn("rate limit refund failed", { key, error: error.message ?? "unknown" });
    }
  } catch (err) {
    log.warn("rate limit refund threw", { key, error: err instanceof Error ? err.message : String(err) });
  }
}

// ── public API ─────────────────────────────────────────────────────────
export interface RateLimitOptions {
  /**
   * Audit actions this bucket corresponds to. Still used by the legacy
   * fallback counter and by the login lock's secondary signal.
   */
  action: string | string[];
  /** Window length in seconds. */
  windowSec: number;
  /** Attempts allowed inside the window. */
  max: number;
  /**
   * Stable bucket name. Two presets sharing a name share a budget (that is
   * how step-up password, step-up TOTP and TOTP-disable stay one budget).
   * Defaults to the first action name, so an ad-hoc options object still
   * gets a deterministic bucket.
   */
  name?: string;
}

export interface RateLimitResult {
  ok: boolean;
  count: number;
  resetSec: number;
  message?: string;
}

function bucketName(opts: RateLimitOptions): string {
  if (opts.name) return opts.name;
  const first = Array.isArray(opts.action) ? (opts.action[0] ?? "rl") : opts.action;
  return String(first).toLowerCase();
}

/**
 * Spend one unit of `userId`'s budget for this bucket and report whether the
 * attempt is allowed. Atomic: concurrent callers cannot all pass.
 *
 * Call it BEFORE checking the credential, and call `releaseRateLimit()` with
 * the same arguments when the credential turned out to be correct.
 */
export async function checkRateLimit(
  userId: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const mode = rateLimitMode();
  if (mode === "off") {
    warnDisabledOnce(`checkRateLimit:${bucketName(opts)}`);
    return { ok: true, count: 0, resetSec: opts.windowSec };
  }

  if (mode === "enforce") {
    const key = bucketKey(bucketName(opts), userId);
    const hit = await counterHit(key, opts.windowSec, opts.max);

    if (hit.state === "ok") {
      if (!hit.limited) return { ok: true, count: hit.count, resetSec: hit.resetSec };
      return {
        ok: false,
        count: hit.count,
        resetSec: hit.resetSec,
        message: await limitedMessage(hit.resetSec),
      };
    }

    if (hit.state === "error") {
      // FAIL CLOSED — see the header. This is the case the old code got wrong.
      log.error("rate limit counter failed — refusing the attempt", {
        bucket: bucketName(opts),
        error: hit.message,
      });
      return {
        ok: false,
        count: -1,
        resetSec: Math.min(opts.windowSec, 60),
        message: await tr("rl_unavailable"),
      };
    }

    log.warn("rate_limit_hit is not deployed — falling back to audit-log counting", {
      bucket: bucketName(opts),
    });
  }

  return legacyCheckRateLimit(userId, opts);
}

/**
 * Hand back the unit `checkRateLimit()` spent. Call only after the credential
 * verified, so the bucket counts wrong answers rather than honest sign-ins.
 * Usage quotas (REVEAL_LIMIT) deliberately never call this.
 */
export async function releaseRateLimit(userId: string, opts: RateLimitOptions): Promise<void> {
  if (rateLimitMode() !== "enforce") return;
  await counterRelease(bucketKey(bucketName(opts), userId), opts.windowSec);
}

/**
 * The pre-2026-09-08 behaviour: count matching rows in `audit_log`. Kept as
 * the deploy-gap fallback and as the login lock's secondary signal. Racy and
 * fail-open by construction — which is why it is never the only check when
 * the counter is available.
 */
async function legacyCheckRateLimit(
  userId: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const used = await legacyCount({
    actions: Array.isArray(opts.action) ? opts.action : [opts.action],
    windowSec: opts.windowSec,
    userId,
  });

  if (used === null) {
    // Could not count and there is no atomic counter to lean on. Let the
    // attempt through rather than locking every operator out of a working
    // console — and say so in the logs.
    log.error("legacy rate-limit count failed — attempt allowed (no atomic counter available)", {
      bucket: bucketName(opts),
    });
    return { ok: true, count: 0, resetSec: opts.windowSec };
  }

  if (used >= opts.max) {
    return {
      ok: false,
      count: used,
      resetSec: opts.windowSec,
      message: await limitedMessage(opts.windowSec),
    };
  }
  return { ok: true, count: used, resetSec: opts.windowSec };
}

/** Count audit rows in a window. `null` = the query itself failed. */
async function legacyCount(args: {
  actions: string[];
  windowSec: number;
  userId?: string;
  email?: string;
  ip?: string;
}): Promise<number | null> {
  try {
    const svc = createServiceClient();
    const since = new Date(Date.now() - args.windowSec * 1000).toISOString();
    let q = svc
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .in("action", args.actions)
      .gte("created_at", since);
    if (args.userId) q = q.eq("user_id", args.userId);
    if (args.email) q = q.eq("user_email", args.email);
    if (args.ip) q = q.eq("ip", args.ip);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

// ── Default presets ────────────────────────────────────────────────
/**
 * Step-up reauth: 5 wrong answers per user per minute.
 *
 * Every step-up outcome shares this bucket — password, TOTP, recovery code,
 * TOTP disable — so an attacker cannot get five tries per endpoint. Successful
 * step-ups are refunded, so an operator doing real work is never locked out by
 * their own success.
 */
export const REAUTH_LIMIT: RateLimitOptions = {
  name: "reauth",
  action: [
    "REAUTH_OK",
    "REAUTH_FAILED",
    "REAUTH_TOTP_OK",
    "REAUTH_TOTP_FAILED",
    "REAUTH_TOTP_REPLAY_BLOCKED",
    "TOTP_RECOVERY_FAILED",
    "TOTP_DISABLE_FAILED",
    "TOTP_VERIFY_FAILED",
    "TOTP_REPLAY_BLOCKED",
    "TOTP_REGEN_FAILED",
    "TOTP_REGEN_REPLAY_BLOCKED",
  ],
  windowSec: 60,
  max: 5,
};

/** Login step 2 (TOTP / recovery code): 5 wrong codes per user per 15 min. */
export const TOTP_LOGIN_LIMIT: RateLimitOptions = {
  name: "totp_login",
  action: ["TOTP_LOGIN_FAILED", "TOTP_LOGIN_REPLAY_BLOCKED", "TOTP_RECOVERY_FAILED"],
  windowSec: 15 * 60,
  max: 5,
};

/**
 * Reveal: 20 per admin per hour. A usage quota, not a brute-force lock —
 * successes are never refunded.
 */
export const REVEAL_LIMIT: RateLimitOptions = {
  name: "reveal",
  action: "REVEAL_REQUEST",
  windowSec: 3600,
  max: 20,
};

// ── TOTP: one throttled, audited code check for every endpoint ─────────
/** Audit actions the TOTP guard writes. Append-only — /audit filters use them. */
export const TOTP_BLOCKED_ACTION = "TOTP_BLOCKED";

export interface TotpCheckParams {
  userId: string;
  userEmail?: string | null;
  /** The user's TOTP seed (from profiles.totp_secret). */
  secret: string;
  /** The submitted code. */
  code: string;
  /** Budget to spend from. Defaults to REAUTH_LIMIT. */
  limit?: RateLimitOptions;
  /** Audit action for a wrong code, e.g. "REAUTH_TOTP_FAILED". */
  failAction: string;
  /** Audit action for a replayed (already-used) code. Defaults to `failAction`. */
  replayAction?: string;
  /**
   * First-time enrolment only: the replay ledger has no entry for a seed that
   * is not yet active, so the code is checked without consuming it.
   */
  skipReplayCheck?: boolean;
  /** Extra context for the audit row (never the code itself). */
  detail?: string;
  /** Client IP for the audit row, when the caller has one. */
  ip?: string | null;
}

export type TotpCheckResult =
  | { ok: true }
  | { ok: false; status: 429; reason: "rate_limited"; error: string; retryAfterSec: number }
  | { ok: false; status: 401; reason: "invalid" | "replayed"; error: string };

/**
 * The single way to check a TOTP code.
 *
 * Order matters: the throttle is spent BEFORE the code is verified, so an
 * attacker cannot use a fast verifier as an unmetered oracle, and a wrong code
 * always leaves an audit row. A correct code refunds its unit.
 */
export async function checkTotpCode(p: TotpCheckParams): Promise<TotpCheckResult> {
  const limit = p.limit ?? REAUTH_LIMIT;

  const rl = await checkRateLimit(p.userId, limit);
  if (!rl.ok) {
    await auditBlocked(p.userId, p.userEmail, limit, p.detail, p.ip);
    return {
      ok: false,
      status: 429,
      reason: "rate_limited",
      error: rl.message ?? (await tr("rl_too_many_attempts")),
      retryAfterSec: rl.resetSec,
    };
  }

  const outcome: "ok" | "invalid" | "replayed" = p.skipReplayCheck
    ? verifyTOTP(p.secret, p.code)
      ? "ok"
      : "invalid"
    : await verifyTOTPWithReplayCheck(p.userId, p.secret, p.code);

  if (outcome !== "ok") {
    await writeAudit({
      action: outcome === "replayed" ? (p.replayAction ?? p.failAction) : p.failAction,
      userId: p.userId,
      userEmail: p.userEmail,
      detail: p.detail,
      ip: p.ip,
    });
    return {
      ok: false,
      status: 401,
      reason: outcome,
      error: await tr(outcome === "replayed" ? "rl_totp_code_used" : "rl_totp_code_invalid"),
    };
  }

  await releaseRateLimit(p.userId, limit);
  return { ok: true };
}

/** Turn a refusal from `checkTotpCode()` into the HTTP response routes return. */
export function totpCheckResponse(result: Exclude<TotpCheckResult, { ok: true }>): NextResponse {
  if (result.status === 429) {
    return NextResponse.json(
      { error: result.error, code: "rate_limited", retry_after_sec: result.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
    );
  }
  return NextResponse.json({ error: result.error, code: result.reason }, { status: 401 });
}

/** Same shape for a non-TOTP refusal (password step-up, quotas). */
export function rateLimitResponse(rl: RateLimitResult): NextResponse {
  const retry = Math.max(1, rl.resetSec);
  return NextResponse.json(
    { error: rl.message ?? "rate limited", code: "rate_limited", retry_after_sec: retry },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}

async function writeAudit(row: {
  action: string;
  userId?: string | null;
  userEmail?: string | null;
  detail?: string | null;
  ip?: string | null;
}): Promise<void> {
  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: row.action,
      user_id: row.userId ?? null,
      user_email: row.userEmail ?? null,
      detail: row.detail ?? null,
      ...(row.ip ? { ip: row.ip } : {}),
    });
  } catch {
    // Auditing must never turn a refusal into a 500.
  }
}

/**
 * One "blocked" row per bucket per window. Every audit insert takes the
 * hash-chain advisory lock, so writing one per blocked attempt would hand an
 * attacker a cheap way to serialise the whole ledger.
 */
async function auditBlocked(
  userId: string,
  userEmail: string | null | undefined,
  limit: RateLimitOptions,
  detail?: string,
  ip?: string | null,
): Promise<void> {
  if (rateLimitMode() === "enforce") {
    const once = await counterHit(bucketKey(`${bucketName(limit)}_blocked_audit`, userId), limit.windowSec, 1);
    if (once.state === "ok" && once.count !== 1) return;
  }
  await writeAudit({
    action: TOTP_BLOCKED_ACTION,
    userId,
    userEmail,
    detail: `${bucketName(limit)} bucket exhausted (${limit.max}/${formatWindow(limit.windowSec)})${detail ? ` · ${detail}` : ""}`,
    ip,
  });
}

// ── Login attempts (per e-mail + per IP) ───────────────────────────────
/**
 * Login is throttled on two dimensions: per e-mail (one account under attack)
 * and per IP (credential stuffing across accounts).
 */
export interface LoginAttemptOptions {
  ip: string | null;
  email: string;
  windowSec?: number;   // default 900 = 15 minutes
  maxPerEmail?: number; // default 5
  maxPerIp?: number;    // default 10
  /**
   * "password" (default) applies both the per-email and per-IP locks.
   * "passkey" applies the per-IP lock only: passkeys are phishing-resistant
   * and unguessable, so an attacker must not be able to lock an admin out of
   * passkey login just by failing five passwords against their e-mail.
   */
  scope?: "password" | "passkey";
}

export interface LoginRateLimitResult {
  ok: boolean;
  reason?: "email_locked" | "ip_locked" | "counter_unavailable";
  message?: string;
  retryAfterSec?: number;
}

/** A started attempt: `release()` refunds it once the credential verified. */
export interface LoginAttemptHandle extends LoginRateLimitResult {
  release: () => Promise<void>;
}

const LOGIN_EMAIL_BUCKET = "login_email";
const LOGIN_IP_BUCKET = "login_ip";

/**
 * Failure actions the secondary (audit-log) signal counts. Kept so a lockout
 * survives a counter sweep / rollback, exactly as it did before.
 */
const FAILED_LOGIN_ACTIONS = [
  "LOGIN_FAILED",
  "TOTP_LOGIN_FAILED",
  "TOTP_LOGIN_REPLAY_BLOCKED",
  "TOTP_RECOVERY_FAILED",
  "REAUTH_FAILED",
  "REAUTH_TOTP_FAILED",
  "TOTP_DISABLE_FAILED",
  "PASSKEY_LOGIN_FAILED",
];

/**
 * INSPECT the login buckets without spending anything.
 *
 * For callers that cannot settle the attempt they are about to start — the
 * passkey `begin` route hands out a challenge and never learns whether it was
 * used, so charging it would let anyone lock an account out by requesting
 * challenges. Fail-closed on a counter error, like everything else.
 */
export async function checkLoginRateLimit(
  opts: LoginAttemptOptions,
): Promise<LoginRateLimitResult> {
  const attempt = await loginAttempt(opts, 0);
  return { ok: attempt.ok, reason: attempt.reason, message: attempt.message, retryAfterSec: attempt.retryAfterSec };
}

/**
 * START a login attempt: spends one unit per applicable dimension, atomically.
 * Call `release()` when the credential verified so honest sign-ins do not
 * consume the budget.
 */
export async function startLoginAttempt(opts: LoginAttemptOptions): Promise<LoginAttemptHandle> {
  return loginAttempt(opts, 1);
}

async function loginAttempt(opts: LoginAttemptOptions, cost: 0 | 1): Promise<LoginAttemptHandle> {
  const windowSec = opts.windowSec ?? 15 * 60;
  const maxEmail = opts.maxPerEmail ?? 5;
  const maxIp = opts.maxPerIp ?? 10;
  const emailScoped = (opts.scope ?? "password") === "password";
  const email = opts.email.trim().toLowerCase();
  const emailKey = bucketKey(LOGIN_EMAIL_BUCKET, email);
  const ipKey = opts.ip ? bucketKey(LOGIN_IP_BUCKET, opts.ip) : null;
  const mode = rateLimitMode();

  const noop = async () => {};

  if (mode === "off") {
    warnDisabledOnce("login");
    return { ok: true, release: noop };
  }

  let spentEmail = false;
  let spentIp = false;
  const release = async () => {
    if (spentEmail) await counterRelease(emailKey, windowSec);
    if (spentIp && ipKey) await counterRelease(ipKey, windowSec);
  };

  if (mode === "enforce") {
    // ── per e-mail ──
    if (emailScoped) {
      const hit = await counterHit(emailKey, windowSec, maxEmail, cost);
      if (hit.state === "error") return failClosedLogin(hit.message, windowSec);
      if (hit.state === "ok") {
        spentEmail = cost > 0;
        if (hit.limited) {
          await maybeAlertLockout("email", email, hit.count, maxEmail);
          return {
            ok: false,
            reason: "email_locked",
            message: await limitedMessage(hit.resetSec),
            retryAfterSec: hit.resetSec,
            release: noop, // a refused attempt keeps its unit — that is the lock
          };
        }
      }
      // "unavailable" → fall through to the legacy signal below
    }

    // ── per IP ──
    if (ipKey) {
      const hit = await counterHit(ipKey, windowSec, maxIp, cost);
      if (hit.state === "error") {
        await release();
        return failClosedLogin(hit.message, windowSec);
      }
      if (hit.state === "ok") {
        spentIp = cost > 0;
        if (hit.limited) {
          // Do not also punish the e-mail for an IP-level lock.
          if (spentEmail) {
            await counterRelease(emailKey, windowSec);
            spentEmail = false;
          }
          await maybeAlertLockout("ip", opts.ip!, hit.count, maxIp);
          return {
            ok: false,
            reason: "ip_locked",
            message: await limitedMessage(hit.resetSec),
            retryAfterSec: hit.resetSec,
            release: noop,
          };
        }
      }
    }
  }

  // ── secondary signal: the historical audit-log count ──────────────────
  // Best effort only. It can lock, it can never unlock, and a failure here is
  // ignored — the decision above already stands on its own.
  const legacy = await legacyLoginLock({ email: emailScoped ? email : null, ip: opts.ip, windowSec, maxEmail, maxIp });
  if (legacy) {
    await release();
    return { ...legacy, release: noop };
  }

  return { ok: true, release };
}

async function failClosedLogin(reason: string, windowSec: number): Promise<LoginAttemptHandle> {
  log.error("login rate-limit counter failed — refusing the attempt", { error: reason });
  return {
    ok: false,
    reason: "counter_unavailable",
    message: await tr("rl_unavailable"),
    retryAfterSec: Math.min(windowSec, 60),
    release: async () => {},
  };
}

async function legacyLoginLock(args: {
  email: string | null;
  ip: string | null;
  windowSec: number;
  maxEmail: number;
  maxIp: number;
}): Promise<LoginRateLimitResult | null> {
  if (args.email) {
    const fails = await legacyCount({
      actions: FAILED_LOGIN_ACTIONS,
      windowSec: args.windowSec,
      email: args.email,
    });
    if (fails !== null && fails >= args.maxEmail) {
      await maybeAlertLockout("email", args.email, fails, args.maxEmail);
      return {
        ok: false,
        reason: "email_locked",
        message: await limitedMessage(args.windowSec),
        retryAfterSec: args.windowSec,
      };
    }
  }

  if (args.ip) {
    const fails = await legacyCount({
      actions: FAILED_LOGIN_ACTIONS,
      windowSec: args.windowSec,
      ip: args.ip,
    });
    if (fails !== null && fails >= args.maxIp) {
      await maybeAlertLockout("ip", args.ip, fails, args.maxIp);
      return {
        ok: false,
        reason: "ip_locked",
        message: await limitedMessage(args.windowSec),
        retryAfterSec: args.windowSec,
      };
    }
  }

  return null;
}

/**
 * Send a Slack alert + audit row when an account is locked out.
 * Throttled to once per (kind, target) per hour so we don't spam during a
 * sustained brute-force attempt — the rate-limit decision still fires every
 * attempt, but the alert only fires the first time within the cool-down.
 */
async function maybeAlertLockout(
  kind: "email" | "ip",
  target: string,
  fails: number,
  threshold: number,
): Promise<void> {
  const ALERT_COOLDOWN_SEC = 3600;

  // Prefer the atomic counter for the cool-down: one alert per target per
  // hour, decided in one statement instead of a LIKE scan over audit_log.
  if (rateLimitMode() === "enforce") {
    const once = await counterHit(bucketKey(`lockout_alert_${kind}`, target), ALERT_COOLDOWN_SEC, 1);
    if (once.state === "ok") {
      if (once.count !== 1) return;
    } else if (once.state === "error") {
      return; // cannot tell → stay quiet rather than spam
    } else if (await alertedRecently(kind, target, ALERT_COOLDOWN_SEC)) {
      return;
    }
  } else if (await alertedRecently(kind, target, ALERT_COOLDOWN_SEC)) {
    return;
  }

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "LOCKOUT_TRIGGERED",
      detail: `${kind}=${target} fails=${fails}/${threshold}`,
      ...(kind === "email" ? { user_email: target } : { ip: target }),
    });
  } catch {}

  const slackUrl = process.env.SLACK_ALERT_WEBHOOK;
  if (slackUrl) {
    try {
      await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:lock: *MONGOLZ account lockout* — ${kind} \`${target}\` locked after ${fails}/${threshold} failed attempts in 15 min`,
        }),
      });
    } catch {}
  }
}

/** Legacy cool-down probe: has a LOCKOUT_TRIGGERED row been written recently? */
async function alertedRecently(kind: "email" | "ip", target: string, cooldownSec: number): Promise<boolean> {
  try {
    const svc = createServiceClient();
    const since = new Date(Date.now() - cooldownSec * 1000).toISOString();
    // `target` is attacker-controlled (the e-mail they typed) — escape LIKE
    // metacharacters so it cannot widen the pattern.
    const likeTarget = target.replace(/[\\%_]/g, (m) => `\\${m}`);
    const { count } = await svc
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "LOCKOUT_TRIGGERED")
      .like("detail", `${kind}=${likeTarget} %`)
      .gte("created_at", since);
    return (count ?? 0) > 0;
  } catch {
    return true; // cannot tell → do not spam
  }
}
