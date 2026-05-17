# 0005 — Supabase RLS as primary authorization boundary

* **Status:** Accepted
* **Date:** 2026-02-08

## Context

We need authorisation that survives **even if the application code is
bypassed** — e.g., an attacker steals a session cookie and hits the
Supabase REST API directly with their own client.

Two layers were considered:

1. **App-only auth** — check `profile.role` inside every Next.js route.
   Easy to write, easy to bypass via direct DB call.
2. **DB-enforced auth (RLS)** — Postgres rejects unauthorised rows at
   the storage engine. App role checks are *defence in depth* but no
   longer the primary boundary.

PostgreSQL Row-Level Security is the canonical answer here.

## Decision

Every table has `ENABLE ROW LEVEL SECURITY` and explicit policies. The
app layer additionally checks `requireAdmin()` / `requireUserApi()` for
ergonomic redirects, but those are *redundant* — even if the app check
is missing, RLS will refuse the read/write.

Examples:

```sql
-- alerts: admins read all, others read none
CREATE POLICY alerts_admin_select ON public.alerts
  FOR SELECT TO authenticated USING (private.is_admin());

-- push_subscriptions: self-only CRUD
CREATE POLICY push_subscriptions_self_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
```

`private.is_admin()` and `private.current_user_role()` are
`SECURITY DEFINER` functions that consult `profiles.role`. They live in
the `private` schema so they cannot be invoked via `/rest/v1/rpc`.

## Consequences

### Positive

- An attacker with `anon` key + stolen JWT cannot read or write rows
  they don't own.
- New API routes inherit security automatically — even a forgotten
  `requireAdmin()` won't leak admin data.
- Audit log proofs survive a compromised service-role key only if the
  attacker also subverts hash-chain (ADR 0004).

### Negative

- Performance: RLS policies execute on every row. We wrap
  `auth.uid()` in `(SELECT auth.uid())` so Postgres evaluates it once
  per query (Supabase performance advisor `auth_rls_initplan` rule).
- Debugging: a missing `GRANT` or wrong `USING` silently returns
  zero rows instead of failing loudly. Mitigation: every new table
  ships with a smoke-test query in the migration.

### Service-role escape hatch

The Next.js `createServiceClient()` bypasses RLS and is used **only**
inside server-side code that already passed an admin check at the app
layer (e.g., cron jobs, push fan-out, audit-log insertion). It is
never exposed in API responses.
