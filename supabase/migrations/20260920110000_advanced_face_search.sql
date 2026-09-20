-- Advanced evidence search and per-operator saved filters.

alter table public.faces
  add column if not exists detection_confidence real
  check (detection_confidence is null or detection_confidence between 0 and 1);

comment on column public.faces.detection_confidence is
  'Detector confidence at capture time. NULL for legacy rows captured before this field existed.';

create table public.face_search_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  camera_id uuid references public.cameras(id) on delete set null,
  from_at timestamptz,
  to_at timestamptz,
  recording_status text check (recording_status is null or recording_status in ('capturing', 'ready', 'partial', 'failed', 'unlinked')),
  min_confidence real check (min_confidence is null or min_confidence between 0 and 1),
  suspect_id uuid references public.suspects(id) on delete set null,
  incident_id uuid references public.incidents(id) on delete set null,
  match_threshold real not null default 0.50 check (match_threshold between 0.30 and 0.95),
  result_limit integer not null default 50 check (result_limit between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_at is null or to_at is null or from_at < to_at),
  unique (user_id, name)
);

create index face_search_presets_user_updated_idx
  on public.face_search_presets(user_id, updated_at desc);

alter table public.face_search_presets enable row level security;
revoke all on table public.face_search_presets from public, anon, authenticated;
grant select, insert, update, delete on table public.face_search_presets to authenticated;
grant all on table public.face_search_presets to service_role;

create policy "face search presets: verified owner read" on public.face_search_presets
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_admin()) and (select private.mfa_ok()));
create policy "face search presets: verified owner insert" on public.face_search_presets
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_admin()) and (select private.mfa_ok()));
create policy "face search presets: verified owner update" on public.face_search_presets
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_admin()) and (select private.mfa_ok()))
  with check (user_id = (select auth.uid()) and (select private.is_admin()) and (select private.mfa_ok()));
create policy "face search presets: verified owner delete" on public.face_search_presets
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_admin()) and (select private.mfa_ok()));

create or replace function public.search_faces_advanced_page(
  query_embedding extensions.vector(512),
  match_threshold double precision default 0.50,
  p_limit integer default 51,
  p_offset integer default 0,
  p_camera_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_recording_status text default null,
  p_min_confidence real default null,
  p_suspect_id uuid default null,
  p_incident_id uuid default null
)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz,
  detection_confidence real,
  similarity double precision,
  recording_id uuid,
  recording_status text,
  camera_id uuid,
  recording_filename text,
  camera_name text,
  crop_sealed boolean,
  suspect_id uuid,
  suspect_name text
)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_catalog
as $$
begin
  if match_threshold < 0.30 or match_threshold > 0.95
     or p_limit < 1 or p_limit > 101
     or p_offset < 0 or p_offset > 10000
     or (p_from is not null and p_to is not null and p_from >= p_to)
     or (p_min_confidence is not null and (p_min_confidence < 0 or p_min_confidence > 1))
     or (p_recording_status is not null and p_recording_status not in ('capturing', 'ready', 'partial', 'failed', 'unlinked')) then
    raise exception 'invalid search filters' using errcode = '22023';
  end if;

  return query
    select f.id, f.filename, f.image_path, f.detected_at, f.detection_confidence,
           (1 - (f.embedding OPERATOR(extensions.<=>) query_embedding))::double precision,
           case when r.id is null then null else f.recording_id end,
           r.capture_status,
           f.camera_id, r.filename, c.name, f.crop_sealed,
           matched.suspect_id, matched.suspect_name
    from public.faces f
    left join public.recordings r on r.id = f.recording_id
    left join public.cameras c on c.id = f.camera_id
    left join lateral (
      select a.suspect_id, s.name as suspect_name
      from public.alerts a
      left join public.suspects s on s.id = a.suspect_id
      where a.face_id = f.id
        and (p_suspect_id is null or a.suspect_id = p_suspect_id)
      order by a.created_at desc, a.id
      limit 1
    ) matched on true
    where 1 - (f.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
      and (p_camera_id is null or f.camera_id = p_camera_id)
      and (p_from is null or f.detected_at >= p_from)
      and (p_to is null or f.detected_at < p_to)
      and (p_min_confidence is null or f.detection_confidence >= p_min_confidence)
      and (p_suspect_id is null or matched.suspect_id = p_suspect_id)
      and (
        p_recording_status is null
        or (p_recording_status = 'unlinked' and r.id is null)
        or r.capture_status = p_recording_status
      )
      and (
        p_incident_id is null
        or exists (
          select 1 from public.incident_faces evidence_face
          where evidence_face.incident_id = p_incident_id and evidence_face.face_id = f.id
        )
        or exists (
          select 1 from public.incident_recordings evidence_recording
          where evidence_recording.incident_id = p_incident_id and evidence_recording.recording_id = f.recording_id
        )
        or exists (
          select 1
          from public.incident_alerts evidence_alert
          join public.alerts linked_alert on linked_alert.id = evidence_alert.alert_id
          where evidence_alert.incident_id = p_incident_id and linked_alert.face_id = f.id
        )
      )
    order by f.embedding OPERATOR(extensions.<=>) query_embedding, f.detected_at desc, f.id
    offset p_offset
    limit p_limit;
end;
$$;

revoke all on function public.search_faces_advanced_page(
  extensions.vector, double precision, integer, integer, uuid, timestamptz, timestamptz,
  text, real, uuid, uuid
) from public, anon;
grant execute on function public.search_faces_advanced_page(
  extensions.vector, double precision, integer, integer, uuid, timestamptz, timestamptz,
  text, real, uuid, uuid
) to authenticated, service_role;

comment on function public.search_faces_advanced_page(
  extensions.vector, double precision, integer, integer, uuid, timestamptz, timestamptz,
  text, real, uuid, uuid
) is 'Verified-admin paginated face search with camera, time, recording, confidence, suspect, and incident filters.';
