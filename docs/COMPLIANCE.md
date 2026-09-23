# Compliance — MONGOLZ Security

This document is a lightweight, capstone-level mapping of the system's
controls to the privacy regulations most likely to apply
(GDPR for EU residents, PIPA for Korean residents). It is **not** a legal
opinion. Before production use outside an academic setting, retain a
qualified DPO and conduct a full audit.

---

## 1. Scope of personal data processed

| Data category | Source | Purpose | Retention |
|---|---|---|---|
| Facial images (raw) | Camera capture | Encrypted original for lawful reveal (4-eyes); per-face crop sealed with a hash-chain key | **Encrypted in Storage** (AES-256-GCM; no plaintext frame or crop is uploaded to Supabase Storage since Tier 2). Two derived copies live transiently on the ML container's own disk: the live HLS segments of a camera (`/tmp/mongolz-hls`, a rolling window during a session, deleted when the session stops — **masked** frames since `1ff609b`, 2026-09-20) and the masked playback render cache (`/tmp/mongolz-views`, served only while the recording row still exists). Unmasked pixels exist only inside the encrypted original |
| Facial embeddings (512-dim ArcFace) | Derived | Suspect matching, dedup | Until subject erasure (GDPR Art. 17) |
| Encrypted recordings | Camera capture | Evidence trail | Default 30 days, configurable per retention policy |
| Alerts (suspect match events) | System-generated | Operator review | Default 90 days |
| Audit log (hash-chained) | System-generated | Tamper-evident trail | Indefinite (legal requirement) |
| User profiles (email, role) | Self-registration | Access control | Until account deletion |
| TOTP secret + recovery code hashes | User-supplied | 2FA | Until TOTP disabled |
| Session cookies (session-pin, reauth, pre-totp) | Browser | Auth state | 7d / 15m / 2m respectively |
| SCH Esports registrations (name, e-mail, Facebook, phone, in-game ids, rank, notes) — `sch_registrations`, `sch_teams` | Public form at `/sch` (consent line) or the organiser's Google-Form import | Organise the Chuseok 2026 tournament and contact the players (consent text: "used only to organise the tournament") | Until the event is closed out: `/sch/admin` → *Close out the event* (admin + TOTP step-up, typed confirmation, only from 00:00 KST the day after the last game day) deletes every row and team. Not automatic — the admin must run it after the last game (2026-09-27 → from 2026-09-28) |
| SCH payment receipts (bank-transfer screenshots) — private `sch-receipts` bucket | Uploaded by the registrant | Payment check by the organiser (every view audited) | Deleted by the same close-out, before the rows; abandoned uploads older than 24 h are removed by the console's manual «Sweep orphaned receipts» button. Imported rows only link to the Google Form owner's Drive — those files and responses must be deleted in Google by the form owner |

---

## 2. GDPR (Regulation (EU) 2016/679) — Article-by-Article

