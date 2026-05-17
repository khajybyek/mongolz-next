import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Weekly key-rotation reminder cron.
 *
 * Reads the audit_log for the most recent `*_ROTATED` event per key. If any
 * tracked key hasn't been rotated within its target interval, logs a
 * `KEY_ROTATION_DUE` audit row and (optionally) pings Slack.
 *
 * Does NOT auto-rotate — rotation requires operator review of which key is
 * being changed where (Vercel + Railway + Supabase). The cron is a calendar
 * reminder, not an executor.
 *
 * Schedule: `0 5 * * 1` (Mondays 05:00 UTC ≈ 14:00 KST).
 */

interface KeyPolicy {
  /** Name shown in audit log. Match `<NAME>_ROTATED` audit events. */
  name: string;
  /** Target rotation cadence in days. */
  maxAgeDays: number;
}

const POLICIES: KeyPolicy[] = [
  { name: "ML_SERVICE_TOKEN", maxAgeDays: 90 },
  { name: "ML_ENCRYPTION_KEY", maxAgeDays: 180 },
  { name: "CAMERA_URL_KEY", maxAgeDays: 180 },
  { name: "STREAM_TICKET_SECRET", maxAgeDays: 180 },
  { name: "REAUTH_COOKIE_SECRET", maxAgeDays: 180 },
  { name: "SESSION_PIN_SECRET", maxAgeDays: 180 },
  { name: "SUPABASE_SERVICE_ROLE_KEY", maxAgeDays: 365 },
];

function authorized(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET ?? process.env.MONITORING_CRON_SECRET;
  if (!sec) {
    // Fail-closed in production.
    return process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV !== "production";
  }
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === sec;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const now = Date.now();

  type Report = {
    name: string;
    last_rotated_at: string | null;
    age_days: number | null;
    target_days: number;
    due: boolean;
  };

  const report: Report[] = [];

  for (const policy of POLICIES) {
    const { data } = await svc
      .from("audit_log")
      .select("created_at")
      .eq("action", `${policy.name}_ROTATED`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastAt = data?.created_at as string | undefined;
    const ageDays = lastAt
      ? Math.floor((now - new Date(lastAt).getTime()) / (24 * 3600_000))
      : null;
    const due = ageDays === null || ageDays >= policy.maxAgeDays;

    report.push({
      name: policy.name,
      last_rotated_at: lastAt ?? null,
      age_days: ageDays,
      target_days: policy.maxAgeDays,
      due,
    });
  }

  const overdue = report.filter((r) => r.due);

  if (overdue.length > 0) {
    await svc.from("audit_log").insert({
      action: "KEY_ROTATION_DUE",
      detail: JSON.stringify({
        overdue_keys: overdue.map((r) => ({ name: r.name, age_days: r.age_days })),
        full_report: report,
      }),
    });

    // Optional Slack alert
    if (process.env.SLACK_ALERT_WEBHOOK) {
      try {
        const lines = overdue
          .map(
            (r) =>
              `• \`${r.name}\` — ${
                r.age_days === null ? "never rotated" : `${r.age_days}d old`
              } (target ${r.target_days}d)`,
          )
          .join("\n");
        await fetch(process.env.SLACK_ALERT_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `:key: *MONGOLZ key rotation reminder* — ${overdue.length} key(s) due:\n${lines}`,
          }),
        });
      } catch {
        // best-effort
      }
    }
  }

  return NextResponse.json({ status: overdue.length === 0 ? "ok" : "due", report });
}
