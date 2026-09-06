-- faces_in_recording: expose crop_sealed + chain_index (ADR 0009 / Tier 3).
--
-- The playback page fetches every face of a recording through this RPC and
-- renders each crop with <FaceThumb>, which loads /api/faces/[id]/secure-crop.
-- Until now the client could not tell a sealed (encrypt-only) crop from a
-- legacy plaintext one without a second round-trip, so it could neither show
-- the seal indicator nor explain a 403 lock. Returning the two columns here
-- removes that probe: one RPC call carries everything the gallery needs.
--
-- A return-type change needs DROP + CREATE (CREATE OR REPLACE cannot alter
-- OUT columns). search_path and grants are re-applied because DROP resets
-- them. SECURITY INVOKER is kept on purpose: RLS on faces/recordings still
-- decides what the caller may see. PUBLIC previously kept its default EXECUTE
-- (only `anon` had been revoked explicitly, which is a no-op when the grant
-- comes through PUBLIC) — tightened to authenticated + service_role only.
drop function if exists public.faces_in_recording(uuid);

create function public.faces_in_recording(rec_id uuid)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz,
  time_in_video_sec real,
  bbox jsonb,
  crop_sealed boolean,
  chain_index integer
)
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
  select
    f.id,
    f.filename,
    f.image_path,
    f.detected_at,
    extract(epoch from (f.detected_at - r.started_at))::real as time_in_video_sec,
    f.bbox,
    f.crop_sealed,
    f.chain_index
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

revoke execute on function public.faces_in_recording(uuid) from public, anon;
grant execute on function public.faces_in_recording(uuid) to authenticated, service_role;

comment on function public.faces_in_recording(uuid) is
  'Faces detected in a recording with time offset, bbox and seal state (crop_sealed/chain_index, ADR 0009). SECURITY INVOKER — RLS applies.';
