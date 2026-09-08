# MONGOLZ Security — Operational Runbook

Practical procedures for keeping the system healthy and responding to
incidents. Complements [BREAK_GLASS.md](BREAK_GLASS.md) (last-resort actions)
and [COMPLIANCE.md](COMPLIANCE.md) (legal mapping).

---

## 1. Recovery Objectives

| Metric | Target | Component | Rationale |
|---|---|---|---|
| **RPO** (data loss tolerance) | ≤ 24 h | Supabase Postgres | Daily Vercel-Cron `backup-verify` + Supabase point-in-time backup (Pro tier feature; falls back to manual `pg_dump` on Free). |
| **RPO** — alerts only | ≤ 5 min | Realtime + audit_log | Hash-chained audit means tampering is detectable even mid-window. |
| **RTO** (downtime tolerance) | ≤ 60 min | Vercel + Supabase + Railway | Restore from backup ZIP + redeploy each tier. Drill timed at 35-50 min on staging copy. |
| **MTTD** (detect) | ≤ 5 min | Sentry + `/api/uptime` + `/api/monitoring/error-rate` | External monitor pings uptime; Sentry catches `Sentry.captureRequestError` on every server error. |
| **MTTR** (resolve) | ≤ 30 min for P1 | Operator + this runbook |  |

P1 = "users cannot log in" OR "live recording paused" OR "audit chain broken".
P2 = "non-critical feature degraded".
P3 = "cosmetic / single user impacted".

---

## 2. Incident Response Phases

### 2.1 Detect

Signals that should trigger a response:

- Sentry alert in #mongolz-alerts Slack
- `/api/uptime` external probe → `503` for ≥ 2 consecutive checks
- `audit_log` row with action starting `BREAK_GLASS_*`, `ADMIN_COUNT_ZERO`,
  `REAUTH_TOTP_REPLAY_BLOCKED`, `KEY_ROTATION_DUE`
- `audit_log` row `LOGIN_CONFIG_ERROR` / `REAUTH_CONFIG_ERROR`, or a Sentry
  **fatal** `[config] missing production secrets: …` at boot (see below)
- User report via khajybyek@gmail.com (security.txt)

#### Missing signing secret (login crash / step-up 500)

`lib/auth/hmac-secret.ts` is **fail-closed in production**: cookie signers
(`REAUTH_COOKIE_SECRET`, `SESSION_PIN_SECRET`, `STREAM_TICKET_SECRET`) have
no fallback when `VERCEL_ENV=production`. A missing one is a silent outage
for every TOTP-enabled admin, not a crash of the whole site.

**Symptom**

- Admin (TOTP) password login lands on `/login?error=server_config`
  ("server configuration error"); passkey and non-TOTP logins still work.
  Before the guard existed this was the unstyled "Something went wrong" page.
- Step-up (`POST /api/auth/reauth`, `/api/auth/reauth/totp`) returns
  `503 { "error": "server_config" }`; the TOTP prompt shows the translated
  "signing secret is missing" message.
- `audit_log` rows `LOGIN_CONFIG_ERROR` / `REAUTH_CONFIG_ERROR` (user +
  ip, no secret values).
- Sentry: fatal `[config] missing production secrets: A, B` on cold boot
  (`instrumentation.ts`) plus the captured exception per request.

**Check**

```bash
vercel env ls production                      # is the name listed at all?
curl -s https://aicctv.dev/api/health/auth -H 'Cookie: <admin session>' | jq .config
# → { "ok": false, "missing": ["REAUTH_COOKIE_SECRET"], "production": true }
```

`/health` (admin) shows the same list as red chips under
"Configuration (secrets)".

**Fix**

```bash
NEW=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
echo "$NEW" | vercel env add REAUTH_COOKIE_SECRET production   # repeat per missing NAME
vercel deploy --prod --yes                                      # env changes need a redeploy
```

Then re-run the check above (`config.ok` must be `true`) and confirm a TOTP
login reaches `/login?step=totp`. Rotating an already-set secret is
`npm run rotate:keys -- --key=<NAME>` (see §4), not this procedure.

