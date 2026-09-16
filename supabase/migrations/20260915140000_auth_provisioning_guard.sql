-- Account provisioning must be enforced by GoTrue configuration:
--   auth.enable_signup = false
--   auth.email.enable_signup = true (keeps password sign-in available)
--
-- `email_confirmed_at` is still NULL while GoTrue runs the auth.users INSERT
-- trigger, even when auth.admin.createUser({ email_confirm: true }) was used.
-- The old trigger check therefore rejected both public sign-ups and every
-- legitimate administrator-created account. GoTrue rejects the public route
-- before the INSERT, while this trigger assigns every admitted account the
-- least-privileged viewer role regardless of caller metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
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

revoke execute on function public.handle_new_user() from anon, authenticated, public;
grant execute on function public.handle_new_user() to supabase_auth_admin;
