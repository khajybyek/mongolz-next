-- ============================================================================
-- Second factor inside the four SECURITY DEFINER RPCs (audit 2026-09-08, 4.1)
-- ============================================================================
--
-- 20260908110000 attached private.mfa_ok() as RESTRICTIVE RLS policies, which
-- stops a raw grant_type=password token from reading the gated tables through
-- PostgREST. It does not reach inside a SECURITY DEFINER function: these four
-- run as `postgres` (rolbypassrls), read public.faces / public.cameras with RLS
-- off, and hold EXECUTE for `authenticated`. A password-only admin token could
-- therefore still call camera_trail() and read a person's cross-camera movement,
-- or camera_health() for per-camera activity — exactly what the gate exists to
-- prevent.
--
-- Each body below is `pg_get_functiondef` output taken from the live database,
-- with one block inserted immediately after BEGIN. Nothing else is retyped.
--
-- BLAST RADIUS: the four RPCs only. mfa_ok() is fail-open (no TOTP on the
-- profile, unreadable amr, service_role and direct SQL all pass), so the four
-- pages that call them (/grid, /wall, /reid, the privacy-zone check) keep
-- working for every session the app itself mints.
--
-- ROLLBACK: flip the shared kill switch —
--   update private.security_settings set mfa_required = false;
-- or restore the previous bodies from migration history.
-- ============================================================================

-- ── camera_anomaly_scores ──
CREATE OR REPLACE FUNCTION public.camera_anomaly_scores(p_window_hours integer DEFAULT 24, p_baseline_days integer DEFAULT 28)
 RETURNS TABLE(camera_id uuid, camera_name text, bucket_start timestamp with time zone, observed bigint, baseline_median real, baseline_mad real, z_score real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  -- Second factor at the data tier (audit 4.1). SECURITY DEFINER runs as the
  -- owner, so RLS — including the restrictive mfa_ok policies — does not apply
  -- inside this function. Ask the same question here.
  IF NOT private.mfa_ok() THEN
    RAISE EXCEPTION 'forbidden: second factor required' USING ERRCODE = '42501';
  END IF;
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
    SELECT b.camera_id, b.dow, b.hod,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY b.cnt) AS median_cnt
    FROM baseline b
    GROUP BY b.camera_id, b.dow, b.hod
  ),
  with_dev AS (
    SELECT b.camera_id, b.dow, b.hod, b.cnt, bs.median_cnt,
           abs(b.cnt - bs.median_cnt) AS dev
    FROM baseline b
    JOIN bucket_stats bs USING (camera_id, dow, hod)
  ),
  mad_stats AS (
    SELECT wd.camera_id, wd.dow, wd.hod,
           min(wd.median_cnt) AS median_cnt,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY wd.dev) AS mad
    FROM with_dev wd
    GROUP BY wd.camera_id, wd.dow, wd.hod
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
$function$
;

-- ── camera_health ──
CREATE OR REPLACE FUNCTION public.camera_health()
 RETURNS TABLE(camera_id uuid, name text, enabled boolean, cam_type text, last_seen timestamp with time zone, faces_24h bigint, faces_1h bigint, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  -- Second factor at the data tier (audit 4.1). SECURITY DEFINER runs as the
  -- owner, so RLS — including the restrictive mfa_ok policies — does not apply
  -- inside this function. Ask the same question here.
  IF NOT private.mfa_ok() THEN
    RAISE EXCEPTION 'forbidden: second factor required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_operator() THEN
    RAISE EXCEPTION 'forbidden: operator only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH visible AS (
    SELECT c.id, c.name, c.enabled, c.cam_type
    FROM public.cameras c
    WHERE private.is_admin() OR private.user_can_see_camera(c.id)
  ),
  face_stats AS (
    SELECT
      f.camera_id,
      max(f.detected_at) AS last_seen,
      count(*) FILTER (WHERE f.detected_at >= now() - interval '24 hours') AS faces_24h,
      count(*) FILTER (WHERE f.detected_at >= now() - interval '1 hour') AS faces_1h
    FROM public.faces f
    WHERE f.camera_id IS NOT NULL
      AND f.camera_id IN (SELECT v.id FROM visible v)
    GROUP BY f.camera_id
  )
  SELECT
    c.id AS camera_id,
    c.name,
    c.enabled,
    c.cam_type,
    fs.last_seen,
    COALESCE(fs.faces_24h, 0) AS faces_24h,
    COALESCE(fs.faces_1h, 0) AS faces_1h,
    CASE
      WHEN fs.last_seen IS NULL THEN 'unknown'
      WHEN fs.last_seen >= now() - interval '5 minutes' THEN 'healthy'
      WHEN fs.last_seen >= now() - interval '30 minutes' THEN 'stale'
      ELSE 'offline'
    END::text AS status
  FROM visible c
  LEFT JOIN face_stats fs ON fs.camera_id = c.id
  ORDER BY c.name ASC;
END;
$function$
;

-- ── camera_trail ──
CREATE OR REPLACE FUNCTION public.camera_trail(p_face_id uuid, p_threshold real DEFAULT 0.45, p_window_hours integer DEFAULT 24, p_max_results integer DEFAULT 200)
 RETURNS TABLE(face_id uuid, camera_id uuid, camera_name text, detected_at timestamp with time zone, similarity real, image_path text, bbox jsonb, recording_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  -- Second factor at the data tier (audit 4.1). SECURITY DEFINER runs as the
  -- owner, so RLS — including the restrictive mfa_ok policies — does not apply
  -- inside this function. Ask the same question here.
  IF NOT private.mfa_ok() THEN
    RAISE EXCEPTION 'forbidden: second factor required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH source AS (
    SELECT f0.embedding, f0.detected_at AS anchor_ts
    FROM public.faces f0
    WHERE f0.id = p_face_id
  )
  SELECT
    f.id AS face_id,
    f.camera_id,
    c.name AS camera_name,
    f.detected_at,
    (1 - (f.embedding OPERATOR(extensions.<=>) s.embedding))::real AS similarity,
    f.image_path,
    f.bbox,
    f.recording_id
  FROM public.faces f
  CROSS JOIN source s
  LEFT JOIN public.cameras c ON c.id = f.camera_id
  WHERE f.embedding IS NOT NULL
    AND (1 - (f.embedding OPERATOR(extensions.<=>) s.embedding)) >= p_threshold
    AND f.detected_at BETWEEN (s.anchor_ts - make_interval(hours => p_window_hours))
                          AND (s.anchor_ts + make_interval(hours => p_window_hours))
  ORDER BY f.detected_at ASC
  LIMIT p_max_results;
END;
$function$
;

-- ── face_in_privacy_zone ──
CREATE OR REPLACE FUNCTION public.face_in_privacy_zone(p_face_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  f_record record;
  z record;
  cx real;
  cy real;
BEGIN
  -- Second factor at the data tier (audit 4.1). SECURITY DEFINER runs as the
  -- owner, so RLS — including the restrictive mfa_ok policies — does not apply
  -- inside this function. Ask the same question here.
  IF NOT private.mfa_ok() THEN
    RAISE EXCEPTION 'forbidden: second factor required' USING ERRCODE = '42501';
  END IF;
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
$function$
;
