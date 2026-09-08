-- ═══════════════════════════════════════════════════════════════════════════
-- Storage: per-bucket policies replace the blanket admin "all buckets" grant
-- (audit 2026-09-08 §4.2)
--
-- WHAT / WHY
--   `storage: admin all-buckets all` was one permissive FOR ALL policy —
--   USING private.is_admin() — over every bucket. Only `revealed` was fenced
--   off (restrictive policy, 20260907100000). That grant sits *around* the
--   crop authority gate: an admin whose reveal_level is too narrow to see a
--   face at /api/faces/[id]/secure-crop (403) can download the same plaintext
--   crop straight from the `faces` bucket with the access token their browser
--   already holds — no authority check, no audit row. 47 legacy plaintext
--   crops (48 objects, 1 of them sealed .enc) are at rest in that bucket now.
--
--   This migration keeps exactly the access the application actually uses and
--   removes the rest. `authenticated` is the only role affected: service_role
--   has BYPASSRLS (verified: pg_roles.rolbypassrls = true), and every server
--   route that must reach a bucket regardless of the caller's authority uses
--   createServiceClient() / the ML service's SUPABASE_SERVICE_ROLE_KEY.
--
-- MODEL AFTER THIS MIGRATION (role `authenticated`)
--   faces             — NO direct access. Crops are served only through
--                       /api/faces/[id]/secure-crop (authority gate + audit).
--                       Restrictive fence mirrors the `revealed` one so a
--                       future stray permissive policy cannot re-open it.
--   revealed          — NO direct access (restrictive fence, 20260907100000).
--   recordings        — operator (admin|viewer) SELECT, permission-aware, and
--                       only the baked playback artifact `storage_path`. The
--                       encrypted original is reached solely by the ML service.
--   suspects          — admin read/write/delete. The /suspects pages sign,
--                       upload and remove enrolment photos with the
--                       *user-scoped* client, so a policy is required here.
--   alert-screenshots — admin SELECT (suspect detail page signs user-scoped).
--   branding          — UNCHANGED. Public read of logo.png / logo-text.svg /
--                       favicon.png / apple-icon.png (branding_public_read)
--                       plus branding_admin_write|update|delete. Deliberately
--                       not touched: the bucket is public, the four-file
--                       allow-list is the control, and re-creating those
--                       policies would risk the landing page for no gain.
--
-- INVENTORY THAT MAKES THIS SAFE — every storage call site in the repo
--   user-scoped client (these NEED a policy; all are admin-gated pages except
--   playback, which is admin|viewer — auditor is blocked by middleware):
--     app/(app)/suspects/page.tsx:26           suspects           createSignedUrl
--     app/(app)/suspects/[id]/page.tsx:53      suspects           createSignedUrl
--     app/(app)/suspects/[id]/page.tsx:103     alert-screenshots  createSignedUrl
--     app/(app)/suspects/actions.ts:57         suspects           upload
--     app/(app)/suspects/actions.ts:77,113     suspects           remove
--     app/(app)/playback/[id]/page.tsx:65      recordings         createSignedUrl(storage_path)
--     app/api/health/storage/route.ts:11       (storage.buckets listBuckets — not objects)
--   service-role client (BYPASSRLS — unaffected by anything below):
--     app/api/faces/[id]/secure-crop/route.ts:66   faces      download
--     app/api/reveal/[jobId]/output/route.ts:15    revealed   createSignedUrl
--     lib/retention.ts:63                          recordings|faces|revealed remove
--     ml-service/storage.py:499 upload_bytes, reveal_job.py:186 download
--       (recordings, faces, revealed — SUPABASE_SERVICE_ROLE_KEY only)
--   No browser is ever handed a bucket URL for a face: components/face-thumb.tsx
--   renders /api/faces/{id}/secure-crop, and app/wall/page.tsx passes face ids,
--   never paths. No code constructs /storage/v1/object/... URLs by hand.
--
-- BLAST RADIUS
--   Five real accounts (3 admin incl. super admin, 1 viewer, 1 auditor).
--   Nothing that works today should change:
--     • playback (baked) keeps its signed URL — same predicate, now scoped to
--       `authenticated` and to storage_path;
--     • suspect photos + alert screenshots keep working for admins;
--     • face crops already flow only through the gateway;
--     • reveal output already flows only through /api/reveal/[jobId]/output.
--   If this inventory is wrong, the failure is a MISSING IMAGE, never a
--   lockout: createSignedUrl returns null and the page renders its
--   placeholder; suspect photo upload returns UPLOAD_FAILED. The console,
--   login, TOTP and every table stay reachable — no policy here touches a
--   public.* table. The operator notices as (a) a broken thumbnail on
--   /suspects or /playback, or (b) `403 new row violates row-level security`
--   in the Vercel log for a suspects upload. Paste the ROLLBACK below and the
--   old behaviour is back in one statement, with no deploy.
--   Retention, backups, the ML pipeline and reveal are service_role: they
--   cannot be affected by any policy in this file.
--
-- KILL SWITCH / ROLLBACK (paste as the DB owner — restores pre-migration
-- behaviour exactly, including the blanket admin grant):
--
--   drop policy if exists "storage: faces are gateway only"        on storage.objects;
--   drop policy if exists "storage: admin suspects"                on storage.objects;
--   drop policy if exists "storage: admin read alert screenshots"  on storage.objects;
--   drop policy if exists "storage: operator read recordings (permission aware)"
--     on storage.objects;
--   create policy "storage: operator read recordings (permission aware)"
--     on storage.objects for select using (
--       bucket_id = 'recordings'
--       and private.is_operator()
--       and exists (
--         select 1 from public.recordings r
--         where (r.storage_path = storage.objects.name or r.original_path = storage.objects.name)
--           and private.user_can_see_camera(r.camera_id)));
--   create policy "storage: admin all-buckets all" on storage.objects
--     for all using (private.is_admin());
--
--   Narrower kill switch — reopen ONLY the faces bucket (e.g. to run a
--   one-off sealing job from a browser session) without restoring the
--   blanket grant:
--     drop policy if exists "storage: faces are gateway only" on storage.objects;
--     create policy "storage: admin faces" on storage.objects
--       for all to authenticated
--       using (bucket_id = 'faces' and private.is_admin())
--       with check (bucket_id = 'faces' and private.is_admin());
--   Remember to drop "storage: admin faces" and re-create the fence after.
--
-- safety: ok — policy-only change, no schema/data mutation. Replacements are
-- created before the blanket policy is dropped, so no window exists in which
-- an admin has less access than intended; the whole file is one transaction.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. recordings — operator read, permission-aware, playback artifact only ──
-- Same predicate as 20260906130100 with two narrowings:
--   • scoped `to authenticated` (anon can no longer reach private.is_operator(),
--     which is revoked from anon and would raise instead of denying);
--   • `original_path` dropped: the encrypted original is never signed for a
--     browser (an AES-GCM blob cannot be played by <video> anyway). Playback
--     of on_demand recordings goes through /api/recordings/[id]/view → ML.
drop policy if exists "storage: operator read recordings (permission aware)" on storage.objects;
create policy "storage: operator read recordings (permission aware)" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recordings'
    and private.is_operator()
    and exists (
      select 1 from public.recordings r
      where r.storage_path = storage.objects.name
        and private.user_can_see_camera(r.camera_id)
    )
  );

