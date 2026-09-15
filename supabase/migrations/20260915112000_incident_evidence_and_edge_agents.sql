-- Incident evidence packages, legal holds, and durable edge-agent delivery.

create table public.incident_recordings (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  recording_id uuid references public.recordings(id) on delete set null,
  recording_filename text not null,
  camera_name text,
  recording_started_at timestamptz not null,
  clip_start_sec numeric(10,3) not null check (clip_start_sec >= 0),
  clip_end_sec numeric(10,3) not null check (clip_end_sec > clip_start_sec),
  note text check (note is null or char_length(note) <= 1000),
  legal_hold boolean not null default true,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  hold_released_by uuid references public.profiles(id) on delete set null,
  hold_released_at timestamptz,
  unique (incident_id, recording_id, clip_start_sec, clip_end_sec)
);
create index incident_recordings_incident_idx
  on public.incident_recordings(incident_id, added_at desc);
create index incident_recordings_held_recording_idx
  on public.incident_recordings(recording_id)
  where legal_hold and recording_id is not null;

create table public.incident_evidence_exports (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  file_count integer not null check (file_count > 0),
  package_bytes bigint not null check (package_bytes > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index incident_evidence_exports_incident_idx
  on public.incident_evidence_exports(incident_id, created_at desc);

-- One device may serve one camera while a site can have many devices.
create table public.edge_agents (
  id uuid primary key,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  camera_id uuid not null references public.cameras(id) on delete cascade,
  capture_enabled boolean not null default true,
  version text not null check (char_length(version) between 1 and 40),
  state text not null default 'online' check (state in ('online', 'degraded')),
  queue_depth integer not null default 0 check (queue_depth >= 0),
  oldest_queued_at timestamptz,
  sent_total bigint not null default 0 check (sent_total >= 0),
  failed_total bigint not null default 0 check (failed_total >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index edge_agents_camera_seen_idx on public.edge_agents(camera_id, last_seen_at desc);

create table public.edge_ingest_events (
  id uuid primary key,
  agent_id uuid not null references public.edge_agents(id) on delete cascade,
  camera_id uuid not null references public.cameras(id) on delete cascade,
  captured_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  face_count integer not null check (face_count >= 0),
  received_at timestamptz not null default now()
);
create index edge_ingest_events_agent_received_idx
  on public.edge_ingest_events(agent_id, received_at desc);
create index edge_ingest_events_camera_captured_idx
  on public.edge_ingest_events(camera_id, captured_at desc);

-- safety: ok — replace the resource check with a strict superset, then seed a bounded metadata-retention policy.
alter table public.retention_policies drop constraint retention_policies_resource_check;
alter table public.retention_policies add constraint retention_policies_resource_check check (resource in (
  'recordings', 'faces', 'alerts', 'audit_log', 'reveal_jobs', 'reveal_outputs',
  'edge_ingest_events'
));
insert into public.retention_policies(resource, retention_days, enabled)
values ('edge_ingest_events', 90, true)
on conflict (resource) do nothing;

alter table public.incident_recordings enable row level security;
alter table public.incident_evidence_exports enable row level security;
alter table public.edge_agents enable row level security;
alter table public.edge_ingest_events enable row level security;

create policy "incident recordings: verified admin read" on public.incident_recordings
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));
create policy "incident exports: verified admin read" on public.incident_evidence_exports
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));
create policy "edge agents: verified admin read" on public.edge_agents
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));
create policy "edge events: verified admin read" on public.edge_ingest_events
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));

revoke all on table public.incident_recordings, public.incident_evidence_exports,
  public.edge_agents, public.edge_ingest_events from public, anon, authenticated;
grant select on table public.incident_recordings, public.incident_evidence_exports,
  public.edge_agents, public.edge_ingest_events to authenticated;
grant all on table public.incident_recordings, public.incident_evidence_exports,
  public.edge_agents, public.edge_ingest_events to service_role;

-- safety: ok — the check is replaced in the same transaction with a strict superset; existing rows remain valid.
alter table public.incident_events drop constraint incident_events_event_type_check;
alter table public.incident_events add constraint incident_events_event_type_check check (event_type in (
  'created', 'updated', 'note_added', 'alert_attached', 'face_attached',
  'recording_attached', 'hold_changed', 'package_exported'
));

