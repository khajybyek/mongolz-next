-- ============================================================================
-- The super admin may reveal without a second admin's approval
-- (owner decision 2026-09-30; ADR 0003 amendment)
-- ============================================================================
--
-- WHY
-- ---
-- The project owner decided that the super admin — profiles.is_super_admin,
-- exactly one account (unique partial index profiles_one_super_admin_idx),
-- DB-locked by protect_super_admin() — has FULL reveal rights: a reveal the
-- super admin requests runs immediately, without another admin's approval.
-- Every other admin keeps the 4-eyes rule of ADR 0003 unchanged.
--
-- Before this migration 4-eyes was enforced in three layers:
--   1. the web (app/api/reveal/start/route.ts) always inserted
--      status = 'pending_approval';
--   2. CHECK reveal_jobs_four_eyes_chk (approved_by <> requested_by),
--      20260906130200;
--   3. public.claim_reveal_job() (latest: 20260911130000) claimed only rows
--      with approval_required AND approved_by <> requested_by AND approved_at.
-- This migration changes layers 2 and 3 (the web changes layer 1) and adds a
-- guard so the exemption cannot be manufactured by anyone else:
--
--   * reveal_jobs.approval_required = false marks a self-approved super-admin
--     reveal. The column already existed (default true, 20260516065221) and
--     freeze_reveal_request_scope() already makes it immutable after insert.
--   * CHECK reveal_jobs_four_eyes_chk still refuses approved_by =
--     requested_by — except on a row with approval_required = false.
--   * BEFORE INSERT OR UPDATE trigger guard_reveal_self_approval refuses
--     approval_required = false unless the requester is the super admin, the
--     kill switch is on, and the job is approved by nobody or by the
--     requester. It runs for EVERY role, service_role included (the service
--     role is the only writer of reveal_jobs since 20260907100000), so a
--     stolen admin token, a forged service-role request or a hand-made row can
--     never create an unapproved job for anyone but the super admin. The
--     super-admin/kill-switch check runs on INSERT and whenever a row ENTERS
--     queued/processing; other updates (worker progress, completion, failure,
--     retention clearing output_path, an operator cancelling a job) only have
--     to keep "approved by nobody or by the requester", so historical rows
--     stay updatable after the switch is turned off or the super admin changes.
--   * claim_reveal_job() accepts EITHER the unchanged 4-eyes condition OR
--     (approval_required = false AND approved_by = requested_by AND
--     approved_at IS NOT NULL AND the requester is STILL the super admin AND
--     the kill switch is on), keeping every other condition (scope, reason
--     length, attempts, lease, status, requester role and reveal level).
--     Re-checking at claim time covers a demotion (or the switch being turned
--     off) between the request and the run.
--   * The self-approved branch of claim_reveal_job() also requires the
--     hash-chained ledger row: a REVEAL_SUPER_ADMIN_SELF_APPROVED audit_log
--     row by the requester whose detail starts with 'job <job id> '. The web
--     writes it (with REVEAL_REQUEST, one statement) BEFORE it inserts the job
--     row, because the durable ML worker claims any queued row within seconds
--     without waiting for the web; with the check in the claim, a
--     self-approved job cannot run unrecorded whoever inserted it. A row
--     without its ledger row stays queued (like one queued while the switch
--     is off); fail it by id as shown under KILL SWITCH. The detail format
--     is lib/reveal-self-approval.ts#selfApprovalAuditDetail.
--
-- Controls that still apply to a super-admin reveal: fresh step-up (the web
-- demands the TOTP factor for the self-approved path), a 10–1000 character
-- reason, the frozen request scope, the reveal level, the privacy schedule /
-- spans / zones of ADR 0012, the hash-chained audit rows REVEAL_REQUEST +
-- REVEAL_SUPER_ADMIN_SELF_APPROVED (written before the job row exists and
-- required by the claim), and a real-time security event to every other
-- admin (web push + Telegram).
-- Accepted risk (ADR 0003 amendment, THREAT_MODEL): whoever controls the
-- super admin's session AND second factor can reveal alone.
--
-- DEPLOY ORDER — THIS MIGRATION FIRST, THEN THE WEB
-- -------------------------------------------------
--   1. `npx supabase db push --linked`, then `npm run gen:types`.
--      The web that is live meanwhile still inserts every job as
--      pending_approval with approval_required = true: nothing it does is
--      affected (the CHECK only widens, the claim keeps the 4-eyes branch).
--   2. Deploy the web. It asks public.super_admin_self_reveal_allowed() before
--      choosing the self-approved path; if that RPC is missing (web deployed
--      first by mistake) it falls back to the normal pending_approval flow.
--   No ML deploy: the worker only calls claim_reveal_job().
--
-- KILL SWITCH (no deploy, one statement, effective immediately)
-- -------------------------------------------------------------
--   update private.security_settings
--      set super_admin_self_reveal = false, updated_at = now(),
--          updated_by = '<who> — <reason>';
-- With the switch off the web sends the super admin's requests through the
-- normal pending_approval flow (a second admin approves), the trigger refuses
-- any new approval_required = false row, and the claim refuses self-approved
-- jobs that are still queued — they stay queued and would run if the switch
-- is turned back on. To drop them for good:
--   update public.reveal_jobs
--      set status = 'failed', completed_at = now(),
--          error_message = 'Cancelled: super-admin self-approval disabled'
--    where approval_required = false and status = 'queued';
-- A job already processing finishes (its lease is not revoked); fail it the
-- same way (status = 'processing') to stop it — a late worker write is then
-- refused by the lease fence.
-- Re-arm with `= true`. Re-running this migration never re-arms a disabled
-- switch (ADD COLUMN IF NOT EXISTS).
--
-- RESTORE
-- -------
-- scripts/restore-from-backup.ts restores profiles (with is_super_admin)
-- before reveal_jobs, so a self-approved row restores while its requester is
-- still the super admin and the switch is on; otherwise the guard refuses the
-- row (the freeze trigger already re-validates every restored job).
--
-- ROLLBACK (paste as-is, as postgres)
-- -----------------------------------
--   Kill switch first (instant). Then, if the objects must go:
--     drop trigger if exists guard_reveal_self_approval on public.reveal_jobs;
--     drop function if exists public.guard_reveal_self_approval();
--     -- re-create public.claim_reveal_job() from 20260911130000 (verbatim)
--     alter table public.reveal_jobs drop constraint reveal_jobs_four_eyes_chk;
--     alter table public.reveal_jobs add constraint reveal_jobs_four_eyes_chk
--       check (approved_by is null or requested_by is null or approved_by <> requested_by);
--     -- the ADD fails while self-approved rows exist; fail/delete them first
--     drop function if exists public.super_admin_self_reveal_allowed(uuid);
--     drop function if exists private.super_admin_self_reveal_allowed(uuid);
--     alter table private.security_settings drop column if exists super_admin_self_reveal;
--   Roll the web back first: without the public RPC the web falls back to
--   pending_approval for everyone.
-- safety: ok — reveal_jobs_four_eyes_chk is dropped and re-added in the same
-- transaction with a strictly wider predicate; every existing row satisfies
-- it, so there is no window without the constraint and no row is rejected.
-- ============================================================================

