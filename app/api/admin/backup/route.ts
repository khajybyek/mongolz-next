import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";

/**
 * Admin backup endpoint — assembles a JSON snapshot of the application's
 * operational tables PLUS a list of storage objects (without re-uploading
 * blob bytes; recordings/faces stay in the original buckets).
 *
 * Output: ZIP with one .json per table + manifest.txt + README.txt
 *
 * Audit-logged as BACKUP_DOWNLOAD. The ZIP body is streamed to the caller —
 * no copy is stored on the server.
 */

/**
 * Column allow-lists. Auth material (TOTP seeds, recovery-code hashes,
 * passkey public keys/counters) and outbound secrets (webhook signing
 * secrets, Slack/Discord URLs are bearer tokens) are deliberately NOT part
 * of a backup an admin can download: a backup that contains every admin's
 * TOTP seed is an account-takeover kit. Supabase PITR covers those rows.
 */
const TABLES: Record<string, string> = {
  profiles: "id, email, full_name, role, totp_enabled, is_super_admin, reveal_level, username, created_at, updated_at",
  cameras: "id, name, cam_type, enabled, consent_required, consent_text, mask_default, created_by, created_at",
  suspects: "id, name, image_path, notes, privacy_tier, created_by, created_at",
  alerts: "*",
  alert_rules: "*",
  audit_log: "*",
  recordings: "*",
  faces: "id, filename, image_path, camera_id, recording_id, detected_at, bbox, chain_index, crop_sealed, cluster_id, reviewed, review_label, reviewed_by, reviewed_at",
  reveal_jobs: "id, recording_id, method, suspect_id, face_id, face_ids, threshold, status, progress, output_path, output_duration_sec, error_message, requested_by, requested_email, approved_by, approved_email, approved_at, rejected_by, rejected_email, rejected_reason, rejected_at, reason, reveal_level, target_start_sec, target_end_sec, reauth_at, created_at, started_at, completed_at",
  webhooks: "id, name, kind, enabled, events, last_fired_at, last_status, fail_count, created_by, created_at",
  camera_permissions: "*",
  masking_schedules: "*",
  privacy_zones: "*",
  retention_policies: "*",
  clusters: "*",
  push_subscriptions: "id, user_id, enabled, ua, created_at",
};

const BUCKETS = [
  "recordings",
  "faces",
  "suspects",
  "alert-screenshots",
  "revealed",
] as const;

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  // Backup нь audit_log агуулагдсан тул TOTP step-up шаардана: comprised
  // admin session-аар audit мөрийг гадагшаа татах боломжгүй болгоно.
  if (!(await hasFreshReauth(auth.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401 });
  }

  const svc = createServiceClient();
  const zip = new JSZip();

  // 1) Schema dump (table rows as JSON)
  const summary: Record<string, number> = {};
  for (const [table, columns] of Object.entries(TABLES)) {
    const { data, error } = await svc
      .from(table as keyof typeof TABLES as never)
      .select(columns)
      .limit(50_000);
    if (error) {
      zip.file(`${table}.error.txt`, error.message);
      summary[table] = -1;
      continue;
    }
    zip.file(`tables/${table}.json`, JSON.stringify(data ?? [], null, 2));
    summary[table] = data?.length ?? 0;
  }

  // 2) Storage manifest (object names + sizes only)
  for (const bucket of BUCKETS) {
    const { data: objects, error } = await svc.storage
      .from(bucket)
      .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (error) {
      zip.file(`buckets/${bucket}.error.txt`, error.message);
      continue;
    }
    zip.file(
      `buckets/${bucket}.manifest.json`,
      JSON.stringify(
        (objects ?? []).map((o) => ({
          name: o.name,
          size: o.metadata?.size,
          created_at: o.created_at,
          updated_at: o.updated_at,
        })),
        null,
        2,
      ),
    );
  }

  // 3) README
  zip.file(
    "README.txt",
    [
      "MONGOLZ Security — Database & Storage backup",
      `Created: ${new Date().toISOString()}`,
      "",
      "tables/    — JSON row dumps (one file per table, up to 50K rows each;",
      "             auth material and outbound secrets are excluded by design)",
      "buckets/   — Storage object manifests (names + sizes; blob bytes NOT included)",
      "",
      "Row counts:",
      ...Object.entries(summary).map(([t, n]) => `  ${t.padEnd(25)} ${n}`),
      "",
      "To restore:",
      "  1. Recreate the schema via Supabase migrations (already in repo)",
      "  2. INSERT each table.json into its target",
      "  3. Re-upload encrypted blobs from your separate offline backup",
      "",
      "Storage blob bytes are NOT included — they are AES-256-GCM encrypted",
      "and live in Supabase Storage. Use point-in-time backup (Supabase",
      "Dashboard → Database → Backups) or the offline mirror script.",
    ].join("\n"),
  );

  const buf = await zip.generateAsync({ type: "uint8array" });

  // Audit
  try {
    await svc.from("audit_log").insert({
      action: "BACKUP_DOWNLOAD",
      detail: `${(buf.length / 1024).toFixed(1)} KB, ${Object.keys(TABLES).length} tables, ${BUCKETS.length} buckets`,
      user_id: auth.user.id,
      user_email: auth.user.email,
    });
  } catch {}

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mongolz-backup-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
