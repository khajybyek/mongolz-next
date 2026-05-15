-- Harden profile signup defaults and TOTP secret visibility.
--
-- 1. Never trust client-controlled auth user metadata for role assignment.
--    New users always start as viewer; admins are promoted only through
--    service-role/server-side tooling.
-- 2. `totp_secret` must not be readable by browser clients via the normal
--    authenticated role. Server-side service-role code can still read it for
--    login/setup/verify flows.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke select (totp_secret) on table public.profiles from anon, authenticated;
