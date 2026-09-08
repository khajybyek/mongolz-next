-- ============================================================================
-- Prove the second factor at the data tier (audit 2026-09-08, finding 4.1)
-- ============================================================================
--
-- WHAT THIS FIXES
-- ---------------
-- Until now TOTP was enforced only inside the Next.js tier. Anyone holding an
-- admin password could skip aicctv.dev entirely: POST the project's public
-- GoTrue endpoint
--     https://<ref>.supabase.co/auth/v1/token?grant_type=password
-- with the anon key that ships in every browser bundle, receive a normal
-- access token, and then read *and write* faces / alerts / cameras /
-- recordings / suspects through PostgREST. The RLS policies only asked
-- `private.is_admin()` -> `profiles.role`, so TOTP, the session pin, step-up
-- reauth and the 4-eyes reveal were all bypassed, and nothing was audited.
--
-- The fix uses a fact that is already true of every token this project mints:
-- Supabase records the authentication methods of a session in
-- `auth.mfa_amr_claims` and carries them in the access token's `amr` claim.
-- The app never finishes a login for a TOTP user with a password grant — it
-- signs the user out after the password step and mints the real session with
-- `admin.generateLink` + `verifyOtp` (app/login/actions.ts). So:
--
--     app login of a TOTP user  -> amr = [{"method":"otp", ...}]
--     raw password grant        -> amr = [{"method":"password", ...}]
--
-- Live evidence at the time of writing (read-only queries against the
-- project): amr `otp` = 3 sessions, all belonging to TOTP-enabled admins,
-- newest 2026-09-08; amr `password` = 3 sessions — the auditor and the viewer
-- (neither has TOTP) plus one dormant 2026-05-18 admin session that has never
-- been refreshed. That dormant session is exactly the shape this control is
-- meant to refuse.
--
-- HOW
-- ---
-- 1. `private.mfa_ok()` answers "did this caller present something other than
--    a password?" and is deliberately generous:
--       * no TOTP on the profile          -> true  (viewer / auditor unaffected)
--       * no readable `amr` claim         -> true  (fail open: cannot determine)
--       * any entry whose method != password -> true (otp / magiclink / webauthn
--                                              / native Supabase MFA)
--       * service_role / direct SQL / cron -> true
--       * false ONLY when the profile has TOTP enabled AND the amr array is
--         readable AND *every* entry is `password`.
-- 2. The gate is attached as a RESTRICTIVE policy per table instead of being
--    edited into the existing USING clauses. Restrictive policies are ANDed
--    with the permissive ones by Postgres, so every existing condition is
--    preserved byte-for-byte and there is no chance of dropping a term while
--    retyping a policy. It also makes the rollback a single DROP per table.
-- 3. `public.mfa_status()` is a read-only diagnostic so an operator can prove
--    from a real session whether the `amr` claim is present, without a deploy.
--
-- BLAST RADIUS
-- ------------
-- Applies to the `authenticated` role only, on 10 tables:
--   faces, alerts, recordings, cameras, suspects, clusters, reveal_jobs,
--   audit_log, webhooks, camera_sessions.
-- * service_role (the app's server code, the ML service, cron) is untouched —
--   it bypasses RLS and `mfa_ok()` returns true for it anyway.
-- * anon is untouched — it has no permissive policy on these tables already.
-- * profiles is deliberately NOT gated: middleware and every auth helper read
--   it with the user's own token to bootstrap a session and to discover that
--   TOTP is required in the first place. Gating it would deadlock login.
-- * The auth-flow tables (totp_used_codes, webauthn_challenges,
--   webauthn_credentials, push_subscriptions) are NOT gated for the same
--   reason: they are read while the second factor is still being decided.
-- * Config-only tables (alert_rules, camera_permissions, masking_schedules,
--   privacy_zones, retention_policies) are NOT gated — they hold no personal
--   data. They remain admin-only through their existing policies.
-- * Of the six live sessions, exactly one is refused: the dormant 2026-05-18
--   admin password session. Every session in daily use was minted with `otp`.
-- * Enrolment caveat: an admin who turns TOTP on keeps a password-only
--   session until they sign out. /settings keeps working (profiles is not
--   gated) but the rest of the console will read empty until they log in
--   again. The app should sign the user out after enabling TOTP — see the
--   ADR; it is a separate change.
--
-- KILL SWITCH (no deploy, one statement, effective immediately)
-- ------------------------------------------------------------
--   update private.security_settings
--      set mfa_required = false,
--          updated_at   = now(),
--          updated_by   = 'incident <ref> — <who>';
-- Re-arm with `set mfa_required = true`. `private.mfa_ok()` reads this row on
-- every call, and returns true (allow everything) if the row says so, if the
-- table is missing, or if it cannot be read at all.
--
-- ROLLBACK (paste as-is, as postgres/service_role)
-- ------------------------------------------------
--   drop policy if exists "faces: second factor required"           on public.faces;
--   drop policy if exists "alerts: second factor required"          on public.alerts;
--   drop policy if exists "recordings: second factor required"      on public.recordings;
--   drop policy if exists "cameras: second factor required"         on public.cameras;
--   drop policy if exists "suspects: second factor required"        on public.suspects;
--   drop policy if exists "clusters: second factor required"        on public.clusters;
--   drop policy if exists "reveal_jobs: second factor required"     on public.reveal_jobs;
--   drop policy if exists "audit_log: second factor required"       on public.audit_log;
--   drop policy if exists "webhooks: second factor required"        on public.webhooks;
--   drop policy if exists "camera_sessions: second factor required" on public.camera_sessions;
--   drop function if exists public.mfa_status();
--   drop function if exists private.mfa_ok();
--   drop table if exists private.security_settings;
-- (Dropping the policies alone restores the previous behaviour; the last three
-- statements are only needed to remove the objects entirely. Prefer the kill
-- switch above during an incident — it is instant and reversible.)
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- A session that already passed TOTP is still a bearer token: whoever holds
-- it has what it grants. This closes the password-only path into PostgREST,
-- not token theft. See docs/adr/0011-mfa-at-the-data-tier.md.
-- ============================================================================

-- ─── 1. Kill switch ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.security_settings (
  id           boolean PRIMARY KEY DEFAULT true,
  mfa_required boolean     NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  CONSTRAINT security_settings_singleton CHECK (id)
);

INSERT INTO private.security_settings (id, mfa_required, updated_by)
VALUES (true, true, 'migration 20260908110000')
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE private.security_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE private.security_settings TO service_role;

COMMENT ON TABLE private.security_settings IS
  'Single-row operational switches. mfa_required=false disables private.mfa_ok() '
  'enforcement instantly, without a deploy. Service-role/postgres only.';

-- ─── 2. The helper ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.mfa_ok()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $fn$
DECLARE
  v_claims    jsonb;
  v_uid       uuid;
  v_totp      boolean;
  v_amr       jsonb;
  v_entries   integer;
  v_passwords integer;
BEGIN
  -- (a) Kill switch. Unreadable or missing -> allow.
  BEGIN
    IF EXISTS (
      SELECT 1 FROM private.security_settings
      WHERE id AND mfa_required IS NOT TRUE
    ) THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;

  -- (b) Claims, read through Supabase's own accessor so that both GUC
  --     spellings (request.jwt.claim / request.jwt.claims) are covered.
  --     No claims at all = direct SQL / cron / postgres -> allow.
  BEGIN
    v_claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    RETURN true;                       -- malformed/unavailable -> cannot determine
  END;
  IF v_claims IS NULL OR jsonb_typeof(v_claims) <> 'object' THEN
    RETURN true;
  END IF;

  -- (c) Trusted server roles always pass (they bypass RLS anyway; this keeps
  --     the helper honest if it is ever called directly by server code).
  IF coalesce(v_claims->>'role', '') IN ('service_role', 'supabase_admin') THEN
    RETURN true;
  END IF;

  -- (d) Which user? No readable subject -> cannot determine -> allow.
  BEGIN
    v_uid := nullif(v_claims->>'sub', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;
  IF v_uid IS NULL THEN
    RETURN true;
  END IF;

  -- (e) No TOTP on this profile (viewer, auditor, not-yet-enrolled admin,
  --     missing profile) -> nothing to prove.
  SELECT p.totp_enabled INTO v_totp FROM public.profiles p WHERE p.id = v_uid;
  IF coalesce(v_totp, false) IS NOT TRUE THEN
    RETURN true;
  END IF;

  -- (f) Read the amr claim. Absent, null or not an array -> cannot determine.
  v_amr := v_claims->'amr';
  IF v_amr IS NULL OR jsonb_typeof(v_amr) <> 'array' THEN
    RETURN true;
  END IF;

  -- (g) Refuse only when every readable entry says "password". An entry we
  --     cannot interpret counts as "not password", i.e. it fails open.
  SELECT count(*),
         count(*) FILTER (
           WHERE CASE jsonb_typeof(e)
                   WHEN 'object' THEN e->>'method'
                   WHEN 'string' THEN e #>> '{}'
                   ELSE NULL
                 END = 'password'
         )
    INTO v_entries, v_passwords
    FROM jsonb_array_elements(v_amr) AS e;

  RETURN NOT (v_entries > 0 AND v_passwords = v_entries);
END;
$fn$;

REVOKE ALL ON FUNCTION private.mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mfa_ok() TO authenticated, service_role;

COMMENT ON FUNCTION private.mfa_ok() IS
  'True unless the caller has TOTP enabled and their token proves nothing but a '
  'password (amr = [password]). Fails open on anything it cannot determine. '
  'Kill switch: update private.security_settings set mfa_required = false.';

-- ─── 3. Operator diagnostic ─────────────────────────────────────────────────
-- Exposed through PostgREST as /rest/v1/rpc/mfa_status so the operator can
-- prove, from a real browser session, that access tokens really do carry the
-- amr claim (if they ever stopped carrying it this control would silently
-- become a no-op). Returns only the caller's own authentication methods —
-- no personal data, nothing the caller's own token does not already contain.
CREATE OR REPLACE FUNCTION public.mfa_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private, pg_catalog
AS $fn$
  SELECT jsonb_build_object(
    'amr_present', (auth.jwt() ? 'amr'),
    'methods',     coalesce(
                     (SELECT jsonb_agg(
                        CASE jsonb_typeof(e)
                          WHEN 'object' THEN e->>'method'
                          WHEN 'string' THEN e #>> '{}'
                          ELSE jsonb_typeof(e)
                        END)
                      FROM jsonb_array_elements(
                             CASE WHEN jsonb_typeof(auth.jwt()->'amr') = 'array'
                                  THEN auth.jwt()->'amr' ELSE '[]'::jsonb END) AS e),
                     '[]'::jsonb),
    'aal',         auth.jwt()->>'aal',
    'mfa_ok',      private.mfa_ok()
  );
$fn$;

REVOKE ALL ON FUNCTION public.mfa_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_status() TO authenticated, service_role;

COMMENT ON FUNCTION public.mfa_status() IS
  'Diagnostic: what the caller''s own access token proves (amr methods, aal) and '
  'whether private.mfa_ok() accepts it. No personal data.';

-- ─── 4. Attach the gate ─────────────────────────────────────────────────────
-- RESTRICTIVE policies are ANDed with the existing permissive policies, so
-- every condition already in place (private.is_admin(), private.is_operator()
-- AND private.user_can_see_camera(...), private.can_read_reveal_level(...),
-- private.is_admin_or_auditor()) is preserved exactly as it is.
-- `(SELECT private.mfa_ok())` is wrapped so Postgres evaluates it once per
-- statement as an InitPlan instead of once per row.

DROP POLICY IF EXISTS "faces: second factor required" ON public.faces;
CREATE POLICY "faces: second factor required" ON public.faces
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "alerts: second factor required" ON public.alerts;
CREATE POLICY "alerts: second factor required" ON public.alerts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "recordings: second factor required" ON public.recordings;
CREATE POLICY "recordings: second factor required" ON public.recordings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "cameras: second factor required" ON public.cameras;
CREATE POLICY "cameras: second factor required" ON public.cameras
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "suspects: second factor required" ON public.suspects;
CREATE POLICY "suspects: second factor required" ON public.suspects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "clusters: second factor required" ON public.clusters;
CREATE POLICY "clusters: second factor required" ON public.clusters
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "reveal_jobs: second factor required" ON public.reveal_jobs;
CREATE POLICY "reveal_jobs: second factor required" ON public.reveal_jobs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "audit_log: second factor required" ON public.audit_log;
CREATE POLICY "audit_log: second factor required" ON public.audit_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "webhooks: second factor required" ON public.webhooks;
CREATE POLICY "webhooks: second factor required" ON public.webhooks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "camera_sessions: second factor required" ON public.camera_sessions;
CREATE POLICY "camera_sessions: second factor required" ON public.camera_sessions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));


-- ─── Admin-writable configuration (review finding, same batch) ─────────────
-- These hold no personal data, which is why they were left out at first — but
-- they are WRITABLE by exactly the token this migration refuses, and a write
-- here destroys the data the ten policies above protect: a retention_policies
-- row with retain_days = 0 makes the nightly sweep delete every recording and
-- face. Gate the writes too.
DROP POLICY IF EXISTS "retention_policies: second factor required" ON public.retention_policies;
CREATE POLICY "retention_policies: second factor required" ON public.retention_policies
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "alert_rules: second factor required" ON public.alert_rules;
CREATE POLICY "alert_rules: second factor required" ON public.alert_rules
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "privacy_zones: second factor required" ON public.privacy_zones;
CREATE POLICY "privacy_zones: second factor required" ON public.privacy_zones
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "masking_schedules: second factor required" ON public.masking_schedules;
CREATE POLICY "masking_schedules: second factor required" ON public.masking_schedules
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));

DROP POLICY IF EXISTS "camera_permissions: second factor required" ON public.camera_permissions;
CREATE POLICY "camera_permissions: second factor required" ON public.camera_permissions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.mfa_ok())) WITH CHECK ((SELECT private.mfa_ok()));
