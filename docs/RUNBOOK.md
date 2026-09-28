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
| **MTTD** (detect) | ≤ 5–10 min for web app / DB-path / ML outages (a complete Postgres outage stops the in-DB probe; the hourly GitHub Actions probe covers it, §5); ≤ 24 h for failed-login spikes, backup-verify failures and overdue keys | pg_cron uptime probe (*/5) + Sentry; daily `/api/monitoring/error-rate`, daily `backup-verify`, weekly `key-rotation-check` | The Hobby plan allows at most one run per day per cron, so the scheduled checks cannot detect in minutes. Their alarms reach admins by push + Telegram (`lib/notify.ts#notifyOpsAlarm`) and appear on `/health` ("Scheduled checks"); Slack only if `SLACK_ALERT_WEBHOOK` is set. |
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
  curl -s https://aicctv.dev/api/uptime
  curl -sI https://aicctv.dev/login | head -3
  ```

#### Break-glass: operators locked out by the rate limiter

`RATE_LIMIT_MODE` (lib/rate-limit.ts) switches the throttle: `enforce`
(default, atomic counter, fail-closed), `legacy` (old audit-log counting,
fail-open) or `off` (no throttling; every call logs a warning). Vercel applies
env changes only to a **new deployment**: set it in Production env, redeploy,
let the operator in, then restore `enforce` (or unset it) and redeploy again.
A narrower alternative that needs no redeploy: delete the offending counter
row from `private.rate_limits` (keys are `<bucket>:<user id | ip>`; check the
key format in `rate_limit_hit()` first).

Edge-function switch: `CLAUDE_MODEL` (Supabase Edge secret for
`claude-analysis`, optional) overrides the default model; the function falls
back through its sonnet/haiku chain when the chosen model refuses or fails.

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

Run on an isolated staging project every semester. The browser ZIP and complete
recovery bundle serve different purposes:

| Artifact | Contains | Must stay separate from |
|---|---|---|
| Browser biometric ZIP | Restorable row dumps, biometric embeddings, and every DB-referenced Storage path | Source service-role credentials |
| Recovery bundle | Every browser-ZIP file and referenced Storage object, each sealed with a random recovery data key; only paths/counts/hashes remain visible in its manifest | Key escrow |
| Key escrow | Recovery data key plus active/previous camera and recording keys, protected with scrypt + AES-256-GCM | Bundle and passphrase |

The workflow still excludes Supabase `auth.users`, TOTP seeds, recovery codes,
passkeys, webhook bearer URLs/HMAC secrets, and push endpoint keys. Restore the
auth schema from PITR or recreate users with the same UUIDs before loading
`profiles`; operators re-enrol 2FA and operators recreate webhooks/push.

### 3.1 Inputs

- A complete `mongolz-backup-biometric-<ts>.zip` from `/backup`, created by the
  super admin after fresh TOTP verification.
- Read access to source Storage using `NEXT_PUBLIC_SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` while creating the bundle.
- Source `CAMERA_URL_KEY`, `ML_ENCRYPTION_KEY`, and any current `*_PREV` keys.
- `RECOVERY_ESCROW_PASSPHRASE` of at least 16 characters from the secrets vault.
- A migrated Supabase restore project with a different URL/project ref and the
  source auth users restored or recreated with the same UUIDs.

### 3.2 Steps

1. **Extract and inspect the biometric export**

   ```bash
   unzip mongolz-backup-biometric-*.zip -d ./backup-input
   jq '.complete, .include_biometrics, (.tables | map_values(.rows))' backup-input/manifest.json
   ```

   `complete` and `include_biometrics` must both be `true`. The bundle tool
   refuses anything weaker rather than silently creating a partial recovery.

2. **Create the complete recovery bundle while source Storage is available**

   ```bash
   export RECOVERY_ESCROW_PASSPHRASE='<value from secrets vault>'
   npm run recovery:create -- ./backup-input ./recovery-bundles/2026-Q3 \
     --key-escrow=../mongolz-2026-Q3.key-escrow.json
   ```

   The command seals every DB/table/manifest file, downloads and seals each
   Storage path, and records original plus sealed SHA-256 hashes. The recovery
   manifest is authenticated with HMAC from the data key and written last. A
   failed download removes the incomplete output. A path a row still
   references but Storage no longer holds (flagged `missing: true` in
   `buckets/*.manifest.json`, or answered "object not found") is listed in
   the signed manifest's `missing_objects` and printed as a warning instead of
   aborting; re-upload the object or clear the row's path.
   `manifest.json.not_exported` names the tables the export leaves out and why. The tool
   refuses to store escrow inside the bundle. Store bundle, escrow, and
   passphrase in three separate locations; securely delete the extracted
   biometric ZIP after the bundle validates.

3. **Prepare a different restore project**

   ```bash
   npx supabase db push --linked        # linked to the RESTORE project
   jq -r '.[] | [.id, .email, .role] | @tsv' backup-input/tables/profiles.json
   ```

   Restore the auth schema from PITR, or recreate/invite each account with its
   original UUID before loading rows. Set temporary passwords and require every
   operator to re-enrol TOTP/passkeys.

4. **Run cryptographic preflight without writes**

   ```bash
   export RESTORE_SUPABASE_URL='https://<restore-project>.supabase.co'
   npm run recovery:restore -- ./recovery-bundles/2026-Q3 \
     --key-escrow=../mongolz-2026-Q3.key-escrow.json
   ```

   This validates the HMAC-bound manifest, browser-backup hashes/counts, escrow
   authentication, every sealed and original DB/Storage checksum, every
   encrypted camera URL, and every encrypted recording's GCM tag plus full
   `ffprobe` decode scan. It also refuses a target whose project fingerprint
   matches the source.

5. **Restore and verify**

   ```bash
   export RESTORE_SUPABASE_SERVICE_ROLE_KEY='<restore project service role>'
   npm run recovery:restore -- ./recovery-bundles/2026-Q3 \
     --key-escrow=../mongolz-2026-Q3.key-escrow.json --apply
   ```

   The command uploads each original Storage object and downloads it again to
   compare SHA-256, loads rows in FK order, checks every restorable table count,
   decrypts every target camera URL, writes `BACKUP_RESTORE_DRILL` to the target
   audit log, and creates a mode-0600 `recovery-report-*.json`. Only tables that
   the authenticated manifest already marks unrestorable (webhook/push secrets)
   may be skipped; any unexpected skip or mismatch exits nonzero. There is no
   damaged-object skip mode. Files above 6 MiB use resumable chunk upload.

6. **Application smoke test**

   ```sql
   SELECT count(*) FROM verify_audit_chain();   -- 0 = healthy
   ```

   ```bash
   curl -s "$RESTORE_URL/api/uptime" | jq       # status=ok, ml=ok, db=ok
   ```

   Log in as a restored admin, re-enrol TOTP, open `/cameras`, play a restored
   recording, run a biometric search, and send a test alert to a re-created
   webhook. Attach the generated recovery report to the drill record.

### 3.3 Acceptance criteria for "successful drill"

- Cryptographic preflight passes before any target write.
- Every restorable table count matches the browser backup manifest.
- Every referenced Storage object round-trips with the source SHA-256.
- Every camera URL decrypts with the escrowed active/previous key.
- Every encrypted recording authenticates and decrypts to MP4/WebM.
- Auth users can log in and re-enrol 2FA; `verify_audit_chain()` is clean.
- `/api/uptime` is healthy, a restored recording plays, biometric search finds
  a restored suspect, and a recreated webhook receives a test alert.
- The audit log contains `BACKUP_RESTORE_DRILL`; the recovery report says
  `status: passed` and contains no key or plaintext camera URL.

If any check fails, file an issue with `[backup-restore]` label and treat it as
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
| `suspects` | admin: read + write + delete | `/suspects` pages sign and upload enrolment photos with the user-scoped client; deleting a suspect removes its photo with the service role |
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
| `offline` | we *are* supposed to be capturing and frames stopped arriving (heartbeat older than 10 min), or no frame ever arrived and the capture loop recorded `camera_sessions.last_error` (e.g. `source unreachable at open`; since migration 20260923120000). The only value that asserts a fault |
| `unknown` | nothing is capturing this camera (never started, stopped, disabled), or it was just started and has not reported yet |

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

A camera that is *waiting* for one of those retries (source unreachable,
capture crashed) is not in `cameras` on `/camera/active` — that list stays
"running, HLS playable" — but in `reconnecting`, with `state: "backoff"`,
`restart_count`, the sanitised `last_error` and `next_retry_at` (ISO UTC, the
supervisor tick that will act on it; `null` until the drop has been noticed).
`/live` and `/grid` show it as "Reconnecting — next try at HH:mm (KST)" to
anyone who may list the camera.

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
| Web app / database / ML down or recovered | in-DB uptime monitor (below) | Telegram (🔴 `web_down` · `db_down` · `ml_down` / 🟢 `web_recovered` · `db_recovered` · `ml_recovered`) |

All Telegram traffic goes through the `telegram-alerts` edge function
(`supabase/functions/telegram-alerts/index.ts`; the messages live in
`messages.ts` next to it), which branches on `payload.kind`. Redeploy it after any message change:
`npx supabase functions deploy telegram-alerts --project-ref ulybenitqmqjfxtaregp`.

### Uptime monitor (pg_cron)

Vercel Hobby crons are daily, so the 5-minute probe lives in Postgres
(`supabase/migrations/20260906170200_uptime_monitor_pg_cron.sql`, collector
redefined in `20260927110000_uptime_per_component_alerts.sql`):

1. `mongolz-uptime-probe` (`*/5 * * * *`) — `net.http_get` on
   `https://aicctv.dev/api/uptime`, row inserted into `public.uptime_checks`.
