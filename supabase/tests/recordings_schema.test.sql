-- Run against an isolated local database with all migrations applied
-- (`npm run test:sql`). Covers migration 20261001100000 (recording mode withdrawn):
--   * the withdrawn recording mode left nothing behind: no envelope column,
--     index or CHECK on recordings, no recording-mode column on cameras, and
--     recordings_blur_strategy_check is back to baked | on_demand;
--   * retention: public.enqueue_retention_storage_deletion() has its
--     20260907101000 behaviour again (a deleted recording queues storage_path
--     and original_path, whatever other rows name) and stays a SECURITY
--     DEFINER function nobody but its owner can execute;
--   * the kept hardening from 20260930100000: no user-token INSERT on
--     recordings and no "recordings: admin insert" policy (with the earlier
--     DELETE and authenticated-UPDATE revokes still in place), the service
--     role keeps full access, and recordings_storage_path_idx still serves the
--     recordings storage policy.
-- Everything runs in one transaction and rolls back.
begin;

-- ---------------------------------------------------------------------------
-- Shape: nothing of the withdrawn mode is left.
-- ---------------------------------------------------------------------------
do $$
declare
  leftovers text[];
  def text;
begin
  select array_agg(table_name || '.' || column_name order by table_name, column_name) into leftovers
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'recordings' and column_name like '%envelope%')
       or (table_name = 'cameras' and column_name like 'recording%'));
  if leftovers is not null then
    raise exception 'withdrawn columns still exist: %', leftovers;
  end if;

  select array_agg(conrelid::regclass::text || '.' || conname order by conname) into leftovers
    from pg_constraint
   where conrelid in ('public.recordings'::regclass, 'public.cameras'::regclass)
     and contype = 'c'
     and (conname like '%envelope%' or conname like 'cameras_recording%'
          or pg_get_constraintdef(oid) like '%envelope%');
  if leftovers is not null then
    raise exception 'withdrawn CHECKs still exist: %', leftovers;
  end if;

  select array_agg(indexname order by indexname) into leftovers
    from pg_indexes
   where schemaname = 'public' and tablename = 'recordings'
     and (indexname like '%envelope%' or indexname = 'recordings_original_path_idx');
  if leftovers is not null then
    raise exception 'withdrawn indexes still exist: %', leftovers;
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conrelid = 'public.recordings'::regclass
     and conname = 'recordings_blur_strategy_check' and convalidated;
  if def is distinct from 'CHECK ((blur_strategy = ANY (ARRAY[''baked''::text, ''on_demand''::text])))' then
    raise exception 'recordings_blur_strategy_check is %', def;
  end if;

  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'recordings' and column_name = 'blur_strategy')
     is distinct from '''baked''::text' then
    raise exception 'recordings.blur_strategy no longer defaults to baked';
  end if;

  -- Kept: the storage policy probes recordings.storage_path on every signed read.
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'recordings'
                    and indexname = 'recordings_storage_path_idx') then
    raise exception 'recordings_storage_path_idx is missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention trigger function: the 20260907101000 behaviour and attributes.
-- ---------------------------------------------------------------------------
do $$
declare
  fn oid := 'public.enqueue_retention_storage_deletion()'::regprocedure;
  prefix text := 'recordings-schema-test/' || gen_random_uuid()::text || '/';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  queued text[];
  r text;
begin
  if not (select prosecdef from pg_proc where oid = fn) then
    raise exception 'enqueue_retention_storage_deletion is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = fn
                    and proconfig @> array['search_path=public, pg_catalog']) then
    raise exception 'enqueue_retention_storage_deletion lost its search_path';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, fn, 'EXECUTE') then
      raise exception '% can execute enqueue_retention_storage_deletion', r;
    end if;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  -- Two rows (inserted as the owner) that name the same playback object: the
  -- restored body queues a deleted row's paths without looking at other rows.
  insert into public.recordings(
    id, filename, storage_path, original_path, duration_sec, started_at, capture_status, blur_strategy
  ) values
    (a, prefix || 'a.mp4', prefix || 'shared.mp4', prefix || 'a_original.mp4.enc',
     60, now() - interval '1 day', 'ready', 'on_demand'),
    (b, prefix || 'b.mp4', prefix || 'shared.mp4', null,
     60, now() - interval '1 day', 'ready', 'baked');

  delete from public.recordings where id = a;
  select array_agg(object_path order by object_path) into queued
    from public.retention_deletion_queue
   where bucket = 'recordings' and object_path like prefix || '%';
  if queued is distinct from array[prefix || 'a_original.mp4.enc', prefix || 'shared.mp4'] then
    raise exception 'deleting a recording queued %', queued;
  end if;

  delete from public.recordings where id = b;
  if (select count(*) from public.retention_deletion_queue
       where bucket = 'recordings' and object_path like prefix || '%') <> 2 then
    raise exception 'the second delete did not settle on the existing queue row';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kept hardening: recordings rows are written only by the service role.
-- ---------------------------------------------------------------------------
do $$
declare
  p text;
  r text;
  offenders text[] := '{}';
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.recordings', p) then
        offenders := offenders || format('%s:recordings:%s', r, p);
      end if;
    end loop;
  end loop;
  -- UPDATE: revoked from authenticated by 20260928100000 (anon has no
  -- recordings policy, so RLS refuses it; unchanged by these migrations).
  if has_table_privilege('authenticated', 'public.recordings', 'UPDATE') then
    offenders := offenders || 'authenticated:recordings:UPDATE'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.recordings', 'SELECT') then
    offenders := offenders || 'authenticated lost SELECT on recordings'::text;
  end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.recordings', p) then
      offenders := offenders || format('service_role:%s missing', p);
    end if;
  end loop;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'recordings'
                and (policyname = 'recordings: admin insert'
                     or (permissive = 'PERMISSIVE' and cmd in ('INSERT', 'ALL')))) then
    offenders := offenders || 'a permissive INSERT policy exists on recordings'::text;
  end if;
  if cardinality(offenders) > 0 then
    raise exception 'unexpected privileges: %', offenders;
  end if;
end;
$$;

-- Behaviour, not just catalog flags: a verified admin token cannot insert a
-- recordings row; the service role can.
do $$
declare
  admin uuid := gen_random_uuid();
  refused boolean := false;
  row_id uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
    values (admin, admin::text || '@recordings-schema-test.invalid', now(), '{}');
  insert into public.profiles(id, email)
    values (admin, admin::text || '@recordings-schema-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role = 'admin', totp_enabled = false where id = admin;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', admin, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp')))::text, true);
  set local role authenticated;
  begin
    insert into public.recordings(filename, storage_path, duration_sec, blur_strategy, capture_status, started_at)
      values ('decoy.mp4', 'recordings-schema-test/decoy.mp4', 1, 'on_demand', 'ready', '2000-01-01T00:00:00Z');
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  if not refused then
    raise exception 'an authenticated admin could insert a recordings row';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  set local role service_role;
  insert into public.recordings(id, filename, storage_path, duration_sec, blur_strategy, capture_status, started_at)
    values (row_id, 'svc.mp4', 'recordings-schema-test/svc.mp4', 1, 'on_demand', 'ready', now());
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.recordings where id = row_id) then
    raise exception 'the service role could not insert a recordings row';
  end if;
end;
$$;

do $$ begin raise notice 'Recordings SQL: withdrawn mode removed, retention trigger restored, write grants kept'; end $$;
rollback;
