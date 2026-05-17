-- Cleanups from the Supabase performance advisor (2026-05-17).
--
--   1. Drop the duplicate `idx_reveal_jobs_status` (we already keep
--      `reveal_jobs_status_idx` which is identical).
--   2. Add covering indexes for FK columns that didn't have one. Each FK is
--      `user_id`-shaped, so the indexes are tiny (one btree on a uuid column)
--      but they save sequential scans on cascade-style joins (`profiles` →
--      `created_by`, etc.) and on RLS predicate evaluation when filtering by
--      `created_by = auth.uid()`.
--
-- All adds are `IF NOT EXISTS` so reruns are safe.

-- 1. Duplicate index drop
DROP INDEX IF EXISTS public.idx_reveal_jobs_status;

-- 2. FK covering indexes (one per advisor-flagged FK)
CREATE INDEX IF NOT EXISTS alert_rules_created_by_idx
  ON public.alert_rules (created_by);

CREATE INDEX IF NOT EXISTS alerts_labeled_by_idx
  ON public.alerts (labeled_by);

CREATE INDEX IF NOT EXISTS alerts_rule_id_idx
  ON public.alerts (rule_id);

CREATE INDEX IF NOT EXISTS camera_permissions_created_by_idx
  ON public.camera_permissions (created_by);

CREATE INDEX IF NOT EXISTS masking_schedules_created_by_idx
  ON public.masking_schedules (created_by);

CREATE INDEX IF NOT EXISTS retention_policies_updated_by_idx
  ON public.retention_policies (updated_by);

CREATE INDEX IF NOT EXISTS reveal_jobs_approved_by_idx
  ON public.reveal_jobs (approved_by);

CREATE INDEX IF NOT EXISTS reveal_jobs_rejected_by_idx
  ON public.reveal_jobs (rejected_by);

CREATE INDEX IF NOT EXISTS webhooks_created_by_idx
  ON public.webhooks (created_by);
