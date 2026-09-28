/**
 * What /api/admin/backup exports, and — just as important — what it leaves
 * out and why. Kept outside the route file so the drift test
 * (__tests__/backup-tables.test.ts) can hold every table and column in
 * lib/database.generated.ts against these lists: a new table or column must
 * be exported or excluded here with a reason, or CI fails. Before this test,
 * whole tables and two faces columns were silently missing while the
 * manifest said `complete: true`.
 */

export type TableSpec = {
  /** Base allow-list — never contains biometrics or auth material. */
  columns: string;
  /** Primary key, used to page deterministically. */
  pk?: string;
  /** Columns added only by ?include_biometrics=1. */
  biometric?: string;
  /** NOT NULL columns that only the biometric flag brings back. */
  biometricRequired?: string[];
  /** NOT NULL columns this artifact never carries, at any setting. */
  omittedRequired?: string[];
  note?: string;
};

/**
 * Column allow-lists. Auth material (TOTP seeds, recovery-code hashes,
 * passkey public keys/counters) and outbound secrets (webhook signing
 * secrets, Slack/Discord URLs are bearer tokens) are deliberately NOT part
 * of a backup an admin can download: a backup that contains every admin's
 * TOTP seed is an account-takeover kit. Supabase PITR covers those rows.
 */
export const BACKUP_TABLES: Record<string, TableSpec> = {
  profiles: {
    columns:
      "id, email, full_name, role, totp_enabled, is_super_admin, reveal_level, username, created_at, updated_at",
    note:
      "TOTP seeds, recovery-code hashes and passkeys are never exported — operators re-enrol 2FA after a restore. profiles.id references auth.users, which this artifact cannot recreate.",
  },
  cameras: {
    columns:
      "id, name, cam_type, url, enabled, consent_required, consent_text, privacy_default, privacy_loosened_at, created_by, created_at",
    note:
      "url is an AES-256-GCM ciphertext produced with CAMERA_URL_KEY. It is exported because the column is NOT NULL and cameras are unreachable without it; it stays unreadable unless the restore environment holds that key (or CAMERA_URL_KEY_PREV).",
  },
  suspects: {
    columns: "id, name, image_path, notes, privacy_tier, created_by, created_at",
    biometric: "embedding",
    biometricRequired: ["embedding"],
    note: "embedding is a 512-dim ArcFace vector — biometric personal data, and NOT NULL.",
  },
  alerts: { columns: "*" },
  alert_rules: { columns: "*" },
  audit_log: { columns: "*" },
  recordings: { columns: "*" },
  recording_privacy_spans: {
    columns: "*",
    note: "Capture-time privacy facts (ADR 0012) — the reveal job refuses to un-mask these spans, so they must survive a restore. id is an identity key the restore tool regenerates; nothing references it. client_span_id is the natural key the restore upserts on, so a second run does not duplicate spans.",
  },
  faces: {
    columns:
      "id, filename, image_path, camera_id, recording_id, detected_at, bbox, source_offset_sec, detection_confidence, chain_index, crop_sealed, cluster_id, reviewed, review_label, reviewed_by, reviewed_at",
    biometric: "embedding, embedding_sealed",
    biometricRequired: ["embedding"],
    note: "embedding is a 512-dim ArcFace vector — biometric personal data, and NOT NULL.",
  },
  reveal_jobs: {
    columns:
      "id, recording_id, method, suspect_id, face_id, face_ids, threshold, status, progress, output_path, output_duration_sec, error_message, requested_by, requested_email, approved_by, approved_email, approved_at, approval_required, rejected_by, rejected_email, rejected_reason, rejected_at, reason, request_scope, reveal_level, target_start_sec, target_end_sec, reauth_at, created_at, started_at, completed_at",
    biometric: "query_embedding, query_embeddings, reference_sealed",
    note: "query embeddings are the biometric probe of a reveal request (nullable — a restore succeeds without them).",
  },
  incidents: { columns: "*" },
  incident_alerts: { columns: "*", pk: "incident_id" },
  incident_faces: { columns: "*", pk: "incident_id" },
  incident_events: {
    columns: "*",
    note: "The restore tool regenerates this identity key; no table references incident_events.id.",
  },
  incident_recordings: { columns: "*" },
  incident_evidence_exports: { columns: "*" },
  face_search_presets: { columns: "*" },
  edge_agents: { columns: "*" },
  edge_ingest_events: { columns: "*" },
  webhooks: {
    columns:
      "id, name, kind, enabled, events, last_fired_at, last_status, fail_count, created_by, created_at",
    omittedRequired: ["url"],
    note:
      "url (a Slack/Discord bearer URL) and the HMAC secret are credentials and are never exported — recreate destinations by hand on /webhooks.",
  },
  camera_permissions: { columns: "*" },
  masking_schedules: { columns: "*" },
  privacy_zones: { columns: "*" },
  retention_policies: { columns: "*", pk: "resource" },
  clusters: { columns: "*" },
  push_subscriptions: {
    columns: "id, user_id, enabled, ua, last_used_at, created_at",
    omittedRequired: ["endpoint", "p256dh", "auth"],
    note:
      "endpoint and the p256dh/auth keys are push credentials and are never exported — users re-subscribe from their browser.",
  },
};

