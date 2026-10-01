-- ============================================================================
-- Withdraw the optional face-encrypted recording mode (2026-10-01)
-- ============================================================================
--
-- WHY
-- ---
-- The owner withdrew the face_encrypted recording mode of
-- 20260930100000_face_encrypted_recordings (ADR 0013, now "Withdrawn").
-- It never reached a camera: production has 0 recordings with
-- blur_strategy = 'face_encrypted' and the only camera has
-- recording_mode = 'standard', so nothing stored depends on anything removed
-- here. Standard recording (ADR 0002 + ADR 0010: encrypted whole original +
-- masked view rendered on demand; legacy `baked` rows) is unchanged.
-- 20260930100000 stays in the history: migration files mirror the cloud
-- 1:1, so the withdrawal is this forward migration, not a deleted file.
--
-- WHAT IT REMOVES
-- ---------------
-- 1. The three face_encrypted CHECKs on recordings
--    (recordings_face_envelope_path_check,
--    recordings_face_encrypted_ready_check,
--    recordings_face_encrypted_no_original_check).
-- 2. recordings.face_envelope_path (and its index
--    recordings_face_envelope_path_idx).
-- 3. recordings_blur_strategy_check goes back to ('baked', 'on_demand'), its
--    definition from 20260528015324. A guard below refuses to run if any
--    face_encrypted recording exists (such a row would need its envelope to
--    be revealed and to be cleaned up by retention).
-- 4. cameras.recording_mode and its CHECK cameras_recording_mode_check.
-- 5. public.enqueue_retention_storage_deletion() gets back its exact body
--    from 20260907101000 (the definition before 20260930100000): a deleted
--    recording queues storage_path and original_path. The shared-path lookup
--    that 20260930100000 added ("never queue an object another recordings row
--    still names") goes with the feature: it guarded against a decoy row
--    naming a held recording's objects, which only a user token could insert
--    — and that INSERT stays revoked (see KEPT) — and the sealed envelope it
--    protected no longer exists. Owner, SECURITY DEFINER, search_path and the
--    revoked EXECUTE grants are as before (CREATE OR REPLACE keeps the owner;
--    the revoke is repeated). The function comment drops face_envelope_path.
-- 6. recordings_original_path_idx: it existed only for that lookup; nothing
--    else filters recordings by original_path (the ML reads it by id, and the
--    recordings storage policy signs storage_path only since 20260908111000).
--
-- KEPT (independent hardening, deliberately NOT reverted)
-- -------------------------------------------------------
-- * `revoke insert on public.recordings from anon, authenticated` and the
--   dropped policy "recordings: admin insert" (20260930100000 section 5).
--   Recordings rows are written only by the ML service and the service-role
--   scripts; a stolen verified admin session must not be able to insert a
--   decoy row naming another recording's objects and let retention delete
--   them. Nothing here grants INSERT back or re-creates that policy.
-- * recordings_storage_path_idx: the recordings storage policy
--   ("storage: operator read recordings (permission aware)", 20260908111000)
--   probes `recordings.storage_path = storage.objects.name` on every signed
--   playback read, so the index keeps serving that lookup.
-- * 20260930120000_super_admin_reveal_without_approval is untouched (it never
--   referenced anything removed here).
--
-- DEPLOY ORDER — ML + WEB FIRST, THEN THIS MIGRATION
-- --------------------------------------------------
--   1. Deploy the ML service (`railway up --detach` from ml-service/) and
--      push the web app. Both stop reading and writing recording_mode and
--      face_envelope_path, and neither writes blur_strategy = 'face_encrypted'.
--      They work against the schema with or without the columns.
--   2. `npx supabase db push --linked`, then `npm run gen:types`.
-- * Why not the other way round: the web deployed before step 1 selects
--   face_envelope_path on the playback pages and writes recording_mode from
--   the camera dialog; dropping the columns under it breaks those pages.
-- * The ML deployed before step 1 reads cameras.recording_mode in a query of
--   its own and treats "column does not exist" (42703) as standard, and it
--   reads face_envelope_path only for face_encrypted rows (none exist). But a
--   camera whose mode it has never read, after any other failed first read,
--   records face_encrypted (fail closed) — rows this schema refuses. So deploy
--   the ML first anyway.
--
-- ROLLBACK
-- --------
-- Re-apply the statements of 20260930100000 sections 1-4 (every column
-- starts empty / 'standard'), after redeploying the ML and web of commit
-- a549d02. The KEPT hardening needs no rollback.
-- ============================================================================

-- ─── Guard: nothing may depend on the mode ─────────────────────────────────
do $$
begin
  if exists (select 1 from public.recordings where blur_strategy = 'face_encrypted')
     or exists (select 1 from public.recordings where face_envelope_path is not null) then
    raise exception 'face_encrypted recordings still exist; they need face_envelope_path '
                    '(reveal, retention). Let them expire or delete them first.'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
end;
$$;

-- ─── 1. The three face_encrypted CHECKs on recordings ──────────────────────
-- safety: ok — the owner withdrew the face_encrypted mode (see header); the
-- guard above proves no row uses it, the ML and web deployed before this
-- migration no longer read or write these columns, and every statement runs
-- in this migration's single transaction.
alter table public.recordings
  drop constraint if exists recordings_face_envelope_path_check,
  drop constraint if exists recordings_face_encrypted_ready_check,
  drop constraint if exists recordings_face_encrypted_no_original_check;

-- ─── 2. recordings.face_envelope_path ──────────────────────────────────────
drop index if exists public.recordings_face_envelope_path_idx;
alter table public.recordings
  drop column if exists face_envelope_path;

-- ─── 3. recordings.blur_strategy back to baked | on_demand ─────────────────
-- Same CHECK as 20260528015324; every existing row is 'baked' or 'on_demand'
-- (the guard above) and validates immediately. DROP and ADD run in this
-- transaction, so no write can slip in between.
alter table public.recordings
  drop constraint if exists recordings_blur_strategy_check;

alter table public.recordings
  add constraint recordings_blur_strategy_check
    check (blur_strategy in ('baked', 'on_demand'));

comment on column public.recordings.blur_strategy is
  'How the masked playback view is produced. baked = blurred MP4 stored at storage_path '
  '(legacy). on_demand = rendered at view time from the encrypted original at '
  'original_path (ML GET /recording/{id}/view, ADR 0010).';

-- ─── 4. cameras.recording_mode ─────────────────────────────────────────────
alter table public.cameras
  drop constraint if exists cameras_recording_mode_check;
alter table public.cameras
  drop column if exists recording_mode;

-- ─── 5. Retention trigger function: the body from 20260907101000 ──────────
create or replace function public.enqueue_retention_storage_deletion()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'recordings' then
    insert into public.retention_deletion_queue (bucket, object_path)
      select 'recordings', p from (values (old.storage_path), (old.original_path)) paths(p)
      where p is not null and p <> ''
      on conflict (bucket, object_path) do nothing;
  elsif tg_table_name = 'faces' then
    if old.image_path is not null and old.image_path <> '' then
      insert into public.retention_deletion_queue (bucket, object_path)
        values ('faces', case when old.crop_sealed then old.image_path || '.enc' else old.image_path end)
        on conflict (bucket, object_path) do nothing;
    end if;
  elsif tg_table_name = 'reveal_jobs' then
    if old.output_path is not null and old.output_path <> '' then
      if tg_op = 'DELETE' or old.output_path is distinct from new.output_path then
        insert into public.retention_deletion_queue (bucket, object_path)
          values ('revealed', old.output_path)
          on conflict (bucket, object_path) do nothing;
      end if;
    end if;
  end if;
  return null; -- AFTER trigger; does not change the owning row
end;
$$;
revoke all on function public.enqueue_retention_storage_deletion() from public, anon, authenticated;

comment on function public.enqueue_retention_storage_deletion() is
  'AFTER trigger: queues the Storage objects of a deleted recording (storage_path, '
  'original_path), face crop or reveal output in retention_deletion_queue inside the '
  'deleting transaction.';

-- ─── 6. Indexes of the shared-path lookup ──────────────────────────────────
drop index if exists public.recordings_original_path_idx;

comment on index public.recordings_storage_path_idx is
  'Serves the recordings storage policy (storage: operator read recordings, 20260908111000), '
  'which probes recordings.storage_path = storage.objects.name on every signed playback read.';
