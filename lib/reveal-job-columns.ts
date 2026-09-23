/**
 * reveal_jobs columns a person may be shown about a job they took part in.
 *
 * Mirrors the column-level SELECT grant for `authenticated` (checked live
 * 2026-09-23). Deliberately left out:
 *   - query_embedding / query_embeddings / reference_sealed — ArcFace
 *     templates of the (third-party) people the job revealed;
 *   - output_path — internal storage key, served only through the gated
 *     /api/reveal/[jobId]/output route;
 *   - worker_attempts / worker_lease_token / worker_lease_until — worker
 *     bookkeeping.
 *
 * Service-role reads that hand rows to a person (the GDPR export) must select
 * this list, never `*`.
 */
export const REVEAL_JOB_SUBJECT_COLUMNS =
  "id, recording_id, method, threshold, status, progress, output_duration_sec, error_message, requested_by, requested_email, reauth_at, created_at, started_at, completed_at, face_id, face_ids, suspect_id, reason, approval_required, approved_by, approved_email, approved_at, rejected_by, rejected_email, rejected_at, rejected_reason, target_start_sec, target_end_sec, reveal_level, request_scope";
