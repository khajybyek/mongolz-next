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
| Facial images (raw) | Camera capture | One-time embedding extraction | **Never stored** — discarded after embedding |
| Facial embeddings (512-dim ArcFace) | Derived | Suspect matching, dedup | Until subject erasure (GDPR Art. 17) |
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
| **Art. 5** Principles | Data minimization, purpose limitation, storage limitation | Raw frames discarded after embedding; per-camera retention policies; audit-only access |
| **Art. 6** Lawfulness | Public interest / legitimate interest | Operator declares basis when registering camera (UI to be added) |
| **Art. 13/14** Information | Privacy notice at signup | Provided on the public landing (`/`) — Korean title + tagline. Full notice TBD |
| **Art. 15** Access | Subject access request | `/api/gdpr/export` endpoint returns all rows tagged with the requester's email |
| **Art. 16** Rectification | Update incorrect data | `/users` admin form |
| **Art. 17** Erasure | "Right to be forgotten" | `/privacy` self-service page + `/api/gdpr/erase` |
| **Art. 20** Portability | Machine-readable export | `/api/gdpr/export` returns JSON; CSV available via `/api/audit/export` (admin) |
| **Art. 22** Automated decisions | Human-in-the-loop on alerts | Reveal flow requires 4-eyes approval; no automated enforcement |
| **Art. 25** Privacy by design | Mask-then-encrypt pipeline | Cubist mosaic applied before storage; AES-256-GCM on originals |
| **Art. 30** Records of processing | This document + `audit_log` | Maintained |
| **Art. 32** Security of processing | RLS, AES-256, TOTP, audit hash-chain | See [SECURITY.md](../SECURITY.md) + CLAUDE.md `Security Features` |
| **Art. 33/34** Breach notification | 72-hour rule | Process documented in [docs/BREAK_GLASS.md](BREAK_GLASS.md). 3rd-party SIEM not yet integrated |
| **Art. 35** DPIA | High-risk processing (biometric data, surveillance) | This document serves as the lightweight DPIA. Full DPIA template recommended pre-production |
| **Art. 37** DPO | Designate a Data Protection Officer | Not required for academic scope; recommended for production |
| **Art. 44** International transfers | Singapore region for compute | Supabase + Railway + Vercel are co-located in `ap-southeast-1`. EU subject data flows must use Standard Contractual Clauses or local hosting |

**Residual risks** (would be flagged in a formal DPIA):
1. **Facial recognition is biometric** under GDPR Art. 9 — requires explicit consent or substantial public interest grounds. Operators must declare basis per camera.
2. **Audit log indefinite retention** — necessary for forensic value, but tension with Art. 5(e). Mitigation: aggregate-only after N years (TBD).
3. **Cross-border data flow** — Singapore region is outside the EU. SCCs needed for EU subjects.

---

## 3. PIPA (Korea — 개인정보 보호법) — Korean Personal Information Protection Act

| Article | Right / Obligation | Implementation |
|---|---|---|
| **Art. 15** Consent for collection | Documented basis per camera | Per-camera `consent_required` flag in DB |
| **Art. 17** Provision to 3rd parties | None | The system does not share data outside its own boundaries |
| **Art. 23** Sensitive info | Biometric requires separate consent | Operators must declare basis; UI to be added |
| **Art. 24-2** Resident registration numbers | Not collected | N/A |
| **Art. 27** Outsourcing | Supabase + Railway + Vercel are sub-processors | Listed in this document; DPA required pre-production |
| **Art. 28-2** Pseudonymization | Cubist mosaic + encrypted originals | Implemented |
| **Art. 29** Security measures | Audit log, encryption, TOTP | Implemented |
| **Art. 35** Right to access | `/api/gdpr/export` covers KR subjects too |  |
| **Art. 36** Correction / deletion | `/privacy` self-service | Implemented |
| **Art. 39** Breach notification | 72h to PIPC | Process via [BREAK_GLASS.md](BREAK_GLASS.md) |
| **Art. 39-7** Right not to be subject to automated decisions | 4-eyes reveal | Implemented |

**Capstone defense talking points (in Korean panel):**
- "익명화는 캡처 시점에 수행됩니다" — anonymization is performed at capture time, not retrospectively.
- "원본은 AES-256-GCM 으로 암호화되며, 4-eyes 승인 후에만 복원됩니다" — originals are encrypted; only revealed after 4-eyes approval.
- "모든 권한 있는 액세스는 해시 체인 감사 로그에 기록됩니다" — every privileged access is recorded in a hash-chained audit log.

---

## 4. Sub-processors

| Provider | Service | Region | DPA available |
|---|---|---|---|
| Supabase | Database + Auth + Storage | ap-southeast-1 (Singapore) | Yes (GDPR + SCCs) |
| Railway | ML service hosting | asia-southeast1 (Singapore) | Yes |
| Vercel | Frontend + API edge | sin1 (Singapore compute) | Yes |
| Anthropic | Claude AI (analysis only) | us-east (text only, no biometric data sent) | Yes |
| Sentry | Error monitoring | us-east | Yes |

PII flowing to Anthropic: **alert summaries only** (suspect name + camera + timestamp + similarity). No images, no embeddings, no raw biometric data.

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

---

## 6. Document control

- **Version:** 1.0
- **Last reviewed:** 2026-05-17
- **Next review:** 2026-11-17 (or upon significant feature change)
- **Owner:** MONGOLZ Security capstone team (3B-26-1)
