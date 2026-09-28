-- Run against an isolated local database with all migrations applied
-- (`npm run test:sql`). Exercises the real security functions that the app's
-- Jest suites only cover through JavaScript mirrors:
--   private.mfa_ok(), public.rate_limit_hit()/rate_limit_release(), the
--   audit_log hash chain + verify_audit_chain(), private.user_can_see_camera(),
--   protect_super_admin() and the service-role-only write grants.
-- Everything runs in one transaction and rolls back. Ids are handed between
-- the DO blocks through transaction-local `mongolz_test.*` settings because
-- the role switches (`set local role authenticated`) must happen at top level.
begin;

-- ---------------------------------------------------------------------------
-- Fixtures: a TOTP admin, a non-TOTP admin, a viewer, a second viewer, a
-- super admin, a camera and a face.
-- ---------------------------------------------------------------------------
do $$
declare
  totp_admin uuid := gen_random_uuid();
  plain_admin uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  other_viewer uuid := gen_random_uuid();
  super_admin uuid;
  camera uuid := gen_random_uuid();
  face uuid := gen_random_uuid();
begin
  -- No JWT claims: direct SQL as the owner, as a migration or cron would run.
  perform set_config('request.jwt.claims', '', true);

  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (totp_admin,totp_admin::text || '@security-test.invalid',now(),'{}'),
    (plain_admin,plain_admin::text || '@security-test.invalid',now(),'{}'),
    (viewer,viewer::text || '@security-test.invalid',now(),'{}'),
    (other_viewer,other_viewer::text || '@security-test.invalid',now(),'{}');
  -- Production creates these through the auth-user trigger; the upsert keeps
  -- the file portable to schema-only validation databases.
  insert into public.profiles(id,email) values
    (totp_admin,totp_admin::text || '@security-test.invalid'),
    (plain_admin,plain_admin::text || '@security-test.invalid'),
    (viewer,viewer::text || '@security-test.invalid'),
    (other_viewer,other_viewer::text || '@security-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role='admin', totp_enabled=true where id=totp_admin;
  update public.profiles set role='admin', totp_enabled=false where id=plain_admin;
  update public.profiles set role='viewer', totp_enabled=false where id in (viewer,other_viewer);

  -- At most one super admin can exist (partial unique index). Reuse the one a
  -- developer database may already hold; otherwise create one as the owner.
  select id into super_admin from public.profiles where is_super_admin limit 1;
  if super_admin is null then
    super_admin := gen_random_uuid();
    insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
      values (super_admin,super_admin::text || '@security-test.invalid',now(),'{}');
    insert into public.profiles(id,email)
      values (super_admin,super_admin::text || '@security-test.invalid')
      on conflict (id) do nothing;
    update public.profiles set role='admin', is_super_admin=true where id=super_admin;
  end if;

  insert into public.cameras(id,name,url,cam_type)
    values (camera,'Security fixture camera','demo://security-fixture','demo');
  insert into public.faces(id,filename,image_path,embedding,camera_id)
    values (face,'security-fixture.jpg','fixture/security.jpg',
            array_fill(1::real, array[512])::extensions.vector,camera);

  perform set_config('mongolz_test.totp_admin', totp_admin::text, true);
  perform set_config('mongolz_test.plain_admin', plain_admin::text, true);
  perform set_config('mongolz_test.viewer', viewer::text, true);
  perform set_config('mongolz_test.other_viewer', other_viewer::text, true);
  perform set_config('mongolz_test.super_admin', super_admin::text, true);
  perform set_config('mongolz_test.camera', camera::text, true);
  perform set_config('mongolz_test.face', face::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- private.mfa_ok(): the data-tier second factor.
-- ---------------------------------------------------------------------------
do $$
declare
  totp_admin text := current_setting('mongolz_test.totp_admin');
  plain_admin text := current_setting('mongolz_test.plain_admin');
  viewer text := current_setting('mongolz_test.viewer');
begin
  if (select mfa_required from private.security_settings where id) is not true then
    raise exception 'fixture precondition: private.security_settings.mfa_required must be true';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',1)))::text, true);
  if private.mfa_ok() then raise exception 'mfa_ok accepted a password-only token for a TOTP profile'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','amr',jsonb_build_array('password'))::text, true);
  if private.mfa_ok() then raise exception 'mfa_ok accepted a string-form password-only amr'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',1)))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused an otp session for a TOTP profile'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password'),jsonb_build_object('method','totp')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a password+totp session'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',plain_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a non-TOTP admin'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',viewer,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a non-TOTP viewer'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused service_role'; end if;

  perform set_config('request.jwt.claims', '', true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a claim-less owner session'; end if;

  -- Kill switch: with mfa_required off the password-only token passes.
  update private.security_settings set mfa_required=false where id;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok ignored the mfa_required kill switch'; end if;
  update private.security_settings set mfa_required=true where id;
  if private.mfa_ok() then raise exception 'mfa_ok did not re-arm after the kill switch'; end if;
end;
$$;

-- End to end: the same admin reads the face through RLS with an otp session
-- and sees nothing with a password-only session.
do $$
declare
  totp_admin text := current_setting('mongolz_test.totp_admin');
  face uuid := current_setting('mongolz_test.face')::uuid;
  seen_otp bigint;
  seen_password bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  set local role authenticated;
  select count(*) into seen_otp from public.faces where id = face;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  set local role authenticated;
  select count(*) into seen_password from public.faces where id = face;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if seen_otp <> 1 then
    raise exception 'RLS hid the face from a TOTP admin with an otp session (saw %)', seen_otp;
  end if;
  if seen_password <> 0 then
    raise exception 'RLS showed a face to a password-only token of a TOTP admin (saw %)', seen_password;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- public.rate_limit_hit() / rate_limit_release(): atomic fixed-window buckets.
-- ---------------------------------------------------------------------------
do $$
declare
  k text := 'sql-test:' || gen_random_uuid()::text;
  peek_key text := 'sql-test-peek:' || gen_random_uuid()::text;
  r jsonb;
  failed boolean;
begin
  -- A peek (cost 0) on an unknown key reports an empty bucket and creates
  -- nothing (the passkey route peeks with caller-supplied e-mails).
  r := public.rate_limit_hit(peek_key, 60, 2, 0);
  if (r->>'count')::int <> 0 or (r->>'limited')::boolean then
    raise exception 'peek on an empty bucket reported %', r;
  end if;
  if exists (select 1 from private.rate_limits where key = peek_key) then
    raise exception 'a cost-0 peek created a rate_limits row';
  end if;

  -- Each hit increments exactly once and returns the post-increment count;
  -- the limit trips only above p_max.
  r := public.rate_limit_hit(k, 60, 2);
  if (r->>'count')::int <> 1 or (r->>'limited')::boolean then raise exception 'first hit returned %', r; end if;
  r := public.rate_limit_hit(k, 60, 2);
  if (r->>'count')::int <> 2 or (r->>'limited')::boolean then raise exception 'second hit returned %', r; end if;
  r := public.rate_limit_hit(k, 60, 2);
  if (r->>'count')::int <> 3 or not (r->>'limited')::boolean then raise exception 'third hit returned %', r; end if;
  if (r->>'window_sec')::int <> 60 or (r->>'reset_sec')::int not between 1 and 60 then
    raise exception 'window metadata wrong: %', r;
  end if;
  if (select hits from private.rate_limits where key = k) <> 3 then
    raise exception 'stored hits diverged from the returned count';
  end if;

  -- A peek on a live bucket reports it without spending anything.
  r := public.rate_limit_hit(k, 60, 2, 0);
  if (r->>'count')::int <> 3 or not (r->>'limited')::boolean then raise exception 'peek on live bucket returned %', r; end if;
  if (select hits from private.rate_limits where key = k) <> 3 then raise exception 'a peek spent a hit'; end if;

  -- cost > 1 is charged in one step.
  r := public.rate_limit_hit(k, 60, 10, 4);
  if (r->>'count')::int <> 7 then raise exception 'cost 4 hit returned %', r; end if;

  -- rate_limit_release refunds, never below zero.
  perform public.rate_limit_release(k, 60, 5);
  if (select hits from private.rate_limits where key = k) <> 2 then raise exception 'release did not refund 5'; end if;
  perform public.rate_limit_release(k, 60, 50);
  if (select hits from private.rate_limits where key = k) <> 0 then raise exception 'release went below zero'; end if;

  -- Window reset: once the window has elapsed, a peek reports empty without
  -- touching the row, and the next hit starts a fresh window at 1.
  update private.rate_limits
     set hits = 9, window_start = clock_timestamp() - interval '61 seconds',
         expires_at = clock_timestamp() - interval '1 second'
   where key = k;
  r := public.rate_limit_hit(k, 60, 2, 0);
  if (r->>'count')::int <> 0 or (r->>'limited')::boolean then raise exception 'peek on expired window returned %', r; end if;
  if (select hits from private.rate_limits where key = k) <> 9 then raise exception 'peek rewrote an expired row'; end if;
  r := public.rate_limit_hit(k, 60, 2);
  if (r->>'count')::int <> 1 or (r->>'limited')::boolean then raise exception 'hit after window expiry returned %', r; end if;
  if (select window_start from private.rate_limits where key = k) < clock_timestamp() - interval '5 seconds' then
    raise exception 'window_start was not rolled forward';
  end if;
  -- Releasing into an expired window is a no-op.
  update private.rate_limits set window_start = clock_timestamp() - interval '61 seconds' where key = k;
  perform public.rate_limit_release(k, 60, 1);
  if (select hits from private.rate_limits where key = k) <> 1 then raise exception 'release touched an expired window'; end if;

  -- Argument validation.
  foreach k in array array['', repeat('x', 201)] loop
    failed := false;
    begin
      perform public.rate_limit_hit(k, 60, 2);
    exception when invalid_parameter_value then failed := true;
    end;
    if not failed then raise exception 'rate_limit_hit accepted key of length %', length(k); end if;
  end loop;
  failed := false;
  begin perform public.rate_limit_hit('sql-test:bad-window', 0, 2);
  exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'rate_limit_hit accepted window_sec 0'; end if;
  failed := false;
  begin perform public.rate_limit_hit('sql-test:bad-cost', 60, 2, -1);
  exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'rate_limit_hit accepted a negative cost'; end if;

  -- Only the server may spend or refund buckets.
  if has_function_privilege('anon','public.rate_limit_hit(text,integer,integer,integer)','execute')
     or has_function_privilege('authenticated','public.rate_limit_hit(text,integer,integer,integer)','execute')
     or has_function_privilege('anon','public.rate_limit_release(text,integer,integer)','execute')
     or has_function_privilege('authenticated','public.rate_limit_release(text,integer,integer)','execute') then
    raise exception 'anon/authenticated can execute the rate-limit RPCs';
  end if;
  if not has_function_privilege('service_role','public.rate_limit_hit(text,integer,integer,integer)','execute') then
    raise exception 'service_role lost execute on rate_limit_hit';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.user_can_see_camera(): default-allow until a grant exists.
-- ---------------------------------------------------------------------------
do $$
declare
  camera uuid := current_setting('mongolz_test.camera')::uuid;
  viewer text := current_setting('mongolz_test.viewer');
  other_viewer text := current_setting('mongolz_test.other_viewer');
  plain_admin text := current_setting('mongolz_test.plain_admin');
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',viewer,'role','authenticated')::text, true);
  if not private.user_can_see_camera(camera) then
    raise exception 'viewer refused a camera with no camera_permissions rows (default-allow)';
  end if;
  if not public.user_can_see_camera(camera) then
    raise exception 'public wrapper disagrees with private.user_can_see_camera';
  end if;

  -- A grant to someone else closes the camera to everyone else.
  insert into public.camera_permissions(camera_id,user_id,permission)
    values (camera, other_viewer::uuid, 'view');
  if private.user_can_see_camera(camera) then
    raise exception 'viewer still sees a camera granted only to another user';
  end if;
  if public.user_can_see_camera(camera) then
    raise exception 'public wrapper leaked a granted camera';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',other_viewer,'role','authenticated')::text, true);
  if not private.user_can_see_camera(camera) then
    raise exception 'grantee refused the camera they were granted';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',plain_admin,'role','authenticated')::text, true);
  if not private.user_can_see_camera(camera) then
    raise exception 'admin refused a granted camera (admins always pass)';
  end if;

  -- An explicit grant to the viewer reopens it for them.
  insert into public.camera_permissions(camera_id,user_id,permission)
    values (camera, viewer::uuid, 'view');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',viewer,'role','authenticated')::text, true);
  if not private.user_can_see_camera(camera) then
    raise exception 'viewer refused after an explicit grant';
  end if;

  -- Anonymous callers (no sub) only get default-allow cameras.
  perform set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  if private.user_can_see_camera(camera) then
    raise exception 'anonymous caller sees a granted camera';
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- protect_super_admin(): an authenticated JWT cannot demote, re-role or
-- delete the super admin; a service_role JWT can.
-- ---------------------------------------------------------------------------
do $$
declare
  super_admin uuid := current_setting('mongolz_test.super_admin')::uuid;
  plain_admin uuid := current_setting('mongolz_test.plain_admin')::uuid;
  refused boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',plain_admin::text,'role','authenticated')::text, true);

  refused := false;
  begin
    update public.profiles set is_super_admin=false where id=super_admin;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'authenticated JWT demoted the super admin'; end if;

  refused := false;
  begin
    update public.profiles set role='viewer' where id=super_admin;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'authenticated JWT changed the super admin role'; end if;

  refused := false;
  begin
    delete from public.profiles where id=super_admin;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'authenticated JWT deleted the super admin'; end if;

  refused := false;
  begin
    update public.profiles set is_super_admin=true where id=plain_admin;
  exception when insufficient_privilege or unique_violation then refused := true;
  end;
  if not refused then raise exception 'authenticated JWT granted the super admin flag'; end if;

  if not (select is_super_admin and role = 'admin' from public.profiles where id=super_admin) then
    raise exception 'super admin row changed despite the refusals';
  end if;

  -- Ordinary profile edits on the super admin still work.
  update public.profiles set full_name='Security fixture' where id=super_admin;

  -- The server (service_role claims) may demote; the rollback undoes it.
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  update public.profiles set is_super_admin=false where id=super_admin;
  if (select is_super_admin from public.profiles where id=super_admin) then
    raise exception 'service_role could not demote the super admin';
  end if;
  update public.profiles set is_super_admin=true where id=super_admin;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role-only tables: anon/authenticated hold no write privilege, and
-- the audit verifier is not callable by them either.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  r text;
  p text;
  offenders text[] := '{}';
begin
  foreach t in array array['cameras','retention_policies','camera_permissions','push_subscriptions',
                           'webauthn_credentials','suspects','privacy_zones',
                           'masking_schedules','recording_privacy_spans'] loop
    foreach r in array array['anon','authenticated'] loop
      foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
        if has_table_privilege(r, 'public.' || t, p) then
          offenders := offenders || format('%s:%s:%s', r, t, p);
        end if;
      end loop;
    end loop;
    if not has_table_privilege('service_role', 'public.' || t, 'INSERT') then
      offenders := offenders || format('service_role:%s:INSERT missing', t);
    end if;
  end loop;
  if cardinality(offenders) > 0 then
    raise exception 'unexpected write privileges on service-role-only tables: %', offenders;
  end if;

  if has_function_privilege('anon','public.verify_audit_chain()','execute')
     or has_function_privilege('authenticated','public.verify_audit_chain()','execute') then
    raise exception 'verify_audit_chain is executable by anon/authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit chain: trigger links rows, re-draws a stale id, the verifier passes a
-- clean chain and names a tampered row. Kept last: disabling the immutability
-- trigger takes an ACCESS EXCLUSIVE lock on audit_log until the rollback.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id bigint;
  b_id bigint;
  c_id bigint;
  a_hash text;
  b_prev text;
  tail bigint;
  broken bigint[];
  refused boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.verify_audit_chain()) then
    raise exception 'fixture precondition: audit chain already broken before the test';
  end if;

  insert into public.audit_log(action,detail) values ('SQL_TEST_CHAIN_A','fixture a')
    returning id, row_hash into a_id, a_hash;
  insert into public.audit_log(action,detail) values ('SQL_TEST_CHAIN_B','fixture b')
    returning id, prev_hash into b_id, b_prev;
  if b_id <= a_id then raise exception 'audit ids are not increasing (% then %)', a_id, b_id; end if;
  if b_prev is distinct from a_hash then raise exception 'row B is not linked to row A'; end if;
  if a_hash !~ '^[0-9a-f]{64}$' then raise exception 'row_hash is not a sha256 hex digest'; end if;
  if (select count(*) from public.verify_audit_chain()) <> 0 then
    raise exception 'verify_audit_chain reports a clean two-row chain as broken';
  end if;

  -- An id below the tail (what the pre-lock column default produces when a
  -- concurrent insert commits first) is re-drawn above it.
  select max(id) into tail from public.audit_log;
  insert into public.audit_log(id,action,detail) values (1,'SQL_TEST_CHAIN_C','fixture c')
    returning id into c_id;
  if c_id <= tail then raise exception 'trigger kept stale id % below tail %', c_id, tail; end if;
  if (select prev_hash from public.audit_log where id=c_id)
     is distinct from (select row_hash from public.audit_log where id=tail) then
    raise exception 'row C is not linked to the tail';
  end if;
  if (select count(*) from public.verify_audit_chain()) <> 0 then
    raise exception 'verify_audit_chain reports the re-drawn row as broken';
  end if;

  -- The ledger is immutable through normal DML.
  refused := false;
  begin update public.audit_log set detail='tampered' where id=a_id;
  exception when raise_exception then refused := true; end;
  if not refused then raise exception 'audit_log accepted an UPDATE'; end if;
  refused := false;
  begin delete from public.audit_log where id=a_id;
  exception when raise_exception then refused := true; end;
  if not refused then raise exception 'audit_log accepted a DELETE'; end if;

  -- Tamper as the table owner with the guard disabled (rolled back below).
  execute 'alter table public.audit_log disable trigger audit_log_no_update';
  update public.audit_log set detail='tampered' where id=a_id;
  execute 'alter table public.audit_log enable trigger audit_log_no_update';
  select array_agg(v.id order by v.id) into broken from public.verify_audit_chain() v;
  if broken is distinct from array[a_id] then
    raise exception 'verify_audit_chain reported % for a tampered row %', broken, a_id;
  end if;
end;
$$;

do $$ begin raise notice 'Security functions SQL: mfa_ok, rate limits, camera visibility, super admin, write grants and audit chain passed'; end $$;
rollback;
