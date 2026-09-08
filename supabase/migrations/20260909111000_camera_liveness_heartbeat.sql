-- ═══════════════════════════════════════════════════════════════════════════
-- camera_health(): status that means "this camera is sending frames".
--
-- The defect: status was derived purely from the newest FACE detection —
--   last_seen >= now() - 5 min  → 'healthy'
--   last_seen >= now() - 30 min → 'stale'
--   otherwise                   → 'offline'  (NULL → 'unknown')
-- so a perfectly healthy camera watching an empty corridor turned 'stale'
-- after five minutes and 'offline' after thirty, and the dots on /grid,
-- /wall and /cameras (plus the "N healthy / N offline" summary) reported an
-- outage that was not happening. The inverse lied too: a camera whose feed
-- died an hour ago still read 'healthy' for five minutes on the strength of
-- the last face it saw before dying.
--
-- Nothing in the database knew whether frames were arriving, because only the
-- capture loop can know. So the capture loop now says it: every
-- CAMERA_HEARTBEAT_SEC (default 30 s) of successful reads it stamps
-- camera_sessions.last_heartbeat_at (ml-service/recording_pipeline.py
-- `beat_if_due` → storage.heartbeat_camera_session). This migration adds that
-- column and rewrites camera_health() to derive `status` from it.
--
-- The two questions are now separate and both answerable:
--   status            — is the camera sending frames  (liveness)
--   detection_status  — has it seen anyone lately     (activity)
-- so "camera is up, nothing detected" (status='healthy', detection_status
-- 'none'/'idle', faces_1h=0) is finally distinguishable from "camera is not
-- sending frames" (status='stale'/'offline'). The existing status vocabulary
-- (healthy | stale | offline | unknown) is kept on purpose: every consumer
-- and every i18n label keeps working, they just stop lying.
--
--   status = 'unknown'  nothing is capturing this camera (never started,
--                       stopped, or disabled — auto_resume cleared), or it is
--                       capturing and has not reported yet (an ML build older
--                       than this change — see the rollout note below).
--                       "We do not know", which is the truth.
--            'healthy'  last heartbeat < 90 s ago (3 missed beats of slack)
--            'stale'    last heartbeat < 10 min ago — wedged or dropped, the
--                       supervisor is retrying with backoff
--            'offline'  we are supposed to be capturing and frames stopped
--                       arriving. The ONLY value that asserts a fault.
--
-- Rollout order matters: apply this migration FIRST, deploy the ML service
-- SECOND. In between, a running camera reports status='unknown' (honest: the
-- database has not been told) rather than a wrong 'healthy' or 'offline'.
--
-- Blast radius
--   • camera_sessions gains one nullable column; the column-level SELECT
--     grant is extended so `select *` as `authenticated` keeps working. Only
--     service_role writes the table (unchanged).
--   • camera_health() is DROPped and recreated because its RETURNS TABLE
--     signature grows three columns (capturing, last_heartbeat,
--     detection_status). The first eight columns keep their names, types and
--     order, so existing callers are unaffected. Generated TypeScript types
--     go stale until `npm run gen:types` is re-run — the two pages that read
--     the new columns cast the rows, so nothing fails to compile meanwhile.
--   • EXECUTE grants are re-applied after the recreate (DROP discards them).
--     The MFA + operator gates inside the function are unchanged.
--   • Until the ML service is redeployed, every camera reads 'unknown'
--     instead of a detection-derived healthy/stale/offline. Operators lose a
--     signal that was wrong; they gain no false alarm.
--
-- Rollback (paste-able — restores the detection-derived status verbatim)
--   drop function if exists public.camera_health();
--   create or replace function public.camera_health()
--    returns table(camera_id uuid, name text, enabled boolean, cam_type text,
--                  last_seen timestamptz, faces_24h bigint, faces_1h bigint,
--                  status text)
--    language plpgsql stable security definer set search_path to 'public','pg_temp'
--   as $rollback$
--   #variable_conflict use_column
--   begin
--     if not private.mfa_ok() then
--       raise exception 'forbidden: second factor required' using errcode = '42501';
--     end if;
--     if not private.is_operator() then
--       raise exception 'forbidden: operator only' using errcode = '42501';
--     end if;
--     return query
--     with visible as (
--       select c.id, c.name, c.enabled, c.cam_type from public.cameras c
--        where private.is_admin() or private.user_can_see_camera(c.id)),
--     face_stats as (
--       select f.camera_id, max(f.detected_at) as last_seen,
--              count(*) filter (where f.detected_at >= now() - interval '24 hours') as faces_24h,
--              count(*) filter (where f.detected_at >= now() - interval '1 hour') as faces_1h
--         from public.faces f
--        where f.camera_id is not null and f.camera_id in (select v.id from visible v)
--        group by f.camera_id)
--     select c.id, c.name, c.enabled, c.cam_type, fs.last_seen,
--            coalesce(fs.faces_24h, 0), coalesce(fs.faces_1h, 0),
--            (case when fs.last_seen is null then 'unknown'
--                  when fs.last_seen >= now() - interval '5 minutes' then 'healthy'
--                  when fs.last_seen >= now() - interval '30 minutes' then 'stale'
--                  else 'offline' end)::text
--       from visible c left join face_stats fs on fs.camera_id = c.id
--      order by c.name asc;
--   end
--   $rollback$;
--   revoke execute on function public.camera_health() from public, anon;
--   grant execute on function public.camera_health() to authenticated;
--   -- The column may stay; it is nullable and nothing else reads it:
--   -- alter table public.camera_sessions drop column last_heartbeat_at;
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The heartbeat column ───────────────────────────────────────────────
alter table public.camera_sessions
  add column if not exists last_heartbeat_at timestamptz;

