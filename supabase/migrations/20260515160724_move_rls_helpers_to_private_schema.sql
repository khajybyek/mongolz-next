-- Resolve the last Security Advisor warning by moving SECURITY DEFINER RLS
-- helpers to a private schema that PostgREST does not expose via /rest/v1/rpc/.
--
-- 1. Create `private` schema (not in PGRST_DB_SCHEMAS → not REST-exposed)
-- 2. Recreate current_user_role and is_admin in private (SECURITY DEFINER)
-- 3. Atomically swap all 18 RLS policies to reference private.is_admin()
-- 4. Drop public.is_admin() + public.current_user_role()

-- ─── 1. Private schema ───
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
REVOKE ALL ON SCHEMA private FROM anon, PUBLIC;

-- ─── 2. Recreate helpers in private ───
CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $$
  SELECT private.current_user_role() = 'admin'
$$;

REVOKE ALL ON FUNCTION private.current_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_admin()           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin()           TO authenticated, service_role;

COMMENT ON FUNCTION private.current_user_role() IS
  'SECURITY DEFINER helper for RLS policies. Not exposed via PostgREST (private schema).';
COMMENT ON FUNCTION private.is_admin() IS
  'SECURITY DEFINER helper used by 18 RLS policies. Not exposed via PostgREST.';

-- ─── 3. Swap all RLS policies ───
-- public.profiles ─
DROP POLICY IF EXISTS "profiles: read" ON public.profiles;
CREATE POLICY "profiles: read" ON public.profiles
  FOR SELECT
  USING ((id = (SELECT auth.uid())) OR private.is_admin());

DROP POLICY IF EXISTS "profiles: admin updates all" ON public.profiles;
CREATE POLICY "profiles: admin updates all" ON public.profiles
  FOR UPDATE
  USING (private.is_admin());

-- public.alert_rules ─
DROP POLICY IF EXISTS "alert_rules: admin only" ON public.alert_rules;
CREATE POLICY "alert_rules: admin only" ON public.alert_rules
  FOR ALL
  USING (private.is_admin());

-- public.alerts ─
DROP POLICY IF EXISTS "alerts: admin write" ON public.alerts;
CREATE POLICY "alerts: admin write" ON public.alerts
  FOR ALL
  USING (private.is_admin());

-- public.audit_log ─
DROP POLICY IF EXISTS "audit_log: admin read" ON public.audit_log;
CREATE POLICY "audit_log: admin read" ON public.audit_log
  FOR SELECT
  USING (private.is_admin());

-- public.cameras ─
DROP POLICY IF EXISTS "cameras: admin delete" ON public.cameras;
CREATE POLICY "cameras: admin delete" ON public.cameras
  FOR DELETE
  USING (private.is_admin());

DROP POLICY IF EXISTS "cameras: admin insert" ON public.cameras;
CREATE POLICY "cameras: admin insert" ON public.cameras
  FOR INSERT
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "cameras: admin update" ON public.cameras;
CREATE POLICY "cameras: admin update" ON public.cameras
  FOR UPDATE
  USING (private.is_admin());

-- public.clusters ─
DROP POLICY IF EXISTS "clusters: admin write" ON public.clusters;
CREATE POLICY "clusters: admin write" ON public.clusters
  FOR ALL
  USING (private.is_admin());

-- public.faces ─
DROP POLICY IF EXISTS "faces: admin write" ON public.faces;
CREATE POLICY "faces: admin write" ON public.faces
  FOR ALL
  USING (private.is_admin());

-- public.recordings ─
DROP POLICY IF EXISTS "recordings: admin delete" ON public.recordings;
CREATE POLICY "recordings: admin delete" ON public.recordings
  FOR DELETE
  USING (private.is_admin());

DROP POLICY IF EXISTS "recordings: admin insert" ON public.recordings;
CREATE POLICY "recordings: admin insert" ON public.recordings
  FOR INSERT
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "recordings: admin update" ON public.recordings;
CREATE POLICY "recordings: admin update" ON public.recordings
  FOR UPDATE
  USING (private.is_admin());

-- public.reveal_jobs ─
DROP POLICY IF EXISTS "reveal_jobs: admin write" ON public.reveal_jobs;
CREATE POLICY "reveal_jobs: admin write" ON public.reveal_jobs
  FOR ALL
  USING (private.is_admin());

-- public.suspects ─
DROP POLICY IF EXISTS "suspects: admin write" ON public.suspects;
CREATE POLICY "suspects: admin write" ON public.suspects
  FOR ALL
  USING (private.is_admin());

-- public.webhooks ─
DROP POLICY IF EXISTS "webhooks: admin only" ON public.webhooks;
CREATE POLICY "webhooks: admin only" ON public.webhooks
  FOR ALL
  USING (private.is_admin());

-- storage.objects ─
DROP POLICY IF EXISTS "storage: admin all-buckets all" ON storage.objects;
CREATE POLICY "storage: admin all-buckets all" ON storage.objects
  FOR ALL
  USING (private.is_admin());

-- ─── 4. Drop old public helpers ───
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.current_user_role();;
