# Defense Cheat Sheet — MONGOLZ Security

> **Capstone 2026-01-CD-03-07 · 3B-26-1**
> Open on phone during defense. Print one side, A4.

---

## 30-second elevator pitch (MN)

> "MONGOLZ Security нь олон эрхтэй mask + reveal боломжтой ухаалаг сүлжээний камер ба нэгдсэн удирдлагын сервер. Бичлэг нь зөвхөн AES-256-GCM-ээр шифрлэгдсэн эх хувиараа хадгалагдаж, **үзэх мөчид** Cubist Voronoi mosaic-аар маскалсан хувилбар нь шууд render хийгддэг (plaintext хувилбар хадгалагддаггүй). Маскийг буцаах нь зөвхөн **4-eyes approval**-той reveal flow. **VIP / standard / relaxed** privacy tier-ээр маскийн хүч автомат тохируулагдана. (Live HLS урсгал нь маскгүй — энэ бол мэдэгдэж буй цоорхой, доорх Q16-г үзнэ үү.)"

## 30-second pitch (EN)

> "MONGOLZ Security is a multi-authority masking + reveal control server for intelligent network cameras. A recording is stored only as one AES-256-GCM encrypted original; the masked view is rendered on demand at playback with a Voronoi-tessellation mosaic, so no plaintext view or face crop is persisted. Only a 4-eyes approval workflow can recover the original. Per-suspect privacy tiers (VIP / standard / relaxed) automatically adjust mask strength. The live HLS feed is the one path that is not masked — see Q16."

## 30-second pitch (KR)

> "MONGOLZ Security는 다중 권한 마스킹 및 복원이 가능한 지능형 네트워크 카메라 통합관제 서버입니다. 원본은 AES-256-GCM으로 암호화 저장되고, 재생 시점에 모든 얼굴이 Voronoi 모자이크로 마스킹되어 렌더링됩니다(평문 프레임이나 얼굴 조각은 저장되지 않습니다). 4-eyes 승인 흐름만 원본을 복원할 수 있고, 각 대상의 프라이버시 등급(VIP/standard/relaxed)에 따라 마스크 강도가 자동 조정됩니다. 실시간(HLS) 화면은 마스킹되지 않습니다 — Q16 참조."

---

## Architecture (one-line summary)

```
Camera → ML service (FastAPI, Railway, us-west2 / USA) → Supabase (Postgres + Storage + Auth + RLS, ap-southeast-1 / SG)
                                                       → Vercel (Next.js 16, sin1 / SG) ↳ Telegram bot
```

Storage is in Singapore; **the ML service — the only component that ever holds a
decrypted face — is in the United States** (`us-west2`). Say it before you are
asked: it is recorded in COMPLIANCE.md §2/§4 and DPIA §D.5, and the fix is to
move the Railway service to an APAC region.

**5 layers of security**: (1) PostgreSQL RLS · (2) TOTP 2FA + replay tracking · (3) AES-256-GCM per-recording HKDF keys · (4) Hash-chained audit · (5) 4-eyes approval

---

## Top 16 panel questions + answers

### 1. "Brute force-аас яаж хамгаалж байна?" / "How is brute force protected?"

> 7 layers: rate limit (5 fail/email/15min + 10 fail/IP/15min) · TOTP replay tracking · timing-safe HMAC everywhere · session pinning (IP/16 + UA) · automatic lockout Slack alert · public RPC lockdown (`email_for_username` service-role only) · hash-chained audit log.

### 2. "Бусад attack-аас яаж хамгаалж байна?" / "What other threats?"

> 16 attack classes covered: XSS (nonce-CSP), SQLi (parameterized + RLS), CSRF (Server Actions + SameSite=Lax), Clickjacking (`frame-ancestors 'none'`), SSRF (DNS rebinding pre+post lookup, private-IP regex), Path traversal (regex + `realpath` boundary in HLS endpoint), Open redirect (`sanitizeNextPath`), Privilege escalation (server-side role + RLS + middleware allow-list), Replay (TOTP single-use, audit hash-chain), DoS (4MB payload caps, rate limits), Crypto (AES-256-GCM + HKDF + timing-safe), Supply chain (Semgrep + trufflehog + npm/pip audit), DAST (Nuclei + ZAP weekly), Header hardening (HSTS preload, X-CTO, Permissions-Policy).

