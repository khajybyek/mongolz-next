-- `supabase db lint --linked` flagged:
--   public.suggested_threshold: Returned type real does not match expected
--   type numeric in column 2.
--
-- Column 2 of the RETURNS TABLE is `suggested_threshold numeric`, but the
-- expression `COALESCE(MAX(t)..., 0.45)` resolves to `real` because `t` came
-- from `alerts.similarity` which is `real` (float4) — the literal 0.45 gets
-- coerced down to real instead of promoting MAX(t) up to numeric. At call
-- time PostgreSQL raises 42804 ("structure of query does not match function
-- result type") so any caller of /api/alerts/suggested-thresholds would fail.
--
-- Fix: cast the COALESCE result to numeric so the column type matches the
-- declared signature.

CREATE OR REPLACE FUNCTION public.suggested_threshold(p_suspect_id uuid)
 RETURNS TABLE(suspect_id uuid, suggested_threshold numeric, tp_count integer, fp_count integer, total_labeled integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  WITH labeled AS (
    SELECT similarity, label
    FROM public.alerts
    WHERE alerts.suspect_id = p_suspect_id
      AND alerts.label IN ('true_positive', 'false_positive')
  ),
  thresholds AS (
    SELECT
      similarity AS t,
      (SELECT count(*)::int FROM labeled l WHERE l.similarity >= similarity AND l.label = 'true_positive') AS tp,
      (SELECT count(*)::int FROM labeled l WHERE l.similarity >= similarity AND l.label = 'false_positive') AS fp,
      (SELECT count(*)::int FROM labeled l WHERE l.similarity < similarity AND l.label = 'true_positive') AS fn
    FROM labeled
  ),
  scored AS (
    SELECT
      t,
      tp,
      fp,
      fn,
      CASE WHEN (tp + fp) > 0 AND (tp + fn) > 0
        THEN 2.0 * tp / NULLIF((2.0 * tp + fp + fn), 0)
        ELSE 0 END AS f1
    FROM thresholds
  )
  SELECT
    p_suspect_id,
    COALESCE(MAX(t) FILTER (WHERE f1 = (SELECT MAX(f1) FROM scored)), 0.45)::numeric AS suggested_threshold,
    (SELECT count(*)::int FROM labeled WHERE label='true_positive'),
    (SELECT count(*)::int FROM labeled WHERE label='false_positive'),
    (SELECT count(*)::int FROM labeled)
  FROM scored;
END;
$function$;