-- ── 2. suspects — admin only (user-scoped client signs, uploads and removes) ──
-- Enrolment photos, not surveillance output: the /suspects pages are
-- requireAdmin() + fresh-reauth for writes. Keeping this bucket reachable by
-- the user-scoped client is what stops the suspects UI from silently losing
-- its photos; see notes for the follow-up that would close it entirely.
drop policy if exists "storage: admin suspects" on storage.objects;
create policy "storage: admin suspects" on storage.objects
  for all to authenticated
  using (bucket_id = 'suspects' and private.is_admin())
  with check (bucket_id = 'suspects' and private.is_admin());

-- ── 3. alert-screenshots — admin read only ──
-- Written by the ML service (service_role); read by /suspects/[id] with the
-- user-scoped client. No authenticated write path exists, so none is granted.
drop policy if exists "storage: admin read alert screenshots" on storage.objects;
create policy "storage: admin read alert screenshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'alert-screenshots' and private.is_admin());

-- ── 4. faces — no direct access, fenced like `revealed` ──
-- Restrictive policies AND with everything else, so this survives any future
-- permissive policy (including a re-added blanket grant): the crop gateway
-- stays the only way to a face, and its reveal_level check plus its audit row
-- cannot be stepped around with a raw access token.
drop policy if exists "storage: faces are gateway only" on storage.objects;
create policy "storage: faces are gateway only" on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'faces')
  with check (bucket_id <> 'faces');

-- ── 5. Drop the blanket grant ──
-- Everything the app actually does now has its own policy above; `revealed`
-- and `faces` have none by design; `branding` keeps its own four policies.
drop policy if exists "storage: admin all-buckets all" on storage.objects;

-- ─── Second factor also applies to Storage (audit 4.1 hand-off) ────────────
-- Every policy above keys on private.is_admin() / private.is_operator(), which
-- a raw grant_type=password token satisfies. Without this fence an admin whose
-- password leaked could still list and sign objects in `suspects` (enrolment
-- photos) or `alert-screenshots` with a token that never presented TOTP.
-- Restrictive, so it ANDs with everything above and rolls back with one DROP.
-- Requires migration 20260908110000 (private.mfa_ok), which sorts first.
DROP POLICY IF EXISTS "storage: second factor required" ON storage.objects;
CREATE POLICY "storage: second factor required" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));
