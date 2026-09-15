-- Run against an isolated local database with all migrations applied.
begin;
do $$
declare
  v_camera uuid := gen_random_uuid();
  v_recording uuid := gen_random_uuid();
  v_incident uuid := gen_random_uuid();
  v_evidence uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
begin
  insert into public.cameras(id,name,url,cam_type)
    values (v_camera,'Evidence fixture','demo://evidence-fixture','demo');
  insert into public.recordings(
    id,filename,storage_path,duration_sec,camera_id,camera_name,started_at,capture_status
  ) values (
    v_recording,v_recording::text || '.mp4','fixture/' || v_recording::text || '.mp4',
    60,v_camera,'Evidence fixture',now()-interval '10 days','ready'
  );
  insert into public.incidents(id,title) values (v_incident,'Evidence fixture incident');
  insert into public.incident_recordings(
    id,incident_id,recording_id,recording_filename,camera_name,
    recording_started_at,clip_start_sec,clip_end_sec,legal_hold
  ) values (
    v_evidence,v_incident,v_recording,v_recording::text || '.mp4','Evidence fixture',
    now()-interval '10 days',2,12,true
  );

  begin
    delete from public.recordings where id=v_recording;
    raise exception 'direct delete bypassed legal hold';
  exception when object_not_in_prerequisite_state then null;
  end;
  update public.retention_policies
    set retention_days=1,enabled=true where resource='recordings';
  perform public.sweep_retention();
  if not exists (select 1 from public.recordings where id=v_recording) then
    raise exception 'retention deleted a held recording';
  end if;

  update public.incident_recordings set legal_hold=false where id=v_evidence;
  perform public.sweep_retention();
  if exists (select 1 from public.recordings where id=v_recording) then
    raise exception 'released recording did not return to retention';
  end if;
  if (select recording_id from public.incident_recordings where id=v_evidence) is not null then
    raise exception 'evidence snapshot did not survive source deletion';
  end if;

  insert into public.edge_agents(id,name,camera_id,version)
    values (v_agent,'Fixture edge',v_camera,'1.0.0');
  insert into public.edge_ingest_events(
    id,agent_id,camera_id,captured_at,payload_sha256,face_count
  ) values (
    v_event,v_agent,v_camera,now(),repeat('a',64),2
  );
  begin
    insert into public.edge_ingest_events(
      id,agent_id,camera_id,captured_at,payload_sha256,face_count
    ) values (v_event,v_agent,v_camera,now(),repeat('a',64),2);
    raise exception 'duplicate edge event was accepted';
  exception when unique_violation then null;
  end;
  update public.edge_ingest_events set received_at=now()-interval '10 days' where id=v_event;
  update public.retention_policies set retention_days=1,enabled=true where resource='edge_ingest_events';
  perform public.sweep_retention();
  if exists (select 1 from public.edge_ingest_events where id=v_event) then
    raise exception 'expired edge delivery metadata was not retained according to policy';
  end if;

  if has_table_privilege('authenticated','public.edge_agents','insert')
     or has_table_privilege('authenticated','public.edge_ingest_events','insert')
     or not has_table_privilege('authenticated','public.edge_agents','select') then
    raise exception 'edge table privileges are wrong';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.attach_incident_recording(uuid,uuid,numeric,numeric,text,boolean)',
    'execute'
  ) then
    raise exception 'admin evidence RPC is not callable by authenticated users';
  end if;
  raise notice 'Incident evidence + edge-agent SQL assertions passed';
end;
$$;
rollback;
