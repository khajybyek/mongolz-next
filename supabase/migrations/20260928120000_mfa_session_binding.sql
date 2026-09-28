-- ============================================================================
-- Bind the second factor to the SESSION, not to the way it was minted
-- (docs/RUNBOOK.md §5a item 2, 2026-09-17 review — OPEN, high)
-- ============================================================================
--
-- DEPLOY ORDER — WEB FIRST, THEN THIS MIGRATION
-- ---------------------------------------------
--   1. Deploy the web app (lib/auth/mfa-session.ts + the login / passkey /
--      session-loader changes) and wait for the Vercel deploy to be live.
--      Until this migration exists the new code finds no bind RPC
--      (PGRST202), logs it and finishes the login unbound; the loader finds
--      no mfa_session_bound RPC and signs nobody out.
--   2. `npx supabase db push --linked`, then `npm run gen:types`.
-- The reverse order blanks the console of every TOTP admin: the database
-- would refuse every session (nothing is bound yet) while the old web can
-- neither bind a new one nor send the admin back to /login.
-- WEB ROLLBACK: rolling the web back to a build older than this change
-- (Vercel Instant Rollback / promote-previous) while this migration is
-- applied reaches the same state — the old web mints unbound sessions and
-- never sends anyone back to /login, so signing in again does not help. Run
-- the binding kill switch FIRST (`update private.security_settings set
-- mfa_session_binding = false, updated_at = now(), updated_by = '<who>';`,
-- see KILL SWITCHES) and re-arm it after rolling forward again. Sessions
-- minted meanwhile are bound only if the new web minted them; the others are
-- signed out once (session_rebind) after re-arming.
-- The claude-analysis edge function gates on public.mfa_status() (the same
-- verdict); redeploy it with step 1 or any time after — it needs nothing
-- from this migration.
-- After step 2 every TOTP session that was minted before it — including the
-- ones minted by the new web between steps 1 and 2 — is unbound: the data
-- tier returns no rows for it and the web signs it out once
-- (/login?error=session_rebind, audit SESSION_REBIND_REQUIRED). Signing in
-- again mints a bound session. Viewers and auditors (no TOTP) see nothing.
--
-- WHAT THIS FIXES
-- ---------------
-- private.mfa_ok() (20260908110000) refuses only tokens whose amr is nothing
-- but `password`. Anyone who controls an admin's MAILBOX can ask GoTrue for
-- a session without the password or the TOTP seed:
--     POST https://<ref>.supabase.co/auth/v1/otp       {"email": "<admin>"}
--     POST https://<ref>.supabase.co/auth/v1/recover   {"email": "<admin>"}
-- (anon key from any page bundle), follow the mailed link, and hold a session
-- whose amr is otp / magiclink / recovery. That is exactly the shape the app
-- mints itself after a verified TOTP code or passkey — admin.generateLink +
-- verifyOtp in app/login/actions.ts and
-- app/api/auth/passkey/login/finish/route.ts — so mfa_ok() could not tell
-- them apart and the mailbox session read every gated table through
-- PostgREST, plus the SECURITY DEFINER RPCs that call mfa_ok().
--
-- HOW
-- ---
-- The app now records every session it mints AFTER a verified second factor
-- in private.mfa_sessions, through public.bind_mfa_session() (service_role
-- only; it runs on our server right after verifyOtp, with the session_id
-- claim read from the access token GoTrue just returned). mfa_ok() keeps
-- every branch it had and adds one: for a TOTP profile whose token carries a
-- readable session_id claim, that session must have a binding row. A mailbox
-- session has none, and no caller holding only a user token can create one.
--
--   * private.mfa_sessions.session_id REFERENCES auth.sessions(id)
--     ON DELETE CASCADE: the binding dies with the session (sign-out,
--     refresh-token reuse, session timebox, user deletion), so a signed-out
--     session's still-unexpired access token is refused as well.
--     Proven on a throwaway local project (CLI 2.95.4, Postgres 17) before
--     hand-off: `postgres` — the role `db push` uses — holds REFERENCES on
--     auth.sessions (owner supabase_auth_admin, the same grant shape that
--     lets public.profiles reference auth.users), the FK is created, and a
--     DELETE on auth.sessions / auth.users issued as supabase_auth_admin
--     (the role GoTrue writes with) cascades into private.mfa_sessions even
--     though that role has no privilege on schema private (referential
--     actions run as the referencing table's owner). If the cloud project
--     ever lacked the grant, this whole migration fails atomically and the
--     web keeps running unbound — the pre-migration state, not a lock-out.
--   * Missing or malformed session_id claim -> mfa_ok() fails OPEN, like
--     every other "cannot determine" branch. GoTrue writes session_id into
--     every access token it issues for a user session and the claim is
--     covered by the signature; only hand-built claims (direct SQL, tests)
--     reach that branch. public.mfa_status() now reports
--     `session_id_present` so an operator can prove the claim is there.
--   * public.mfa_session_bound(session_id) — service_role only — lets the
--     web ask "would the data tier accept this session?" and send an
--     unbound one back to /login instead of showing an empty console.
--
-- BLAST RADIUS
-- ------------
-- Only profiles with TOTP enabled, and only sessions that carry a
-- session_id claim. service_role, direct SQL / cron (no claims), viewers and
-- auditors are untouched: every branch that returned true before still
-- returns true, before the binding lookup is reached. Cost: one primary-key
-- lookup per statement per gated table (mfa_ok() runs as an InitPlan).
--
-- KILL SWITCHES (no deploy, one statement, effective immediately)
-- ---------------------------------------------------------------
--   -- binding only (the amr = [password] refusal stays armed):
--   update private.security_settings
--      set mfa_session_binding = false, updated_at = now(),
--          updated_by = 'incident <ref> — <who>';
--   -- the whole data-tier second factor, as before:
--   update private.security_settings set mfa_required = false, ...;
-- With either switch off mfa_session_bound() answers true, so the web stops
-- sending anyone back to /login as well. Re-arm with `= true`. Re-running
-- this migration never re-arms a disabled switch (ADD COLUMN IF NOT EXISTS).
--
-- ROLLBACK (paste as-is, as postgres; restores the 20260908110000 behaviour)
-- ---------------------------------------------------------------------------
--   Kill switch first (instant), then, if the objects must go: re-create
--   private.mfa_ok() from 20260908110000 (section 2, verbatim) and
--   public.mfa_status() from the same file (section 3), then
--     drop function if exists public.mfa_session_bound(uuid);
--     drop function if exists public.bind_mfa_session(uuid, uuid, text);
--     drop table if exists private.mfa_sessions;
--     alter table private.security_settings drop column if exists mfa_session_binding;
--   The web keeps working without the functions: bind -> PGRST202 -> logged,
--   login continues; the loader's check -> missing -> nobody is signed out.
--   Should bind_mfa_session() itself ever start failing in production (every
--   TOTP login would then end in signin_failed), dropping just that function
--   is the fastest way back: the web treats a missing bind RPC as a deploy
--   gap. Arm the binding kill switch at the same time, or the sessions minted
--   meanwhile are refused.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- A bound session is still a bearer token (ADR 0011). A mailbox holder who
-- also has the TOTP seed or a passkey is, correctly, the admin. Supabase
-- still DELIVERS the magic-link / recovery mail; the Send Email hook and
-- mailbox 2FA in RUNBOOK §5a.2 remain optional defence in depth.
-- ============================================================================

-- ─── 1. Independent kill switch ─────────────────────────────────────────────
ALTER TABLE private.security_settings
  ADD COLUMN IF NOT EXISTS mfa_session_binding boolean NOT NULL DEFAULT true;

COMMENT ON TABLE private.security_settings IS
  'Single-row operational switches. mfa_required=false disables private.mfa_ok() '
  'enforcement instantly, without a deploy; mfa_session_binding=false disables '
  'only its session-binding branch (20260928120000). Service-role/postgres only.';

COMMENT ON COLUMN private.security_settings.mfa_session_binding IS
  'When true (default), private.mfa_ok() requires a TOTP profile''s session to be '
  'listed in private.mfa_sessions. false = skip that check (kill switch).';

-- ─── 2. Sessions minted after a verified second factor ─────────────────────
CREATE TABLE IF NOT EXISTS private.mfa_sessions (
  session_id uuid        PRIMARY KEY REFERENCES auth.sessions (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  method     text        NOT NULL CHECK (method IN ('totp', 'recovery_code', 'passkey')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.mfa_sessions IS
  'GoTrue sessions the app minted after a verified TOTP code, recovery code or '
  'passkey. Written only by public.bind_mfa_session() (service_role); read by '
  'private.mfa_ok() and public.mfa_session_bound(). Rows disappear with their '
  'auth.sessions row (ON DELETE CASCADE). Never exposed over PostgREST.';

-- Defence in depth: the schema is unreachable over REST, but keep the table
-- itself unreadable to the API roles even if that ever changed.
ALTER TABLE private.mfa_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.mfa_sessions FROM PUBLIC, anon, authenticated;

-- auth.users deletion cascades through here; keep that a lookup, not a scan.
CREATE INDEX IF NOT EXISTS mfa_sessions_user_id_idx ON private.mfa_sessions (user_id);

-- ─── 3. Bind (server only) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bind_mfa_session(
  p_session_id uuid,
  p_user_id    uuid,
  p_method     text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $fn$
DECLARE
  v_owner    uuid;
  v_bound_to uuid;
BEGIN
  IF p_session_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'bind_mfa_session: session and user are required' USING errcode = '22023';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('totp', 'recovery_code', 'passkey') THEN
    RAISE EXCEPTION 'bind_mfa_session: unknown method' USING errcode = '22023';
  END IF;

  -- The session must exist and belong to the user the app just verified.
  SELECT s.user_id INTO v_owner FROM auth.sessions s WHERE s.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bind_mfa_session: session not found' USING errcode = '22023';
  END IF;
  IF v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'bind_mfa_session: session belongs to another user' USING errcode = '22023';
  END IF;

  -- Idempotent: a retried login step binds the same session once.
  INSERT INTO private.mfa_sessions (session_id, user_id, method)
  VALUES (p_session_id, p_user_id, p_method)
  ON CONFLICT (session_id) DO NOTHING;

  -- ...and never re-points an existing binding at someone else.
  SELECT m.user_id INTO v_bound_to FROM private.mfa_sessions m WHERE m.session_id = p_session_id;
  IF v_bound_to IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'bind_mfa_session: session is bound to another user' USING errcode = '22023';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bind_mfa_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_mfa_session(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.bind_mfa_session(uuid, uuid, text) IS
  'Service-role only. Records that the app minted this GoTrue session after a '
  'verified second factor (method totp | recovery_code | passkey). Refuses a '
  'session that does not exist or belongs to another user (22023); idempotent; '
  'never re-points a binding. Read by private.mfa_ok().';

-- ─── 4. "Would the data tier accept this session?" (server only) ───────────
CREATE OR REPLACE FUNCTION public.mfa_session_bound(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_catalog
AS $fn$
BEGIN
  -- Same switches as private.mfa_ok(): when the data tier does not require a
  -- binding, the web must not send anyone back to /login either. Unreadable
  -- or missing settings -> not required, like mfa_ok().
  BEGIN
    IF EXISTS (
      SELECT 1 FROM private.security_settings
      WHERE id AND (mfa_required IS NOT TRUE OR mfa_session_binding IS NOT TRUE)
    ) THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;

  -- No session id -> unknown (NULL), mirroring mfa_ok()'s fail-open on a
  -- missing session_id claim. The web treats NULL as "do not sign out".
  IF p_session_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN EXISTS (SELECT 1 FROM private.mfa_sessions m WHERE m.session_id = p_session_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.mfa_session_bound(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_session_bound(uuid) TO service_role;

COMMENT ON FUNCTION public.mfa_session_bound(uuid) IS
  'Service-role only. True when the session is bound in private.mfa_sessions, '
  'or when binding is not enforced (mfa_required or mfa_session_binding off); '
  'NULL for a NULL session id. Used by the web to force a re-login of an '
  'unbound TOTP session instead of rendering an empty console.';

-- ─── 5. The helper, with the binding branch ────────────────────────────────
-- Branches (a)-(g) are 20260908110000 verbatim, except that (g) now returns
-- false only when it refuses and falls through to (h) otherwise.
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
  v_sid       uuid;
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

  IF v_entries > 0 AND v_passwords = v_entries THEN
    RETURN false;
  END IF;

  -- (h) Session binding (20260928120000). An e-mail-minted session (amr otp
  --     / magiclink / recovery) looks exactly like the ones the app mints
  --     after TOTP / passkey; only the binding row the app writes after a
  --     verified second factor tells them apart.
  --     Independent kill switch. Unreadable or missing -> allow.
  BEGIN
    IF EXISTS (
      SELECT 1 FROM private.security_settings
      WHERE id AND mfa_session_binding IS NOT TRUE
    ) THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;

  --     No readable session_id claim -> cannot determine -> allow. GoTrue
  --     puts session_id in every access token it issues for a user session
  --     and the claim is signed; only hand-built claims get here.
  BEGIN
    v_sid := nullif(v_claims->>'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;
  IF v_sid IS NULL THEN
    RETURN true;
  END IF;

  --     The binding row is deleted with its session (FK ON DELETE CASCADE),
  --     so a signed-out session's unexpired token is refused too. A lookup
  --     that cannot run at all (table dropped mid-rollback) fails open.
  BEGIN
    RETURN EXISTS (
      SELECT 1 FROM private.mfa_sessions m
      WHERE m.session_id = v_sid AND m.user_id = v_uid
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION private.mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mfa_ok() TO authenticated, service_role;

COMMENT ON FUNCTION private.mfa_ok() IS
  'True unless the caller has TOTP enabled and either their token proves nothing '
  'but a password (amr = [password]) or its session_id is not bound in '
  'private.mfa_sessions (the app binds every session it mints after a verified '
  'TOTP code, recovery code or passkey). Fails open on anything it cannot '
  'determine, including a missing session_id claim. Kill switches: '
  'update private.security_settings set mfa_required = false (everything) or '
  'set mfa_session_binding = false (binding only).';

-- ─── 6. Operator diagnostic: prove the session_id claim is present ─────────
-- Same as 20260908110000 plus `session_id_present`: the binding branch fails
-- open without that claim, so its absence must be observable from a real
-- session in one call. Still only the caller's own token; no personal data.
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
    'aal',                auth.jwt()->>'aal',
    'session_id_present', (coalesce(auth.jwt()->>'session_id', '') <> ''),
    'mfa_ok',             private.mfa_ok()
  );
$fn$;

REVOKE ALL ON FUNCTION public.mfa_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_status() TO authenticated, service_role;

COMMENT ON FUNCTION public.mfa_status() IS
  'Diagnostic: what the caller''s own access token proves (amr methods, aal, '
  'whether it carries a session_id) and whether private.mfa_ok() accepts it — '
  'false for a TOTP account also when the session is not bound. No personal data.';
