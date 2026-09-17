-- SCH Esports — review fixes (2026-09-17).
--
-- 1. Second factor at the data tier for the two config tables.
--    20260917100000 attached the `private.mfa_ok()` restrictive policy to
--    sch_registrations only. sch_event carries the bank details every
--    registrant is told to pay into, and sch_teams is the published roster;
--    both were writable with a password-only admin token straight through
--    PostgREST (the console's requireAdmin never runs for a direct REST
--    call). Same gate as retention_policies / alert_rules (20260908110000).
--    The singleton event row also has no reason to be deletable over REST.
--
-- 2. Replay safety for the public submit. One submission is one row per
--    game; two overlapping calls with the same submission_id must fail on
--    their own rows instead of racing the non-atomic "already submitted"
--    read in app/sch/actions.ts.
--
-- 3. Orphaned receipts. The browser uploads the transfer screenshot to the
--    private bucket BEFORE the registration rows exist, so an abandoned
--    form leaves a bank screenshot nobody references. This function lists
--    such objects for the organiser's sweep (service role only — the bucket
--    has no storage policy by design, see 20260917110000).

create policy "sch_event: second factor required" on public.sch_event
  as restrictive for all to authenticated
  using ((select private.mfa_ok())) with check ((select private.mfa_ok()));

create policy "sch_teams: second factor required" on public.sch_teams
  as restrictive for all to authenticated
  using ((select private.mfa_ok())) with check ((select private.mfa_ok()));

revoke delete on public.sch_event from authenticated;

create unique index if not exists sch_registrations_submission_game_idx
  on public.sch_registrations (submission_id, game);

create or replace function public.sch_orphan_receipts(
  p_older_than_hours integer default 24,
  p_limit integer default 200
)
returns table (name text, created_at timestamptz)
language sql
security definer
set search_path = pg_catalog, public, storage
as $$
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'sch-receipts'
    -- Never younger than two hours: a signed upload URL lives that long and
    -- a registrant told to "try again in an hour" must still find their image.
    and o.created_at < now() - make_interval(hours => greatest(coalesce(p_older_than_hours, 24), 2))
    and o.name like 'submissions/%'
    and not exists (
      select 1 from public.sch_registrations r where r.receipt_path = o.name
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke all on function public.sch_orphan_receipts(integer, integer) from public, anon, authenticated;
grant execute on function public.sch_orphan_receipts(integer, integer) to service_role;