| Article | Right / Obligation | Implementation |
|---|---|---|
| **Art. 5** Principles | Data minimization, purpose limitation, storage limitation | Raw frames discarded after embedding; per-camera retention policies; audit-only access |
| **Art. 6** Lawfulness | Public interest / legitimate interest | Operator declares basis when registering camera (UI to be added) |
| **Art. 13/14** Information | Privacy notice at signup | Provided on the public landing (`/`) — Korean title + tagline. Full notice TBD |
| **Art. 15** Access | Subject access request | `/api/gdpr/export` endpoint returns all rows tagged with the requester's email |
| **Art. 16** Rectification | Update incorrect data | `/users` admin form |
| **Art. 17** Erasure | "Right to be forgotten" | `/privacy` self-service page + `/api/gdpr/delete` |
| **Art. 20** Portability | Machine-readable export | `/api/gdpr/export` returns JSON; CSV available via `/api/audit/export` (admin) |
| **Art. 22** Automated decisions | Human-in-the-loop on alerts | Reveal flow requires 4-eyes approval; no automated enforcement |
| **Art. 25** Privacy by design | Encrypt-at-rest + mask-at-view pipeline (ADR 0010) | Originals AES-256-GCM encrypted; the blurred view is derived at request time and never persisted in Storage; face crops sealed per face (ADR 0009). Encryption is **server-side**, not end-to-end — the ML service holds the key. Live frames are masked by the same detector-based masker since 2026-09-20 (see §3 caveat) |
| **Art. 30** Records of processing | This document + `audit_log` | Maintained. `audit_log` covers privileged changes, auth events and the personal-data read paths — **not** page views or direct PostgREST reads; see "Audit-log coverage" in §3 |
| **Art. 32** Security of processing | RLS, AES-256, TOTP (enforced at the data tier as well as in the app — see "Second factor at the data tier" in §3), audit hash-chain | See [SECURITY.md](../SECURITY.md) + CLAUDE.md `Security Features` |
| **Art. 33/34** Breach notification | 72-hour rule | Process documented in [docs/BREAK_GLASS.md](BREAK_GLASS.md). 3rd-party SIEM not yet integrated |
| **Art. 35** DPIA | High-risk processing (biometric data, surveillance) | This document serves as the lightweight DPIA. Full DPIA template recommended pre-production |
| **Art. 37** DPO | Designate a Data Protection Officer | Not required for academic scope; recommended for production |
| **Art. 44** International transfers | Storage **and** biometric processing in Singapore | Supabase (`ap-southeast-1`), Vercel (`sin1`) and — since 2026-09-20 — the Railway ML service (`asia-southeast1`, the component that decrypts recordings, detects faces and computes embeddings) all run in Singapore. Singapore is outside the EU, so EU subject data flows still need Standard Contractual Clauses (one hop). History: until 2026-09-20 the ML service ran in `us-west2` (United States) and every frame crossed SG → US and back |

**Residual risks** (would be flagged in a formal DPIA):
1. **Facial recognition is biometric** under GDPR Art. 9 — requires explicit consent or substantial public interest grounds. Operators must declare basis per camera.
2. **Audit log indefinite retention** — necessary for forensic value, but tension with Art. 5(e). Mitigation: aggregate-only after N years (TBD).
3. **Cross-border data flow, single region.** Storage, app compute and the ML service that handles the *decrypted* biometric payload all sit in Singapore (Railway `asia-southeast1` since 2026-09-20, deployment `d97c4507`, verified 2026-09-23). Singapore is outside the EU, so SCCs are still required for EU subjects. History: until 2026-09-20 the ML service ran in `us-west2` (United States), a second, wider hop for Art. 9 data; that hop no longer exists.

---

## 3. PIPA (Korea — 개인정보 보호법) — Korean Personal Information Protection Act

| Article | Right / Obligation | Implementation |
|---|---|---|
| **Art. 15** Consent for collection | Documented basis per camera | Per-camera `consent_required` flag in DB |
| **Art. 17** Provision to 3rd parties | None | The system does not share data outside its own boundaries |
| **Art. 23** Sensitive info | Biometric requires separate consent | Operators must declare basis; UI to be added |
| **Art. 24-2** Resident registration numbers | Not collected | N/A |
| **Art. 27** Outsourcing | Supabase + Railway + Vercel are sub-processors | Listed in this document; DPA required pre-production |
| **Art. 28-2** Pseudonymization | Cubist mosaic + encrypted originals | Implemented for stored/derived playback; **not** applied to the live HLS feed (see §2 caveat) |
| **Art. 29** Security measures | Audit log, encryption, TOTP | Implemented |
| **Art. 35** Right to access | `/api/gdpr/export` covers KR subjects too |  |
| **Art. 36** Correction / deletion | `/privacy` self-service | Implemented |
| **Art. 39** Breach notification | 72h to PIPC | Process via [BREAK_GLASS.md](BREAK_GLASS.md) |
| **Art. 39-7** Right not to be subject to automated decisions | 4-eyes reveal | Implemented |

