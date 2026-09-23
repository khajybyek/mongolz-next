-- Backup storage existence check.
--
-- /api/admin/backup derives each bucket manifest from the database rows that
-- own a path. A row can outlive its object (4 suspects in production point at
-- photos that no longer exist), and `npm run recovery:create` then aborted on
-- the first dangling path. This service-role-only helper returns the names
-- from `p_names` that have NO object in `p_bucket`, so the backup can mark
-- them `missing: true` instead of claiming bytes it cannot mirror.
--
-- Additive: one new function. The backup route treats an absent function as
-- "existence not checked", so it works before and after this migration.

create or replace function public.backup_missing_storage_objects(
  p_bucket text,
  p_names text[]
)
returns table (name text)
language sql
stable
security definer
set search_path = pg_catalog, storage
as $$
  select n.name
  from unnest(coalesce(p_names, '{}'::text[])) as n(name)
  where n.name is not null
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = p_bucket and o.name = n.name
    );
$$;

revoke all on function public.backup_missing_storage_objects(text, text[]) from public, anon, authenticated;
grant execute on function public.backup_missing_storage_objects(text, text[]) to service_role;

comment on function public.backup_missing_storage_objects(text, text[]) is
  'Backup helper (service_role only): names in p_names with no storage.objects row in p_bucket.';
