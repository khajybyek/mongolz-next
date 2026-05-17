# 0002 — Per-recording HKDF-derived AES-256-GCM encryption

* **Status:** Accepted
* **Date:** 2026-02-14

## Context

Recordings contain raw (un-blurred) face data; the cubist-masked MP4 is
served to operators while the un-blurred original is kept encrypted at
rest in Supabase Storage. Reveal jobs decrypt on demand under the 4-eyes
approval flow (ADR 0003).

Encryption requirements:

- Confidentiality + integrity (a tampered ciphertext must fail decrypt).
- One leaked key cannot read every recording.
- Key rotation possible without re-encrypting the entire bucket.
- No HSM available (capstone budget = $0), so the key material lives in
  Vercel + Railway env vars.

## Decision

**AES-256-GCM, key-per-recording, derived via HKDF-SHA256 from a master
key.**

* Master key: `ML_ENCRYPTION_KEY` (32-byte base64-url), Railway env.
* Per recording: `key = HKDF(master, salt=recording_uuid, info="mongolz/recording/v1")`.
* Encrypt: `AES-GCM(key, plaintext, nonce=12-byte-random, aad=recording_uuid)`.
* Stored on disk: `nonce || ciphertext || tag`.
* Dual-key support: `ML_ENCRYPTION_KEY_PREV` is consulted on
  `InvalidTag` so rotation can proceed without a downtime window.

Implementation: `ml-service/crypto_utils.py`.

## Consequences

### Positive

- A single recording's leaked DEK never compromises others.
- Master key rotation is a 4-step ops procedure (documented in
  CLAUDE.md `🔄 Key Rotation Procedure`) with zero playback downtime
  for ≥ 1 week.
- HKDF salt = recording UUID means we don't have to store per-recording
  DEKs (saves a table + a leak surface).

### Negative

- Master key compromise = full bucket compromise. Mitigated by Vercel
  + Railway secret-encryption-at-rest + `rotate:keys` workflow.
- Reveal-flow CPU adds ~3 ms per chunk (HKDF + GCM init). Acceptable
  given the 4-eyes approval already adds human latency.

### Alternatives considered

* **Plaintext + RLS** — rejected; Supabase Storage is signed-URL based
  and a leaked URL bypasses RLS.
* **Per-frame keys** — rejected as over-engineering for the threat
  model (entire-file recovery is the realistic attack).
* **Envelope encryption with KMS** — *would* be the next step on the
  professional roadmap (ADR 0007 lists this as a follow-up).
