# Data Protection Impact Assessment — MONGOLZ Security

> **GDPR Art.35 + Korean PIPA Art.33** · Capstone 2026-01-CD-03-07 · 3B-26-1
> Last reviewed 2026-09-08

This DPIA template follows the EU EDPB structure (Sept-2017 guidelines) and
the ICO's UK GDPR DPIA template, adapted for an academic capstone deployment.

---

## Section A — Identifying the need for a DPIA

**Is a DPIA required for this processing?** **Yes.** Triggers met:

| GDPR Art.35(3) trigger | Met? | Why |
|---|---|---|
| (a) Systematic + extensive evaluation including profiling | **Yes** | Face detection + face-recognition matching against suspects |
| (b) Large-scale processing of special categories | **Yes** | Biometric face data (Art.9(1)) |
| (c) Systematic monitoring of publicly accessible area | **Yes** | CCTV-style continuous capture |

→ All three triggers satisfied; DPIA mandatory.

---

## Section B — Describe the processing

### B.1 Nature, scope, context and purposes

**Nature**: Continuous video capture from networked cameras; AES-256-GCM
encrypted archive of the unprocessed original; a privacy mask
(Voronoi-tessellation Cubist mosaic) applied **when a stored recording is
played back** — the masked view is rendered on demand from the encrypted
original and never persisted in Storage (ADR 0010); admin-initiated reveal
workflow with 4-eyes approval to recover original frames of specific subjects.

**The live HLS feed** (updated 2026-09-23): since commit `1ff609b` (deployed
2026-09-20) every ML-captured live frame passes through the same `FaceMasker`
as the playback view before it reaches the HLS writer, so `/grid`, `/wall` and
the `/live` CCTV tab show masked faces — admins included. The mask is
detection-based and best-effort: a face the detector misses is visible live.
If masking throws, the capture loop stops and is restarted by the supervisor;
no unmasked frame is written in its place. Unmasked pixels exist only in the
encrypted original (4-eyes reveal). The `/live` device and phone tabs are
local browser previews that never reach the ML service and are not masked.
The live path stays authenticated, recorded (`STREAM_VIEWED`, refusals as
`STREAM_DENIED`) and authorised per camera (camera enabled; admin, or an
explicit `camera_permissions` row) as defence in depth against missed
detections; `camera_permissions` is empty in the current deployment, so no
non-admin can watch live video today.

**Scope (per-recording typical)**:
- Resolution 1280×720 @ 15fps
- Duration 5–30 seconds in current capstone test set
- 1–3 unique faces per recording (post-dedup)
- Storage encrypted-at-rest, retained per `retention_policies` table (default
  90 days for revealed outputs, indefinite for source until a retention sweep)

**Context**: Capstone academic deployment. Test users are project-defined
admin / viewer / auditor accounts plus the project owner's personal account.
No public traffic; no production customers; no real CCTV connected outside
controlled test devices.

**Purpose**:
1. Demonstrate a privacy-preserving CCTV management architecture that meets
   GDPR Art.5(1)(b) (purpose limitation) and (1)(c) (data minimisation).
2. Provide a tiered-reveal workflow for hypothetical investigative use cases.
3. Serve as a capstone artefact for defense + paper publication.

### B.2 Data subjects

- Identifiable individuals whose face is captured by an enrolled camera
- Operators (admin / viewer / auditor / super-admin) authenticating into the
  system
- Suspects enrolled by an admin (with embedded photo + name + privacy_tier)

### B.3 Data categories

| Category | GDPR | PIPA equivalent | Volume |
|---|---|---|---|
| Face image (raw) | Art.9(1) biometric | Sensitive (민감정보) | Captured frames |
| Face embedding (ArcFace 512-dim) | Art.9(1) biometric | Sensitive | One per detected face |
| Operator email | Art.4(1) personal | Personal | One per account |
| Operator IP address | Art.4(1) | Personal | Each request |
| Session UA fingerprint | Pseudonymous | Pseudonymous | One per session |
| Audit log of admin actions | Pseudonymous | Personal | One row per event |
| TOTP secret | Authentication | Sensitive | One per enrollment |
| WebAuthn public key + counter | Authentication | Personal | One per enrolled passkey |
| Suspect name | Personal | Personal | One per enrolled suspect |

---

## Section C — Necessity & proportionality

