# Threat Model — MONGOLZ Security

> **Capstone 2026-01-CD-03-07 · 3B-26-1** · Last updated 2026-05-18

## 1 — Scope

This document applies STRIDE to MONGOLZ Security's three trust zones:

```
┌───────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│ External callers  │─────▶│ Edge / Application   │─────▶│ Data + ML services   │
│ (browser, crawler,│      │ (Vercel Next.js,     │      │ (Supabase Postgres,  │
│  attacker)        │      │  middleware, RLS)    │      │  Railway ml-service) │
└───────────────────┘      └──────────────────────┘      └──────────────────────┘
        Z1                          Z2                              Z3
```

| Zone | Trust | Examples |
|---|---|---|
| **Z1** | Untrusted | unauthenticated browsers, search crawlers, scripts, MITM attackers |
| **Z2** | Conditionally trusted | authenticated viewers / auditors / admins / super-admin |
| **Z3** | Trusted | server-side service-role + ML service + DB triggers |

## 2 — Assets & sensitivity

| Asset | Sensitivity | Storage |
|---|---|---|
| Raw recording with un-masked faces | **PII / GDPR Art.9** | AES-256-GCM per-recording HKDF key, Supabase `recordings` bucket, deleted by retention sweep |
| Masked recording (Cubist mosaic applied) | Low | Supabase `recordings` bucket, signed URLs |
| Suspect face embedding (512-dim ArcFace) | **PII (biometric)** | Supabase `suspects.embedding`, RLS admin-only |
| Suspect photo | **PII** | Supabase `suspects` bucket, RLS admin-only |
| Reveal-job output video | **PII** | Supabase `revealed` bucket, signed URLs, retention sweep |
| Audit log | **Forensic** | Hash-chained, RLS auditor-readable, immutable trigger |
| TOTP secret | **Secret** | Supabase `profiles.totp_secret`, service-role only |
| Recovery codes | **Secret** | `profiles.totp_recovery_codes` SHA-256 hashed |
| WebAuthn credentials | **Public key only** | `webauthn_credentials` RLS-self-only |
| Service-role JWT, ML token, encryption keys | **Critical** | Vercel/Railway env vars (encrypted) |
| Session cookie + pin HMAC | High | HttpOnly + SameSite=Lax + Secure |

## 3 — STRIDE matrix

### Spoofing

| Threat | Mitigation | Status |
|---|---|---|
| Stolen password reuse | Rate limit (5 fails/email/15min, 10/IP/15min) + TOTP 2FA + WebAuthn passkey + audit (`LOGIN_FAILED`) | ✓ |
| Stolen session cookie | Session pin (IP/16 + UA fingerprint, HMAC-signed, 7-day TTL) | ✓ |
| Replay of TOTP code | `consume_totp_code` RPC tracks `(user_id, code_hash)` in `totp_used_codes` table, 90s TTL | ✓ |
| Username enumeration | `email_for_username` RPC service-role only (revoked from anon/authenticated), generic 400 on /login | ✓ |
| ML-service identity spoofing | `hmac.compare_digest` on `ML_SERVICE_TOKEN` bearer, dual-key rotation supported | ✓ |
| Webhook destination poisoning | DNS-rebinding defense (pre + post lookup, private-IP regex), HTTPS-only | ✓ |
| Spoofed Telegram bot | `TELEGRAM_WEBHOOK_SECRET` HMAC-signed payload check | ✓ |

### Tampering

