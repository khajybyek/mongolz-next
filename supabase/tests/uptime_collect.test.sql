-- Run against an isolated local database with all migrations applied.
-- Regression for 20260927110000_uptime_per_component_alerts: an unanswered
-- /api/uptime probe used to be reported as "ML DOWN" and a failed database
-- check never alerted. Fabricates net._http_response + uptime_checks rows and
-- asserts on web_ok / ml_ok / db_ok, on `notified` and on the Telegram posts
-- private.uptime_collect() queues in net.http_request_queue. Nothing is sent:
-- pg_net's worker never sees rows of an uncommitted transaction, and
-- everything rolls back.
begin;

-- The migrations schedule the real probe (mongolz-uptime-probe) and collector
-- (mongolz-uptime-collect) in this database too. Hold the table so a probe row
-- pg_cron commits mid-test can never become the "newest probe" an assertion
-- reads; cron simply waits for the rollback.
lock table public.uptime_checks in exclusive mode;

-- Reset the probe history for one scenario (the transaction rolls it back).
create function pg_temp.reset() returns void language sql as $f$
  delete from public.uptime_checks;
$f$;

-- A completed probe `age` ago.
create function pg_temp.done(age interval, web boolean, ml boolean, db boolean)
returns void language sql as $f$
  insert into public.uptime_checks (checked_at, request_id, http_status, web_ok, ml_ok, db_ok, status)
  values (now() - age, null, case when web then 200 else 0 end, web, ml, db,
          case when web then 'ok' else 'timeout' end);
$f$;

-- A probe `age` ago whose pg_net response is already stored but not collected.
create function pg_temp.pending(age interval, rid bigint, code integer, content text, timed_out boolean)
returns void language sql as $f$
  delete from net._http_response where id = rid;
  insert into net._http_response (id, status_code, content_type, content, timed_out, error_msg)
  values (rid, code, 'application/json', content, timed_out,
          case when timed_out then 'Timeout of 15000 ms reached' end);
  insert into public.uptime_checks (checked_at, request_id) values (now() - age, rid);
$f$;

-- A probe `age` ago whose pg_net response never arrived.
create function pg_temp.lost(age interval, rid bigint)
returns void language sql as $f$
  delete from net._http_response where id = rid;
  insert into public.uptime_checks (checked_at, request_id) values (now() - age, rid);
$f$;

-- The /api/uptime body.
create function pg_temp.body(ml boolean, db boolean) returns text language sql as $f$
  select jsonb_build_object(
    'status', case when ml and db then 'ok' else 'degraded' end,
    'ts', now(),
    'checks', jsonb_build_object(
      'ml', jsonb_build_object('ok', ml, 'latency', '<100ms'),
      'db', jsonb_build_object('ok', db, 'latency', '<100ms')))::text;
$f$;

-- Kinds queued for the telegram-alerts function after queue id `since`.
create function pg_temp.sent(since bigint) returns text language sql as $f$
  select coalesce(string_agg(convert_from(body, 'utf8')::jsonb->>'kind', ',' order by id), '')
    from net.http_request_queue
   where id > since and url like '%/functions/v1/telegram-alerts';
$f$;

create function pg_temp.queue_mark() returns bigint language sql as $f$
  select coalesce(max(id), 0) from net.http_request_queue;
$f$;

do $$
declare
  mark bigint;
  rec public.uptime_checks;
  got text;
