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
| Weekly | Review `audit_log` for `KEY_ROTATION_DUE` (clear it by rotating — see *Key rotation* below), `BREAK_GLASS_*`, `ADMIN_COUNT_ZERO` rows; check **Nuclei** + **OWASP ZAP** DAST reports (Monday 06:00 UTC) |
| Monthly | Confirm `npm audit --omit=dev`, Semgrep, and the DAST baseline have no new criticals |
| Quarterly | Restore drill on staging (§3); re-check pgvector index sizing against the current row counts (*Vector index sizing* below) |
| Semi-annually | Review COMPLIANCE.md for regulation changes |

### Key rotation

`/api/cron/key-rotation-check` runs Mondays 05:00 UTC and reports a key as due
when the newest `<NAME>_ROTATED` row in `audit_log` is older than its cadence.
A key that has never been rotated is dated from the deployment's first audit
row, so a fresh install is not overdue on day one — but an old deployment with
no rotation history is, and rightly.

**The warning is cleared by rotating, not by ignoring it.** `scripts/rotate-keys.ts`
writes the `<NAME>_ROTATED` row itself (service role) at the end of a
successful rotation; nothing else does.

| Key | Where | Cadence | Command |
|---|---|---|---|
| `STREAM_TICKET_SECRET` | Vercel | 180d | `npm run rotate:keys -- --key=STREAM_TICKET_SECRET` |
| `REAUTH_COOKIE_SECRET` | Vercel | 180d | `npm run rotate:keys -- --key=REAUTH_COOKIE_SECRET` |
| `SESSION_PIN_SECRET` | Vercel | 180d | `npm run rotate:keys -- --key=SESSION_PIN_SECRET` |
| `CAMERA_URL_KEY` | Vercel | 180d | rotate → redeploy → `npm run encrypt:camera-urls -- --reencrypt` → `--finalize` |
| `ML_ENCRYPTION_KEY` | Railway | 180d | rotate → `railway up --detach` → **keep the PREV key** (BREAK_GLASS §4) |
| `ML_SERVICE_TOKEN` | Railway **and** Vercel | 90d | by hand (below), then `--mark-rotated` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard | 365d | by hand, then `--mark-rotated` |

```bash
# The service-role credentials must come from the vault — `vercel env pull`
# writes NAME="" for every project variable and cannot supply them:
#   export NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...   # for the audit row
npm run rotate:keys -- --list                       # every key + the parser its value must satisfy
npm run rotate:keys -- --key=<NAME> --dry-run       # show what would change, write nothing
npm run rotate:keys -- --key=<NAME>                 # rotate + record the audit row
```

The audit row is written with the service role from the local env. Without
`.env.production.tmp` the script falls back to `.env.local`, which points at a
local `supabase start` stack — it refuses to write there and prints the SQL to
insert by hand instead, so a rotation is never recorded in the wrong database.

The script generates a value in the encoding the **consumer** parses (padded
URL-safe base64 for the Python side, padded standard base64 for
`lib/camera-crypto`, an opaque 256-bit string for the HMAC secrets) and
round-trips it through that parser before writing anything to a provider. If
validation fails nothing is changed — that is a bug in the generator, not a
reason to set the value by hand.

**Dual-key keys need the outgoing value, and Vercel will not give it to you.**
`vercel env pull` writes `NAME=""` for every project variable — the values are
never disclosed (verified: all 30 come back empty). Railway's CLI does return
them. So rotating `CAMERA_URL_KEY` requires the current key from your own vault:

```bash
CAMERA_URL_KEY_CURRENT='<outgoing key>' \
  npm run rotate:keys -- --key=CAMERA_URL_KEY --emit=./camera-url-key.new
# → move ./camera-url-key.new into the vault, then delete it
```

