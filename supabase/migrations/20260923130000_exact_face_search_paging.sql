-- Exact, index-independent ordering for the paginated face-search RPCs.
--
-- Both page RPCs ordered by `embedding <=> query_embedding` with OFFSET/LIMIT.
-- Once the planner prefers faces_embedding_idx (HNSW) for that ORDER BY, the
-- index hands back at most hnsw.ef_search (40) candidates and the WHERE
-- filters run afterwards: page 2 comes back empty and filtered searches
-- silently return fewer rows than exist.  Reproduced on production with
-- enable_seqscan=off: 42 matching faces, 40 returned.
--
-- A forensic search must be exact, so the filtered candidate set is now
-- MATERIALIZED first and ordered afterwards by the precomputed distance.  The
-- ORDER BY no longer matches an index expression, so the HNSW index can never
-- serve (and truncate) it; the threshold predicate already forced a full
-- distance computation per row, so the cost is unchanged.
--
-- Signatures, return columns, filters, validation, grants and comments are
-- unchanged: this is a body-only replacement and the app needs no deploy.

create or replace function public.search_faces_filtered_page(
  query_embedding extensions.vector(512),
  match_threshold double precision default 0.50,
  p_limit integer default 51,
  p_offset integer default 0,
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
     or p_limit < 1 or p_limit > 101
     or p_offset < 0 or p_offset > 10000
     or (p_from is not null and p_to is not null and p_from >= p_to) then
    raise exception 'invalid search filters' using errcode = '22023';
  end if;

  return query
    with candidates as materialized (
      select f.id as face_id, f.filename as face_filename, f.image_path as face_image_path,
             f.detected_at as face_detected_at,
             (f.embedding OPERATOR(extensions.<=>) query_embedding)::double precision as distance,
             case when r.id is null then null else f.recording_id end as face_recording_id,
             f.camera_id as face_camera_id, r.filename as rec_filename, c.name as cam_name,
             f.crop_sealed as face_crop_sealed
      from public.faces f
      left join public.recordings r on r.id = f.recording_id
      left join public.cameras c on c.id = f.camera_id
      where 1 - (f.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
        and (p_camera_id is null or f.camera_id = p_camera_id)
        and (p_from is null or f.detected_at >= p_from)
        and (p_to is null or f.detected_at < p_to)
    )
    select cand.face_id, cand.face_filename, cand.face_image_path, cand.face_detected_at,
           1 - cand.distance,
           cand.face_recording_id, cand.face_camera_id, cand.rec_filename, cand.cam_name,
           cand.face_crop_sealed
    from candidates cand
    order by cand.distance, cand.face_detected_at desc, cand.face_id
    offset p_offset
    limit p_limit;
end;
$$;

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
    with candidates as materialized (
      select f.id as face_id, f.filename as face_filename, f.image_path as face_image_path,
             f.detected_at as face_detected_at, f.detection_confidence as face_confidence,
             (f.embedding OPERATOR(extensions.<=>) query_embedding)::double precision as distance,
             case when r.id is null then null else f.recording_id end as face_recording_id,
             r.capture_status as rec_status,
             f.camera_id as face_camera_id, r.filename as rec_filename, c.name as cam_name,
             f.crop_sealed as face_crop_sealed,
             matched.suspect_id as match_suspect_id, matched.suspect_name as match_suspect_name
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
    )
    select cand.face_id, cand.face_filename, cand.face_image_path, cand.face_detected_at,
           cand.face_confidence, 1 - cand.distance,
           cand.face_recording_id, cand.rec_status, cand.face_camera_id, cand.rec_filename,
           cand.cam_name, cand.face_crop_sealed, cand.match_suspect_id, cand.match_suspect_name
    from candidates cand
    order by cand.distance, cand.face_detected_at desc, cand.face_id
    offset p_offset
    limit p_limit;
end;
$$;
