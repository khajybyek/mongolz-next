import { notifyOpsAlarm } from "@/lib/notify";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/auth/cron";

/**
 * Daily backup verification cron (03:00 UTC ≈ 12:00 KST).
 *
 * Picks a random sample of recently-uploaded encrypted recordings, sends each
 * to the ML service's /reveal/verify-blob endpoint, and asserts that the
 * decrypt smoke test succeeds.
 *
 * Auth: Vercel Cron passes `Authorization: Bearer ${CRON_SECRET}` automatically
 * when the env var is set on the project.
 */

const SAMPLE_SIZE = 5;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const mlUrl = process.env.NEXT_PUBLIC_ML_SERVICE_URL;
  const token = process.env.ML_SERVICE_TOKEN;

  if (!mlUrl || !token) {
    return NextResponse.json(
      { error: "ML service not configured" },
      { status: 503 },
    );
  }

  const { data: candidates } = await svc
    .from("recordings")
    .select("id, storage_path, original_path, encrypted")
    .eq("encrypted", true)
    .order("started_at", { ascending: false })
    .limit(50);

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ status: "skipped", reason: "no encrypted recordings" });
  }

  // Random sample
  const sample = candidates
    .map((c) => ({ c, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, SAMPLE_SIZE)
    .map((s) => s.c);

  type Result = { recording_id: string; ok: boolean; error?: string; ms?: number };
  const results: Result[] = [];

  for (const rec of sample) {
    const path = rec.original_path ?? rec.storage_path;
    if (!path) continue;
    const t0 = Date.now();
    try {
      const res = await fetch(`${mlUrl}/reveal/verify-blob`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ recording_id: rec.id, storage_path: path }),
      });
      const body = await res.json().catch(() => ({}));
      results.push({
        recording_id: rec.id,
        ok: res.ok && body?.ok === true,
        error: !res.ok ? body?.error ?? `HTTP ${res.status}` : undefined,
        ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        recording_id: rec.id,
        ok: false,
        error: e instanceof Error ? e.message : "fetch failed",
        ms: Date.now() - t0,
      });
    }
  }

  const failures = results.filter((r) => !r.ok);
  const status = failures.length === 0 ? "ok" : "fail";

  await svc.from("audit_log").insert({
    action: "BACKUP_VERIFY",
    detail: JSON.stringify({
      sample_size: results.length,
      failures: failures.length,
      results,
    }),
  });

  if (failures.length > 0) {
    // Undecryptable backups must reach an operator, not only /audit.
    await notifyOpsAlarm({
      action: "BACKUP_VERIFY_FAILED",
      detail:
        `${failures.length}/${results.length} sampled recordings failed to decrypt: ` +
        failures.map((f) => f.recording_id.slice(0, 8)).join(", "),
    });
  }

  if (failures.length > 0 && process.env.SLACK_ALERT_WEBHOOK) {
    try {
      await fetch(process.env.SLACK_ALERT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:warning: *MONGOLZ backup verify FAILED* ${failures.length}/${results.length}`,
          attachments: [
            {
              text: failures.map((f) => `${f.recording_id.slice(0, 8)}: ${f.error}`).join("\n"),
              color: "danger",
            },
          ],
        }),
      });
    } catch {}
  }

  return NextResponse.json({ status, results });
}