-- ─── 1. Kill switch ─────────────────────────────────────────────────────────
alter table private.security_settings
  add column if not exists super_admin_self_reveal boolean not null default true;

comment on column private.security_settings.super_admin_self_reveal is
  'When true (default), a reveal requested by the super admin runs without a second '
  'admin''s approval (20260930120000, ADR 0003 amendment). false = kill switch: the web '
  'falls back to pending_approval, the guard trigger refuses new self-approved rows and '
  'claim_reveal_job() refuses queued ones.';

-- ─── 2. Who may self-approve (single source of truth) ──────────────────────
-- A missing settings row reads as "off" (fail closed).
create or replace function private.super_admin_self_reveal_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_user_id is not null
     and coalesce((select s.super_admin_self_reveal from private.security_settings s where s.id), false)
     and private.is_super_admin(p_user_id)
     and exists (
       select 1 from public.profiles p
        where p.id = p_user_id
          and p.role = 'admin'
          and p.reveal_level between 0 and 99
     )
$$;
revoke all on function private.super_admin_self_reveal_allowed(uuid) from public, anon, authenticated;
grant execute on function private.super_admin_self_reveal_allowed(uuid) to service_role;

comment on function private.super_admin_self_reveal_allowed(uuid) is
  'true when p_user_id is the super admin (admin role, valid reveal level) and '
  'private.security_settings.super_admin_self_reveal is on. Used by the reveal_jobs '
  'guard trigger and claim_reveal_job().';

-- The web reads the same verdict before choosing the self-approved path
-- (private is not exposed over PostgREST). service_role only.
create or replace function public.super_admin_self_reveal_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.super_admin_self_reveal_allowed(p_user_id)
$$;
revoke all on function public.super_admin_self_reveal_allowed(uuid) from public, anon, authenticated;
grant execute on function public.super_admin_self_reveal_allowed(uuid) to service_role;

comment on function public.super_admin_self_reveal_allowed(uuid) is
  'service_role only: may this user''s reveal request skip the second admin? '
  'See private.super_admin_self_reveal_allowed.';

