-- Tighten public.protect_super_admin() — it's only meant to run as a trigger
-- on the profiles table, never as a public RPC. Supabase advisor flagged that
-- the function was callable by anon / authenticated via /rest/v1/rpc.
--
-- Triggers fire regardless of role grants (function execution uses the table
-- owner's context), so revoking EXECUTE from the public roles does NOT break
-- the protect_super_admin_trigger.

REVOKE EXECUTE ON FUNCTION public.protect_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.protect_super_admin() FROM authenticated;
-- service_role + postgres keep EXECUTE (already granted) so internal tooling
-- can still introspect / disable / drop the trigger if needed.

COMMENT ON FUNCTION public.protect_super_admin() IS
  'BEFORE INSERT/UPDATE/DELETE trigger on public.profiles. Blocks app-level '
  'attempts to demote, delete, or grant the super-admin flag. EXECUTE is '
  'restricted to postgres + service_role — anon / authenticated can never '
  'call it directly via /rest/v1/rpc. The trigger fires regardless because '
  'BEFORE triggers run in the table owner''s context.';
