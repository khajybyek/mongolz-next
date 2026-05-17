-- Viewer can see face metadata (bbox, time, count) for masked playback.
-- Embedding column is restricted to service_role only — viewer never sees the
-- 512-D vector that could enable similarity search outside the app.

-- ─── Add SELECT policy for any authenticated user ───
CREATE POLICY "faces: auth read" ON public.faces
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

-- ─── Lock down the embedding column at GRANT level ───
REVOKE SELECT (embedding) ON public.faces FROM authenticated, anon;
GRANT  SELECT (embedding) ON public.faces TO service_role;

-- Non-sensitive columns remain selectable for authenticated.
-- (id, filename, image_path, bbox, camera_id, detected_at, recording_id)
GRANT SELECT (id, filename, image_path, bbox, camera_id, detected_at, recording_id)
  ON public.faces TO authenticated;

COMMENT ON POLICY "faces: auth read" ON public.faces IS
  'Viewers and admins can SELECT face metadata for masked playback overlays. '
  'Embedding column is column-level revoked from authenticated.';;