-- ─── 3. CHECK: self-approval only on a self-approved row ───────────────────
alter table public.reveal_jobs drop constraint if exists reveal_jobs_four_eyes_chk;
alter table public.reveal_jobs add constraint reveal_jobs_four_eyes_chk
  check (
    approved_by is null
    or requested_by is null
    or approved_by <> requested_by
    or approval_required = false
  );

comment on column public.reveal_jobs.approval_required is
  '4-eyes principle (ADR 0003): when true, a different admin (not requested_by) must '
  'approve before the job can run. false only for a reveal the super admin requested '
  'while private.security_settings.super_admin_self_reveal was on (20260930120000): '
  'approved_by = requested_by, enforced by guard_reveal_self_approval and re-checked by '
  'claim_reveal_job(). Immutable after insert (freeze_reveal_request_scope).';

-- ─── 4. Guard: nobody else can manufacture an unapproved job ───────────────
create or replace function public.guard_reveal_self_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.approval_required is distinct from false then
    return new;
  end if;

  -- Invariant for every write: a self-approved job is approved by nobody or
  -- by its requester — never by a second admin.
  if new.approved_by is not null and new.approved_by is distinct from new.requested_by then
    raise exception using
      errcode = '23514',
      message = 'A reveal without second-admin approval can only be approved by its requester';
  end if;

  -- Creating one, or moving one into a runnable state, needs the super
  -- admin and the kill switch on — for every role, service_role included.
  if tg_op = 'INSERT'
     or (new.status in ('queued', 'processing') and new.status is distinct from old.status) then
    if not private.super_admin_self_reveal_allowed(new.requested_by) then
      raise exception using
        errcode = '42501',
        message = 'Only the super admin may request a reveal without second-admin approval, and only while super_admin_self_reveal is on';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.guard_reveal_self_approval() from public, anon, authenticated;

drop trigger if exists guard_reveal_self_approval on public.reveal_jobs;
create trigger guard_reveal_self_approval
  before insert or update on public.reveal_jobs
  for each row execute function public.guard_reveal_self_approval();

-- ─── 5. Claim: 4-eyes OR a still-valid, recorded super-admin self-approval ─
-- Same as 20260911130000 except the approval condition. Already processing
-- work keeps its lease; old/forged queued rows still cannot start.
create or replace function public.claim_reveal_job(p_job_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare token uuid := gen_random_uuid(); claimed uuid;
begin
  update public.reveal_jobs as job set status='processing', worker_lease_token=token,
    worker_lease_until=now()+interval '90 seconds', worker_attempts=worker_attempts+1,
    started_at=now(), completed_at=null, error_message=null, progress=5
  where job.id=p_job_id
    and (
      -- 4-eyes (ADR 0003): a different admin approved, both within scope.
      (
        job.approval_required and job.approved_by is not null
        and job.approved_by <> job.requested_by and job.approved_at is not null
        and exists (
          select 1 from public.profiles requester
          join public.profiles approver on approver.id = job.approved_by
          where requester.id = job.requested_by
            and requester.role = 'admin' and approver.role = 'admin'
            and requester.reveal_level between 0 and 99
            and approver.reveal_level between 0 and 99
            and requester.reveal_level <= job.reveal_level
            and approver.reveal_level <= job.reveal_level
        )
      )
      or
      -- Super-admin self-approval (20260930120000): the requester must STILL
      -- be the super admin and the kill switch must STILL be on.
      (
        job.approval_required = false
        and job.approved_by = job.requested_by and job.approved_at is not null
        and private.super_admin_self_reveal_allowed(job.requested_by)
        and exists (
          select 1 from public.profiles requester
          where requester.id = job.requested_by
            and requester.role = 'admin'
            and requester.reveal_level between 0 and 99
            and requester.reveal_level <= job.reveal_level
        )
        -- ...and its hash-chained ledger row must already exist (the web
        -- writes it before the job row): never an unrecorded single-person
        -- reveal. Served by audit_log_user_action_time_idx.
        and exists (
          select 1 from public.audit_log ledger
          where ledger.user_id = job.requested_by
            and ledger.action = 'REVEAL_SUPER_ADMIN_SELF_APPROVED'
            and starts_with(ledger.detail, 'job ' || job.id::text || ' ')
        )
      )
    )
    and job.request_scope is not null and job.reason is not null
    and length(btrim(job.reason)) between 10 and 1000
    and job.worker_attempts < 5
    and (job.status='queued' or (job.status='processing' and (job.worker_lease_until is null or job.worker_lease_until < now())))
  returning job.id into claimed;
  return case when claimed is not null then token else null end;
end;
$$;
revoke all on function public.claim_reveal_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_reveal_job(uuid) to service_role;
