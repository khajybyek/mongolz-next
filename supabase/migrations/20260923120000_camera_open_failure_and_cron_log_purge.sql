-- ═══════════════════════════════════════════════════════════════════════════
-- Two small operational fixes (2026-09-23 debug pass).
--
-- 1. camera_health(): a camera that is meant to be capturing and whose source
--    never opened reads 'offline', not 'unknown'.
--
--    Observed in production: the only real camera had auto_resume = true,
--    last_heartbeat_at NULL and last_error 'source unreachable at open', with
--    the supervisor restarting it on backoff — yet camera_health() returned
--    status 'unknown', because the `last_heartbeat_at is null` branch never
--    looked at last_error. /cameras counted it under "unknown" and the grid
--    dot stayed grey: a real outage was presented as "no information".
--
--    New rule, inserted AFTER the heartbeat branches (so a loop that recovered
--    and is beating reads healthy/stale even though touch_camera_session keeps
--    the previous last_error on purpose):
--      auto_resume and no heartbeat ever and last_error set → 'offline'
--    A camera that was just started still reads 'unknown': /camera/start's
--    upsert_camera_session clears last_error. A disabled / stopped camera
--    still reads 'unknown' (auto_resume false is the first branch).
--
--    The RETURNS TABLE signature is unchanged, so `create or replace` keeps
--    the existing grants and no caller or generated type changes. The grants
--    are re-stated anyway so this file is correct on its own.
--
-- 2. cron.job_run_details is never purged. Three jobs (*/5, */5, */15) log
--    ~800 rows/day (11,137 rows on 2026-09-23, oldest 2026-09-06). A daily
--    job now removes finished runs older than 14 days. In-flight runs have
--    end_time NULL and are never matched. Vercel's cron limit does not apply;
--    this is pg_cron inside Postgres.
--
-- Rollback
--   • camera_health(): re-run section 2 of
--     20260909111000_camera_liveness_heartbeat.sql (the `create function`
--     body, as `create or replace`).
--   • select cron.unschedule('mongolz-cron-log-purge');
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. camera_health(): open failures are an outage, not "unknown" ────────
create or replace function public.camera_health()
 returns table(
   camera_id uuid,
   name text,
   enabled boolean,
   cam_type text,
   last_seen timestamp with time zone,
   faces_24h bigint,
   faces_1h bigint,
   status text,
   capturing boolean,
   last_heartbeat timestamp with time zone,
   detection_status text
 )
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  -- Second factor at the data tier (audit 4.1). SECURITY DEFINER runs as the
  -- owner, so RLS — including the restrictive mfa_ok policies — does not apply
  -- inside this function. Ask the same question here.
  if not private.mfa_ok() then
    raise exception 'forbidden: second factor required' using errcode = '42501';
  end if;
  if not private.is_operator() then
    raise exception 'forbidden: operator only' using errcode = '42501';
  end if;
  return query
  with visible as (
    select c.id, c.name, c.enabled, c.cam_type
    from public.cameras c
    where private.is_admin() or private.user_can_see_camera(c.id)
  ),
  face_stats as (
    select
      f.camera_id,
      max(f.detected_at) as last_seen,
      count(*) filter (where f.detected_at >= now() - interval '24 hours') as faces_24h,
      count(*) filter (where f.detected_at >= now() - interval '1 hour') as faces_1h
    from public.faces f
    where f.camera_id is not null
      and f.camera_id in (select v.id from visible v)
    group by f.camera_id
  ),
  session_state as (
    -- auto_resume = "this camera is meant to be capturing". /camera/stop and
    -- the disable trigger both clear it, so a stopped or disabled camera is
    -- not treated as a dead one — it is simply not capturing.
    select cs.camera_id, cs.auto_resume, cs.last_heartbeat_at, cs.last_error
    from public.camera_sessions cs
    where cs.camera_id in (select v.id from visible v)
  )
  select
    c.id as camera_id,
    c.name,
    c.enabled,
    c.cam_type,
    fs.last_seen,
    coalesce(fs.faces_24h, 0) as faces_24h,
    coalesce(fs.faces_1h, 0) as faces_1h,
    case
      -- Nothing is capturing this camera (never started, stopped, disabled).
      when ss.camera_id is null or not ss.auto_resume then 'unknown'
      -- Heartbeat branches first: a loop that recovered is judged by its
      -- beats, not by the error the previous loop left behind.
      when ss.last_heartbeat_at >= now() - interval '90 seconds' then 'healthy'
      when ss.last_heartbeat_at >= now() - interval '10 minutes' then 'stale'
      when ss.last_heartbeat_at is not null then 'offline'
      -- Meant to be capturing, never delivered a frame, and the capture loop
      -- recorded why (e.g. 'source unreachable at open'): that is an outage.
      when ss.last_error is not null then 'offline'
      -- Just started (start clears last_error) and not reported yet.
      else 'unknown'
    end::text as status,
    (ss.camera_id is not null and coalesce(ss.auto_resume, false)) as capturing,
    ss.last_heartbeat_at as last_heartbeat,
    case
      when fs.last_seen is null then 'none'
      when fs.last_seen >= now() - interval '5 minutes' then 'active'
      when fs.last_seen >= now() - interval '30 minutes' then 'recent'
      else 'idle'
    end::text as detection_status
  from visible c
  left join face_stats fs on fs.camera_id = c.id
  left join session_state ss on ss.camera_id = c.id
  order by c.name asc;
end;
$function$;

revoke execute on function public.camera_health() from public, anon;
grant execute on function public.camera_health() to authenticated;

comment on function public.camera_health is
  'Per-camera liveness + activity for operators (admin sees all, viewer sees what user_can_see_camera allows; requires a verified second factor). `status` answers "is this camera sending frames", from camera_sessions: healthy when the last heartbeat is < 90 s old, stale < 10 min, offline when a camera we are supposed to be capturing stopped delivering OR never delivered and the capture loop recorded an error (camera_sessions.last_error, e.g. source unreachable at open), unknown when nothing is capturing it or it was just started and has not reported yet. `capturing` and `last_heartbeat` expose the raw state; `detection_status` (none | active | recent | idle) and the faces_* counts answer "has it seen anyone".';

-- ── 2. Purge pg_cron's run log daily ──────────────────────────────────────
do $$
begin
  perform cron.unschedule('mongolz-cron-log-purge');
exception when others then null;
end $$;

select cron.schedule(
  'mongolz-cron-log-purge',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$
);

-- ── 3. Prove the result ───────────────────────────────────────────────────
do $$
declare
  body text;
begin
  select pg_get_functiondef('public.camera_health()'::regprocedure) into body;
  if body not like '%ss.last_error is not null then ''offline''%' then
    raise exception 'camera_health() did not gain the open-failure branch';
  end if;
  if pg_get_function_result('public.camera_health()'::regprocedure)
       not like '%detection_status text%' then
    raise exception 'camera_health() signature changed unexpectedly';
  end if;
  if not exists (select 1 from cron.job where jobname = 'mongolz-cron-log-purge') then
    raise exception 'mongolz-cron-log-purge was not scheduled';
  end if;
end
$$;