`--emit=<file>` writes the **new** value (mode 0600, refuses to overwrite) —
the only chance to capture it, since Vercel will not disclose it later and the
next rotation needs it as `CAMERA_URL_KEY_CURRENT`. The script warns when you
rotate a Vercel dual-key secret without it.

The value is read from the environment, never from argv, and the script
validates it before copying it into `CAMERA_URL_KEY_PREV`. Without it the
rotation is **refused** — silently overwriting the active key would leave every
sealed camera URL unreadable. If the outgoing key is genuinely lost, do not
rotate: re-enter each camera's URL on `/cameras` (saving re-seals it with the
current key), then rotate from a known-good state. Whatever new value you set,
**store it in the vault immediately** — this is the last moment it can be
captured on the Vercel side.

Rotating a secret changes live behaviour, so expect these:

- `REAUTH_COOKIE_SECRET` → every step-up cookie is void; admins re-verify TOTP.
- `SESSION_PIN_SECRET` → session pins stop matching; TOTP users are signed out once.
- `STREAM_TICKET_SECRET` → in-flight HLS tickets stop verifying; viewers reload.
- `CAMERA_URL_KEY` → until `--reencrypt` finishes, camera URLs decrypt via the
  PREV key; `/live` shows "camera address could not be read" if the PREV key is
  missing.

**Rotating the two manual keys**

```bash
# ML_SERVICE_TOKEN — both sides, in this order, then record it
NEW=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')
cd ml-service && railway variables --set "ML_SERVICE_TOKEN=$NEW" && railway up --detach
cd .. && printf '%s\n' "$NEW" | vercel env add ML_SERVICE_TOKEN production --force && vercel deploy --prod --yes
npm run rotate:keys -- --key=ML_SERVICE_TOKEN --mark-rotated
unset NEW
```

Recording and reveal fail for the seconds between the two deploys; do it
outside a recording window. `SUPABASE_SERVICE_ROLE_KEY` is reissued in the
Supabase dashboard (Settings → API), updated on Vercel + Railway, then
recorded the same way.

**Finalising a dual-key rotation.** `--finalize` drops `<NAME>_PREV`. It is
allowed only for `CAMERA_URL_KEY`, and only after the script has verified from
the database that zero camera rows are still sealed with the retired key. For
`ML_ENCRYPTION_KEY` it refuses: no re-encryption pass exists, and dropping the
PREV key would destroy every recording and sealed face crop still under it —
see docs/BREAK_GLASS.md §4 for what would have to be built first and for the
deliberate accept-the-loss path.

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

### Vector index sizing (pgvector) — revisit as the tables grow

`faces.embedding` and `suspects.embedding` are searched with cosine distance
(`<=>`) by `match_faces()` / `match_suspects()`. Both were indexed with
**ivfflat sized for data that did not exist** — `lists=200` over 42 face rows
and `lists=100` over 4 suspects. ivfflat picks its centroids at *build* time
and a query probes `ivfflat.probes` lists (default **1**), so with more lists
than rows almost every list is empty and one probe inspects a single, nearly
random cell. That is a silent recall failure, not a slow query: a watch-listed
face simply is not returned. Migration
`20260909110000_alert_evidence_and_vector_indexes.sql` rebuilds both as
**HNSW** (`m=16, ef_construction=64`, pgvector 0.8.0), which is built
incrementally, has no training set to get wrong, and needs no rebuild as rows
accumulate.

Check the live state (read-only):

```bash
supabase db query --linked "
select i.indexrelid::regclass::text as index_name, am.amname as method,
       pg_get_indexdef(i.indexrelid) as def,
       (select reltuples::bigint from pg_class c where c.oid = i.indrelid) as est_rows
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_am am on am.oid = ic.relam
 where am.amname in ('ivfflat','hnsw');"
```

**When to revisit**

