-- Distinguish capture lifecycle from playable, validated delivery.
alter table public.recordings
  add column if not exists capture_status text not null default 'ready'
    check (capture_status in ('capturing', 'ready', 'partial', 'failed')),
  add column if not exists capture_error text;
alter table public.recordings alter column duration_sec type double precision;
update public.recordings set capture_status = 'partial',
  capture_error = 'Capture predates durable segment recovery'
where ended_at is null and not has_original;

-- Source offsets never depend on inference or database queue latency.
alter table public.faces
  add column if not exists source_offset_sec double precision
  check (source_offset_sec >= 0 and source_offset_sec < 'Infinity'::double precision);
comment on column public.faces.source_offset_sec is
  'Presentation time in the recording, captured before asynchronous inference; NULL for legacy rows.';

create or replace function public.faces_in_recording(rec_id uuid)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz,
  time_in_video_sec real,
  bbox jsonb,
  crop_sealed boolean,
  chain_index integer
)
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
  select
    f.id,
    f.filename,
    f.image_path,
    f.detected_at,
    coalesce(f.source_offset_sec, extract(epoch from (f.detected_at - r.started_at)))::real as time_in_video_sec,
    f.bbox,
    f.crop_sealed,
    f.chain_index
  from public.faces f
  join public.recordings r on r.id = coalesce(f.recording_id, (
    -- recording_id хоосон бол camera_id + цаг хугацаагаар тааруулах (хуучин row-ууд)
    select r2.id from public.recordings r2
    where r2.camera_id = f.camera_id
      and f.detected_at >= r2.started_at
      and f.detected_at <= coalesce(r2.ended_at, r2.started_at + interval '24 hours')
    order by r2.started_at desc limit 1
  ))
  where r.id = rec_id
  order by coalesce(f.source_offset_sec, extract(epoch from (f.detected_at - r.started_at))), f.id;
$$;

revoke execute on function public.faces_in_recording(uuid) from public, anon;
grant execute on function public.faces_in_recording(uuid) to authenticated, service_role;

comment on function public.faces_in_recording(uuid) is
  'Faces detected in a recording with time offset, bbox and seal state (crop_sealed/chain_index, ADR 0009). SECURITY INVOKER — RLS applies.';
