-- Minimal schema fixture for an isolated in-memory PostgreSQL test only.
-- Execute with scripts/test-retention-sql.mjs; never apply as a migration.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.retention_policies (
  resource text primary key, retention_days integer, enabled boolean,
  last_swept_at timestamptz, last_swept_rows integer
);
create table public.recordings (
  id uuid primary key default gen_random_uuid(), started_at timestamptz,
  storage_path text, original_path text
);
create table public.faces (
  id uuid primary key default gen_random_uuid(), detected_at timestamptz,
  image_path text, crop_sealed boolean,
  recording_id uuid references public.recordings(id) on delete set null
);
create table public.reveal_jobs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references public.recordings(id) on delete cascade,
  created_at timestamptz, completed_at timestamptz, output_path text
);
create table public.alerts (id uuid primary key default gen_random_uuid(), created_at timestamptz);
create table public.audit_log (
  id bigint generated always as identity primary key,
  action text, detail text, created_at timestamptz default now()
);
create function public.audit_fixture_immutable() returns trigger language plpgsql as $$
begin raise exception 'immutable audit fixture'; end;
$$;
create trigger audit_fixture_immutable before delete or update on public.audit_log
  for each row execute function public.audit_fixture_immutable();
