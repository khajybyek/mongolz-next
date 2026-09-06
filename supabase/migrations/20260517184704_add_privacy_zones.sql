CREATE TABLE IF NOT EXISTS public.privacy_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id uuid NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  name text NOT NULL,
  reason text,
  -- Rectangle in normalised [0,1] camera-frame coordinates.
  x real NOT NULL CHECK (x >= 0 AND x <= 1),
  y real NOT NULL CHECK (y >= 0 AND y <= 1),
  w real NOT NULL CHECK (w > 0 AND w <= 1),
  h real NOT NULL CHECK (h > 0 AND h <= 1),
  -- When true, any face whose bbox center falls in the zone is excluded
  -- from reveal-job output (stays blurred even after admin approval).
  never_reveal boolean NOT NULL DEFAULT true,
  -- When true, ML pipeline forces stronger mask (cubist VIP tier) for
  -- faces crossing this region — useful for sensitive areas.
  enforce_vip_mask boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS privacy_zones_camera_enabled_idx
  ON public.privacy_zones (camera_id) WHERE enabled = true;

ALTER TABLE public.privacy_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY privacy_zones_admin_select ON public.privacy_zones
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY privacy_zones_admin_insert ON public.privacy_zones
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

CREATE POLICY privacy_zones_admin_update ON public.privacy_zones
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY privacy_zones_admin_delete ON public.privacy_zones
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- Helper: does a face bbox overlap any active privacy zone of its camera?
CREATE OR REPLACE FUNCTION public.face_in_privacy_zone(p_face_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  f_record record;
  z record;
  cx real;
  cy real;
BEGIN
  SELECT f.camera_id, f.bbox INTO f_record FROM public.faces f WHERE f.id = p_face_id;
  IF NOT FOUND OR f_record.bbox IS NULL THEN RETURN false; END IF;
  cx := (f_record.bbox->>'x')::real + (f_record.bbox->>'w')::real / 2;
  cy := (f_record.bbox->>'y')::real + (f_record.bbox->>'h')::real / 2;
  FOR z IN
    SELECT x, y, w, h FROM public.privacy_zones
    WHERE camera_id = f_record.camera_id AND enabled = true AND never_reveal = true
  LOOP
    IF cx >= z.x AND cx <= z.x + z.w AND cy >= z.y AND cy <= z.y + z.h THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.face_in_privacy_zone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.face_in_privacy_zone(uuid) TO authenticated;

COMMENT ON TABLE public.privacy_zones IS
  'Per-camera rectangular zones in normalised [0,1] frame coordinates. Faces whose bbox center falls inside an enabled zone are excluded from reveal output (e.g. restroom door, ATM keypad).';
