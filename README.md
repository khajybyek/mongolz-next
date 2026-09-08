# MONGOLZ Security

> Privacy-preserving CCTV face recognition with hierarchical reveal authority,
> a hash-chained audit trail, and server-side encrypted recordings
> (AES-256-GCM at rest, TLS in transit — **not** end-to-end: the ML service
> holds the key and decrypts server-side to render a view).
>
> Live at **[aicctv.dev](https://aicctv.dev)** · capstone project (3B-26-1).

Saved recordings store ONE encrypted MP4 of the original footage; every viewer
sees a derived, on-demand blurred render. Per-face crops are sealed with a
hash-chain key (ADR 0009) so a "Level N" operator can unblur faces ≥ N but
not below. Reveals require 4-eyes approval. No plaintext face crop is uploaded
to Storage for any new detection — only the AES-256-GCM blob.

**What "encrypted" does and does not mean here.** Blobs are encrypted at rest
in Supabase Storage with per-recording HKDF-derived AES-256-GCM keys, and the
master key lives only in the ML service's environment. But that service holds
the key, decrypts on every playback render and every reveal, and keeps
transient plaintext on its own disk (`/tmp/mongolz-hls` for live segments,
`/tmp/mongolz-views` for the masked render cache). A compromise of the ML
service or its master key exposes the footage. Threat model:
**stolen storage blobs and stolen database rows, not a malicious server** — the
honest boundary is written out in `docs/adr/0009-*.md` §"Honest threat model".

**One more thing to know before the feature list.** Masking happens at
*playback*. The live HLS feed is unmasked: an operator on `/live`, `/grid` or
`/wall` sees faces in the clear. Since the 2026-09-08 audit that path is
authorised per camera and every view is recorded: an admin passes, and any
other role needs an explicit `camera_permissions` row. `camera_permissions` is
empty in production, so today only admins can watch live video until grants are
added at `/cameras/<id>/permissions`
(`docs/audits/2026-09-08-full-audit.mn.md`).

---

## Architecture

```
Browser ──► Vercel (Next.js 16 / sin1) ──► Supabase Cloud (ap-southeast-1)
                    │                            │ Postgres 17 + pgvector
                    ▼                            │ Auth / Storage / RLS
            Railway (Python ML)                  │ Edge Functions
            us-west2  ⚠ crosses SG → US          ▼
       InsightFace + OpenCV + FFmpeg     Claude · Telegram (pg_net async)
```

| Layer | Tech | Region |
|---|---|---|
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind · hls.js · ONNX (WebGPU+WASM) | Vercel `sin1` (Singapore) — `vercel.json` |
| Auth + DB + Storage | Supabase (Postgres 17 · pgvector · 23 tables · 6 buckets · RLS on every table) | Supabase `ap-southeast-1` (Singapore) |
| ML service | Python 3.11 · FastAPI · InsightFace (buffalo_l) · OpenCV · FFmpeg | Railway **`us-west2` (United States)** |
| AI insights | Claude (anomaly/summary/chat) via Supabase Edge | Cloudflare |
| Observability | Sentry (`@sentry/nextjs`) · OpenTelemetry SDK | — |

⚠ **The ML service is not co-located with storage.** Recordings live in
Singapore; the service that decrypts them, detects faces and computes
embeddings runs in the United States, so every frame crosses SG → US → SG. That
is a GDPR Art. 44 / PIPA Art. 28-8 transfer of biometric data and it is
recorded in `docs/COMPLIANCE.md` §2 + §4 and `docs/DPIA.md` §D.5. Verified
2026-09-08 from `railway status --json` (`multiRegionConfig`, deployment
`194b45c0`); earlier revisions of this table said `asia-southeast1`, which was
wrong. Remediation on file: pin the Railway service to an APAC region.

---

## Headline features

### Privacy-preserving recording (ADR 0010)
- One artifact per recording: `*_original.mp4.enc` (AES-256-GCM)
- The blurred playback view is **derived on demand** at `GET /recording/{id}/view`
  — ML decrypts, renders Cubist mosaic over each face, caches on disk
- Legacy `baked` recordings (stored blurred MP4) continue to play unchanged via a
  per-recording `blur_strategy ∈ {baked, on_demand}` discriminator
- Rollback: set Railway `BLUR_STRATEGY=baked` to revert without redeploy

### Hash-chain reveal authority (ADR 0009)
- Each face's pixel crop + ArcFace embedding are sealed with `K_index`, derived
  forward-only along a per-recording hash chain
- `profiles.reveal_level ∈ [0..99]`: an operator at level N can unseal faces
  with `chain_index ≥ N` and only those — a "director" (level 0) sees all
- `/users` admin UI sets `reveal_level` per profile; super-admin is pinned to 0
- Unified `/api/faces/[id]/secure-crop` proxies sealed crops through ML
  (authority-gated) or streams the pre-chain legacy plaintext crops. As of
  2026-09-08 the production table holds 42 face rows, of which 39 predate the
  chain (`chain_index is null`, unsealable) and 1 is sealed — the encrypt-only
  pipeline is live but most stored faces are historical

### 4-eyes reveal (Tier 1, enforced)
- `/reveal/start` inserts `status='pending_approval'`; ML does NOT trigger
- Second admin approves at `/reveal-approvals` (approver ≠ requester)
- `reveal_job.run()` refuses any status outside {queued, approved, processing}
- Every reveal logs requester + approver + scope (time window + face ids) to
  the audit hash-chain

### Encrypt-only face crops (Tier 2, T2.4)
- `recording_pipeline.py` no longer writes plaintext crops — every new face
  is sealed with `K_index` and uploaded ONLY as `<image_path>.enc`
- Seal failure ⇒ face is dropped (fail-closed, the chain index still
  advances)
- All gallery sites (`/faces`, `/review`, `/reid`, `/search`, `/wall`,
  `/playback`, reveal modal) consume crops through `<FaceThumb faceId>` →
  the unified endpoint

### Per-camera authorisation for live video — enforced
- The HLS playlist and every segment run the same check: the camera must be
  `enabled`, an admin passes, and every other role needs a row naming them in
  `camera_permissions` for that camera
- `user_can_see_camera()` is still called first (it mirrors the RLS helper) but
  it is default-allow by design, so the route adds the explicit-grant rule on
  top. Grants are managed at `/cameras/<id>/permissions`
- A refusal returns 403 with `code` = `camera_disabled` /
  `camera_not_authorized` / `permission_check_failed` and writes a
  `STREAM_DENIED` audit row; a successful view writes `STREAM_VIEWED`
  (one row per operator per camera per 5 minutes)
- The live feed carries **unmasked** frames (masking is a playback-time step),
  so this gate is the only thing standing between a non-admin account and faces
  in the clear — `camera_permissions` is empty in production, which now means
  no live video for non-admins rather than live video for everyone

### Live + recording (3 modes)
- 💻 Device — `getUserMedia` (laptop / external webcam)
- 📱 Phone — IP Webcam app URL (MJPEG / snapshot)
- 📹 IP CCTV — RTSP → ML → HLS via hls.js

Recording uploads chunk into 3 MB segments (`session_id` + `chunk_index`)
to stay within Vercel's 4.5 MB body cap on Hobby.

### Other
- TOTP 2FA + SHA-256 hashed recovery codes (regenerate requires fresh TOTP)
- WebAuthn passkeys (counter-regression + UV enforced)
- Per-suspect alert rules: dedup window, burst smoothing, KST quiet hours
- All-faces DBSCAN clustering (`/clusters`)
- Face re-id trail (`/reid`) — cosine match across cameras over time
- ML benchmarks (`/benchmarks` — p50/p95/p99 + effective FPS)
- Active learning labels (`/active-learning`) → F1-optimal threshold suggester
- Webhooks (Slack / Discord / HMAC-signed) + test-fire UI
- GDPR Art.15 export + Art.17 erasure self-service (`/privacy`)
- Multi-camera wall (`/wall`) with auto-refresh (10s)
- WebRTC self-loopback latency demo (`/live-rtc`)
- Admin user CRUD + last-admin protection + super-admin (DB-locked)
- Audit log CSV export with hash-chain integrity check
- AI insights (Claude — anomaly / summary / chat)
- i18n: mn / en / kr (server-resolved cookie + client `useT()` hook)
- PWA manifest, skip-to-content link, `prefers-reduced-motion`, dark/light
- Live monitoring: `/grid` NVR-style multi-camera view (auto/1/2×2/3×3/4×4, Start all,
  focus, fullscreen) and `/wall` with a live-video mode; built-in `demo://lobby|gate|parking`
  camera sources (cam_type `demo`) stream a synthetic looping clip for demos
- Alert workflow: new → acknowledged → closed with notes, tabs on `/alerts`, acknowledge
  from the realtime popup; reveal requests notify the second admin (webhook, push, Telegram)
- Reliability: the ML service records running cameras in `camera_sessions` and resumes them
  after a redeploy (supervisor with backoff); pg_cron probes `/api/uptime` every 5 min and
  posts ML down/recovered transitions to Telegram
- App shell: sticky header (breadcrumbs, ⌘K palette with actions, live ML/DB status,
  theme + language, account menu), grouped sidebar, phone bottom tab bar, toast
  notifications — all driven by one navigation source (`lib/nav.ts`); Geist typography
- OpenGraph image (Satori-rendered)

---

## Security model

| Layer | Mechanism |
|---|---|
| 1. UI | role-aware navigation — sidebar, header, tab bar and ⌘K palette share `lib/nav.ts` (admin / viewer / auditor) |
| 2. Server gate | `requireAdmin()` / `requireUser()` redirect in every protected route |
| 3. Middleware | auditor allow-list (only `/audit*`); per-camera redirect |
| 4. RLS | on all 23 `public` tables; 56 policies across 22 of them (46 permissive + the 10 restrictive second-factor gates of row 16), `retention_deletion_queue` deliberately policy-less (service-role only); super-admin row protected by a BEFORE trigger |
| 5. Step-up reauth | password OR fresh TOTP, 15-min cookie TTL |
| 6. Session pinning | IP/16 + UA fingerprint, HMAC-signed cookie, 7-day TTL |
| 7. 4-eyes reveal | approver ≠ requester, defended at 3 layers |
| 8. Reveal authority | hash-chain `K_index` forward-only (ADR 0009) — settable from `/users`, but every profile is still level 0 and an admin can currently raise their own level (open gap, see the ADR) |
| 9. Crops encrypt-only | new faces never upload a plaintext crop to Storage (Tier 2) |
| 10. Audit hash-chain | tamper-evident; `verify_audit_chain()` SQL helper. Covers every privileged mutation, every auth/step-up event, and the personal-data read paths (sealed-crop decrypt, playback view, live-stream playlist, 1:N search, re-id trail, alert CSV export, reveal-output download — `lib/audit.ts`), collapsed to one row per user per object per 5 min. Does **not** cover page views, dashboard aggregates, HLS segments, the audit-log CSV export, or direct PostgREST reads — those reads are now gated by the data-tier second factor (row 16), but they are still not recorded |
| 11. Storage RLS | every data bucket private (`recordings`, `faces`, `suspects`, `revealed`, `alert-screenshots`); `branding` is public by design (logo + icons only); signed URLs ≤30min where needed |
| 12. CSP + nonce | strict; violations forwarded to Sentry via `/api/csp-report` |
| 13. FastAPI `/docs` | disabled in production (`ALLOW_API_DOCS=1` to re-enable) |
| 14. Dual-key crypto | `ML_ENCRYPTION_KEY_PREV` fallback during rotation |
| 15. Webhook HMAC | SHA-256 signing for generic destinations |
| 16. Second factor at the data tier | RLS restrictive policies AND `private.mfa_ok()` on `faces`, `alerts`, `recordings`, `cameras`, `suspects`, `clusters`, `reveal_jobs`, `audit_log`, `webhooks`, `camera_sessions`. If a profile has TOTP enabled, its token must carry an `amr` method other than `password` — so an admin password plus the public anon key can no longer read or write through PostgREST. Fails open when the claim is unreadable; `profiles` and the auth-flow tables are deliberately not gated; kill switch `update private.security_settings set mfa_required = false` (ADR 0011, `docs/adr/0011-mfa-at-the-data-tier.md`) |

---

## Project layout

```
mongolz-next/
├── app/
│   ├── (app)/                       # auth-gated
│   │   ├── dashboard/ alerts/ alerts-live/ analytics/ ai/
│   │   ├── audit/ active-learning/ alert-rules/
│   │   ├── backup/ benchmarks/ cameras/ clusters/ compare/
│   │   ├── db-monitor/ edge-detect/ eval/ faces/ grid/
│   │   ├── health/ jobs/ live/ live-rtc/ playback/
│   │   ├── privacy/ reid/ retention/ reveal-approvals/
│   │   ├── review/ schedule/ search/ settings/ suspects/
│   │   ├── thresholds/ users/ webhooks/ zk-reveal/
│   │   └── layout.tsx               # shell: sidebar + header + tab bar + toasts + i18n
│   ├── login/                       # email/username + TOTP
│   ├── wall/                        # kiosk grid — admin + viewer, view-only for viewers
│   ├── auth/ setup/
│   ├── api/
│   │   ├── auth/{reauth,totp/...,webauthn/...}/
│   │   ├── faces/[id]/secure-crop/  # unified crop endpoint (ADR 0009)
│   │   ├── recordings/[id]/view/    # on-demand blurred view proxy
│   │   ├── reveal/{start,my-level,[jobId]}/
│   │   ├── ml/{stream,bench}/  search/  reid/trail/
│   │   ├── admin/{backup,...}/  gdpr/{export,delete}/
│   │   ├── monitoring/error-rate/  csp-report/
│   │   └── uptime/                  # public health probe
│   └── opengraph-image.tsx          # Satori OG image
├── components/                      # FaceThumb, Dialog, Camera dialog, …
│   └── ui/                          # Button, Input, Card, Tabs, Skeleton…
├── lib/
│   ├── supabase/{client,server,middleware,auth}.ts
│   ├── auth/{step-up,session-pin,webauthn,totp-recovery,…}.ts
│   ├── i18n/{translations,server,client}.ts
│   ├── ml-client.ts                 # FastAPI proxy helpers
│   ├── camera-crypto.ts             # AES-GCM wrap/unwrap for RTSP URLs
│   ├── stream-ticket.ts             # HMAC-signed HLS access
│   ├── webhooks.ts                  # Slack / Discord / generic HMAC
│   └── database.types.ts
├── ml-service/                      # FastAPI + InsightFace + FFmpeg
│   ├── main.py
│   ├── recording_pipeline.py        # Tier 2: encrypt-only crops
│   ├── view_renderer.py             # ADR 0010: on-demand blurred view
│   ├── reveal_job.py
│   ├── hierarchical_keys.py         # ADR 0009: K_index chain + decrypt_face
│   ├── crypto_utils.py              # AES-256-GCM + dual-key rotation
│   ├── anti_spoof.py / embedding_fusion.py / dp_embeddings.py
│   ├── zk_reveal.py / telemetry.py / storage.py / camera_worker.py
│   ├── tests/                       # pytest suite (210 cases on 2026-09-08)
│   └── Dockerfile + railway.json
├── supabase/
│   ├── config.toml
│   ├── migrations/                  # 85 migrations — files mirror cloud history 1:1 (`supabase migration list --linked`)
│   └── functions/{claude-analysis,telegram-alerts}/
├── e2e/                             # Playwright (public probes, i18n)
└── scripts/                         # create-admin / demo-seed / rotate-keys / backup:restore / …
```

---

## Local dev

```bash
# 1. Supabase local (optional — production work uses cloud project)
brew install supabase/tap/supabase
cd mongolz-next
supabase start                       # ~5 min on first run

# 2. .env.local — every variable is documented in .env.example
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# SUPABASE_SERVICE_ROLE_KEY=...
# NEXT_PUBLIC_ML_SERVICE_URL=http://localhost:8000
# ML_SERVICE_TOKEN=...
# CAMERA_URL_KEY=... STREAM_TICKET_SECRET=... REAUTH_COOKIE_SECRET=... SESSION_PIN_SECRET=...

# 3. Frontend
npm install
npm run create-admin                 # set USER_PASSWORD env first
npm run dev                          # → http://localhost:3000

# 4. ML service
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                 # fill SUPABASE_*, ML_SERVICE_TOKEN, ML_ENCRYPTION_KEY
uvicorn main:app --reload --port 8000

# 5. Edge functions (AI insights + Telegram)
npx supabase functions deploy claude-analysis --project-ref <ref>
npx supabase functions deploy telegram-alerts --project-ref <ref>
```

---

## Production deploy

```bash
# Frontend + API (Vercel auto-deploys from main; manual override below)
npm run deploy:prod                  # vercel deploy --prod --yes
npm run deploy:staging               # preview build

# ML service (Railway)
cd ml-service && railway up --detach
# Attach a persistent Railway volume and set RECORDING_SPOOL_DIR=/data/recording-spool.
# The spool retains encrypted recordings until both Storage and the DB commit are acknowledged.

# Edge functions
npx supabase functions deploy claude-analysis --project-ref ulybenitqmqjfxtaregp
npx supabase functions deploy telegram-alerts --project-ref ulybenitqmqjfxtaregp
```

---

## Quality gates

```bash
npm run typecheck                    # tsc --noEmit
npm run lint                         # eslint .
npm test                             # jest (222 tests in 25 suites on 2026-09-08)
cd ml-service && venv/bin/pytest -q  # pytest (210 tests on 2026-09-08)
npm run lint:db                      # supabase db lint --linked
npm run lint:migrations              # migration filename + safety-waiver lint
npm run gen:types                    # regenerate lib/database.generated.ts after every migration
npx playwright test                  # e2e (override base URL via PLAYWRIGHT_BASE_URL)

# Operations
npm run backup:verify                # sample recordings → /reveal/verify-blob decrypt smoke test
npm run rotate:keys -- --key=<NAME>  # ML_ENCRYPTION_KEY · CAMERA_URL_KEY · STREAM_TICKET_SECRET · REAUTH_COOKIE_SECRET · SESSION_PIN_SECRET
npm run demo:seed / npm run demo:wipe
```

---

## Hardening pass — 2026-09-06

Full start-to-finish audit (DB → auth → API → UI → ML). Highlights:

- Migration history mirrors the cloud project 1:1 (85 files as of 2026-09-08). `npm run gen:types`
  regenerates `lib/database.generated.ts`; every Supabase client is typed.
- Self-signup is blocked at the DB (`handle_new_user` requires a confirmed
  identity and always assigns `viewer`); the super-admin guard reads JWT
  claims; `profiles` columns are least-privilege; the audit hash chain is
  serialised with an advisory lock in UTC.
- HMAC cookies are purpose-bound (`:v2`), session pinning is enforced for
  TOTP-enabled users, passkeys require user verification, recovery codes work
  at the TOTP login step, and redirect targets are sanitised centrally.
- 4-eyes reveal approvals use compare-and-swap + step-up auth; backups use
  per-table column allow-lists; CSV exports neutralise spreadsheet formulas;
  the retention sweep deletes storage objects and honours the audit-log hold.
- ML: one `FaceMasker` (Haar + periodic InsightFace) serves the recording
  pipeline, the on-demand view and reveal; recordings finalise crash-safe;
  chunked uploads are assembled server-side with abandoned-session sweeps;
  reveal jobs are claimed by CAS under a global render slot.

---

## ADR index

- **0009 — Hash-chain reveal authority** (`docs/adr/0009-*.md` if added,
  otherwise see CLAUDE.md "Tier 1" + "Tier 2" sections): per-face
  `K_index` derived by HKDF forward chain; forward-only access; sealed
  embedding + sealed crop pixels share the same `K_index`.
- **0010 — One encrypted source per recording**: `*_original.mp4.enc` is the
  sole artifact; the blurred view is derived at request time. Legacy `baked`
  recordings continue via the strategy discriminator. Rollback via
  `BLUR_STRATEGY=baked`.

---

## Test users

Created via `npm run create-{admin,viewer,auditor}` — passwords are read from
`USER_PASSWORD` at creation. Production credentials are NOT shipped with the
repo; rotate immediately after first login. Admin accounts require TOTP 2FA on
every sign-in. Username-only login resolves via the `email_for_username()`
RPC, so `khajybyek` and `khajybyek@gmail.com` both work.

| Role | Scope |
|---|---|
| `admin` | full CRUD; reveal_level set per profile (0 = director) |
| `viewer` | recordings + live; view-only NVR grid/wall (no start/stop); aggregate camera health only — no face crops or ids; no reveal |
| `auditor` | only `/audit*`; middleware blocks every other path |
| `super_admin` | DB-locked flag; cannot be demoted/deleted via app or SQL by anyone except postgres / service_role / supabase_admin |

---

## Stack at a glance

Next.js 16 · React 19 · TypeScript 5 · Tailwind · Recharts · hls.js · ONNX
Runtime Web (WebGPU + WASM) · Supabase (Postgres 17 · pgvector · Auth ·
Storage · Edge Functions) · Python 3.11 · FastAPI · InsightFace ArcFace
(buffalo_l, 512-dim) · OpenCV · FFmpeg · AES-256-GCM · pg_net · Claude
(anomaly/summary/chat) · Sentry · Playwright · Jest 30 · pytest.

Suite sizes move every week, so take them from the runners rather than from
this line: on 2026-09-08 it was **222 Jest** (25 suites, `npx jest`) +
**210 pytest** (`pytest --collect-only -q`) + **98 Playwright** cases
(6 spec files × 2 browser projects), all green. Note what that number does not
cover: there is no component test and no server-action test, so the login,
passkey and recovery-code paths are exercised only end-to-end.
