-- Paginated, server-side face search.
--
-- The original filtered search applied camera/time filters before its limit,
-- but could only return the first result set.  Keep that RPC intact for
-- rolling deploy compatibility and expose a new page-aware RPC for clients
-- that need to continue through larger archives.

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
    select f.id, f.filename, f.image_path, f.detected_at,
           (1 - (f.embedding OPERATOR(extensions.<=>) query_embedding))::double precision,
           case when r.id is null then null else f.recording_id end,
           f.camera_id, r.filename, c.name, f.crop_sealed
    from public.faces f
    left join public.recordings r on r.id = f.recording_id
    left join public.cameras c on c.id = f.camera_id
    where 1 - (f.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
      and (p_camera_id is null or f.camera_id = p_camera_id)
      and (p_from is null or f.detected_at >= p_from)
      and (p_to is null or f.detected_at < p_to)
    order by f.embedding OPERATOR(extensions.<=>) query_embedding, f.detected_at desc, f.id
    offset p_offset
    limit p_limit;
end;
$$;

revoke all on function public.search_faces_filtered_page(
  extensions.vector, double precision, integer, integer, uuid, timestamptz, timestamptz
) from public, anon;
grant execute on function public.search_faces_filtered_page(
  extensions.vector, double precision, integer, integer, uuid, timestamptz, timestamptz
) to authenticated, service_role;

comment on function public.search_faces_filtered_page(
  extensions.vector, double precision, integer, integer, uuid, timestamptz, timestamptz
) is 'Verified-admin face search with camera/time filters and a bounded archive offset.';
