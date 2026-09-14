-- Apply before deploying the durable workers. Input bytes live encrypted on
-- the verified Railway volume; only operator-safe metadata is exposed here.
create table if not exists public.upload_jobs (
  id uuid primary key,
  requested_by uuid not null references auth.users(id) on delete cascade,
  camera_name text not null,
  recording_id uuid not null,
  status text not null default 'queued' check (status in ('queued','processing','delivering','ready','failed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.upload_jobs enable row level security;
create policy "upload_jobs: owner or admin read" on public.upload_jobs
  for select to authenticated using (
    (select private.mfa_ok()) and ((select auth.uid()) = requested_by or (select private.is_admin()))
  );
revoke all on public.upload_jobs from anon, authenticated;
grant select on public.upload_jobs to authenticated;
grant all on public.upload_jobs to service_role;
create index if not exists upload_jobs_active_idx on public.upload_jobs(updated_at)
  where status in ('queued','processing','delivering');

alter table public.reveal_jobs
  add column if not exists worker_lease_token uuid,
  add column if not exists worker_lease_until timestamptz,
  add column if not exists worker_attempts integer not null default 0;

-- A database lease is the fence across containers. Late workers cannot commit
-- progress, failure or output after another attempt has claimed the job.
create or replace function public.claim_reveal_job(p_job_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare token uuid := gen_random_uuid(); claimed uuid;
begin
  update public.reveal_jobs set status='processing', worker_lease_token=token,
    worker_lease_until=now()+interval '90 seconds', worker_attempts=worker_attempts+1,
    started_at=now(), completed_at=null, error_message=null, progress=5
  where id=p_job_id and approved_by is not null and approved_by <> requested_by
    and exists (
      select 1 from public.profiles requester
      where requester.id = reveal_jobs.requested_by and requester.role = 'admin'
    )
    and exists (
      select 1 from public.profiles approver
      where approver.id = reveal_jobs.approved_by and approver.role = 'admin'
        and approver.reveal_level between 0 and 99
        and approver.reveal_level <= reveal_jobs.reveal_level
    )
    and worker_attempts < 5
    and (status='queued' or (status='processing' and (worker_lease_until is null or worker_lease_until < now())))
  returning id into claimed;
  return case when claimed is not null then token else null end;
end;
$$;

create or replace function public.update_reveal_job_lease(p_job_id uuid, p_token uuid, p_fields jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare changed uuid; next_status public.reveal_status;
begin
  if p_fields ? 'status' and p_fields->>'status' not in ('processing','completed','failed') then
    raise exception 'invalid worker transition';
  end if;
  next_status := coalesce(p_fields->>'status','processing')::public.reveal_status;
  if next_status='completed' and (
    p_fields->>'output_path' is distinct from p_job_id::text || '/' || p_token::text || '.mp4'
    or not (p_fields ? 'output_duration_sec')
    or p_fields->>'output_duration_sec' !~ '^\d+$'
  ) then
    raise exception 'invalid attempt output';
  end if;
  update public.reveal_jobs set
    status=next_status,
    progress=case when p_fields ? 'progress' then greatest(0,least(100,(p_fields->>'progress')::integer)) else progress end,
    error_message=case when p_fields ? 'error_message' then p_fields->>'error_message' else error_message end,
    output_path=case when next_status='completed' then p_fields->>'output_path' else output_path end,
    output_duration_sec=case when next_status='completed' then (p_fields->>'output_duration_sec')::integer else output_duration_sec end,
    completed_at=case when next_status in ('completed','failed') then now() else completed_at end,
    worker_lease_until=case when next_status='processing' then now()+interval '90 seconds' else null end,
    worker_lease_token=case when next_status='processing' then worker_lease_token else null end
  where id=p_job_id and status='processing' and worker_lease_token=p_token and worker_lease_until>now()
  returning id into changed;
  return changed is not null;
end;
$$;

revoke all on function public.claim_reveal_job(uuid) from public, anon, authenticated;
revoke all on function public.update_reveal_job_lease(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_reveal_job(uuid) to service_role;
grant execute on function public.update_reveal_job_lease(uuid, uuid, jsonb) to service_role;