2. `mongolz-uptime-collect` (`2-59/5 * * * *`) — resolves each probe:
   - `web_ok = true` only when the reply is `/api/uptime`'s own JSON body
     (`checks.ml.ok` and `checks.db.ok` both booleans; HTTP 200 or 503).
     `ml_ok` / `db_ok` are copied from it.
   - Timeout, no response, an HTML 5xx or any other body → `web_ok = false`
     and `ml_ok` / `db_ok` stay **NULL** (unknown — not reported as down).
     `http_status` is `0` for timeout / no response.
   - Transitions, one Telegram message each (`{"kind":…,"checked_at":…}`),
     evaluated for every probe the run resolved (oldest first) plus the newest
     completed probe — a response that arrives late or a skipped collect tick
     resolves two probes at once and neither transition is lost:
     **web** a probe against the completed probe just before it; **db** and
     **ml** only while the web app answers — a probe against the most recent
     earlier probe the web app also answered, so a component that changed
     during a web outage is reported when the web comes back. Order: web,
     db, ml. `notified` lists every kind already sent for that probe
     (comma-separated), so a re-run never sends one twice.
   - Rows older than 30 days are pruned.

**Deploy order when the message set changes:** deploy `telegram-alerts`
first, then apply the migration — the old function renders unknown kinds as
an empty suspect alert.

