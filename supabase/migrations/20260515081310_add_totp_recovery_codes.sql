-- Store hashed (SHA-256) one-time recovery codes for TOTP lockout recovery.
-- Plaintext codes are shown to the user exactly ONCE at setup; only hashes
-- live in the DB. Each code is consumed on use.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS totp_recovery_codes text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.profiles.totp_recovery_codes IS
  'SHA-256 hex hashes of one-time TOTP recovery codes. Empty array = none/exhausted.';;
