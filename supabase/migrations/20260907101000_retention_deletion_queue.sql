-- Apply before deploying the queue worker. Older workers can still call
-- sweep_retention; the queue safely accumulates until the new worker runs.
create table public.retention_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('recordings', 'faces', 'revealed')),
  object_path text not null check (length(object_path) > 0),
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  locked_until timestamptz,
  last_error text,
  unique (bucket, object_path)
);
create index retention_deletion_queue_available_idx
  on public.retention_deletion_queue (available_at, created_at);
alter table public.retention_deletion_queue enable row level security;
revoke all on public.retention_deletion_queue from public, anon, authenticated;
grant all on public.retention_deletion_queue to service_role;

-- OLD values are captured in the deleting/updating transaction, including
-- reveal_jobs removed by a recording's FK cascade and manual delete paths.
-- If queue insertion fails, the owning row change rolls back too.
create function public.enqueue_retention_storage_deletion()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'recordings' then
    insert into public.retention_deletion_queue (bucket, object_path)
      select 'recordings', p from (values (old.storage_path), (old.original_path)) paths(p)
      where p is not null and p <> ''
      on conflict (bucket, object_path) do nothing;
  elsif tg_table_name = 'faces' then
    if old.image_path is not null and old.image_path <> '' then
      insert into public.retention_deletion_queue (bucket, object_path)
        values ('faces', case when old.crop_sealed then old.image_path || '.enc' else old.image_path end)
        on conflict (bucket, object_path) do nothing;
    end if;
  elsif tg_table_name = 'reveal_jobs' then
    if old.output_path is not null and old.output_path <> '' then
      if tg_op = 'DELETE' or old.output_path is distinct from new.output_path then
        insert into public.retention_deletion_queue (bucket, object_path)
          values ('revealed', old.output_path)
          on conflict (bucket, object_path) do nothing;
      end if;
    end if;
  end if;
  return null; -- AFTER trigger; does not change the owning row
end;
$$;
revoke all on function public.enqueue_retention_storage_deletion() from public, anon, authenticated;

create trigger recordings_queue_storage_delete after delete on public.recordings
  for each row execute function public.enqueue_retention_storage_deletion();
create trigger faces_queue_storage_delete after delete on public.faces
  for each row execute function public.enqueue_retention_storage_deletion();
create trigger reveal_jobs_queue_storage_delete after delete or update of output_path on public.reveal_jobs
  for each row execute function public.enqueue_retention_storage_deletion();

create function public.claim_retention_deletions(p_limit integer default 250)
returns table (id uuid, bucket text, object_path text, lease_token uuid)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  claim_token uuid := gen_random_uuid();
begin
  return query
    with candidates as (
      select q.id from public.retention_deletion_queue q
      where q.available_at <= now()
        and (q.locked_until is null or q.locked_until <= now())
      order by q.available_at, q.created_at, q.id
      limit greatest(1, least(coalesce(p_limit, 250), 500))
      for update skip locked
    )
    update public.retention_deletion_queue q
      set lease_token = claim_token,
          locked_until = now() + interval '5 minutes',
          attempts = q.attempts + 1
      from candidates c where q.id = c.id
      returning q.id, q.bucket, q.object_path, q.lease_token;
end;
$$;

-- A stale worker cannot acknowledge a newer lease. Failures retain paths and
-- back off up to one hour. Already-missing Storage objects count as success.
create function public.settle_retention_deletions(
  p_ids uuid[], p_lease_token uuid, p_error text default null
)
returns integer
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  settled integer;
begin
  if p_error is null then
    delete from public.retention_deletion_queue q
      where q.id = any(p_ids) and q.lease_token = p_lease_token;
  else
    update public.retention_deletion_queue q
      set lease_token = null, locked_until = null,
          available_at = now() + make_interval(secs => least(3600, 60 * power(2, least(q.attempts - 1, 6)))::integer),
          last_error = left(p_error, 2000)
      where q.id = any(p_ids) and q.lease_token = p_lease_token;
  end if;
  get diagnostics settled = row_count;
  return settled;
end;
$$;
revoke all on function public.claim_retention_deletions(integer) from public, anon, authenticated;
revoke all on function public.settle_retention_deletions(uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.claim_retention_deletions(integer) to service_role;
grant execute on function public.settle_retention_deletions(uuid[], uuid, text) to service_role;

create or replace function public.sweep_retention()
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  pol record;
  result jsonb := '{}'::jsonb;
  rows_removed integer;
  cutoff timestamptz;
begin
  for pol in select * from public.retention_policies where enabled order by resource loop
    rows_removed := 0;
    cutoff := now() - make_interval(days => pol.retention_days);
    begin
      if pol.resource = 'recordings' then
        delete from public.recordings where started_at < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'faces' then
        delete from public.faces where detected_at < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'alerts' then
        delete from public.alerts where created_at < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'audit_log' then
        result := result || jsonb_build_object('audit_log_skipped', 'immutable ledger — legal hold');
      elsif pol.resource = 'reveal_jobs' then
        delete from public.reveal_jobs where created_at < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'reveal_outputs' then
        -- The trigger persists OLD.output_path before this cleared reference
        -- becomes visible to another transaction.
        update public.reveal_jobs set output_path = null
          where output_path is not null and coalesce(completed_at, created_at) < cutoff;
        get diagnostics rows_removed = row_count;
      end if;

      if pol.resource <> 'audit_log' then
        update public.retention_policies
          set last_swept_at = now(), last_swept_rows = rows_removed
          where resource = pol.resource;
        result := result || jsonb_build_object(pol.resource, rows_removed);
      end if;
    exception when others then
      -- Preserve independent resource progress. Its row change and queue
      -- insertion roll back together if that resource fails.
      result := result || jsonb_build_object(pol.resource, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  insert into public.audit_log (action, detail) values ('RETENTION_SWEEP', result::text);
  return result;
end;
$$;
revoke execute on function public.sweep_retention() from public, anon, authenticated;
grant execute on function public.sweep_retention() to service_role;
