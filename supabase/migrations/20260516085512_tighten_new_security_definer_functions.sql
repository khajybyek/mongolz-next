-- 1. sweep_retention: cron-only (service_role)
REVOKE EXECUTE ON FUNCTION public.sweep_retention() FROM authenticated, anon, PUBLIC;
-- already granted to service_role

-- 2. top_slow_queries: admin API route uses service client
REVOKE EXECUTE ON FUNCTION public.top_slow_queries(integer) FROM authenticated, anon, PUBLIC;
-- already granted to service_role

-- 3. user_can_see_camera: needed by RLS — move to private schema (not exposed via PostgREST)
CREATE OR REPLACE FUNCTION private.user_can_see_camera(p_camera_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $$
  SELECT
    private.is_admin()
    OR NOT EXISTS (
      SELECT 1 FROM public.camera_permissions WHERE camera_id = p_camera_id
    )
    OR EXISTS (
      SELECT 1 FROM public.camera_permissions
      WHERE camera_id = p_camera_id
        AND user_id  = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION private.user_can_see_camera(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.user_can_see_camera(uuid) TO authenticated, service_role;

-- Swap RLS policies to reference private.user_can_see_camera
DROP POLICY IF EXISTS "cameras: auth read (permission aware)" ON public.cameras;
CREATE POLICY "cameras: auth read (permission aware)" ON public.cameras
  FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND private.user_can_see_camera(id)
  );

DROP POLICY IF EXISTS "recordings: auth read (permission aware)" ON public.recordings;
CREATE POLICY "recordings: auth read (permission aware)" ON public.recordings
  FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND private.user_can_see_camera(camera_id)
  );

-- Drop the public version
DROP FUNCTION IF EXISTS public.user_can_see_camera(uuid);;
