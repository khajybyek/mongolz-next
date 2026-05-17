
-- Single-use tracking for TOTP codes within their 30-second validity window.
-- Stores SHA-256(code) keyed by user_id + step; row TTL = 90 s (3 windows).
-- On verify: INSERT...ON CONFLICT raises a unique-violation, which the app
-- translates to "code already used" — defeating replay-within-window attacks.

CREATE TABLE IF NOT EXISTS public.totp_used_codes (
  user_id    uuid NOT NULL,
  code_hash  text NOT NULL,
  used_at    timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_totp_used_codes_expires
  ON public.totp_used_codes (expires_at);

ALTER TABLE public.totp_used_codes ENABLE ROW LEVEL SECURITY;
-- No policies → service_role only (anon + authenticated blocked).

-- Atomic insert-or-reject: SECURITY DEFINER so authenticated users can call
-- it through the existing TOTP verify endpoint without a service-role key.
CREATE OR REPLACE FUNCTION public.consume_totp_code(
  p_user_id   uuid,
  p_code_hash text,
  p_ttl_sec   integer DEFAULT 90
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Hot-path cleanup: drop rows whose TTL expired.
  DELETE FROM public.totp_used_codes WHERE expires_at < now();

  INSERT INTO public.totp_used_codes (user_id, code_hash, expires_at)
  VALUES (p_user_id, p_code_hash, now() + (p_ttl_sec || ' seconds')::interval);

  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;  -- replay detected
END;
$$;

-- Lock down: anon + authenticated must NOT be able to call this directly.
-- We grant only to service_role (used through our server endpoints).
REVOKE ALL ON FUNCTION public.consume_totp_code(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_totp_code(uuid, text, integer)
  TO service_role;
;
