-- Realtime: publish the two tables the app actually subscribes to.
--
-- Four client subscriptions listen for INSERTs on public.alerts (the global
-- toast + sound + browser notification, /alerts-live, the dashboard activity
-- feed and the live match flash) and one listens on public.audit_log. The
-- `supabase_realtime` publication existed but carried no tables, so every one
-- of those channels reported "Connected" and then never delivered an event.
--
-- RLS still applies per subscriber: Realtime evaluates the listener's own JWT
-- against the same policies as PostgREST, so a viewer receives nothing from
-- alerts (admin-only policy) and only an admin or auditor sees audit_log.
-- Publishing a table therefore widens no authorization boundary.
--
-- Idempotent: adding a table that is already published raises 42710.
do $$
begin
  begin
    alter publication supabase_realtime add table public.alerts;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.audit_log;
  exception when duplicate_object then
    null;
  end;
end;
$$;
