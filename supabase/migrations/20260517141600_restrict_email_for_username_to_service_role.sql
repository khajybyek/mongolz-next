-- Tighten public.email_for_username so it is only callable by the service-role
-- (which Next.js server actions hold), not the anonymous REST API or signed-in
-- users.
--
-- Reason: Supabase advisor flagged both anon and authenticated EXECUTE grants
-- on this SECURITY DEFINER function. The login flow already invokes it via
-- createServiceClient() server-side, so anon / authenticated GRANTs are dead
-- code and an unnecessary username-enumeration / PII-leak vector (a probe
-- against /rest/v1/rpc/email_for_username would reveal username→email
-- mappings).
--
-- After this migration:
--   * service_role: keeps EXECUTE (server actions still work unchanged).
--   * anon / authenticated: REVOKED — `/rest/v1/rpc/email_for_username`
--     returns 401 / 403 for browser-side callers.

REVOKE EXECUTE ON FUNCTION public.email_for_username(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_for_username(text) FROM authenticated;

-- Belt-and-braces: also lock down PUBLIC just in case a future migration grants
-- it again via PUBLIC.
REVOKE EXECUTE ON FUNCTION public.email_for_username(text) FROM PUBLIC;

-- Re-grant explicitly to service_role to make the intent visible.
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO service_role;

COMMENT ON FUNCTION public.email_for_username(text) IS
  'Username → email resolver used by the signInAction server action. '
  'Callable only by service_role; the anonymous + authenticated GRANTs were '
  'removed in 2026-05-17 after Supabase advisor flagged enumeration risk.';