| Question | Answer |
|---|---|
| Is processing strictly necessary for the stated purpose? | Yes — masked video alone proves the algorithm works; encrypted-original retention is necessary only because the use case requires post-hoc selective reveal |
| Are there less intrusive ways to achieve the purpose? | No — k-anonymity-only solutions cannot demonstrate a recovery workflow which is the project's thesis |
| Is data minimised? | Yes — the original is persisted only AES-256-GCM encrypted and the blurred view is derived at request time (ADR 0010); face crops are sealed per face (ADR 0009); embeddings stored only for the suspects feature; audit log only stores what's needed for accountability |
| How long is data retained? | Configurable per `retention_policies` table; default 90 days for masked recordings + revealed outputs; sweep cron `sweep_retention()` enforces |
| Is consent collected? | Camera consent table (`camera_consent` migration 20260516070053) records explicit consent per camera deployment; capstone deployment is on private test devices belonging to the project owner |

---

## Section D — Compliance + risk mitigation

### D.1 Lawful basis (GDPR Art.6 + Art.9)

| Basis | Used? | Justification |
|---|---|---|
| Art.6(1)(a) Consent | Partial | Project-owner consent to test capture |
| Art.6(1)(f) Legitimate interest | Yes | Academic demonstration of privacy-preserving architecture |
| Art.9(2)(a) Explicit consent (biometric) | Yes | Project owner's personal account + test subjects gave written consent |
| Art.9(2)(g) Substantial public interest | N/A | Not invoked — academic context |

### D.2 Data subject rights — implementation

| Right | Endpoint | Notes |
|---|---|---|
| Art.15 Access | `POST /api/gdpr/export` | Self-service JSON dump of profile + faces + alerts + audit log; admin only |
| Art.16 Rectification | Admin UI on `/users` and `/suspects` | Standard CRUD |
| Art.17 Erasure | `POST /api/gdpr/delete` + `/settings/erase` UI | Cascading delete via auth.users → ON DELETE CASCADE; recording sweep on next cron |
| Art.18 Restriction | Tag retention via `retention_policies` | Honoured by sweep |
| Art.20 Portability | Same as Art.15 export | JSON, machine-readable |
| Art.21 Object | Admin-only manual workflow | Future: dedicated UI |
| Art.22 Automated decision | Not in scope | No automated decision affects subjects materially |

### D.3 Technical & organisational measures (Art.32)

Documented in detail in `docs/THREAT_MODEL.md` §3 STRIDE matrix. Highlights:

| Control | Coverage |
|---|---|
| Encryption at rest | AES-256-GCM per-recording HKDF keys |
| Encryption in transit | TLS 1.3 via Vercel + Supabase + Railway edge |
| Access control | Role-based (admin / viewer / auditor / super-admin) + RLS + middleware allow-list. Ten personal-data tables additionally carry a restrictive RLS policy (`private.mfa_ok()`) that refuses a TOTP-enabled account's token unless it proves a factor other than a password — see "Auth factors" below |
| 4-eyes for high-impact actions | Reveal jobs gated by `reveal-approvals` page |
| Auth factors | password + TOTP 2FA (mandatory for admin) + WebAuthn passkey. Enforced **at the data tier** as well as in the application since 2026-09-08: the access token of a TOTP-enabled account must carry an `amr` method other than `password`, so a stolen password used directly against the public Supabase REST endpoint reaches no personal data ([ADR 0011](adr/0011-mfa-at-the-data-tier.md)). Fail-open where the claim is unreadable; `service_role` still bypasses RLS |
| Audit | Hash-chained log + `verify_audit_chain()` RPC. Covers every privileged mutation, every authentication/step-up event, and the personal-data read paths — `FACE_CROP_VIEWED`, `RECORDING_VIEWED`, `STREAM_VIEWED`/`STREAM_DENIED`, `FACE_SEARCH`, `REID_TRAIL`, `ALERTS_EXPORTED`, `REVEAL_OUTPUT_DOWNLOADED` (`lib/audit.ts`). Object-scoped reads collapse to one row per user per object per 5 minutes; for live streams only the playlist request is logged, not each segment. Does **not** cover page views, dashboard/analytics aggregates, the audit-log's own CSV export, or reads a browser makes directly against PostgREST under RLS |
| Pseudonymisation | Cubist mask applied to the playback view (not at capture, and not on the live feed — see §B.1); embeddings stored separately from raw images |
| Backup | Supabase point-in-time recovery (24 h RPO) + weekly `backup-verify` cron tests decryption |
| Incident response | `BREAK_GLASS.md` 5 procedures + Sentry + Slack alert on lockout |
| Continuous security testing | Semgrep (681 rules) + trufflehog + Nuclei + OWASP ZAP — all weekly |
| Per-suspect privacy tier | VIP suspects get 2-3× stronger masking automatically |

### D.4 Specific risks + mitigations

