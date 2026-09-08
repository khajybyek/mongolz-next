/**
 * Operator-facing numbers: the three states a figure can be in, who is
 * allowed to read what, and one Asia/Seoul bucketing helper.
 *
 * WHY THIS EXISTS
 * ---------------
 * Row-level security does not raise an error when it refuses a read — it
 * filters the rows away. `select("*", { count: "exact", head: true })` on a
 * table the caller may not read therefore returns `count: 0, error: null`,
 * which is byte-identical to "the table is genuinely empty". Until this
 * module existed, /dashboard and /analytics rendered that as a confident
 * `0`, and /dashboard additionally said "no alerts" to a viewer while the
 * alert table was full. A failed query rendered as `0` for the same reason.
 *
 * So every headline figure now carries one of three states:
 *   ok      — a real number the caller is entitled to
 *   denied  — the caller may not read this (RLS / role / second factor)
 *   error   — the query failed; the operator should retry, not read a zero
 *
 * The access map below is the app-tier copy of the RLS policies. It is a
 * presentation aid, never an authorisation decision: the database is still
 * the only thing that decides what a query returns. `shapeCount` therefore
 * trusts real rows over the map — if the map says "denied" but the database
 * handed back a non-zero count, the map is stale and the number wins.
 */
import type { UserRole } from "@/lib/database.types";

// ── error shapes ───────────────────────────────────────────────────────

/** The subset of PostgrestError this module needs (also matches a thrown Error). */
export type PgError = { code?: string | null; message?: string | null } | null | undefined;

export type CountReply = { count: number | null; error: PgError };
export type RowsReply<T> = { data: T[] | null; error: PgError };

/**
 * A refusal, as opposed to a failure. PostgREST surfaces an explicit refusal
 * only when Postgres raises (a SECURITY DEFINER RPC gate, a revoked grant,
 * a table with no permissive policy at all) — 42501 plus the wordings the
 * project's own RPCs raise ("forbidden: admin only", "forbidden: second
 * factor required").
 */
export function isDeniedError(error: PgError): boolean {
  if (!error) return false;
  if ((error.code ?? "") === "42501") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("permission denied") ||
    msg.includes("forbidden") ||
    msg.includes("insufficient privilege") ||
    msg.includes("violates row-level security")
  );
}

/**
 * "This deployment does not have the SQL yet" — the aggregate helpers ship in
 * a migration, and a page must not claim a number when the function that
 * computes it is missing. Same code list as lib/rate-limit.ts, minus 42501
 * (which is a refusal here, not a deploy gap).
 */
export function isMissingFunctionError(error: PgError): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["PGRST202", "PGRST203", "42883", "42P01", "3F000"].includes(code)) return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || msg.includes("does not exist");
}

// ── the three states ───────────────────────────────────────────────────

export type MetricValue =
  | { state: "ok"; value: number }
  | { state: "denied" }
  | { state: "error"; message?: string };

export type MetricList<T> =
  | { state: "ok"; rows: T[]; capped: boolean }
  | { state: "denied" }
  | { state: "error"; message?: string };

export type MetricState = MetricValue["state"];

function failure(error: PgError, fallback: string): MetricValue & { state: "error" } {
  return { state: "error", message: error?.message ?? fallback };
}

/**
 * Turn a PostgREST count reply into a figure the UI may print.
 *
 * @param reply   `{ count, error }` from `.select("*", { count: "exact", head: true })`
 * @param allowed what the access map says about this table for this caller
 */
export function shapeCount(reply: CountReply, allowed: boolean): MetricValue {
  if (reply.error) {
    return isDeniedError(reply.error) ? { state: "denied" } : failure(reply.error, "query failed");
  }
  const n = reply.count;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    // No error and no count: the Content-Range header did not come back.
    // Printing 0 here is exactly the bug this module exists to stop.
    return { state: "error", message: "count missing" };
  }
  // Rows beat the map: a positive count proves the read went through, so a
  // stale access map can only ever under-claim, never fabricate a zero.
  if (!allowed && n === 0) return { state: "denied" };
  return { state: "ok", value: n };
}

