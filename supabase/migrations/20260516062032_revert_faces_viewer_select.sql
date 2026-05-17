-- Revert: faces table stays admin-only.
DROP POLICY IF EXISTS "faces: auth read" ON public.faces;

-- Restore default GRANT (revoke the column-level overrides we added)
REVOKE SELECT (id, filename, image_path, bbox, camera_id, detected_at, recording_id)
  ON public.faces FROM authenticated;
REVOKE SELECT (embedding) ON public.faces FROM service_role;;
