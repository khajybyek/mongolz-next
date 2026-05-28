-- Add blur_strategy column to recordings table.
-- Existing rows default to 'baked' (preserved behaviour: separate blurred MP4 + encrypted original).
-- New on_demand recordings derive the blurred view from the encrypted original at view-time.

ALTER TABLE public.recordings
  ADD COLUMN IF NOT EXISTS blur_strategy text NOT NULL DEFAULT 'baked';

ALTER TABLE public.recordings DROP CONSTRAINT IF EXISTS recordings_blur_strategy_check;

ALTER TABLE public.recordings
  ADD CONSTRAINT recordings_blur_strategy_check
  CHECK (blur_strategy IN ('baked', 'on_demand'));

COMMENT ON COLUMN public.recordings.blur_strategy IS
  'How the blurred playback view is produced. baked = blurred MP4 stored at storage_path (legacy). on_demand = derived from encrypted original at view-time via ML /recording/{id}/render-view (single source of truth).';
