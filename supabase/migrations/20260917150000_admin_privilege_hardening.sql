-- Admin privilege hardening (2026-09-17 review).
--
-- DEPLOY ORDER: ship the app first (it writes both tables below with the
-- service role from step-up-gated routes), then apply this migration. The
-- reverse order breaks "enable push notifications" until the app is deployed.
--
-- Everything here only REMOVES direct PostgREST write access that the app no
-- longer uses. It does not touch private.mfa_ok(): the sessions the app mints
-- after TOTP / passkey (amr = otp) are unaffected, nobody can be locked out.

-- ── 1. Passkeys cannot be deleted with a bare user token ───────────────────
-- Attack closed: a password-only GoTrue token (public password grant, no
-- TOTP) or any stolen session could
--     DELETE /rest/v1/webauthn_credentials?user_id=eq.<self>
-- because `authenticated` held DELETE and the permissive policy
-- "webauthn_credentials: self delete" only required user_id = auth.uid().
-- That skipped the app's TOTP step-up AND the PASSKEY_DELETE audit row, and
-- silently stripped an admin of every phishing-resistant credential.
-- Migration 20260908110000 left the table out of the second-factor policies
-- because credentials are READ during login; that reasoning never covered
-- DELETE. The app deletes with the service role after step-up
-- (app/api/auth/passkey/route.ts), so no user-token write path is needed.
drop policy if exists "webauthn_credentials: self delete" on public.webauthn_credentials;
revoke insert, update, delete, truncate, references, trigger
  on public.webauthn_credentials from anon, authenticated;
-- anon never needs to see credentials at all (login reads them server-side
-- with the service role).
revoke select on public.webauthn_credentials from anon;

-- Same clean-up for the challenge table: RLS already denies everything
-- ("webauthn_challenges: deny"), the grants were simply left at the default.
revoke all on public.webauthn_challenges from anon, authenticated;

-- ── 2. Push subscriptions are written only by the server ───────────────────
-- Attack closed: with a stolen session (or a password-only token) an attacker
-- could POST /rest/v1/push_subscriptions with THEIR push endpoint and keys
-- under the victim's user_id. lib/push.ts then fans every admin notification
-- (suspect name + camera + score, anomaly summaries, reveal requests with the
-- requester e-mail) to that endpoint with the service role. The row survived
-- sign-out and password change, no audit row was written and no page showed
-- other users' subscriptions — a durable, invisible exfiltration channel.
-- /api/push/subscribe now writes with the service role after a TOTP step-up
-- (admins), caps rows per user and audits PUSH_SUBSCRIBED / PUSH_UNSUBSCRIBED.
-- Users keep SELECT on their own rows (the settings page lists them).
drop policy if exists push_subscriptions_self_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_self_update on public.push_subscriptions;
drop policy if exists push_subscriptions_self_delete on public.push_subscriptions;
revoke insert, update, delete, truncate, references, trigger
  on public.push_subscriptions from anon, authenticated;
revoke select on public.push_subscriptions from anon;

comment on table public.push_subscriptions is
  'Web-push endpoints. Written ONLY by the service role via /api/push/subscribe '
  '(step-up + audit). Users may read their own rows; no direct DML.';

-- ── 3. Step-up-gated admin changes cannot be replayed through PostgREST ────
-- Attack closed: the TOTP step-up on retention changes, camera grants, camera
-- enable / consent and legal-hold release lived ONLY in the Next server
-- actions. A stolen admin session carries its own access token (amr = otp, so
-- private.is_admin() and private.mfa_ok() both pass) and could write the same
-- rows directly:
--     PATCH  /rest/v1/retention_policies   {retention_days:1,enabled:true}
--     POST   /rest/v1/camera_permissions   (unmasked live video for anyone)
--     PATCH  /rest/v1/cameras              {enabled:true} / {consent_required:false}
--     DELETE /rest/v1/recordings | faces | alerts
-- with no step-up, no audit row and no notification to the other admins.
-- The app writes all of these with the service role from requireAdmin()-gated
-- actions (retention/actions.ts, cameras/[id]/permissions/actions.ts,
-- cameras/actions.ts, cameras/[id]/schedule/actions.ts); recordings, faces and
-- alerts are only ever deleted by sweep_retention() / GDPR erasure (service
-- role). Nothing the app does with a user token is removed here: alerts keep
-- UPDATE (label + state routes), every table keeps SELECT.
revoke insert, update, delete, truncate, references, trigger
  on public.retention_policies, public.camera_permissions, public.cameras
  from anon, authenticated;
revoke delete, truncate, references, trigger
  on public.recordings, public.faces, public.alerts
  from anon, authenticated;

-- Legal hold: APPLYING a hold stays a one-click, user-token RPC (safe
-- direction). RELEASING one is the first step of destroying pinned evidence;
-- the user-callable RPC now refuses it, and the app releases through a
-- service-role-only function after the TOTP step-up, naming the actor.
create or replace function public.set_incident_recording_hold(p_evidence_id uuid, p_legal_hold boolean)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_row public.incident_recordings%rowtype;
begin
  if v_user is null or not private.is_admin() or not private.mfa_ok() then
    raise exception 'forbidden: verified admin required' using errcode = '42501';
  end if;
  if p_legal_hold is distinct from true then
    raise exception 'forbidden: releasing a hold requires step-up' using errcode = '42501';
  end if;
  select * into v_row from public.incident_recordings where id = p_evidence_id for update;
  if not found then raise exception 'evidence not found' using errcode = 'P0002'; end if;
  if v_row.legal_hold then return p_evidence_id; end if;
  select email into v_email from public.profiles where id = v_user;
  update public.incident_recordings set
    legal_hold = true, hold_released_by = null, hold_released_at = null
  where id = p_evidence_id;
  update public.incidents set updated_at = now() where id = v_row.incident_id;
  insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
    values (v_row.incident_id, 'hold_changed',
      'evidence=' || p_evidence_id::text || ' · hold=true', v_user, v_email);
  insert into public.audit_log(action, detail, user_id, user_email)
    values ('EVIDENCE_HOLD_APPLIED',
      v_row.incident_id::text || ' · evidence=' || p_evidence_id::text, v_user, v_email);
  return p_evidence_id;
end;
$$;

create function public.release_incident_recording_hold(p_evidence_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_email text;
  v_row public.incident_recordings%rowtype;
begin
  select email into v_email from public.profiles where id = p_actor and role = 'admin';
  if not found then
    raise exception 'forbidden: admin actor required' using errcode = '42501';
  end if;
  select * into v_row from public.incident_recordings where id = p_evidence_id for update;
  if not found then raise exception 'evidence not found' using errcode = 'P0002'; end if;
  if not v_row.legal_hold then return p_evidence_id; end if;
  update public.incident_recordings set
    legal_hold = false, hold_released_by = p_actor, hold_released_at = now()
  where id = p_evidence_id;
  update public.incidents set updated_at = now() where id = v_row.incident_id;
  insert into public.incident_events(incident_id, event_type, detail, actor_id, actor_email)
    values (v_row.incident_id, 'hold_changed',
      'evidence=' || p_evidence_id::text || ' · hold=false', p_actor, v_email);
  insert into public.audit_log(action, detail, user_id, user_email)
    values ('EVIDENCE_HOLD_RELEASED',
      v_row.incident_id::text || ' · evidence=' || p_evidence_id::text, p_actor, v_email);
  return p_evidence_id;
end;
$$;

revoke all on function public.release_incident_recording_hold(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_incident_recording_hold(uuid, uuid) to service_role;
