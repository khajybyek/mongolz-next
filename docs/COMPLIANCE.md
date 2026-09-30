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
| Facial images (raw) | Camera capture | Encrypted original for lawful reveal (4-eyes); per-face crop sealed with a hash-chain key | **Encrypted in Storage** (AES-256-GCM; no plaintext frame or crop is uploaded to Supabase Storage since Tier 2). Two derived copies live transiently on the ML container's own disk: the live HLS segments of a camera (`/tmp/mongolz-hls`, a rolling window during a session, deleted when the session stops — **masked** frames since `1ff609b`, 2026-09-20) and the masked playback render cache (`/tmp/mongolz-views`, served only while the recording row still exists). On `standard` cameras unmasked pixels exist only inside the encrypted original. **Cameras in the optional face-encrypted recording mode** ([ADR 0013](adr/0013-face-encrypted-recording-mode.md)) store no raw original at all: the stored video is itself masked (a keyed cipher pattern over every detected face) and encrypted, and unmasked face pixels exist only in the per-face envelope below, in each identified face's sealed crop, and — after an approved reveal — in that reveal's output (a plaintext restored MP4 in the private `revealed` bucket until retention removes it, as for `standard` reveals); apart from any face the detector missed, which stays visible in that stored video |
| Face envelopes (face-encrypted cameras only) | Camera capture: every detected face region of every frame, JPEG (quality ≈ 90, at most 192 px for the padded crop, so a face is kept at about 120 px at most), plus one ArcFace embedding per face track per recognition tick (the identity sample) | Restoration of one selected person through the 4-eyes reveal | Each blob and each identity sample AES-256-GCM-sealed under its track's hash-chain key (ADR 0009), bound to recording, track and frame; one envelope object per recording segment (`recordings.face_envelope_path`, at most 40 MiB), kept and deleted with its recording. Nothing is written for frames captured in `private` mode (ADR 0012) |
| Facial embeddings (512-dim ArcFace) | Derived. For frames captured in `private` mode none is computed — not at capture, not by the on-demand playback view, the evidence exports or the reveal job, which all mask such frames with the detector alone — and none is stored or matched. The one exception is a sub-second lag of the capture masker after a boundary (transient, discarded; see "Privacy schedules" in §3) | Suspect matching, dedup | Until subject erasure (GDPR Art. 17) |
| Encrypted recordings | Camera capture | Evidence trail | Default 30 days, configurable per retention policy |
| Alerts (suspect match events) | System-generated | Operator review | Default 90 days |
| Audit log (hash-chained) | System-generated | Tamper-evident trail | Indefinite (legal requirement) |
| User profiles (email, role) | Self-registration | Access control | Until account deletion |
| TOTP secret + recovery code hashes | User-supplied | 2FA | Until TOTP disabled |
| Session cookies (session-pin, reauth, pre-totp) | Browser | Auth state | 7d / 15m / 2m respectively |

---

## 2. GDPR (Regulation (EU) 2016/679) — Article-by-Article

