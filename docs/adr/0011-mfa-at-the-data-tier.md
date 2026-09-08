# 0011 — Prove the second factor at the data tier

* **Status:** Accepted
* **Date:** 2026-09-08
* **Relates to:** [0005](0005-supabase-rls-as-authorization.md) (RLS as the authorization boundary), [0006](0006-step-up-totp-reauth.md) (step-up TOTP)
* **Fixes:** finding 4.1 of `docs/audits/2026-09-08-full-audit.mn.md`

## Context

ADR 0005 committed to RLS as the authorization boundary precisely because the
Supabase REST surface is on the public internet: whatever the browser can be
tricked into doing, the database still decides. That held for *roles*. It never
held for the *second factor*.

Every TOTP control in this system lives in the Next.js tier: the login flow
(`app/login/actions.ts`), the step-up cookie (ADR 0006), the session pin, the
4-eyes reveal. The database was never told any of it. `private.is_admin()` reads
`profiles.role` and stops there.

So the attack is short. An attacker with an admin password does not go to
aicctv.dev at all. They take the anon key out of any page's JavaScript bundle —
it is public by design — and post the project's GoTrue endpoint directly:

```
POST https://<ref>.supabase.co/auth/v1/token?grant_type=password
     apikey: <anon key from the bundle>
     {"email": "...", "password": "..."}
```

GoTrue returns a normal access token. PostgREST accepts it. `private.is_admin()`
returns true. From there `/rest/v1/faces`, `/alerts`, `/cameras`, `/recordings`,
`/suspects` are readable, and — because several policies are `FOR ALL` —
writable and deletable. No TOTP. No session pin. No step-up. No 4-eyes. And no
audit row, because the audit ledger is written by application code that this
path never touches.

Everything expensive in this system (AES-256-GCM at rest, view-time masking,
the hash-chained log, the reveal hierarchy) protects the slow road. The fast
road was a `curl` command.

### The fact that makes a fix cheap

Supabase records the authentication methods of every session in
`auth.mfa_amr_claims` and carries them in the access token's `amr` claim
(`[{"method": "...", "timestamp": ...}]`).

This project's login flow happens to make that claim decisive. For a user with
TOTP enabled, `signInAction` verifies the password, **signs the user straight
back out**, and hands them a two-minute HMAC cookie. Only after the TOTP (or
recovery) code is verified does `verifyTotpAction` mint the real session — with
`admin.generateLink` + `verifyOtp`. So:

| How the session was created | `amr` |
|---|---|
| App login, TOTP user (also the passkey finish route) | `otp` |
| App login, user without TOTP (viewer, auditor) | `password` |
| Raw `grant_type=password` against GoTrue | `password` |

Read-only evidence from the live project on 2026-09-08:

```
select authentication_method, count(*) from auth.mfa_amr_claims group by 1;
  otp = 3   (newest 2026-09-08)  — all three TOTP-enabled admins
  password = 3                    — the auditor, the viewer (neither has TOTP),
                                    and one dormant 2026-05-18 admin session
                                    that has never been refreshed
```

Every session in daily use is already on the right side of the line. The one
session on the wrong side is a four-month-old dormant one — exactly the shape
the control is meant to refuse.

## Decision

**Teach the database to require that a TOTP user's token prove something other
than a password.**

1. **`private.mfa_ok()`** — SECURITY DEFINER, STABLE, `search_path` pinned,
   granted to `authenticated` + `service_role`. It is deliberately generous,
   because a control that locks the operator out of their own console is worse
   than the hole it closes:

   | Situation | Result |
   |---|---|
   | Profile has no TOTP (viewer, auditor, not-yet-enrolled admin, missing profile) | **allow** |
   | `amr` absent, null, not an array, or empty | **allow** — cannot determine |
   | Any entry with a method other than `password` (`otp`, `magiclink`, `webauthn`, `totp`, `mfa`) | **allow** |
   | An entry we cannot parse | **allow** — it is not "password" |
   | Claims missing/malformed, no `sub`, `role` = `service_role` | **allow** |
   | TOTP enabled **and** `amr` readable **and** every entry is `password` | **refuse** |

   Fail open on "cannot determine", fail closed on "determined and not allowed".