**Capstone defense talking points (in Korean panel):**
- "저장된 원본은 암호화되어 있고, 재생 화면은 열람 시점에 비식별화됩니다" — the stored original is encrypted and the playback view is anonymised at request time (ADR 0010); un-blurring requires 4-eyes approval and is audit-logged. (The *live* HLS feed is a separate path and is **not** masked — see the caveat below.)
- "원본은 AES-256-GCM 으로 암호화되며, 4-eyes 승인 후에만 복원됩니다" — originals are encrypted; only revealed after 4-eyes approval.
- "권한 변경과 개인정보 열람 경로(복호화·재생·검색·내보내기)는 해시 체인 감사 로그에 기록됩니다" — privileged changes **and the application's personal-data read paths** are recorded in the hash-chained audit log. Say it with the boundary attached, below — do not say "everything is logged".

**Audit-log coverage — say this precisely.** `audit_log` records (a) every privileged mutation and configuration change, (b) every authentication and step-up event, and (c) the application read paths that expose personal data. The read actions are `FACE_CROP_VIEWED`, `RECORDING_VIEWED`, `STREAM_VIEWED`, `STREAM_DENIED`, `FACE_SEARCH`, `REID_TRAIL`, `ALERTS_EXPORTED` and `REVEAL_OUTPUT_DOWNLOADED` (`lib/audit.ts` is the single source of truth).

Two properties of that ledger an auditor should be told before they infer more than it says:

- **Granularity.** Object-scoped reads collapse to one row per user per object per 5 minutes, matching the media routes' `max-age=300` cache hint. A row means "this operator opened this object in this window", not "this many times".
- **Edges.** For live streaming only the playlist request is recorded (`STREAM_VIEWED` / `STREAM_DENIED`); the individual `.ts` segments that follow are not. `ALERTS_EXPORTED` covers the alert-history CSV; the audit-log's own CSV export (`/api/audit/export`) is currently not recorded.

It does **not** record: page views and the queries that render them, dashboard and analytics aggregates, or any read a signed-in browser makes directly against PostgREST with its own token — RLS still limits *which* rows such a read returns, but the read itself leaves no ledger entry. "Every privileged access is recorded" is therefore an over-claim; the accurate claim is "every privileged change, every login, and every personal-data read path in the application is recorded".

**Second factor at the data tier.** Until 2026-09-08 the second factor was an
application control only: the Supabase REST endpoint is on the public internet,
the anon key ships in every browser bundle, and the RLS policies asked nothing
beyond `profiles.role`. An admin password alone was therefore enough to read —
and, through the `FOR ALL` policies, delete — faces, alerts, cameras and
recordings over plain HTTP, with none of the application's TOTP, session-pin,
step-up or 4-eyes controls in the way and no audit row produced.

The database now checks the token itself. Ten tables (`faces`, `alerts`,
`recordings`, `cameras`, `suspects`, `clusters`, `reveal_jobs`, `audit_log`,
`webhooks`, `camera_sessions`) carry a restrictive RLS policy requiring
`private.mfa_ok()`: if the profile has TOTP enabled, the access token must carry
an `amr` method other than `password`. Sessions the application mints after a
verified TOTP or passkey step qualify; a raw `grant_type=password` token does
not. Accounts without TOTP (viewer, auditor) are unaffected. See
[ADR 0011](adr/0011-mfa-at-the-data-tier.md).

State the limits with the control: it is **fail-open** where it cannot tell
(a token with no readable `amr` claim is allowed, so that a change in the auth
provider cannot lock the operator out), `profiles` and the tables read during
login are deliberately not gated, `service_role` still bypasses RLS entirely,
and a session that has already passed TOTP remains a bearer token — this closes
the password-only path, not token theft. It also does not make direct PostgREST
reads *auditable*; it only bounds who can make them.

**Live-stream caveat.** Since commit `1ff609b` (deployed 2026-09-20) every ML-captured live frame passes through the same `FaceMasker` as the playback view before it is written to HLS, so `/grid`, `/wall` and the `/live` CCTV tab show masked faces — for admins too. The masker is detection-based and best-effort: a face the detector misses is visible. If masking throws, the capture loop stops and the supervisor restarts it; no unmasked frame is written in its place. The `/live` device and phone tabs are local browser previews that never reach the ML service and are **not** masked. Unmasked pixels exist only in the encrypted original, reachable through the audited 4-eyes reveal. The access controls below stay as defence in depth against missed detections. Access to that feed is authenticated, recorded (`STREAM_VIEWED`, and `STREAM_DENIED` for refusals) and authorised per camera: the camera must be `enabled`, an admin always passes, and every other role needs an explicit `camera_permissions` row for that camera. `private.user_can_see_camera()` remains default-allow and is kept only as defence-in-depth mirroring RLS; the stricter rule is enforced in `app/api/ml/stream/[cameraId]/[segment]/route.ts`. Refusals return 403 with a machine-readable `code` (`camera_disabled`, `camera_not_authorized`, `permission_check_failed`) and are recorded as `STREAM_DENIED`. `camera_permissions` holds no rows in production, so at the time of writing no non-admin account can watch live video at all.

