-- In-database uptime monitor: pg_cron fires /api/uptime every 5 minutes through
-- pg_net, the collector parses the JSON two minutes later and, on an ML
-- ok→down / down→ok transition, posts to the telegram-alerts edge function
-- (same vault secrets the alert trigger uses). Vercel Hobby crons are daily,
-- so this is the only 5-minute scheduler the project has.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

create table if not exists public.uptime_checks (
  id          bigint generated always as identity primary key,
  checked_at  timestamptz not null default now(),
  request_id  bigint,
  http_status integer,
  ml_ok       boolean,
  db_ok       boolean,
  status      text,
  notified    text
);

comment on table public.uptime_checks is
  'Results of the 5-minute /api/uptime probe (pg_cron + pg_net). Admin read-only; written by the collector.';

alter table public.uptime_checks enable row level security;
revoke all on public.uptime_checks from anon, authenticated;
grant select on public.uptime_checks to authenticated;

drop policy if exists "uptime_checks: admin read" on public.uptime_checks;
create policy "uptime_checks: admin read"
  on public.uptime_checks for select
  to authenticated
  using (private.is_admin());

create index if not exists uptime_checks_checked_at_idx on public.uptime_checks (checked_at desc);

-- 1) Probe: async GET, remember the pg_net request id.
create or replace function private.uptime_probe()
returns void
language plpgsql
security definer
set search_path = 'public', 'net'
as $$
declare
  rid bigint;
begin
  select net.http_get(
    url := 'https://aicctv.dev/api/uptime',
    headers := '{"User-Agent": "mongolz-uptime-monitor/1"}'::jsonb,
    timeout_milliseconds := 15000
  ) into rid;
  insert into public.uptime_checks (request_id) values (rid);
end;
$$;

-- 2) Collect: resolve pending probes, detect ML transitions, notify once.
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
  cur record;
  prev record;
  kind text;
  edge_url text;
  service_key text;
begin
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
           set http_status = 0, ml_ok = false, db_ok = false, status = 'no_response'
         where id = r.id;
      end if;
      continue;
    end if;

    if coalesce(resp.timed_out, false) or resp.status_code is null then
      update public.uptime_checks
         set http_status = 0, ml_ok = false, db_ok = false,
             status = left(coalesce(resp.error_msg, 'timeout'), 200)
       where id = r.id;
      continue;
    end if;

    begin
      body := resp.content::jsonb;
    exception when others then
      body := null;
    end;

    update public.uptime_checks
       set http_status = resp.status_code,
           ml_ok = coalesce((body->'checks'->'ml'->>'ok')::boolean, false),
           db_ok = coalesce((body->'checks'->'db'->>'ok')::boolean, false),
           status = left(coalesce(body->>'status', 'http_' || resp.status_code::text), 40)
     where id = r.id;
  end loop;

  -- Transition on the ML check between the two most recent completed probes.
  select id, ml_ok, checked_at, notified into cur
    from public.uptime_checks where http_status is not null
   order by checked_at desc limit 1;
  select ml_ok into prev
    from public.uptime_checks where http_status is not null
   order by checked_at desc offset 1 limit 1;

  if cur.id is not null and prev.ml_ok is not null and cur.notified is null
     and cur.ml_ok is distinct from prev.ml_ok then
    kind := case when cur.ml_ok then 'ml_recovered' else 'ml_down' end;

    select decrypted_secret into edge_url from vault.decrypted_secrets where name = 'edge_url' limit 1;
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;

    if coalesce(edge_url, '') <> '' and coalesce(service_key, '') <> '' then
      perform net.http_post(
        url := edge_url || '/functions/v1/telegram-alerts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object('kind', kind, 'checked_at', cur.checked_at),
        timeout_milliseconds := 5000
      );
    else
      raise log 'uptime monitor: vault secrets not configured (%s)', kind;
    end if;

    update public.uptime_checks set notified = kind where id = cur.id;
  end if;

  delete from public.uptime_checks where checked_at < now() - interval '30 days';
end;
$$;

revoke all on function private.uptime_probe() from public, anon, authenticated;
revoke all on function private.uptime_collect() from public, anon, authenticated;

-- 3) Schedules (idempotent: unschedule first so re-running the migration is safe).
do $$
begin
  perform cron.unschedule('mongolz-uptime-probe');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('mongolz-uptime-collect');
exception when others then null;
end $$;

select cron.schedule('mongolz-uptime-probe',   '*/5 * * * *',   $$select private.uptime_probe()$$);
select cron.schedule('mongolz-uptime-collect', '2-59/5 * * * *', $$select private.uptime_collect()$$);
