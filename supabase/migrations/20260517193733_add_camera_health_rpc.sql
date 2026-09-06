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
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH face_stats AS (
    SELECT
      f.camera_id,
      max(f.detected_at) AS last_seen,
      count(*) FILTER (WHERE f.detected_at >= now() - interval '24 hours') AS faces_24h,
      count(*) FILTER (WHERE f.detected_at >= now() - interval '1 hour') AS faces_1h
    FROM public.faces f
    WHERE f.camera_id IS NOT NULL
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
  FROM public.cameras c
  LEFT JOIN face_stats fs ON fs.camera_id = c.id
  ORDER BY c.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.camera_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.camera_health() TO authenticated;

COMMENT ON FUNCTION public.camera_health IS
  'Per-camera last face timestamp + 24h/1h count + computed status (healthy/stale/offline/unknown). Admin-gated.';
