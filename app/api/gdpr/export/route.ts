import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchAllPaged, type PagedResult } from "@/lib/paged-fetch";
import { REVEAL_JOB_SUBJECT_COLUMNS } from "@/lib/reveal-job-columns";
import { log } from "@/lib/log";

/**
 * GDPR / PIPA — subject data export.
 *
 * Returns a ZIP containing the data the system holds about the calling user
 * (file list in GDPR_EXPORT_FILES below, repeated in the ZIP's README.txt).
 *
 * Only the caller's own data — admins use a separate export for other users.
 * This route reads with the service role, so the ONLY thing that scopes a
 * query to the caller is its user filter: every query below carries one, and
 * every query names its columns (never `*`) so credentials, third-party
 * biometric templates and internal storage keys cannot ride along.
 *
 * PostgREST returns at most max_rows (1000) per request, so every list is
 * paged; a list that hits its cap is named in README.txt as truncated.
 */

/** Per-file row ceiling. */
const CAP = 10_000;

/**
 * Rows that name the caller as their author / actor. One query each, always
 * filtered on the caller's id in `column`; `select` never includes secrets
 * (webhook url / signing secret), biometric templates or storage keys.
 */
const AUTHORED = [
  { file: "incidents.json", what: "incidents you created, resolved or are assigned to", table: "incidents", select: "id, title, status, priority, created_by, resolved_by, assignee_id, created_at, updated_at, resolved_at", or: ["created_by", "resolved_by", "assignee_id"], order: "created_at" },
  { file: "incident_events.json", what: "incident timeline events you performed", table: "incident_events", select: "id, incident_id, event_type, created_at", column: "actor_id", order: "created_at" },
  { file: "incident_alerts.json", what: "alerts you attached to incidents", table: "incident_alerts", select: "incident_id, alert_id, added_at", column: "added_by", order: "added_at" },
  { file: "incident_faces.json", what: "faces you attached to incidents (ids only)", table: "incident_faces", select: "incident_id, face_id, added_at", column: "added_by", order: "added_at" },
  { file: "incident_recordings.json", what: "recordings you attached to or released from incidents", table: "incident_recordings", select: "id, incident_id, recording_id, camera_name, clip_start_sec, clip_end_sec, legal_hold, note, added_by, added_at, hold_released_by, hold_released_at", or: ["added_by", "hold_released_by"], order: "added_at" },
  { file: "evidence_exports.json", what: "evidence packages you exported", table: "incident_evidence_exports", select: "id, incident_id, file_count, package_bytes, manifest_sha256, created_at", column: "created_by", order: "created_at" },
  { file: "face_reviews.json", what: "face review labels you assigned (ids only, no crops or templates)", table: "faces", select: "id, review_label, reviewed_at", column: "reviewed_by", order: "reviewed_at" },
  { file: "alert_rules.json", what: "alert rules you created", table: "alert_rules", select: "id, name, enabled, suspect_id, camera_id, min_similarity, created_at", column: "created_by", order: "created_at" },
  { file: "privacy_zones.json", what: "privacy zones you created", table: "privacy_zones", select: "id, name, camera_id, enabled, reason, created_at", column: "created_by", order: "created_at" },
  { file: "masking_schedules.json", what: "masking schedules you created", table: "masking_schedules", select: "id, camera_id, window_mode, starts_at, ends_at, weekdays, note, created_at", column: "created_by", order: "created_at" },
  { file: "webhooks.json", what: "webhooks you created (url and signing secret omitted)", table: "webhooks", select: "id, name, kind, enabled, events, created_at", column: "created_by", order: "created_at" },
  { file: "retention_policies.json", what: "retention policies you last changed", table: "retention_policies", select: "resource, retention_days, enabled, updated_at", column: "updated_by", order: "updated_at" },
] as const satisfies ReadonlyArray<{
  file: string;
  what: string;
  table: string;
  select: string;
  order: string;
} & ({ column: string } | { or: readonly string[] })>;

const GDPR_EXPORT_FILES = [
  ["profile.json", "profile row (TOTP secrets redacted)"],
  ["audit_log.json", "actions logged by/about this user"],
  ["alerts.json", "alerts you labeled, acknowledged or closed (with your notes)"],
  ["reveal_jobs.json", "reveal jobs you requested/approved/rejected (no biometric templates of revealed persons)"],
  ["camera_permissions.json", "explicit camera access rows"],
  ["web_vitals.json", "page-performance measurements from your browser sessions"],
  ["passkeys.json", "registered passkeys (public keys and counters omitted)"],
  ["push_subscriptions.json", "browser push subscriptions (endpoint and keys omitted)"],
  ["face_search_presets.json", "saved face-search presets"],
  ["upload_jobs.json", "recording uploads you started"],
  ...AUTHORED.map((a) => [a.file, a.what] as const),
] as const;

