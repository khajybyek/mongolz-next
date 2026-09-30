-- Run against an isolated local database with all migrations applied
-- (`npm run test:sql`). Exercises 20260930120000: the super admin's reveal
-- runs without a second admin's approval, nobody else's can, the kill switch
-- and a demotion stop it, it never runs without its hash-chained ledger row,
-- and the 4-eyes path is unchanged.
--   guard_reveal_self_approval (trigger), reveal_jobs_four_eyes_chk (CHECK),
--   claim_reveal_job(), private/public.super_admin_self_reveal_allowed().
-- Everything runs in one transaction and rolls back.
begin;
do $$
declare
  super_admin uuid;
  admin_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
  recording uuid := gen_random_uuid();
  suspect uuid := gen_random_uuid();
  self_job uuid := gen_random_uuid();
  queued_self_job uuid := gen_random_uuid();
  demoted_job uuid := gen_random_uuid();
  four_eyes_job uuid := gen_random_uuid();
  pending_job uuid := gen_random_uuid();
  unrecorded_job uuid := gen_random_uuid();
  token uuid;
  scope jsonb;
  embedding extensions.vector := array_fill(0::real, array[512])::extensions.vector;
begin
  -- No JWT claims: direct SQL as the owner, as a migration or cron would run.
  perform set_config('request.jwt.claims', '', true);

  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (admin_a,admin_a::text || '@self-reveal-test.invalid',now(),'{}'),
    (admin_b,admin_b::text || '@self-reveal-test.invalid',now(),'{}');
  insert into public.profiles(id,email) values
    (admin_a,admin_a::text || '@self-reveal-test.invalid'),
    (admin_b,admin_b::text || '@self-reveal-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role='admin', reveal_level=0 where id in (admin_a, admin_b);

  -- At most one super admin can exist (partial unique index). Reuse the one a
  -- developer database may already hold; otherwise create one as the owner.
  select id into super_admin from public.profiles where is_super_admin limit 1;
  if super_admin is null then
    super_admin := gen_random_uuid();
    insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
      values (super_admin,super_admin::text || '@self-reveal-test.invalid',now(),'{}');
    insert into public.profiles(id,email)
      values (super_admin,super_admin::text || '@self-reveal-test.invalid')
      on conflict (id) do nothing;
    update public.profiles set is_super_admin=true where id=super_admin;
  end if;
  update public.profiles set role='admin', reveal_level=0 where id=super_admin;
  update private.security_settings set super_admin_self_reveal = true;

  insert into public.recordings(id,filename,storage_path,duration_sec) values
    (recording,'self-reveal.mp4','self-reveal.enc',12.5);
  insert into public.suspects(id,name,image_path,embedding) values
    (suspect,'Self reveal subject','self-reveal.jpg',embedding);
  scope := jsonb_build_object(
    'version',1,
    'recording',jsonb_build_object('id',recording::text,'filename','self-reveal.mp4','duration_sec',12.5),
    'method','suspect',
    'targets',jsonb_build_array(jsonb_build_object('id',suspect::text,'label','Self reveal subject')),
    'threshold',0.45,
    'start_sec',null,
    'end_sec',null
  );

  -- ── verdict helper ──────────────────────────────────────────────────────
  if not public.super_admin_self_reveal_allowed(super_admin) then
    raise exception 'super admin was not allowed to self-approve with the switch on';
  end if;
  if public.super_admin_self_reveal_allowed(admin_a) or public.super_admin_self_reveal_allowed(null) then
    raise exception 'a normal admin (or nobody) was allowed to self-approve';
  end if;

  -- ── 1. super admin: approval_required=false is accepted and claimable ────
  -- The web writes the ledger row BEFORE the job row (lib/reveal-self-
  -- approval.ts#selfApprovalAuditDetail); the claim requires it.
  insert into public.audit_log(action,detail,user_id,user_email) values
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED',
     'job ' || self_job::text || ' · recording=' || recording::text || ' · method=suspect · reason_len=46',
     super_admin,'super@self-reveal-test.invalid');
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,requested_email,
    approved_by,approved_email,approved_at,approval_required,status,reason,request_scope,reveal_level
  ) values (
    self_job,recording,'suspect',suspect,embedding,super_admin,'super@self-reveal-test.invalid',
    super_admin,'super@self-reveal-test.invalid',now(),false,'queued',
    'Super admin investigates the reported incident',scope,0
  );
  token := public.claim_reveal_job(self_job);
  if token is null then raise exception 'self-approved super-admin job was not claimable'; end if;
  if (select status from public.reveal_jobs where id=self_job) <> 'processing' then
    raise exception 'claimed self-approved job is not processing';
  end if;
  -- The worker can still report on it.
  if not public.update_reveal_job_lease(self_job,token,'{"progress":40}') then
    raise exception 'lease owner could not update a self-approved job';
  end if;

  -- A self-approved job is never approved by a second admin.
  begin
    update public.reveal_jobs set approved_by=admin_a where id=self_job;
    raise exception 'a second admin was written onto a self-approved job';
  exception when check_violation then null;
  end;
  begin
    insert into public.reveal_jobs(
      id,recording_id,method,suspect_id,query_embedding,requested_by,
      approved_by,approved_at,approval_required,status,reason,request_scope,reveal_level
    ) values (
      gen_random_uuid(),recording,'suspect',suspect,embedding,super_admin,
      admin_a,now(),false,'queued','Super admin row approved by someone else',scope,0
    );
    raise exception 'self-approved row approved by another admin was accepted';
  exception when check_violation then null;
  end;

  -- ── 1b. no ledger row, no run ───────────────────────────────────────────
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,requested_email,
    approved_by,approved_email,approved_at,approval_required,status,reason,request_scope,reveal_level
  ) values (
    unrecorded_job,recording,'suspect',suspect,embedding,super_admin,'super@self-reveal-test.invalid',
    super_admin,'super@self-reveal-test.invalid',now(),false,'queued',
    'Super admin job inserted without its ledger row',scope,0
  );
  if public.claim_reveal_job(unrecorded_job) is not null then
    raise exception 'self-approved job without a ledger row was claimed';
  end if;
  -- A ledger row for another job, by another user, or of another action
  -- does not count.
  insert into public.audit_log(action,detail,user_id) values
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED','job ' || gen_random_uuid()::text || ' · recording=x · method=suspect · reason_len=40',super_admin),
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED','job ' || unrecorded_job::text || ' · recording=x · method=suspect · reason_len=40',admin_a),
    ('REVEAL_REQUEST','job ' || unrecorded_job::text || ' · recording=x · method=suspect · reason_len=40',super_admin),
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED','recording=x · job ' || unrecorded_job::text || ' · method=suspect',super_admin);
  if public.claim_reveal_job(unrecorded_job) is not null then
    raise exception 'self-approved job was claimed on a ledger row that does not name it';
  end if;
  if (select status from public.reveal_jobs where id=unrecorded_job) <> 'queued' then
    raise exception 'an unclaimable self-approved job changed state';
  end if;
  insert into public.audit_log(action,detail,user_id) values
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED','job ' || unrecorded_job::text || ' · recording=x · method=suspect · reason_len=47',super_admin);
  if public.claim_reveal_job(unrecorded_job) is null then
    raise exception 'self-approved job was not claimable once its ledger row existed';
  end if;

  -- ── 2. a normal admin can never create an unapproved job ────────────────
  begin
    insert into public.reveal_jobs(
      id,recording_id,method,suspect_id,query_embedding,requested_by,
      approved_by,approved_at,approval_required,status,reason,request_scope,reveal_level
    ) values (
      gen_random_uuid(),recording,'suspect',suspect,embedding,admin_a,
      admin_a,now(),false,'queued','Normal admin tries to skip the approval',scope,0
    );
    raise exception 'normal admin created a self-approved job';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reveal_jobs(
      id,recording_id,method,suspect_id,query_embedding,requested_by,
      approval_required,status,reason,request_scope,reveal_level
    ) values (
      gen_random_uuid(),recording,'suspect',suspect,embedding,admin_a,
      false,'pending_approval','Normal admin files an unapproved pending row',scope,0
    );
    raise exception 'normal admin created an approval_required=false pending row';
  exception when insufficient_privilege then null;
  end;

  -- ── 3. self-approval by a normal admin is still refused ─────────────────
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,status,
    reason,request_scope,reveal_level
  ) values (
    pending_job,recording,'suspect',suspect,embedding,admin_a,'pending_approval',
    'Normal admin waits for a second admin',scope,0
  );
  begin
    update public.reveal_jobs set status='queued',approved_by=admin_a,approved_at=now() where id=pending_job;
    raise exception 'normal admin approved their own request';
  exception when check_violation then null;
  end;
  begin
    insert into public.reveal_jobs(
      id,recording_id,method,suspect_id,query_embedding,requested_by,
      approved_by,approved_at,status,reason,request_scope,reveal_level
    ) values (
      gen_random_uuid(),recording,'suspect',suspect,embedding,admin_a,
      admin_a,now(),'queued','Normal admin inserts a self-approved 4-eyes row',scope,0
    );
    raise exception 'self-approved 4-eyes row was accepted';
  exception when check_violation then null;
  end;
  -- approval_required stays immutable after insert (freeze trigger).
  begin
    update public.reveal_jobs set approval_required=false where id=pending_job;
    raise exception 'approval_required was flipped after insert';
  exception when check_violation then null;
  end;
  if public.claim_reveal_job(pending_job) is not null then
    raise exception 'an unapproved 4-eyes job was claimed';
  end if;

  -- ── 4. existing 4-eyes jobs are still claimable ─────────────────────────
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,approved_by,
    approved_at,status,reason,request_scope,reveal_level
  ) values (
    four_eyes_job,recording,'suspect',suspect,embedding,admin_a,admin_b,
    now(),'queued','Second admin approved this investigation',scope,0
  );
  if public.claim_reveal_job(four_eyes_job) is null then
    raise exception '4-eyes job was not claimable';
  end if;
  -- The super admin can still take the normal path and approve someone else's.
  update public.reveal_jobs set status='queued',approved_by=super_admin,approved_at=now() where id=pending_job;
  if public.claim_reveal_job(pending_job) is null then
    raise exception 'job approved by the super admin as second admin was not claimable';
  end if;

  -- ── 5. kill switch off ──────────────────────────────────────────────────
  -- Recorded like the web does, so only the switch can refuse it below.
  insert into public.audit_log(action,detail,user_id) values
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED','job ' || queued_self_job::text || ' · recording=x · method=suspect · reason_len=40',super_admin);
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,
    approved_by,approved_at,approval_required,status,reason,request_scope,reveal_level
  ) values (
    queued_self_job,recording,'suspect',suspect,embedding,super_admin,
    super_admin,now(),false,'queued','Super admin job queued before the switch',scope,0
  );
  update private.security_settings set super_admin_self_reveal = false;
  if public.super_admin_self_reveal_allowed(super_admin) then
    raise exception 'verdict ignored the kill switch';
  end if;
  begin
    insert into public.reveal_jobs(
      id,recording_id,method,suspect_id,query_embedding,requested_by,
      approved_by,approved_at,approval_required,status,reason,request_scope,reveal_level
    ) values (
      gen_random_uuid(),recording,'suspect',suspect,embedding,super_admin,
      super_admin,now(),false,'queued','Super admin job while the switch is off',scope,0
    );
    raise exception 'self-approved insert was accepted with the kill switch off';
  exception when insufficient_privilege then null;
  end;
  if public.claim_reveal_job(queued_self_job) is not null then
    raise exception 'queued self-approved job was claimed with the kill switch off';
  end if;
  -- Historical rows stay updatable: the worker finishes the running job and
  -- the operator can cancel the queued one (header statement).
  if not public.update_reveal_job_lease(self_job,token,jsonb_build_object(
      'status','completed','progress',100,
      'output_path',self_job::text || '/' || token::text || '.mp4',
      'output_duration_sec',2)) then
    raise exception 'running self-approved job could not complete after the switch was turned off';
  end if;
  update public.reveal_jobs
     set status='failed', completed_at=now(),
         error_message='Cancelled: super-admin self-approval disabled'
   where approval_required = false and status = 'queued' and id = queued_self_job;
  if (select status from public.reveal_jobs where id=queued_self_job) <> 'failed' then
    raise exception 'operator could not cancel a queued self-approved job';
  end if;
  update public.reveal_jobs set output_path=null where id=self_job;
  -- The 4-eyes path does not depend on the switch.
  update public.reveal_jobs set worker_lease_until=now()-interval '1 second' where id=four_eyes_job;
  if public.claim_reveal_job(four_eyes_job) is null then
    raise exception '4-eyes job depended on the self-approval switch';
  end if;
  update private.security_settings set super_admin_self_reveal = true;

  -- ── 6. a demoted requester's job is not claimable ───────────────────────
  insert into public.audit_log(action,detail,user_id) values
    ('REVEAL_SUPER_ADMIN_SELF_APPROVED','job ' || demoted_job::text || ' · recording=x · method=suspect · reason_len=35',super_admin);
  insert into public.reveal_jobs(
    id,recording_id,method,suspect_id,query_embedding,requested_by,
    approved_by,approved_at,approval_required,status,reason,request_scope,reveal_level
  ) values (
    demoted_job,recording,'suspect',suspect,embedding,super_admin,
    super_admin,now(),false,'queued','Super admin job before the demotion',scope,0
  );
  update public.profiles set is_super_admin=false where id=super_admin;
  if public.claim_reveal_job(demoted_job) is not null then
    raise exception 'job of a demoted super admin was claimed';
  end if;
  update public.profiles set is_super_admin=true where id=super_admin;
  -- Same for a super admin whose reveal level no longer covers the job.
  update public.profiles set reveal_level=5 where id=super_admin;
  if public.claim_reveal_job(demoted_job) is not null then
    raise exception 'job outside the super admin''s reveal level was claimed';
  end if;
  update public.profiles set reveal_level=0 where id=super_admin;
  if public.claim_reveal_job(demoted_job) is null then
    raise exception 're-promoted super admin job was not claimable';
  end if;

  -- ── 7. privileges ───────────────────────────────────────────────────────
  if has_function_privilege('authenticated','public.super_admin_self_reveal_allowed(uuid)','execute')
     or has_function_privilege('anon','public.super_admin_self_reveal_allowed(uuid)','execute')
     or has_function_privilege('authenticated','private.super_admin_self_reveal_allowed(uuid)','execute') then
    raise exception 'self-approval verdict exposed to a browser role';
  end if;
  if not has_function_privilege('service_role','public.super_admin_self_reveal_allowed(uuid)','execute') then
    raise exception 'service role cannot read the self-approval verdict';
  end if;
  if has_table_privilege('authenticated','public.reveal_jobs','insert')
     or has_table_privilege('authenticated','public.reveal_jobs','update') then
    raise exception 'reveal_jobs became writable with a user token';
  end if;

  raise notice 'Super-admin reveal SQL: self-approval, ledger, guard, kill switch, demotion and 4-eyes assertions passed';
end;
$$;
rollback;
