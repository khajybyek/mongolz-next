-- Run against an isolated local database with all migrations applied.
-- Regression for 20260923130000_exact_face_search_paging: with the HNSW index
-- forced (enable_seqscan off) the page RPCs used to stop at hnsw.ef_search (40)
-- rows, so page 2 came back empty. Every matching face must be reachable.
begin;
set local enable_seqscan = off;
do $$
declare
  v_camera uuid := gen_random_uuid();
  v_query extensions.vector(512) := array_fill(1::real, array[512])::extensions.vector;
  v_total integer := 60;
  v_first integer;
  v_second integer;
  v_overlap integer;
  v_advanced integer;
begin
  insert into public.cameras(id,name,url,cam_type)
    values (v_camera,'Search paging fixture','demo://search-paging-fixture','demo');
  for i in 1..v_total loop
    -- Every fixture face is close to the probe (cosine similarity > 0.95) but
    -- at a distinct distance, so the expected order is fully determined.
    insert into public.faces(filename,image_path,embedding,camera_id)
    values (
      'fixture-' || i || '.jpg',
      'fixture/' || i || '.jpg',
      (array[(1 + i * 0.1)::real] || array_fill(1::real, array[511]))::extensions.vector,
      v_camera
    );
  end loop;

  select count(*) into v_first
    from public.search_faces_filtered_page(v_query, 0.30, 101, 0, v_camera);
  if v_first <> v_total then
    raise exception 'filtered page returned % of % matching faces', v_first, v_total;
  end if;

  select count(*) into v_second
    from public.search_faces_filtered_page(v_query, 0.30, 40, 40, v_camera);
  if v_second <> v_total - 40 then
    raise exception 'second filtered page returned % rows, expected %', v_second, v_total - 40;
  end if;

  select count(*) into v_overlap
    from public.search_faces_filtered_page(v_query, 0.30, 40, 0, v_camera) p1
    join public.search_faces_filtered_page(v_query, 0.30, 40, 40, v_camera) p2 using (id);
  if v_overlap <> 0 then
    raise exception 'consecutive pages overlap by % rows', v_overlap;
  end if;

  select count(*) into v_advanced
    from public.search_faces_advanced_page(v_query, 0.30, 101, 0, v_camera);
  if v_advanced <> v_total then
    raise exception 'advanced page returned % of % matching faces', v_advanced, v_total;
  end if;

  if (select array_agg(filename order by ord)
        from (select filename, row_number() over () as ord
                from public.search_faces_advanced_page(v_query, 0.30, 3, 0, v_camera)) ranked)
     <> array['fixture-1.jpg','fixture-2.jpg','fixture-3.jpg'] then
    raise exception 'advanced page is not ordered by similarity';
  end if;
  raise notice 'Face search paging SQL: exact counts, disjoint pages and order passed';
end;
$$;
rollback;