export async function GET() {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const { user } = auth;

  const svc = createServiceClient();
  const me = user.id;

  const [
    profile,
    audit,
    auditByEmail,
    labeled,
    reveal,
    perms,
    vitals,
    passkeys,
    push,
    presets,
    uploads,
  ] = await Promise.all([
    svc
      .from("profiles")
      .select("id, email, username, full_name, role, reveal_level, is_super_admin, totp_enabled, created_at, updated_at")
      .eq("id", me)
      .maybeSingle(),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("audit_log")
          .select("id, action, detail, user_email, ip, created_at")
          .eq("user_id", me)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    user.email
      ? fetchAllPaged(
          (from, to) =>
            svc
              .from("audit_log")
              .select("id, action, detail, user_email, ip, created_at")
              .is("user_id", null)
              .eq("user_email", user.email)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(from, to),
          CAP,
        )
      : Promise.resolve(emptyResult()),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("alerts")
          .select(
            "id, suspect_name, similarity, camera_name, created_at, label, labeled_by, labeled_at, " +
              "state, acknowledged_by, acknowledged_at, closed_by, closed_at, note",
          )
          .or(`labeled_by.eq.${me},acknowledged_by.eq.${me},closed_by.eq.${me}`) // me: session uuid
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("reveal_jobs")
          .select(REVEAL_JOB_SUBJECT_COLUMNS)
          .or(`requested_by.eq.${me},approved_by.eq.${me},rejected_by.eq.${me}`) // user.id is a uuid from the session, not user input
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("camera_permissions")
          .select("id, camera_id, permission, created_at")
          .eq("user_id", me)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("web_vitals")
          .select("id, metric, value, rating, page, navigation_type, session_id, ua, ts")
          .eq("user_id", me)
          .order("ts", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("webauthn_credentials")
          .select("id, device_name, transports, created_at, last_used_at")
          .eq("user_id", me)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("push_subscriptions")
          .select("id, enabled, ua, created_at, last_used_at")
          .eq("user_id", me)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("face_search_presets")
          .select("id, name, camera_id, suspect_id, incident_id, from_at, to_at, match_threshold, min_confidence, recording_status, result_limit, created_at, updated_at")
          .eq("user_id", me)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
    fetchAllPaged(
      (from, to) =>
        svc
          .from("upload_jobs")
          .select("id, recording_id, camera_name, status, progress, attempts, error_message, created_at, updated_at, completed_at")
          .eq("requested_by", me)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      CAP,
    ),
  ]);

  const authored = await Promise.all(
    AUTHORED.map((a) =>
      fetchAllPaged((from, to) => {
        const base = svc.from(a.table as "incidents").select(a.select);
        const scoped =
          "or" in a
            ? base.or(a.or.map((c) => `${c}.eq.${me}`).join(",")) // me: session uuid
            : base.eq(a.column as "created_by", me);
        return scoped.order(a.order as "created_at", { ascending: false }).range(from, to);
      }, CAP),
    ),
  );

  // A partial file presented as the complete answer to an access request is
  // worse than no file: refuse and let the subject retry.
  const lists: Record<string, PagedResult<unknown>> = {
    "audit_log.json": mergeAudit(audit, auditByEmail),
    "alerts.json": labeled,
    "reveal_jobs.json": reveal,
    "camera_permissions.json": perms,
    "web_vitals.json": vitals,
    "passkeys.json": passkeys,
    "push_subscriptions.json": push,
    "face_search_presets.json": presets,
    "upload_jobs.json": uploads,
    ...Object.fromEntries(AUTHORED.map((a, i) => [a.file, authored[i]!])),
  };
  const failed = Object.entries(lists).filter(([, r]) => r.error).map(([name]) => name);
  if (profile.error || failed.length > 0) {
    log.error("gdpr export: query failed", { files: failed, profile: Boolean(profile.error) });
    return NextResponse.json({ error: "export_failed" }, { status: 503 });
  }

  // The TOTP secret and recovery-code hashes are never selected; the markers
  // tell the subject that they exist and were withheld on purpose.
  const safeProfile = profile.data
    ? { ...profile.data, totp_secret: "<redacted>", totp_recovery_codes: "<redacted>" }
    : null;

  const truncated = Object.entries(lists).filter(([, r]) => r.truncated).map(([name]) => name);

  const zip = new JSZip();
  zip.file(
    "README.txt",
    [
      "MONGOLZ Security — GDPR / PIPA data export",
      `Subject: ${user.email}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "Files:",
      ...GDPR_EXPORT_FILES.map(([name, what]) => `  ${name.padEnd(25)} — ${what}`),
      "",
      truncated.length > 0
        ? `Truncated at ${CAP} rows (newest first): ${truncated.join(", ")}`
        : "Every file is complete. The files above are the full scope of this export.",
      "",
      "Right to erasure:",
      "  /api/gdpr/delete  (POST) — request account deletion.",
    ].join("\n"),
  );
  zip.file("profile.json", JSON.stringify(safeProfile, null, 2));
  for (const [name, result] of Object.entries(lists)) {
    zip.file(name, JSON.stringify(result.rows, null, 2));
  }

  const buf = await zip.generateAsync({ type: "uint8array" });

  // Audit the export itself
  try {
    await svc.from("audit_log").insert({
      action: "GDPR_EXPORT",
      detail: `Subject ${user.email} downloaded their data (${(buf.length / 1024).toFixed(1)} KB)`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mongolz-gdpr-${user.email}-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
      "X-Export-Truncated": truncated.length > 0 ? "1" : "0",
    },
  });
}

function emptyResult<R>(): PagedResult<R> {
  return { rows: [], truncated: false, error: null };
}

/** Rows keyed to the user id, then rows that only carry the e-mail. */
function mergeAudit<R>(byId: PagedResult<R>, byEmail: PagedResult<R>): PagedResult<R> {
  return {
    rows: [...byId.rows, ...byEmail.rows],
    truncated: byId.truncated || byEmail.truncated,
    error: byId.error ?? byEmail.error,
  };
}
