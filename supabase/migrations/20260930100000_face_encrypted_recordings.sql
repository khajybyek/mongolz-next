-- ============================================================================
-- Optional face-encrypted recording mode (2026-09-30, ADR 0013)
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
-- Standard recording (ADR 0002 + ADR 0010) stays the default and does not
-- change: an AES-256-GCM encrypted whole original (`*_original.mp4.enc`,
-- recordings.original_path) plus a masked view rendered on demand. Legacy
-- `baked` rows keep working.
--
-- A camera can now opt into `face_encrypted` recording. Its new segments store
--   * NO raw original at all (recordings.original_path stays NULL);
--   * one masked video (recordings.storage_path) in which every detected face
--     is replaced by a keyed cipher pattern, encrypted at rest with the
--     per-recording key;
--   * one sealed FACE ENVELOPE per segment (recordings.face_envelope_path, same
--     `recordings` bucket): every face region of every frame, sealed with
--     AES-256-GCM under the per-face hash-chain key K_i of ADR 0009, with AAD
--     binding recording_id + track_id + frame_index.
-- An approved reveal (4-eyes, ADR 0003) unseals only the selected person's
-- blobs; every other face stays ciphertext, even inside the ML process.
--
-- 1. cameras.recording_mode  standard | face_encrypted, default standard.
--    Written ONLY by the service role, like the rest of `cameras`
--    (20260917150000 revoked every user-token write). The web action treats
--    standard -> face_encrypted as tightening (one click, audited) and
--    face_encrypted -> standard as loosening (TOTP step-up, audit, security
--    event). The mode applies to NEW segments; the ML service reads it with its
--    cached camera read (<= 30 s to take effect).
-- 2. recordings.blur_strategy gains 'face_encrypted' (the CHECK keeps its name
--    recordings_blur_strategy_check and only widens).
-- 3. recordings.face_envelope_path  text, NULL unless face_encrypted. Three
--    CHECKs keep the row honest with the capture placeholder flow (the ML
--    inserts the row as capture_status = 'capturing' with blur_strategy
--    already set, and flips it to 'ready' in ONE update that also carries the
--    envelope path):
--      recordings_face_envelope_path_check
--        an envelope path only on a face_encrypted row, never '' and never the
--        playback artifact itself (storage_path is the one object the
--        recordings storage policy lets a browser sign — the envelope must not
--        be reachable that way);
--      recordings_face_encrypted_ready_check
--        a face_encrypted row cannot be 'ready' without its envelope
--        ('capturing' / 'partial' / 'failed' may have none);
--      recordings_face_encrypted_no_original_check
--        a face_encrypted row never names an original: the whole point of the
--        mode is that no raw original exists.
-- 4. public.enqueue_retention_storage_deletion() also queues
--    face_envelope_path when a recording row is deleted (retention sweep,
--    GDPR erasure, manual delete; legal holds still block the delete itself),
--    so the sealed faces never outlive their row. Nothing else in SQL names
--    original_path: the recordings storage policy (20260908111000) signs only
--    storage_path and deliberately stays that way for the envelope.
--    A path that another recordings row still names is NOT queued: deleting
--    one row must never delete an object a surviving (for example legally
--    held) row points at. That lookup reads storage_path, original_path and
--    face_envelope_path of every OTHER row for every deleted row, so the
--    three columns get indexes (recordings_*_path_idx): without them each
--    deleted row costs full scans of recordings, and one day's sweep over a
--    month of 120 s segments on four cameras (2 880 of 89 280 rows) took
--    44–79 s instead of ~0.12 s in two local benchmarks — against the
--    retention cron's 60 s budget.
-- 5. No user-token INSERT on recordings. Until now `authenticated` kept the
--    default table INSERT grant and the policy "recordings: admin insert"
--    (20260515160724) was never dropped, so a stolen verified admin session
--    could insert a decoy row that names ANOTHER recording's objects (a held
--    face envelope, a held original) and let retention delete them — no
--    step-up, no audit row. Recordings rows are written only by the ML service
--    and the service-role scripts; no web code inserts them with a user token.
--    That hole predates this migration (it already reached storage_path and
--    original_path); it is closed here because the envelope is the only copy
--    of a face-encrypted recording's faces.
--
-- Grants: authenticated keeps SELECT only on cameras, and on recordings it
-- now has SELECT only as well (no INSERT from 5., no UPDATE / DELETE since
-- 20260917150000 and 20260928100000); the new columns inherit those table
-- grants. Existing rows validate immediately: every camera becomes
-- 'standard', every recording has a NULL envelope.
--
-- DEPLOY ORDER — MIGRATION -> ML -> WEB
-- -------------------------------------
--   1. `npx supabase db push --linked`, then `npm run gen:types`.
--   2. Deploy the ML service (`railway up --detach` from ml-service/).
--   3. Push the web app.
-- * The old ML and the old web never read or write anything added here, so
--   both keep working unchanged after step 1 (every camera is 'standard').
-- * The new ML must run only AFTER this migration: it writes
--   blur_strategy = 'face_encrypted' and face_envelope_path, which the old
--   schema refuses. It reads cameras.recording_mode in its own query
--   (storage.load_recording_mode via recording_mode.RecordingModeCache), NOT
--   in the privacy-schedule query, so privacy schedules (ADR 0012) are
--   unaffected either way. Without the column that read fails with 42703,
--   which means 'standard'. But a camera whose mode the new ML has never read
--   records face_encrypted (fail closed), and right after an ML deploy no
--   camera's mode has been read: a 42703 that arrives after the 2 s wait, or
--   any other failed first read, starts a face_encrypted segment (it rotates
--   to standard about a second after a successful answer; a failed read is
--   retried every 5 s). The old schema refuses that segment's rows, so it
--   waits in the ML spool, without faces rows, until the migration is
--   applied.
-- * The new web must come right after the ML: its camera dialog writes
--   recording_mode and the playback page selects face_envelope_path.
-- * Between steps 2 and 3 no admin can switch a camera to face_encrypted
--   (only the new web writes the column), but the fail-closed rule above can
--   still store a short face_encrypted segment of a standard camera while the
--   new ML boots with the database slow or unreachable. The old web cannot
--   play such a row (it signs storage_path, which is the encrypted masked
--   video); it plays once step 3 is done.
--
-- ROLLBACK
-- --------
-- Switch every camera back first (`update public.cameras set recording_mode =
-- 'standard';` with the service role) and keep the column, the CHECKs and the
-- trigger change until the last face_encrypted recording has expired: those
-- rows need face_envelope_path to be revealed and to be cleaned up by
-- retention.
-- ============================================================================

