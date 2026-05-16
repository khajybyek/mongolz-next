import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Error-rate monitor.
 *
 * Compares LOGIN_FAILED + TOTP_LOGIN_FAILED + REVEAL_REJECT counts in the
 * last 5 minutes against the prior hour's baseline. If the ratio exceeds
 * SENTRY_ERROR_RATE_THRESHOLD (default 0.10 = 10%), fires a Slack webhook.
 *
 * Designed to run hourly via Vercel Cron (or external scheduler).
 * Auth: Bearer token must equal MONITORING_CRON_SECRET (set in env).
 *
 * Sentry: a corresponding Sentry alert rule should also exist on the
 * project — this endpoint is the in-system signal pathway.
 */
const FAILURE_ACTIONS = ["LOGIN_FAILED", "TOTP_LOGIN_FAILED", "LOGIN_BLOCKED"];

function authorized(req: NextRequest): boolean {
  const sec = process.env.MONITORING_CRON_SECRET;
  if (!sec) return true; // unset → open (dev/staging); set in prod
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === sec;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const now = Date.now();
  const window5m = new Date(now - 5 * 60 * 1000).toISOString();
  const window1h = new Date(now - 60 * 60 * 1000).toISOString();

  const [recent, base] = await Promise.all([
    svc
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .in("action", FAILURE_ACTIONS)
      .gte("created_at", window5m),
    svc
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .in("action", FAILURE_ACTIONS)
      .gte("created_at", window1h)
      .lt("created_at", window5m),
  ]);

  const recentCount = recent.count ?? 0;
  const baseCount = base.count ?? 0;
  // Normalise per minute
  const recentRate = recentCount / 5;
  const baseRate = baseCount / 55;

  const threshold = Number(process.env.SENTRY_ERROR_RATE_THRESHOLD ?? "0.10");
  const spike = baseRate > 0 ? recentRate / baseRate : recentRate > threshold ? Infinity : 0;
  const alarm = spike >= 1 + threshold && recentCount >= 3;

  const status: "ok" | "warn" = alarm ? "warn" : "ok";
  const result = {
    status,
    ts: new Date(now).toISOString(),
    window: { recent_min: 5, baseline_min: 55 },
    counts: { recent: recentCount, baseline: baseCount },
    rates_per_min: { recent: recentRate, baseline: baseRate },
    spike_ratio: Number(spike.toFixed(2)),
    threshold,
  };

  if (alarm) {
    const slack = process.env.SLACK_ALERT_WEBHOOK;
    if (slack) {
      try {
        await fetch(slack, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: [
              `:rotating_light: *MONGOLZ failure-rate spike*`,
              `*spike ratio:* ${result.spike_ratio}x  *recent:* ${recentCount}/5m  *baseline:* ${baseCount}/55m`,
              `<https://mongolz.vercel.app/audit?action=LOGIN_FAILED|Audit log>`,
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
