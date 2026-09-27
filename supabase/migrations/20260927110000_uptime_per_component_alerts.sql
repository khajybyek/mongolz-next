-- Uptime monitor: alert per component (web app, database, ML), not only ML.
--
-- Before this migration private.uptime_collect() looked at checks.ml.ok only.
-- A probe the web app never answered (timeout, no response, an HTML 5xx) was
-- stored as ml_ok = false, db_ok = false and announced as "ML DOWN", and a
-- failed database check (checks.db.ok = false, HTTP 503 "degraded") never
-- alerted at all — production held 144 such probes without one message.
--
-- Now:
--   * web_ok records whether aicctv.dev answered /api/uptime with its JSON
--     body (checks.ml.ok and checks.db.ok both booleans). When it did not,
--     ml_ok / db_ok stay NULL — unknown, not "down".
--   * Transitions are evaluated per component, for every probe this run
--     resolved (oldest first) plus the newest completed probe (so a partly
--     sent probe is retried). A probe whose response arrives late resolves in
--     the same run as the next one; each is still compared with its own
--     predecessor, so no transition is skipped. Web: a probe against the
--     completed probe just before it. Database and ML: only while the web app
--     answered, i.e. a probe against the most recent earlier probe the web app
--     also answered — so both compared probes are web-reachable, and a
--     component that changed during a web outage is still reported once the
--     web is back.
--   * One Telegram message per transition (kinds web_down / web_recovered /
--     db_down / db_recovered / ml_down / ml_recovered, payload
--     {kind, checked_at}); `notified` holds every kind already sent for that
--     probe (comma-separated) so a re-run never sends one twice.
--
-- DEPLOY ORDER: deploy the telegram-alerts edge function that knows the four
-- new kinds FIRST. The previously deployed function renders any unknown kind
-- through the default suspect-alert branch (an empty "Security Alert").
--
-- A complete Postgres outage cannot alert from here: pg_cron runs inside the
-- database. See docs/OBSERVABILITY.md ("Uptime alerting") for the external
-- probe that covers it.

alter table public.uptime_checks add column if not exists web_ok boolean;

comment on column public.uptime_checks.web_ok is
  'true = aicctv.dev answered /api/uptime with its JSON body; false = timeout, no response or an unparseable reply (ml_ok/db_ok are then NULL = unknown). NULL = not yet collected.';
comment on column public.uptime_checks.notified is
  'Comma-separated Telegram kinds already sent for this probe (web_*, db_*, ml_*).';

-- Backfill. pg_net keeps response bodies for hours only, so the stored
-- `status` is the evidence: the collector copied body->>'status' ("ok" /
-- "degraded", the only values /api/uptime returns) when the body parsed, and
-- wrote "http_<code>", "no_response" or the pg_net error text otherwise. The
-- ml_ok/db_ok = false written for unanswered probes was never measured.
update public.uptime_checks
   set web_ok = true
 where web_ok is null
   and http_status between 200 and 599
   and status in ('ok', 'degraded');

update public.uptime_checks
   set web_ok = false, ml_ok = null, db_ok = null
 where web_ok is null
   and http_status is not null;

create or replace function private.uptime_collect()
returns void
language plpgsql
security definer
set search_path = 'public', 'net', 'vault'
as $$
declare
  r record;
  resp record;
  body jsonb;
  answered boolean;
  cur record;
  prev record;
  base record;
  pending text[];
  resolved bigint[] := '{}';
  newest bigint;
  secrets_loaded boolean := false;
  sent text[];
  k text;
  edge_url text;
  service_key text;
