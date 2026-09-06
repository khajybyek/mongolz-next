-- camera_sessions — ML-owned registry of running capture sessions.
--
-- The ML service upserts a row whenever it starts a camera (URL sealed with
-- its own ML_ENCRYPTION_KEY, per-camera HKDF) and flips auto_resume off on an
-- explicit stop. On startup it resumes every auto_resume row, so a Railway
-- redeploy / crash no longer silently ends recording. Vercel never needs to
-- share CAMERA_URL_KEY with the ML service for this.

create table if not exists public.camera_sessions (
  camera_id   uuid primary key references public.cameras(id) on delete cascade,
  sealed_url  text not null,
  camera_name text,
  fps         integer not null default 15 check (fps between 5 and 30),
  auto_resume boolean not null default true,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_error  text check (last_error is null or length(last_error) <= 500)
);

comment on table public.camera_sessions is
  'Capture sessions the ML service is (or should be) running. sealed_url is AES-256-GCM sealed by the ML service; only service_role writes.';

alter table public.camera_sessions enable row level security;

revoke all on public.camera_sessions from anon, authenticated;
grant select (camera_id, camera_name, fps, auto_resume, started_at, updated_at, last_error)
  on public.camera_sessions to authenticated;

drop policy if exists "camera_sessions: admin read" on public.camera_sessions;
create policy "camera_sessions: admin read"
  on public.camera_sessions for select
  to authenticated
  using (private.is_admin());

create index if not exists camera_sessions_auto_resume_idx
  on public.camera_sessions (auto_resume) where auto_resume;
