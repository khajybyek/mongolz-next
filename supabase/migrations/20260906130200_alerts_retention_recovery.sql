-- ═══════════════════════════════════════════════════════════════════════
-- Functional fixes: anomaly alerts, retention sweep, 4-eyes in DB,
-- atomic recovery-code consumption, missing FK indexes.
-- safety: ok — the DROP CONSTRAINTs below are idempotent re-creates of
-- CHECKs added in this same migration; DROP NOT NULL widens a column.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. insert_anomaly_alert() could never succeed ─────────────────────────
-- alerts.suspect_id was NOT NULL, but anomaly alerts have no suspect; the
-- cron swallowed the error, so no anomaly alert was ever written.
alter table public.alerts alter column suspect_id drop not null;
alter table public.alerts drop constraint if exists alerts_type_suspect_check;
alter table public.alerts add constraint alerts_type_suspect_check
  check ((type = 'match' and suspect_id is not null) or type = 'anomaly');

-- ── 2. 4-eyes reveal, enforced in the DB as well ──────────────────────────
alter table public.reveal_jobs alter column status set default 'pending_approval';
alter table public.reveal_jobs drop constraint if exists reveal_jobs_four_eyes_chk;
alter table public.reveal_jobs add constraint reveal_jobs_four_eyes_chk
  check (approved_by is null or requested_by is null or approved_by <> requested_by);

-- ── 3. FK columns without an index ────────────────────────────────────────
create index if not exists faces_reviewed_by_idx on public.faces (reviewed_by) where reviewed_by is not null;
create index if not exists privacy_zones_created_by_idx on public.privacy_zones (created_by);

-- ── 4. Atomic single-use recovery codes (login step 2) ────────────────────
-- Read-then-write consumption in the app was racy (the same code could be
-- redeemed twice concurrently). One UPDATE, service_role only.
create or replace function public.consume_recovery_code(p_user_id uuid, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  n integer;
begin
  update public.profiles
     set totp_recovery_codes = array_remove(totp_recovery_codes, p_code_hash),
         updated_at = now()
   where id = p_user_id
     and p_code_hash = any(totp_recovery_codes);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.consume_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_recovery_code(uuid, text) to service_role;
comment on function public.consume_recovery_code(uuid, text) is
  'Atomically removes one SHA-256 recovery-code hash from profiles.totp_recovery_codes; true iff it was present.';

-- ── 5. sweep_retention(): legal hold on audit_log, per-resource isolation,
--      and report the storage objects that must be removed ─────────────────
-- Previously: enabling the audit_log policy made the (immutable) DELETE
-- raise and roll back the whole sweep; `reveal_outputs` was a no-op; and no
-- storage object was ever deleted, so encrypted originals, face crops and
-- un-blurred reveal outputs outlived their DB rows. Row deletion stays in
-- SQL; object deletion is done by the caller (service storage client) from
-- the `objects` map returned here.
create or replace function public.sweep_retention()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  pol record;
  result jsonb := '{}'::jsonb;
  objects jsonb := '{}'::jsonb;
  rows_removed integer;
  paths jsonb;
  cutoff timestamptz;
begin
  for pol in select * from public.retention_policies where enabled loop
    rows_removed := 0;
    paths := '[]'::jsonb;
    cutoff := now() - make_interval(days => pol.retention_days);
    begin
      if pol.resource = 'recordings' then
        with d as (
          delete from public.recordings where started_at < cutoff
          returning storage_path, original_path
        )
        select count(*),
               coalesce(jsonb_agg(storage_path) filter (where storage_path is not null), '[]'::jsonb)
               || coalesce(jsonb_agg(original_path) filter (where original_path is not null and original_path <> storage_path), '[]'::jsonb)
          into rows_removed, paths
          from d;
        objects := objects || jsonb_build_object('recordings', paths);

      elsif pol.resource = 'faces' then
        with d as (
          delete from public.faces where detected_at < cutoff
          returning image_path, crop_sealed
        )
        select count(*),
               coalesce(jsonb_agg(case when crop_sealed then image_path || '.enc' else image_path end)
                        filter (where image_path is not null), '[]'::jsonb)
          into rows_removed, paths
          from d;
        objects := objects || jsonb_build_object('faces', paths);

      elsif pol.resource = 'alerts' then
        delete from public.alerts where created_at < cutoff;
        get diagnostics rows_removed = row_count;

      elsif pol.resource = 'audit_log' then
        -- Legal hold: the audit ledger is immutable by design. Report, never delete.
        result := result || jsonb_build_object('audit_log_skipped', 'immutable ledger — legal hold');

      elsif pol.resource = 'reveal_jobs' then
        with d as (
          delete from public.reveal_jobs where created_at < cutoff
          returning output_path
        )
        select count(*),
               coalesce(jsonb_agg(output_path) filter (where output_path is not null), '[]'::jsonb)
          into rows_removed, paths
          from d;
        objects := objects || jsonb_build_object('revealed', paths);

      elsif pol.resource = 'reveal_outputs' then
        -- Keep the job row (accountability) but drop the un-blurred output.
        with d as (
          update public.reveal_jobs
             set output_path = null
           where output_path is not null
             and coalesce(completed_at, created_at) < cutoff
          returning (select o from (values (output_path)) as t(o)) as old_path
        )
        select count(*), coalesce(jsonb_agg(old_path) filter (where old_path is not null), '[]'::jsonb)
          into rows_removed, paths
          from d;
        objects := objects || jsonb_build_object('revealed',
          coalesce(objects->'revealed', '[]'::jsonb) || paths);
      end if;

      if pol.resource <> 'audit_log' then
        update public.retention_policies
           set last_swept_at = now(), last_swept_rows = rows_removed
         where resource = pol.resource;
        result := result || jsonb_build_object(pol.resource, rows_removed);
      end if;
    exception when others then
      -- One broken resource must not abort the others.
      result := result || jsonb_build_object(pol.resource, jsonb_build_object('error', sqlerrm));
    end;
  end loop;

  insert into public.audit_log(action, detail)
  values ('RETENTION_SWEEP', (result || jsonb_build_object('objects', objects))::text);

  return result || jsonb_build_object('objects', objects);
end;
$$;
revoke execute on function public.sweep_retention() from public, anon, authenticated;
grant execute on function public.sweep_retention() to service_role;
