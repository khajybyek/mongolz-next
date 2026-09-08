import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/auth/cron";
import {
  BASELINE_WINDOW_MIN,
  FAILURE_ACTIONS,
  MIN_RECENT_EVENTS,
  MONITOR_CRON,
  RECENT_WINDOW_MIN,
  evaluateFailureRate,
  resolveThreshold,
} from "./window";

/**
 * Failure-rate monitor.
 *
 * Counts LOGIN_FAILED + TOTP_LOGIN_FAILED + LOGIN_BLOCKED audit rows in the
 * last hour and compares them against the preceding 23 hours. On a spike it
 * fires the Slack webhook (when configured) and writes a MONITOR_ALARM audit
 * row so the signal survives even without Slack.
 *
 * Runs HOURLY — `vercel.json` schedules `MONITOR_CRON` and the recent window
 * is exactly that interval, so every minute of the day is examined by exactly
 * one run. (It used to inspect a 5-minute window once a day: 0.35 % of the
 * day, with the rest unmonitored. See ./window.ts.)
 *
 * Cost of hourly: 24 invocations/day instead of 1 — two `count(*)` queries
 * that finish in well under a second, so roughly half a minute of function
 * time per day. The real constraint is Vercel's cron *frequency* limit:
 * sub-daily schedules require a Pro/Enterprise plan. Reverting is a one-line
 * change in vercel.json — but then RECENT_WINDOW_MIN must move with it, and
 * the unit test that compares the two will say so.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET | MONITORING_CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const now = Date.now();
  const recentSince = new Date(now - RECENT_WINDOW_MIN * 60_000).toISOString();
  const baselineSince = new Date(now - (RECENT_WINDOW_MIN + BASELINE_WINDOW_MIN) * 60_000).toISOString();

  const [recent, base] = await Promise.all([
    svc
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .in("action", [...FAILURE_ACTIONS])
      .gte("created_at", recentSince),
    svc
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .in("action", [...FAILURE_ACTIONS])
      .gte("created_at", baselineSince)
      .lt("created_at", recentSince),
  ]);

  // A failed count is not "zero failures" — say so instead of reporting a
  // green window built on a query that never ran. A 500 also surfaces the run
  // as failed in the Vercel cron dashboard.
  if (recent.error || base.error || recent.count == null || base.count == null) {
    console.error("[monitoring/error-rate] audit_log count failed", {
      recent: recent.error?.code ?? null,
      baseline: base.error?.code ?? null,
    });
    return NextResponse.json(
      { status: "error", ts: new Date(now).toISOString(), detail: "audit_log query failed" },
      { status: 500 },
    );
  }

  const recentCount = recent.count;
  const baseCount = base.count;
  const threshold = resolveThreshold();
  const verdict = evaluateFailureRate({ recentCount, baselineCount: baseCount, threshold });

  const result = {
    status: verdict.alarm ? ("warn" as const) : ("ok" as const),
    ts: new Date(now).toISOString(),
    cron: MONITOR_CRON,
    window: { recent_min: RECENT_WINDOW_MIN, baseline_min: BASELINE_WINDOW_MIN },
    counts: { recent: recentCount, baseline: baseCount },
    rates_per_min: { recent: verdict.recentRate, baseline: verdict.baselineRate },
    spike_ratio: verdict.spikeRatio === null ? null : Number(verdict.spikeRatio.toFixed(2)),
    baseline_empty: verdict.baselineEmpty,
    threshold,
    min_recent_events: MIN_RECENT_EVENTS,
  };

  if (verdict.alarm) {
    const slack = process.env.SLACK_ALERT_WEBHOOK;
    if (slack) {
      try {
        await fetch(slack, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: [
              `:rotating_light: *MONGOLZ failure-rate spike*`,
              `*recent:* ${recentCount} in ${RECENT_WINDOW_MIN}m  *baseline:* ${baseCount} in ${BASELINE_WINDOW_MIN}m` +
                (result.spike_ratio === null ? `  *baseline:* empty` : `  *spike:* ${result.spike_ratio}x`),
              `<https://aicctv.dev/audit?action=LOGIN_FAILED|Audit log>`,
            ].join("\n"),
          }),
        });
      } catch {
        // Network failure shouldn't break the monitor
      }
    }

    // Also write to audit_log so we have an in-system record
    await svc.from("audit_log").insert({
      action: "MONITOR_ALARM",
      detail: JSON.stringify(result),
    });
  }

  return NextResponse.json(result);
}
