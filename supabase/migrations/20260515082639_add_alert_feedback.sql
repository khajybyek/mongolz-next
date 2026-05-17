-- Active learning: human-in-the-loop feedback on alerts.
-- Admin marks an alert as true/false positive; aggregated stats feed back into
-- a suggested-threshold computation per suspect.
CREATE TYPE alert_label AS ENUM ('true_positive', 'false_positive', 'unknown');

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS label alert_label NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS labeled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labeled_at timestamptz;

CREATE INDEX IF NOT EXISTS alerts_label_idx ON public.alerts(label) WHERE label != 'unknown';

-- Suggested threshold view: computes optimal-ish similarity threshold per
-- suspect based on labeled history. F1-style — point where TP/FP balance.
CREATE OR REPLACE FUNCTION public.suggested_threshold(p_suspect_id uuid)
RETURNS TABLE(
  suspect_id uuid,
  suggested_threshold numeric,
  tp_count int,
  fp_count int,
  total_labeled int
) AS $$
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
    COALESCE(MAX(t) FILTER (WHERE f1 = (SELECT MAX(f1) FROM scored)), 0.45) AS suggested_threshold,
    (SELECT count(*)::int FROM labeled WHERE label='true_positive'),
    (SELECT count(*)::int FROM labeled WHERE label='false_positive'),
    (SELECT count(*)::int FROM labeled)
  FROM scored;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

COMMENT ON COLUMN public.alerts.label IS
  'Active learning: admin verdict on whether this alert was a real match.';;
