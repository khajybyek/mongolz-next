-- camera_health(): operator scope (admin + viewer), permission-aware.
--
-- Viewers are meant to monitor the live grid / wall like an NVR operator.
-- The health rollup (last face timestamp, 1h/24h counts, computed status)
-- was admin-only, so view-only pages had to render every camera as
-- "unknown". This opens the RPC to operators (private.is_operator() =
-- admin | viewer; auditor stays blocked) and restricts the rows to the
-- cameras the caller may see (private.user_can_see_camera — admins see
-- all). Only aggregates leave the function: no face ids, crops or
-- embeddings.
CREATE OR REPLACE FUNCTION public.camera_health()
RETURNS TABLE (
  camera_id uuid,
  name text,
  enabled boolean,
  cam_type text,
  last_seen timestamptz,
  faces_24h bigint,
  faces_1h bigint,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
#variable_conflict use_column
BEGIN
  IF NOT private.is_operator() THEN
    RAISE EXCEPTION 'forbidden: operator only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH visible AS (
    SELECT c.id, c.name, c.enabled, c.cam_type
    FROM public.cameras c
    WHERE private.is_admin() OR private.user_can_see_camera(c.id)
  ),
  face_stats AS (
    SELECT
      f.camera_id,
      max(f.detected_at) AS last_seen,
      count(*) FILTER (WHERE f.detected_at >= now() - interval '24 hours') AS faces_24h,
      count(*) FILTER (WHERE f.detected_at >= now() - interval '1 hour') AS faces_1h
    FROM public.faces f
    WHERE f.camera_id IS NOT NULL
      AND f.camera_id IN (SELECT v.id FROM visible v)
    GROUP BY f.camera_id
  )
  SELECT
    c.id AS camera_id,
    c.name,
    c.enabled,
    c.cam_type,
    fs.last_seen,
    COALESCE(fs.faces_24h, 0) AS faces_24h,
    COALESCE(fs.faces_1h, 0) AS faces_1h,
    CASE
      WHEN fs.last_seen IS NULL THEN 'unknown'
      WHEN fs.last_seen >= now() - interval '5 minutes' THEN 'healthy'
      WHEN fs.last_seen >= now() - interval '30 minutes' THEN 'stale'
      ELSE 'offline'
    END::text AS status
  FROM visible c
  LEFT JOIN face_stats fs ON fs.camera_id = c.id
  ORDER BY c.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.camera_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.camera_health() TO authenticated;

COMMENT ON FUNCTION public.camera_health IS
  'Per-camera last face timestamp + 24h/1h count + computed status (healthy/stale/offline/unknown). Operator-gated (admin | viewer); viewers only get cameras they may see.';
