-- Alert rules: per-admin configurable thresholds + dedup windows.
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Match criteria
  suspect_id uuid REFERENCES public.suspects(id) ON DELETE CASCADE, -- null = applies to all suspects
  camera_id uuid REFERENCES public.cameras(id) ON DELETE CASCADE,   -- null = applies to all cameras
  min_similarity numeric(4,3) NOT NULL DEFAULT 0.45,
  -- Dedup: collapse repeated matches into 1 alert within window
  dedup_window_sec int NOT NULL DEFAULT 300,  -- 5 min default
  -- Burst: require N matches within burst window before firing (anti-noise)
  burst_count int NOT NULL DEFAULT 1,
  burst_window_sec int NOT NULL DEFAULT 60,
  -- Quiet hours (optional) — HH:MM in Asia/Seoul local time
  quiet_from text,  -- e.g. "23:00"
  quiet_to text,    -- e.g. "07:00"
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS alert_rules_suspect_idx ON public.alert_rules(suspect_id) WHERE suspect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alert_rules_camera_idx ON public.alert_rules(camera_id) WHERE camera_id IS NOT NULL;

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_rules: admin only" ON public.alert_rules
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Per-alert metadata: which rule fired it + dedup grouping key
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES public.alert_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dedup_key text,
  ADD COLUMN IF NOT EXISTS match_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS alerts_dedup_key_idx ON public.alerts(dedup_key) WHERE dedup_key IS NOT NULL;

COMMENT ON TABLE public.alert_rules IS 'Admin-configurable alerting rules: thresholds, dedup windows, quiet hours, burst smoothing.';
COMMENT ON COLUMN public.alerts.dedup_key IS 'suspect_id + camera_id + window_bucket — groups repeated matches into one row.';
COMMENT ON COLUMN public.alerts.match_count IS 'How many raw matches collapsed into this alert.';;