2. **Attached as RESTRICTIVE policies**, one per table, rather than by editing
   the existing `USING` clauses. Postgres ANDs restrictive policies with the
   permissive ones, so every existing condition (`private.is_admin()`,
   `private.is_operator() AND private.user_can_see_camera(...)`,
   `private.can_read_reveal_level(...)`, `private.is_admin_or_auditor()`)
   survives byte-for-byte — there is no opportunity to drop a term while
   retyping a policy, and the rollback is one `DROP POLICY` per table. The
   expression is wrapped as `(SELECT private.mfa_ok())` so the planner
   evaluates it once per statement as an InitPlan, not once per row.

   Ten tables, `authenticated` role only: `faces`, `alerts`, `recordings`,
   `cameras`, `suspects`, `clusters`, `reveal_jobs`, `audit_log`, `webhooks`,
   `camera_sessions`.

   Deliberately **not** gated:
   * `profiles` — middleware and every auth helper read it with the user's own
     token, including to discover that TOTP is required at all. Gating it would
     deadlock login and make the helper's own lookup unreachable.
   * `totp_used_codes`, `webauthn_challenges`, `webauthn_credentials`,
     `push_subscriptions` — read while the second factor is still being
     decided, or self-scoped and non-surveillance.
   * `alert_rules`, `camera_permissions`, `masking_schedules`, `privacy_zones`,
     `retention_policies`, `uptime_checks`, `web_vitals` — configuration and
     telemetry, no personal data; still admin-only via their own policies.
   * `retention_deletion_queue` — already policy-less (service-role only).
   * `storage.objects` — a separate hole (audit finding 4.2) with a separate
     fix; `private.mfa_ok()` is available for that policy to reuse.

3. **A kill switch that needs no deploy.** `private.security_settings` is a
   single-row, service-role-only table read on every call:

   ```sql
   update private.security_settings
      set mfa_required = false, updated_at = now(), updated_by = 'incident … — who';
   ```

   Effective on the next statement; re-arm with `true`. If the table is missing
   or unreadable, `mfa_ok()` returns true. Re-running the migration does not
   re-arm a disabled switch (`ON CONFLICT DO NOTHING`), so a `db push` during an
   incident cannot silently turn enforcement back on.

4. **`public.mfa_status()`** — a read-only diagnostic exposed as
   `/rest/v1/rpc/mfa_status`, returning only `{amr_present, methods, aal,
   mfa_ok}` for the caller's own token. The whole control rests on the access
   token actually carrying `amr`; if a future GoTrue release stopped emitting
   it, `mfa_ok()` would fail open and the gate would become a silent no-op. This
   makes that observable from a real session in one call, without a deploy.

## Alternatives considered

**Native Supabase MFA (`auth.mfa_factors`) with `auth.jwt()->>'aal' = 'aal2'`.**
This is the textbook answer and it is strictly stronger: `aal2` proves the
factor was verified *for this session* by GoTrue itself, rather than inferring
it from how the session was minted. It is also a rewrite of the whole
authentication surface. TOTP secrets live in `profiles.totp_secret` with the
project's own enrolment UI, its own SHA-256 recovery codes, its own replay
guard (`totp_used_codes`), its own step-up cookie and its own login state
machine. Migrating means re-enrolling three admins against GoTrue, replacing
the login flow, the settings page, the step-up path and the recovery-code
scheme — and a half-migrated state locks out the only three accounts that can
administer the system. **The `amr` gate is compatible with that destination,
not a detour from it:** native MFA sessions carry `amr` entries of `totp`/`mfa`,
which `mfa_ok()` already accepts, so the migration can happen later, per user,
with this control in place throughout. This ADR explicitly does not touch the
app's TOTP code; that is its own project.

**Disable the password grant.** The cleanest structural fix: if
`grant_type=password` cannot be used with the anon key, the attack has no first
step. Supabase exposes no per-key grant restriction, and API-level network
restrictions are not available on this plan. The app's own step 1 *is*
`signInWithPassword` (server-side, in a server action), so removing the grant
means moving password verification off GoTrue entirely — a bigger change than
native MFA, with the same lockout risk. Rejected for now; re-evaluate if the
project moves to a plan with API network restrictions.

