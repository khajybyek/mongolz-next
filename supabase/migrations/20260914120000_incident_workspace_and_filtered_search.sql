-- Incident workspace + scoped biometric search.
--
-- Incidents turn separate alerts, face candidates and recordings into one
-- operator-owned case. Mutations use SECURITY DEFINER RPCs so the incident,
-- its immutable history and the audit ledger commit in one transaction.
-- Search filters execute before the result limit; filtering a 50-row sample
-- in Next.js would silently miss valid older/camera-specific evidence.

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index incidents_status_updated_idx on public.incidents(status, updated_at desc);
create index incidents_assignee_idx on public.incidents(assignee_id, updated_at desc);

create table public.incident_alerts (
  incident_id uuid not null references public.incidents(id) on delete cascade,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (incident_id, alert_id)
);
create index incident_alerts_alert_idx on public.incident_alerts(alert_id);

create table public.incident_faces (
  incident_id uuid not null references public.incidents(id) on delete cascade,
  face_id uuid not null references public.faces(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (incident_id, face_id)
);
create index incident_faces_face_idx on public.incident_faces(face_id);

create table public.incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'note_added', 'alert_attached', 'face_attached'
  )),
  detail text check (detail is null or char_length(detail) <= 2000),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now()
);
create index incident_events_incident_created_idx on public.incident_events(incident_id, created_at desc, id desc);

alter table public.incidents enable row level security;
alter table public.incident_alerts enable row level security;
alter table public.incident_faces enable row level security;
alter table public.incident_events enable row level security;

create policy "incidents: verified admin read" on public.incidents
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));
create policy "incident alerts: verified admin read" on public.incident_alerts
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));
create policy "incident faces: verified admin read" on public.incident_faces
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));
create policy "incident events: verified admin read" on public.incident_events
  for select to authenticated
  using ((select private.is_admin()) and (select private.mfa_ok()));

revoke all on table public.incidents, public.incident_alerts, public.incident_faces, public.incident_events
  from public, anon, authenticated;
grant select on table public.incidents, public.incident_alerts, public.incident_faces, public.incident_events
  to authenticated;
grant all on table public.incidents, public.incident_alerts, public.incident_faces, public.incident_events
  to service_role;
grant usage, select on sequence public.incident_events_id_seq to service_role;

create or replace function public.create_incident(
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
  p_assignee_id uuid default null,
  p_alert_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_id uuid;
  v_user uuid := auth.uid();
  v_email text;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  p_title := btrim(coalesce(p_title, ''));
  p_description := nullif(btrim(coalesce(p_description, '')), '');
  if char_length(p_title) not between 3 and 160
     or (p_description is not null and char_length(p_description) > 2000)
     or p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'invalid incident input' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and role = 'admin'
  ) then
    raise exception 'assignee must be an admin' using errcode = '22023';
  end if;
  if p_alert_id is not null and not exists (select 1 from public.alerts where id = p_alert_id) then
    raise exception 'alert not found' using errcode = 'P0002';
  end if;

  select email into v_email from public.profiles where id = v_user;
  insert into public.incidents(title, description, priority, assignee_id, created_by)
    values (p_title, p_description, p_priority, p_assignee_id, v_user)
    returning id into v_id;
  insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
    values (v_id, 'created', 'priority=' || p_priority, v_user, v_email);
  if p_alert_id is not null then
    insert into public.incident_alerts(incident_id, alert_id, added_by)
      values (v_id, p_alert_id, v_user);
    insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
      values (v_id, 'alert_attached', p_alert_id::text, v_user, v_email);
  end if;
  insert into public.audit_log(action, detail, user_id, user_email)
    values ('INCIDENT_CREATED', v_id::text || ' · ' || p_title, v_user, v_email);
  return v_id;
end;
$$;

create or replace function public.update_incident(
  p_incident_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_description text,
  p_status text,
  p_priority text,
  p_assignee_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_old public.incidents%rowtype;
  v_detail text := '';
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  p_title := btrim(coalesce(p_title, ''));
  p_description := nullif(btrim(coalesce(p_description, '')), '');
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(p_title) not between 3 and 160
     or (p_description is not null and char_length(p_description) > 2000)
     or p_status not in ('open', 'investigating', 'resolved')
     or p_priority not in ('low', 'medium', 'high', 'critical')
     or (p_note is not null and char_length(p_note) > 2000) then
    raise exception 'invalid incident input' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and role = 'admin'
  ) then
    raise exception 'assignee must be an admin' using errcode = '22023';
  end if;

  select * into v_old from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'incident not found' using errcode = 'P0002'; end if;
  if v_old.updated_at <> p_expected_updated_at then
    raise exception 'incident changed concurrently' using errcode = '40001';
  end if;
  select email into v_email from public.profiles where id = v_user;

  if v_old.title <> p_title then v_detail := 'title changed'; end if;
  if v_old.description is distinct from p_description then v_detail := concat_ws(' · ', nullif(v_detail, ''), 'description changed'); end if;
  if v_old.status <> p_status then v_detail := concat_ws(' · ', nullif(v_detail, ''), 'status=' || v_old.status || '→' || p_status); end if;
  if v_old.priority <> p_priority then v_detail := concat_ws(' · ', nullif(v_detail, ''), 'priority=' || v_old.priority || '→' || p_priority); end if;
  if v_old.assignee_id is distinct from p_assignee_id then v_detail := concat_ws(' · ', nullif(v_detail, ''), 'assignee changed'); end if;

  -- A repeated Save must not move the optimistic-concurrency token without
  -- leaving an event/audit row. Return the unchanged case for a true no-op.
  if v_detail = '' and p_note is null then return p_incident_id; end if;

  update public.incidents set
    title = p_title,
    description = p_description,
    status = p_status,
    priority = p_priority,
    assignee_id = p_assignee_id,
    updated_at = now(),
    resolved_at = case when p_status = 'resolved' then coalesce(v_old.resolved_at, now()) else null end,
    resolved_by = case when p_status = 'resolved' then coalesce(v_old.resolved_by, v_user) else null end
  where id = p_incident_id;

  if v_detail <> '' then
    insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
      values (p_incident_id, 'updated', v_detail, v_user, v_email);
  end if;
  if p_note is not null then
    insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
      values (p_incident_id, 'note_added', p_note, v_user, v_email);
  end if;
  if v_detail <> '' or p_note is not null then
    insert into public.audit_log(action, detail, user_id, user_email)
      values ('INCIDENT_UPDATED', p_incident_id::text || case when v_detail <> '' then ' · ' || v_detail else ' · note' end, v_user, v_email);
  end if;
  return p_incident_id;
