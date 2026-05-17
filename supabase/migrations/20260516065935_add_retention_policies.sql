-- Global retention policy table. One row per resource kind.
-- Cron job deletes rows older than retention_days.
CREATE TABLE IF NOT EXISTS public.retention_policies (
  resource         text PRIMARY KEY CHECK (resource IN (
    'recordings','faces','alerts','audit_log','reveal_jobs','reveal_outputs'
  )),
  retention_days   integer NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  enabled          boolean NOT NULL DEFAULT true,
  last_swept_at    timestamptz,
  last_swept_rows  integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.retention_policies (resource, retention_days, enabled) VALUES
  ('recordings',     30,   true),
  ('faces',          90,   true),
  ('alerts',         365,  true),
  ('audit_log',      730,  false),  -- legal hold: disabled by default
  ('reveal_jobs',    365,  true),
  ('reveal_outputs', 30,   true)
ON CONFLICT (resource) DO NOTHING;

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retention_policies: auth read" ON public.retention_policies
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "retention_policies: admin write" ON public.retention_policies
  FOR ALL USING (private.is_admin());

-- Sweep procedure — called by daily cron (or on demand).
CREATE OR REPLACE FUNCTION public.sweep_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  pol RECORD;
  result jsonb := '{}'::jsonb;
  rows_removed integer;
BEGIN
  FOR pol IN SELECT * FROM public.retention_policies WHERE enabled LOOP
    rows_removed := 0;
    IF pol.resource = 'recordings' THEN
      DELETE FROM public.recordings
        WHERE started_at < now() - (pol.retention_days || ' days')::interval;
      GET DIAGNOSTICS rows_removed = ROW_COUNT;
    ELSIF pol.resource = 'faces' THEN
      DELETE FROM public.faces
        WHERE detected_at < now() - (pol.retention_days || ' days')::interval;
      GET DIAGNOSTICS rows_removed = ROW_COUNT;
    ELSIF pol.resource = 'alerts' THEN
      DELETE FROM public.alerts
        WHERE created_at < now() - (pol.retention_days || ' days')::interval;
      GET DIAGNOSTICS rows_removed = ROW_COUNT;
    ELSIF pol.resource = 'audit_log' THEN
      DELETE FROM public.audit_log
        WHERE created_at < now() - (pol.retention_days || ' days')::interval;
      GET DIAGNOSTICS rows_removed = ROW_COUNT;
    ELSIF pol.resource = 'reveal_jobs' THEN
      DELETE FROM public.reveal_jobs
        WHERE created_at < now() - (pol.retention_days || ' days')::interval;
      GET DIAGNOSTICS rows_removed = ROW_COUNT;
    END IF;

    UPDATE public.retention_policies
      SET last_swept_at = now(),
          last_swept_rows = rows_removed
      WHERE resource = pol.resource;

    result := result || jsonb_build_object(pol.resource, rows_removed);
  END LOOP;

  -- Audit the sweep
  INSERT INTO public.audit_log(action, detail)
  VALUES ('RETENTION_SWEEP', result::text);

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_retention() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sweep_retention() TO service_role;

COMMENT ON FUNCTION public.sweep_retention() IS
  'Run by daily cron — deletes rows older than retention_policies.retention_days.';;