---

## 4. Sub-processors

| Provider | Service | Region | DPA available |
|---|---|---|---|
| Supabase | Database + Auth + Storage | ap-southeast-1 (Singapore) — dashboard reports "Southeast Asia (Singapore)" | Yes (GDPR + SCCs) |
| Railway | ML service hosting — **decrypts recordings, detects faces, computes embeddings** | asia-southeast1 (Singapore, zone `asia-southeast1-eqsg3a`) — the deployment's `multiRegionConfig`, 1 replica; `us-west2` (United States) until 2026-09-20 | Yes |
| Vercel | Frontend + API edge | sin1 (Singapore) — `vercel.json` `regions: ["sin1"]` | Yes |
| Anthropic | Claude AI (analysis only) | us-east (text only, no biometric data sent) | Yes |
| Sentry | Error monitoring | us-east | Yes |

PII flowing to Anthropic: **alert summaries only** (suspect name + camera + timestamp + similarity). No images, no embeddings, no raw biometric data.

The Railway region is the one that matters for GDPR Art. 44 / PIPA Art. 28-8: it is the only sub-processor that ever holds a *decrypted* face. Verified 2026-09-23 from the Railway API for the active deployment `d97c4507` (created 2026-09-20; `railway status --json`, field `multiRegionConfig` → `asia-southeast1-eqsg3a`). History: the 2026-09-08 check (deployment `194b45c0`) found `us-west2`; the service moved to Singapore with the 2026-09-20 deployment.

---

## 5. Open compliance items (defense scope)

These are knowingly deferred — they would block a real production launch but are out of scope for capstone:

- [ ] Formal DPIA template (this doc is the lightweight version)
- [ ] Privacy policy URL displayed on public landing
- [ ] Cookie consent banner (Art. 7 GDPR if non-essential cookies are added)
- [ ] Data Processing Agreement template for camera operators
- [x] **Pseudonymization key rotation schedule** — automated weekly reminder
  via `/api/cron/key-rotation-check` (Vercel Cron). See RUNBOOK §4.
- [x] **Annual penetration test by external party** — replaced for capstone
  scope with continuous DAST: weekly Nuclei (8000+ CVE templates) + OWASP ZAP
  baseline scan + Semgrep SAST + trufflehog secret scan + multi-agent audit.
  External annual pentest still recommended pre-production.
- [ ] 24-month review cadence for this document
- [x] **Move ML processing to the storage region** — Railway moved from
  `us-west2` to `asia-southeast1` with deployment `d97c4507` (2026-09-20,
  verified 2026-09-23); the SG → US hop no longer exists — see §2 Art. 44 and §4
- [x] **Per-camera authorisation for the live feed** — enforced in the stream
  route since 2026-09-08 (admin, or an explicit `camera_permissions` row).
  Remaining work is operational: populate grants for the accounts that need
  live video. Live frames are masked since 2026-09-20; the grant remains the
  control for faces the detector misses

---

## 6. Document control

- **Version:** 1.2
- **Last reviewed:** 2026-09-08 (correction pass after the full audit —
  `docs/audits/2026-09-08-full-audit.mn.md` §4.10 and §6.2: ML region, audit-log
  coverage, live-feed masking; then, the same day, §4.1: the second factor is
  now enforced at the data tier — see "Second factor at the data tier" in §3 and
  [ADR 0011](adr/0011-mfa-at-the-data-tier.md))
- **Next review:** 2027-03-08 (or upon significant feature change)
- **Owner:** MONGOLZ Security capstone team (3B-26-1)