| Article | Right / Obligation | Implementation |
|---|---|---|
| **Art. 5** Principles | Data minimization, purpose limitation, storage limitation | Unmasked frames are kept only inside the encrypted original (on a face-encrypted camera: only in the sealed per-face envelope); per-camera retention policies; audit-only access. **Per-camera privacy schedules** ([ADR 0012](adr/0012-privacy-schedules-tightening-only.md)) turn the recognition step off for chosen time windows: no stored embeddings, face rows, crops or alerts. This limits purpose and minimises data by time; see "Privacy schedules" in §3. The optional **face-encrypted recording mode** ([ADR 0013](adr/0013-face-encrypted-recording-mode.md)) stores no raw original for the cameras that use it, and a reveal decrypts only the selected person's faces; see "Face-encrypted recording mode" in §3 |
| **Art. 6** Lawfulness | Public interest / legitimate interest | Operator declares basis when registering camera (UI to be added) |
| **Art. 13/14** Information | Privacy notice at signup | Provided on the public landing (`/`) — Korean title + tagline. Full notice TBD |
| **Art. 15** Access | Subject access request | `/api/gdpr/export` endpoint returns all rows tagged with the requester's email |
| **Art. 16** Rectification | Update incorrect data | `/users` admin form |
| **Art. 17** Erasure | "Right to be forgotten" | `/privacy` self-service page + `/api/gdpr/delete` |
| **Art. 20** Portability | Machine-readable export | `/api/gdpr/export` returns JSON; CSV available via `/api/audit/export` (admin) |
| **Art. 22** Automated decisions | Human-in-the-loop on alerts | Reveal flow requires 4-eyes approval; no automated enforcement |
| **Art. 25** Privacy by design | Encrypt-at-rest + mask-at-view pipeline (ADR 0010) | Originals AES-256-GCM encrypted; the blurred view is derived at request time and never persisted in Storage; face crops sealed per face (ADR 0009). Encryption is **server-side**, not end-to-end — the ML service holds the key. Live frames are masked by the same detector-based masker since 2026-09-20 (see §3 caveat). Privacy settings can only tighten: a schedule can turn identification off but can never un-mask video (ADR 0012). A camera can opt into face-encrypted recording (ADR 0013): each face is sealed separately at capture and no raw original is kept; switching back to `standard` needs a TOTP step-up. Still server-side encryption — the ML service holds the master key |
| **Art. 30** Records of processing | This document + `audit_log` | Maintained. `audit_log` covers privileged changes, auth events and the personal-data read paths — **not** page views or direct PostgREST reads; see "Audit-log coverage" in §3 |
| **Art. 32** Security of processing | RLS, AES-256, TOTP (enforced at the data tier as well as in the app — see "Second factor at the data tier" in §3), audit hash-chain | See [SECURITY.md](../SECURITY.md) + CLAUDE.md `Security Features` |
| **Art. 33/34** Breach notification | 72-hour rule | Process documented in [docs/BREAK_GLASS.md](BREAK_GLASS.md). 3rd-party SIEM not yet integrated |
| **Art. 35** DPIA | High-risk processing (biometric data, surveillance) | This document serves as the lightweight DPIA. Full DPIA template recommended pre-production |
| **Art. 37** DPO | Designate a Data Protection Officer | Not required for academic scope; recommended for production |
| **Art. 44** International transfers | Storage **and** biometric processing in Singapore | Supabase (`ap-southeast-1`), Vercel (`sin1`) and — since 2026-09-20 — the Railway ML service (`asia-southeast1`, the component that decrypts recordings, detects faces and computes embeddings) all run in Singapore. Singapore is outside the EU, so EU subject data flows still need Standard Contractual Clauses (one hop). History: until 2026-09-20 the ML service ran in `us-west2` (United States) and every frame crossed SG → US and back |

**Residual risks** (would be flagged in a formal DPIA):
1. **Facial recognition is biometric** under GDPR Art. 9 — requires explicit consent or substantial public interest grounds. Operators must declare basis per camera. A privacy schedule (ADR 0012) can limit identification to the hours the declared basis covers. It is a minimisation tool and does not replace the basis.
2. **Audit log indefinite retention** — necessary for forensic value, but tension with Art. 5(e). Mitigation: aggregate-only after N years (TBD).
3. **Cross-border data flow, single region.** Storage, app compute and the ML service that handles the *decrypted* biometric payload all sit in Singapore (Railway `asia-southeast1` since 2026-09-20, deployment `d97c4507`, verified 2026-09-23). Singapore is outside the EU, so SCCs are still required for EU subjects. History: until 2026-09-20 the ML service ran in `us-west2` (United States), a second, wider hop for Art. 9 data; that hop no longer exists.
4. **Face-encrypted mode makes a missed detection permanent.** On a camera in that mode (ADR 0013) a face the capture-time detector misses is stored unmasked in the only video there is, with no original to re-render with a better detector later. In `standard` mode the on-demand view is rendered from the original with the current masker whenever its cache is cold. Choose the mode per camera with that trade-off in mind; the detector's miss rate on real footage has not been measured (§5).

