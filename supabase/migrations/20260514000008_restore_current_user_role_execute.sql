-- Restore the helper permission required by RLS policies.
--
-- `public.is_admin()` calls `public.current_user_role()`. The previous
-- security-advisor migration revoked direct execution from authenticated users,
-- which also prevents policy evaluation for normal signed-in users.
grant execute on function public.current_user_role() to authenticated;
