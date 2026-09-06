-- audit_actions: distinct action names for the /audit filter dropdown.
-- security_invoker so the audit_log RLS (admin/auditor read) still applies;
-- the page previously selected `action` for the whole table and was capped
-- by PostgREST max-rows, so the list was incomplete.
create or replace view public.audit_actions
with (security_invoker = true) as
  select distinct action from public.audit_log;
revoke all on public.audit_actions from public, anon;
grant select on public.audit_actions to authenticated, service_role;

-- notify_telegram_on_alert: never page the on-call for demo data.
-- `npm run demo:seed` inserts ~120 `demo:`-prefixed alerts and each one fired
-- a real Telegram message. Anomaly alerts also carry no suspect — skip those
-- too (they have their own push path).
drop trigger if exists trigger_telegram_on_alert on public.alerts;
create trigger trigger_telegram_on_alert
  after insert on public.alerts
  for each row
  when (new.type = 'match' and new.suspect_name not like 'demo:%')
  execute function public.notify_telegram_on_alert();