---

## 3. PIPA (Korea — 개인정보 보호법) — Korean Personal Information Protection Act

| Article | Right / Obligation | Implementation |
|---|---|---|
| **Art. 15** Consent for collection | Documented basis per camera | Per-camera `consent_required` flag in DB |
| **Art. 17** Provision to 3rd parties | None | The system does not share data outside its own boundaries |
| **Art. 23** Sensitive info | Biometric requires separate consent | Operators must declare basis; UI to be added. A per-camera privacy schedule (ADR 0012) switches biometric processing off outside the hours it is justified |
| **Art. 24-2** Resident registration numbers | Not collected | N/A |
| **Art. 27** Outsourcing | Supabase + Railway + Vercel are sub-processors | Listed in this document; DPA required pre-production |
| **Art. 28-2** Pseudonymization | Cubist mosaic + encrypted originals; optional per-face encryption at capture (ADR 0013) | Implemented for stored/derived playback and, since 2026-09-20, for the ML-captured live HLS feed. A face-encrypted camera stores a video pseudonymised at capture (keyed cipher pattern over each face) and keeps each face sealed separately for per-person restoration. Detection-based in every mode: a missed face is visible (see the live-stream caveat below), and on a face-encrypted camera permanently so |
| **Art. 29** Security measures | Audit log, encryption, TOTP | Implemented |
| **Art. 35** Right to access | `/api/gdpr/export` covers KR subjects too |  |
| **Art. 36** Correction / deletion | `/privacy` self-service | Implemented |
| **Art. 39** Breach notification | 72h to PIPC | Process via [BREAK_GLASS.md](BREAK_GLASS.md) |
| **Art. 39-7** Right not to be subject to automated decisions | 4-eyes reveal | Implemented |

**Capstone defense talking points (in Korean panel):**
- "저장된 원본은 암호화되어 있고, 재생 화면은 열람 시점에 비식별화됩니다" — the stored original is encrypted and the playback view is anonymised at request time (ADR 0010); un-blurring requires 4-eyes approval and is audit-logged. (The ML-captured live feed is masked by the same detector since 2026-09-20; the `/live` device and phone tabs are local previews and are not masked — see the caveat below.)
- "원본은 AES-256-GCM 으로 암호화되며, 4-eyes 승인 후에만 복원됩니다" — originals are encrypted; only revealed after 4-eyes approval.
- "영업시간(09:00–18:00)에는 얼굴 인식과 알림이 꺼지며, 그 시간에 촬영된 영상은 4-eyes 승인으로도 복원되지 않습니다" — during the scheduled private hours, face recognition and alerts are off, and footage captured then cannot be revealed even with 4-eyes approval (ADR 0012). The video is still recorded and masked; the masks are placed by the face detector alone, which computes no face embedding. Say that too.
- "얼굴 암호화 모드에서는 원본 영상을 저장하지 않고, 얼굴 영역마다 별도의 키로 암호화해 둡니다. 복원할 때는 승인된 대상 인물의 얼굴만 복호화되고, 다른 사람의 얼굴은 복호화되지 않습니다" — in the optional face-encrypted mode (ADR 0013) no raw original is stored and each face region is encrypted with its own key; a restoration decrypts only the approved target's face and never anyone else's. Attach the limits in the same breath: "검출기가 놓친 얼굴은 암호화되지 않고 저장 영상에 그대로 남습니다" (a face the detector misses is not encrypted and stays in the stored video), restored faces are lossy JPEG crops (a face kept at about 120 px), a face is restored only where the capture-time recognition samples match the target, and the server holds the master key — "서버 측 암호화이며 종단 간 암호화는 아닙니다" (server-side, not end-to-end).
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
[ADR 0011](adr/0011-mfa-at-the-data-tier.md). Since 2026-09-28 the check is
also bound to the session itself: the application records every session it
mints after a verified TOTP code, recovery code or passkey, and the database
refuses a TOTP account's session it did not record — so a session obtained
from a magic-link or recovery e-mail (someone controlling the admin's
mailbox) reaches no personal data either.