**What the `db` check means.** `checks.db.ok` is Vercel → Supabase
(`probeDb()` in `lib/health-probes.ts`). When it fails while pg_cron still
runs, Postgres itself is alive and the fault is on the path the app uses
(PostgREST / pooler / API key / network). A **complete Postgres outage**
stops pg_cron as well, so this monitor goes silent instead of alerting —
see "External probe" below.

Inspect:

```sql
select checked_at, http_status, web_ok, ml_ok, db_ok, status, notified
  from public.uptime_checks order by checked_at desc limit 20;

select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

No Telegram on an outage usually means the vault secrets are missing
(`select name from vault.decrypted_secrets` must list `edge_url` and
`service_role_key`) or the edge function returned non-2xx — check
`net._http_response` for the latest `request_id`. No new `uptime_checks`
rows at all means pg_cron is not running — i.e. the database itself is down
or `cron.job` lost its schedule.

#### External probe (covers a full database outage)

Nothing inside Postgres can report that Postgres is down, so
`.github/workflows/uptime-probe.yml` probes from outside:

- **Schedule:** hourly at `:07` (`7 * * * *`) plus `workflow_dispatch` for a
  manual run (`gh workflow run uptime-probe.yml`). GitHub may delay scheduled
  runs by several minutes.
- **Check:** `scripts/uptime-probe.cjs` calls `https://aicctv.dev/api/uptime`
  up to three times, 20 s apart; the first healthy answer wins. The web app
  counts as up only when it returns its JSON contract (`checks.db.ok`,
  `checks.ml.ok`); a timeout, DNS/TLS error or Vercel HTML 5xx is "web down"
  with the database unknown.
