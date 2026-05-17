# 0004 — Hash-chained immutable audit log

* **Status:** Accepted
* **Date:** 2026-02-22

## Context

Audit trails are useless if a privileged user can edit history. A
"trust me, bro" log makes incident response impossible. We need
*tamper-evident* records of every reveal, every admin action, every
auth event.

Constraints:

- Must live in Postgres (no external Splunk / Datadog logging budget).
- Verifiable by an auditor *without* trusting the application code.
- Storage overhead < 5 % per row.

## Decision

`public.audit_log` has columns:

| col | purpose |
|-----|---------|
| `id` | bigserial PK |
| `action` | enum-like text (`LOGIN`, `REVEAL_REQUESTED`, …) |
| `detail` | free-form text |
| `user_id` / `user_email` | who |
| `ip` | inet — where |
| `created_at` | timestamptz — when |
| `prev_hash` | hex SHA-256 of the previous row's `row_hash` |
| `row_hash` | hex SHA-256 of `(prev_hash ‖ id ‖ action ‖ detail ‖ user_id ‖ ip ‖ created_at)` |

A `BEFORE INSERT` trigger computes `row_hash` and pins `prev_hash` to
the most recent committed row's `row_hash`.

`verify_audit_chain()` SECURITY DEFINER function walks the table and
returns any row whose `row_hash` doesn't reproduce — a one-call
forensic check.

The `/audit` page exports a CSV plus a button to call
`verify_audit_chain()` in real time.

## Consequences

### Positive

- Tampering = chain break = `verify_audit_chain()` flags the row.
- No external dependency, no off-site mirror needed for evidentiary
  integrity.
- Cheap: ~80 bytes overhead per row.

### Negative

- A determined attacker with `service_role` key could rewrite every
  row + re-hash every link. Mitigation: anchor `row_hash` of the head
  row daily to an external append-only store (Sentry log? Telegram
  channel? — left as follow-up).
- INSERT order matters under concurrent writes; the trigger uses
  `SELECT ... FOR UPDATE` on the previous head to serialise.

### Auditor workflow

```sql
SELECT * FROM verify_audit_chain();
-- expected: zero rows. Any row returned = chain broken at that id.
```
