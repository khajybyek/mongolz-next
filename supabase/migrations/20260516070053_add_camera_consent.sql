-- Cameras can be flagged as 'consent required' — typically displayed at the
-- physical location with signage. When enabled, the system records who
-- consented (signed_consents) before allowing reveal.
ALTER TABLE public.cameras
  ADD COLUMN IF NOT EXISTS consent_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_text text;

COMMENT ON COLUMN public.cameras.consent_required IS
  'When true, a signed consent notice must be displayed at the camera location. '
  'Operational signal — not a hard technical gate.';;