| Risk | Likelihood | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Subject re-identified despite mask | Medium | High | Cubist Voronoi mosaic measured at **SSIM 0.613 ± 0.058** (standard tier, n = 20) vs Gaussian 0.778 and 8×8 pixelation 0.627 — see the measurement note below. Masking is one layer; the originals are encrypted and the reveal path is 4-eyes gated | **Medium** — the mask beats Gaussian clearly, but its margin over pixelation is inside one standard deviation, and no face-recovery rate has been measured |
| Faces missed by the detector are visible on the live feed | Medium | High | Live HLS frames are masked by the shared `FaceMasker` since 2026-09-20 (§B.1); a missed detection is the residual exposure. Access requires an authenticated session, is recorded per view, and is restricted to admins plus holders of an explicit `camera_permissions` grant; segments are deleted when the session stops | **Low–Medium** — bounded, attributable audience; exposure limited to detector misses (mask strength and miss rate as in the row above) |
| Decrypted biometric data processed outside the EU | High (by design) | Medium | Storage and the Railway ML service that decrypts, detects and embeds are both in Singapore since 2026-09-20 (`asia-southeast1`; `us-west2` before); transport is TLS 1.3 and the blobs are AES-256-GCM at rest | **Low** — single-region processing; SCCs still needed for EU subjects (Singapore is outside the EU); see §D.5 |
| Mask bypass via reveal misuse | Low | Critical | 4-eyes approval + step-up TOTP + audit chain + time-bounded scope + watermark on output | Very low |
| Bystander face captured + revealed | Medium | Medium | Reveal flow targets specific face_id only; everyone else stays masked even after reveal; time-bounded window limits temporal scope | Low |
| Storage breach | Low | High | AES-256-GCM means breach alone yields ciphertext; HKDF per-recording means single-key compromise affects one file | Very low |
| Insider abuse | Medium | High | RLS + 4-eyes reveal + lockout alerts + super-admin DB lock; auditor role is read-only. The hash-chained log records every privileged change, every login/step-up, and the personal-data read paths listed in §D.3 — so decrypting a crop, opening a recording, running a 1:N search, exporting a CSV or pulling a reveal output is attributable. It does **not** record page views, dashboard aggregates, or direct PostgREST reads, so a curious operator's browsing is only partially reconstructable — those direct reads now at least require a session that passed the second factor (ADR 0011) | **Medium** — attributable for the paths that expose data, blind for ordinary browsing |
| Admin password used directly against the Supabase API | Medium | High | The REST/Auth endpoints are public and the anon key ships in the browser bundle, so a stolen admin password used to be enough to read and delete surveillance data over plain HTTP, outside every application control and outside the audit log. Since 2026-09-08 the ten personal-data tables require `private.mfa_ok()`: a TOTP-enabled account's token must prove a factor other than a password (ADR 0011). Non-TOTP accounts (viewer, auditor) hold no such access by role | **Low** — a password alone no longer reaches personal data; a stolen *post-TOTP* session token still does, and `service_role` compromise remains out of scope of this control |
| Data subject not notified of breach | Medium | High | Sentry incident → Slack alert → manual notification per Art.33(1) timeline; `BREAK_GLASS.md` §3 documents the 72-hour clock | Low |

#### Measurement note — where the masking numbers come from

Earlier revisions of this DPIA justified a *Low* residual with "Cubist SSIM ≈ 0.3
(vs Gaussian ≈ 0.7)". No run in this repository produced 0.3. The two runs that
exist are:

| Run | Corpus | Cubist standard | Cubist VIP | Pixelate 8×8 | Gaussian 21×21 |
|---|---|---|---|---|---|
| `ml-service/docs/BENCHMARK_REAL_FACES.json` → `docs/BENCHMARK_REAL.md`, 2026-05-18 | 20 StyleGAN3 face crops (~600², photo-realistic) | **0.613 ± 0.058** | 0.626 ± 0.059 | 0.627 ± 0.061 | 0.778 ± 0.058 |
| `docs/BENCHMARK_RESULTS.json` → `docs/BENCHMARK.md`, 2026-05-18 | 12 synthetic crops drawn with OpenCV primitives | 0.457 ± 0.016 | 0.457 ± 0.013 | 0.476 ± 0.003 | 0.479 ± 0.007 |

The second run is the source of the "0.457" figure quoted in the 2026-09-08
audit. It is **not** comparable to the first: it uses drawn shapes rather than
faces, and `docs/BENCHMARK.md` records that scikit-image was absent so SSIM fell
back to a correlation-squared approximation. Its own spread (0.457 → 0.479
across every algorithm, Gaussian included) shows it cannot discriminate between
masks and should not be quoted as a privacy figure.

