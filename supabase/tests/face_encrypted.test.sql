-- Run against an isolated local database with all migrations applied
-- (`npm run test:sql`). Covers 20260930100000_face_encrypted_recordings:
--   * shape and defaults: cameras.recording_mode (text, NOT NULL, default
--     'standard'), recordings.face_envelope_path (text, nullable, no default),
--     recordings.blur_strategy still defaults to 'baked';
--   * the CHECKs: recording_mode values; blur_strategy gains face_encrypted;
--     an envelope path only on face_encrypted rows, never '' and never the
--     playback artifact; face_encrypted cannot be 'ready' without its
--     envelope; face_encrypted never names an original — including the ML's
--     capture placeholder flow (insert 'capturing', then ONE update to 'ready'
--     that carries the envelope path);
--   * retention: deleting a recording queues its envelope next to
--     storage_path / original_path (manual delete and sweep_retention); a
--     legal hold still blocks both;
--   * grants: no user-token write on cameras, no INSERT / UPDATE / DELETE on
--     recordings (table or new column; INSERT and the unused "recordings:
--     admin insert" policy are removed by this migration), service role keeps
--     full access;
--   * retention never queues an object another recordings row still names
--     (a decoy row cannot take a held recording's objects with it), and the
--     three path columns that lookup probes are indexed;
--   * reads: operators see the new columns through RLS, the auditor does not;
--     the recordings storage policy signs storage_path only — never the
--     sealed envelope.
-- Everything runs in one transaction and rolls back. Ids are handed between
-- the DO blocks through transaction-local `mongolz_test.*` settings.
begin;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
do $$
declare
  cam_std uuid := gen_random_uuid();
  cam_fe  uuid := gen_random_uuid();
  admin   uuid := gen_random_uuid();
  viewer  uuid := gen_random_uuid();
  auditor uuid := gen_random_uuid();
  rec_std uuid := gen_random_uuid();  -- standard (baked) row with a separate original
  rec_fe  uuid := gen_random_uuid();  -- face_encrypted, ready, with envelope
  prefix  text := 'fe-test/' || gen_random_uuid()::text || '/';
begin
  perform set_config('request.jwt.claims', '', true);

  -- recording_mode omitted on purpose for cam_std: the default must apply.
  insert into public.cameras(id,name,url,cam_type) values
    (cam_std,'Face-encrypted test standard','demo://fe-test-standard','demo');
  insert into public.cameras(id,name,url,cam_type,recording_mode) values
    (cam_fe,'Face-encrypted test camera','demo://fe-test-encrypted','demo','face_encrypted');

  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (admin,admin::text || '@face-encrypted-test.invalid',now(),'{}'),
    (viewer,viewer::text || '@face-encrypted-test.invalid',now(),'{}'),
    (auditor,auditor::text || '@face-encrypted-test.invalid',now(),'{}');
  insert into public.profiles(id,email) values
    (admin,admin::text || '@face-encrypted-test.invalid'),
    (viewer,viewer::text || '@face-encrypted-test.invalid'),
    (auditor,auditor::text || '@face-encrypted-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role='admin', totp_enabled=false where id=admin;
  update public.profiles set role='viewer', totp_enabled=false where id=viewer;
  update public.profiles set role='auditor', totp_enabled=false where id=auditor;

  insert into public.recordings(
    id,filename,storage_path,original_path,duration_sec,camera_id,camera_name,
    started_at,capture_status,blur_strategy
  ) values (
    rec_std,prefix || 'std_blurred.mp4',prefix || 'std_blurred.mp4',prefix || 'std_original.mp4.enc',
    60,cam_std,'Face-encrypted test standard',now()-interval '10 days','ready','baked'
  );
  insert into public.recordings(
    id,filename,storage_path,duration_sec,camera_id,camera_name,
    started_at,capture_status,blur_strategy,face_envelope_path
  ) values (
    rec_fe,prefix || 'fe.mp4',prefix || 'fe_masked.mp4.enc',
    60,cam_fe,'Face-encrypted test camera',now()-interval '10 days','ready','face_encrypted',
    prefix || 'fe_faces.mfe.enc'
  );

  perform set_config('mongolz_test.cam_std', cam_std::text, true);
  perform set_config('mongolz_test.cam_fe', cam_fe::text, true);
  perform set_config('mongolz_test.admin', admin::text, true);
  perform set_config('mongolz_test.viewer', viewer::text, true);
  perform set_config('mongolz_test.auditor', auditor::text, true);
  perform set_config('mongolz_test.rec_std', rec_std::text, true);
  perform set_config('mongolz_test.rec_fe', rec_fe::text, true);
  perform set_config('mongolz_test.prefix', prefix, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Shape, defaults and constraint names.
-- ---------------------------------------------------------------------------
do $$
declare
  shape text;
  missing text[];
begin
  select data_type || ':' || is_nullable || ':' || coalesce(column_default, '<none>') into shape
    from information_schema.columns
   where table_schema='public' and table_name='cameras' and column_name='recording_mode';
  if shape is distinct from 'text:NO:''standard''::text' then
    raise exception 'cameras.recording_mode has the wrong shape: %', shape;
  end if;

  select data_type || ':' || is_nullable || ':' || coalesce(column_default, '<none>') into shape
    from information_schema.columns
   where table_schema='public' and table_name='recordings' and column_name='face_envelope_path';
  if shape is distinct from 'text:YES:<none>' then
    raise exception 'recordings.face_envelope_path has the wrong shape: %', shape;
  end if;

  -- Legacy rows keep their meaning: blur_strategy still defaults to baked.
  if (select column_default from information_schema.columns
       where table_schema='public' and table_name='recordings' and column_name='blur_strategy')
     is distinct from '''baked''::text' then
    raise exception 'recordings.blur_strategy no longer defaults to baked';
  end if;

  if (select recording_mode from public.cameras
       where id = current_setting('mongolz_test.cam_std')::uuid) <> 'standard' then
    raise exception 'a camera inserted without recording_mode is not standard';
  end if;

  -- Every constraint exists under its documented name and is validated.
  select array_agg(n) into missing
    from unnest(array[
      'cameras.cameras_recording_mode_check',
      'recordings.recordings_blur_strategy_check',
      'recordings.recordings_face_envelope_path_check',
      'recordings.recordings_face_encrypted_ready_check',
      'recordings.recordings_face_encrypted_no_original_check'
    ]) as n
   where not exists (
     select 1 from pg_constraint c
      where c.contype = 'c' and c.convalidated
        and c.conrelid = ('public.' || split_part(n, '.', 1))::regclass
        and c.conname = split_part(n, '.', 2)
   );
  if missing is not null then
    raise exception 'missing or unvalidated constraints: %', missing;
  end if;

  -- The retention trigger's shared-path lookup probes these three columns
  -- for every deleted row: each needs a valid btree index on exactly that
  -- column (partial on the nullable two), or a sweep scans recordings once
  -- per deleted row.
  select array_agg(n) into missing
    from unnest(array[
      'recordings_storage_path_idx:storage_path:',
      'recordings_original_path_idx:original_path:original_path IS NOT NULL',
      'recordings_face_envelope_path_idx:face_envelope_path:face_envelope_path IS NOT NULL'
    ]) as n
   where not exists (
     select 1
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_am am on am.oid = c.relam
      where i.indrelid = 'public.recordings'::regclass
        and c.relname = split_part(n, ':', 1)
        and am.amname = 'btree' and i.indisvalid and i.indnatts = 1
        and pg_get_indexdef(i.indexrelid, 1, true) = split_part(n, ':', 2)
        and coalesce(pg_get_expr(i.indpred, i.indrelid, true), '') = split_part(n, ':', 3)
   );
  if missing is not null then
    raise exception 'missing retention path indexes on recordings: %', missing;
  end if;

  -- The widened CHECK replaced the old one; no second blur_strategy value
  -- list is left behind that would still refuse face_encrypted.
  if (select count(*) from pg_constraint
       where conrelid = 'public.recordings'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) like '%blur_strategy = ANY%') <> 1 then
    raise exception 'expected exactly one blur_strategy value-list CHECK on recordings';
  end if;

  -- The retention trigger function keeps its hardening.
  if (select not prosecdef or proconfig is null
        from pg_proc where oid = 'public.enqueue_retention_storage_deletion()'::regprocedure) then
    raise exception 'enqueue_retention_storage_deletion lost SECURITY DEFINER or its search_path';
  end if;
  if has_function_privilege('anon','public.enqueue_retention_storage_deletion()','execute')
     or has_function_privilege('authenticated','public.enqueue_retention_storage_deletion()','execute') then
    raise exception 'user roles can execute enqueue_retention_storage_deletion';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- cameras.recording_mode CHECK.
-- ---------------------------------------------------------------------------
do $$
declare
  mode text;
  refused boolean;
begin
  foreach mode in array array['Face_encrypted','face-encrypted','encrypted','baked','on_demand',
                              'private','Standard',''] loop
    refused := false;
    begin
      insert into public.cameras(name,url,cam_type,recording_mode)
        values ('Face-encrypted bad mode','demo://fe-test-bad','demo',mode);
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'cameras accepted recording_mode %', quote_literal(mode); end if;
  end loop;
  refused := false;
  begin
    insert into public.cameras(name,url,cam_type,recording_mode)
      values ('Face-encrypted null mode','demo://fe-test-null','demo',null);
  exception when not_null_violation then refused := true;
  end;
  if not refused then raise exception 'cameras accepted a NULL recording_mode'; end if;

  -- Both directions are plain updates for the service role / owner (the web
  -- action decides which direction needs a step-up).
  update public.cameras set recording_mode = 'standard'
   where id = current_setting('mongolz_test.cam_fe')::uuid;
  update public.cameras set recording_mode = 'face_encrypted'
   where id = current_setting('mongolz_test.cam_fe')::uuid;
end;
$$;

-- ---------------------------------------------------------------------------
-- recordings CHECK matrix (inserts).
-- ---------------------------------------------------------------------------
do $$
declare
  prefix text := current_setting('mongolz_test.prefix');
  c record;
  refused boolean;
  n int := 0;
begin
  for c in select * from (values
      -- label,                                         strategy,          status,      original,     envelope,        envelope=storage, ok
      ('face_encrypted placeholder (capturing, nothing yet)', 'face_encrypted', 'capturing', null,          null,            false, true),
      ('face_encrypted capturing with envelope',              'face_encrypted', 'capturing', null,          'env',           false, true),
      ('face_encrypted partial without envelope',             'face_encrypted', 'partial',   null,          null,            false, true),
      ('face_encrypted failed without envelope',              'face_encrypted', 'failed',    null,          null,            false, true),
      ('face_encrypted ready with envelope',                  'face_encrypted', 'ready',     null,          'env',           false, true),
      ('on_demand ready with original',                       'on_demand',      'ready',     'orig.enc',    null,            false, true),
      ('baked ready with original',                           'baked',          'ready',     'orig.enc',    null,            false, true),
      ('baked ready without original',                        'baked',          'ready',     null,          null,            false, true),
      ('face_encrypted ready WITHOUT envelope',               'face_encrypted', 'ready',     null,          null,            false, false),
      ('face_encrypted ready with an original',               'face_encrypted', 'ready',     'orig.enc',    'env',           false, false),
      ('face_encrypted capturing with an original',           'face_encrypted', 'capturing', 'orig.enc',    null,            false, false),
      ('face_encrypted partial with an original',             'face_encrypted', 'partial',   'orig.enc',    null,            false, false),
      ('on_demand with an envelope',                          'on_demand',      'ready',     'orig.enc',    'env',           false, false),
      ('baked with an envelope',                              'baked',          'capturing', null,          'env',           false, false),
      ('face_encrypted with an empty envelope path',          'face_encrypted', 'ready',     null,          '',              false, false),
      ('face_encrypted envelope = playback artifact',         'face_encrypted', 'ready',     null,          'env',           true,  false),
      ('unknown strategy Face_encrypted',                     'Face_encrypted', 'ready',     null,          null,            false, false),
      ('unknown strategy face-encrypted',                     'face-encrypted', 'ready',     null,          null,            false, false),
      ('unknown strategy encrypted',                          'encrypted',      'ready',     null,          null,            false, false)
    ) as t(label, strategy, status, original, envelope, envelope_is_storage, ok)
  loop
    n := n + 1;
    refused := false;
    begin
      insert into public.recordings(
        filename,storage_path,original_path,face_envelope_path,duration_sec,
        camera_id,camera_name,started_at,capture_status,blur_strategy
      ) values (
        prefix || 'matrix-' || n || '.mp4',
        prefix || 'matrix-' || n || '.mp4.enc',
        case when c.original is null then null else prefix || 'matrix-' || n || '-' || c.original end,
        case when c.envelope is null then null
             when c.envelope = '' then ''
             when c.envelope_is_storage then prefix || 'matrix-' || n || '.mp4.enc'
             else prefix || 'matrix-' || n || '-' || c.envelope end,
        10, current_setting('mongolz_test.cam_fe')::uuid, 'Face-encrypted test camera', now(),
        c.status, c.strategy
      );
    exception when check_violation then refused := true;
    end;
    if c.ok and refused then raise exception 'recordings refused: %', c.label; end if;
    if not c.ok and not refused then raise exception 'recordings accepted: %', c.label; end if;
  end loop;
  if n <> 19 then raise exception 'expected 19 matrix rows, ran %', n; end if;

  -- capture_status defaults to 'ready': a direct face_encrypted insert (no
  -- placeholder) must carry its envelope.
  refused := false;
  begin
    insert into public.recordings(filename,storage_path,duration_sec,camera_id,blur_strategy)
      values (prefix || 'direct.mp4', prefix || 'direct.mp4.enc', 10,
              current_setting('mongolz_test.cam_fe')::uuid, 'face_encrypted');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'a direct ready face_encrypted insert without envelope was accepted'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The ML placeholder flow, step by step (updates as the owner / service role).
-- ---------------------------------------------------------------------------
do $$
declare
  prefix text := current_setting('mongolz_test.prefix');
  rec uuid := gen_random_uuid();
  stmt text;
  refused boolean;
begin
  -- Placeholder: blur_strategy is already face_encrypted, nothing uploaded.
  insert into public.recordings(
    id,filename,storage_path,duration_sec,camera_id,camera_name,started_at,
    capture_status,blur_strategy,has_original
  ) values (
    rec,prefix || 'flow.mp4',prefix || 'flow_masked.mp4.enc',null,
    current_setting('mongolz_test.cam_fe')::uuid,'Face-encrypted test camera',now(),
    'capturing','face_encrypted',false
  );

  foreach stmt in array array[
    -- ready before the envelope is recorded
    format($f$update public.recordings set capture_status='ready' where id=%L$f$, rec),
    -- an original sneaks in
    format($f$update public.recordings set original_path=%L where id=%L$f$, prefix || 'flow_original.mp4.enc', rec),
    -- the envelope is recorded as the playback artifact
    format($f$update public.recordings set face_envelope_path=storage_path where id=%L$f$, rec)
  ] loop
    refused := false;
    begin
      execute stmt;
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'placeholder flow accepted: %', stmt; end if;
  end loop;

  -- The finalize update: ready + envelope in ONE statement succeeds.
  update public.recordings
     set capture_status = 'ready', capture_error = null, duration_sec = 30,
         ended_at = now(), face_envelope_path = prefix || 'flow_faces.mfe.enc'
   where id = rec;

  foreach stmt in array array[
    format($f$update public.recordings set face_envelope_path=null where id=%L$f$, rec),
    format($f$update public.recordings set face_envelope_path='' where id=%L$f$, rec),
    format($f$update public.recordings set original_path=%L where id=%L$f$, prefix || 'flow_original.mp4.enc', rec),
    -- the row cannot be relabelled as a standard recording while it holds an envelope
    format($f$update public.recordings set blur_strategy='on_demand' where id=%L$f$, rec),
    format($f$update public.recordings set blur_strategy='baked' where id=%L$f$, rec)
  ] loop
    refused := false;
    begin
      execute stmt;
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'ready face_encrypted row accepted: %', stmt; end if;
  end loop;

  -- Leaving 'ready' (e.g. a later validation failure) may drop the envelope.
  update public.recordings set capture_status = 'partial', capture_error = 'fixture' where id = rec;
  update public.recordings set face_envelope_path = null where id = rec;
  delete from public.recordings where id = rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention: the envelope is queued with its row; a legal hold blocks it.
-- ---------------------------------------------------------------------------
do $$
declare
  prefix text := current_setting('mongolz_test.prefix');
  rec_std uuid := current_setting('mongolz_test.rec_std')::uuid;
  rec_fe uuid := current_setting('mongolz_test.rec_fe')::uuid;
  held uuid := gen_random_uuid();
  decoy uuid := gen_random_uuid();
  incident uuid := gen_random_uuid();
  queued text[];
begin
  -- Manual delete of a standard row: storage_path + original_path, as before.
  delete from public.recordings where id = rec_std;
  select array_agg(object_path order by object_path) into queued
    from public.retention_deletion_queue
   where bucket = 'recordings' and object_path like prefix || 'std%';
  if queued is distinct from array[prefix || 'std_blurred.mp4', prefix || 'std_original.mp4.enc'] then
    raise exception 'standard delete queued %', queued;
  end if;

  -- A held face_encrypted recording: neither a direct delete nor the sweep
  -- touches it, so its envelope is not queued.
  insert into public.recordings(
    id,filename,storage_path,duration_sec,camera_id,camera_name,
    started_at,capture_status,blur_strategy,face_envelope_path
  ) values (
    held,prefix || 'held.mp4',prefix || 'held_masked.mp4.enc',
    60,current_setting('mongolz_test.cam_fe')::uuid,'Face-encrypted test camera',
    now()-interval '10 days','ready','face_encrypted',prefix || 'held_faces.mfe.enc'
  );
  insert into public.incidents(id,title) values (incident,'Face-encrypted hold fixture');
  insert into public.incident_recordings(
    incident_id,recording_id,recording_filename,camera_name,
    recording_started_at,clip_start_sec,clip_end_sec,legal_hold
  ) values (
    incident,held,prefix || 'held.mp4','Face-encrypted test camera',
    now()-interval '10 days',0,10,true
  );
  begin
    delete from public.recordings where id = held;
    raise exception 'direct delete bypassed the legal hold';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- A decoy row (only the service role can still insert one) that names the
  -- held recording's objects takes nothing with it when it is deleted: an
  -- object another row still names is never queued.
  insert into public.recordings(
    id,filename,storage_path,original_path,duration_sec,started_at,capture_status,blur_strategy
  ) values (
    decoy,prefix || 'decoy.mp4',prefix || 'held_masked.mp4.enc',prefix || 'held_faces.mfe.enc',
    1,'2000-01-01T00:00:00Z','ready','on_demand'
  );
  delete from public.recordings where id = decoy;
  if exists (select 1 from public.retention_deletion_queue where object_path like prefix || 'held%') then
    raise exception 'deleting a decoy row queued the held recording''s objects';
  end if;

  -- The retention sweep removes the expired face_encrypted row (not the held
  -- one) and queues its masked video AND its envelope.
  update public.retention_policies set retention_days = 1, enabled = true where resource = 'recordings';
  perform public.sweep_retention();
  if exists (select 1 from public.recordings where id = rec_fe) then
    raise exception 'retention kept the expired face_encrypted recording';
  end if;
  if not exists (select 1 from public.recordings where id = held) then
    raise exception 'retention deleted a held face_encrypted recording';
  end if;
  select array_agg(object_path order by object_path) into queued
    from public.retention_deletion_queue
   where bucket = 'recordings' and object_path like prefix || 'fe%';
  if queued is distinct from array[prefix || 'fe_faces.mfe.enc', prefix || 'fe_masked.mp4.enc'] then
    raise exception 'face_encrypted sweep queued %', queued;
  end if;
  if exists (select 1 from public.retention_deletion_queue where object_path like prefix || 'held%') then
    raise exception 'the held recording''s objects were queued for deletion';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: no user-token write on cameras, no INSERT / UPDATE / DELETE on
-- recordings (table or the new column); the service role keeps everything.
-- ---------------------------------------------------------------------------
do $$
declare
  p text;
  r text;
  offenders text[] := '{}';
begin
  foreach r in array array['anon','authenticated'] loop
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(r, 'public.cameras', p) then
        offenders := offenders || format('%s:cameras:%s', r, p);
      end if;
    end loop;
    foreach p in array array['INSERT','UPDATE','REFERENCES'] loop
      if has_column_privilege(r, 'public.cameras', 'recording_mode', p) then
        offenders := offenders || format('%s:cameras.recording_mode:%s', r, p);
      end if;
    end loop;
    foreach p in array array['INSERT','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(r, 'public.recordings', p) then
        offenders := offenders || format('%s:recordings:%s', r, p);
      end if;
    end loop;
  end loop;
  if has_table_privilege('authenticated', 'public.recordings', 'UPDATE')
     or has_column_privilege('authenticated', 'public.recordings', 'face_envelope_path', 'UPDATE')
     or has_column_privilege('authenticated', 'public.recordings', 'blur_strategy', 'UPDATE') then
    offenders := offenders || 'authenticated:recordings:UPDATE'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.cameras', 'SELECT')
     or not has_table_privilege('authenticated', 'public.recordings', 'SELECT')
     or not has_column_privilege('authenticated', 'public.cameras', 'recording_mode', 'SELECT')
     or not has_column_privilege('authenticated', 'public.recordings', 'face_envelope_path', 'SELECT') then
    offenders := offenders || 'authenticated lost SELECT'::text;
  end if;
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role', 'public.cameras', p)
       or not has_table_privilege('service_role', 'public.recordings', p) then
      offenders := offenders || format('service_role:%s missing', p);
    end if;
  end loop;
  if cardinality(offenders) > 0 then
    raise exception 'unexpected privileges: %', offenders;
  end if;
end;
$$;

-- Behaviour, not just catalog flags: a verified admin token cannot change the
-- mode or the recording metadata through PostgREST; the service role can.
do $$
declare
  admin text := current_setting('mongolz_test.admin');
  cam uuid := current_setting('mongolz_test.cam_fe')::uuid;
  prefix text := current_setting('mongolz_test.prefix');
  held uuid;
  stmt text;
  refused boolean;
begin
  select id into held from public.recordings where filename = prefix || 'held.mp4';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  set local role authenticated;
  foreach stmt in array array[
    format($f$update public.cameras set recording_mode='standard' where id=%L$f$, cam),
    format($f$insert into public.cameras(name,url,cam_type,recording_mode) values ('x','demo://x','demo','standard')$f$),
    format($f$update public.recordings set face_envelope_path=null where id=%L$f$, held),
    format($f$update public.recordings set blur_strategy='on_demand' where id=%L$f$, held),
    format($f$delete from public.recordings where id=%L$f$, held),
    -- A decoy row naming the held recording's objects (retention would then
    -- delete them with the decoy): refused since INSERT was revoked.
    format($f$insert into public.recordings(filename,storage_path,duration_sec,blur_strategy,capture_status,started_at,face_envelope_path)
              values (%L,%L,1,'face_encrypted','ready','2000-01-01T00:00:00Z',%L)$f$,
           prefix || 'decoy.mp4', prefix || 'held_masked.mp4.enc', prefix || 'held_faces.mfe.enc')
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
  refused := false;
  begin
    execute format($f$update public.cameras set recording_mode='standard' where id=%L$f$, cam);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'anon could update cameras.recording_mode'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if (select recording_mode from public.cameras where id = cam) <> 'face_encrypted'
     or (select face_envelope_path from public.recordings where id = held) is distinct from prefix || 'held_faces.mfe.enc' then
    raise exception 'a refused write changed the fixtures';
  end if;

  -- The web action and the ML write with the service role.
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  set local role service_role;
  update public.cameras set recording_mode = 'standard' where id = cam;
  update public.cameras set recording_mode = 'face_encrypted' where id = cam;
  update public.recordings set capture_error = 'service role write' where id = held;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: operators see the new columns through RLS, the auditor sees nothing;
-- the recordings storage policy signs the playback artifact, never the
-- sealed envelope (nor, as before, an original).
-- ---------------------------------------------------------------------------
do $$
declare
  cam uuid := current_setting('mongolz_test.cam_fe')::uuid;
  prefix text := current_setting('mongolz_test.prefix');
  admin text := current_setting('mongolz_test.admin');
  viewer text := current_setting('mongolz_test.viewer');
  auditor text := current_setting('mongolz_test.auditor');
  who record;
  mode text;
  envelope text;
  names text[];
begin
  insert into storage.objects(bucket_id, name) values
    ('recordings', prefix || 'held_masked.mp4.enc'),
    ('recordings', prefix || 'held_faces.mfe.enc');

  for who in select * from (values
      (admin,   true,  'admin'),
      (viewer,  true,  'viewer (camera with no grants: default-allow)'),
      (auditor, false, 'auditor (not an operator)')
    ) as t(uid, sees, label)
  loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub',who.uid,'role','authenticated',
      'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
    set local role authenticated;
    select recording_mode into mode from public.cameras where id = cam;
    select face_envelope_path into envelope from public.recordings where filename = prefix || 'held.mp4';
    select array_agg(name order by name) into names
      from storage.objects
     where bucket_id = 'recordings' and name like prefix || 'held%';
    reset role;

    if who.sees then
      if mode is distinct from 'face_encrypted' or envelope is distinct from prefix || 'held_faces.mfe.enc' then
        raise exception '% could not read the new columns (mode %, envelope %)', who.label, mode, envelope;
      end if;
      if names is distinct from array[prefix || 'held_masked.mp4.enc'] then
        raise exception '% could reach storage objects %', who.label, names;
      end if;
    else
      if mode is not null or envelope is not null or names is not null then
        raise exception '% read mode %, envelope %, objects %', who.label, mode, envelope, names;
      end if;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

do $$ begin raise notice 'Face-encrypted recordings SQL: shape, CHECKs, placeholder flow, retention, grants and read paths passed'; end $$;
rollback;
