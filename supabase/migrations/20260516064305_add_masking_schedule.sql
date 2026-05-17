-- Per-camera masking schedule. Default (no row / empty schedule) = 24/7 masked.
-- A camera can have multiple "always-masked" or "always-revealed" windows
-- defined in Asia/Seoul time. Outside any window → fallback to mode_default.

CREATE TABLE IF NOT EXISTS public.masking_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id       uuid NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  -- 'masked' | 'revealed' — what happens INSIDE the time window
  window_mode     text NOT NULL CHECK (window_mode IN ('masked','revealed')),
  -- HH:MM in Asia/Seoul
  starts_at       text NOT NULL CHECK (starts_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  ends_at         text NOT NULL CHECK (ends_at   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- bitmask Sun=1, Mon=2, …, Sat=64. 127 = every day.
  weekdays        integer NOT NULL DEFAULT 127 CHECK (weekdays BETWEEN 1 AND 127),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_masking_schedules_camera ON public.masking_schedules(camera_id);

-- Default behavior column on cameras themselves.
ALTER TABLE public.cameras
  ADD COLUMN IF NOT EXISTS mask_default text NOT NULL DEFAULT 'masked'
    CHECK (mask_default IN ('masked','revealed'));

COMMENT ON COLUMN public.cameras.mask_default IS
  'Default masking mode when no schedule window matches. Defaults to ''masked'' (24/7 protection).';
COMMENT ON TABLE public.masking_schedules IS
  'Per-camera time-of-day masking schedule. Outside any window → cameras.mask_default applies.';

-- RLS
ALTER TABLE public.masking_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "masking_schedules: auth read" ON public.masking_schedules
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY "masking_schedules: admin write" ON public.masking_schedules
  FOR ALL USING (private.is_admin());

-- Helper RPC: given a camera + (optional) timestamp, return effective mask mode.
CREATE OR REPLACE FUNCTION public.effective_mask_mode(
  p_camera_id uuid,
  p_at        timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH kst AS (
    SELECT
      (p_at AT TIME ZONE 'Asia/Seoul')::time AS t,
      extract(isodow FROM (p_at AT TIME ZONE 'Asia/Seoul'))::int AS isodow
  ),
  hit AS (
    SELECT s.window_mode
    FROM public.masking_schedules s, kst k
    WHERE s.camera_id = p_camera_id
      AND (s.weekdays & (1 << (k.isodow % 7))) <> 0
      AND (
        (s.starts_at::time <= s.ends_at::time
          AND k.t >= s.starts_at::time AND k.t < s.ends_at::time)
        OR
        (s.starts_at::time > s.ends_at::time
          AND (k.t >= s.starts_at::time OR k.t < s.ends_at::time))
      )
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT window_mode FROM hit),
    (SELECT mask_default FROM public.cameras WHERE id = p_camera_id),
    'masked'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.effective_mask_mode(uuid, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.effective_mask_mode(uuid, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.effective_mask_mode(uuid, timestamptz) IS
  'Returns ''masked''|''revealed'' for a camera at a given UTC instant by '
  'evaluating its schedule rows in Asia/Seoul. Defaults to camera.mask_default '
  'or ''masked''.';;
