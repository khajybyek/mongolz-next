# Data Protection Impact Assessment — MONGOLZ Security

> **GDPR Art.35 + Korean PIPA Art.33** · Capstone 2026-01-CD-03-07 · 3B-26-1
> Last reviewed 2026-05-18

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

**Nature**: Continuous video capture from networked cameras; on-capture
privacy mask (Voronoi-tessellation Cubist mosaic); AES-256-GCM encrypted
archive of the unprocessed original; admin-initiated reveal workflow with
4-eyes approval to recover original frames of specific subjects.

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
| Is data minimised? | Yes — masked-at-capture means raw frames never persist outside encryption; embeddings stored only for the suspects feature; audit log only stores what's needed for accountability |
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
| Access control | Role-based (admin / viewer / auditor / super-admin) + RLS + middleware allow-list |
| 4-eyes for high-impact actions | Reveal jobs gated by `reveal-approvals` page |
| Auth factors | password + TOTP 2FA (mandatory for admin) + WebAuthn passkey |
| Audit | Hash-chained log + `verify_audit_chain()` RPC |
| Pseudonymisation | Masking-at-capture; embeddings stored separately from raw images |
| Backup | Supabase point-in-time recovery (24 h RPO) + weekly `backup-verify` cron tests decryption |
| Incident response | `BREAK_GLASS.md` 5 procedures + Sentry + Slack alert on lockout |
| Continuous security testing | Semgrep (681 rules) + trufflehog + Nuclei + OWASP ZAP — all weekly |
| Per-suspect privacy tier | VIP suspects get 2-3× stronger masking automatically |

### D.4 Specific risks + mitigations

| Risk | Likelihood | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Subject re-identified despite mask | Low | High | Cubist Voronoi mosaic SSIM ≈ 0.3 (vs Gaussian ≈ 0.7); embedding-based identification is the explicit decryption purpose, not an attack | Low |
| Mask bypass via reveal misuse | Low | Critical | 4-eyes approval + step-up TOTP + audit chain + time-bounded scope + watermark on output | Very low |
| Bystander face captured + revealed | Medium | Medium | Reveal flow targets specific face_id only; everyone else stays masked even after reveal; time-bounded window limits temporal scope | Low |
| Storage breach | Low | High | AES-256-GCM means breach alone yields ciphertext; HKDF per-recording means single-key compromise affects one file | Very low |
| Insider abuse | Medium | High | RLS + audit + 4-eyes + lockout alerts + super-admin DB lock; auditor role is read-only | Low |
| Data subject not notified of breach | Medium | High | Sentry incident → Slack alert → manual notification per Art.33(1) timeline; `BREAK_GLASS.md` §3 documents the 72-hour clock | Low |

---

## Section E — Korean PIPA cross-mapping

| PIPA Article | Requirement | Implementation |
|---|---|---|
| Art.15 | Lawful purpose for collection | Documented in §B.1 |
| Art.17 | Provision to third parties | None — single-deployment architecture |
| Art.23 | Sensitive data handling (incl. biometrics) | AES-256-GCM + RLS + admin-only retrieval |
| Art.28-2 | De-identification | Masking at capture is the de-identification step |
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

**Document version**: 1.0
**Next review**: 2026-08-18 OR on first feature touching auth/RLS/encryption.
