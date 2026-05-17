-- ─────────────────────────────────────────────────────────────────────────
--  SUPER ADMIN concept
--
--  One profile in the system is marked `is_super_admin = true`. This account
--  behaves like a regular admin everywhere (role='admin', RLS unchanged,
--  helper is_admin() still applies) but gets DB-level protection so that:
--
--    * No app-level request (authenticated / anon role) can DELETE it.
--    * No app-level request can flip `is_super_admin` true→false.
--    * No app-level request can change its `role` away from 'admin'.
--    * No app-level request can promote *another* row to super-admin.
--
--  Only the `postgres` superuser and the `service_role` (Supabase Studio,
--  internal triggers, server actions with the service-role key) can change
--  any of that. The intent is "you can only revoke super-admin from the
--  Supabase dashboard / direct SQL".
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Schema column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- Only one super-admin at a time. Partial unique index on TRUE so we never
-- end up with two protected accounts.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_super_admin_idx
  ON public.profiles ((1)) WHERE is_super_admin = true;

-- 2. Helper accessor (parallels private.is_admin())
CREATE OR REPLACE FUNCTION private.is_super_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM public.profiles WHERE id = p_user_id LIMIT 1),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_super_admin(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.is_super_admin(uuid) TO authenticated, service_role;

-- 3. Protection trigger
CREATE OR REPLACE FUNCTION public.protect_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  caller text := current_user;
  is_privileged boolean;
BEGIN
  -- postgres + service_role bypass everything (Supabase Studio, dashboards,
  -- direct SQL, server actions holding the service key).
  is_privileged := caller IN ('postgres', 'supabase_admin', 'service_role',
                              'supabase_storage_admin', 'supabase_auth_admin');

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_super_admin AND NOT is_privileged THEN
      RAISE EXCEPTION
        'super admin cannot be deleted via app — use Supabase Studio (current_user=%)', caller
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_super_admin AND NOT is_privileged THEN
      RAISE EXCEPTION
        'super admin flag can only be set via Supabase Studio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path
  IF OLD.is_super_admin THEN
    IF NOT is_privileged THEN
      IF NEW.is_super_admin = false THEN
        RAISE EXCEPTION
          'cannot revoke super admin via app — use Supabase Studio'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION
          'cannot change role of super admin via app'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  ELSE
    -- Promoting a non-super-admin to super-admin must also go through Studio.
    IF NEW.is_super_admin AND NOT is_privileged THEN
      RAISE EXCEPTION
        'super admin flag can only be granted via Supabase Studio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_super_admin_trigger ON public.profiles;
CREATE TRIGGER protect_super_admin_trigger
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_super_admin();

-- 4. Promote khajybyek@gmail.com — runs as service_role here, so the trigger
--    lets us through. Idempotent: only sets the flag if not already set, and
--    only if the user actually exists.
UPDATE public.profiles
SET is_super_admin = true,
    role = 'admin'
WHERE lower(email) = 'khajybyek@gmail.com'
  AND NOT is_super_admin;

COMMENT ON COLUMN public.profiles.is_super_admin IS
  'When true, this profile is protected by the protect_super_admin trigger: '
  'app-level callers (authenticated / anon) cannot DELETE, demote, or revoke '
  'the flag. Only Supabase Studio / service_role can. There can be at most '
  'one row with this flag set (enforced by profiles_one_super_admin_idx).';