**A custom access-token auth hook that stamps a claim.** Equivalent power to
reading `amr`, plus a new moving part in the token-issuing path — a hook that
errors takes login down for everyone. `amr` is already there and already
correct.

**Rotate the passwords / revoke the dormant session.** Housekeeping, not a
control. It closes today's instance and none of the class.

## Consequences

**What gets better.** A stolen admin password is no longer sufficient to read
or delete surveillance data. To reach faces, alerts, recordings, cameras,
suspects, clusters, reveal jobs, webhooks, camera sessions or the audit log,
an attacker must hold a session the app minted after a real second factor.
`private.is_admin()` alone is no longer the whole answer, and the guarantee now
holds for direct PostgREST access, not only for traffic that goes through
Next.js.

**What it costs.**

* Of six live sessions, exactly one is refused: the dormant 2026-05-18 admin
  password session. Recovery is to sign in again.
* **Enrolment window.** An admin who turns TOTP on keeps a password-only
  session until they sign out. `/settings` keeps working (`profiles` is not
  gated), but the rest of the console reads empty until they log in again.
  The app should sign the user out at the end of TOTP enrolment; that change
  lives in the TOTP routes and is deliberately out of scope here.
* One extra function call per statement per gated table (InitPlan, once per
  statement), reading two small rows.
* Anyone debugging "admin sees no rows" now has one more place to look. The
  answer is one call to `public.mfa_status()`.

**What it does not fix — say this plainly.**

* A session that has already passed TOTP is a **bearer token**. Whoever holds
  it has what it grants. This closes the password-only path into PostgREST; it
  does not address token theft, XSS, or a stolen device with a live session.
* The `service_role` key still bypasses everything, by design — the app's
  server code and the ML service depend on it. Its compromise remains the
  system's single worst case.
* The gate **fails open** by construction. If a token arrives without a
  readable `amr` claim, access is allowed. That is the deliberate trade against
  locking out the operator, and it is why `public.mfa_status()` exists.
* Direct PostgREST reads still leave no audit row (audit finding, §3 of
  `docs/COMPLIANCE.md`). This bounds *who* can make them; it does not record
  them.
* Storage (`storage.objects`) is not covered here — see finding 4.2.

## Verification

Exercised against a throwaway Postgres 17 with the project's policy shapes and
five profiles matching production, running the migration verbatim (results
2026-09-08):

| Scenario | `mfa_ok` | Rows visible |
|---|---|---|
| TOTP admin, `amr=[password]` | false | 0 across all ten tables (`profiles` still readable: 5) |
| TOTP admin, `amr=[otp]` | true | full access; INSERT/UPDATE succeed |
| TOTP admin, no `amr` claim / `amr=null` / `amr="password"` / `amr=[]` / `amr=[{}]` | true | full access |
| TOTP admin, `amr=["password"]` (string form) | false | 0 |
| TOTP admin, `amr=[password, totp]` (native MFA shape) | true | full access |
| Viewer / auditor, `amr=[password]` | true | unchanged (their own role limits apply) |
| `role=service_role` claims, and `service_role` (BYPASSRLS) | true | full access |
| Malformed claims (`not-json`, JSON array, bad `sub`, empty) | true | fail-open, no exception |
| Kill switch off → TOTP admin, `amr=[password]` | true | full access; re-arming restores refusal |
| `anon` | — | 0 (unchanged) |

Writes are refused by name — `new row violates row-level security policy
"suspects: second factor required"` — and `DELETE`/`UPDATE` affect 0 rows.
`private.security_settings` is `permission denied` for `authenticated`.
Applying the migration twice is clean and preserves the switch state.

**Post-deploy check (run once, from a real browser session):**

Sign in to aicctv.dev normally, then take the session's `access_token` from
the `sb-<ref>-auth-token` cookie (devtools → Application → Cookies; the value is
base64-encoded JSON) and ask the database what that token proves:

```bash
curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/mfa_status" \
  -H "apikey: <anon key — public by design>" \
  -H "Authorization: Bearer <access_token>"
# expect: {"aal":"aal1","mfa_ok":true,"methods":["otp"],"amr_present":true}
```

If `amr_present` is ever `false` for an app-minted session, the gate has gone
silently permissive — treat that as an incident and revisit native MFA.
