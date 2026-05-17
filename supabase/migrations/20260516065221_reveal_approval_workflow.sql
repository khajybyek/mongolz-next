-- 4-eyes principle: reveal_jobs require a second admin's approval before run.
-- Status flow:  pending_approval → approved → queued → processing → done
--                                        ↘  rejected (terminal)

ALTER TABLE public.reveal_jobs
  ADD COLUMN IF NOT EXISTS reason             text,
  ADD COLUMN IF NOT EXISTS approval_required  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_email     text,
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_email     text,
  ADD COLUMN IF NOT EXISTS rejected_reason    text,
  ADD COLUMN IF NOT EXISTS rejected_at        timestamptz;

-- Extend job_status enum to include workflow states.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='pending_approval'
                   AND enumtypid = 'public.job_status'::regtype) THEN
    ALTER TYPE public.job_status ADD VALUE 'pending_approval' BEFORE 'queued';
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- enum may be named differently; skip silently
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='approved'
                   AND enumtypid = 'public.job_status'::regtype) THEN
    ALTER TYPE public.job_status ADD VALUE 'approved' AFTER 'pending_approval';
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='rejected'
                   AND enumtypid = 'public.job_status'::regtype) THEN
    ALTER TYPE public.job_status ADD VALUE 'rejected';
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_reveal_jobs_status ON public.reveal_jobs(status);

COMMENT ON COLUMN public.reveal_jobs.approval_required IS
  '4-eyes principle: when true, a different admin (not requested_by) must approve before run.';;