-- ─── 1. cameras.recording_mode ─────────────────────────────────────────────
alter table public.cameras
  add column if not exists recording_mode text not null default 'standard'
    constraint cameras_recording_mode_check
      check (recording_mode in ('standard', 'face_encrypted'));

comment on column public.cameras.recording_mode is
  'How NEW segments of this camera are stored. standard = encrypted whole original + '
  'masked view rendered on demand (ADR 0002/0010). face_encrypted = no raw original; an '
  'encrypted masked video with a keyed cipher pattern over every detected face, plus a '
  'sealed per-face envelope (ADR 0009 keys) so an approved reveal decrypts only the '
  'selected person (ADR 0013). Written only by the service role (TOTP step-up to loosen '
  'face_encrypted -> standard).';

-- ─── 2. recordings.blur_strategy gains face_encrypted ──────────────────────
-- safety: ok — replaces recordings_blur_strategy_check with a strictly wider
-- CHECK of the same name (adds 'face_encrypted'); every existing row is
-- 'baked' or 'on_demand' and validates immediately. DROP and ADD run in this
-- migration's single transaction, so no write can slip in between. The old ML
-- and web never write the new value.
alter table public.recordings
  drop constraint if exists recordings_blur_strategy_check;

alter table public.recordings
  add constraint recordings_blur_strategy_check
    check (blur_strategy in ('baked', 'on_demand', 'face_encrypted'));