State the limits with the control: it is **fail-open** where it cannot tell
(a token with no readable `amr` or `session_id` claim is allowed, so that a change in the auth
provider cannot lock the operator out), `profiles` and the tables read during
login are deliberately not gated, `service_role` still bypasses RLS entirely,
and a session that has already passed TOTP remains a bearer token — this closes
the password-only path, not token theft. It also does not make direct PostgREST
reads *auditable*; it only bounds who can make them.

**Privacy schedules: purpose limitation by time.** Until 2026-09-28 the
per-camera schedule at `/cameras/<id>/schedule` was a preview. It was stored in
the database, but no processing component read it (audit §6.4). It is now
enforced, and it can only **tighten** protection ([ADR 0012](adr/0012-privacy-schedules-tightening-only.md)):

- There are two modes. **`standard`** (the default) is the existing behaviour:
  video is masked, faces are recognised once per second of video (ArcFace
  embedding, sealed crop and `faces` row, suspect matching and alerts), and
  reveal goes through the 4-eyes workflow. **`private`** keeps the video masked
  and turns the recognition step off: no stored embeddings, no face rows or
  crops, no suspect matching for alerts, no alerts and no inference on edge
  frames. Footage
  captured in `private` mode can **never** be revealed. The reveal job keeps
  those frames masked and does not run matching on them.
- No setting un-masks video. The old `revealed` option was removed on purpose.
  Un-masking remains only the 4-eyes reveal.
- Example: **09:00–18:00 `private`** means staff and customers are not put
  through recognition during business hours, and **after hours `standard`** means
  recognition and alerts cover intruders. This is purpose limitation and data
  minimisation by time (GDPR Art. 5(1)(b)(c), Art. 25; PIPA Art. 3 and Art. 23).
- The mode is decided at **capture** time in Asia/Seoul. A `private` window wins
  over a `standard` one, and outside every window the camera's default applies.
  A live frame's capture instant is known only within a bound (the camera's
  source clock against the wall clock); the pipeline treats a frame as private
  if any instant of that bound is, so the start of a private window is never
  identified. The pipeline stores the intervals it captured in `private` mode
  (`recording_privacy_spans`); the spans are delivered together with the
  footage (capture journal and spool manifest) and reach the database before
  the recording becomes playable or revealable. A later edit to the schedule
  cannot make that footage revealable.
- Loosening (a `standard` window, deleting a `private` window, or a
  `private` → `standard` default) needs a fresh TOTP step-up, notifies the other
  admins and writes an audit row (`PRIVACY_SCHEDULE_ADD` / `_DELETE`,
  `PRIVACY_DEFAULT_CHANGE`). Tightening is one click. The database accepts
  schedule writes from the service role only, so a stolen admin token cannot
  loosen a schedule through the REST API. Adding a camera needs the same TOTP
  step-up (a second row for a `private` feed would otherwise start `standard`),
  and `authenticated` cannot UPDATE `recordings`, so the capture time and camera
  a recording is judged by cannot be moved through the REST API either.
- The web warns on the schedule page and `/health` when the running ML service
  does not report that it enforces schedules (`privacy_schedules` on `GET /`):
  the web and the ML service are deployed separately, and an older ML build
  ignores schedules.

State the limits with the control:

- **Masking keeps running, without identification.** In `private` mode every
  masking path — the live capture masker, the on-demand playback view, the
  evidence clip and frame, and the reveal output — places masks with the face
  detector alone (no ArcFace embedding), skips the suspect-tier lookup and
  gives every face the strongest (VIP) mask. The one exception: the mode
  reaches the live capture masker on the once-per-second tick, so up to 1 s of
  frames after a boundary into `private` can still get the standard-mode pass
  (a transient embedding, discarded, and the tier lookup; nothing is stored).
  If the detector-only call is unavailable, private frames are masked by Haar
  and the persistence cache only — never by the full pass — and an error is
  logged.
- **Boundaries are conservative, not exact.** The pipeline errs towards
  `private` (recognition resumes about 5 s after a private window ends). The
  reveal job and the view renderers widen the schedule by 60 s on each side
  when they place it on a recording, because a recording's timeline is an
  estimate of wall-clock time. The recorded spans are exact records of what the
  pipeline did.
- **Propagation delay.** The ML service re-reads a schedule every 30 s, so an
  edit usually reaches running cameras within about 30 s. If it cannot read the
  database it keeps the last good schedule for up to 10 minutes.
- **Fail-closed.** If the schedule cannot be read for 10 minutes, or was never
  read since the ML service started, every camera is treated as `private`.
  Recognition and alerts stop until the database is back, rather than
  identifying people in a window someone marked private. Footage captured in
  that state is recorded as protected (`source = 'fail_closed'`) and can
  **never** be revealed afterwards, even on a `standard` camera, short of
  deleting its spans by hand with the service role (`docs/RUNBOOK.md` — a
  manual procedure that nothing in the product enforces).
- **Tightening is retroactive for reveal only.** A `private` window added later
  does not delete faces or alerts already produced in `standard` mode. It
  withholds that time from future reveals for as long as the window exists;
  loosening it again (TOTP step-up) releases that footage. The reveal refusal
  and the playback page say which of the two applies.
- **`private` footage is still recorded**, encrypted and kept under the retention
  policy, and it can be watched masked. The reveal job refuses it, but the key
  still exists: whoever holds the ML master key or the service role can decrypt
  it outside the product (the ADR 0009 boundary).
- Browser uploads without a camera are always `standard`. The `/live` device and
  phone previews are not affected.

**Face-encrypted recording mode: restoration per person.** Added 2026-09-30
([ADR 0013](adr/0013-face-encrypted-recording-mode.md)). Each camera has a
recording mode. **`standard`** (the default) is everything above: an encrypted
raw original and a masked view rendered from it on demand. **`face_encrypted`**
is opt-in:

- **No raw original is stored.** The stored video is masked at capture — every
  detected face region is replaced by a keyed cipher pattern (flat cells whose
  colours come from a keystream, not from the face, with a thin outline) — and
  that video is encrypted at rest with the per-recording key (ADR 0002).
- **Every face region of every frame is sealed separately** in a per-segment
  face envelope (`recordings.face_envelope_path`): a JPEG crop (quality ≈ 90,
  at most 192 px) under AES-256-GCM with the hash-chain key of its face track
  (ADR 0009), bound to the recording, track and frame so blobs cannot be
  swapped. The index linking tracks to identified faces is sealed with the
  per-recording key.
- **A reveal decrypts only the selected person.** The 4-eyes reveal (ADR 0003)
  compares its target with the identity samples (capture-time ArcFace
  embeddings, sealed per track) of the tracks the requester's `reveal_level`
  reaches, selects the tracks whose samples match at the job threshold, and
  pastes only their confirmed frames back onto the masked video. Every other
  face stays cipher in the output because its pixels were never decrypted —
  not because a second detector pass found it. (The job does decrypt the
  identity samples — embeddings — of every track within the level to find the
  target, as the standard path compares every face of a clip.) This is GDPR
  Art. 25 / PIPA Art. 28-2 data minimisation at the moment of restoration.
- **Frames captured in `private` mode (ADR 0012) get no envelope**, so those
  faces can never be restored by anyone — including a segment's last frames,
  which a closing check drops when their capture time may be private.
