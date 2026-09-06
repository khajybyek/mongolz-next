-- public.ping(): a real, side-effect-free PostgREST → Postgres round-trip for
-- the anonymous uptime probe (/api/uptime, dashboard status card).
-- Every table policy calls private.* helpers that `anon` may not execute, so
-- a table query from the anon key errors with 42501 instead of proving the
-- database is up.
create or replace function public.ping()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$ select true $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated, service_role;
comment on function public.ping() is 'Liveness probe for /api/uptime — returns true; no data access.';
