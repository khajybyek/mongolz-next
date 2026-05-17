-- Per-camera access control. By default a viewer/auditor sees all cameras
-- (matching the existing "cameras: auth read" policy). Adding a row to
-- camera_permissions LOCKS the camera to specific user_ids in addition to
-- admin (who can always see all).
--
-- Model: allow-list — if the camera has any permission rows, only listed
-- users can access it. Empty list → unrestricted (legacy behavior).

CREATE TABLE IF NOT EXISTS public.camera_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id   uuid NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Reserved for future levels — for now 'view' is the only value.
  permission  text NOT NULL DEFAULT 'view' CHECK (permission IN ('view','operate')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (camera_id, user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_camera_permissions_camera ON public.camera_permissions(camera_id);
CREATE INDEX IF NOT EXISTS idx_camera_permissions_user   ON public.camera_permissions(user_id);

COMMENT ON TABLE public.camera_permissions IS
  'Allow-list: when a camera has rows, only listed users (plus admins) may access. '
  'Empty list → unrestricted (legacy default).';

ALTER TABLE public.camera_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "camera_permissions: admin manage" ON public.camera_permissions
  FOR ALL USING (private.is_admin());
CREATE POLICY "camera_permissions: user self read" ON public.camera_permissions
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- Helper that tells the app layer whether the current user may see a camera.
CREATE OR REPLACE FUNCTION public.user_can_see_camera(p_camera_id uuid)
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

REVOKE EXECUTE ON FUNCTION public.user_can_see_camera(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.user_can_see_camera(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_can_see_camera(uuid) IS
  'True if the current user may access the camera. Admins always pass. '
  'Without permission rows: unrestricted. With rows: allow-list only.';

-- Tighten cameras: replace blanket "auth read" with permission-aware policy.
DROP POLICY IF EXISTS "cameras: auth read" ON public.cameras;
CREATE POLICY "cameras: auth read (permission aware)" ON public.cameras
  FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND public.user_can_see_camera(id)
  );

-- Same for recordings (they're keyed by camera_id)
DROP POLICY IF EXISTS "recordings: auth read" ON public.recordings;
CREATE POLICY "recordings: auth read (permission aware)" ON public.recordings
  FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND public.user_can_see_camera(camera_id)
  );;
