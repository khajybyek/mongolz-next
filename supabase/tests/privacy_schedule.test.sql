-- Run against an isolated local database with all migrations applied
-- (`npm run test:sql`). Covers 20260928100000_privacy_schedules_enforced:
--   * public.effective_privacy_mode() against the shared test vectors — the
--     SAME list lives in ml-service/tests/test_privacy_schedule.py; change both
--     files together, the SQL helper and ml-service/privacy_schedule.py must
--     agree to the second;
--   * the masking_schedules / cameras / recording_privacy_spans CHECKs;
--   * service-role-only writes on masking_schedules and recording_privacy_spans
--     (even an admin token cannot write; anon holds nothing);
--   * the permission-aware, second-factor-gated read policy on
--     recording_privacy_spans;
--   * recording_privacy_spans.client_span_id (idempotent span writes),
--     cameras.privacy_loosened_at, and no UPDATE on recordings through a user
--     token (the schedule's anchors started_at / camera_id).
-- Everything runs in one transaction and rolls back. Ids are handed between
-- the DO blocks through transaction-local `mongolz_test.*` settings.
begin;

-- ---------------------------------------------------------------------------
-- Fixtures: one camera per vector group, their schedule windows, users for the
-- RLS checks, and a recording with two privacy spans.
-- ---------------------------------------------------------------------------
do $$
declare
  cam_std     uuid := gen_random_uuid();  -- vector 1: no windows, default standard
  cam_priv    uuid := gen_random_uuid();  -- vector 2: no windows, default private
  cam_day     uuid := gen_random_uuid();  -- vector 3: private 09:00-18:00 every day
  cam_night   uuid := gen_random_uuid();  -- vector 4: private 22:00-06:00 Fri only
  cam_sat     uuid := gen_random_uuid();  -- vector 5: private 00:00-24:00 Sat only
  cam_overlap uuid := gen_random_uuid();  -- vector 6: standard 08-20 + private 12-13, default private
  cam_missing uuid := gen_random_uuid();  -- vector 7: no cameras row
  admin        uuid := gen_random_uuid();
  totp_admin   uuid := gen_random_uuid();
  viewer       uuid := gen_random_uuid();
  other_viewer uuid := gen_random_uuid();
  auditor      uuid := gen_random_uuid();
  recording    uuid := gen_random_uuid();
  vectors jsonb;
begin
  -- No JWT claims: direct SQL as the owner, as a migration or cron would run.
  perform set_config('request.jwt.claims', '', true);

  insert into public.cameras(id,name,url,cam_type,privacy_default) values
    (cam_std,    'Privacy vector 1','demo://privacy-vector-1','demo','standard'),
    (cam_priv,   'Privacy vector 2','demo://privacy-vector-2','demo','private'),
    (cam_day,    'Privacy vector 3','demo://privacy-vector-3','demo','standard'),
    (cam_night,  'Privacy vector 4','demo://privacy-vector-4','demo','standard'),
    (cam_sat,    'Privacy vector 5','demo://privacy-vector-5','demo','standard'),
    (cam_overlap,'Privacy vector 6','demo://privacy-vector-6','demo','private');

  insert into public.masking_schedules(camera_id,window_mode,starts_at,ends_at,weekdays) values
    (cam_day,    'private', '09:00','18:00',127),
    (cam_night,  'private', '22:00','06:00',32),
    (cam_sat,    'private', '00:00','24:00',64),
    (cam_overlap,'standard','08:00','20:00',127),
    (cam_overlap,'private', '12:00','13:00',127);

  -- Shared vectors (keep identical to ml-service/tests/test_privacy_schedule.py).
  -- Instants are UTC; KST = UTC+9. 2026-09-25 is a Friday in KST, 09-26
  -- Saturday, 09-27 Sunday, 09-28 Monday.
  select jsonb_agg(jsonb_build_object(
           'label', label, 'camera', camera, 'at', at, 'expected', expected) order by ord)
    into vectors
    from (values
      -- 1. no windows, default standard, any instant -> standard
      ( 1, '1 no windows / default standard (Mon 09:00 KST)', cam_std, '2026-09-28T00:00:00Z', 'standard'),
      ( 2, '1 no windows / default standard (Mon 12:00 KST)', cam_std, '2026-09-28T03:00:00Z', 'standard'),
      ( 3, '1 no windows / default standard (Fri 22:00 KST)', cam_std, '2026-09-25T13:00:00Z', 'standard'),
      ( 4, '1 no windows / default standard (Sun 00:30 KST)', cam_std, '2026-09-26T15:30:00Z', 'standard'),
      -- 2. no windows, default private -> private
      ( 5, '2 no windows / default private (Mon 09:00 KST)', cam_priv, '2026-09-28T00:00:00Z', 'private'),
      ( 6, '2 no windows / default private (Mon 12:00 KST)', cam_priv, '2026-09-28T03:00:00Z', 'private'),
      ( 7, '2 no windows / default private (Sat 02:00 KST)', cam_priv, '2026-09-25T17:00:00Z', 'private'),
      ( 8, '2 no windows / default private (Sun 00:30 KST)', cam_priv, '2026-09-26T15:30:00Z', 'private'),
      -- 3. private 09:00-18:00 every day (127), default standard
      ( 9, '3 09:00 KST Mon -> private (start inclusive)', cam_day, '2026-09-28T00:00:00Z', 'private'),
      (10, '3 17:59 KST Mon -> private', cam_day, '2026-09-28T08:59:00Z', 'private'),
      (11, '3 18:00 KST Mon -> standard (end exclusive)', cam_day, '2026-09-28T09:00:00Z', 'standard'),
      (12, '3 08:59 KST Mon -> standard', cam_day, '2026-09-27T23:59:00Z', 'standard'),
      -- 4. overnight private 22:00-06:00 weekdays=32 (Fri only), default standard
      (13, '4 22:00 KST Fri -> private', cam_night, '2026-09-25T13:00:00Z', 'private'),
      (14, '4 02:00 KST Sat -> private (Fri window continues)', cam_night, '2026-09-25T17:00:00Z', 'private'),
      (15, '4 02:00 KST Fri -> standard (Thu bit not set)', cam_night, '2026-09-24T17:00:00Z', 'standard'),
      (16, '4 06:00 KST Sat -> standard (end exclusive)', cam_night, '2026-09-25T21:00:00Z', 'standard'),
      -- 5. private 00:00-24:00 weekdays=64 (Sat), default standard
      (17, '5 23:59 KST Sat -> private', cam_sat, '2026-09-26T14:59:00Z', 'private'),
      (18, '5 00:00 KST Sun -> standard', cam_sat, '2026-09-26T15:00:00Z', 'standard'),
      -- 6. overlap: standard 08:00-20:00 + private 12:00-13:00 (both 127), default private
      (19, '6 12:30 KST -> private (private wins)', cam_overlap, '2026-09-28T03:30:00Z', 'private'),
      (20, '6 11:00 KST -> standard (standard window)', cam_overlap, '2026-09-28T02:00:00Z', 'standard'),
      (21, '6 21:00 KST -> private (default)', cam_overlap, '2026-09-28T12:00:00Z', 'private'),
      -- 7. camera id without a cameras row -> standard
      (22, '7 unknown camera -> standard', cam_missing, '2026-09-28T03:30:00Z', 'standard')
    ) as t(ord, label, camera, at, expected);

  -- Users for the RLS checks (same pattern as security_functions.test.sql).
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (admin,admin::text || '@privacy-test.invalid',now(),'{}'),
    (totp_admin,totp_admin::text || '@privacy-test.invalid',now(),'{}'),
    (viewer,viewer::text || '@privacy-test.invalid',now(),'{}'),
    (other_viewer,other_viewer::text || '@privacy-test.invalid',now(),'{}'),
    (auditor,auditor::text || '@privacy-test.invalid',now(),'{}');
  insert into public.profiles(id,email) values
    (admin,admin::text || '@privacy-test.invalid'),
    (totp_admin,totp_admin::text || '@privacy-test.invalid'),
    (viewer,viewer::text || '@privacy-test.invalid'),
    (other_viewer,other_viewer::text || '@privacy-test.invalid'),
    (auditor,auditor::text || '@privacy-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role='admin', totp_enabled=false where id=admin;
  update public.profiles set role='admin', totp_enabled=true where id=totp_admin;
  update public.profiles set role='viewer', totp_enabled=false where id in (viewer,other_viewer);
  update public.profiles set role='auditor', totp_enabled=false where id=auditor;

  insert into public.recordings(
    id,filename,storage_path,duration_sec,camera_id,camera_name,started_at,capture_status
  ) values (
    recording,recording::text || '.mp4','fixture/' || recording::text || '.mp4',
    120,cam_day,'Privacy vector 3',now()-interval '1 hour','ready'
  );
  -- A closed schedule span and a fail-closed span that was never closed.
  insert into public.recording_privacy_spans(recording_id,start_offset_sec,end_offset_sec)
    values (recording,10,25.5);
  insert into public.recording_privacy_spans(recording_id,start_offset_sec,end_offset_sec,source)
    values (recording,40,null,'fail_closed');

  perform set_config('mongolz_test.vectors', vectors::text, true);
  perform set_config('mongolz_test.cam_std', cam_std::text, true);
  perform set_config('mongolz_test.cam_priv', cam_priv::text, true);
  perform set_config('mongolz_test.cam_day', cam_day::text, true);
  perform set_config('mongolz_test.admin', admin::text, true);
  perform set_config('mongolz_test.totp_admin', totp_admin::text, true);
  perform set_config('mongolz_test.viewer', viewer::text, true);
  perform set_config('mongolz_test.other_viewer', other_viewer::text, true);
  perform set_config('mongolz_test.auditor', auditor::text, true);
  perform set_config('mongolz_test.recording', recording::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The migration replaced the old objects; nothing of the old model is left.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.effective_mask_mode(uuid,timestamp with time zone)') is not null then
    raise exception 'effective_mask_mode() still exists';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='cameras' and column_name='mask_default') then
    raise exception 'cameras.mask_default still exists';
  end if;
  if (select prosecdef or provolatile <> 's'
        from pg_proc where oid = 'public.effective_privacy_mode(uuid,timestamptz)'::regprocedure) then
    raise exception 'effective_privacy_mode must be STABLE SECURITY INVOKER';
  end if;
  if (select column_default from information_schema.columns
       where table_schema='public' and table_name='cameras' and column_name='privacy_default')
     is distinct from '''standard''::text' then
    raise exception 'cameras.privacy_default does not default to standard';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared vectors, evaluated as the owner (sees every row).
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  got text;
  checked int := 0;
begin
  for v in select * from jsonb_array_elements(current_setting('mongolz_test.vectors')::jsonb) loop
    got := public.effective_privacy_mode((v->>'camera')::uuid, (v->>'at')::timestamptz);
    if got is distinct from v->>'expected' then
      raise exception 'vector "%": expected % at %, got %', v->>'label', v->>'expected', v->>'at', got;
    end if;
    checked := checked + 1;
  end loop;
  if checked <> 22 then raise exception 'expected 22 vectors, ran %', checked; end if;

  -- The session time zone must not matter: the helper always reads Asia/Seoul.
  set local timezone = 'America/Los_Angeles';
  for v in select * from jsonb_array_elements(current_setting('mongolz_test.vectors')::jsonb) loop
    got := public.effective_privacy_mode((v->>'camera')::uuid, (v->>'at')::timestamptz);
    if got is distinct from v->>'expected' then
      raise exception 'vector "%" under a non-UTC session time zone: expected %, got %',
        v->>'label', v->>'expected', got;
    end if;
  end loop;
  reset timezone;

  -- p_at defaults to now(): the default-private camera is private at any instant.
  got := public.effective_privacy_mode(current_setting('mongolz_test.cam_priv')::uuid);
  if got <> 'private' then raise exception 'p_at default: expected private, got %', got; end if;
end;
$$;

-- The same vectors through RLS as an admin (the schedule page's path), and as
-- an auditor, who cannot read cameras or schedules: SECURITY INVOKER means the
-- auditor gets the neutral 'standard' everywhere instead of learning anything.
do $$
declare
  v jsonb;
  got text;
  admin text := current_setting('mongolz_test.admin');
  auditor text := current_setting('mongolz_test.auditor');
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  set local role authenticated;
  for v in select * from jsonb_array_elements(current_setting('mongolz_test.vectors')::jsonb) loop
    got := public.effective_privacy_mode((v->>'camera')::uuid, (v->>'at')::timestamptz);
    if got is distinct from v->>'expected' then
      raise exception 'vector "%" as admin through RLS: expected %, got %', v->>'label', v->>'expected', got;
    end if;
  end loop;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',auditor,'role','authenticated')::text, true);
  set local role authenticated;
  for v in select * from jsonb_array_elements(current_setting('mongolz_test.vectors')::jsonb) loop
    got := public.effective_privacy_mode((v->>'camera')::uuid, (v->>'at')::timestamptz);
    if got <> 'standard' then
      raise exception 'auditor learned % for vector "%" (expected the neutral standard)', got, v->>'label';
    end if;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- CHECK constraints.
-- ---------------------------------------------------------------------------
do $$
declare
  cam uuid := current_setting('mongolz_test.cam_std')::uuid;
  recording uuid := current_setting('mongolz_test.recording')::uuid;
  bad record;
  mode text;
  refused boolean;
  span_id bigint;
begin
  -- masking_schedules: new mode set, no 24:00 start, no empty window; the
  -- 20260923180000 time-format CHECKs and the weekday range still hold.
  for bad in select * from (values
      ('private', '24:00','06:00',127,'starts_at 24:00'),
      ('private', '24:00','24:00',127,'24:00-24:00'),
      ('private', '09:00','09:00',127,'starts_at = ends_at'),
      ('standard','00:00','00:00',127,'00:00-00:00 (a whole day is 00:00-24:00)'),
      ('masked',  '09:00','18:00',127,'old mode masked'),
      ('revealed','09:00','18:00',127,'old mode revealed'),
      ('Private', '09:00','18:00',127,'mode is case-sensitive'),
      ('private', '29:00','06:00',127,'hour 29'),
      ('private', '09:00','24:01',127,'24:01'),
      ('private', '9:00', '18:00',127,'single-digit hour'),
      ('private', '09:00','18:00',0,  'weekdays 0'),
      ('private', '09:00','18:00',128,'weekdays 128')
    ) as t(mode, s, e, wd, label)
  loop
    refused := false;
    begin
      insert into public.masking_schedules(camera_id,window_mode,starts_at,ends_at,weekdays)
        values (cam, bad.mode, bad.s, bad.e, bad.wd);
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'masking_schedules accepted %', bad.label; end if;
  end loop;

  -- Accepted edge cases: a whole day, an overnight window, an end-of-day end.
  insert into public.masking_schedules(camera_id,window_mode,starts_at,ends_at,weekdays) values
    (cam,'private','00:00','24:00',127),
    (cam,'standard','23:00','00:30',1),
    (cam,'private','18:00','24:00',2);
  delete from public.masking_schedules where camera_id = cam;

  -- cameras.privacy_default: the old values are gone.
  foreach mode in array array['masked','revealed','Standard',''] loop
    refused := false;
    begin
      insert into public.cameras(name,url,cam_type,privacy_default)
        values ('Privacy bad default','demo://privacy-bad','demo',mode);
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'cameras accepted privacy_default %', mode; end if;
  end loop;
  refused := false;
  begin
    insert into public.cameras(name,url,cam_type,privacy_default)
      values ('Privacy null default','demo://privacy-null','demo',null);
  exception when not_null_violation then refused := true;
  end;
  if not refused then raise exception 'cameras accepted a NULL privacy_default'; end if;

  -- recording_privacy_spans: end after start, finite, non-negative, known source.
  for bad in select * from (values
      (10::float8, 10::float8, 'schedule',   'end = start'),
      (10::float8,  5::float8, 'schedule',   'end < start'),
      (-1::float8,  5::float8, 'schedule',   'negative start'),
      ('NaN'::float8, null::float8, 'schedule', 'NaN start'),
      ('Infinity'::float8, null::float8, 'schedule', 'infinite start'),
      (0::float8, 'Infinity'::float8, 'schedule', 'infinite end'),
      (0::float8, 'NaN'::float8, 'schedule', 'NaN end'),
      (0::float8,  5::float8, 'manual',     'unknown source')
    ) as t(s, e, src, label)
  loop
    refused := false;
    begin
      insert into public.recording_privacy_spans(recording_id,start_offset_sec,end_offset_sec,source)
        values (recording, bad.s, bad.e, bad.src);
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'recording_privacy_spans accepted %', bad.label; end if;
  end loop;
  refused := false;
  begin
    insert into public.recording_privacy_spans(recording_id,start_offset_sec) values (recording,null);
  exception when not_null_violation then refused := true;
  end;
  if not refused then raise exception 'recording_privacy_spans accepted a NULL start'; end if;
  refused := false;
  begin
    insert into public.recording_privacy_spans(recording_id,start_offset_sec)
      values (gen_random_uuid(),0);
  exception when foreign_key_violation then refused := true;
  end;
  if not refused then raise exception 'recording_privacy_spans accepted an unknown recording'; end if;

  -- An open span defaults to source schedule and can be closed later.
  insert into public.recording_privacy_spans(recording_id,start_offset_sec)
    values (recording,0) returning id into span_id;
  if (select source from public.recording_privacy_spans where id=span_id) <> 'schedule' then
    raise exception 'recording_privacy_spans.source does not default to schedule';
  end if;
  update public.recording_privacy_spans set end_offset_sec = 0.5 where id=span_id;
  delete from public.recording_privacy_spans where id=span_id;

  -- client_span_id: generated when omitted, unique, and the pipeline's upsert
  -- on it completes a row instead of adding a second one (a retry after a
  -- lost response; the spool delivery of a span the live path already wrote).
  if exists (select 1 from public.recording_privacy_spans
              where recording_id = recording and client_span_id is null) then
    raise exception 'recording_privacy_spans.client_span_id was not generated';
  end if;
  insert into public.recording_privacy_spans(recording_id,start_offset_sec,source,client_span_id)
    values (recording,60,'schedule','5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11');
  insert into public.recording_privacy_spans(recording_id,start_offset_sec,source,client_span_id)
    values (recording,60,'fail_closed','5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11')
    on conflict (client_span_id) do update
      set recording_id = excluded.recording_id,
          start_offset_sec = excluded.start_offset_sec,
          source = excluded.source;
  insert into public.recording_privacy_spans(recording_id,start_offset_sec,end_offset_sec,source,client_span_id)
    values (recording,60,70,'fail_closed','5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11')
    on conflict (client_span_id) do update set end_offset_sec = excluded.end_offset_sec;
  if (select count(*) from public.recording_privacy_spans
       where client_span_id = '5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11') <> 1
     or (select end_offset_sec::text || '/' || source from public.recording_privacy_spans
          where client_span_id = '5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11') <> '70/fail_closed' then
    raise exception 'upsert on client_span_id did not complete the single row';
  end if;
  refused := false;
  begin
    insert into public.recording_privacy_spans(recording_id,start_offset_sec,client_span_id)
      values (recording,80,'5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11');
  exception when unique_violation then refused := true;
  end;
  if not refused then raise exception 'recording_privacy_spans accepted a duplicate client_span_id'; end if;
  delete from public.recording_privacy_spans where client_span_id = '5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11';

  -- cameras.privacy_loosened_at: nullable, no default (NULL = never loosened).
  if (select is_nullable || ':' || coalesce(column_default, '<none>') || ':' || data_type
        from information_schema.columns
       where table_schema='public' and table_name='cameras' and column_name='privacy_loosened_at')
     is distinct from 'YES:<none>:timestamp with time zone' then
    raise exception 'cameras.privacy_loosened_at has the wrong shape';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and policies: service-role writes only; anon holds nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
  offenders text[] := '{}';
  policies text[];
begin
  foreach t in array array['masking_schedules','recording_privacy_spans'] loop
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('authenticated', 'public.' || t, p) then
        offenders := offenders || format('authenticated:%s:%s', t, p);
      end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', 'public.' || t, p) then
        offenders := offenders || format('anon:%s:%s', t, p);
      end if;
    end loop;
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      offenders := offenders || format('authenticated:%s:SELECT missing', t);
    end if;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', 'public.' || t, p) then
        offenders := offenders || format('service_role:%s:%s missing', t, p);
      end if;
    end loop;
  end loop;
  if cardinality(offenders) > 0 then
    raise exception 'unexpected privileges: %', offenders;
  end if;

  if has_function_privilege('anon','public.effective_privacy_mode(uuid,timestamptz)','execute') then
    raise exception 'anon can execute effective_privacy_mode';
  end if;
  if not has_function_privilege('authenticated','public.effective_privacy_mode(uuid,timestamptz)','execute')
     or not has_function_privilege('service_role','public.effective_privacy_mode(uuid,timestamptz)','execute') then
    raise exception 'authenticated/service_role lost execute on effective_privacy_mode';
  end if;

  -- masking_schedules keeps only the operator read + the restrictive second factor.
  select array_agg(policyname::text || ':' || permissive::text order by policyname) into policies
    from pg_policies where schemaname='public' and tablename='masking_schedules';
  if policies is distinct from array['masking_schedules: operator read:PERMISSIVE',
                                     'masking_schedules: second factor required:RESTRICTIVE'] then
    raise exception 'masking_schedules policies are %', policies;
  end if;

  select array_agg(policyname::text || ':' || permissive::text || ':' || cmd order by policyname) into policies
    from pg_policies where schemaname='public' and tablename='recording_privacy_spans';
  if policies is distinct from array['recording_privacy_spans: operator read (permission aware):PERMISSIVE:SELECT',
                                     'recording_privacy_spans: second factor required:RESTRICTIVE:ALL'] then
    raise exception 'recording_privacy_spans policies are %', policies;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.recording_privacy_spans'::regclass) then
    raise exception 'RLS is not enabled on recording_privacy_spans';
  end if;

  -- recordings: no UPDATE through a user token (table or column level), and
  -- the dead admin-update policy is gone. The ML service keeps it.
  if has_table_privilege('authenticated','public.recordings','UPDATE')
     or has_any_column_privilege('authenticated','public.recordings','UPDATE') then
    raise exception 'authenticated can still UPDATE recordings';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='recordings'
               and policyname = 'recordings: admin update') then
    raise exception 'the "recordings: admin update" policy still exists';
  end if;
  if not has_table_privilege('service_role','public.recordings','UPDATE') then
    raise exception 'service_role lost UPDATE on recordings';
  end if;
end;
$$;

-- Behaviour, not just catalog flags: even a verified admin token cannot write
-- either table through PostgREST, and anon cannot read them at all.
do $$
declare
  admin text := current_setting('mongolz_test.admin');
  cam uuid := current_setting('mongolz_test.cam_day')::uuid;
  recording uuid := current_setting('mongolz_test.recording')::uuid;
  stmt text;
  refused boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  set local role authenticated;
  foreach stmt in array array[
    format($f$insert into public.masking_schedules(camera_id,window_mode,starts_at,ends_at) values (%L,'standard','00:00','24:00')$f$, cam),
    format($f$update public.masking_schedules set window_mode='standard' where camera_id=%L$f$, cam),
    format($f$delete from public.masking_schedules where camera_id=%L$f$, cam),
    format($f$insert into public.recording_privacy_spans(recording_id,start_offset_sec) values (%L,0)$f$, recording),
    format($f$update public.recording_privacy_spans set end_offset_sec=11 where recording_id=%L$f$, recording),
    format($f$delete from public.recording_privacy_spans where recording_id=%L$f$, recording),
    -- The anchors the reveal job / view renderer place the schedule with.
    format($f$update public.recordings set camera_id=null where id=%L$f$, recording),
    format($f$update public.recordings set started_at=started_at + interval '12 hours' where id=%L$f$, recording)
  ] loop
    refused := false;
    begin
      execute stmt;
    exception when insufficient_privilege then refused := true;
    end;
    if not refused then raise exception 'authenticated admin was allowed: %', stmt; end if;
  end loop;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  set local role anon;
  foreach stmt in array array[
    'select count(*) from public.masking_schedules',
    'select count(*) from public.recording_privacy_spans'
  ] loop
    refused := false;
    begin
      execute stmt;
    exception when insufficient_privilege then refused := true;
    end;
    if not refused then raise exception 'anon was allowed: %', stmt; end if;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- The fixtures survived every refused write.
  if (select count(*) from public.masking_schedules where camera_id=cam) <> 1
     or (select count(*) from public.recording_privacy_spans where recording_id=recording) <> 2
     or (select camera_id from public.recordings where id=recording) is distinct from cam then
    raise exception 'a refused write changed the fixtures';
  end if;

  -- The ML service writes spans with the service role (identity id included).
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  set local role service_role;
  insert into public.recording_privacy_spans(recording_id,start_offset_sec) values (recording,90);
  update public.recording_privacy_spans set end_offset_sec=95 where recording_id=recording and start_offset_sec=90;
  delete from public.recording_privacy_spans where recording_id=recording and start_offset_sec=90;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- recording_privacy_spans read policy: whoever can see the recording sees its
-- spans; nobody else does.
-- ---------------------------------------------------------------------------
do $$
declare
  recording uuid := current_setting('mongolz_test.recording')::uuid;
  cam uuid := current_setting('mongolz_test.cam_day')::uuid;
  admin text := current_setting('mongolz_test.admin');
  totp_admin text := current_setting('mongolz_test.totp_admin');
  viewer text := current_setting('mongolz_test.viewer');
  other_viewer text := current_setting('mongolz_test.other_viewer');
  auditor text := current_setting('mongolz_test.auditor');
  seen bigint;
  who record;
begin
  for who in select * from (values
      (viewer,       'password', 2::bigint, 'viewer, camera with no grants (default-allow)'),
      (admin,        'password', 2::bigint, 'admin without TOTP'),
      (totp_admin,   'otp',      2::bigint, 'TOTP admin with an otp session'),
      (totp_admin,   'password', 0::bigint, 'TOTP admin with a password-only token'),
      (auditor,      'password', 0::bigint, 'auditor (not an operator)')
    ) as t(uid, method, expected, label)
  loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub',who.uid,'role','authenticated',
      'amr',jsonb_build_array(jsonb_build_object('method',who.method)))::text, true);
    set local role authenticated;
    select count(*) into seen from public.recording_privacy_spans where recording_id = recording;
    reset role;
    if seen <> who.expected then
      raise exception '% saw % spans (expected %)', who.label, seen, who.expected;
    end if;
  end loop;

  -- Granting the camera to someone else hides the recording, and with it the
  -- spans, from the viewer; the grantee and admins still see them.
  perform set_config('request.jwt.claims', '', true);
  insert into public.camera_permissions(camera_id,user_id,permission)
    values (cam, other_viewer::uuid, 'view');
  for who in select * from (values
      (viewer,       0::bigint, 'viewer after the camera was granted to someone else'),
      (other_viewer, 2::bigint, 'grantee'),
      (admin,        2::bigint, 'admin after the grant')
    ) as t(uid, expected, label)
  loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub',who.uid,'role','authenticated')::text, true);
    set local role authenticated;
    select count(*) into seen from public.recording_privacy_spans where recording_id = recording;
    reset role;
    if seen <> who.expected then
      raise exception '% saw % spans (expected %)', who.label, seen, who.expected;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- Spans go with their recording (retention / GDPR erasure delete recordings).
  delete from public.recordings where id = recording;
  if exists (select 1 from public.recording_privacy_spans where recording_id = recording) then
    raise exception 'recording_privacy_spans survived the deletion of their recording';
  end if;
end;
$$;

do $$ begin raise notice 'Privacy schedule SQL: shared vectors, CHECKs, service-role writes and span read policy passed'; end $$;
rollback;
