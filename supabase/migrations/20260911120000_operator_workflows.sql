-- Exact archive counts obey the caller's existing recording and face RLS.
-- Each request covers one small page, not an unbounded UUID set.
CREATE OR REPLACE FUNCTION public.recording_face_counts(p_recording_ids uuid[])
RETURNS TABLE (recording_id uuid, face_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(cardinality(p_recording_ids), 0) > 100 THEN
    RAISE EXCEPTION 'at most 100 recordings per request' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT r.id, count(f.id)
    FROM public.recordings r
    LEFT JOIN public.faces f ON f.recording_id = r.id
    WHERE r.id = ANY(p_recording_ids)
    GROUP BY r.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recording_face_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recording_face_counts(uuid[]) TO authenticated;

-- A review and its audit event commit together. Compare-and-set prevents
-- two operators from overwriting each other's decision or logging a missing row.
CREATE OR REPLACE FUNCTION public.review_face(p_face_id uuid, p_label text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user IS NULL OR NOT private.is_admin() OR NOT private.mfa_ok() THEN
    RAISE EXCEPTION 'forbidden: verified admin required' USING ERRCODE = '42501';
  END IF;
  IF p_label IS NULL OR p_label NOT IN ('confirmed', 'rejected', 'uncertain') THEN
    RAISE EXCEPTION 'invalid review label' USING ERRCODE = '22023';
  END IF;
  UPDATE public.faces
    SET reviewed = true, review_label = p_label,
        reviewed_by = v_user, reviewed_at = now()
    WHERE id = p_face_id AND NOT coalesce(reviewed, false)
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'face already reviewed or missing' USING ERRCODE = 'P0002';
  END IF;
  SELECT email INTO v_email FROM public.profiles WHERE id = v_user;
  INSERT INTO public.audit_log (action, detail, user_id, user_email)
    VALUES ('FACE_REVIEW', 'face=' || v_id::text || ' label=' || p_label, v_user, v_email);
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.review_face(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_face(uuid, text) TO authenticated;