create function public.attach_incident_recording(
  p_incident_id uuid,
  p_recording_id uuid,
  p_clip_start_sec numeric,
  p_clip_end_sec numeric,
  p_note text default null,
  p_legal_hold boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_rec public.recordings%rowtype;
  v_id uuid;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.incidents where id = p_incident_id) then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  select * into v_rec from public.recordings where id = p_recording_id;
  if not found then raise exception 'recording not found' using errcode = 'P0002'; end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_rec.capture_status <> 'ready'
     or p_clip_start_sec is null or p_clip_end_sec is null
     or p_clip_start_sec < 0 or p_clip_end_sec <= p_clip_start_sec
     or p_clip_end_sec - p_clip_start_sec > 300
     or (v_rec.duration_sec is not null and p_clip_end_sec > v_rec.duration_sec + 0.25)
     or (p_note is not null and char_length(p_note) > 1000) then
    raise exception 'invalid evidence range' using errcode = '22023';
  end if;
  select email into v_email from public.profiles where id = v_user;
  insert into public.incident_recordings(
    incident_id, recording_id, recording_filename, camera_name,
    recording_started_at, clip_start_sec, clip_end_sec, note, legal_hold, added_by
  ) values (
    p_incident_id, v_rec.id, v_rec.filename, v_rec.camera_name,
    v_rec.started_at, p_clip_start_sec, p_clip_end_sec, p_note,
    coalesce(p_legal_hold, true), v_user
  )
  on conflict (incident_id, recording_id, clip_start_sec, clip_end_sec)
  do update set
    note = excluded.note,
    legal_hold = incident_recordings.legal_hold or excluded.legal_hold,
    hold_released_by = case when incident_recordings.legal_hold or excluded.legal_hold then null else incident_recordings.hold_released_by end,
    hold_released_at = case when incident_recordings.legal_hold or excluded.legal_hold then null else incident_recordings.hold_released_at end
  returning id into v_id;
  update public.incidents set updated_at = now() where id = p_incident_id;
  insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
    values (p_incident_id, 'recording_attached',
      'evidence=' || v_id::text || ' · recording=' || v_rec.id::text ||
      ' · range=' || p_clip_start_sec::text || '-' || p_clip_end_sec::text || 's' ||
      ' · hold=' || coalesce(p_legal_hold, true)::text,
      v_user, v_email);
  insert into public.audit_log(action, detail, user_id, user_email)
    values ('INCIDENT_RECORDING_ATTACHED',
      p_incident_id::text || ' · evidence=' || v_id::text || ' · recording=' || v_rec.id::text,
      v_user, v_email);
  return v_id;
end;
$$;

create function public.set_incident_recording_hold(p_evidence_id uuid, p_legal_hold boolean)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_row public.incident_recordings%rowtype;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  select * into v_row from public.incident_recordings where id = p_evidence_id for update;
  if not found then raise exception 'evidence not found' using errcode = 'P0002'; end if;
  if v_row.legal_hold = p_legal_hold then return p_evidence_id; end if;
  select email into v_email from public.profiles where id = v_user;
  update public.incident_recordings set
    legal_hold = p_legal_hold,
    hold_released_by = case when p_legal_hold then null else v_user end,
    hold_released_at = case when p_legal_hold then null else now() end
  where id = p_evidence_id;
  update public.incidents set updated_at = now() where id = v_row.incident_id;
  insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
    values (v_row.incident_id, 'hold_changed',
      'evidence=' || p_evidence_id::text || ' · hold=' || p_legal_hold::text,
      v_user, v_email);
  insert into public.audit_log(action, detail, user_id, user_email)
    values (case when p_legal_hold then 'EVIDENCE_HOLD_APPLIED' else 'EVIDENCE_HOLD_RELEASED' end,
      v_row.incident_id::text || ' · evidence=' || p_evidence_id::text,
      v_user, v_email);
  return p_evidence_id;
end;
$$;