### 3. "Supabase backend учир бид юу хамгаалж байна?" / "What protection is OURS vs Supabase's?"

> **Shared responsibility model**. Supabase: TLS, DDoS-edge, Postgres engine, bcrypt password hashing, base auth JWT/refresh, infra patching. **OUR application layer**: every RLS policy text, TOTP replay tracking, AES-256-GCM per-recording HKDF encryption, 4-eyes reveal workflow, hash-chained audit log (`verify_audit_chain`), rate limiting, session pinning, CSP nonce, SSRF defense, path-traversal validation, webhook signing, super-admin DB trigger.

### 4. "VIP / protected witness яаж хамгаалагдаж байна?" / "How are VIPs protected?"

> Per-suspect `privacy_tier` (vip/standard/relaxed). When that suspect's face is detected in any recording, ArcFace embedding is matched against the in-memory suspect cache (cosine ≥ 0.40 threshold), and Cubist mosaic params are picked accordingly: VIP → 50-90 polygons + 1.6σ blur (2-3x stronger), standard → 18-40 + 0.7σ, relaxed → 10-18 + 0.4σ. Overlapping detections pick the most protective tier.

### 5. "Reveal flow яаж аюулгүй вэ?" / "How is reveal kept safe?"

> Five guards: (a) admin-only access via `requireAdmin()` + step-up TOTP. (b) 4-eyes approval — another admin must approve in `/reveal-approvals` before ML kicks off. (c) Optional **time-bounded window** — reveal limited to e.g. [0:15 → 0:45], rest of recording stays masked ("principle of least privilege"). (d) Selective face-level — only the chosen face_ids are unmasked, others stay masked. (e) Watermark on output (revealer email + timestamp). Request, approval/rejection and the download of the output all go to the hash-chained audit log.

### 6. "Test coverage хэрхэн?" / "What's the test coverage?"

> **Automated tests, counted 2026-09-08 after the P0 batch:** Jest 27 suites / 259 cases (`npx jest`), pytest 210 (`ml-service/venv.nosync/bin/python -m pytest -q`), plus the Playwright e2e specs. Re-count before quoting a number — these move with every batch.
>
> Known gap in that coverage: there is no component test and no server-action test, so the login / passkey / recovery actions are exercised only by e2e. A green suite says nothing about those paths.

### 7. "Хэрэв ML service унавал?" / "What if ML service goes down?"

> `/api/uptime` reports ml + db status in real time (visible in landing footer). On ML outage: `/compare` and live capture degrade gracefully — face detection falls back to browser-side ONNX UltraFace (WebGPU + WASM). Encryption / reveal / audit don't depend on ML. Telegram alerts via `pg_net.http_post` are fire-and-forget so they don't block alert INSERT. Restart procedure documented in `docs/RUNBOOK.md`.

### 8. "Key compromise болвол?" / "What if a key is leaked?"

> Dual-key rotation. ML service supports `ML_ENCRYPTION_KEY_PREV` env — old key keeps decrypting historical recordings while new key encrypts everything new. Procedure in CLAUDE.md "Key Rotation Procedure" section, also `docs/BREAK_GLASS.md`. Same dual-key pattern for `CAMERA_URL_KEY`, `STREAM_TICKET_SECRET`, `REAUTH_COOKIE_SECRET`, `SESSION_PIN_SECRET`.

### 9. "GDPR / PIPA нийцэх үү?" / "GDPR / PIPA compliance?"

