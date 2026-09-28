-- Enforced privacy schedules, tightening-only (2026-09-28).
--
-- WHAT WAS WRONG
-- --------------
-- /cameras/[id]/schedule stored per-camera time windows (masking_schedules,
-- cameras.mask_default, effective_mask_mode()) but nothing in the ML service
-- ever read them; the page said "policy preview — no effect". A control that
-- looks active and does nothing is worse than no control. Its `revealed` mode
-- also promised raw video, which no code path produced and which would have
-- side-stepped the 4-eyes reveal (ADR 0003).
--
-- DECISION (owner-approved): a schedule can only make protection STRONGER.
-- Video is face-masked in every mode (live HLS, on-demand view, baked MP4) and
-- un-masking stays exclusively the 4-eyes reveal job. Two modes:
--   standard  today's behaviour: masked video, face recognition on (embeddings,
--             sealed crops + faces rows, suspect matching, alerts), footage can
--             be revealed through the 4-eyes job.
--   private   masked video, NO biometric processing (no embeddings, no faces
--             rows / crops, no suspect matching, no alerts, no edge inference)
--             and footage captured in this mode is NEVER revealed: the reveal
--             job keeps those frames masked and does not run matching on them.
-- The mode applies at CAPTURE time. ml-service/privacy_schedule.py evaluates
-- the same rules as effective_privacy_mode() below (shared test vectors in
-- supabase/tests/privacy_schedule.test.sql and
-- ml-service/tests/test_privacy_schedule.py), records every private stretch of
-- a recording in recording_privacy_spans, and the reveal job protects the union
-- of those spans and the schedule itself.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. cameras.privacy_default replaces cameras.mask_default. Every existing row
--    becomes 'standard': neither old value ever changed behaviour ('masked' is
--    exactly today's behaviour = standard; 'revealed' was never implemented).
--    Production at the time of writing: 1 camera, mask_default = 'masked'.
-- 2. masking_schedules (name kept, historical): window_mode masked -> private,
--    revealed -> standard (0 rows in production), CHECK window_mode in
--    ('standard','private'), CHECK starts_at <> ends_at (use 00:00-24:00 for a
--    whole day) and starts_at <> '24:00'. The 20260923180000 time-format CHECKs
--    stay. Service-role writes only: the schedule server action requires a TOTP
--    step-up to LOOSEN a schedule and writes through createServiceClient();
--    `authenticated` could still DELETE a private window straight through
--    PostgREST — no step-up, no audit row. Same pattern as cameras /
--    retention_policies / camera_permissions (20260917150000) and privacy_zones
--    (20260923180000). The operator read policy and the restrictive
--    second-factor policy stay.
-- 3. effective_mask_mode() -> effective_privacy_mode().
-- 4. New table recording_privacy_spans: capture-time facts written by the ML
--    pipeline (service role), read by the reveal job, the on-demand view and
--    the playback page. client_span_id makes every write idempotent (a retry
--    after a lost response, and the spool / recovery delivery that carries a
--    segment's spans with it, upsert on it instead of leaving a second row).
-- 5. cameras.privacy_loosened_at: when the schedule was last LOOSENED in a
--    way that takes private time away (service role, from the schedule
--    actions, before and again after the loosening write). /edge/detect keeps
--    frames captured before it private — the current schedule no longer shows
--    the private time that covered them.
-- 6. recordings: `authenticated` loses UPDATE (and the dead "recordings: admin
--    update" policy goes). No web or user-token code path updates recordings;
--    the grant only let a stolen admin token move recordings.started_at /
--    camera_id through PostgREST — the anchors the reveal job and the view
--    renderer use to place the camera's schedule on a recording's timeline —
--    with no step-up and no audit row.
--
-- DEPLOY ORDER
-- ------------
--   1. apply this migration;
--   2. right away deploy the ML service (`railway up --detach` from ml-service/)
--      and push the web app; then `npm run gen:types`.
-- * The new ML must run only AFTER this migration: before it, its schedule reads
--   (cameras.privacy_default) fail and it fails closed = private = recognition
--   and alerts off. NOT merely "no alerts": every segment captured meanwhile
--   carries a `fail_closed` privacy span that cannot be written until
--   recording_privacy_spans exists, so NO recording is delivered until this
--   migration lands — the segments wait encrypted in the ML spool (rows stay
--   capture_status = 'capturing'), and capture stops once the spool reaches
--   RECORDING_MAX_PENDING_BYTES (2 GiB by default). Once the table exists the
--   spans are written and the backlog delivers, and the reveal job protects
--   that footage permanently, whatever the schedule says: it can never be
--   revealed short of deleting its spans by hand with the service role
--   (docs/RUNBOOK.md — a manual procedure, not enforced). Apply the migration
--   first.
-- * The web app warns on the schedule page and /health while the ML service
--   does not report `privacy_schedules` >= 1 on GET / (an older build ignores
--   schedules entirely).
-- * The old ML never reads any object touched here, so it keeps running
--   unchanged (recognition 24/7 = standard, which is what every camera maps to).
-- * The old web breaks between this migration and the web deploy (minutes;
--   admin-only): /cameras/[id]/schedule selects cameras.mask_default and calls
--   effective_mask_mode(), and the /backup export selects cameras.mask_default
--   (lib/backup-tables.ts).

-- ─── 1. cameras.privacy_default replaces cameras.mask_default ───────────────
alter table public.cameras
  add column if not exists privacy_default text not null default 'standard'
    constraint cameras_privacy_default_check
      check (privacy_default in ('standard', 'private'));

comment on column public.cameras.privacy_default is
  'Privacy mode outside every masking_schedules window. standard = face recognition on '
  '(embeddings, faces rows, suspect matching, alerts); private = no biometric processing '
  'and no reveal of footage captured then. Video is face-masked in both modes. '
  'Written only by the service role (TOTP step-up to loosen private -> standard).';

-- The old helper goes first so nothing is left that names mask_default.
drop function if exists public.effective_mask_mode(uuid, timestamptz);

-- safety: ok — the web app and the ML service no longer read mask_default
-- (the new privacy_default above carries the setting; every value maps to
-- 'standard', so no information is lost). The old web build still selects it
-- on the admin-only schedule page and the /backup export until the web deploy
-- that follows this migration (see DEPLOY ORDER); the old ML never read it.
alter table public.cameras drop column if exists mask_default;

-- ─── 2. masking_schedules: standard | private, service-role writes ─────────
-- safety: ok — swaps the window_mode CHECK on a table with 0 rows in
-- production (read 2026-09-28): the old values are mapped between the DROP and
-- the ADD, so the new CHECKs validate immediately. The only writer is the
-- schedule page, redeployed right after this migration.
alter table public.masking_schedules
  drop constraint if exists masking_schedules_window_mode_check;

update public.masking_schedules
   set window_mode = case window_mode
                       when 'masked'   then 'private'
                       when 'revealed' then 'standard'
                     end
 where window_mode in ('masked', 'revealed');

alter table public.masking_schedules
  add constraint masking_schedules_window_mode_check
    check (window_mode in ('standard', 'private')),
  add constraint masking_schedules_distinct_times_check
    check (starts_at <> ends_at),
  add constraint masking_schedules_starts_before_end_of_day_check
    check (starts_at <> '24:00');

revoke insert, update, delete, truncate, references, trigger
  on public.masking_schedules from authenticated;
revoke all on public.masking_schedules from anon;

-- The write policies are dead once the grants are gone; drop them so nobody
-- reads them as "admins may write here". 20260517144601 already replaced the
-- original FOR ALL "admin write" policy with the three split ones.
drop policy if exists "masking_schedules: admin write"  on public.masking_schedules;
drop policy if exists "masking_schedules: admin insert" on public.masking_schedules;
drop policy if exists "masking_schedules: admin update" on public.masking_schedules;
drop policy if exists "masking_schedules: admin delete" on public.masking_schedules;
-- Kept: "masking_schedules: operator read" (20260906130100) and the
-- restrictive "masking_schedules: second factor required" (20260908110000).

comment on table public.masking_schedules is
  'Per-camera privacy schedule windows in Asia/Seoul (table name is historical: no window '
  'ever un-masks video). window_mode private = no biometric processing and no reveal of '
  'footage captured then; standard = normal recognition. Precedence at an instant: any '
  'active private window > any active standard window > cameras.privacy_default. Written '
  'ONLY by the service role (TOTP step-up to loosen + audit); see effective_privacy_mode().';
comment on column public.masking_schedules.window_mode is
  'standard | private — the mode INSIDE the window.';
comment on column public.masking_schedules.starts_at is
  'HH:MM Asia/Seoul, 00:00-23:59. A window belongs to the weekday on which it starts.';
comment on column public.masking_schedules.ends_at is
  'HH:MM Asia/Seoul, exclusive; 24:00 = end of day. ends_at < starts_at = overnight window '
  'that continues into the next day.';
comment on column public.masking_schedules.weekdays is
  'Bitmask of the START day: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64 '
  '(bit index = ISO day-of-week % 7). 127 = every day.';

-- ─── 3. effective_privacy_mode() ────────────────────────────────────────────
-- Rules (MUST stay identical to ml-service/privacy_schedule.py):
--   * Asia/Seoul wall-clock time; ends_at is exclusive, 24:00 = end of day.
--   * A window belongs to the weekday on which it STARTS:
--       same-day  (starts_at < ends_at, incl. ends_at = 24:00): active on day D
--                 when D's bit is set and starts_at <= t < ends_at;
--       overnight (starts_at > ends_at): active when (D's bit is set and
--                 t >= starts_at) OR (the bit of D-1 is set and t < ends_at).
--                 Fri 22:00-06:00 covers Sat 02:00, not Fri 02:00.
--   * Precedence: any active private window -> 'private'; else any active
--     standard window -> 'standard'; else cameras.privacy_default; a camera id
--     with no cameras row -> 'standard'.
-- SECURITY INVOKER: it answers from the rows the caller can read through RLS,
-- so a caller who cannot see the camera (auditor, ungranted viewer) gets the
-- neutral 'standard' instead of learning anything about it. It is a display
-- helper for the schedule page; the ML service evaluates its own copy of the
-- rules with the service role and never calls this.
create function public.effective_privacy_mode(
  p_camera_id uuid,
  p_at        timestamptz default now()
)
returns text
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with local_clock as (
    select p_at at time zone 'Asia/Seoul' as ts
  ),
  k as (
    select ts::time                                         as t,
           (1 << (extract(isodow from ts)::int % 7))         as today_bit,
           (1 << ((extract(isodow from ts)::int + 6) % 7))   as yesterday_bit
      from local_clock
  ),
  active as (
    select s.window_mode
      from public.masking_schedules s
      cross join k
     where s.camera_id = p_camera_id
       and (
             -- same-day window (ends_at may be 24:00), started today
             (    s.starts_at::time < s.ends_at::time
              and (s.weekdays & k.today_bit) <> 0
              and k.t >= s.starts_at::time
              and k.t <  s.ends_at::time)
             -- overnight window, evening part: started today
          or (    s.starts_at::time > s.ends_at::time
              and (s.weekdays & k.today_bit) <> 0
              and k.t >= s.starts_at::time)
             -- overnight window, morning part: started yesterday
          or (    s.starts_at::time > s.ends_at::time
              and (s.weekdays & k.yesterday_bit) <> 0
              and k.t <  s.ends_at::time)
           )
  )
  select coalesce(
    (select 'private'::text  from active where window_mode = 'private'  limit 1),
    (select 'standard'::text from active where window_mode = 'standard' limit 1),
    (select c.privacy_default from public.cameras c where c.id = p_camera_id),
    'standard'
  );
$$;

revoke execute on function public.effective_privacy_mode(uuid, timestamptz) from public, anon;
grant execute on function public.effective_privacy_mode(uuid, timestamptz) to authenticated, service_role;

comment on function public.effective_privacy_mode(uuid, timestamptz) is
  'Returns ''standard''|''private'' for a camera at a UTC instant: masking_schedules '
  'windows evaluated in Asia/Seoul (weekday of the window start; overnight windows '
  'continue into the next day), private wins over standard, then cameras.privacy_default, '
  'unknown camera -> ''standard''. Same rules as ml-service/privacy_schedule.py. '
  'SECURITY INVOKER — RLS applies; display helper, not a gate.';

-- ─── 1b. cameras.privacy_loosened_at ─────────────────────────────────────────
alter table public.cameras
  add column if not exists privacy_loosened_at timestamptz;

comment on column public.cameras.privacy_loosened_at is
  'When the privacy schedule was last LOOSENED in a way that takes private time away '
  '(standard window added, private window deleted, default private -> standard, compared '
  'over a week). Written only by the service role from the schedule actions, before and '
  'again after the loosening write. /edge/detect keeps edge frames captured before it '
  'private: the current schedule no longer shows the private time that covered them. '
  'NULL = never.';

-- ─── 4. recording_privacy_spans ─────────────────────────────────────────────
-- Capture-time facts: stretches of a recording captured in private mode.
-- Offsets are seconds on the stored video's own timeline — the same timeline
-- as faces.time_in_video_sec and the reveal job's frame_time_sec.
-- end_offset_sec NULL = still open or never closed (the capture crashed):
-- readers treat it as "until the end of the recording" (fail closed).
-- source = 'fail_closed': the schedule could not be read, so the pipeline
-- protected the footage anyway.
-- Written ONLY by the ML service (service role); nobody edits these through
-- PostgREST — shrinking a span would make protected footage revealable.
create table public.recording_privacy_spans (
  id               bigint generated always as identity primary key,
  recording_id     uuid not null references public.recordings(id) on delete cascade,
  start_offset_sec double precision not null,
  end_offset_sec   double precision,
  source           text not null default 'schedule',
  -- Idempotency key generated by the pipeline once per span; every write of
  -- the span (live open + retries, spool delivery, journal recovery) upserts
  -- on it, so a lost response never leaves an orphaned open row behind.
  client_span_id   uuid not null default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  constraint recording_privacy_spans_client_span_id_key unique (client_span_id),
  -- The finite bound also rejects NaN (NaN sorts above every number here).
  constraint recording_privacy_spans_start_offset_check
    check (start_offset_sec >= 0 and start_offset_sec < 'Infinity'::double precision),
  constraint recording_privacy_spans_end_after_start_check
    check (end_offset_sec is null
           or (end_offset_sec > start_offset_sec
               and end_offset_sec < 'Infinity'::double precision)),
  constraint recording_privacy_spans_source_check
    check (source in ('schedule', 'fail_closed'))
);

create index recording_privacy_spans_recording_idx
  on public.recording_privacy_spans (recording_id, start_offset_sec);

alter table public.recording_privacy_spans enable row level security;

-- Permission-aware: the recordings policies (operator + user_can_see_camera +
-- second factor) apply inside the EXISTS, so a caller sees a recording's spans
-- exactly when they can see the recording itself.
create policy "recording_privacy_spans: operator read (permission aware)"
  on public.recording_privacy_spans
  for select to authenticated
  using (
    (select private.is_operator())
    and exists (
      select 1 from public.recordings r
       where r.id = recording_privacy_spans.recording_id
    )
  );

create policy "recording_privacy_spans: second factor required"
  on public.recording_privacy_spans
  as restrictive for all to authenticated
  using ((select private.mfa_ok())) with check ((select private.mfa_ok()));

revoke all on table public.recording_privacy_spans from anon, authenticated;
grant select on table public.recording_privacy_spans to authenticated;
grant all on table public.recording_privacy_spans to service_role;

comment on table public.recording_privacy_spans is
  'Stretches of a recording captured in private mode (no biometric processing; never '
  'revealed). Offsets in seconds of the stored video timeline (same as '
  'faces.time_in_video_sec). end_offset_sec NULL = open/never closed -> until the end '
  '(fail closed). source fail_closed = schedule unreadable, protected anyway. Written '
  'ONLY by the ML service (service role).';
comment on column public.recording_privacy_spans.start_offset_sec is
  'Seconds from the start of the stored video (inclusive).';
comment on column public.recording_privacy_spans.end_offset_sec is
  'Seconds from the start of the stored video (exclusive); NULL = until the end of the recording.';
comment on column public.recording_privacy_spans.source is
  'schedule = evaluated from the camera schedule; fail_closed = the schedule could not be '
  'read, so the pipeline protected the footage anyway.';
comment on column public.recording_privacy_spans.client_span_id is
  'Pipeline-generated idempotency key; every write of a span upserts on it.';

-- ─── 6. recordings: no UPDATE through a user token ──────────────────────────
-- Nothing in the web app updates recordings with a user token (grep: only
-- SELECTs); the ML service and scripts use the service role. The grant let a
-- stolen admin session PATCH recordings.started_at / camera_id — the anchors
-- used to place the camera's privacy schedule on the recording's timeline
-- (reveal job, on-demand view) — with no step-up and no audit row. Same
-- pattern as the DELETE revoke in 20260917150000.
revoke update on public.recordings from authenticated;
drop policy if exists "recordings: admin update" on public.recordings;
