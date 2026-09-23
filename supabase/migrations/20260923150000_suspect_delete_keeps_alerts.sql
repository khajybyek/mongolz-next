-- Deleting a suspect must not destroy alert history (2026-09-23 debug pass).
-- safety: ok — the DROP CONSTRAINTs below are replaced in the same
-- transaction: the FK is re-added with ON DELETE SET NULL, and the CHECK is
-- superseded by a trigger; no data is rewritten and existing rows all pass.
--
-- DEPLOY ORDER: ship the app first — app/(app)/suspects/actions.ts now writes
-- public.suspects with the service role after requireAdmin() + TOTP step-up.
-- Applying this migration before that deploy breaks "add suspect" (the old
-- action inserts with the user token revoked below).
--
-- ── 1. alerts survive the removal of their suspect ─────────────────────────
-- alerts_suspect_id_fkey was ON DELETE CASCADE. Referential actions run as
-- the table owner, so the DELETE revoked on public.alerts by 20260917150000
-- never applied to it: one
--     DELETE /rest/v1/suspects?id=eq.<id>
-- (or a routine watchlist clean-up in /suspects) erased every alert for that
-- person, their TP/FP labels (the input of suggested_threshold()) and, through
-- incident_alerts_alert_id_fkey, the incident evidence links.
--
-- The alert keeps `suspect_name` (NOT NULL), so the history still reads
-- correctly; a match alert whose suspect_id is NULL now means "suspect removed
-- from the watchlist". The UI already treats a NULL suspect_id as "no link"
-- (alerts/page.tsx, incidents/[id]/page.tsx).
--
-- alerts_type_suspect_check (20260906130200) required suspect_id for every
-- match alert and would make each such SET NULL fail. It is replaced by a
-- rule that only refuses DETACHING a match alert from a suspect that still
-- exists, so the ON DELETE SET NULL action (which runs after the suspect row
-- is gone) passes while a hand-made PATCH suspect_id=null does not. New match
-- rows are still written with a suspect by the ML service
-- (storage.insert_alert(suspect_id: str)); a restore of an already-detached
-- alert must stay possible, so INSERT is not constrained.
alter table public.alerts drop constraint if exists alerts_type_suspect_check;

create or replace function private.alerts_keep_live_suspect_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.type = 'match'
     and new.suspect_id is null
     and old.suspect_id is not null
     and exists (select 1 from public.suspects s where s.id = old.suspect_id) then
    raise exception 'match alert cannot be detached from an existing suspect'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.alerts_keep_live_suspect_link() from public, anon, authenticated;

drop trigger if exists alerts_keep_live_suspect_link on public.alerts;
create trigger alerts_keep_live_suspect_link
  before update of suspect_id on public.alerts
  for each row execute function private.alerts_keep_live_suspect_link();

alter table public.alerts drop constraint if exists alerts_suspect_id_fkey;
alter table public.alerts
  add constraint alerts_suspect_id_fkey
  foreign key (suspect_id) references public.suspects(id) on delete set null;

-- alert_rules_suspect_id_fkey stays ON DELETE CASCADE on purpose: rules are
-- configuration, not evidence, and alerts.rule_id is already ON DELETE SET NULL.

-- ── 2. The watchlist is written only by the server ─────────────────────────
-- `authenticated` held INSERT/UPDATE/DELETE/TRUNCATE on public.suspects and the
-- policy "suspects: admin write" allowed all of it to a TOTP-minted admin
-- token, skipping the step-up, the audit row and the admin notification
-- (RUNBOOK §5a.6 residual). The app now writes with the service role
-- (suspects/actions.ts); every reader keeps SELECT.
revoke insert, update, delete, truncate, references, trigger
  on public.suspects from anon, authenticated;
-- anon has no policy on suspects anyway; drop the dead grant.
revoke select on public.suspects from anon;

comment on table public.suspects is
  'Watchlist (name + ArcFace embedding). Written ONLY by the service role from '
  'suspects/actions.ts (admin + step-up + audit). Deleting a row keeps its alerts '
  '(alerts.suspect_id ON DELETE SET NULL, suspect_name retained).';