end;
$$;

create or replace function public.attach_incident_alert(p_incident_id uuid, p_alert_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_added integer;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.incidents where id = p_incident_id) then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.alerts where id = p_alert_id) then
    raise exception 'alert not found' using errcode = 'P0002';
  end if;
  select email into v_email from public.profiles where id = v_user;
  insert into public.incident_alerts(incident_id, alert_id, added_by)
    values (p_incident_id, p_alert_id, v_user)
    on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    update public.incidents set updated_at = now() where id = p_incident_id;
    insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
      values (p_incident_id, 'alert_attached', p_alert_id::text, v_user, v_email);
    insert into public.audit_log(action, detail, user_id, user_email)
      values ('INCIDENT_ALERT_ATTACHED', p_incident_id::text || ' · alert=' || p_alert_id::text, v_user, v_email);
  end if;
  return p_incident_id;
end;
$$;

create or replace function public.attach_incident_face(p_incident_id uuid, p_face_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_recording uuid;
  v_added integer;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.incidents where id = p_incident_id) then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  select recording_id into v_recording from public.faces where id = p_face_id;
  if not found then raise exception 'face not found' using errcode = 'P0002'; end if;
  select email into v_email from public.profiles where id = v_user;
  insert into public.incident_faces(incident_id, face_id, added_by)
    values (p_incident_id, p_face_id, v_user)
    on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    update public.incidents set updated_at = now() where id = p_incident_id;
    insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
      values (p_incident_id, 'face_attached', p_face_id::text || coalesce(' · recording=' || v_recording::text, ''), v_user, v_email);
    insert into public.audit_log(action, detail, user_id, user_email)
      values ('INCIDENT_FACE_ATTACHED', p_incident_id::text || ' · face=' || p_face_id::text, v_user, v_email);
  end if;
  return p_incident_id;
end;
$$;

create or replace function public.search_faces_filtered(
  query_embedding extensions.vector(512),
  match_threshold double precision default 0.50,
  match_limit integer default 50,
  p_camera_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz,
  similarity double precision,
  recording_id uuid,
  camera_id uuid,
  recording_filename text,
  camera_name text,
  crop_sealed boolean
)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_catalog
as $$
begin
  if match_threshold < 0.30 or match_threshold > 0.95
     or match_limit < 1 or match_limit > 100
     or (p_from is not null and p_to is not null and p_from >= p_to) then
    raise exception 'invalid search filters' using errcode = '22023';
  end if;
  return query
    select f.id, f.filename, f.image_path, f.detected_at,
           (1 - (f.embedding <=> query_embedding))::double precision,
           case when r.id is null then null else f.recording_id end,
           f.camera_id, r.filename, c.name, f.crop_sealed
    from public.faces f
    left join public.recordings r on r.id = f.recording_id
    left join public.cameras c on c.id = f.camera_id
    where 1 - (f.embedding <=> query_embedding) > match_threshold
      and (p_camera_id is null or f.camera_id = p_camera_id)
      and (p_from is null or f.detected_at >= p_from)
      and (p_to is null or f.detected_at < p_to)
    order by f.embedding <=> query_embedding, f.detected_at desc, f.id
    limit match_limit;
end;
$$;

revoke all on function public.create_incident(text, text, text, uuid, uuid) from public, anon;
revoke all on function public.update_incident(uuid, timestamptz, text, text, text, text, uuid, text) from public, anon;
revoke all on function public.attach_incident_alert(uuid, uuid) from public, anon;
revoke all on function public.attach_incident_face(uuid, uuid) from public, anon;
revoke all on function public.search_faces_filtered(extensions.vector, double precision, integer, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_incident(text, text, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.update_incident(uuid, timestamptz, text, text, text, text, uuid, text) to authenticated, service_role;
grant execute on function public.attach_incident_alert(uuid, uuid) to authenticated, service_role;
grant execute on function public.attach_incident_face(uuid, uuid) to authenticated, service_role;
grant execute on function public.search_faces_filtered(extensions.vector, double precision, integer, uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on table public.incidents is 'Operator-owned cases that group alerts and face/recording evidence.';
comment on table public.incident_events is 'Append-only incident activity history written by incident RPCs.';
comment on function public.search_faces_filtered(extensions.vector, double precision, integer, uuid, timestamptz, timestamptz) is
  'Verified-admin face search. Camera/time filters run before the bounded similarity result limit.';
