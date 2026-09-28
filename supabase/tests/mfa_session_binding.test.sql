-- Run against an isolated local database with all migrations applied
-- (`npm run test:sql`). Exercises the session binding of migration
-- 20260928120000: private.mfa_ok() refuses a TOTP profile's session that the
-- app did not bind after a verified second factor, public.bind_mfa_session()
-- (service_role only) and public.mfa_session_bound().
-- Everything runs in one transaction and rolls back. Ids are handed between
-- the DO blocks through transaction-local `mongolz_test.*` settings because
-- the role switches (`set local role ...`) must happen at top level.
begin;

-- ---------------------------------------------------------------------------
-- Fixtures: a TOTP admin with a bound-to-be and an unbound session, a second
-- TOTP admin with one session, a non-TOTP admin with one session, a face.
-- ---------------------------------------------------------------------------
do $$
declare
  totp_admin uuid := gen_random_uuid();
  other_admin uuid := gen_random_uuid();
  plain_admin uuid := gen_random_uuid();
  s_bound uuid := gen_random_uuid();
  s_unbound uuid := gen_random_uuid();
  s_other uuid := gen_random_uuid();
  s_other_unbound uuid := gen_random_uuid();
  s_plain uuid := gen_random_uuid();
  camera uuid := gen_random_uuid();
  face uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);

  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (totp_admin,totp_admin::text || '@binding-test.invalid',now(),'{}'),
    (other_admin,other_admin::text || '@binding-test.invalid',now(),'{}'),
    (plain_admin,plain_admin::text || '@binding-test.invalid',now(),'{}');
  insert into public.profiles(id,email) values
    (totp_admin,totp_admin::text || '@binding-test.invalid'),
    (other_admin,other_admin::text || '@binding-test.invalid'),
    (plain_admin,plain_admin::text || '@binding-test.invalid')
  on conflict (id) do nothing;
  update public.profiles set role='admin', totp_enabled=true where id in (totp_admin,other_admin);
  update public.profiles set role='admin', totp_enabled=false where id=plain_admin;

  -- GoTrue sessions, as GoTrue writes them.
  insert into auth.sessions(id,user_id,created_at,updated_at) values
    (s_bound,totp_admin,now(),now()),
    (s_unbound,totp_admin,now(),now()),
    (s_other,other_admin,now(),now()),
    (s_other_unbound,other_admin,now(),now()),
    (s_plain,plain_admin,now(),now());

  insert into public.cameras(id,name,url,cam_type)
    values (camera,'Binding fixture camera','demo://binding-fixture','demo');
  insert into public.faces(id,filename,image_path,embedding,camera_id)
    values (face,'binding-fixture.jpg','fixture/binding.jpg',
            array_fill(1::real, array[512])::extensions.vector,camera);

  perform set_config('mongolz_test.totp_admin', totp_admin::text, true);
  perform set_config('mongolz_test.other_admin', other_admin::text, true);
  perform set_config('mongolz_test.plain_admin', plain_admin::text, true);
  perform set_config('mongolz_test.s_bound', s_bound::text, true);
  perform set_config('mongolz_test.s_unbound', s_unbound::text, true);
  perform set_config('mongolz_test.s_other', s_other::text, true);
  perform set_config('mongolz_test.s_other_unbound', s_other_unbound::text, true);
  perform set_config('mongolz_test.s_plain', s_plain::text, true);
  perform set_config('mongolz_test.face', face::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Schema shape and grants: only the server may bind or ask; the table is not
-- readable by the API roles; the binding dies with its session.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select mfa_required and mfa_session_binding from private.security_settings where id) is not true then
    raise exception 'fixture precondition: mfa_required and mfa_session_binding must both be true';
  end if;

  if has_function_privilege('anon','public.bind_mfa_session(uuid,uuid,text)','execute')
     or has_function_privilege('authenticated','public.bind_mfa_session(uuid,uuid,text)','execute')
     or has_function_privilege('anon','public.mfa_session_bound(uuid)','execute')
     or has_function_privilege('authenticated','public.mfa_session_bound(uuid)','execute') then
    raise exception 'anon/authenticated can execute the session-binding RPCs';
  end if;
  if not has_function_privilege('service_role','public.bind_mfa_session(uuid,uuid,text)','execute')
     or not has_function_privilege('service_role','public.mfa_session_bound(uuid)','execute') then
    raise exception 'service_role lost execute on the session-binding RPCs';
  end if;
  if not has_function_privilege('authenticated','private.mfa_ok()','execute') then
    raise exception 'authenticated lost execute on private.mfa_ok() (every gated read would fail)';
  end if;
  if has_table_privilege('anon','private.mfa_sessions','select')
     or has_table_privilege('authenticated','private.mfa_sessions','select')
     or has_table_privilege('authenticated','private.mfa_sessions','insert') then
    raise exception 'API roles can read or write private.mfa_sessions';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'private.mfa_sessions'::regclass) then
    raise exception 'RLS is not enabled on private.mfa_sessions';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.mfa_sessions'::regclass and contype = 'f'
      and confrelid = 'auth.sessions'::regclass and confdeltype = 'c'
  ) then
    raise exception 'private.mfa_sessions.session_id is not ON DELETE CASCADE to auth.sessions';
  end if;
