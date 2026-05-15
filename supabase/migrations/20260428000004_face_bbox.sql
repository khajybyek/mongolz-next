-- ════════════════════════════════════════════════════════════════
--  Face bbox + recording_id — playback-аас click-to-reveal-ийг идэвхжүүлнэ
-- ════════════════════════════════════════════════════════════════

-- Frame координат харьцангуй ratio-р хадгална (0-1) учир video element-ийн
-- rendered хэмжээтэй автоматаар scale болно.
alter table public.faces
  add column if not exists bbox          jsonb,                  -- {x,y,w,h} 0-1 ratios
  add column if not exists recording_id  uuid references public.recordings(id) on delete set null;

create index if not exists faces_recording_id_idx on public.faces(recording_id);

-- ── RPC шинэчлэх — bbox + time_in_video_sec буцаах ──────────────
drop function if exists public.faces_in_recording(uuid);

create or replace function public.faces_in_recording(rec_id uuid)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz,
  time_in_video_sec real,
  bbox jsonb
)
language sql stable
as $$
  select
    f.id,
    f.filename,
    f.image_path,
    f.detected_at,
    extract(epoch from (f.detected_at - r.started_at))::real as time_in_video_sec,
    f.bbox
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
  order by f.detected_at;
$$;
