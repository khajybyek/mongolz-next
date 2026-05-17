ALTER TYPE public.reveal_status ADD VALUE IF NOT EXISTS 'pending_approval' BEFORE 'queued';
ALTER TYPE public.reveal_status ADD VALUE IF NOT EXISTS 'rejected';;