end;
$$;

-- A user token cannot bind (it would bind its own mailbox session) or read
-- the bindings. The EXECUTE refusal is proven with has_function_privilege()
-- above rather than by calling the function as `authenticated`: on the local
-- image (supabase/postgres 17.6.1.106) a permission-denied error on a
-- FUNCTION call made after `set role` in a psql session kills the backend
-- with SIGSEGV — the same happens for the long-standing
-- public.rate_limit_hit(), so it is the image, not this migration (through
-- PostgREST the same call answers a normal 401 / 42501). A table-level
-- refusal errors normally.
set local role authenticated;
do $$
declare
  refused boolean := false;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',current_setting('mongolz_test.totp_admin'),'role','authenticated',
    'session_id',current_setting('mongolz_test.s_unbound'))::text, true);
  begin
    perform 1 from private.mfa_sessions;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'authenticated read private.mfa_sessions'; end if;

  refused := false;
  begin
    insert into private.mfa_sessions(session_id,user_id,method)
      values (current_setting('mongolz_test.s_unbound')::uuid,
              current_setting('mongolz_test.totp_admin')::uuid,'totp');
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'authenticated wrote private.mfa_sessions'; end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- public.bind_mfa_session() as the server calls it.
-- ---------------------------------------------------------------------------
set local role service_role;
do $$
declare
  totp_admin uuid := current_setting('mongolz_test.totp_admin')::uuid;
  other_admin uuid := current_setting('mongolz_test.other_admin')::uuid;
  s_bound uuid := current_setting('mongolz_test.s_bound')::uuid;
  s_unbound uuid := current_setting('mongolz_test.s_unbound')::uuid;
  s_other uuid := current_setting('mongolz_test.s_other')::uuid;
  s_other_unbound uuid := current_setting('mongolz_test.s_other_unbound')::uuid;
  refused boolean;
  msg text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);

  perform public.bind_mfa_session(s_bound, totp_admin, 'totp');
  -- Idempotent: a retried login binds once and keeps the first method.
  perform public.bind_mfa_session(s_bound, totp_admin, 'passkey');
  perform public.bind_mfa_session(s_other, other_admin, 'passkey');

  -- A session of another user is refused — whether or not it is bound.
  refused := false;
  begin perform public.bind_mfa_session(s_other_unbound, totp_admin, 'totp');
  exception when invalid_parameter_value then
    get stacked diagnostics msg = message_text;
    refused := msg like '%belongs to another user%';
  end;
  if not refused then raise exception 'bind_mfa_session bound another user''s (unbound) session'; end if;
  refused := false;
  begin perform public.bind_mfa_session(s_other, totp_admin, 'totp');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'bind_mfa_session bound another user''s session'; end if;

  -- A session that does not exist is refused.
  refused := false;
  begin perform public.bind_mfa_session(gen_random_uuid(), totp_admin, 'totp');
  exception when invalid_parameter_value then
    get stacked diagnostics msg = message_text;
    refused := msg like '%session not found%';
  end;
  if not refused then raise exception 'bind_mfa_session bound a session that does not exist'; end if;

  -- Unknown method / missing arguments are refused.
  refused := false;
  begin perform public.bind_mfa_session(s_unbound, totp_admin, 'sms');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'bind_mfa_session accepted an unknown method'; end if;
  refused := false;
  begin perform public.bind_mfa_session(null, totp_admin, 'totp');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'bind_mfa_session accepted a NULL session'; end if;
  refused := false;
  begin perform public.bind_mfa_session(s_unbound, null, 'totp');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'bind_mfa_session accepted a NULL user'; end if;

  if public.mfa_session_bound(s_bound) is not true then raise exception 'mfa_session_bound: bound session reported unbound'; end if;
  if public.mfa_session_bound(s_unbound) is not false then raise exception 'mfa_session_bound: unbound session reported bound'; end if;
  if public.mfa_session_bound(gen_random_uuid()) is not false then raise exception 'mfa_session_bound: unknown session reported bound'; end if;
  if public.mfa_session_bound(null) is not null then raise exception 'mfa_session_bound(NULL) must be NULL (unknown)'; end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
reset role;

