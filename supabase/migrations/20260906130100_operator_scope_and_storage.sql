-- ═══════════════════════════════════════════════════════════════════════
-- Role scope: the auditor role is "audit log only" in the app, but several
-- SELECT policies (and the recordings storage policy) were keyed on
-- `auth.uid() IS NOT NULL`, giving an auditor JWT viewer-level read over
-- REST and the ability to download every recording blob.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function private.is_operator()
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_catalog
as $$
  select private.current_user_role() in ('admin', 'viewer')
$$;
revoke execute on function private.is_operator() from public, anon;
grant execute on function private.is_operator() to authenticated, service_role;
comment on function private.is_operator() is
  'True for admin or viewer (the roles that operate cameras/recordings). Auditor is audit-log only.';

drop policy if exists "cameras: auth read (permission aware)" on public.cameras;
create policy "cameras: operator read (permission aware)" on public.cameras
  for select using (private.is_operator() and private.user_can_see_camera(id));

drop policy if exists "recordings: auth read (permission aware)" on public.recordings;
create policy "recordings: operator read (permission aware)" on public.recordings
  for select using (private.is_operator() and private.user_can_see_camera(camera_id));

drop policy if exists "masking_schedules: auth read" on public.masking_schedules;
create policy "masking_schedules: operator read" on public.masking_schedules
  for select using (private.is_operator());

drop policy if exists "retention_policies: auth read" on public.retention_policies;
create policy "retention_policies: operator read" on public.retention_policies
  for select using (private.is_operator());

-- Storage: the recordings bucket must follow the recordings row policy
-- (permission-aware, operator-only) instead of "any authenticated user".
drop policy if exists "storage: viewer read recordings" on storage.objects;
create policy "storage: operator read recordings (permission aware)" on storage.objects
  for select using (
    bucket_id = 'recordings'
    and private.is_operator()
    and exists (
      select 1 from public.recordings r
      where (r.storage_path = storage.objects.name or r.original_path = storage.objects.name)
        and private.user_can_see_camera(r.camera_id)
    )
  );
