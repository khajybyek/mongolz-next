CREATE OR REPLACE FUNCTION public.camera_trail(
  p_face_id uuid,
  p_threshold real DEFAULT 0.45,
  p_window_hours int DEFAULT 24,
  p_max_results int DEFAULT 200
)
RETURNS TABLE (
  face_id uuid,
  camera_id uuid,
  camera_name text,
  detected_at timestamptz,
  similarity real,
  image_path text,
  bbox jsonb,
  recording_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
STABLE
AS $$
  WITH source AS (
    SELECT embedding, detected_at AS anchor_ts
    FROM public.faces
    WHERE id = p_face_id
  )
  SELECT
    f.id AS face_id,
    f.camera_id,
    c.name AS camera_name,
    f.detected_at,
    (1 - (f.embedding <=> s.embedding))::real AS similarity,
    f.image_path,
    f.bbox,
    f.recording_id
  FROM public.faces f
  CROSS JOIN source s
  LEFT JOIN public.cameras c ON c.id = f.camera_id
  WHERE f.embedding IS NOT NULL
    AND (1 - (f.embedding <=> s.embedding)) >= p_threshold
    AND f.detected_at BETWEEN (s.anchor_ts - make_interval(hours => p_window_hours))
                          AND (s.anchor_ts + make_interval(hours => p_window_hours))
  ORDER BY f.detected_at ASC
  LIMIT p_max_results;
$$;

REVOKE EXECUTE ON FUNCTION public.camera_trail(uuid, real, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.camera_trail(uuid, real, int, int) TO authenticated;

COMMENT ON FUNCTION public.camera_trail IS
  'Reconstruct a cross-camera movement trail by querying faces with embedding similarity >= threshold within +/- window_hours of the source face.';
