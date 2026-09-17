-- SCH Esports organiser: full rights over the tournament tables, nothing
-- else. The role exists so the organising students can run /sch/admin
-- without the admin role (which is mandatory-TOTP and reaches biometric
-- data). Registrant data stays behind the mfa restrictive policy: it is
-- fail-open for a profile without TOTP, so an organiser who never enrols a
-- second factor works, and one who does is held to it like everyone else.

create or replace function private.is_sch_organiser()
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_catalog
as $$
  select private.current_user_role() in ('admin', 'organiser')
$$;
revoke execute on function private.is_sch_organiser() from public, anon;
grant execute on function private.is_sch_organiser() to authenticated, service_role;
comment on function private.is_sch_organiser() is
  'True for admin or organiser — the roles that run the SCH Esports console.';

drop policy if exists "sch_event: admin" on public.sch_event;
create policy "sch_event: organiser" on public.sch_event
  for all to authenticated
  using ((select private.is_sch_organiser())) with check ((select private.is_sch_organiser()));

drop policy if exists "sch_teams: admin" on public.sch_teams;
create policy "sch_teams: organiser" on public.sch_teams
  for all to authenticated
  using ((select private.is_sch_organiser())) with check ((select private.is_sch_organiser()));

drop policy if exists "sch_registrations: admin" on public.sch_registrations;
create policy "sch_registrations: organiser" on public.sch_registrations
  for all to authenticated
  using ((select private.is_sch_organiser())) with check ((select private.is_sch_organiser()));