comment on column public.camera_sessions.last_heartbeat_at is
  'Last time the ML capture loop read frames from this source (stamped every CAMERA_HEARTBEAT_SEC, default 30 s). Liveness only — it does not mean a face was detected, and it is not written by anything but the capture loop. NULL = the session predates the heartbeat or the running ML build does not report one.';

-- camera_sessions has column-level grants (sealed_url is deliberately not
-- readable); extend them so an admin `select *` does not start failing.
grant select (last_heartbeat_at) on public.camera_sessions to authenticated;

-- ── 2. camera_health(): liveness from the heartbeat, activity from faces ──
drop function if exists public.camera_health();

create function public.camera_health()
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
    select cs.camera_id, cs.auto_resume, cs.last_heartbeat_at
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
      -- Nothing is capturing this camera (never started, stopped, disabled),
      -- or it is capturing but has not reported yet: we do not know whether
      -- the camera is up. 'unknown' says that; 'offline' would claim a fault
      -- that has not been observed.
      when ss.camera_id is null or not ss.auto_resume then 'unknown'
      when ss.last_heartbeat_at is null then 'unknown'
      when ss.last_heartbeat_at >= now() - interval '90 seconds' then 'healthy'
      when ss.last_heartbeat_at >= now() - interval '10 minutes' then 'stale'
      -- We ARE supposed to be capturing this camera and frames stopped
      -- arriving. This is the only case that means "something is wrong".
      else 'offline'
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
  'Per-camera liveness + activity for operators (admin sees all, viewer sees what user_can_see_camera allows; requires a verified second factor). `status` answers "is this camera sending frames", from camera_sessions.last_heartbeat_at: healthy < 90 s, stale < 10 min, offline when a camera we are supposed to be capturing has stopped delivering, unknown when nothing is capturing it (or it has not reported yet). `capturing` and `last_heartbeat` expose the raw state; `detection_status` (none | active | recent | idle) and the faces_* counts answer "has it seen anyone" — the question `status` used to answer by mistake.';

-- ── 3. Prove the shape the callers were promised ──────────────────────────
do $$
declare
  result text;
begin
  select pg_get_function_result(p.oid)
    into result
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'camera_health';
  if result is null then
    raise exception 'camera_health() is missing after the recreate';
  end if;
  if result not like '%capturing boolean%'
     or result not like '%last_heartbeat timestamp with time zone%'
     or result not like '%detection_status text%' then
    raise exception 'camera_health() did not gain the liveness columns: %', result;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'camera_sessions'
       and column_name = 'last_heartbeat_at'
  ) then
    raise exception 'camera_sessions.last_heartbeat_at was not added';
  end if;
end
$$;