| Threat | Mitigation | Status |
|---|---|---|
| Modifying audit_log rows | BEFORE INSERT trigger writes `prev_hash` + `row_hash` (SHA-256 chain); `verify_audit_chain()` RPC detects any break | ✓ |
| Encrypted recording tampering | AES-256-GCM `authTagLength: 16` — decrypt fails on any byte modification | ✓ |
| RLS bypass via SECURITY DEFINER | Every SECURITY DEFINER function has `SET search_path TO 'public', 'pg_catalog'` (schema poisoning blocked) + REVOKEd from PUBLIC | ✓ |
| Stream segment path traversal | `_safe_hls_path()` regex `[A-Za-z0-9._-]+` + `realpath` boundary check inside `HLS_DIR` | ✓ |
| Open-redirect via /auth/callback | `sanitizeNextPath` blocks `//`, `://`, `\`; only single-slash internal paths pass | ✓ |
| Super-admin demotion | DB trigger `protect_super_admin` refuses anon/authenticated UPDATE/DELETE; only postgres + service_role can flip | ✓ |
| Recording chunk re-assembly tampering | Per-chunk SHA-256 not yet enforced (future work — chain of custody hash manifest) | ⚠ partial |

### Repudiation

| Threat | Mitigation | Status |
|---|---|---|
| Admin denies reveal action | `reveal_jobs` row with requested_by/email + reauth_at + approved_by/email + ip; hash-chained audit also captures REVEAL_REQUEST | ✓ |
| Operator denies suspect upload | `SUSPECT_ADD` audit row with user_id + ip | ✓ |
| User denies passkey enrollment | `PASSKEY_ENROLL` audit row with credential_id (truncated) + device_name | ✓ |
| User denies failed login | `LOGIN_FAILED`, `TOTP_LOGIN_FAILED`, `TOTP_LOGIN_REPLAY_BLOCKED`, `PASSKEY_LOGIN_FAILED` distinct actions | ✓ |
| Bulk modification denial | INSERT-only audit_log + UPDATE/DELETE trigger raises | ✓ |

### Information disclosure

| Threat | Mitigation | Status |
|---|---|---|
| Cross-org PII leak via RLS bug | 24 policies × 14 tables, all reviewed by Supabase advisor (zero WARN-level after this session); `private.is_admin()` + `private.is_super_admin()` accessors | ✓ |
| Service-role key in client bundle | `SUPABASE_SERVICE_ROLE_KEY` never prefixed with `NEXT_PUBLIC_`; proxy/middleware never exposes it | ✓ |
| Camera RTSP credentials leaked to viewer | `cameras.url` returned as `null` to viewer role via RLS-conditional select | ✓ |
| Error messages leaking schema | API returns `{ error: <generic> }`, raw Postgres errors logged server-side only | ✓ |
| Stack trace exposure | Next.js production build elides stack frames; Sentry beforeSend strips sensitive `/api/auth/*` cookies | ✓ |
| ML embedding leakage | Embeddings never leave the server unless an admin explicitly downloads via /api/gdpr/export; pgvector index is RLS-protected | ✓ |
| Referrer leak to 3rd parties | `Referrer-Policy: strict-origin-when-cross-origin` | ✓ |
| FastAPI `/docs` schema leak | Disabled in production unless `ALLOW_API_DOCS=1` | ✓ |
| CSP report leaking page URL | CSP report-uri → `/api/csp-report` → forwarded to Sentry with truncated document_uri | ✓ |

### Denial of service

| Threat | Mitigation | Status |
|---|---|---|
| Login brute force | Per-email + per-IP rate limit | ✓ |
| Reveal job spam | 1-hour cool-down per admin (20 max), 4-eyes approval enforces human-in-the-loop | ✓ |
| Upload size flooding | 4MB chunk limit on `/api/recording/upload` + 4MB cap on `/api/ml/anti-spoof`; Vercel body limit 4.5MB on Hobby tier | ✓ |
| Compute exhaustion via /api/ml/bench | Iterations clamped [1, 100] | ✓ |
| Sentry quota DoS via `/api/sentry-test` | Admin-gated (`requireAdminApi`) — anon hits get 401 | ✓ |
| WebAuthn challenge spam | 5-min TTL on `webauthn_challenges` + single-use consume + same login rate-limit bucket | ✓ |
| RLS-bypass via cron | `process.env.VERCEL_ENV !== "production"` fail-closed for cron endpoints | ✓ |
| Recording write-amplification | Chunked uploads + ML async background processing prevents Vercel timeout | ✓ |

### Elevation of privilege

| Threat | Mitigation | Status |
|---|---|---|
| Viewer → admin via DB tampering | RLS + service_role-only role mutations + last-admin protection (`USER_DELETE` action) | ✓ |
| Privileged-RPC abuse | `restrict_rpc_functions_from_anon` migration locked `match_faces`, `match_suspects`, `verify_audit_chain` to admin only | ✓ |
| Auditor accesses non-audit routes | Middleware allow-list — auditor only `/audit*`, all others redirect | ✓ |
| Admin self-elevates to super-admin | DB trigger `protect_super_admin` rejects INSERT/UPDATE setting `is_super_admin = true` from non-service-role | ✓ |
| Edge function spoofing internal | Edge function bearer auth via `TELEGRAM_WEBHOOK_SECRET` + `service_role_key` in Supabase Vault | ✓ |
| Cross-tenant access (future) | Out-of-scope until multi-tenant `org_id` feature lands | ⚠ N/A |

## 4 — DREAD scoring (top 10)

| # | Threat | Damage | Reproducibility | Exploitability | Affected | Discoverability | Score |
|---|---|---|---|---|---|---|---|
| 1 | Stolen service-role key | 10 | 10 | 8 | 10 | 5 | **8.6** |
| 2 | DB tampering on audit_log | 10 | 5 | 4 | 10 | 6 | **7.0** |
| 3 | Stolen reveal output URL | 7 | 9 | 9 | 6 | 7 | **7.6** |
| 4 | TOTP secret leak | 8 | 5 | 6 | 8 | 5 | **6.4** |
| 5 | Webhook destination SSRF | 5 | 6 | 4 | 6 | 6 | **5.4** |
| 6 | Username enumeration | 4 | 9 | 9 | 5 | 8 | **7.0** |
| 7 | Privileged RPC abuse | 8 | 4 | 4 | 9 | 4 | **5.8** |
| 8 | Recording bucket signed URL replay | 6 | 7 | 8 | 5 | 6 | **6.4** |
| 9 | Cross-camera RLS bypass | 9 | 3 | 3 | 9 | 3 | **5.4** |
| 10 | XSS in user-supplied suspect name | 6 | 7 | 5 | 7 | 6 | **6.2** |

> All top-10 threats are mitigated by at least one control listed in §3. Highest residual: stolen service-role key, addressed by rotation procedure in `BREAK_GLASS.md` + Sentry alert on suspicious activity.

## 5 — Residual risks (accepted)

| # | Risk | Why accepted | Mitigation |
|---|---|---|---|
| R1 | Service-role key in Vercel env | Standard Vercel pattern; rotation procedure documented | `npm run rotate:keys -- --key=ML_SERVICE_TOKEN`, `BREAK_GLASS.md` §4 |
| R2 | No external annual pentest | Capstone budget; replaced by continuous SAST (Semgrep 681 rules) + secret scanning (trufflehog) + DAST (Nuclei + ZAP weekly) + multi-agent code review | `PENTEST_REPORT.pdf` 9-page consolidated |
| R3 | Supabase Pro "leaked password" check disabled | Free tier limitation | Strong-password policy (8+ chars, complexity) + rate limit + lockout alert |
| R4 | No multi-tenant org_id | Out of capstone scope | Tracked in `docs/FUTURE.md`; super-admin DB trigger pattern is the first step toward role isolation |
| R5 | Per-chunk SHA-256 manifest not enforced on recording uploads | Vercel free-tier compute budget | Server-side recording reassembly is single-author; tampering risk requires service-role compromise (R1) |
| R6 | Live suspect-match overlay shares Realtime channel with global RealtimeAlerts | Duplicate-subscription is wasteful but functionally correct (RLS still enforces) | Tracked in `docs/FUTURE.md` |

## 6 — How this gets re-evaluated

Threat model is re-reviewed:
- Before every release that touches an auth flow, RLS policy, or new attack surface
- After any incident postmortem
- Quarterly even with no changes (capstone scope: at the time of paper revision)

Last review: 2026-05-18 by primary author. Next: when WebAuthn discoverable-login lands (planned).
