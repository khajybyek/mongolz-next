# Defense Cheat Sheet — MONGOLZ Security

> **Capstone 2026-01-CD-03-07 · 3B-26-1**
> Open on phone during defense. Print one side, A4.

---

## 30-second elevator pitch (MN)

> "MONGOLZ Security нь олон эрхтэй mask + reveal боломжтой ухаалаг сүлжээний камер ба нэгдсэн удирдлагын сервер. Нүүр илрэхэд capture цэг дээр Cubist Voronoi mosaic-аар шууд masked болж, эх хувь нь AES-256-GCM-ээр encrypted-аар хадгалагдана. Зөвхөн **4-eyes approval**-той reveal flow л буцаах боломжтой. **VIP / standard / relaxed** privacy tier-ээр protection хүч автомат тохируулагдана."

## 30-second pitch (EN)

> "MONGOLZ Security is a multi-authority masking + reveal control server for intelligent network cameras. Every detected face is masked at capture time with a Voronoi-tessellation mosaic and stored encrypted with AES-256-GCM. Only a 4-eyes approval workflow can recover the original. Per-suspect privacy tiers (VIP / standard / relaxed) automatically adjust mask strength."

## 30-second pitch (KR)

> "MONGOLZ Security는 다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 통합관제 서버입니다. 원본은 AES-256-GCM으로 암호화 저장되고, 열람 시점에 모든 얼굴이 Voronoi 모자이크로 마스킹됩니다(평문 프레임이나 얼굴 조각은 저장되지 않습니다). 4-eyes 승인 흐름만 원본을 복원할 수 있고, 각 대상의 프라이버시 등급(VIP/standard/relaxed)에 따라 마스크 강도가 자동 조정됩니다."

---

## Architecture (one-line summary)

```
Camera → ML service (FastAPI, Railway, Singapore) → Supabase (Postgres + Storage + Auth + RLS) → Vercel (Next.js 16)
                                                                                                   ↳ Telegram bot
```

**5 layers of security**: (1) PostgreSQL RLS · (2) TOTP 2FA + replay tracking · (3) AES-256-GCM per-recording HKDF keys · (4) Hash-chained audit · (5) 4-eyes approval

---

## Top 15 panel questions + answers

### 1. "Brute force-аас яаж хамгаалж байна?" / "How is brute force protected?"

> 7 layers: rate limit (5 fail/email/15min + 10 fail/IP/15min) · TOTP replay tracking · timing-safe HMAC everywhere · session pinning (IP/16 + UA) · automatic lockout Slack alert · public RPC lockdown (`email_for_username` service-role only) · hash-chained audit log.

### 2. "Бусад attack-аас яаж хамгаалж байна?" / "What other threats?"

> 16 attack classes covered: XSS (nonce-CSP), SQLi (parameterized + RLS), CSRF (Server Actions + SameSite=Lax), Clickjacking (`frame-ancestors 'none'`), SSRF (DNS rebinding pre+post lookup, private-IP regex), Path traversal (regex + `realpath` boundary in HLS endpoint), Open redirect (`sanitizeNextPath`), Privilege escalation (server-side role + RLS + middleware allow-list), Replay (TOTP single-use, audit hash-chain), DoS (4MB payload caps, rate limits), Crypto (AES-256-GCM + HKDF + timing-safe), Supply chain (Semgrep + trufflehog + npm/pip audit), DAST (Nuclei + ZAP weekly), Header hardening (HSTS preload, X-CTO, Permissions-Policy).

### 3. "Supabase backend учир бид юу хамгаалж байна?" / "What protection is OURS vs Supabase's?"

> **Shared responsibility model**. Supabase: TLS, DDoS-edge, Postgres engine, bcrypt password hashing, base auth JWT/refresh, infra patching. **OUR application layer**: every RLS policy text, TOTP replay tracking, AES-256-GCM per-recording HKDF encryption, 4-eyes reveal workflow, hash-chained audit log (`verify_audit_chain`), rate limiting, session pinning, CSP nonce, SSRF defense, path-traversal validation, webhook signing, super-admin DB trigger.