The real-face run is the one to cite. What it supports:

- Cubist is materially stronger than Gaussian blur (0.613 vs 0.778) — the
  design decision to reject Gaussian is evidence-backed.
- Cubist standard is **not** meaningfully stronger than 8×8 pixelation
  (0.613 vs 0.627, σ ≈ 0.06). The tier ordering relaxed < standard < VIP holds
  for PSNR but the SSIM differences between cubist tiers are within noise.
- SSIM is a structural-similarity proxy, not a re-identification measure. The
  metric that would justify a *Low* residual — ArcFace cosine between the
  original face and the masked face (face-recovery rate) — is still a stub in
  `ml-service/eval/benchmark_mask_algorithms.py` and has never been run.

Reproduce: `cd ml-service && ./venv/bin/python eval/benchmark_mask_algorithms.py
--input-dir samples/ --output docs/BENCHMARK_REAL_FACES.json` (needs
`scikit-image`; the sample fetcher is `eval/fetch_face_samples.py`).

### D.5 International transfers (Art. 44–49)

| Hop | What crosses | Region |
|---|---|---|
| Browser → Vercel | Session, UI requests, uploaded frames | Vercel `sin1`, Singapore (`vercel.json`) |
| Vercel → Supabase | Rows, encrypted blobs, signed URLs | Supabase `ap-southeast-1`, Singapore |
| Vercel/Supabase → Railway ML | **Decrypted frames, face crops, embeddings** | Railway `asia-southeast1`, Singapore (since 2026-09-20; `us-west2`, United States before) |
| Vercel → Anthropic (Claude) | Alert summaries — text only, no images/embeddings | us-east |
| App → Sentry | Error events (scrubbed) | us-east |

The third hop is the material one: the ML service holds `ML_ENCRYPTION_KEY`,
decrypts recordings and computes embeddings. Since the 2026-09-20 deployment
(`d97c4507`, verified 2026-09-23 via `railway status --json` →
`multiRegionConfig` = `asia-southeast1-eqsg3a`) that processing happens in
Singapore, where the data is stored. History: the 2026-09-08 check (deployment
`194b45c0`) found `us-west2` (United States), i.e. an SG → US → SG hop for
Art. 9 data; that hop no longer exists.

For any EU subject this still needs SCCs (Singapore is outside the EU); for a
Korean subject, the Singapore processing is a 국외 이전 under PIPA Art. 28-8. For the current capstone deployment the only subjects are the
project owner and consenting test subjects, which is why the DPIA does not stop
here — but the transfer is now on the record.

---

## Section E — Korean PIPA cross-mapping

| PIPA Article | Requirement | Implementation |
|---|---|---|
| Art.15 | Lawful purpose for collection | Documented in §B.1 |
| Art.17 | Provision to third parties | None — single-deployment architecture |
| Art.23 | Sensitive data handling (incl. biometrics) | AES-256-GCM + RLS + admin-only retrieval |
| Art.28-2 | De-identification | The Cubist mask is the de-identification step on the playback view and, since 2026-09-20, on the live feed (§B.1); its measured strength is in the note under §D.4 |
| Art.28-8 | Cross-border transfer (국외 이전) | Storage and biometric processing are both in Singapore (Railway `asia-southeast1` since 2026-09-20; `us-west2` before) — see §D.5. Consent basis for the Singapore transfer to be papered before any non-test subject is captured |
| Art.29 | Technical safeguards | See §D.3 |
| Art.35 | Data subject rights | Mirror of GDPR Art.15–22 above |
| Art.39 | Penalties for negligence | Audit log + lockout alerts ensure incident traceability |

---

## Section F — Sign-off

| Role | Name | Approval |
|---|---|---|
| DPO equivalent | (project owner — capstone author) | Self-attested |
| Data subject representative | N/A (test deployment) | — |
| Review trigger | Quarterly + on auth/RLS/encryption change | See §6 of `THREAT_MODEL.md` |

**Document version**: 1.2 — 2026-09-08 correction pass after the full audit
(`docs/audits/2026-09-08-full-audit.mn.md`): masking is at view time and absent
from the live feed, the SSIM figures now match the repository's own benchmark
runs, audit-log coverage is stated with its boundary, and the SG → US processing
transfer is recorded in §D.5. Revised again the same day for audit §4.1: the
second factor is now enforced at the data tier, so a stolen admin password used
directly against the public Supabase API no longer reaches personal data
([ADR 0011](adr/0011-mfa-at-the-data-tier.md)).
**Next review**: 2027-03-08 OR on first feature touching auth/RLS/encryption.