do $$
declare
  totp_admin uuid := current_setting('mongolz_test.totp_admin')::uuid;
  other_admin uuid := current_setting('mongolz_test.other_admin')::uuid;
  s_bound uuid := current_setting('mongolz_test.s_bound')::uuid;
  s_unbound uuid := current_setting('mongolz_test.s_unbound')::uuid;
  s_other uuid := current_setting('mongolz_test.s_other')::uuid;
  refused boolean;
begin
  if (select count(*) from private.mfa_sessions where session_id in (s_bound, s_unbound, s_other)) <> 2 then
    raise exception 'expected exactly the two bound fixture sessions in private.mfa_sessions';
  end if;
  if (select method from private.mfa_sessions where session_id = s_bound) <> 'totp' then
    raise exception 'a repeated bind replaced the recorded method';
  end if;
  if exists (select 1 from private.mfa_sessions where session_id = s_unbound) then
    raise exception 'a refused bind left a row behind';
  end if;
  if exists (select 1 from private.mfa_sessions
             where session_id = current_setting('mongolz_test.s_other_unbound')::uuid) then
    raise exception 'a refused cross-user bind left a row behind';
  end if;
  -- The server itself reads bindings only through the SECURITY DEFINER RPCs.
  if has_table_privilege('service_role','private.mfa_sessions','select') then
    raise exception 'service_role can read private.mfa_sessions directly';
  end if;

  -- Never re-point: a row that (only by tampering) names another user than
  -- the session's owner makes bind refuse instead of silently accepting it.
  update private.mfa_sessions set user_id = other_admin where session_id = s_bound;
  refused := false;
  begin perform public.bind_mfa_session(s_bound, totp_admin, 'totp');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'bind_mfa_session accepted a binding that points at another user'; end if;
  if (select user_id from private.mfa_sessions where session_id = s_bound) <> other_admin then
    raise exception 'bind_mfa_session re-pointed an existing binding';
  end if;
  update private.mfa_sessions set user_id = totp_admin where session_id = s_bound;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.mfa_ok(): the binding branch.
-- ---------------------------------------------------------------------------
do $$
declare
  totp_admin text := current_setting('mongolz_test.totp_admin');
  plain_admin text := current_setting('mongolz_test.plain_admin');
  s_bound text := current_setting('mongolz_test.s_bound');
  s_unbound text := current_setting('mongolz_test.s_unbound');
  s_other text := current_setting('mongolz_test.s_other');
  s_plain text := current_setting('mongolz_test.s_plain');
  m text;