### 2.2 Triage (within 5 min)

1. Acknowledge alert in chat with `:eyes:` reaction (claim incident).
2. Decide severity (P1/P2/P3).
3. Open the corresponding worktree (`detect → triage → contain → eradicate → recover → postmortem`).

### 2.3 Contain (within 15 min)

Per-incident playbooks:

#### a. Brute-force / credential stuffing in progress

`LOCKOUT_TRIGGERED` rows are appearing in `audit_log` faster than 1 per hour.

1. Check the source pattern:
   ```sql
   SELECT detail, user_email, ip, count(*)
   FROM audit_log
   WHERE action = 'LOCKOUT_TRIGGERED'
     AND created_at >= now() - interval '1 hour'
   GROUP BY 1, 2, 3
   ORDER BY 4 DESC;
   ```
2. If a single IP — block at Vercel firewall (Settings → Firewall) or push a tighter `checkLoginRateLimit` value (e.g. `maxPerIp=3`).
3. If many IPs hitting the same email — flag the account, force-rotate password, and re-enable TOTP recovery codes for the user.
4. Inform the affected user via the email on file.

#### b. Suspected credential leak (service-role key, env var)

1. Vercel → rotate the env var → redeploy.
2. Supabase Dashboard → revoke the old key.
3. Audit: `INSERT INTO audit_log VALUES ('BREAK_GLASS_KEY_ROTATION', …)`.

#### b. Active SQL or storage attack signal

1. Open Supabase Dashboard → Activity → look for unfamiliar IPs.
2. If `service_role` from unknown IP: rotate immediately (as above).
3. If `authenticated` brute force: ban via `auth.identities` row update; tighten `checkLoginRateLimit`.

#### c. Camera operator reports unauthorized reveal

1. `SELECT * FROM reveal_jobs ORDER BY created_at DESC LIMIT 20` — verify request had 4-eyes approval.
2. `SELECT * FROM audit_log WHERE action LIKE 'REVEAL_%' AND created_at >= now() - interval '24 hours'`.
3. If approval missing → revoke the requesting admin's role pending investigation.

#### d. Audit chain broken

```sql
SELECT * FROM verify_audit_chain() LIMIT 20;   -- returns ONLY broken rows; empty = healthy
```

Preserve as evidence — **do not backfill**. See [BREAK_GLASS.md §5](BREAK_GLASS.md).

### 2.4 Eradicate / Recover

- Restore from backup if data corruption: see §3 below.
- Re-enable normal traffic: remove rate-limit overrides, re-enable the affected route.
- Verify with smoke test:
  ```bash
  curl -s https://mongolz.vercel.app/api/uptime
  curl -sI https://mongolz.vercel.app/login | head -3
  ```

### 2.5 Post-mortem (within 5 business days)

Template:

```markdown
# Incident YYYY-MM-DD: <one-line>

**Severity:** P1/P2/P3
**Duration:** start → end (UTC)
**Customer impact:** N users affected, … minutes of downtime
**Root cause:** (1-2 sentences)

## Timeline
- HH:MM — first signal
- HH:MM — acknowledged
- HH:MM — contained
- HH:MM — resolved

## What went well
- Detection within MTTD target

## What went poorly
- (be honest, blameless)

## Action items (assign owners)
- [ ] code change to prevent recurrence
- [ ] runbook update
- [ ] alert tuning
```

Store post-mortems in `docs/postmortems/YYYY-MM-DD-slug.md`.

---

## 3. Backup Restore Drill

Run on a staging copy every semester.

**Read this first — what the ZIP can and cannot do.** The artifact from
`/api/admin/backup` is a *row-and-path* backup, not a system image:

| Restores from the ZIP | Does NOT restore from the ZIP |
|---|---|
| `profiles` (identity fields), `cameras` (incl. the encrypted `url`), `recordings`, `alerts`, `alert_rules`, `reveal_jobs`, `camera_permissions`, `masking_schedules`, `privacy_zones`, `retention_policies`, `clusters`, `audit_log` | **Supabase `auth.users`** — passwords, sessions, identities |
| `suspects` + `faces` **only** when the export was taken with *Include biometric embeddings* (`?include_biometrics=1`) | TOTP seeds, recovery-code hashes, passkeys — operators re-enrol 2FA |
| Storage object **paths + per-bucket totals** (`buckets/*.manifest.json`) | `webhooks.url` + HMAC secret, `push_subscriptions` endpoint/p256dh/auth — those two tables are reference-only |
| `manifest.json` — the exact column list, row counts and restore limits of that artifact | Storage **blob bytes** — restore them from Supabase Storage backup / PITR |

Two consequences to plan around:

- **`auth.users` gap.** `profiles.id` is a FK onto `auth.users`. A clean
  project has no auth users, so `profiles.json` is rejected in full until the
  accounts exist. Recreate them first (Dashboard → Authentication → invite, or
  restore the auth schema from PITR) using the emails in `tables/profiles.json`,
  then keep the same UUIDs — the restore upserts profiles by `id`.
- **Biometrics.** `suspects.embedding` and `faces.embedding` are `NOT NULL` and
  are biometric personal data, so a default export leaves them out and those
  two tables cannot be restored from it (face matching does not come back). For
  a drill that must prove recognition works, take the export with the checkbox
  ticked — it needs fresh TOTP step-up and is audited as
  `BACKUP_DOWNLOAD_BIOMETRIC`; treat the file like the face database itself
  (encrypted storage, deleted after the drill).

### 3.1 Inputs

- A `mongolz-backup-<ts>.zip` (or `mongolz-backup-biometric-<ts>.zip`) produced
  by `/backup` → *Download backup* (admin-only, TOTP step-up).
- A clean Supabase project for restore (different `project_ref`).
- `CAMERA_URL_KEY` from the source environment — `cameras.url` is an
  AES-256-GCM ciphertext and stays unreadable without it (or
  `CAMERA_URL_KEY_PREV` after a rotation).
- `ML_ENCRYPTION_KEY` (and `ML_ENCRYPTION_KEY_PREV` if rotated) if the drill
  includes reveal/playback of restored blobs.

### 3.2 Steps

1. **Unzip and read the manifest**

   ```bash
   unzip mongolz-backup-*.zip -d ./restore
   ls restore/tables/                       # one JSON per table
   ls restore/buckets/                      # 5 manifests, paths from the DB
   jq '.include_biometrics, (.tables | map_values(.rows))' restore/manifest.json
   jq -r '.tables | to_entries[] | select(.value.restorable | not)
          | "\(.key): missing \(.value.missing_required | join(", "))"' restore/manifest.json
   ```

   The last command prints exactly which tables this artifact cannot restore.
   Without the biometric flag it prints `suspects`, `faces` (plus the always
   reference-only `webhooks` and `push_subscriptions`).

2. **Apply schema**

   ```bash
   cd mongolz-next
   npx supabase db push --linked        # linked to the RESTORE project
   ```

3. **Recreate the auth users** (nothing else works before this)

   ```bash
   jq -r '.[] | [.id, .email, .role] | @tsv' restore/tables/profiles.json
   ```

   For each row, create the auth user with that **same UUID** (Dashboard →
   Authentication → Add user, or the Admin API `auth.admin.createUser({ id, email })`),
   set a temporary password and require a reset. TOTP and passkeys are not in
   the backup: every operator re-enrols from `/settings`, and the super-admin
   flag rides along in `profiles.is_super_admin`.

4. **Preflight the row load** (no writes)

   ```bash
   npx tsx scripts/restore-from-backup.ts ./restore
   ```

   It reads every table file, checks it against the `NOT NULL` columns that
   have no default and prints `✓` / `✗` per table with the reason. Nothing is
   written; a `✗` here is the same failure Postgres would have raised mid-run.

