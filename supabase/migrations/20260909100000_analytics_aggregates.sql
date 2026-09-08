-- ============================================================================
-- Reporting aggregates the operator can trust (audit 2026-09-08, finding 16)
-- ============================================================================
--
-- WHAT THIS FIXES
-- ---------------
-- Two of the three ways the operator-facing figures were wrong were only
-- fixable in SQL:
--
--   (a) Capped samples presented as totals. /analytics computed its
--       high-severity ratio from the newest 500 alert rows and the dashboard
--       trend from the newest 5000; both were printed as if they were the
--       whole population.
--   (b) UTC buckets under KST labels. `faces_by_hour`, `faces_by_date` and
--       `alerts_by_date` bucket with `date(ts)` / `extract(hour from ts)`,
--       which evaluate in the session time zone — UTC for PostgREST. Every
--       timestamp on screen is rendered in Asia/Seoul (lib/utils#formatDate),
--       so an alert at 01:00 KST landed in the previous day's bar, and the
--       09:00 KST peak showed up at 00:00. The dashboard already bucketed in
--       KST, so the two pages disagreed with each other.
--
-- The functions below do the counting in the database: exact (no LIMIT in the
-- aggregate path) and cut on Asia/Seoul day / hour boundaries, with empty
-- buckets filled so a gap reads as 0 instead of vanishing from the axis.
--
-- SECURITY
-- --------
-- Every aggregate is SECURITY INVOKER on purpose. They run as the caller, so
-- the existing row-level security on public.alerts / public.faces applies
-- unchanged — including the restrictive `mfa_ok` policies from
-- 20260908110000. Nothing here widens access by a single row: an admin sees
-- what an admin already saw through PostgREST, a viewer still gets an empty
-- set, and the app now labels that empty set as "no access" rather than 0
-- (lib/metrics.ts#readScope + shapeCount).
--
-- `camera_anomaly_scores` is re-created at the end. It is SECURITY DEFINER
-- and keeps both gates it already had (private.mfa_ok(), private.is_admin())
-- byte-for-byte; the only change is that the day-of-week / hour-of-day
-- seasonality is now read in Asia/Seoul. Before this, an 08:00 KST bucket was
-- compared against the baseline for 23:00 the previous UTC day — a Monday
-- morning was scored against Sunday night traffic.
--
-- BLAST RADIUS
-- ------------
-- Five new functions plus one body replacement. The legacy views
-- (faces_by_hour, faces_by_date, alerts_by_date, top_suspects) are left in
-- place untouched: they are no longer read by /analytics, and dropping them
-- is a separate, non-additive change.
--
-- ROLLBACK
-- --------
--   drop function if exists public.alerts_daily_kst(integer);
--   drop function if exists public.faces_daily_kst(integer);
--   drop function if exists public.faces_hourly_kst(integer);
--   drop function if exists public.alerts_severity_kst(integer);
--   drop function if exists public.top_suspects_kst(integer, integer);
-- and restore camera_anomaly_scores from 20260908113000_mfa_in_secdef_rpcs.sql.
-- The pages degrade to their "could not be loaded" state (with a retry), not
-- to a fabricated zero.
-- ============================================================================

-- ── 1. Alerts per KST day ───────────────────────────────────────────────────
-- Drives the dashboard 7-day trend (and its "vs previous 7 days" delta) and
-- the /analytics daily alert chart. `n_high` uses the same 0.7 cut as the
-- severity badge in app/(app)/alerts/page.tsx.
CREATE OR REPLACE FUNCTION public.alerts_daily_kst(p_days integer DEFAULT 14)
RETURNS TABLE (day_kst date, n_total bigint, n_high bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT least(greatest(coalesce(p_days, 14), 1), 366) AS n,
           (timezone('Asia/Seoul', now()))::date          AS today
  ),
  span AS (
    SELECT w.today - (w.n - 1)                                            AS first_day,
           w.today                                                        AS last_day,
           timezone('Asia/Seoul', (w.today - (w.n - 1))::timestamp)       AS from_ts
    FROM win w
  ),
  cal AS (
    SELECT generate_series(s.first_day::timestamp, s.last_day::timestamp, interval '1 day')::date AS k
    FROM span s
  ),
  agg AS (
    SELECT (timezone('Asia/Seoul', a.created_at))::date       AS k,
           count(*)                                           AS c,
           count(*) FILTER (WHERE a.similarity >= 0.7)        AS hi
    FROM public.alerts a, span s
    WHERE a.created_at >= s.from_ts
    GROUP BY 1
  )
  SELECT c.k, coalesce(g.c, 0), coalesce(g.hi, 0)
  FROM cal c
  LEFT JOIN agg g ON g.k = c.k
  ORDER BY c.k;
$$;

-- ── 2. Faces per KST day ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.faces_daily_kst(p_days integer DEFAULT 30)
RETURNS TABLE (day_kst date, n_faces bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT least(greatest(coalesce(p_days, 30), 1), 366) AS n,
           (timezone('Asia/Seoul', now()))::date          AS today
  ),
  span AS (
    SELECT w.today - (w.n - 1)                                      AS first_day,
           w.today                                                  AS last_day,
           timezone('Asia/Seoul', (w.today - (w.n - 1))::timestamp) AS from_ts
    FROM win w
  ),
  cal AS (
    SELECT generate_series(s.first_day::timestamp, s.last_day::timestamp, interval '1 day')::date AS k
    FROM span s
  ),
  agg AS (
    SELECT (timezone('Asia/Seoul', f.detected_at))::date AS k, count(*) AS c
    FROM public.faces f, span s
    WHERE f.detected_at >= s.from_ts
    GROUP BY 1
  )
  SELECT c.k, coalesce(g.c, 0)
  FROM cal c
  LEFT JOIN agg g ON g.k = c.k
  ORDER BY c.k;
$$;

-- ── 3. Faces per KST hour-of-day ────────────────────────────────────────────
-- All 24 hours are returned so the bar chart keeps a stable axis.
CREATE OR REPLACE FUNCTION public.faces_hourly_kst(p_days integer DEFAULT 30)
RETURNS TABLE (hour_kst integer, n_faces bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT least(greatest(coalesce(p_days, 30), 1), 366) AS n,
           (timezone('Asia/Seoul', now()))::date          AS today
  ),
  span AS (
    SELECT timezone('Asia/Seoul', (w.today - (w.n - 1))::timestamp) AS from_ts
    FROM win w
  ),
  hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  agg AS (
    SELECT extract(hour FROM timezone('Asia/Seoul', f.detected_at))::int AS h,
           count(*)                                                       AS c
    FROM public.faces f, span s
    WHERE f.detected_at >= s.from_ts
    GROUP BY 1
  )
  SELECT hh.h, coalesce(g.c, 0)
  FROM hours hh
  LEFT JOIN agg g ON g.h = hh.h
  ORDER BY hh.h;
$$;

-- ── 4. Alert severity split over a KST window ───────────────────────────────
-- Replaces "count the newest 500 rows and print the ratio". Thresholds match
-- the badge colours: >= 0.7 high, >= 0.5 medium, the rest (including the NULL
-- similarity of anomaly alerts) low.
CREATE OR REPLACE FUNCTION public.alerts_severity_kst(p_days integer DEFAULT 7)
RETURNS TABLE (n_total bigint, n_high bigint, n_medium bigint, n_low bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT least(greatest(coalesce(p_days, 7), 1), 366) AS n,
           (timezone('Asia/Seoul', now()))::date         AS today
  ),
  span AS (
    SELECT timezone('Asia/Seoul', (w.today - (w.n - 1))::timestamp) AS from_ts
    FROM win w
  )
  SELECT count(*),
         count(*) FILTER (WHERE a.similarity >= 0.7),
         count(*) FILTER (WHERE a.similarity >= 0.5 AND a.similarity < 0.7),
         count(*) FILTER (WHERE a.similarity IS NULL OR a.similarity < 0.5)
  FROM public.alerts a, span s
  WHERE a.created_at >= s.from_ts;
$$;

-- ── 5. Top suspects over a KST window ───────────────────────────────────────
-- The legacy `top_suspects` view is all-time and unlabelled, sitting next to
-- 30-day charts. This one takes the same window as the rest of the page and
-- counts only match alerts (type = 'match'); anomaly rows carry a
-- placeholder suspect_name, so filtering on NULL would have been a no-op.
CREATE OR REPLACE FUNCTION public.top_suspects_kst(p_days integer DEFAULT 30, p_limit integer DEFAULT 10)
RETURNS TABLE (suspect text, n_alerts bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT least(greatest(coalesce(p_days, 30), 1), 366) AS n,
           least(greatest(coalesce(p_limit, 10), 1), 50)  AS lim,
           (timezone('Asia/Seoul', now()))::date          AS today
  ),
  span AS (
    SELECT timezone('Asia/Seoul', (w.today - (w.n - 1))::timestamp) AS from_ts,
           w.lim                                                    AS lim
    FROM win w
  )
  SELECT a.suspect_name, count(*) AS c
  FROM public.alerts a, span s
  WHERE a.created_at >= s.from_ts
    AND a.type = 'match'   -- anomaly alerts carry a placeholder name, not NULL
  GROUP BY a.suspect_name
  ORDER BY c DESC, a.suspect_name ASC
  LIMIT (SELECT s2.lim FROM span s2);
$$;

REVOKE ALL ON FUNCTION public.alerts_daily_kst(integer)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.faces_daily_kst(integer)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.faces_hourly_kst(integer)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.alerts_severity_kst(integer)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.top_suspects_kst(integer, integer)    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.alerts_daily_kst(integer)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.faces_daily_kst(integer)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.faces_hourly_kst(integer)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.alerts_severity_kst(integer)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.top_suspects_kst(integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.alerts_daily_kst(integer) IS
  'Alerts per Asia/Seoul day for the last p_days (gaps filled with 0), with the >=0.7 high-severity count. SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.faces_daily_kst(integer) IS
  'Detected faces per Asia/Seoul day for the last p_days (gaps filled with 0). SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.faces_hourly_kst(integer) IS
  'Detected faces per Asia/Seoul hour-of-day over the last p_days, all 24 hours returned. SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.alerts_severity_kst(integer) IS
  'Exact alert severity split (>=0.7 / >=0.5 / rest incl. NULL) over the last p_days KST days. Replaces counting the newest 500 rows.';
COMMENT ON FUNCTION public.top_suspects_kst(integer, integer) IS
  'Top named suspects by alert count over the last p_days KST days. Windowed replacement for the all-time top_suspects view.';

-- ── 6. Anomaly seasonality in KST ───────────────────────────────────────────
-- Body copied from 20260908113000_mfa_in_secdef_rpcs.sql. Both gates and every
-- other line are unchanged; `EXTRACT(dow|hour FROM f.detected_at)` becomes
-- `EXTRACT(... FROM timezone('Asia/Seoul', f.detected_at))` in the `recent`
-- and `baseline` CTEs so "this hour, on this weekday" means the same hour and
-- weekday the operator sees on screen. `date_trunc('hour', ...)` is left as it
-- is: Asia/Seoul is a whole-hour offset with no DST, so the hour boundary is
-- the same instant either way, and bucket_start is rendered through
-- formatDate() in KST already.
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
      EXTRACT(dow FROM timezone('Asia/Seoul', f.detected_at))::int AS dow,
      EXTRACT(hour FROM timezone('Asia/Seoul', f.detected_at))::int AS hod,
      count(*) AS cnt
    FROM public.faces f, params p
    WHERE f.camera_id IS NOT NULL
      AND f.detected_at >= now() - make_interval(hours => p.lookback_h)
    GROUP BY f.camera_id, bucket, dow, hod
  ),
  baseline AS (
    SELECT
      f.camera_id,
      EXTRACT(dow FROM timezone('Asia/Seoul', f.detected_at))::int AS dow,
      EXTRACT(hour FROM timezone('Asia/Seoul', f.detected_at))::int AS hod,
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

COMMENT ON FUNCTION public.camera_anomaly_scores(integer, integer) IS
  'Per-camera hourly face volume vs a median/MAD baseline for the same Asia/Seoul weekday and hour. Admin + second factor.';