begin
  -- The app's own session: bound after the second factor.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_bound,
    'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',1)))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a bound otp session of a TOTP profile'; end if;

  -- The mailbox session: same amr shapes, no binding.
  foreach m in array array['otp','magiclink','recovery','email'] loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub',totp_admin,'role','authenticated','session_id',s_unbound,
      'amr',jsonb_build_array(jsonb_build_object('method',m,'timestamp',1)))::text, true);
    if private.mfa_ok() then raise exception 'mfa_ok accepted an unbound % session of a TOTP profile', m; end if;
  end loop;

  -- A session id bound to ANOTHER user does not carry over.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_other,
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if private.mfa_ok() then raise exception 'mfa_ok accepted a session id bound to another user'; end if;

  -- The amr = [password] refusal still wins over a binding.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_bound,
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  if private.mfa_ok() then raise exception 'mfa_ok accepted a password-only token because its session is bound'; end if;

  -- Missing / malformed session_id claim: cannot determine -> fail open.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a token without a session_id claim (must fail open)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id','',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused an empty session_id (must fail open)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id','not-a-uuid',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a malformed session_id (must fail open)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',42,
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a numeric session_id (must fail open)'; end if;

  -- A profile without TOTP is untouched, bound or not.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',plain_admin,'role','authenticated','session_id',s_plain,
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused an unbound session of a non-TOTP profile'; end if;

  -- Server roles and claim-less SQL are untouched.
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role','session_id',s_unbound)::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused service_role'; end if;
  perform set_config('request.jwt.claims', '', true);
  if not private.mfa_ok() then raise exception 'mfa_ok refused a claim-less owner session'; end if;

  -- Kill switch (binding only): the unbound session passes, password-only
  -- stays refused, and mfa_session_bound stops asking for a re-login.
  update private.security_settings set mfa_session_binding=false where id;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_unbound,
    'amr',jsonb_build_array(jsonb_build_object('method','magiclink')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok ignored the mfa_session_binding kill switch'; end if;
  if public.mfa_session_bound(s_unbound::uuid) is not true then
    raise exception 'mfa_session_bound ignored the mfa_session_binding kill switch';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_unbound,
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  if private.mfa_ok() then raise exception 'the binding kill switch disarmed the amr = [password] refusal'; end if;
  update private.security_settings set mfa_session_binding=true where id;

  -- The global switch covers the binding too.
  update private.security_settings set mfa_required=false where id;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_unbound,
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if not private.mfa_ok() then raise exception 'mfa_ok ignored mfa_required = false for an unbound session'; end if;
  if public.mfa_session_bound(s_unbound::uuid) is not true then
    raise exception 'mfa_session_bound ignored mfa_required = false';
  end if;
  update private.security_settings set mfa_required=true where id;

  -- Re-armed.
  if private.mfa_ok() then raise exception 'mfa_ok did not re-arm after the kill switches'; end if;
  if public.mfa_session_bound(s_unbound::uuid) is not false then raise exception 'mfa_session_bound did not re-arm'; end if;

  -- The diagnostic reports the claim and the verdict.
  if (public.mfa_status()->>'session_id_present')::boolean is not true
     or (public.mfa_status()->>'mfa_ok')::boolean is not false then
    raise exception 'mfa_status misreports an unbound session: %', public.mfa_status();
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated',
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if (public.mfa_status()->>'session_id_present')::boolean is not false then
    raise exception 'mfa_status reports a session_id that the token does not carry';
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- End to end through RLS (faces carries the restrictive second-factor policy):
-- the bound session reads the face, the unbound one sees nothing, the
-- non-TOTP admin's unbound session is unaffected. public.mfa_status() is
-- asked as `authenticated` too: the claude-analysis edge function gates on
-- its mfa_ok (supabase/functions/claude-analysis/gate.ts).
-- ---------------------------------------------------------------------------
do $$
declare
  totp_admin text := current_setting('mongolz_test.totp_admin');
  plain_admin text := current_setting('mongolz_test.plain_admin');
  face uuid := current_setting('mongolz_test.face')::uuid;
  seen_bound bigint;
  seen_unbound bigint;
  seen_plain bigint;
  status_bound jsonb;
  status_unbound jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',current_setting('mongolz_test.s_bound'),
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  set local role authenticated;
  select count(*) into seen_bound from public.faces where id = face;
  select public.mfa_status() into status_bound;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',current_setting('mongolz_test.s_unbound'),
    'amr',jsonb_build_array(jsonb_build_object('method','magiclink')))::text, true);
  set local role authenticated;
  select count(*) into seen_unbound from public.faces where id = face;
  select public.mfa_status() into status_unbound;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',plain_admin,'role','authenticated','session_id',current_setting('mongolz_test.s_plain'),
    'amr',jsonb_build_array(jsonb_build_object('method','password')))::text, true);
  set local role authenticated;
  select count(*) into seen_plain from public.faces where id = face;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if seen_bound <> 1 then
    raise exception 'RLS hid the face from a bound TOTP session (saw %)', seen_bound;
  end if;
  if seen_unbound <> 0 then
    raise exception 'RLS showed a face to an unbound (mailbox) TOTP session (saw %)', seen_unbound;
  end if;
  if seen_plain <> 1 then
    raise exception 'RLS hid the face from a non-TOTP admin (saw %)', seen_plain;
  end if;
  if (status_bound->>'mfa_ok')::boolean is not true then
    raise exception 'mfa_status (as authenticated) refused a bound TOTP session: %', status_bound;
  end if;
  if (status_unbound->>'mfa_ok')::boolean is not false then
    raise exception 'mfa_status (as authenticated) accepted an unbound (mailbox) TOTP session: %', status_unbound;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The binding disappears with its session (sign-out) and with its user; the
-- signed-out session's unexpired token is then refused.
-- ---------------------------------------------------------------------------
do $$
declare
  totp_admin text := current_setting('mongolz_test.totp_admin');
  other_admin uuid := current_setting('mongolz_test.other_admin')::uuid;
  s_bound uuid := current_setting('mongolz_test.s_bound')::uuid;
  s_other uuid := current_setting('mongolz_test.s_other')::uuid;
begin
  delete from auth.sessions where id = s_bound;
  if exists (select 1 from private.mfa_sessions where session_id = s_bound) then
    raise exception 'binding survived the deletion of its session';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',totp_admin,'role','authenticated','session_id',s_bound::text,
    'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text, true);
  if private.mfa_ok() then raise exception 'mfa_ok accepted the token of a signed-out session'; end if;
  perform set_config('request.jwt.claims', '', true);

  delete from auth.users where id = other_admin;
  if exists (select 1 from private.mfa_sessions where session_id = s_other) then
    raise exception 'binding survived the deletion of its user';
  end if;
end;
$$;

do $$ begin raise notice 'MFA session binding SQL: grants, bind, mfa_ok binding branch, kill switches, RLS and cascade passed'; end $$;
rollback;
