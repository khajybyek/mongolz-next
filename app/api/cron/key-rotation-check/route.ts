import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/auth/cron";

/**
 * Weekly key-rotation reminder cron.
 *
 * Reads `audit_log` for the most recent `<NAME>_ROTATED` event per key and
 * reports the ones past their cadence. `scripts/rotate-keys.ts` writes that
 * row — with the service role — at the end of every successful rotation, and
 * `--mark-rotated` writes it for the two keys that can only be rotated by
 * hand. Before that existed nothing ever wrote a `*_ROTATED` row, so this
 * cron reported all seven keys overdue forever and taught its readers to
 * ignore it (17 `KEY_ROTATION_DUE` rows, zero of them actionable).
 *
 * A key with no rotation row yet is dated from the deployment's own
 * inception (the oldest audit row) instead of being called overdue on day
 * one: on a fresh install nothing is overdue, and once the deployment is
 * older than the cadence the warning appears and the operator can clear it by
 * actually rotating — `npm run rotate:keys -- --key=<NAME>` — or, for a key
 * rotated by hand, `--key=<NAME> --mark-rotated`.
 *
 * Does NOT auto-rotate: rotation needs operator review of which key changes
 * where (Vercel + Railway + Supabase). This is a calendar, not an executor.
 *
 * Schedule: `0 5 * * 1` (Mondays 05:00 UTC ≈ 14:00 KST).
 */

interface KeyPolicy {
  /** Audit events are `<name>_ROTATED`. */
  name: string;
  /** Target rotation cadence in days. */
  maxAgeDays: number;
}

/**
 * Keep in step with SPECS + MANUAL_KEYS in scripts/rotate-keys.ts. A name
 * here that neither of those can record is a warning nobody can ever clear —
 * which is the bug this file used to be.
 */
const POLICIES: KeyPolicy[] = [
  { name: "ML_SERVICE_TOKEN", maxAgeDays: 90 },
  { name: "ML_ENCRYPTION_KEY", maxAgeDays: 180 },
  { name: "CAMERA_URL_KEY", maxAgeDays: 180 },
  { name: "STREAM_TICKET_SECRET", maxAgeDays: 180 },
  { name: "REAUTH_COOKIE_SECRET", maxAgeDays: 180 },
  { name: "SESSION_PIN_SECRET", maxAgeDays: 180 },
  { name: "SUPABASE_SERVICE_ROLE_KEY", maxAgeDays: 365 },
];

/** Keys this deployment cannot rotate with the script (see MANUAL_KEYS). */
const MANUAL_ONLY = new Set(["ML_SERVICE_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]);

const DAY_MS = 24 * 3600_000;

type Basis = "rotation" | "inception" | "unknown";

interface KeyReport {
  name: string;
  last_rotated_at: string | null;
  /** Where `age_days` comes from: a recorded rotation, or first deploy. */
  basis: Basis;
  age_days: number | null;
  target_days: number;
  due: boolean;
  /** Exact command that clears this row. */
  remediation: string;
}

function buildReport(
  policies: KeyPolicy[],
  lastRotatedByKey: Record<string, string>,
  inceptionAt: string | null,
  nowMs: number,
): KeyReport[] {
  return policies.map((policy) => {
    const rotatedAt = lastRotatedByKey[policy.name];
    const basisAt = rotatedAt ?? inceptionAt ?? null;
    const basis: Basis = rotatedAt ? "rotation" : inceptionAt ? "inception" : "unknown";

    const parsed = basisAt ? Date.parse(basisAt) : NaN;
    const ageDays = Number.isFinite(parsed) ? Math.floor((nowMs - parsed) / DAY_MS) : null;

    // Unknown age is NOT "overdue": an empty audit log means a brand-new
    // deployment, and crying wolf on day one is how the previous version of
    // this cron made itself worthless.
    const due = ageDays !== null && ageDays >= policy.maxAgeDays;

    return {
      name: policy.name,
      last_rotated_at: rotatedAt ?? null,
      basis,
      age_days: ageDays,
      target_days: policy.maxAgeDays,
      due,
      remediation: MANUAL_ONLY.has(policy.name)
        ? `rotate by hand (RUNBOOK §4), then: npm run rotate:keys -- --key=${policy.name} --mark-rotated`
        : `npm run rotate:keys -- --key=${policy.name}`,
    };
  });
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const now = Date.now();

  // One round trip for every rotation record we care about, newest first.
  const { data: rotations, error: rotErr } = await svc
    .from("audit_log")
    .select("action, created_at")
    .in(
      "action",
      POLICIES.map((p) => `${p.name}_ROTATED`),
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (rotErr) {
    // Reporting "everything overdue" because the query failed would be the
    // same lie in a different costume.
    return NextResponse.json({ error: "audit_log unreadable", detail: rotErr.message }, { status: 500 });
  }

  const lastRotatedByKey: Record<string, string> = {};
  for (const row of rotations ?? []) {
    const name = String(row.action).replace(/_ROTATED$/, "");
    if (!(name in lastRotatedByKey)) lastRotatedByKey[name] = row.created_at as string;
  }

  // Deployment inception — the fallback age for a key never rotated yet.
  const { data: firstRow, error: incErr } = await svc
    .from("audit_log")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (incErr) {
    return NextResponse.json({ error: "audit_log unreadable", detail: incErr.message }, { status: 500 });
  }

  const inceptionAt = (firstRow?.created_at as string | undefined) ?? null;
  const report = buildReport(POLICIES, lastRotatedByKey, inceptionAt, now);
  const overdue = report.filter((r) => r.due);

  if (overdue.length > 0) {
    await svc.from("audit_log").insert({
      action: "KEY_ROTATION_DUE",
      detail: JSON.stringify({
        overdue_keys: overdue.map((r) => ({
          name: r.name,
          age_days: r.age_days,
          basis: r.basis,
          remediation: r.remediation,
        })),
        full_report: report,
      }),
    });

    // Optional Slack alert
    if (process.env.SLACK_ALERT_WEBHOOK) {
      try {
        const lines = overdue
          .map(
            (r) =>
              `• \`${r.name}\` — ${r.age_days}d ${
                r.basis === "inception" ? "since first deploy (never rotated)" : "old"
              } (target ${r.target_days}d) → \`${r.remediation}\``,
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

  return NextResponse.json({
    status: overdue.length === 0 ? "ok" : "due",
    inception_at: inceptionAt,
    report,
  });
}
