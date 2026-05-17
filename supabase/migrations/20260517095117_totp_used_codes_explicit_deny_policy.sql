
-- Make the deny-all intent explicit so Supabase Security Advisor stops
-- flagging "RLS Enabled No Policy" as a potential mistake. Service-role
-- bypasses RLS anyway, which is how consume_totp_code() (SECURITY DEFINER)
-- continues to work — but anon + authenticated must never see this table.

CREATE POLICY "deny_all_non_service_role" ON public.totp_used_codes
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "deny_all_non_service_role" ON public.totp_used_codes IS
  'Explicit deny-all. Only service_role (which bypasses RLS) can read/write,
   and only through the consume_totp_code() SECURITY DEFINER function.';
;