- **Alerts:** one plain-text Telegram message per change — web down /
  recovered, database down / recovered — sent to the Bot API directly (no
  Supabase, no Vercel on the path). ML is left to the pg_cron monitor. State
  (`.uptime-state/state.json`) is carried between runs with `actions/cache`;
  a missing state counts as "all up", so an outage already under way is still
  reported. A failed Telegram delivery keeps the old state so the next run
  retries.
- **Fallback:** while web or database is down the job exits 1; GitHub e-mails
  the owner about each failed scheduled run, even without the Telegram
  secrets.
- **Owner action — secrets** (repository → Settings → Secrets and variables →
  Actions, or `gh secret set TELEGRAM_BOT_TOKEN` / `gh secret set
  TELEGRAM_CHAT_ID`, which prompt for the value): the same bot token and chat
  id the `telegram-alerts` edge function uses. Until they exist the job logs a
  warning instead of sending.
- **Cost:** this private repository bills every job as at least one minute:
  hourly ≈ 720 minutes a month. `*/30` doubles that; `*/15` (~2 900) exceeds
  GitHub Free's 2 000 — only on a plan with 3 000+ minutes.
- **Tests:** `__tests__/uptime-probe.test.ts` (classification, transitions,
  retries, delivery failure, missing secrets, no token in logs).

---

## 5a. Admin-privilege hardening — operator follow-ups (2026-09-17 review)

Shipped in code: factor-bound step-up cookie (a password step-up no longer opens
TOTP gates), operator allow-list in `requireUserApi()`, step-up on retention /
legal-hold release / camera-permission grant / camera enable / consent off,
super-admin-only admin creation, server-written push subscriptions,
`security_event` notifications. The items below need an operator.

