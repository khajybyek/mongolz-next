import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Recent scheduled-check alarms for /health: failed-login spikes
 * (MONITOR_ALARM), backup samples that failed to decrypt (BACKUP_VERIFY with
 * failures > 0) and overdue key rotations (KEY_ROTATION_DUE). They used to be
 * visible only by reading /audit. Read with the service role (audit_log RLS
 * limits what an admin token sees); only action names, dates, counts and key
 * names leave this route.
 */
const WINDOW_DAYS = 8; // the key-rotation check runs weekly

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await createServiceClient()
    .from("audit_log")
    .select("action, created_at, detail")
    .in("action", ["MONITOR_ALARM", "BACKUP_VERIFY", "KEY_ROTATION_DUE"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[health/ops]", error.message);
    return NextResponse.json({ status: "error", detail: "audit log unreadable" }, { status: 503 });
  }

  const findings: string[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const action = String(row.action);
    if (seen.has(action)) continue;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(String(row.detail ?? "null")) as Record<string, unknown> | null;
    } catch {
      parsed = null;
    }
    const day = String(row.created_at).slice(0, 10);
    // Rows are newest first: only the LATEST run of each check counts (a
    // passing backup verify clears an older failure).
    seen.add(action);
    if (action === "BACKUP_VERIFY") {
      const failures = Number(parsed?.failures ?? 0);
      if (!(failures > 0)) continue;
      findings.push(`backup verify ${day}: ${failures}/${Number(parsed?.sample_size ?? 0)} failed`);
    } else if (action === "KEY_ROTATION_DUE") {
      const keys = Array.isArray(parsed?.overdue_keys)
        ? (parsed!.overdue_keys as Array<{ name?: unknown; age_days?: unknown }>)
            .map((k) => `${String(k.name)} ${Number(k.age_days)}d`)
            .join(", ")
        : "";
      findings.push(`key rotation due ${day}${keys ? `: ${keys}` : ""}`);
    } else {
      const counts = parsed?.counts as { recent?: unknown } | undefined;
      findings.push(`failed sign-in spike ${day}${counts?.recent != null ? `: ${Number(counts.recent)}` : ""}`);
    }
  }

  if (findings.length === 0) {
    return NextResponse.json({ status: "ok", detail: `no alarms in ${WINDOW_DAYS} days` });
  }
  // 200 + degraded: the checks ran and found something to act on.
  return NextResponse.json({ status: "degraded", detail: findings.join(" · ").slice(0, 400) });
}