export type ShapeOptions = {
  /**
   * The cap the query was issued with. A result that fills it is a page, not
   * a population, and the caller must label it as one.
   */
  limit?: number;
  /**
   * Does a returned row prove the read went through? True for table reads:
   * RLS filters refused rows away, so any row means access. False for the
   * `*_kst` aggregates, which return a filled calendar (or a single all-zero
   * row) even when every underlying row was withheld — there the access map
   * is the only signal, and rows must never override it.
   */
  rowsProveAccess?: boolean;
};

/** Same three states for a list of rows. */
export function shapeRows<T>(
  reply: RowsReply<T>,
  allowed: boolean,
  options: ShapeOptions = {},
): MetricList<T> {
  const { limit, rowsProveAccess = true } = options;
  if (reply.error) {
    return isDeniedError(reply.error) ? { state: "denied" } : failure(reply.error, "query failed");
  }
  const rows = reply.data;
  if (!Array.isArray(rows)) return { state: "error", message: "no rows returned" };
  if (!allowed && (!rowsProveAccess || rows.length === 0)) return { state: "denied" };
  return { state: "ok", rows, capped: typeof limit === "number" && rows.length >= limit };
}

/** The number if it is real, otherwise null — for callers that only need the value. */
export function metricNumber(m: MetricValue): number | null {
  return m.state === "ok" ? m.value : null;
}

/** Rows if they are real, otherwise an empty array — for callers that map over them. */
export function metricRows<T>(m: MetricList<T>): T[] {
  return m.state === "ok" ? m.rows : [];
}

/** `1,204` for a real number; the em dash for both failure states. */
export function formatMetric(m: MetricValue, locale?: string): string {
  return m.state === "ok" ? m.value.toLocaleString(locale) : "—";
}

/** True when at least one figure on the page failed (drives the retry banner). */
export function anyErrored(...metrics: Array<MetricValue | MetricList<unknown>>): boolean {
  return metrics.some((m) => m.state === "error");
}

/** True when at least one figure is closed to this caller. */
export function anyDenied(...metrics: Array<MetricValue | MetricList<unknown>>): boolean {
  return metrics.some((m) => m.state === "denied");
}

// ── who may read what ──────────────────────────────────────────────────

export type ReadableTable =
  | "faces"
  | "suspects"
  | "alerts"
  | "recordings"
  | "cameras"
  | "audit_log";

export type ReadScope = Record<ReadableTable, boolean>;

/**
 * The app-tier mirror of the SELECT policies, so a page can tell "no rows"
 * from "not yours". Sources:
 *   supabase/migrations/20260427000002_rls_policies.sql
 *     faces / suspects / alerts   → private.is_admin()
 *   supabase/migrations/20260906130100_operator_scope_and_storage.sql
 *     cameras / recordings        → private.is_operator() (admin | viewer)
 *                                   AND private.user_can_see_camera(...)
 *   supabase/migrations/20260908110000_mfa_proof_at_data_tier.sql
 *     all of the above            → AND private.mfa_ok()
 *   audit_log                     → private.is_admin_or_auditor()
 *
 * `mfaOk` is what public.mfa_status() reports for THIS session (see
 * `readMfaOk`): an admin holding a password-only token reads every gated
 * table as empty, and that must not print as zero either.
 *
 * Note for cameras/recordings: `true` means "the read is allowed", not "you
 * see every row" — camera permissions still scope it per row, so the figure
 * is a within-your-permissions total.
 */
export function readScope(role: UserRole | null | undefined, mfaOk: boolean): ReadScope {
  const admin = role === "admin";
  const operator = role === "admin" || role === "viewer";
  const auditor = role === "auditor";
  const gate = (allowed: boolean) => allowed && mfaOk;
  return {
    faces: gate(admin),
    suspects: gate(admin),
    alerts: gate(admin),
    recordings: gate(operator),
    cameras: gate(operator),
    audit_log: gate(admin || auditor),
  };
}

/** Why a figure is closed — picks the message the page shows. */
export type DenyReason = "mfa" | "role";
export function denyReason(mfaOk: boolean): DenyReason {
  return mfaOk ? "role" : "mfa";
}