### 4. "VIP / protected witness яаж хамгаалагдаж байна?" / "How are VIPs protected?"

> Per-suspect `privacy_tier` (vip/standard/relaxed). When that suspect's face is detected in any recording, ArcFace embedding is matched against the in-memory suspect cache (cosine ≥ 0.40 threshold), and Cubist mosaic params are picked accordingly: VIP → 50-90 polygons + 1.6σ blur (2-3x stronger), standard → 18-40 + 0.7σ, relaxed → 10-18 + 0.4σ. Overlapping detections pick the most protective tier.

### 5. "Reveal flow яаж аюулгүй вэ?" / "How is reveal kept safe?"

> Five guards: (a) admin-only access via `requireAdmin()` + step-up TOTP. (b) 4-eyes approval — another admin must approve in `/reveal-approvals` before ML kicks off. (c) Optional **time-bounded window** — reveal limited to e.g. [0:15 → 0:45], rest of recording stays masked ("principle of least privilege"). (d) Selective face-level — only the chosen face_ids are unmasked, others stay masked. (e) Watermark on output (revealer email + timestamp). All actions go to hash-chained audit.

### 6. "Test coverage хэрхэн?" / "What's the test coverage?"

> **129 automated tests**: Jest 33 (TS), Pytest 67 (Python — including 4 new privacy_tier algorithm tests), Playwright 29 (smoke + observability + theme regression + playback e2e). CI runs on every push (GitHub Actions). DAST: Nuclei + OWASP ZAP weekly + workflow_dispatch.

### 7. "Хэрэв ML service унавал?" / "What if ML service goes down?"

> `/api/uptime` reports ml + db status in real time (visible in landing footer). On ML outage: `/compare` and live capture degrade gracefully — face detection falls back to browser-side ONNX UltraFace (WebGPU + WASM). Encryption / reveal / audit don't depend on ML. Telegram alerts via `pg_net.http_post` are fire-and-forget so they don't block alert INSERT. Restart procedure documented in `docs/RUNBOOK.md`.

### 8. "Key compromise болвол?" / "What if a key is leaked?"

> Dual-key rotation. ML service supports `ML_ENCRYPTION_KEY_PREV` env — old key keeps decrypting historical recordings while new key encrypts everything new. Procedure in CLAUDE.md "Key Rotation Procedure" section, also `docs/BREAK_GLASS.md`. Same dual-key pattern for `CAMERA_URL_KEY`, `STREAM_TICKET_SECRET`, `REAUTH_COOKIE_SECRET`, `SESSION_PIN_SECRET`.

### 9. "GDPR / PIPA нийцэх үү?" / "GDPR / PIPA compliance?"

> Yes, mapped explicitly in `docs/COMPLIANCE.md`. GDPR Art.5 (data minimisation via mask-at-capture), Art.13–22 (transparent processing notice + self-service export/erase via `/privacy`), Art.25 (privacy-by-default), Art.32 (encryption), Art.33 (breach notification via Sentry alerts), Art.35 (DPIA). PIPA Art.15/17/23 (consent + sensitive data classes), Art.28-2 (de-identification), Art.29 (technical safeguards), Art.35 (rights of the data subject), Art.39 (penalties / liability).

### 10. "Hardware-backed login дэмждэг үү?" / "Hardware-backed login?"

> Yes — full WebAuthn / passkey support. /settings has "Passkey нэмэх" → enroll iCloud Keychain / Windows Hello / YubiKey / Android passkey. /login has "Sign in with passkey" alongside email+password. Phishing-resistant (origin-bound), private key never leaves the device. RLS-self-only storage in `webauthn_credentials`.

### 11. "Super admin гэж юу?" / "What is super admin?"

> One specific user (`khajybyek@gmail.com`) marked `is_super_admin = true` on profiles. A BEFORE trigger refuses any DELETE / demote / role-change attempt unless `current_user` ∈ {postgres, service_role, supabase_admin, ...} — meaning **only Supabase Studio direct SQL can revoke**. Other admins see "Protected" lock icon in /users. Partial unique index enforces "at-most-one super admin" globally.

