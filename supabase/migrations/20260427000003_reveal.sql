-- ════════════════════════════════════════════════════════════════
--  Face Reveal — blurred бичлэгээс тодорхой нэг хүнийг unblur хийх ажил
-- ════════════════════════════════════════════════════════════════

-- Recordings table-д original_path нэмэх (un-blurred хувилбарын storage path)
alter table public.recordings
  add column if not exists original_path text;

create type reveal_method as enum ('upload', 'suspect', 'detected_face');
create type reveal_status as enum ('queued', 'processing', 'completed', 'failed');

create table public.reveal_jobs (
  id              uuid primary key default uuid_generate_v4(),
  recording_id    uuid not null references public.recordings(id) on delete cascade,

  method          reveal_method not null,
  -- Эх сурвалжийн өгөгдөл (method-аас хамаарч 1 нь дүүрнэ):
  suspect_id      uuid references public.suspects(id) on delete set null,
  face_id         uuid references public.faces(id) on delete set null,
  query_embedding vector(512),  -- "upload" method-д photo-аас тооцсон

  threshold       real not null default 0.45 check (threshold between 0.3 and 0.85),

  status          reveal_status not null default 'queued',
  progress        smallint not null default 0 check (progress between 0 and 100),

  output_path     text,        -- supabase storage: revealed/<job_id>.mp4
  output_duration_sec integer,
  error_message   text,

  requested_by    uuid references public.profiles(id) on delete set null,
  requested_email text,
  reauth_at       timestamptz, -- step-up auth amжилттай болсон цаг (15 мин TTL)
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz
);

create index reveal_jobs_recording_idx on public.reveal_jobs(recording_id);
create index reveal_jobs_status_idx    on public.reveal_jobs(status);
create index reveal_jobs_created_idx   on public.reveal_jobs(created_at desc);

-- Storage bucket — revealed бичлэгүүд (зөвхөн short-lived signed URL-ээр өгнө)
insert into storage.buckets (id, name, public)
values ('revealed', 'revealed', false)
on conflict (id) do nothing;

-- ── RLS ──────────────────────────────────────────
alter table public.reveal_jobs enable row level security;

create policy "reveal_jobs: admin read"
  on public.reveal_jobs for select using (public.is_admin());

create policy "reveal_jobs: admin write"
  on public.reveal_jobs for all using (public.is_admin()) with check (public.is_admin());

-- ── Helper: тухайн бичлэгт илэрсэн нүүрнүүдийг буцаах ─────
-- Recording бүртгэлтэй илэрсэн нүүрнүүдийг авч reveal-ийн "Detected faces"
-- сонголтод харуулна.
create or replace function public.faces_in_recording(rec_id uuid)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz
)
language sql stable
as $$
  select f.id, f.filename, f.image_path, f.detected_at
  from public.faces f
  join public.recordings r on r.camera_id = f.camera_id
  where r.id = rec_id
    and f.detected_at >= r.started_at
    and f.detected_at <= coalesce(r.ended_at, r.started_at + interval '24 hours')
  order by f.detected_at;
$$;