1. **Deploy order.** Push the app → wait for the Vercel deploy → then apply
   `supabase/migrations/20260917150000_admin_privilege_hardening.sql`
   (`npx supabase db push --linked`, then `npm run gen:types`). The reverse order
   breaks "enable push notifications", camera add/edit/toggle and legal-hold release
   until the app is live (the new app writes `cameras`, `retention_policies`,
   `camera_permissions` and push/passkey rows with the service role and falls back to
   the old hold RPC while `release_incident_recording_hold` does not exist yet).
   **The migration is not optional:** until it is applied a password-only token can
   still delete passkeys, any user token can plant a push endpoint, and a stolen admin
   session can PATCH `retention_policies` / `cameras`, POST `camera_permissions`,
   DELETE `recordings|faces|alerts` and release a legal hold straight through
   PostgREST — skipping every step-up, audit row and notification added in the app.
   Verify after applying (expect only `SELECT`, plus `UPDATE`/`INSERT` on alerts/faces/recordings):
   `select table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and table_name in ('retention_policies','camera_permissions','cameras','recordings','faces','alerts','push_subscriptions','webauthn_credentials') group by 1;`
   Then redeploy both
   edge functions: `npx supabase functions deploy telegram-alerts --project-ref <ref>`
   (new `security_event` kind — until redeployed these messages render as a blank
   suspect alert) and `... deploy claude-analysis` (refuses password-only tokens,
   reads context under the caller's RLS).
2. **E-mail-minted sessions pass the data-tier MFA gate (OPEN — high).**
   `POST /auth/v1/otp` / `/auth/v1/recover` for an EXISTING admin yields a session
   whose `amr` is `otp`/`recovery`; `private.mfa_ok()` only refuses `amr=[password]`,
   and it cannot tell these from the sessions the app itself mints after TOTP /
   passkey (same `generateLink + verifyOtp` mechanism). It was deliberately NOT
   tightened in code: any stricter rule risks refusing the app's own sessions (the
   2026-09-08 lock-out). Until the TOTP seed is migrated to Supabase-native MFA
   (`aal2`) do all of:
   - Supabase Dashboard → Authentication → Hooks → **Send Email hook** that drops
     `magiclink`, `recovery`, `email_change` and `reauthentication` mails (the app
     never sends e-mail: it uses admin `generateLink`, which is unaffected). With no
     mail delivered, a mailbox holder cannot obtain the token.
   - Authentication → Rate limits → e-mail sent per hour = the minimum.
   - Admin mailboxes (both admins + super admin) must have their own 2FA.
   - Weekly: `select s.user_id, c.authentication_method, c.created_at from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where c.authentication_method in ('magiclink','recovery') order by c.created_at desc limit 20;`
     — a row without a LOGIN / PASSKEY_LOGIN audit row in the same minute is an incident
     (the app's own logins show as `otp`).
3. **Edge agent uses the master `ML_SERVICE_TOKEN` (OPEN — medium, latent:
   `edge_agents` has 0 rows).** Do not deploy an agent on a customer LAN until the ML
   service accepts a per-agent ingest token on `/edge/*` only. If one must be
   deployed first: treat the device as holding the master key — full-disk encryption,
   no shared accounts, and rotate `ML_SERVICE_TOKEN` (Railway + Vercel, see Key
   Rotation) the moment the device leaves your control. Not changed in this pass:
   it needs coordinated `ml-service/` + `edge-agent/` changes and a Railway redeploy.
4. **ML Python dependencies are unhashed (OPEN — medium).** `ml-service/requirements.txt`
   uses `>=` ranges and the Dockerfile installs without `--require-hashes`. Generate a
   lock on a Linux/py3.11 machine matching the image:
   `pip-compile --generate-hashes -o requirements.lock requirements.txt`, switch the
   Dockerfile to `pip install --require-hashes -r requirements.lock`, point CI's
   `pip-audit` at the lock, and verify a Railway build BEFORE removing the old path.
   Not done here: a lock generated on macOS would pin wrong wheels (onnxruntime,
   insightface, opencv) and break the Railway build. Add `PySocks==1.7.1` to
   requirements.txt first (hash mode refuses extra command-line packages) and use
   `--allow-unsafe`; insightface is an sdist, so pre-build its wheel or confirm the
   build dependencies resolve under hash mode. The Tailscale tarball IS now verified:
   the Dockerfile pins `TS_SHA256` and runs `sha256sum -c` before unpacking — bump it
   together with `TS_VERSION`.
5. **Tailscale auth key.** Use an ephemeral, tagged, single-purpose key and rotate it.
   Read the ML `GET /` → `tunnel.state`: `down` = the key is invalid or the tailnet
   never joined (rotate the key); `degraded` = the tailnet is joined but the
   `CAMERA_TAILNET_FWD` forward target is unreachable; `ok` = that target answers.
   The block describes the Tailscale forward ONLY: it says nothing about a camera
   whose URL does not go through `127.0.0.1:<fwd port>` (e.g. a public tunnel or a
   direct HTTP URL). Per-camera reachability is `camera_sessions.last_error` /
   `last_heartbeat_at`, so check those — and
   the camera's own URL on `/cameras` — before chasing the camera LAN. As of
   2026-09-23 the tunnel reports `degraded` and the only camera
   (`29b47088-…`, `cam_type=http`) has `last_error = "source unreachable at open"`
   with no heartbeat; `/health` shows the tunnel state instead of a green "ok".
6. **Known residual — direct PostgREST writes by a stolen admin session.** After the
   migration, a TOTP-minted admin token can still write, without step-up, the tables
   the app itself writes with the user token: at least `alert_rules`, `webhooks` and
   `alerts` (UPDATE only). `privacy_zones` left this list with migration
   `20260923180000` (service-role writes + TOTP step-up for loosening changes). None of
   these widens who sees unmasked video, but a planted webhook is possible; `/webhooks`
   lists every row. Closing it means moving those actions to the service role and
   revoking DML the same way.
   `suspects` was on this list and was NOT harmless: `alerts.suspect_id` was
   `ON DELETE CASCADE`, so deleting a suspect erased its alerts, TP/FP labels and
   incident links (referential actions ignore the DELETE revoke on `alerts`).
   Migration `20260923150000_suspect_delete_keeps_alerts` makes that FK
   `ON DELETE SET NULL` (the alert keeps `suspect_name`) and revokes suspect DML
   from `authenticated`; `/suspects` writes with the service role after step-up,
   audits `SUSPECT_DELETE` with the affected alert count and notifies the other admins.
   Deploy the app before applying that migration.
7. **Known residual.** Viewer/auditor accounts with TOTP cannot step up (the step-up
   routes are admin-only), so they cannot disable TOTP or enrol a passkey themselves;
   an admin resets them. Unchanged by this pass.

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
