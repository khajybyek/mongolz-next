-- Helper for auditor + combined check
CREATE OR REPLACE FUNCTION private.is_auditor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $$
  SELECT private.current_user_role() = 'auditor'::public.user_role
$$;

CREATE OR REPLACE FUNCTION private.is_admin_or_auditor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $$
  SELECT private.current_user_role() IN ('admin'::public.user_role, 'auditor'::public.user_role)
$$;

REVOKE ALL ON FUNCTION private.is_auditor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_admin_or_auditor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_auditor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin_or_auditor() TO authenticated, service_role;

-- Audit log: auditor can SELECT (read-only)
DROP POLICY IF EXISTS "audit_log: admin read" ON public.audit_log;
CREATE POLICY "audit_log: admin or auditor read" ON public.audit_log
  FOR SELECT
  USING (private.is_admin_or_auditor());

COMMENT ON FUNCTION private.is_auditor() IS
  'True when current user has the auditor role (audit-log read-only).';
COMMENT ON FUNCTION private.is_admin_or_auditor() IS
  'True for admin OR auditor — used by audit_log SELECT policy.';;