begin
  -- 1) Resolve pending probes.
  for r in
    select id, request_id, checked_at
    from public.uptime_checks
    where http_status is null and request_id is not null
      and checked_at > now() - interval '1 hour'
  loop
    select status_code, content, timed_out, error_msg
      into resp
      from net._http_response
     where id = r.request_id;

    if not found then
      if r.checked_at < now() - interval '3 minutes' then
        update public.uptime_checks
           set http_status = 0, web_ok = false, ml_ok = null, db_ok = null,
               status = 'no_response'
         where id = r.id;
        resolved := resolved || r.id;
      end if;
      continue;
    end if;

    if coalesce(resp.timed_out, false) or resp.status_code is null then
      update public.uptime_checks
         set http_status = 0, web_ok = false, ml_ok = null, db_ok = null,
             status = left(coalesce(resp.error_msg, 'timeout'), 200)
       where id = r.id;
      resolved := resolved || r.id;
      continue;
    end if;

    begin
      body := resp.content::jsonb;
    exception when others then
      body := null;
    end;

    -- The web app answered only if this is /api/uptime's own body. A Vercel
    -- error page, an HTML 5xx or some other JSON is not an answer.
    answered := coalesce(
      jsonb_typeof(body->'checks'->'ml'->'ok') = 'boolean'
        and jsonb_typeof(body->'checks'->'db'->'ok') = 'boolean',
      false);

    update public.uptime_checks
       set http_status = resp.status_code,
           web_ok = answered,
           ml_ok = case when answered then (body->'checks'->'ml'->>'ok')::boolean end,
           db_ok = case when answered then (body->'checks'->'db'->>'ok')::boolean end,
           status = left(coalesce(case when answered then body->>'status' end,
                                  'http_' || resp.status_code::text), 40)
     where id = r.id;
    resolved := resolved || r.id;
  end loop;

  -- 2) Transitions, one probe at a time in checked_at order: every probe
  -- step 1 resolved plus the newest completed one. The row locks serialise
  -- overlapping runs on `notified`.
  select id into newest
    from public.uptime_checks
   where http_status is not null
   order by checked_at desc, id desc
   limit 1;

  for cur in
    select id, checked_at, web_ok, ml_ok, db_ok, notified
      from public.uptime_checks
     where http_status is not null
       and (id = newest or id = any(resolved))
     order by checked_at, id
     for update
  loop
    pending := '{}';

    select web_ok into prev
      from public.uptime_checks
     where http_status is not null
       and (checked_at, id) < (cur.checked_at, cur.id)
     order by checked_at desc, id desc
     limit 1;

    -- Web first.
    if cur.web_ok is not null and prev.web_ok is not null
       and cur.web_ok is distinct from prev.web_ok then
      pending := pending || case when cur.web_ok then 'web_recovered' else 'web_down' end;
    end if;

    -- Database and ML only when the web app answered both compared probes.
    if cur.web_ok then
      select ml_ok, db_ok into base
        from public.uptime_checks
       where http_status is not null
         and web_ok
         and (checked_at, id) < (cur.checked_at, cur.id)
       order by checked_at desc, id desc
       limit 1;

      if cur.db_ok is not null and base.db_ok is not null
         and cur.db_ok is distinct from base.db_ok then
        pending := pending || case when cur.db_ok then 'db_recovered' else 'db_down' end;
      end if;
      if cur.ml_ok is not null and base.ml_ok is not null
         and cur.ml_ok is distinct from base.ml_ok then
        pending := pending || case when cur.ml_ok then 'ml_recovered' else 'ml_down' end;
      end if;
    end if;

    sent := coalesce(string_to_array(cur.notified, ','), '{}');
    pending := array(select p from unnest(pending) with ordinality as t(p, n)
                      where p <> all(sent) order by n);

    if cardinality(pending) > 0 then
      if not secrets_loaded then
        select decrypted_secret into edge_url from vault.decrypted_secrets where name = 'edge_url' limit 1;
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
        secrets_loaded := true;
      end if;

      foreach k in array pending loop
        if coalesce(edge_url, '') <> '' and coalesce(service_key, '') <> '' then
          perform net.http_post(
            url := edge_url || '/functions/v1/telegram-alerts',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || service_key
            ),
            body := jsonb_build_object('kind', k, 'checked_at', cur.checked_at),
            timeout_milliseconds := 5000
          );
        else
          raise log 'uptime monitor: vault secrets not configured (%)', k;
        end if;
        sent := sent || k;
      end loop;

      update public.uptime_checks
         set notified = array_to_string(sent, ',')
       where id = cur.id;
    end if;
  end loop;

  delete from public.uptime_checks where checked_at < now() - interval '30 days';
end;
$$;

revoke all on function private.uptime_collect() from public, anon, authenticated;
