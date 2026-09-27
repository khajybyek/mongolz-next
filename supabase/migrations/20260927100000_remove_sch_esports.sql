-- Remove the SCH Esports tournament module and the organiser role (owner
-- request, 2026-09-27).
-- safety: ok — the application code that used these objects was removed and
-- deployed BEFORE this migration was applied; every registration row and
-- receipt object was already deleted, and the sch-receipts bucket was removed
-- through the Storage API. Nothing that runs today reads or writes them.
--
-- Kept on purpose: the SCH_* rows in audit_log (append-only, hash-chained;
-- they carry ids and counts only). The earlier SCH migrations stay in the
-- directory because the cloud migration history must match it 1:1.

-- ── 1. Tournament tables (policies, triggers and indexes go with them) ─────
drop table if exists public.sch_registrations;
drop table if exists public.sch_teams;
drop table if exists public.sch_event;

-- ── 2. Helper functions ─────────────────────────────────────────────────────
drop function if exists public.sch_orphan_receipts(integer, integer);
drop function if exists public.sch_touch_updated_at();
drop function if exists private.is_sch_organiser();

-- ── 3. The organiser account ────────────────────────────────────────────────
-- web_vitals.user_id references profiles without a delete action, so the
-- account's telemetry goes first; everything else cascades from auth.users
-- (profile, identities, sessions, push subscriptions, search presets).
delete from public.web_vitals
where user_id in (select id from public.profiles where role::text = 'organiser');
delete from auth.users
where id in (select id from public.profiles where role::text = 'organiser');

-- ── 4. user_role without 'organiser' ────────────────────────────────────────
-- PostgreSQL cannot drop an enum label, so the type is rebuilt. Its only
-- dependents (checked 2026-09-27 via pg_depend) are profiles.role (+ default
-- and profiles_role_idx), private.current_user_role() and the three branding
-- storage policies, which embed a 'admin'::user_role literal. They are
-- dropped and recreated verbatim below; functions that CALL
-- current_user_role() resolve it by name at run time and are unaffected.
drop policy if exists branding_admin_delete on storage.objects;
drop policy if exists branding_admin_update on storage.objects;
drop policy if exists branding_admin_write on storage.objects;
drop function if exists private.current_user_role();

alter type public.user_role rename to user_role_old;
create type public.user_role as enum ('admin', 'viewer', 'auditor');

alter table public.profiles alter column role drop default;
alter table public.profiles
  alter column role type public.user_role using role::text::public.user_role;
alter table public.profiles alter column role set default 'viewer'::public.user_role;

drop type public.user_role_old;

create function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function private.current_user_role() from public, anon;
grant execute on function private.current_user_role() to authenticated, service_role;

create policy branding_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role
    )
  );

create policy branding_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role
    )
  );

create policy branding_admin_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role
    )
  );