comment on column public.recordings.blur_strategy is
  'How the masked playback view is produced. baked = blurred MP4 stored at storage_path '
  '(legacy). on_demand = rendered at view time from the encrypted original at '
  'original_path (ML GET /recording/{id}/view, ADR 0010). face_encrypted = no original; '
  'storage_path is the encrypted masked video (faces replaced by a keyed cipher pattern) '
  'and face_envelope_path holds the per-face sealed crops (ADR 0013).';

-- ─── 3. recordings.face_envelope_path ──────────────────────────────────────
alter table public.recordings
  add column if not exists face_envelope_path text;

alter table public.recordings
  add constraint recordings_face_envelope_path_check
    check (
      face_envelope_path is null
      or (blur_strategy = 'face_encrypted'
          and face_envelope_path <> ''
          and face_envelope_path <> storage_path)
    ),
  add constraint recordings_face_encrypted_ready_check
    check (
      blur_strategy <> 'face_encrypted'
      or capture_status <> 'ready'
      or face_envelope_path is not null
    ),
  add constraint recordings_face_encrypted_no_original_check
    check (blur_strategy <> 'face_encrypted' or original_path is null);

comment on column public.recordings.face_envelope_path is
  'face_encrypted only: storage path (recordings bucket) of the segment''s sealed face '
  'envelope — every face region of every frame, AES-256-GCM under the per-face hash-chain '
  'key K_i (ADR 0009), AAD bound to recording_id + track_id + frame_index; its track index '
  'is sealed with the per-recording key. NULL for standard/baked rows. Required once '
  'capture_status = ready. Never signed for a browser (the recordings storage policy '
  'allows storage_path only). Written only by the service role.';

-- ─── 4. Retention: the envelope goes with its row ──────────────────────────
-- Same function as 20260907101000 plus OLD.face_envelope_path. A plpgsql
-- record field is resolved when its branch runs, so the faces / reveal_jobs
-- branches never touch the new column. An object another recordings row
-- still names stays (AFTER DELETE: the deleted row is no longer visible, every
-- other row is); it is queued when the last row naming it goes.
create or replace function public.enqueue_retention_storage_deletion()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'recordings' then
    insert into public.retention_deletion_queue (bucket, object_path)
      select 'recordings', p
        from (values (old.storage_path), (old.original_path), (old.face_envelope_path)) paths(p)
       where p is not null and p <> ''
         and not exists (
           select 1 from public.recordings r
            where r.id <> old.id
              and (r.storage_path = p or r.original_path = p or r.face_envelope_path = p)
         )
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
  'original_path, face_envelope_path), face crop or reveal output in '
  'retention_deletion_queue inside the deleting transaction.';

-- The shared-path lookup above probes these three columns of every other
-- recordings row for every deleted row: with the indexes the OR becomes a
-- BitmapOr of index probes instead of full scans (retention sweeps, GDPR
-- erasure and bulk deletes of standard rows included). recordings is small
-- in production (tens of rows), so a plain CREATE INDEX inside this
-- migration's transaction is brief.
create index if not exists recordings_storage_path_idx
  on public.recordings (storage_path);
create index if not exists recordings_original_path_idx
  on public.recordings (original_path) where original_path is not null;
create index if not exists recordings_face_envelope_path_idx
  on public.recordings (face_envelope_path) where face_envelope_path is not null;

-- ─── 5. No user-token INSERT on recordings ─────────────────────────────────
-- Only the ML service and the service-role restore scripts create recordings
-- rows. The INSERT grant and the "recordings: admin insert" policy let a
-- stolen verified admin session plant a decoy row naming another recording's
-- objects (see header, 5.). Dropping a policy that no code path uses removes
-- nothing an application relies on; SELECT is unchanged.
revoke insert on public.recordings from anon, authenticated;
drop policy if exists "recordings: admin insert" on public.recordings;