// ── RPC plumbing ───────────────────────────────────────────────────────

type RpcReply = { data: unknown; error: PgError };
/**
 * `mfa_status` and the `*_kst` aggregates only appear in
 * lib/database.generated.ts after `npm run gen:types` runs against a database
 * with the migrations applied. Until then the generated `Database` type does
 * not know them, so the call goes through this narrow structural type rather
 * than `any` (same escape hatch as lib/rate-limit.ts). Drop the cast once the
 * types are regenerated.
 */
export type RpcCapableClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcReply>;
};

/** Call an RPC that returns SETOF, normalising throws and shapes. */
export async function rpcRows<T>(
  client: RpcCapableClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<RowsReply<T>> {
  try {
    const { data, error } = await client.rpc(fn, args ?? {});
    if (error) return { data: null, error };
    if (data == null) return { data: [], error: null };
    return { data: (Array.isArray(data) ? data : [data]) as T[], error: null };
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}

/** Call an RPC that returns a single row (or the first of a one-row SETOF). */
export async function rpcRow<T>(
  client: RpcCapableClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: PgError }> {
  const res = await rpcRows<T>(client, fn, args);
  if (res.error) return { data: null, error: res.error };
  return { data: res.data?.[0] ?? null, error: null };
}

/**
 * Does this session prove a second factor? `public.mfa_status()` answers for
 * the caller's own token. Fails open exactly like private.mfa_ok(): anything
 * we cannot determine (missing function, network, odd shape) counts as "yes",
 * so a diagnostic outage never mislabels live data as denied.
 */
export async function readMfaOk(client: RpcCapableClient): Promise<boolean> {
  const { data, error } = await rpcRow<{ mfa_ok?: unknown }>(client, "mfa_status");
  if (error || !data || typeof data !== "object") return true;
  return data.mfa_ok === false ? false : true;
}

// ── Asia/Seoul bucketing ───────────────────────────────────────────────

export const KST_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

const kstDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function asDate(at: Date | string | number): Date {
  return at instanceof Date ? at : new Date(at);
}

/**
 * `YYYY-MM-DD` of the instant in Asia/Seoul. Every timestamp on screen is
 * rendered in KST (lib/utils#formatDate), so every bucket must be cut there
 * too — 2026-09-08T16:00:00Z is 01:00 on 2026-09-09 in Seoul and belongs to
 * the 09-09 bucket, not 09-08.
 */
export function kstDayKey(at: Date | string | number): string {
  const d = asDate(at);
  if (Number.isNaN(d.getTime())) return "";
  return kstDayFormat.format(d);
}

/** ISO instant of 00:00 KST on the day that contains `at` — the "today" boundary. */
export function kstStartOfDayISO(at: Date | string | number = new Date()): string {
  return new Date(`${kstDayKey(at)}T00:00:00+09:00`).toISOString();
}

/** ISO instant of 00:00 KST `daysBack` KST-days before `at` (0 = today). */
export function kstStartOfDayBeforeISO(daysBack: number, at: Date | string | number = new Date()): string {
  const d = asDate(at);
  return kstStartOfDayISO(new Date(d.getTime() - Math.max(0, daysBack) * DAY_MS));
}

/** Ascending KST day keys ending with the day that contains `now` (KST has no DST). */
export function kstDayKeys(days: number, now: Date | string | number = new Date()): string[] {
  const n = Math.max(1, Math.floor(days));
  const end = asDate(now).getTime();
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(kstDayKey(new Date(end - i * DAY_MS)));
  return keys;
}

export type DayBucket = { day: string; count: number };

/**
 * Count timestamps into the last `days` KST days, gaps included as zeros.
 * Rows outside the window are ignored, so a capped fetch can only understate
 * a bucket — which is why a capped list must be labelled where it is shown.
 */
export function bucketByKstDay(
  timestamps: Array<string | Date | number>,
  days: number,
  now: Date | string | number = new Date(),
): DayBucket[] {
  const keys = kstDayKeys(days, now);
  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const ts of timestamps) {
    const key = kstDayKey(ts);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

/** Percentage change of `current` against `previous`; null when there is no baseline. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}
