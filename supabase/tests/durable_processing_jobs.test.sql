-- Run only against an isolated validation database with all migrations applied.
-- Assertions exercise the real PostgreSQL triggers/RPCs; all fixtures roll back.
begin;
do $$
declare
  requester uuid := gen_random_uuid();
  approver uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  recording uuid := gen_random_uuid();
  suspect uuid := gen_random_uuid();
  job uuid := gen_random_uuid();
  self_job uuid := gen_random_uuid();
  viewer_job uuid := gen_random_uuid();
  legacy_job uuid := gen_random_uuid();
  exhausted_job uuid := gen_random_uuid();
  first_token uuid;
  second_token uuid;
  token uuid;
  scope jsonb;
  embedding extensions.vector := array_fill(0::real, array[512])::extensions.vector;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (requester,requester::text || '@durable-test.invalid',now(),'{}'),
    (approver,approver::text || '@durable-test.invalid',now(),'{}'),
    (viewer,viewer::text || '@durable-test.invalid',now(),'{}');
  -- Production creates these through the auth-user trigger. The explicit upsert
  -- keeps this assertion file portable to schema-only validation databases.
  insert into public.profiles(id,email) values
    (requester,requester::text || '@durable-test.invalid'),
    (approver,approver::text || '@durable-test.invalid'),
    (viewer,viewer::text || '@durable-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role='admin', reveal_level=3 where id=requester;
  update public.profiles set role='admin', reveal_level=2 where id=approver;

  insert into public.recordings(id,filename,storage_path,duration_sec) values
    (recording,'fixture.mp4','fixture.enc',12.5);
  insert into public.suspects(id,name,image_path,embedding) values
    (suspect,'Fixture subject','fixture.jpg',embedding);
  scope := jsonb_build_object(
    'version',1,
    'recording',jsonb_build_object('id',recording::text,'filename','fixture.mp4','duration_sec',12.5),
    'method','suspect',
    'targets',jsonb_build_array(jsonb_build_object('id',suspect::text,'label','Fixture subject')),
    'threshold',0.45,
    'start_sec',null,
    'end_sec',null
  );

  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,approved_by,
    approved_at,status,reason,request_scope,reveal_level
  ) values (
    job,recording,'suspect',suspect,embedding,requester,approver,
    now(),'queued','Investigate the isolated test event',scope,3
  );
  first_token := public.claim_reveal_job(job);
  if first_token is null then raise exception 'queued approved admin job was not claimed'; end if;
  if public.claim_reveal_job(job) is not null then raise exception 'active lease was claimed twice'; end if;
  if not public.update_reveal_job_lease(job,first_token,'{"progress":40}') then
    raise exception 'current lease could not update progress';
  end if;

  -- Bad completion metadata must raise without changing the owned attempt.
  begin
    perform public.update_reveal_job_lease(job,first_token,jsonb_build_object(
      'status','completed','output_path','forged.mp4','output_duration_sec',2));
    raise exception 'forged attempt output was accepted';
  exception when check_violation or raise_exception then
    if sqlerrm = 'forged attempt output was accepted' then raise; end if;
  end;
  begin
    perform public.update_reveal_job_lease(job,first_token,jsonb_build_object(
      'status','completed','output_path',job::text || '/' || first_token::text || '.mp4'));
    raise exception 'completion without a duration was accepted';
  exception when check_violation or raise_exception then
    if sqlerrm = 'completion without a duration was accepted' then raise; end if;
  end;

  update public.reveal_jobs set worker_lease_until=now()-interval '1 second' where id=job;
  if public.update_reveal_job_lease(job,first_token,'{"progress":50}') then
    raise exception 'expired lease updated progress';
  end if;
  second_token := public.claim_reveal_job(job);
  if second_token is null or second_token=first_token then raise exception 'expired job did not get a new attempt'; end if;
  if public.update_reveal_job_lease(job,first_token,'{"status":"failed","error_message":"late"}') then
    raise exception 'stale worker failed the new attempt';
  end if;
  if not public.update_reveal_job_lease(job,second_token,jsonb_build_object(
      'status','completed','progress',100,
      'output_path',job::text || '/' || second_token::text || '.mp4',
      'output_duration_sec',2)) then
    raise exception 'current attempt could not publish';
  end if;
  if public.update_reveal_job_lease(job,first_token,'{"status":"failed"}')
     or public.claim_reveal_job(job) is not null then
    raise exception 'terminal result was overwritten or reclaimed';
  end if;
  if (select worker_attempts from public.reveal_jobs where id=job) <> 2 then
    raise exception 'attempt counter did not preserve retries';
  end if;

  -- Self approval and viewer approval remain inert at the database claim.
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,status,
    reason,request_scope,reveal_level
  ) values
    (self_job,recording,'suspect',suspect,embedding,requester,'pending_approval',
     'Investigate a separate isolated event',scope,3),
    (viewer_job,recording,'suspect',suspect,embedding,requester,'pending_approval',
     'Investigate another isolated event',scope,3);
  begin
    update public.reveal_jobs set status='queued',approved_by=requester,approved_at=now() where id=self_job;
    raise exception 'self approval was accepted';
  exception when check_violation then null;
  end;
  if public.claim_reveal_job(self_job) is not null then raise exception 'self-approved request was claimed'; end if;
  update public.reveal_jobs set status='queued',approved_by=viewer,approved_at=now() where id=viewer_job;
  if public.claim_reveal_job(viewer_job) is not null then raise exception 'viewer-approved request was claimed'; end if;

  -- Scope is immutable and must match the actual recording/method/targets.
  begin
    update public.reveal_jobs set suspect_id=gen_random_uuid() where id=self_job;
    raise exception 'target mutation was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.reveal_jobs(
      id,recording_id,method,suspect_id,query_embedding,requested_by,status,
      reason,request_scope,reveal_level
    ) values (
      gen_random_uuid(),recording,'suspect',suspect,embedding,requester,'pending_approval',
      'Investigate a mismatched recording scope',
      jsonb_set(scope,'{recording,id}',to_jsonb(gen_random_uuid()::text)),3
    );
    raise exception 'mismatched scope was accepted';
  exception when check_violation then null;
  end;

  -- Simulate a pre-migration pending row, then prove it can only be rejected.
  alter table public.reveal_jobs disable trigger freeze_reveal_request_scope;
  insert into public.reveal_jobs(id,recording_id,method,requested_by,status)
    values (legacy_job,recording,'suspect',requester,'pending_approval');
  alter table public.reveal_jobs enable trigger freeze_reveal_request_scope;
  begin
    update public.reveal_jobs set status='queued',approved_by=approver,approved_at=now() where id=legacy_job;
    raise exception 'legacy request entered the runnable queue';
  exception when check_violation then null;
  end;
  update public.reveal_jobs set status='rejected',rejected_by=approver,rejected_at=now(),
    rejected_reason='Missing approval scope' where id=legacy_job;

  -- Five expired claims are the hard retry boundary.
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,approved_by,
    approved_at,status,reason,request_scope,reveal_level
  ) values (
    exhausted_job,recording,'suspect',suspect,embedding,requester,approver,
    now(),'queued','Investigate retry exhaustion safely',scope,3
  );
  for attempt in 1..5 loop
    token := public.claim_reveal_job(exhausted_job);
    if token is null then raise exception 'attempt % was not claimable', attempt; end if;
    update public.reveal_jobs set worker_lease_until=now()-interval '1 second' where id=exhausted_job;
  end loop;
  if public.claim_reveal_job(exhausted_job) is not null then raise exception 'sixth attempt exceeded the bound'; end if;

  if not has_column_privilege('authenticated','public.reveal_jobs','request_scope','select')
     or has_column_privilege('authenticated','public.reveal_jobs','reference_sealed','select') then
    raise exception 'approval scope/reference column privileges are wrong';
  end if;
  if has_function_privilege('authenticated','public.claim_reveal_job(uuid)','execute')
     or has_function_privilege('anon','public.update_reveal_job_lease(uuid,uuid,jsonb)','execute') then
    raise exception 'lease mutation was exposed to a browser role';
  end if;
  if has_table_privilege('authenticated','public.upload_jobs','update')
     or has_table_privilege('anon','public.upload_jobs','select') then
    raise exception 'upload mutation or private data was exposed';
  end if;
  if not has_function_privilege('service_role','public.claim_reveal_job(uuid)','execute') then
    raise exception 'service role cannot claim work';
  end if;
  raise notice 'Durable processing SQL: scope, approval, lease, fencing and privilege assertions passed';
end;
$$;
rollback;
