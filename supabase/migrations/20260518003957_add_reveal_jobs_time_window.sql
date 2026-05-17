-- Time-bounded reveal — "principle of least privilege" for the reveal flow.
--
-- A reveal job can now optionally restrict its scope to a [start_sec, end_sec]
-- window within the recording. Frames OUTSIDE this range are emitted with
-- ALL faces masked (no reveal), even if the target embedding matches. Frames
-- INSIDE the range follow the existing selective-reveal logic.
--
-- Both columns default to NULL, meaning "whole recording" — that's the
-- previous behaviour, so existing rows / clients keep working unchanged.
--
-- ML service (reveal_job.py) consumes these on the next deploy.

ALTER TABLE public.reveal_jobs
  ADD COLUMN IF NOT EXISTS target_start_sec real,
  ADD COLUMN IF NOT EXISTS target_end_sec   real;

-- Range must be sane when both are set.
ALTER TABLE public.reveal_jobs
  DROP CONSTRAINT IF EXISTS reveal_jobs_time_window_chk;

ALTER TABLE public.reveal_jobs
  ADD CONSTRAINT reveal_jobs_time_window_chk
  CHECK (
    (target_start_sec IS NULL AND target_end_sec IS NULL)
    OR (target_start_sec IS NOT NULL AND target_end_sec IS NOT NULL
        AND target_start_sec >= 0
        AND target_end_sec > target_start_sec)
  );

COMMENT ON COLUMN public.reveal_jobs.target_start_sec IS
  'Reveal scope window start (seconds from recording start). NULL = from 0s.';
COMMENT ON COLUMN public.reveal_jobs.target_end_sec IS
  'Reveal scope window end (seconds). NULL = to recording end. End > start.';
