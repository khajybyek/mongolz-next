-- consent_required is a conservative biometric-processing gate, not proof
-- that consent was obtained. A separate verified consent mechanism does not
-- exist yet. The capture pipeline records a distinct, irreversible span for
-- footage acquired while this gate was active.
-- safety: ok — Apply this short constraint replacement before deploying the
-- ML service that writes source='consent'. It only widens accepted values;
-- existing schedule/fail_closed rows stay valid, and old writers keep working.
alter table public.recording_privacy_spans
  drop constraint recording_privacy_spans_source_check;
alter table public.recording_privacy_spans
  add constraint recording_privacy_spans_source_check
  check (source in ('schedule', 'consent', 'fail_closed'));

comment on column public.recording_privacy_spans.source is
  'schedule = privacy schedule; consent = consent_required blocked biometric processing; '
  'fail_closed = policy unreadable. All sources protect captured footage permanently.';

comment on column public.cameras.consent_required is
  'When true, biometric recognition and alerts are paused, even in standard windows. '
  'Masked capture continues and the captured interval cannot be revealed. '
  'A physical notice alone does not satisfy consent; no verified consent ledger exists yet.';

-- Display helper mirrors the ML policy. It remains SECURITY INVOKER and does
-- not itself authorise capture, playback or reveal.
create or replace function public.effective_privacy_mode(
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
    select ts::time as t,
           (1 << (extract(isodow from ts)::int % 7)) as today_bit,
           (1 << ((extract(isodow from ts)::int + 6) % 7)) as yesterday_bit
      from local_clock
  ),
  active as (
    select s.window_mode
      from public.masking_schedules s
      cross join k
     where s.camera_id = p_camera_id
       and (
             (    s.starts_at::time < s.ends_at::time
              and (s.weekdays & k.today_bit) <> 0
              and k.t >= s.starts_at::time
              and k.t <  s.ends_at::time)
          or (    s.starts_at::time > s.ends_at::time
              and (s.weekdays & k.today_bit) <> 0
              and k.t >= s.starts_at::time)
          or (    s.starts_at::time > s.ends_at::time
              and (s.weekdays & k.yesterday_bit) <> 0
              and k.t <  s.ends_at::time)
           )
  )
  select case
    when exists (
      select 1 from public.cameras c
       where c.id = p_camera_id and c.consent_required
    ) then 'private'
    else coalesce(
      (select 'private'::text from active where window_mode = 'private' limit 1),
      (select 'standard'::text from active where window_mode = 'standard' limit 1),
      (select c.privacy_default from public.cameras c where c.id = p_camera_id),
      'standard'
    )
  end;
$$;

comment on function public.effective_privacy_mode(uuid, timestamptz) is
  'Display helper: consent_required forces private; otherwise private window > '
  'standard window > privacy_default; missing camera = standard. SECURITY INVOKER.';