- **Choosing the mode.** `standard` → `face_encrypted` stores less and is one
  click (audited). `face_encrypted` → `standard` stores raw originals again, so
  it needs a fresh TOTP step-up, writes an audit row and notifies the other
  admins. Only the service role writes `cameras`. The mode applies to new
  segments; existing recordings keep the mode they were captured in. If the
  ML service cannot read a camera's mode (right after a restart, database
  slow or down), the camera records face-encrypted segments until it can —
  the unreadable case stores less, never a raw original.
- Recognition, alerts, the sealed crop and embedding of each identified face,
  the live feed (cubist-masked as today), privacy schedules, privacy zones and
  the audit log are unchanged.

State the limits with the control:

- **A face the detector misses is not encrypted.** It stays visible in the
  stored masked video, and there is no original to render again with a better
  detector — `standard` mode keeps that option. See residual risk 4 in §2.
- **Unidentified tracks cannot be restored.** A face track the once-per-second
  recognition tick never sampled stays sealed, and none of the reveal methods
  (photo, suspect, detected face) can select it. A sampled track is restored
  only where its samples nearest before and after a frame both match the
  target, so a poor-pose sample leaves up to about two seconds masked; before
  a track's first or after its last sample, only over the unbroken detection
  run around that sample (a face the detector loses often loses up to about a
  second at each end).
- **Tracking is geometric.** Two faces crossing, or one replacing another at
  the same spot within a third of a second, can hand a track from one person
  to the other. A sample never vouches for frames across a missed detection,
  so a replacement at the same spot is not restored with the other person's
  samples; a crossing with no missed frame, or a double swap between two
  samples of the target, can still bring up to about a second of the other
  person into a restoration, and a swap no tick samples goes unnoticed. `reveal_level` gates
  tracks, not people: a person's first track is ranked before their `faces`
  row, so a requester who can open a person's crop may still be refused that
  person's first track.
- **Restored faces are lossy**: JPEG crops of the padded box, capped so the
  face itself is kept at about 120 px, resized to their recorded box and
  feathered in; a close-up comes back visibly softer than the video.
- **Footage is dropped under overload**: when the ML service falls behind a
  live camera, the stored video repeats the last masked frame (no original
  keeps the missed frames).
- **Server-side encryption, not end-to-end.** The ML service still holds the
  master key and can derive every per-face key. What changes is that a
  restoration decrypts only the selected person's blobs; that is enforced by
  the trusted ML service, not a cryptographic barrier against it (ADR 0009).
- **Storage cost** grows with face-seconds: at 15 fps about 44–91 KiB per
  second for a 64 px face, 84–169 KiB for a 128 px face and 90–182 KiB for a
  large face (flat to busy background; measured with the envelope writer on
  the bundled samples, sealing the padded rectangle the pipeline paints; ADR
  0013, Costs). An envelope is capped at 40 MiB per segment.
- **An envelope is the only copy of those faces.** If it is lost and no backup
  holds it, the faces in that recording can never be restored; the masked video
  still plays (`docs/RUNBOOK.md`). The stored envelope is one AES-GCM
  ciphertext, so any damage to the object — cut short, one flipped bit —
  makes every reveal of that recording fail (`[face_envelope_invalid]`), not
  just the damaged frames. A segment interrupted before it is finalised is
  dropped as `partial`, masked video and envelope alike, as in `standard`
  mode.
- The envelope's record headers (frame, track, box) are authenticated but not
  encrypted: a holder of the object learns where and when faces appeared — what
  the outline in the masked view shows anyway — but no pixels and no identity.
- `reveal_level` was 0 for every profile at the last check (2026-09-23), so the
  level gate does not yet narrow any reveal in production.

