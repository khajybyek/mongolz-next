# 0006 — Step-up TOTP re-authentication for sensitive views

* **Status:** Accepted
* **Date:** 2026-05-18

## Context

The session cookie sets a 7-day TTL. That's good UX for browsing
dashboards but too long for actions that *unmask faces* or *expose
every detected thumbnail in the database*. A stolen, still-valid
cookie should not be enough to walk away with the entire face corpus.

NIST SP 800-63B § 5.2.6 calls this "re-authentication" — the user
proves continued possession of an authenticator before a sensitive
action.

## Decision

A 15-minute `mongolz-reauth` HMAC-signed cookie issued after a fresh
TOTP code is verified. Pages and actions that need a fresh proof call
`hasFreshReauth(user.id)` (server) or trip a `TotpPrompt` modal
(client).

Surfaces gated today:

- `/playback/[id]` reveal modal (face reveal flow).
- `/faces` page (every detected face thumbnail — densest privacy
  surface).
- User CRUD (create, role-toggle, password reset).
- Suspect deletes.
- Backup export.
- Recovery code regeneration.

Cookie format:

```
mongolz-reauth = HMAC-SHA256(REAUTH_COOKIE_SECRET, "${user_id}:${expires_at}") . ":" . expires_at
```

TTL: 15 minutes. The user re-prompts after that window for any
re-authentication-gated action.

## Consequences

### Positive

- A leaked session cookie alone cannot reveal faces — attacker must
  also have the TOTP authenticator on the same device.
- The `/faces` densest privacy surface gets the same treatment as a
  reveal — no asymmetric weak point.
- Implementation cost is small (~100 lines: `lib/auth/step-up.ts` +
  `components/totp-prompt.tsx` + `components/reauth-gate.tsx`).

### Negative

- UX friction: admins re-type a 6-digit code every 15 min for sensitive
  ops. Mitigation: 15 min is long enough to batch multiple actions in
  one session.
- Recovery code path needs care — a single-use code that triggers a
  reauth is essentially a 24-hour-window bypass. Mitigation: recovery
  codes are SHA-256 hashed and rate-limited (5/min via REAUTH_LIMIT).

### Alternatives considered

* **WebAuthn passkey for every action** — the *better* answer for
  capabilities. We ship passkey support too (ADR-out-of-scope: WebAuthn
  flow) but TOTP step-up covers the no-passkey case which still applies
  to many admins.
* **Push approval (Slack/Telegram)** — would require an external service
  capable of standing in for the *human present* assumption. Deferred.
