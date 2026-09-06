-- Add explicit private.is_admin() gate to the two new RPCs.
-- Lint will still flag them as SECURITY DEFINER-callable by authenticated
-- (same intentional pattern as match_suspects, match_faces, camera_trail).
CREATE OR REPLACE FUNCTION public.camera_anomaly_scores(
  p_window_hours int DEFAULT 24,
  p_baseline_days int DEFAULT 28
)
RETURNS TABLE (
  camera_id uuid,
  camera_name text,
  bucket_start timestamptz,
  observed bigint,
  baseline_median real,
  baseline_mad real,
  z_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH params AS (
    SELECT p_window_hours::int AS lookback_h, p_baseline_days::int AS baseline_d
  ),
  recent AS (
    SELECT
      f.camera_id,
      date_trunc('hour', f.detected_at) AS bucket,
      EXTRACT(dow FROM f.detected_at)::int AS dow,
      EXTRACT(hour FROM f.detected_at)::int AS hod,
      count(*) AS cnt
    FROM public.faces f, params p
    WHERE f.camera_id IS NOT NULL
      AND f.detected_at >= now() - make_interval(hours => p.lookback_h)
    GROUP BY f.camera_id, bucket, dow, hod
  ),
  baseline AS (
    SELECT
      f.camera_id,
      EXTRACT(dow FROM f.detected_at)::int AS dow,
      EXTRACT(hour FROM f.detected_at)::int AS hod,
      count(*) AS cnt
    FROM public.faces f, params p
    WHERE f.camera_id IS NOT NULL
      AND f.detected_at >= now() - make_interval(days => p.baseline_d)
      AND f.detected_at <  now() - make_interval(hours => p.lookback_h)
    GROUP BY f.camera_id, date_trunc('hour', f.detected_at), dow, hod
  ),
  bucket_stats AS (
    SELECT camera_id, dow, hod,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY cnt) AS median_cnt
    FROM baseline
    GROUP BY camera_id, dow, hod
  ),
  with_dev AS (
    SELECT b.camera_id, b.dow, b.hod, b.cnt, bs.median_cnt,
           abs(b.cnt - bs.median_cnt) AS dev
    FROM baseline b
    JOIN bucket_stats bs USING (camera_id, dow, hod)
  ),
  mad_stats AS (
    SELECT camera_id, dow, hod,
           min(median_cnt) AS median_cnt,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dev) AS mad
    FROM with_dev
    GROUP BY camera_id, dow, hod
  )
  SELECT
    r.camera_id,
    c.name AS camera_name,
    r.bucket AS bucket_start,
    r.cnt AS observed,
    COALESCE(m.median_cnt, 0)::real AS baseline_median,
    COALESCE(m.mad, 0)::real AS baseline_mad,
    CASE WHEN m.mad IS NULL OR m.mad <= 0 THEN 0
         ELSE ((r.cnt - m.median_cnt) / (1.4826 * m.mad))::real
    END AS z_score
  FROM recent r
  LEFT JOIN mad_stats m USING (camera_id, dow, hod)
  LEFT JOIN public.cameras c ON c.id = r.camera_id
  ORDER BY abs(
    CASE WHEN m.mad IS NULL OR m.mad <= 0 THEN 0
         ELSE ((r.cnt - m.median_cnt) / (1.4826 * m.mad))
    END
  ) DESC NULLS LAST
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.face_in_privacy_zone(p_face_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  f_record record;
  z record;
  cx real;
  cy real;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;
  SELECT f.camera_id, f.bbox INTO f_record FROM public.faces f WHERE f.id = p_face_id;
  IF NOT FOUND OR f_record.bbox IS NULL THEN RETURN false; END IF;
  cx := (f_record.bbox->>'x')::real + (f_record.bbox->>'w')::real / 2;
  cy := (f_record.bbox->>'y')::real + (f_record.bbox->>'h')::real / 2;
  FOR z IN
    SELECT x, y, w, h FROM public.privacy_zones
    WHERE camera_id = f_record.camera_id AND enabled = true AND never_reveal = true
  LOOP
    IF cx >= z.x AND cx <= z.x + z.w AND cy >= z.y AND cy <= z.y + z.h THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
