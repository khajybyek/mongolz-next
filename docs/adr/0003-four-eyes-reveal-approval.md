# 0003 — Four-eyes principle for face reveal

* **Status:** Accepted
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
   constraint in the schema.

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
