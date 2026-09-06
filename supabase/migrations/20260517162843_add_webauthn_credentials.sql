-- WebAuthn / passkey credentials.
--
-- Phishing-resistant second factor (or single factor for high-assurance
-- platforms). Each row is one enrolled authenticator — a hardware key,
-- platform passkey (iCloud Keychain, Windows Hello, Android), or
-- cross-device sync provider.
--
-- v1 scope: enroll + list + delete from /settings. Login flow continues to
-- use email/password + TOTP; passkey-as-login is a future addition once
-- the UX is validated.

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,          -- base64url-encoded
  public_key text NOT NULL,                    -- base64url-encoded SPKI
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',     -- e.g. {"internal","hybrid"}
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx
  ON public.webauthn_credentials (user_id);

-- Pending registration challenges. A 5-min single-use HMAC-style record
-- stamped during /register/begin and consumed in /register/finish.
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('register', 'auth')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_user_kind_idx
  ON public.webauthn_challenges (user_id, kind);
CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_idx
  ON public.webauthn_challenges (expires_at);

-- ─── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges  ENABLE ROW LEVEL SECURITY;

-- Users see / manage only their own credentials.
DROP POLICY IF EXISTS "webauthn_credentials: self" ON public.webauthn_credentials;
CREATE POLICY "webauthn_credentials: self"
  ON public.webauthn_credentials
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Challenges: only the service-role API touches them; clients never query
-- directly. Deny all app-side access.
DROP POLICY IF EXISTS "webauthn_challenges: deny" ON public.webauthn_challenges;
CREATE POLICY "webauthn_challenges: deny"
  ON public.webauthn_challenges
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.webauthn_credentials IS
  'Enrolled WebAuthn / passkey credentials per user. v1 supports enroll + '
  'list + delete from /settings; login-with-passkey is a future feature.';
COMMENT ON TABLE public.webauthn_challenges IS
  'Pending WebAuthn register / auth challenges (5-min TTL). Service-role '
  'only — RLS denies all anon/authenticated access.';
