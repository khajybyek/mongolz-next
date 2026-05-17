-- Group multiple chunked recordings into one logical session.
ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS chunk_index integer,
  ADD COLUMN IF NOT EXISTS is_chunk boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_recordings_session ON public.recordings(session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.recordings.session_id IS
  'Groups chunked recordings (long sessions split into N parts). NULL = standalone.';
COMMENT ON COLUMN public.recordings.chunk_index IS
  '0-based chunk position within the session. NULL for standalone.';
COMMENT ON COLUMN public.recordings.is_chunk IS
  'True when this row is a chunk of a larger session, false for standalone recordings.';;
