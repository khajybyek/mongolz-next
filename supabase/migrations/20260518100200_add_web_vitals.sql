CREATE TABLE IF NOT EXISTS public.web_vitals (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  metric text NOT NULL,
  value double precision NOT NULL,
  rating text,
  page text NOT NULL,
  navigation_type text,
  ua text,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_vitals_metric_ts_idx ON public.web_vitals (metric, ts DESC);
CREATE INDEX IF NOT EXISTS web_vitals_page_idx ON public.web_vitals (page);
CREATE INDEX IF NOT EXISTS web_vitals_ts_idx ON public.web_vitals (ts DESC);

ALTER TABLE public.web_vitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY web_vitals_insert_authenticated ON public.web_vitals
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY web_vitals_admin_select ON public.web_vitals
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE OR REPLACE VIEW public.web_vitals_p75
WITH (security_invoker = true)
AS
SELECT
  metric,
  page,
  date_trunc('day', ts) AS day,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY value) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
  count(*) AS samples
FROM public.web_vitals
WHERE ts >= now() - interval '30 days'
GROUP BY metric, page, date_trunc('day', ts);

REVOKE ALL ON public.web_vitals_p75 FROM PUBLIC, anon;
GRANT SELECT ON public.web_vitals_p75 TO authenticated;

COMMENT ON TABLE public.web_vitals IS
  'Core Web Vitals (LCP, FID, CLS, INP, TTFB, FCP) samples collected via beacon from authenticated clients.';
COMMENT ON VIEW public.web_vitals_p75 IS
  'Daily p50/p75/p95 rollups of web_vitals samples for the performance budget dashboard.';
