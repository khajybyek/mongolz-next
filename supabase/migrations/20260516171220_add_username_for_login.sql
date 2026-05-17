ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text UNIQUE;

-- Pre-populate usernames for known accounts
UPDATE public.profiles SET username = 'khajybyek' WHERE email = 'admin@mongolz.local';
UPDATE public.profiles SET username = 'viewer'    WHERE email = 'viewer@mongolz.local';
UPDATE public.profiles SET username = 'auditor'   WHERE email = 'auditor@mongolz.local';

-- Helper RPC that resolves a username to an email (SECURITY DEFINER so anon can
-- call it BEFORE auth). Returns NULL when not found so the caller can fall back
-- to "treat as raw email".
CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT email FROM public.profiles WHERE lower(username) = lower(p_username) LIMIT 1
$$;

-- anon needs to call this BEFORE login — but constrain so it never returns
-- email for any user who has not opted in by having a non-null username.
REVOKE ALL ON FUNCTION public.email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated, service_role;

COMMENT ON COLUMN public.profiles.username IS
  'Optional short login alias. Lookup via email_for_username() during login flow.';
COMMENT ON FUNCTION public.email_for_username(text) IS
  'Resolve a username to the underlying email. SECURITY DEFINER — needed pre-auth.';

-- Verify
SELECT email, username, role FROM public.profiles ORDER BY created_at;;
