DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='alerts' AND column_name='type') THEN
    ALTER TABLE public.alerts ADD COLUMN type text NOT NULL DEFAULT 'match';
    ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
      CHECK (type IN ('match', 'anomaly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='alerts' AND column_name='anomaly_z') THEN
    ALTER TABLE public.alerts ADD COLUMN anomaly_z real;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS alerts_type_created_idx
  ON public.alerts (type, created_at DESC);

CREATE OR REPLACE FUNCTION public.insert_anomaly_alert(
  p_camera_id uuid,
  p_camera_name text,
  p_bucket_start timestamptz,
  p_z real,
  p_observed bigint,
  p_baseline real
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dedup text;
  v_id uuid;
BEGIN
  v_dedup := 'anomaly:' || p_camera_id || ':' || to_char(p_bucket_start, 'YYYY-MM-DD-HH24');

  IF EXISTS (
    SELECT 1 FROM public.alerts
    WHERE type = 'anomaly' AND dedup_key = v_dedup
      AND created_at >= date_trunc('day', now())
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.alerts (
    type, camera_id, camera_name, similarity,
    suspect_name, dedup_key, anomaly_z, match_count
  ) VALUES (
    'anomaly', p_camera_id, p_camera_name,
    LEAST(1.0, abs(p_z) / 6.0)::real,
    'Anomaly: ' || p_observed || ' observed vs ' || p_baseline || ' baseline',
    v_dedup, p_z, p_observed
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_anomaly_alert(uuid, text, timestamptz, real, bigint, real) FROM PUBLIC, anon, authenticated;
