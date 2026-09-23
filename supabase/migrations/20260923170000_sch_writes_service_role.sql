-- SCH Esports tables: writes through the service role only.
--
-- What was open: `authenticated` held INSERT / UPDATE / DELETE (and
-- TRUNCATE / REFERENCES / TRIGGER) on sch_event, sch_registrations and
-- sch_teams. The permissive "…: organiser" policies (20260917131000) admit
-- private.is_sch_organiser(), and the restrictive mfa_ok() policy passes a
-- password-only token for a profile without TOTP — which the organiser role
-- is by owner decision. So the organiser's password plus the public anon key
-- was enough to
--   PATCH /rest/v1/sch_event?id=eq.1  {"payment_info": "<other account>"}
-- and change the bank account the public /sch form tells registrants to pay,
-- with no audit_log row and no SCH_PAYMENT_INFO_CHANGED security_event
-- (both are written only by the server action). The same path could edit,
-- insert or delete registrations and teams behind the ledger.
--
-- Now: every console write runs in a server action with the service client
-- AFTER requireSchOrganiser() (app/(app)/sch/admin/actions.ts,
-- import-actions.ts), which also pins the organiser's session and writes the
-- ledger + alarm. The public form already inserted with the service role
-- (app/sch/actions.ts). SELECT stays with `authenticated`, so the console
-- page keeps reading through RLS + the mfa gate.
--
-- The app does not depend on this migration: the server actions switched to
-- the service client in the same change, so they work before and after it
-- is applied. RLS stays enabled and the policies stay as they are — they
-- still govern SELECT.

revoke insert, update, delete, truncate, references, trigger
  on public.sch_event, public.sch_registrations, public.sch_teams
  from anon, authenticated;

-- anon has no SELECT policy on these tables (RLS denies it anyway); drop the
-- grant so a future permissive policy cannot expose registrants by accident.
revoke select on public.sch_event, public.sch_registrations, public.sch_teams from anon;