/**
 * Columns of an explicitly listed table that the backup never carries, with
 * the reason. Biometric columns live in `biometric` above instead.
 */
export const BACKUP_EXCLUDED_COLUMNS: Record<string, Record<string, string>> = {
  profiles: {
    totp_secret: "TOTP seed — auth material",
    totp_recovery_codes: "recovery-code hashes — auth material",
  },
  webhooks: {
    url: "Slack/Discord bearer URL — credential",
    signing_secret: "HMAC signing secret — credential",
  },
  push_subscriptions: {
    endpoint: "push endpoint — credential",
    p256dh: "push key — credential",
    auth: "push key — credential",
  },
  reveal_jobs: {
    worker_lease_token: "in-flight ML worker lease — meaningless in another project",
    worker_lease_until: "in-flight ML worker lease — meaningless in another project",
    worker_attempts: "in-flight ML worker retry counter (defaults to 0)",
  },
};

/**
 * Public tables deliberately NOT in the backup, with the reason. Listed in
 * manifest.json and README.txt so "complete" means "complete except these".
 */
export const BACKUP_NOT_EXPORTED: Record<string, string> = {
  camera_sessions:
    "ML capture registry (RTSP URL sealed with ML_ENCRYPTION_KEY); rebuilt when cameras are started again",
  upload_jobs: "transient upload-processing queue",
  retention_deletion_queue: "in-flight storage deletion queue (service role only)",
  uptime_checks: "uptime monitor history (operational telemetry)",
  web_vitals: "browser performance telemetry",
  totp_used_codes: "TOTP replay cache — auth material",
  webauthn_challenges: "short-lived passkey challenges — auth material",
  webauthn_credentials: "passkeys — auth material; operators re-enrol",
};

/**
 * Storage manifests are derived from the DATABASE, not from a Storage
 * listing: every object lives under a camera/recording prefix, so
 * storage.list("") only ever returned the top-level folder names (the audit
 * found 0 of 106 objects listed). These are the columns that own a path.
 * The `.enc` suffix rule mirrors the retention trigger in
 * supabase/migrations/20260907101000_retention_deletion_queue.sql.
 */
export type PathSource = {
  table: string;
  select: string;
  pk?: string;
  /** Human-readable provenance recorded in the manifest. */
  from: string;
  paths: (row: Record<string, unknown>) => (string | null | undefined)[];
};

export const BACKUP_STORAGE_SOURCES: Record<string, PathSource[]> = {
  recordings: [
    {
      table: "recordings",
      select: "id, storage_path, original_path",
      from: "recordings.storage_path + recordings.original_path",
      paths: (r) => [r.storage_path as string, r.original_path as string | null],
    },
  ],
  faces: [
    {
      table: "faces",
      select: "id, image_path, crop_sealed",
      from: "faces.image_path (+ '.enc' when crop_sealed)",
      paths: (r) => [r.crop_sealed ? `${r.image_path as string}.enc` : (r.image_path as string)],
    },
  ],
  suspects: [
    {
      table: "suspects",
      select: "id, image_path",
      from: "suspects.image_path",
      paths: (r) => [r.image_path as string],
    },
  ],
  "alert-screenshots": [
    {
      table: "alerts",
      select: "id, screenshot_path",
      from: "alerts.screenshot_path",
      paths: (r) => [r.screenshot_path as string | null],
    },
  ],
  revealed: [
    {
      table: "reveal_jobs",
      select: "id, output_path",
      from: "reveal_jobs.output_path",
      paths: (r) => [r.output_path as string | null],
    },
  ],
};

/**
 * Rows from a backup taken before 20260928100000_privacy_schedules_enforced
 * (ADR 0012) still carry the retired model: `cameras.mask_default` (column
 * dropped) and `masking_schedules.window_mode` 'masked' | 'revealed' (now
 * rejected by the CHECK). Map them exactly as the migration mapped the live
 * rows so an older artifact stays restorable: mask_default is dropped (every
 * camera became privacy_default 'standard', the column default), masked →
 * private, revealed → standard. Current rows pass through unchanged.
 */
export function upgradeLegacyBackupRows(
  table: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (table === "cameras") {
    return rows.map(({ mask_default: _retired, ...row }) => row);
  }
  if (table === "masking_schedules") {
    const legacy: Record<string, string> = { masked: "private", revealed: "standard" };
    return rows.map((row) =>
      typeof row.window_mode === "string" && row.window_mode in legacy
        ? { ...row, window_mode: legacy[row.window_mode] }
        : row,
    );
  }
  return rows;
}
