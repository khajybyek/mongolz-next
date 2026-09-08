/**
 * Window + alarm arithmetic for the failure-rate monitor.
 *
 * Kept out of `route.ts` for two reasons: Next only allows known exports from
 * a route file, and the schedule/window agreement is worth a unit test
 * (`__tests__/observability.test.ts` reads `vercel.json` and asserts the cron
 * cadence still matches `RECENT_WINDOW_MIN`).
 *
 * The bug this encodes against: the monitor compared a 5-minute window against
 * the previous 55 minutes while `vercel.json` ran it once a day, so it looked
 * at 5 of 1440 minutes — 0.35 % of the day — and the other 99.65 % was never
 * examined by anything. Schedule and window now describe the same hour.
 */

/** Must match the `/api/monitoring/error-rate` entry in vercel.json. */
export const MONITOR_CRON = "0 * * * *";

/** The window the cron actually covers: everything since the previous run. */
export const RECENT_WINDOW_MIN = 60;

/** Baseline = the rest of the rolling day, so the two windows never overlap. */
export const BASELINE_WINDOW_MIN = 23 * 60;

/**
 * Absolute floor before a ratio may alarm. A handful of mistyped passwords per
 * hour is normal for a multi-admin console; without a floor a jump from 1 to 2
 * failures would page someone.
 */
export const MIN_RECENT_EVENTS = 5;

/** Relative uplift over baseline that counts as a spike (10 %). */
export const DEFAULT_THRESHOLD = 0.1;

/** Audit actions that mean "someone failed to get in". */
export const FAILURE_ACTIONS = ["LOGIN_FAILED", "TOTP_LOGIN_FAILED", "LOGIN_BLOCKED"] as const;

/**
 * `SENTRY_ERROR_RATE_THRESHOLD` as a usable number.
 *
 * A malformed value used to become `NaN`, and every `NaN` comparison is false —
 * the monitor would then never alarm and never say why. Fall back loudly-typed
 * instead: anything that is not a finite positive number is ignored.
 */
export function resolveThreshold(raw: string | undefined = process.env.SENTRY_ERROR_RATE_THRESHOLD): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD;
}

export interface FailureRateInput {
  recentCount: number;
  baselineCount: number;
  threshold?: number;
  recentWindowMin?: number;
  baselineWindowMin?: number;
}

export interface FailureRateVerdict {
  recentRate: number;
  baselineRate: number;
  /** Recent rate ÷ baseline rate. `null` when there is no baseline to divide by. */
  spikeRatio: number | null;
  baselineEmpty: boolean;
  alarm: boolean;
}

/**
 * Compare the two windows.
 *
 * With a baseline: alarm when the recent per-minute rate exceeds the baseline
 * rate by more than `threshold`, and at least `MIN_RECENT_EVENTS` happened.
 *
 * Without a baseline (a quiet system, the common case here): there is no ratio
 * to compute, so fall back to the absolute rate — more than `threshold`
 * failures per minute in the recent window is a spike on its own.
 */
export function evaluateFailureRate({
  recentCount,
  baselineCount,
  threshold = resolveThreshold(),
  recentWindowMin = RECENT_WINDOW_MIN,
  baselineWindowMin = BASELINE_WINDOW_MIN,
}: FailureRateInput): FailureRateVerdict {
  const recentRate = recentCount / recentWindowMin;
  const baselineRate = baselineCount / baselineWindowMin;
  const baselineEmpty = baselineRate <= 0;

  const spikeRatio = baselineEmpty ? null : recentRate / baselineRate;
  const exceeded = baselineEmpty ? recentRate > threshold : (spikeRatio as number) >= 1 + threshold;

  return {
    recentRate,
    baselineRate,
    spikeRatio,
    baselineEmpty,
    alarm: exceeded && recentCount >= MIN_RECENT_EVENTS,
  };
}

/**
 * How often a 5-field cron expression fires, in minutes — only for the shapes
 * this repo uses: daily (`m h . . .`), hourly (`m . . . .`), every-N-minutes
 * (a stepped minute field) and weekly (`m h . . d`), where `.` is a literal
 * asterisk. Returns `null` for anything else rather than guessing.
 */
export function cronIntervalMinutes(expression: string): number | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*") return null;

  const stepMatch = /^\*\/(\d+)$/.exec(minute);
  if (stepMatch && hour === "*" && dayOfWeek === "*") {
    const step = Number(stepMatch[1]);
    return step > 0 && step <= 60 ? step : null;
  }
  if (!/^\d+$/.test(minute)) return null;

  if (hour === "*") return dayOfWeek === "*" ? 60 : null;
  if (!/^\d+$/.test(hour)) return null;

  if (dayOfWeek === "*") return 24 * 60;
  if (/^\d+$/.test(dayOfWeek)) return 7 * 24 * 60;
  return null;
}
