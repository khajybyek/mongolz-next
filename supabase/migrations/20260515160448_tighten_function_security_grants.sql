-- Fix Supabase Security Advisor warnings (2026-05-16)
--
-- 1. Function Search Path Mutable — suggested_threshold
-- 2. Public Can Execute SECURITY DEFINER Function — current_user_role (anon access)
-- 3. Public Can Execute (anon) for is_admin too
--
-- NOTE: "Signed-In Users Can Execute SECURITY DEFINER" warning for current_user_role
-- is INTENTIONAL — RLS policies (e.g. profiles, alerts) depend on this function.
-- Switching to SECURITY INVOKER would cause infinite recursion via profiles RLS
-- (read policy: id = auth.uid() OR is_admin() → is_admin calls current_user_role
-- → which reads profiles → triggers RLS → recursion).

-- ─── 1. suggested_threshold: set search_path explicitly ───
ALTER FUNCTION public.suggested_threshold(uuid)
  SET search_path = public, pg_catalog;

-- ─── 2-3. Revoke anon (Public) execute on RLS helper functions ───
REVOKE EXECUTE ON FUNCTION public.current_user_role()    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin()             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.suggested_threshold(uuid) FROM anon, PUBLIC;

-- ─── Ensure authenticated/service_role still have access ───
GRANT EXECUTE ON FUNCTION public.current_user_role()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin()             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suggested_threshold(uuid) TO authenticated, service_role;

-- ─── Documentation comment for future auditors ───
COMMENT ON FUNCTION public.current_user_role() IS
  'Returns the role of the currently authenticated user. SECURITY DEFINER is required '
  'because profiles RLS policies depend on this function (avoiding circular dependency). '
  'EXECUTE granted only to authenticated and service_role (anon revoked 2026-05-16).';

COMMENT ON FUNCTION public.is_admin() IS
  'Returns true when current_user_role() = ''admin''. Used in RLS USING/WITH CHECK '
  'expressions across admin-only tables.';

COMMENT ON FUNCTION public.suggested_threshold(uuid) IS
  'F1-optimal threshold calculator from labeled alerts (TP/FP). '
  'Called from /api/alerts/suggested-thresholds.';;