begin
  -- The collector only posts when both vault secrets exist; point a local-only
  -- fixture at a discard port. A real project keeps its own values.
  if not exists (select 1 from vault.decrypted_secrets where name = 'edge_url') then
    perform vault.create_secret('http://127.0.0.1:9', 'edge_url');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    perform vault.create_secret('uptime-collect-test-key', 'service_role_key');
  end if;

  -- 1) Web down (timeout): web_ok=false, ml/db unknown, one web_down — not ml_down.
  perform pg_temp.reset();
  perform pg_temp.done('12 minutes', true, true, true);
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.pending('2 minutes', 9100000000001, null, null, true);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000001;
  if rec.http_status is distinct from 0 or rec.web_ok is distinct from false
     or rec.ml_ok is not null or rec.db_ok is not null then
    raise exception 'timeout probe stored wrong (http %, web %, ml %, db %)',
      rec.http_status, rec.web_ok, rec.ml_ok, rec.db_ok;
  end if;
  got := pg_temp.sent(mark);
  if rec.notified is distinct from 'web_down' or got <> 'web_down' then
    raise exception 'web outage: expected web_down, notified % sent %', rec.notified, got;
  end if;

  -- Still down on the next probe: nothing new.
  perform pg_temp.pending('1 minute', 9100000000002, null, null, true);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000002;
  got := pg_temp.sent(mark);
  if rec.notified is not null or got <> '' then
    raise exception 'continued web outage re-alerted: notified % sent %', rec.notified, got;
  end if;

  -- 1b) Web down (HTML 502 and a foreign JSON 500): not /api/uptime's answer.
  perform pg_temp.reset();
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.pending('2 minutes', 9100000000003, 502, '<html><body>Bad gateway</body></html>', false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000003;
  got := pg_temp.sent(mark);
  if rec.http_status is distinct from 502 or rec.web_ok is distinct from false
     or rec.ml_ok is not null or rec.db_ok is not null or rec.status is distinct from 'http_502'
     or rec.notified is distinct from 'web_down' or got <> 'web_down' then
    raise exception 'HTML 502 misread (http %, web %, ml %, db %, status %, notified %, sent %)',
      rec.http_status, rec.web_ok, rec.ml_ok, rec.db_ok, rec.status, rec.notified, got;
  end if;

  perform pg_temp.reset();
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.pending('2 minutes', 9100000000004, 500,
    '{"status":"error","error":{"code":"FUNCTION_INVOCATION_FAILED"}}', false);
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000004;
  if rec.web_ok is distinct from false or rec.ml_ok is not null or rec.db_ok is not null
     or rec.status is distinct from 'http_500' or rec.notified is distinct from 'web_down' then
    raise exception 'foreign JSON 500 misread (web %, ml %, db %, status %, notified %)',
      rec.web_ok, rec.ml_ok, rec.db_ok, rec.status, rec.notified;
  end if;

  -- 2) Web recovered with everything healthy: exactly one web_recovered.
  perform pg_temp.reset();
  perform pg_temp.done('12 minutes', true, true, true);
  perform pg_temp.done('7 minutes', false, null, null);
  perform pg_temp.pending('2 minutes', 9100000000005, 200, pg_temp.body(true, true), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000005;
  got := pg_temp.sent(mark);
  if rec.web_ok is distinct from true or rec.ml_ok is distinct from true
     or rec.db_ok is distinct from true or rec.status is distinct from 'ok'
     or rec.notified is distinct from 'web_recovered' or got <> 'web_recovered' then
    raise exception 'web recovery wrong (web %, ml %, db %, status %, notified %, sent %)',
      rec.web_ok, rec.ml_ok, rec.db_ok, rec.status, rec.notified, got;
  end if;

  -- 2b) ML failed during the web outage: reported once the web is back,
  -- against the last probe the web app answered.
  perform pg_temp.reset();
  perform pg_temp.done('12 minutes', true, true, true);
  perform pg_temp.done('7 minutes', false, null, null);
  perform pg_temp.pending('2 minutes', 9100000000006, 503, pg_temp.body(false, true), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000006;
  got := pg_temp.sent(mark);
  if rec.notified is distinct from 'web_recovered,ml_down' or got <> 'web_recovered,ml_down' then
    raise exception 'recovery with ML down: notified % sent %', rec.notified, got;
  end if;

  -- A partly sent probe only sends what is missing.
  update public.uptime_checks set notified = 'web_recovered' where id = rec.id;
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where id = rec.id;
  got := pg_temp.sent(mark);
  if rec.notified is distinct from 'web_recovered,ml_down' or got <> 'ml_down' then
    raise exception 'partial resend: notified % sent %', rec.notified, got;
  end if;

  -- 3) Database down while the web app answers (HTTP 503 "degraded").
  perform pg_temp.reset();
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.pending('2 minutes', 9100000000007, 503, pg_temp.body(true, false), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000007;
  got := pg_temp.sent(mark);
  if rec.http_status is distinct from 503 or rec.web_ok is distinct from true
     or rec.ml_ok is distinct from true or rec.db_ok is distinct from false
     or rec.status is distinct from 'degraded'
     or rec.notified is distinct from 'db_down' or got <> 'db_down' then
    raise exception 'db outage wrong (http %, web %, ml %, db %, status %, notified %, sent %)',
      rec.http_status, rec.web_ok, rec.ml_ok, rec.db_ok, rec.status, rec.notified, got;
  end if;

  -- ... and recovered.
  perform pg_temp.pending('1 minute', 9100000000008, 200, pg_temp.body(true, true), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000008;
  got := pg_temp.sent(mark);
  if rec.notified is distinct from 'db_recovered' or got <> 'db_recovered' then
    raise exception 'db recovery: notified % sent %', rec.notified, got;
  end if;

  -- 4) ML down while the web app answers.
  perform pg_temp.reset();
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.pending('2 minutes', 9100000000009, 503, pg_temp.body(false, true), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000009;
  got := pg_temp.sent(mark);
  if rec.web_ok is distinct from true or rec.ml_ok is distinct from false
     or rec.db_ok is distinct from true
     or rec.notified is distinct from 'ml_down' or got <> 'ml_down' then
    raise exception 'ml outage wrong (web %, ml %, db %, notified %, sent %)',
      rec.web_ok, rec.ml_ok, rec.db_ok, rec.notified, got;
  end if;

  -- 5) Re-running the collector on the same probes sends nothing twice.
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000009;
  got := pg_temp.sent(mark);
  if rec.notified is distinct from 'ml_down' or got <> '' then
    raise exception 'duplicate on re-run: notified % sent %', rec.notified, got;
  end if;

  -- 6) Several components at once: web, then db, then ml.
  perform pg_temp.reset();
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.pending('2 minutes', 9100000000010, 503, pg_temp.body(false, false), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000010;
  got := pg_temp.sent(mark);
  if rec.notified is distinct from 'db_down,ml_down' or got <> 'db_down,ml_down' then
    raise exception 'multi-component order: notified % sent %', rec.notified, got;
  end if;

  -- 7) Lost pg_net response (no net._http_response row after 3 minutes):
  -- the web app did not answer — web_down, ML/DB unknown, never ml_down.
  perform pg_temp.reset();
  perform pg_temp.done('9 minutes', true, true, true);
  perform pg_temp.lost('4 minutes', 9100000000011);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000011;
  got := pg_temp.sent(mark);
  if rec.http_status is distinct from 0 or rec.web_ok is distinct from false
     or rec.ml_ok is not null or rec.db_ok is not null
     or rec.status is distinct from 'no_response'
     or rec.notified is distinct from 'web_down' or got <> 'web_down' then
    raise exception 'lost response wrong (http %, web %, ml %, db %, status %, notified %, sent %)',
      rec.http_status, rec.web_ok, rec.ml_ok, rec.db_ok, rec.status, rec.notified, got;
  end if;

  -- ... but not before 3 minutes: still pending, nothing sent.
  perform pg_temp.reset();
  perform pg_temp.done('7 minutes', true, true, true);
  perform pg_temp.lost('1 minute', 9100000000012);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  select * into rec from public.uptime_checks where request_id = 9100000000012;
  got := pg_temp.sent(mark);
  if rec.http_status is not null or rec.web_ok is not null or got <> '' then
    raise exception 'young lost probe resolved early (http %, web %, sent %)', rec.http_status, rec.web_ok, got;
  end if;

  -- 8) Two probes resolved in one run (a late or lost response, or a skipped
  -- collect tick): each is compared with its own predecessor.
  -- Down at the older probe, still down at the newer: one web_down, on A.
  perform pg_temp.reset();
  perform pg_temp.done('12 minutes', true, true, true);
  perform pg_temp.lost('7 minutes', 9100000000013);
  perform pg_temp.pending('2 minutes', 9100000000014, null, null, true);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  got := pg_temp.sent(mark);
  select * into rec from public.uptime_checks where request_id = 9100000000013;
  if rec.web_ok is distinct from false or rec.notified is distinct from 'web_down' then
    raise exception 'same-run outage: older probe web % notified %', rec.web_ok, rec.notified;
  end if;
  select * into rec from public.uptime_checks where request_id = 9100000000014;
  if rec.web_ok is distinct from false or rec.notified is not null or got <> 'web_down' then
    raise exception 'same-run outage: newer probe web % notified %, sent %', rec.web_ok, rec.notified, got;
  end if;

  -- Down at the older probe, back at the newer: web_down then web_recovered.
  perform pg_temp.reset();
  perform pg_temp.done('12 minutes', true, true, true);
  perform pg_temp.pending('7 minutes', 9100000000015, null, null, true);
  perform pg_temp.pending('2 minutes', 9100000000016, 200, pg_temp.body(true, true), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  got := pg_temp.sent(mark);
  if got <> 'web_down,web_recovered'
     or (select notified from public.uptime_checks where request_id = 9100000000015) is distinct from 'web_down'
     or (select notified from public.uptime_checks where request_id = 9100000000016) is distinct from 'web_recovered' then
    raise exception 'same-run blip: sent %', got;
  end if;

  -- Database failed at the older probe and stays failed (web answered both).
  perform pg_temp.reset();
  perform pg_temp.done('12 minutes', true, true, true);
  perform pg_temp.pending('7 minutes', 9100000000017, 503, pg_temp.body(true, false), false);
  perform pg_temp.pending('2 minutes', 9100000000018, 503, pg_temp.body(true, false), false);
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  got := pg_temp.sent(mark);
  if got <> 'db_down'
     or (select notified from public.uptime_checks where request_id = 9100000000017) is distinct from 'db_down'
     or (select notified from public.uptime_checks where request_id = 9100000000018) is not null then
    raise exception 'same-run db outage: sent %', got;
  end if;

  -- Re-running sends nothing for either probe.
  mark := pg_temp.queue_mark();
  perform private.uptime_collect();
  got := pg_temp.sent(mark);
  if got <> '' then
    raise exception 'same-run re-run duplicated: sent %', got;
  end if;

  -- 9) Backfill of rows collected before the migration (web_ok NULL). The two
  -- statements are copied from 20260927110000 ("Backfill.") — keep them in sync.
  -- A 503 "degraded" row is an answer (web up); only unanswered rows lose
  -- their never-measured ml_ok/db_ok = false.
  perform pg_temp.reset();
  insert into public.uptime_checks (checked_at, request_id, http_status, ml_ok, db_ok, status) values
    (now() - interval '25 minutes', 9100000000021, 200, true,  true,  'ok'),
    (now() - interval '20 minutes', 9100000000022, 503, true,  false, 'degraded'),
    (now() - interval '15 minutes', 9100000000023, 0,   false, false, 'timeout'),
    (now() - interval '10 minutes', 9100000000024, 502, false, false, 'http_502'),
    (now() - interval '5 minutes',  9100000000025, 0,   false, false, 'no_response'),
    (now() - interval '1 minute',   9100000000026, null, null, null,  null);

  update public.uptime_checks
     set web_ok = true
   where web_ok is null
     and http_status between 200 and 599
     and status in ('ok', 'degraded');

  update public.uptime_checks
     set web_ok = false, ml_ok = null, db_ok = null
   where web_ok is null
     and http_status is not null;

  select string_agg(format('%s:%s/%s/%s', request_id - 9100000000020,
                           coalesce(web_ok::text, '-'), coalesce(ml_ok::text, '-'),
                           coalesce(db_ok::text, '-')), ' ' order by request_id)
    into got
    from public.uptime_checks;
  if got is distinct from
     '1:true/true/true 2:true/true/false 3:false/-/- 4:false/-/- 5:false/-/- 6:-/-/-' then
    raise exception 'backfill wrong: %', got;
  end if;

  -- Every post carries the existing payload shape and the service-role bearer.
  if exists (
    select 1 from net.http_request_queue
     where url like '%/functions/v1/telegram-alerts'
       and id > 0
       and convert_from(body, 'utf8')::jsonb->>'kind' like any (array['web_%', 'db_%', 'ml_%'])
       and (convert_from(body, 'utf8')::jsonb - 'kind' - 'checked_at' <> '{}'::jsonb
            or convert_from(body, 'utf8')::jsonb->>'checked_at' is null
            or headers->>'Authorization' not like 'Bearer %')
  ) then
    raise exception 'uptime post has the wrong payload shape or headers';
  end if;

  if has_function_privilege('authenticated', 'private.uptime_collect()', 'execute')
     or has_function_privilege('anon', 'private.uptime_collect()', 'execute') then
    raise exception 'uptime_collect must not be callable by API roles';
  end if;

  raise notice 'uptime_collect per-component alert assertions passed';
end;
$$;
rollback;