| Signal | Action |
|---|---|
| `faces` passes ~100k rows | Raise recall/latency deliberately: `set hnsw.ef_search = 100` in the RPC session (default 40) and measure; consider `m=32` on a rebuild |
| Search latency climbs while the table is idle | Check the index is actually used (`explain analyze` the RPC body); an unused HNSW index is dead weight, not a recall risk |
| Someone proposes ivfflat again | Only with `lists ≈ rows/1000` **at build time** and a scheduled `REINDEX` as the table grows — that is the maintenance HNSW avoids |
| A rebuild is needed on a large table | Build with `CREATE INDEX CONCURRENTLY` outside a migration (Supabase runs migrations in a transaction), then drop the old index |

`ml-service/tests/test_vector_index_sizing.py` fails if a later migration
reintroduces an ivfflat index or drops the cosine ops class.

### Camera liveness (capture heartbeat)

The status dots on `/grid`, `/wall` and `/cameras` used to be derived from the
newest **face detection**, so a working camera watching an empty corridor read
`stale` after 5 minutes and `offline` after 30 — and a camera whose feed had
died an hour ago still read `healthy` for 5 minutes. Only the capture loop can
answer "are frames arriving", so it now says so: every `CAMERA_HEARTBEAT_SEC`
(default 30 s, Railway env) of successful reads it stamps
`camera_sessions.last_heartbeat_at`, and `camera_health()` derives `status`
from that stamp. Detection recency moved to its own column.

| `status` | Meaning |
|---|---|
| `healthy` | last heartbeat < 90 s ago — frames are arriving |
| `stale` | last heartbeat < 10 min ago — wedged or the source dropped; the supervisor is retrying with backoff |
| `offline` | we *are* supposed to be capturing and frames stopped arriving (heartbeat older than 10 min). The only value that asserts a fault |
| `unknown` | nothing is capturing this camera (never started, stopped, disabled), or it is capturing and has not reported yet |

| `detection_status` | Meaning |
|---|---|
| `none` / `idle` | no faces ever / none in the last 30 min — normal for an empty corridor |
| `active` / `recent` | a face within 5 / 30 minutes |

So **"camera up, nothing detected"** is `status='healthy'` with `faces_1h = 0`
(the tile shows both), and **"camera not sending frames"** is `stale` /
`offline`.

**Rollout order matters:** apply the migration first, deploy the ML service
second. In between, every running camera reports `unknown` (honest) rather
than a wrong `healthy` or `offline`.

```sql
-- Who is actually capturing right now, and when did they last deliver?
select cs.camera_id, c.name, cs.auto_resume, cs.last_heartbeat_at,
       now() - cs.last_heartbeat_at as since_beat, cs.last_error
  from public.camera_sessions cs
  join public.cameras c on c.id = cs.camera_id
 order by cs.last_heartbeat_at desc nulls last;
```

`stale` with no `last_error` and a rising `restart_count` on `/camera/active`
usually means the source is reachable but not delivering (RTSP handshake OK,
no frames) — the loop exits after 100 consecutive failed reads and the
supervisor restarts it with backoff (5 s · 2ⁿ, capped at 300 s).

### ML benchmark (`/eval/bench` → `/benchmarks`)

The benchmark used to run on a uniform-noise image in which the detector finds
no face, so the "Embedding generation" row and the headline FPS timed a
*failed* detection. It now runs on a committed sample face
(`ml-service/samples/00.jpg`, scaled to a 640 px camera frame) and publishes
what it measured:

- `input_source` / `input_resolution` — the frame that was used;
- `faces_detected`, `embedding_measured` — **if `embedding_measured` is false
  the embedding and end-to-end rows are meaningless** (no face was found) and
  the response carries a `warning` saying so;
- `effective_fps` = `1000 / mean(detection)` — sustained frames per second on
  the capture path (InsightFace produces the embedding during detection);
  `effective_fps_end_to_end` keeps the old detect-then-embed figure, which
  double-counts detection;
- `measures` — one sentence per row describing the call it timed.

Numbers are not comparable with runs recorded before 2026-09-09.

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
