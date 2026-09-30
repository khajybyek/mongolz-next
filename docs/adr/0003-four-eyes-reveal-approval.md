# 0003 — Four-eyes principle for face reveal

* **Status:** Accepted — amended 2026-09-30 (the super admin is exempt; see
  [Amendment](#amendment--2026-09-30-the-super-admin-reveals-without-a-second-admin))
* **Date:** 2026-03-04

## Context

Revealing a blurred face turns a privacy-preserving recording back into
PII. Even an *authorised* admin acting alone could:

- Be coerced (insider threat / blackmail).
- Make a mistake (wrong recording, wrong subject).
- Be a phishing victim (account takeover).

ISO 27001 A.5.18, NIST SP 800-53 AC-5, and PIPA Art.28-2 all recognise
"separation of duties" as the standard control for reversing pseudonym­
isation.

## Decision

Reveal is a **two-admin workflow**:

1. Admin A submits a reveal request via `/playback/[id]` → modal stores
   a row in `reveal_jobs` with `status='pending_approval'`,
   `requested_by = A`.
2. Admin B opens `/reveal-approvals`, reviews the scope (recording +
   target faces + time window + justification), and clicks
   *Approve* or *Reject*.
3. Only on `status='approved'` does the worker at
   `ml-service/reveal_job.py` decrypt the original frames and produce
   the un-blurred video.
4. A *cannot* approve their own request — enforced by a CHECK
   constraint in the schema. (Since 2026-09-30 the super admin's own
   request is the one exception — see the Amendment below.)

Both A's request and B's decision are written to `audit_log` with
hash-chain enforcement (ADR 0004).

## Consequences

### Positive

- One admin's compromise/coercion no longer leaks faces.
- Audit chain has the *intent*, the *approval*, and the *output* —
  forensically complete record.
- Operationally simple: one extra page in the admin UI, no extra infra.

### Negative

- Latency: reveal goes from "minutes" to "hours" depending on the
  second admin's availability. Mitigated by web push notifications
  (ADR-out-of-scope: push fan-out).
- Two-admin requirement implies a minimum staffing of 2 — solo
  operators must hold both accounts (and accept that audit makes
  the separation transparent).

### Reversal cost

Disabling four-eyes is a single migration + UI change. The
`reveal_jobs.status` enum already has `approved` so removing the
`pending_approval` gate is non-destructive.

## Amendment — 2026-09-30: the super admin reveals without a second admin

* **Status:** Accepted (owner decision)
* **Migration:** `supabase/migrations/20260930120000_super_admin_reveal_without_approval.sql`

### Decision

The project owner decided that the **super admin** — `profiles.is_super_admin`,
exactly one account (unique partial index), DB-locked by
`protect_super_admin()` — has full reveal rights: a reveal the super admin
requests runs **immediately, without a second admin's approval**. Every other
admin keeps the two-admin workflow above, unchanged.

How it is built (all three former 4-eyes layers changed, nothing else):

1. `POST /api/reveal/start` asks `public.super_admin_self_reveal_allowed()`
   (service role only). For the super admin, with the kill switch on, it
   first writes the audit rows (below), then inserts the job as
   `status = 'queued'`, `approval_required = false`,
   `approved_by = approved_email = the requester`, `approved_at = now()`, and
   triggers the ML worker — the same trigger and failure handling as
   `approveRevealAction`. Everyone else, and the super admin while the switch
   is off, still gets `pending_approval`.
2. CHECK `reveal_jobs_four_eyes_chk` still refuses `approved_by =
   requested_by`, except on a row with `approval_required = false`.
3. `claim_reveal_job()` accepts either the unchanged 4-eyes condition or a
   self-approved row whose requester is **still** the super admin (re-checked
   at claim time, so a demotion between request and run stops the job) while
   the kill switch is **still** on **and** whose
   `REVEAL_SUPER_ADMIN_SELF_APPROVED` ledger row (by the requester, detail
   starting `job <id> `) already exists. Scope, reason, reveal level,
   attempts and lease checks are unchanged.

A new BEFORE INSERT/UPDATE trigger, `guard_reveal_self_approval`, refuses
`approval_required = false` for anyone but the super admin, with the switch
off, or with an `approved_by` other than the requester — for every database
role, including the service role that writes `reveal_jobs`. A stolen normal
admin session, a forged service-role request or a hand-made row cannot create
an unapproved job. `approval_required` stays immutable after insert
(`freeze_reveal_request_scope`).

### Rationale

Owner decision (2026-09-30): the super admin account must have full reveal
rights and must not need anyone's approval to reveal. The decision is the
owner's; this amendment records it, how it is enforced, and which controls
remain.

### Controls that still apply to a super-admin reveal

- **Step-up with the second factor.** For everyone else a password step-up
  only files a request (the approver presents TOTP). Here the super admin is
  also the approver, so `/api/reveal/start` demands the TOTP-bound step-up
  (`REAUTH_TOTP_REQUIRED` otherwise); the reveal modal offers only the
  authenticator code.
- **Reason** of 10–1000 characters and the frozen request scope (recording,
  targets, window, threshold), the reveal level (ADR 0009), and the privacy
  schedule / spans / zones (ADR 0012) — unchanged.
- **Hash-chained audit** (ADR 0004): `REVEAL_REQUEST` plus a distinct
  `REVEAL_SUPER_ADMIN_SELF_APPROVED` row (job, recording, method, reason
  length), written in one statement **before the job row exists**. The
  durable ML worker picks up any queued row within seconds without waiting
  for the web, so the order matters: if the ledger cannot be written no job
  is created at all, and `claim_reveal_job()` refuses a self-approved job
  whose ledger row is missing, so such a job cannot run unrecorded whoever
  inserted it. When the job is then not created as self-approved (the
  database refused it and the request went to 4-eyes, or the insert failed),
  a `REVEAL_SELF_APPROVAL_ABORTED` row corrects the ledger. If the insert's
  outcome is unknown (no database verdict, e.g. a lost response), the web
  cancels the row while it is still queued; when it cannot prove that, it
  notifies the other admins anyway and tells the requester the outcome is
  unconfirmed (`START_UNCONFIRMED`).
- **Real-time notification**: every other admin gets a web push and the ops
  Telegram chat a `security_event` message (`scheduleSecurityEvent`),
  scheduled as soon as a self-approved job row exists — or may exist.
- **Visible in the lists**: `/reveal-approvals`, `/jobs` and the playback
  reveal history label the job "Self-approved (super admin)", never as a
  4-eyes approval.
- **Kill switch** (no deploy, immediate):
  `update private.security_settings set super_admin_self_reveal = false, updated_at = now(), updated_by = '<who>';`
  The web then sends the super admin through `pending_approval`, the trigger
  refuses new self-approved rows and the claim refuses queued ones.

### Risk accepted

Whoever controls the super admin's session **and** second factor can reveal
alone — the separation of duties this ADR introduced no longer holds for that
one account. ISO 27001 A.5.18 / NIST AC-5 / PIPA Art.28-2 separation of duties
is therefore met for every admin except the super admin; the compensating
controls are the ones listed above (TOTP step-up, audit, real-time
notification, kill switch). Recorded in `docs/THREAT_MODEL.md`,
`docs/COMPLIANCE.md` and `docs/DPIA.md`.