> Mapped explicitly in `docs/COMPLIANCE.md`. GDPR Art.5 (data minimisation — only the encrypted original is stored, the masked view is derived at playback), Art.13–22 (processing notice + self-service export/erase via `/privacy`), Art.25 (privacy-by-default), Art.32 (encryption), Art.33 (breach notification via Sentry alerts), Art.35 (DPIA), **Art.44 (transfers — storage SG, ML processing US; §D.5 of the DPIA)**. PIPA Art.15/17/23 (consent + sensitive data classes), Art.28-2 (de-identification), **Art.28-8 (cross-border transfer)**, Art.29 (technical safeguards), Art.35 (rights of the data subject), Art.39 (penalties / liability).
>
> Say "mapped", not "compliant": the open items are listed in COMPLIANCE.md §5 and the live feed is unmasked (Q16).

### 10. "Hardware-backed login дэмждэг үү?" / "Hardware-backed login?"

> Yes — full WebAuthn / passkey support. /settings has "Passkey нэмэх" → enroll iCloud Keychain / Windows Hello / YubiKey / Android passkey. /login has "Sign in with passkey" alongside email+password. Phishing-resistant (origin-bound), private key never leaves the device. RLS-self-only storage in `webauthn_credentials`.

### 11. "Super admin гэж юу?" / "What is super admin?"

> One specific user (`khajybyek@gmail.com`) marked `is_super_admin = true` on profiles. A BEFORE trigger refuses any DELETE / demote / role-change attempt unless `current_user` ∈ {postgres, service_role, supabase_admin, ...} — meaning **only Supabase Studio direct SQL can revoke**. Other admins see "Protected" lock icon in /users. Partial unique index enforces "at-most-one super admin" globally.

### 12. "Хэрэв бичлэгтэй сэжигтэн арилбал? (last admin race)" / "Race conditions?"

> Last-admin protection: `deleteUserAction` does count-after-delete and writes `ADMIN_COUNT_ZERO` audit row if last admin was concurrently removed. Reveal job state machine handles concurrent approval/rejection via row-level locks. TOTP replay tracking is atomic (`consume_totp_code` RPC). All admin mutations route through audit_log, so race-condition forensics are possible.

### 13. "Performance яамаар үнэлэх вэ?" / "Performance & SLOs?"

> RTO ≤ 60min · RPO ≤ 24h · MTTD ≤ 5min · MTTR ≤ 30min for P1. Live `/api/uptime` reports ml + db health with a **bucketed** latency string (`<50ms`, `<100ms`, `<250ms`, … — exact timings are withheld from the public probe on purpose); on 2026-09-08 both read `<250ms` from Vercel `sin1`, and the ML leg carries the trans-Pacific hop to `us-west2`. `/api/ml/bench` admin endpoint runs ML p50/p95/p99 + effective FPS. Slow query check via `top_slow_queries` RPC + `/db-monitor` page. Vercel Speed Insights tracks real-user metrics.

### 14. "Демо crash болвол?" / "What if the demo crashes?"

> Failure-recovery in `docs/DEMO_SCRIPT.md`: public landing slow → refresh + show cached screenshot · `/compare` fails → open `docs/PENTEST_REPORT.pdf` · `/live` no camera → switch to phone mode · 2FA prompt won't open → mention `REAUTH_REQUIRED` is conditional · whole production down → pull up GitHub Actions Security page showing recent green runs.

### 15. "Дараа юу хийх төлөвлөгөөтэй вэ?" / "Future roadmap?"

> Pending in `docs/FUTURE.md`: federated learning per-camera baselines, zero-knowledge reveal proofs (already a stub at `/zk-reveal`), differential privacy on embedding queries (already at `/eval` and `/api/eval/dp`), live suspect-match overlay isolation into its own Realtime channel, full WebAuthn discoverable login (current is non-discoverable), and external penetration test once budget allows. Ahead of all of it: the P0 list from the 2026-09-08 audit — mask or restrict the live feed, and move ML processing into the storage region.

### 16. "Юу нь бүрэн биш вэ?" / "What is NOT finished?" — answer this before they find it

