-- Per-suspect privacy tier.
--
-- Capstone's masking algorithm currently applies the same Cubist mosaic to
-- every detected face. In real GDPR/PIPA workflows the protection level
-- varies by who the person is:
--
--   * vip       — protected witness / minor / VIP source. Strongest mask,
--                 reveal requires ALL admins to approve (future), audit log
--                 always includes the suspect_id.
--   * standard  — default case. Current behaviour.
--   * relaxed   — public figure / known offender whose face has news value
--                 anyway. Lighter mask, faster reveal flow.
--
-- For now only `standard` is exercised. The tier is exposed via a new column
-- and reused by the ML pipeline (next deploy) to pick mask strength.

CREATE TYPE public.suspect_privacy_tier AS ENUM ('vip', 'standard', 'relaxed');

ALTER TABLE public.suspects
  ADD COLUMN IF NOT EXISTS privacy_tier public.suspect_privacy_tier
    NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.suspects.privacy_tier IS
  'Mask strength tier. VIP → strongest mask + 4-eyes reveal; standard → '
  'default behaviour; relaxed → lighter mask for public figures.';

CREATE INDEX IF NOT EXISTS suspects_privacy_tier_idx
  ON public.suspects (privacy_tier);
