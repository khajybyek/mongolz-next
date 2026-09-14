-- Preserve the exact context a second administrator is asked to approve.
-- Historical pending requests without context can still be rejected, but can
-- never enter a runnable state. No embeddings or raw references enter audit text.
alter table public.reveal_jobs
  add column request_scope jsonb,
  add column reference_sealed text;

create function public.freeze_reveal_request_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  scope jsonb := new.request_scope;
  required_keys text[];
  scope_target_ids text[];
  expected_recording jsonb;
  expected_targets jsonb;
  expected_embeddings jsonb;
  expected_embedding text;
  source_count integer;
  needs_validation boolean := false;
begin
  if tg_op = 'UPDATE' then
    -- These values decide what the worker decrypts. Text casts are required for
    -- pgvector, which deliberately has no equality operator.
    if new.id is distinct from old.id
       or new.request_scope is distinct from old.request_scope
       or new.reference_sealed is distinct from old.reference_sealed
       or new.reason is distinct from old.reason
       or new.recording_id is distinct from old.recording_id
       or new.method is distinct from old.method
       or new.suspect_id is distinct from old.suspect_id
       or new.face_id is distinct from old.face_id
       or new.face_ids is distinct from old.face_ids
       or new.threshold is distinct from old.threshold
       or new.query_embedding::text is distinct from old.query_embedding::text
       or new.query_embeddings::text is distinct from old.query_embeddings::text
       or new.target_start_sec is distinct from old.target_start_sec
       or new.target_end_sec is distinct from old.target_end_sec
       or new.requested_by is distinct from old.requested_by
       or new.requested_email is distinct from old.requested_email
       or new.reauth_at is distinct from old.reauth_at
       or new.reveal_level is distinct from old.reveal_level
       or new.approval_required is distinct from old.approval_required
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = '23514',
        message = 'Reveal request scope is immutable; submit a new request';
    end if;

    -- Compatibility fence: an old pending row with no scope may be rejected or
    -- failed, but it may never enter a decrypting/output state.
    needs_validation := new.status in ('queued', 'processing', 'completed')
      and new.status is distinct from old.status;
  elsif new.status in ('pending_approval', 'queued', 'processing', 'completed') then
    needs_validation := true;
  end if;

  if not needs_validation then
    return new;
  end if;

  if new.reason is null
     or new.reason is distinct from btrim(new.reason)
     or length(new.reason) < 10
     or length(new.reason) > 1000 then
    raise exception using errcode = '23514', message = 'Reveal reason must contain 10-1000 characters';
  end if;
  if scope is null or jsonb_typeof(scope) is distinct from 'object' then
    raise exception using errcode = '23514', message = 'Reveal request scope is required';
  end if;

  required_keys := array['version','recording','method','targets','threshold','start_sec','end_sec'];
  if new.method = 'upload' then
    required_keys := required_keys || 'reference_sha256';
  end if;
  if not (scope ?& required_keys) or scope - required_keys <> '{}'::jsonb
     or scope->'version' is distinct from '1'::jsonb
     or jsonb_typeof(scope->'method') is distinct from 'string'
     or scope->>'method' is distinct from new.method::text then
    raise exception using errcode = '23514', message = 'Reveal request scope fields do not match the job';
  end if;

  if jsonb_typeof(scope->'recording') is distinct from 'object'
     or not ((scope->'recording') ?& array['id','filename','duration_sec'])
     or (scope->'recording') - array['id','filename','duration_sec'] <> '{}'::jsonb
     or jsonb_typeof(scope#>'{recording,id}') is distinct from 'string'
     or scope#>>'{recording,id}' is distinct from new.recording_id::text
     or jsonb_typeof(scope#>'{recording,filename}') is distinct from 'string'
     or length(btrim(scope#>>'{recording,filename}')) = 0
     or jsonb_typeof(scope#>'{recording,duration_sec}') not in ('number','null') then
    raise exception using errcode = '23514', message = 'Reveal recording scope does not match the job';
  end if;

  if jsonb_typeof(scope->'threshold') is distinct from 'number'
     or (scope->>'threshold')::real is distinct from new.threshold then
    raise exception using errcode = '23514', message = 'Reveal threshold scope does not match the job';
  end if;
  if new.target_start_sec is null then
    if scope->'start_sec' is distinct from 'null'::jsonb then
      raise exception using errcode = '23514', message = 'Reveal time scope does not match the job';
    end if;
  elsif jsonb_typeof(scope->'start_sec') is distinct from 'number'
        or (scope->>'start_sec')::real is distinct from new.target_start_sec then
    raise exception using errcode = '23514', message = 'Reveal time scope does not match the job';
  end if;
  if new.target_end_sec is null then
    if scope->'end_sec' is distinct from 'null'::jsonb then
      raise exception using errcode = '23514', message = 'Reveal time scope does not match the job';
    end if;
  elsif jsonb_typeof(scope->'end_sec') is distinct from 'number'
        or (scope->>'end_sec')::real is distinct from new.target_end_sec then
    raise exception using errcode = '23514', message = 'Reveal time scope does not match the job';
  end if;

  if jsonb_typeof(scope->'targets') is distinct from 'array'
     or jsonb_array_length(scope->'targets') = 0
     or jsonb_array_length(scope->'targets') > 50
     or exists (
       select 1
       from jsonb_array_elements(scope->'targets') as target(value)
       where jsonb_typeof(value) is distinct from 'object'
          or not (value ?& array['id','label'])
          or value - array['id','label'] <> '{}'::jsonb
          or jsonb_typeof(value->'id') is distinct from 'string'
          or jsonb_typeof(value->'label') is distinct from 'string'
          or length(btrim(value->>'label')) = 0
     ) then
    raise exception using errcode = '23514', message = 'Reveal target scope is invalid';
  end if;
  select array_agg(target.value->>'id' order by target.ordinality)
    into scope_target_ids
    from jsonb_array_elements(scope->'targets') with ordinality as target(value, ordinality);
  if cardinality(scope_target_ids) <> (select count(distinct id) from unnest(scope_target_ids) as ids(id)) then
    raise exception using errcode = '23514', message = 'Reveal target scope contains duplicates';
  end if;

  if new.method = 'upload' then
    if new.suspect_id is not null or new.face_id is not null or new.face_ids is not null
       or new.query_embedding is null or new.query_embeddings is not null
       or new.reference_sealed is null or new.reference_sealed = ''
       or jsonb_typeof(scope->'reference_sha256') is distinct from 'string'
       or scope->>'reference_sha256' !~ '^[0-9a-f]{64}$'
       or cardinality(scope_target_ids) <> 1
       or scope_target_ids[1] is distinct from scope->>'reference_sha256' then
      raise exception using errcode = '23514', message = 'Upload reveal target does not match the job';
    end if;
    if length(new.reference_sealed) % 4 <> 0
       or new.reference_sealed !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception using errcode = '23514', message = 'Encrypted approval reference is invalid';
    end if;
    if octet_length(decode(new.reference_sealed, 'base64')) <= 28 then
      raise exception using errcode = '23514', message = 'Encrypted approval reference is invalid';
    end if;
  elsif new.method = 'suspect' then
    if new.suspect_id is null or new.face_id is not null or new.face_ids is not null
       or new.query_embedding is null or new.query_embeddings is not null
       or new.reference_sealed is not null
       or cardinality(scope_target_ids) <> 1
       or scope_target_ids[1] is distinct from new.suspect_id::text then
      raise exception using errcode = '23514', message = 'Suspect reveal target does not match the job';
    end if;
  elsif new.method = 'detected_face' then
    if new.suspect_id is not null or new.reference_sealed is not null
       or new.face_ids is null or cardinality(new.face_ids) = 0 or cardinality(new.face_ids) > 50
       or cardinality(new.face_ids) <> (select count(distinct id) from unnest(new.face_ids) as ids(id))
       or scope_target_ids is distinct from new.face_ids::text[]
       or jsonb_typeof(new.query_embeddings) is distinct from 'array'
       or jsonb_array_length(new.query_embeddings) <> cardinality(new.face_ids)
       or (cardinality(new.face_ids) = 1 and (new.face_id is distinct from new.face_ids[1] or new.query_embedding is null))
       or (cardinality(new.face_ids) > 1 and (new.face_id is not null or new.query_embedding is not null)) then
      raise exception using errcode = '23514', message = 'Detected-face reveal targets do not match the job';
    end if;
  end if;

  -- On creation, snapshot labels/duration and stored embeddings must be the
  -- current source rows. Later source edits cannot rewrite this frozen request.
  if tg_op = 'INSERT' then
    select jsonb_build_object('id', r.id::text, 'filename', r.filename, 'duration_sec', r.duration_sec)
      into expected_recording from public.recordings r where r.id = new.recording_id;
    if expected_recording is null or scope->'recording' is distinct from expected_recording then
      raise exception using errcode = '23514', message = 'Reveal recording snapshot is invalid';
    end if;

    if new.method = 'suspect' then
      select jsonb_build_array(jsonb_build_object('id', s.id::text, 'label', s.name)), s.embedding::text
        into expected_targets, expected_embedding
        from public.suspects s where s.id = new.suspect_id;
      if scope->'targets' is distinct from expected_targets
         or new.query_embedding::text is distinct from expected_embedding then
        raise exception using errcode = '23514', message = 'Reveal suspect snapshot is invalid';
      end if;
    elsif new.method = 'detected_face' then
      select jsonb_agg(jsonb_build_object('id', f.id::text, 'label', f.filename) order by picked.ordinality),
             jsonb_agg(to_jsonb(f.embedding::text) order by picked.ordinality),
             count(f.id)
        into expected_targets, expected_embeddings, source_count
        from unnest(new.face_ids) with ordinality as picked(id, ordinality)
        join public.faces f on f.id = picked.id;
      if source_count <> cardinality(new.face_ids)
         or scope->'targets' is distinct from expected_targets
         or new.query_embeddings is distinct from expected_embeddings
         or (cardinality(new.face_ids) = 1 and new.query_embedding::text is distinct from (expected_embeddings->>0)) then
        raise exception using errcode = '23514', message = 'Reveal face snapshot is invalid';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.freeze_reveal_request_scope() from public, anon, authenticated;
create trigger freeze_reveal_request_scope before insert or update on public.reveal_jobs
  for each row execute function public.freeze_reveal_request_scope();

-- The approval list reads only the frozen JSON under the existing RLS policy.
-- The encrypted reference remains service-only and is served through the
-- reauthenticated, authority-checked media endpoint.
grant select (request_scope) on public.reveal_jobs to authenticated;
revoke select (reference_sealed) on public.reveal_jobs from public, anon, authenticated;

-- Add the scope fence to durable claiming after the new columns exist. Already
-- processing historical work is untouched; old/forged queued rows cannot start.
create or replace function public.claim_reveal_job(p_job_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare token uuid := gen_random_uuid(); claimed uuid;
begin
  update public.reveal_jobs as job set status='processing', worker_lease_token=token,
    worker_lease_until=now()+interval '90 seconds', worker_attempts=worker_attempts+1,
    started_at=now(), completed_at=null, error_message=null, progress=5
  where job.id=p_job_id and job.approval_required and job.approved_by is not null
    and job.approved_by <> job.requested_by and job.approved_at is not null
    and job.request_scope is not null and job.reason is not null
    and length(btrim(job.reason)) between 10 and 1000
    and job.worker_attempts < 5
    and (job.status='queued' or (job.status='processing' and (job.worker_lease_until is null or job.worker_lease_until < now())))
    and exists (
      select 1 from public.profiles requester
      join public.profiles approver on approver.id = job.approved_by
      where requester.id = job.requested_by
        and requester.role = 'admin' and approver.role = 'admin'
        and requester.reveal_level between 0 and 99
        and approver.reveal_level between 0 and 99
        and requester.reveal_level <= job.reveal_level
        and approver.reveal_level <= job.reveal_level
    )
  returning job.id into claimed;
  return case when claimed is not null then token else null end;
end;
$$;
revoke all on function public.claim_reveal_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_reveal_job(uuid) to service_role;