create function public.log_incident_evidence_export(
  p_incident_id uuid,
  p_manifest_sha256 text,
  p_file_count integer,
  p_package_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_id uuid;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.incidents where id = p_incident_id) then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' or p_file_count < 1 or p_package_bytes < 1 then
    raise exception 'invalid evidence export metadata' using errcode = '22023';
  end if;
  select email into v_email from public.profiles where id = v_user;
  insert into public.incident_evidence_exports(
    incident_id, manifest_sha256, file_count, package_bytes, created_by, created_by_email
  ) values (p_incident_id, p_manifest_sha256, p_file_count, p_package_bytes, v_user, v_email)
  returning id into v_id;
  insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
    values (p_incident_id, 'package_exported',
      'package=' || v_id::text || ' · manifest_sha256=' || p_manifest_sha256 ||
      ' · files=' || p_file_count::text,
      v_user, v_email);
  insert into public.audit_log(action, detail, user_id, user_email)
    values ('EVIDENCE_PACKAGE_EXPORTED',
      p_incident_id::text || ' · package=' || v_id::text || ' · sha256=' || p_manifest_sha256,
      v_user, v_email);
  return v_id;
end;
$$;

revoke all on function public.attach_incident_recording(uuid, uuid, numeric, numeric, text, boolean),
  public.set_incident_recording_hold(uuid, boolean),
  public.log_incident_evidence_export(uuid, text, integer, bigint)
  from public, anon;
grant execute on function public.attach_incident_recording(uuid, uuid, numeric, numeric, text, boolean),
  public.set_incident_recording_hold(uuid, boolean),
  public.log_incident_evidence_export(uuid, text, integer, bigint)
  to authenticated;

-- A legal hold blocks direct deletion as well as scheduled retention.
create function public.prevent_held_evidence_deletion()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'recordings' then
    if exists (
      select 1 from public.incident_recordings where recording_id = old.id and legal_hold
    ) then
      raise exception 'recording is protected by an incident legal hold' using errcode = '55000';
    end if;
  elsif tg_table_name = 'faces' then
    if old.recording_id is not null and exists (
      select 1 from public.incident_recordings where recording_id = old.recording_id and legal_hold
    ) then
      raise exception 'face is protected by an incident legal hold' using errcode = '55000';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function public.prevent_held_evidence_deletion() from public, anon, authenticated;
create trigger recordings_prevent_held_delete before delete on public.recordings
  for each row execute function public.prevent_held_evidence_deletion();
create trigger faces_prevent_held_delete before delete on public.faces
  for each row execute function public.prevent_held_evidence_deletion();

create or replace function public.sweep_retention()
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  pol record;
  result jsonb := '{}'::jsonb;
  rows_removed integer;
  cutoff timestamptz;
begin
  for pol in select * from public.retention_policies where enabled order by resource loop
    rows_removed := 0;
    cutoff := now() - make_interval(days => pol.retention_days);
    begin
      if pol.resource = 'recordings' then
        delete from public.recordings r
          where r.started_at < cutoff
            and not exists (
              select 1 from public.incident_recordings e
              where e.recording_id = r.id and e.legal_hold
            );
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'faces' then
        delete from public.faces f
          where f.detected_at < cutoff
            and not exists (
              select 1 from public.incident_recordings e
              where e.recording_id = f.recording_id and e.legal_hold
            );
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'alerts' then
        delete from public.alerts where created_at < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'audit_log' then
        result := result || jsonb_build_object('audit_log_skipped', 'immutable ledger — legal hold');
      elsif pol.resource = 'reveal_jobs' then
        delete from public.reveal_jobs where created_at < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'reveal_outputs' then
        update public.reveal_jobs set output_path = null
          where output_path is not null and coalesce(completed_at, created_at) < cutoff;
        get diagnostics rows_removed = row_count;
      elsif pol.resource = 'edge_ingest_events' then
        delete from public.edge_ingest_events where received_at < cutoff;
        get diagnostics rows_removed = row_count;
      end if;
      if pol.resource <> 'audit_log' then
        update public.retention_policies
          set last_swept_at = now(), last_swept_rows = rows_removed
          where resource = pol.resource;
        result := result || jsonb_build_object(pol.resource, rows_removed);
      end if;
    exception when others then
      result := result || jsonb_build_object(pol.resource, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  insert into public.audit_log (action, detail) values ('RETENTION_SWEEP', result::text);
  return result;
end;
$$;
revoke execute on function public.sweep_retention() from public, anon, authenticated;
grant execute on function public.sweep_retention() to service_role;