5. **Load rows**

   ```bash
   npx tsx scripts/restore-from-backup.ts ./restore --apply
   # a default (non-biometric) export aborts with exit 3 and this instead:
   npx tsx scripts/restore-from-backup.ts ./restore --apply --skip-unrestorable
   ```

   FK order: `profiles` → `cameras`, `suspects` → `recordings`, `faces`,
   `clusters` → `alert_rules`, `alerts`, `reveal_jobs` → `webhooks`,
   `camera_permissions`, `masking_schedules`, `privacy_zones`,
   `retention_policies`, `push_subscriptions` → `audit_log` last, in `id`
   order and only into an empty table so the hash chain re-binds. The run ends
   with per-table counts and a **Skipped** list — copy both into the drill note.

6. **Restore the Storage objects**

   The ZIP holds no blob bytes. Re-upload from the Supabase Storage backup /
   PITR or an offline mirror, preserving the exact paths, then check
   completeness against the manifests (they are derived from the database, so
   `total_objects` is what a healthy restore must end up with):

   ```bash
   jq -r '.bucket + ": " + (.total_objects|tostring)' restore/buckets/*.manifest.json
   # per bucket, compare with the restored project:
   #   recordings        recordings.storage_path + original_path
   #   faces             faces.image_path (+ ".enc" when crop_sealed)
   #   suspects          suspects.image_path
   #   alert-screenshots alerts.screenshot_path
   #   revealed          reveal_jobs.output_path
   ```

   The manifest lists what the database *references*. Two mismatches are
   expected rather than failures, and both are worth writing down: objects in
   the source bucket with no owning row (orphans) are not listed, and a listed
   path whose object was already deleted in the source (a dangling reference)
   comes back as a shortfall. Anything else is an incomplete restore.

   Then decrypt-smoke-test a sample:

   ```bash
   npm run backup:verify
   ```

7. **Re-key if rotation occurred**

   If `ML_ENCRYPTION_KEY` or `CAMERA_URL_KEY` was rotated since the backup, set
   the matching `*_PREV` on the restore environment (see CLAUDE.md → Key
   Rotation Procedure) before verifying reveal or camera connectivity.

8. **Verify**

   ```sql
   SELECT count(*) FROM verify_audit_chain();   -- 0 = healthy
   ```

   ```bash
   curl -s "$RESTORE_URL/api/uptime" | jq
   # expect status=ok, ml=ok, db=ok
   ```

   Then in the app: log in as a restored admin (after the password reset),
   open `/cameras` (a camera must show its URL, proving `CAMERA_URL_KEY`), open
   `/playback` on a restored recording, and — only for a biometric drill —
   run a `/search` that matches a restored suspect.

9. **Record drill outcome**

   ```sql
   INSERT INTO audit_log (action, detail)
   VALUES ('BACKUP_RESTORE_DRILL',
           'Drill 2026-Q1: restore took <N> min, biometrics=<yes|no>, tables restored <N>/<N>, storage objects <N>/<N>, operator <name>');
   ```

### 3.3 Acceptance criteria for "successful drill"

- The **Skipped** list from step 5 contains only what the manifest predicted —
  no surprise table.
- Every restorable table's row count matches `manifest.json`.
- Auth users recreated for every profile row; each operator can log in and
  re-enrol TOTP.
- `verify_audit_chain()` returns no mismatches.
- Storage object counts per bucket match `buckets/*.manifest.json`.
- `/api/uptime` returns `status: ok`.
- A camera URL decrypts (`CAMERA_URL_KEY` present) and a test alert triggers a
  re-created webhook.
- A test reveal job completes end-to-end on a restored recording.
- Biometric drill only: a `/search` hit re-identifies a restored suspect.

If any check fails, file an issue with `[backup-restore]` label and treat as
P2 until resolved.

---

## 4. Routine Maintenance Checklist

| Cadence | Task |
|---|---|
| Daily | Confirm `/api/uptime` ok, Sentry quiet, `/api/cron/backup-verify` ran |
| Weekly | Review `audit_log` for `KEY_ROTATION_DUE`, `BREAK_GLASS_*`, `ADMIN_COUNT_ZERO` rows; check **Nuclei** + **OWASP ZAP** DAST reports (Monday 06:00 UTC) |
| Monthly | Confirm `npm audit --omit=dev`, Semgrep, and the DAST baseline have no new criticals |
| Quarterly | Restore drill on staging (§3) |
| Semi-annually | Review COMPLIANCE.md for regulation changes |