> Three things, and I would rather say them than be caught by them:
> 1. **The live feed is not masked.** Masking runs at playback; frames go to the live HLS writer in the clear (`recording_pipeline.py`, "LIVE = unblurred"). Who may watch is now bounded — the stream route requires an enabled camera plus admin or an explicit `camera_permissions` grant, records every view, and deletes the unmasked segments when the session stops — but the frames an authorised operator sees are still identifiable. That is the honest residual gap.
> 2. **The audit log covers changes and data-access paths, not browsing.** It records every privileged mutation, every login/step-up, and the reads that expose personal data (sealed-crop decrypt, playback view, live-stream playlist, 1:N search, re-id trail, alert CSV export, reveal-output download — collapsed to one row per operator per object per 5 min). It does **not** record page views, dashboard aggregates, individual HLS segments, the audit-log CSV export, or a direct PostgREST read. So "every privileged access is logged" is the wrong sentence; "every privileged change and every personal-data read path is logged" is the right one.
> 3. **The reveal hierarchy is settable but not yet a boundary.** `/users` sets `reveal_level`, ADR 0009 enforces it end-to-end — but every profile in production is still level 0, and `setRevealLevelAction` does not stop an admin from setting their *own* level. Until that check lands, treat the hierarchy as implemented-and-tested, not enforced-against-a-hostile-admin (ADR 0009 "Deployment status").

---

## Production metrics at-a-glance

Verified 2026-09-08 — re-run the command in the right-hand notes before quoting these.

| Metric | Value | How it was checked |
|---|---|---|
| Public URL | https://aicctv.dev | `curl -I https://aicctv.dev/` → 200 |
| ML service | https://mongolz-ml-production.up.railway.app — Railway **us-west2 (USA)** | `railway status --json` → `multiRegionConfig` |
| Database | Supabase `ulybenitqmqjfxtaregp` — Southeast Asia (Singapore) | `supabase projects list` |
| Tests | 222 jest · 210 pytest · 98 Playwright cases | `npx jest`, `pytest --collect-only -q`, `npx playwright test --list` |
| Migrations | 85 SQL · local files mirror cloud history 1:1 | `supabase migration list --linked` |
| Tables | 23 in `public`, RLS on all 23 · 46 policies over 22 of them (`retention_deletion_queue` is deliberately policy-less = service-role only) | `pg_tables` / `pg_policies` |
| Storage buckets | 6 — 5 private (`recordings`, `faces`, `suspects`, `revealed`, `alert-screenshots`) + `branding` public | `storage.buckets` |
| Auth factors | password · TOTP · passkey | — |
| Languages | mn · en · kr | — |
| Privacy tiers | vip · standard · relaxed | — |
| DB lint | "No schema errors found" | `npm run lint:db` (`supabase db lint --linked`) |
| Known accepted advisor items | leaked-password protection off (Pro-plan feature) · 4 SECURITY DEFINER helpers that gate on `private.is_admin()` internally | Supabase dashboard advisor — re-run it before quoting; not covered by `db lint` |

---

## Live demo URLs to keep open in tabs

1. `https://aicctv.dev/` — public landing (open logged-out)
2. `https://aicctv.dev/login` — login page (show "Sign in with passkey" button)
3. `https://aicctv.dev/api/uptime` — health JSON (bucketed latency)
4. `https://aicctv.dev/.well-known/security.txt` — RFC 9116
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
curl -s https://aicctv.dev/api/uptime | jq

# Audit chain integrity
# (Supabase SQL editor)
SELECT count(*) FROM verify_audit_chain();
SELECT count(*) FROM verify_audit_chain();   -- 0 broken rows = intact
```

---

**Last updated**: 2026-09-08 — correction pass after the full audit
(`docs/audits/2026-09-08-full-audit.mn.md`): ML region, masking is at view time
and absent from the live feed, audit-log coverage boundary, verified metrics,
`aicctv.dev` URLs. The GitHub repo is private, so the Actions tab in §"Live demo
URLs" only opens for the owner's account — sign in first if you plan to show it.