### 12. "Хэрэв бичлэгтэй сэжигтэн арилбал? (last admin race)" / "Race conditions?"

> Last-admin protection: `deleteUserAction` does count-after-delete and writes `ADMIN_COUNT_ZERO` audit row if last admin was concurrently removed. Reveal job state machine handles concurrent approval/rejection via row-level locks. TOTP replay tracking is atomic (`consume_totp_code` RPC). All admin mutations route through audit_log, so race-condition forensics are possible.

### 13. "Performance яамаар үнэлэх вэ?" / "Performance & SLOs?"

> RTO ≤ 60min · RPO ≤ 24h · MTTD ≤ 5min · MTTR ≤ 30min for P1. Live `/api/uptime` shows ml + db latency (currently <50ms both). `/api/ml/bench` admin endpoint runs ML p50/p95/p99 + effective FPS. Slow query check via `top_slow_queries` RPC + `/db-monitor` page. Vercel Speed Insights tracks real-user metrics.

### 14. "Демо crash болвол?" / "What if the demo crashes?"

> Failure-recovery in `docs/DEMO_SCRIPT.md`: public landing slow → refresh + show cached screenshot · `/compare` fails → open `docs/PENTEST_REPORT.pdf` · `/live` no camera → switch to phone mode · 2FA prompt won't open → mention `REAUTH_REQUIRED` is conditional · whole production down → pull up GitHub Actions Security page showing recent green runs.

### 15. "Дараа юу хийх төлөвлөгөөтэй вэ?" / "Future roadmap?"

> Pending in `docs/FUTURE.md`: federated learning per-camera baselines, zero-knowledge reveal proofs (already a stub at `/zk-reveal`), differential privacy on embedding queries (already at `/eval` and `/api/eval/dp`), live suspect-match overlay isolation into its own Realtime channel, full WebAuthn discoverable login (current is non-discoverable), and external penetration test once budget allows.

---

## Production metrics at-a-glance

| Metric | Value |
|---|---|
| Public URL | https://mongolz.vercel.app |
| ML service | https://mongolz-ml-production.up.railway.app |
| Tests | 129 automated (67 pytest · 33 jest · 29 Playwright) |
| Migrations | 47 SQL · all synced to GitHub |
| Routes | 54 verified (7 public · 38 admin · 9 API) |
| Auth factors | password · TOTP · passkey |
| Languages | mn · en · kr |
| Privacy tiers | vip · standard · relaxed |
| Supabase advisor | security: clean (Pro-plan leaked-password only) · perf: clean (INFO unused-index only) |
| DB lint | clean |
| Commits this session | 21 |

---

## Live demo URLs to keep open in tabs

1. `https://mongolz.vercel.app/` — public landing (open logged-out)
2. `https://mongolz.vercel.app/login` — login page (show "Sign in with passkey" button)
3. `https://mongolz.vercel.app/api/uptime` — health JSON
4. `https://mongolz.vercel.app/.well-known/security.txt` — RFC 9116
5. Admin-side: `/compare`, `/live`, `/playback`, `/reveal-approvals`, `/suspects` (show tier select), `/users` (show super admin Crown), `/audit`
6. GitHub: `https://github.com/khajybyek/mongolz-next/actions` (recent green CI runs)
7. Supabase: SQL editor with `SELECT verify_audit_chain();` ready to run

---

## Emergency commands

```bash
# Vercel logs
vercel logs --json

# Railway logs
cd ml-service && railway logs --tail 80

# Production health
curl -s https://mongolz.vercel.app/api/uptime | jq

# Audit chain integrity
# (Supabase SQL editor)
SELECT count(*) FROM verify_audit_chain();
SELECT count(*) FROM verify_audit_chain();   -- 0 broken rows = intact
```

---

**Last updated**: 2026-05-18 · commit `5dc5c67` (per-face suspect matching)