### Continuous security testing matrix

| Layer | Tool | Cadence | Output |
|---|---|---|---|
| Dependency audit | `npm audit` + `pip-audit` | every push + weekly | CI summary |
| Static analysis (SAST) | Semgrep (681 rules) | every push | fails build on ERROR severity |
| Secret scanning | trufflehog | PR + weekly | fails PR on verified leak |
| Dynamic analysis (DAST) | Nuclei (CVEs + misconfig templates) | weekly | uploaded artifact `nuclei-report.md` |
| Dynamic analysis (DAST) | OWASP ZAP baseline | weekly | uploaded artifact `zap-baseline-report`; opens GitHub issues for findings |
| Manual audit | code review + multi-agent triage | per major change | committed fixes |
| Drill | Backup restore on staging | quarterly | `BACKUP_RESTORE_DRILL` audit row |

To trigger a one-off DAST scan: GitHub Actions → Security workflow → `Run workflow`.

### Storage bucket policies

Storage is not a second door into personal data: every bucket that holds faces
or reveal output is reachable **only** through an API route that checks the
caller's authority and writes an audit row. The policies live in
`supabase/migrations/20260908111000_storage_bucket_policies.sql`, which
replaced the old blanket `storage: admin all-buckets all` grant (audit
2026-09-08 §4.2 — an admin refused at `/api/faces/[id]/secure-crop` could
still download the same plaintext crop straight from the `faces` bucket).

`service_role` has `BYPASSRLS`, so every server route using
`createServiceClient()` and the ML service (`SUPABASE_SERVICE_ROLE_KEY`) is
unaffected by this table. What follows is what a **logged-in browser session**
(`authenticated`) can reach with its own access token.

| Bucket | `authenticated` may | How the app actually reads it |
|---|---|---|
| `faces` | nothing (restrictive fence) | `/api/faces/[id]/secure-crop` → reveal_level gate + `FACE_CROP_VIEWED` audit row; `components/face-thumb.tsx` renders that route |
| `revealed` | nothing (restrictive fence, since 20260907100000) | `/api/reveal/[jobId]/output` → job authority + fresh re-auth |
| `recordings` | SELECT of `recordings.storage_path` only, admin **or** viewer, and only for cameras the user may see | `/playback/[id]` signs the baked artifact; `on_demand` recordings stream through `/api/recordings/[id]/view` → ML |
| `suspects` | admin: read + write + delete | `/suspects` pages sign, upload and remove enrolment photos with the user-scoped client |
| `alert-screenshots` | admin: read | `/suspects/[id]` signs the latest alert screenshot |
| `branding` | public read of `logo.png`, `logo-text.svg`, `favicon.png`, `apple-icon.png`; admin write | public bucket, served straight to the browser |

Encrypted originals (`recordings.original_path`, `<face>.enc`) are not in that
table on purpose: only the ML service decrypts, so only the ML service reads
them.

**Verify (read-only).** After the migration the table holds seven permissive
policies — `storage: operator read recordings (permission aware)`,
`storage: admin suspects`, `storage: admin read alert screenshots`, and the
four pre-existing `branding_*` ones — plus two restrictive fences:

```bash
supabase db query --linked "select policyname, permissive, roles::text, cmd \
  from pg_policies where schemaname='storage' and tablename='objects' \
  order by permissive desc, policyname;"
```

Expect the two `RESTRICTIVE` rows (`bucket_id <> 'faces'`, `bucket_id <>
'revealed'`) and **no** policy whose `qual` is a bare `private.is_admin()`
with no `bucket_id` test. The code side is asserted in CI:

```bash
npx jest __tests__/storage-policy-inventory.test.ts
```

That suite fails if a new call site reaches a bucket the policies do not
cover, if `faces`/`revealed` are touched with a user-scoped client, or if a
later migration adds an unscoped permissive policy.

**Empirical check (optional, ~2 min).** In an admin browser session, copy the
`access_token` from the `sb-<project>-auth-token` entry in DevTools →
Application → Local Storage, then:

```bash
# faces: expect an error / empty result — the fence denies the row
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/sign/faces/<some>.jpg" \
  -H "Authorization: Bearer <access_token>" -H 'Content-Type: application/json' \
  -d '{"expiresIn":60}'
# same face through the gateway: 200 for a director, 403 for a narrower level
curl -s -o /dev/null -w '%{http_code}\n' https://aicctv.dev/api/faces/<face-id>/secure-crop \
  -H 'Cookie: <browser session cookies>'
```

**Symptoms if a bucket was narrowed too far** — never a lockout, always a
missing image: a placeholder instead of a suspect photo on `/suspects`, a
blank player on `/playback/[id]` for a `baked` recording, or `UPLOAD_FAILED`
when adding a suspect photo. The Vercel log shows a row-level-security error
for the upload case.

**Kill switch.** The migration header carries two paste-able rollbacks: a
narrow one that reopens only `faces` (for a one-off sealing job) and a full
one that restores the old blanket admin grant. Both are plain SQL — no deploy,
no code change. Restoring the blanket grant re-opens the crop bypass, so treat
it as break-glass and note it in `audit_log`.

---

## 5. Notifications

Every operator-facing event fans out best-effort (a broken channel is logged,
never blocks the request that triggered it). Source: `lib/notify.ts`.

| Event | Trigger | Channels |
|---|---|---|
| Suspect alert | `alerts` INSERT trigger (`notify_telegram_on_alert`, pg_net) | Telegram · webhooks (`alert_created`) · web push (`/api/push/dispatch`) |
| Reveal request (4-eyes) | `POST /api/reveal/start` → job `pending_approval` | Telegram · webhooks (`reveal_requested`) · web push to every admin **except the requester** → `/reveal-approvals` |
| Reveal decision | `approveRevealAction` / `rejectRevealAction` | Telegram · webhooks (`reveal_completed`, status `approved` / `rejected`) · web push to the requester → `/jobs` |
| ML service down / recovered | in-DB uptime monitor (below) | Telegram (🔴 `ml_down` / 🟢 `ml_recovered`) |

All Telegram traffic goes through the `telegram-alerts` edge function
(`supabase/functions/telegram-alerts/index.ts`), which branches on
`payload.kind`. Redeploy it after any message change:
`npx supabase functions deploy telegram-alerts --project-ref ulybenitqmqjfxtaregp`.

### Uptime monitor (pg_cron)

Vercel Hobby crons are daily, so the 5-minute probe lives in Postgres
(`supabase/migrations/20260906170200_uptime_monitor_pg_cron.sql`):

1. `mongolz-uptime-probe` (`*/5 * * * *`) — `net.http_get` on
   `https://aicctv.dev/api/uptime`, row inserted into `public.uptime_checks`.
2. `mongolz-uptime-collect` (`2-59/5 * * * *`) — parses the response into
   `ml_ok` / `db_ok` / `status`; on an ML ok↔down transition between the two
   latest probes it POSTs `{"kind":"ml_down"|"ml_recovered","checked_at":…}`
   to the edge function once (`notified` column) and prunes rows > 30 days.

Inspect:

```sql
select checked_at, http_status, ml_ok, db_ok, status, notified
  from public.uptime_checks order by checked_at desc limit 20;

select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

No Telegram on an outage usually means the vault secrets are missing
(`select name from vault.decrypted_secrets` must list `edge_url` and
`service_role_key`) or the edge function returned non-2xx — check
`net._http_response` for the latest `request_id`.

---

## 6. Contacts (capstone scope)

| Role | Contact |
|---|---|
| Owner | khajybyek@gmail.com |
| Security disclosure | khajybyek@gmail.com → see SECURITY.md |
| Supabase support | Supabase Dashboard → Help |
| Railway support | Railway Dashboard → Help |
| Vercel support | Vercel Dashboard → Help |

---

## 7. Document control

- **Version:** 2.0 (replaces v1)
- **Last reviewed:** 2026-05-17
- **Next review:** 2026-11-17