**Live-stream caveat.** Since commit `1ff609b` (deployed 2026-09-20) every ML-captured live frame passes through the same `FaceMasker` as the playback view before it is written to HLS, so `/grid`, `/wall` and the `/live` CCTV tab show masked faces — for admins too. The masker is detection-based and best-effort: a face the detector misses is visible. If masking throws, the capture loop stops and the supervisor restarts it; no unmasked frame is written in its place. The `/live` device and phone tabs are local browser previews that never reach the ML service and are **not** masked. Unmasked pixels exist only in the encrypted original (on a face-encrypted camera: in the sealed per-face envelope, ADR 0013), reachable through the audited 4-eyes reveal. The access controls below stay as defence in depth against missed detections. Access to that feed is authenticated, recorded (`STREAM_VIEWED`, and `STREAM_DENIED` for refusals) and authorised per camera: the camera must be `enabled`, an admin always passes, and every other role needs an explicit `camera_permissions` row for that camera. `private.user_can_see_camera()` remains default-allow and is kept only as defence-in-depth mirroring RLS; the stricter rule is enforced in `app/api/ml/stream/[cameraId]/[segment]/route.ts`. Refusals return 403 with a machine-readable `code` (`camera_disabled`, `camera_not_authorized`, `permission_check_failed`) and are recorded as `STREAM_DENIED`. `camera_permissions` holds no rows in production, so at the time of writing no non-admin account can watch live video at all.

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
- [x] **Make the masking schedule real** (audit §6.4) — enforced since
  2026-09-28 as tightening-only privacy schedules (ADR 0012); `cameras.mask_default`
  was replaced by `cameras.privacy_default`
- [x] **Embedding-free capture masking in `private` mode** — the capture
  masker uses the detector alone (`FaceEngine.detect_boxes`), skips the suspect
  tier lookup and gives every face the VIP mask (ADR 0012)
- [x] **Embedding-free on-demand playback view and evidence exports** —
  `view_renderer.py` loads the recording's protected timeline (spans ∪ the
  camera's schedule, 60 s margin) and masks protected frames with the detector
  alone and the VIP mask; an unreadable timeline masks the whole recording that
  way (ADR 0012)
- [x] **Per-person restoration without a raw original** — optional
  face-encrypted recording mode per camera (ADR 0013): each face region sealed
  under its track's hash-chain key, reveal decrypts only the selected person
- [ ] **Measure the capture detector's miss rate on real footage** before
  recommending the face-encrypted mode for a camera: in that mode a missed face
  is stored unmasked in the only video and cannot be masked later (§2 residual
  risk 4)
- [ ] **Enforce `cameras.consent_required`** (audit §6.4) — the flag is stored
  and editable on `/cameras` but no processing component reads it yet; the PIPA
  Art. 15 row above documents a basis, not an enforced control

---

## 6. Document control

- **Version:** 1.4
- **Last reviewed:** 2026-09-30 (optional face-encrypted recording mode —
  "Face-encrypted recording mode" in §3, §1 data categories, Art. 5 / 25 /
  PIPA Art. 28-2 rows, residual risk 4, [ADR 0013](adr/0013-face-encrypted-recording-mode.md)).
  Previously 2026-09-28 (privacy schedules enforced, tightening only;
  same day: capture-time bound instead of a point, spans delivered with the
  footage, embedding-free view / evidence renderers, "exact reveal" wording
  withdrawn —
  "Privacy schedules" in §3 and [ADR 0012](adr/0012-privacy-schedules-tightening-only.md);
  the Art. 28-2 row and the Korean talking point now match the masked live feed).
  Previously 2026-09-08 (correction pass after the full audit —
  `docs/audits/2026-09-08-full-audit.mn.md` §4.10 and §6.2: ML region, audit-log
  coverage, live-feed masking; then, the same day, §4.1: the second factor is
  now enforced at the data tier — see "Second factor at the data tier" in §3 and
  [ADR 0011](adr/0011-mfa-at-the-data-tier.md))
- **Next review:** 2027-03-08 (or upon significant feature change)
- **Owner:** MONGOLZ Security capstone team (3B-26-1)
