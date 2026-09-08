-- Reveal output is delivered only through the Next media gateway, where the
-- current profile AND the custom fresh-reauth cookie are checked per request.
-- A Supabase JWT does not carry that cookie: no authenticated Storage policy
-- may grant direct access to the revealed bucket, even to a director.
-- Deploy this migration before the new web gateway. The old web version will
-- temporarily fail to sign reveal output; other playback remains available.
-- Already-issued Storage signed URLs expire independently (old TTL: 15 min).

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_reveal_level_range' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_reveal_level_range
      check (reveal_level between 0 and 99) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reveal_jobs_reveal_level_range' and conrelid = 'public.reveal_jobs'::regclass) then
    alter table public.reveal_jobs add constraint reveal_jobs_reveal_level_range
      check (reveal_level between 0 and 99) not valid;
  end if;
end;
$$;
-- NOT VALID preserves historical rows for investigation. Invalid historical
-- authority is denied by both the helper below and the application; never
-- silently rewrite it to privileged level zero.

create or replace function private.can_read_reveal_level(output_level integer)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.reveal_level between 0 and 99
      and output_level between 0 and 99
      and p.reveal_level <= output_level
  )
$$;
revoke all on function private.can_read_reveal_level(integer) from public, anon;
grant execute on function private.can_read_reveal_level(integer) to authenticated, service_role;

-- Direct writes could otherwise rewrite output_path, lower reveal_level or
-- approve a job without fresh reauth. All legitimate mutations already use
-- the service role. Direct reads expose only operator/history metadata.
revoke all on public.reveal_jobs from public, anon, authenticated;
grant select (
  id, recording_id, method, threshold, status, progress, output_duration_sec,
  error_message, requested_by, requested_email, reauth_at, created_at,
  started_at, completed_at, face_id, face_ids, suspect_id, reason,
  approval_required, approved_by, approved_email, approved_at,
  rejected_by, rejected_email, rejected_at, rejected_reason,
  target_start_sec, target_end_sec, reveal_level
) on public.reveal_jobs to authenticated;

drop policy if exists "reveal_jobs: admin write" on public.reveal_jobs;
drop policy if exists "reveal_jobs: admin read" on public.reveal_jobs;
create policy "reveal_jobs: scoped metadata read" on public.reveal_jobs
  for select to authenticated
  using (private.can_read_reveal_level(reveal_level));
-- Restrictive policy also protects against any other permissive SELECT policy.
create policy "reveal_jobs: authority boundary" on public.reveal_jobs
  as restrictive for select to authenticated
  using (private.can_read_reveal_level(reveal_level));

update storage.buckets set public = false where id = 'revealed';
-- This restrictive policy wins over the existing admin all-buckets policy.
-- Block reads AND moves/copies/writes that could relocate plaintext output.
create policy "storage: revealed requires app reauth" on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'revealed')
  with check (bucket_id <> 'revealed');
