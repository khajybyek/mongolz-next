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
- User report via khajybyek@gmail.com (security.txt)

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

### 3.1 Inputs

- A `mongolz-backup-<ts>.zip` produced by `/api/admin/backup` (admin-only,
  TOTP-gated).
- A clean Supabase project for restore (different `project_ref`).

### 3.2 Steps

1. **Unzip the backup**

   ```bash
   unzip mongolz-backup-*.zip -d ./restore
   ls restore/tables/      # 12 JSON files (one per table)
   ls restore/buckets/     # 5 manifest.json files
   ```

2. **Apply schema**

   ```bash
   cd mongolz-next
   npx supabase db push --linked
   ```

3. **Load rows** (in dependency order)

   ```bash
   npx tsx scripts/restore-from-backup.ts ./restore --apply   # dry-run without --apply
   ```

   The script inserts in this order:
   - `profiles` first (FK target for many tables).
   - Then `cameras`, `suspects`, `alert_rules`.
   - Then `alerts`, `recordings`, `reveal_jobs`.
   - Then `webhooks`, `camera_permissions`, `masking_schedules`,
     `retention_policies`.
   - Finally `audit_log` in `created_at` order so the hash chain re-binds.

4. **Re-encrypt blob bytes**

   The backup ZIP does **not** contain encrypted MP4s — only manifests. To
   actually restore recording bytes, copy them from your **offline** Supabase
   storage mirror or rely on Supabase Pro point-in-time backup. After upload:

   ```bash
   npm run backup:verify
   ```

5. **Re-key if rotation occurred**

   If `ML_ENCRYPTION_KEY` was rotated since the backup, set
   `ML_ENCRYPTION_KEY_PREV` on the restore environment (see CLAUDE.md →
   Key Rotation Procedure).

6. **Verify**

   ```sql
   SELECT count(*) FROM verify_audit_chain();   -- 0 = healthy
   -- expect 0
   ```

   ```bash
   curl -s "$RESTORE_URL/api/uptime" | jq
   # expect status=ok, ml=ok, db=ok
   ```

7. **Record drill outcome**

   ```sql
   INSERT INTO audit_log (action, detail)
   VALUES ('BACKUP_RESTORE_DRILL',
           'Drill 2026-Q1: restore took <N> min, all checks ok, operator <name>');
   ```

### 3.3 Acceptance criteria for "successful drill"

- All 12 tables restored with row counts matching the manifest.
- `verify_audit_chain()` returns no mismatches.
- `/api/uptime` returns `status: ok`.
- A test alert can be inserted and triggers a webhook.
- A test reveal job completes end-to-end on a sample recording.

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
