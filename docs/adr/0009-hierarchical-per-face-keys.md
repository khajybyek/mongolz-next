# 0009 — Hierarchical per-face keys via hash chain

* **Status:** Accepted
* **Date:** 2026-05-19

## Context

ADR 0002 encrypts an entire recording with a single per-recording key.
That is sufficient for "all faces or none" reveal, but real deployments
have a **trust hierarchy**: a director should be able to reveal every
person in a clip, while a shift operator should only reveal the subset
relevant to their authority.

Encrypting every face with the *same* recording key cannot express this
— anyone who can decrypt one face can decrypt all of them. We need
per-face keys where access is *graded*: a higher-ranked key unlocks its
own face **and everyone below it**, a lower-ranked key unlocks only its
own scope, and a low key can **never** climb to a higher face.

Constraints:

- No key-distribution server / PKI (capstone budget = $0).
- The set of faces is only known after detection (variable length N).
- Must remain compatible with the existing reveal/audit flow.

## Decision

**Forward hash chain over per-face AES-256-GCM keys.**

```
K₀  = HKDF(master, salt="mongolz-face-chain-v1", info = recording_id ‖ ":face-chain-root")
Kᵢ₊₁ = SHA256(Kᵢ)                       # one-way
Face i → AES-256-GCM(Kᵢ)                # chain_index = detection order
```

A holder of `Kₗ` can:

- decrypt face `l` directly, and
- derive `Kₗ₊₁ = SHA256(Kₗ)`, `Kₗ₊₂`, … to decrypt every face **at or
  below** their level.

A holder of `Kₗ` **cannot** compute `Kₗ₋₁` because SHA-256 is
preimage-resistant — so they can never reveal a higher-ranked face.

Role → level mapping (illustrative):

| Level | Role | Reveal scope |
|-------|------|--------------|
| K₀ | Director | all faces |
| K₃ | Manager | faces 3…N |
| Kₙ | Operator | only face N |

Implementation: `ml-service/hierarchical_keys.py`
(+ `tests/test_hierarchical_keys.py`, 19 cases;
`demo_hierarchical_reveal.py` for a visual matrix).

## Consequences

**Positive**

- Least-privilege reveal — graded access without a PKI or key server.
- Only the ML service (master key holder) can mint any level key; lower
  tiers receive a single `Kₗ` out-of-band and derive forward only.
- Deterministic: `(master, recording_id, index) → Kᵢ`, so nothing extra
  is stored per key — `chain_index` on the `faces` row is enough.
- Composes with ADR 0002 (master key + rotation) and ADR 0003 (4-eyes):
  4-eyes still gates *whether* a reveal runs; the chain decides *how far
  down* it can see.

**Negative / trade-offs**

- **Ordering defines hierarchy.** "Higher" = earlier detection index by
  default. A deployment that wants priority-by-risk must sort faces
  before assigning chain indices.
- **No revocation of a single mid-chain key.** Handing out `K₃` also
  grants 4…N forever; to "demote" you must re-encrypt with a new root.
- **Coarser than per-(face,user) ACL.** This is a linear hierarchy, not
  an arbitrary access matrix. For non-linear policies use the existing
  `permissions` table instead (per-user/per-camera grants).
- Adds a column (`faces.chain_index`) and changes face-crop storage from
  plain JPEG to `nonce‖ct‖tag`; the reveal path must derive the key
  rather than read the crop directly.

## Alternatives considered

- **Per-suspect key** (`HKDF(master, suspect_id)`): rejected — most
  detected faces are *unknown* (no suspect row), and it gives no
  hierarchy, only isolation.
- **Tree / KDF ladder (GGM)**: supports arbitrary subset grants but is
  far heavier; a linear chain matches the rank-based use case at a
  fraction of the complexity.
- **Attribute-based encryption (ABE)**: the "correct" general answer but
  needs a pairing library + policy engine — out of scope for a $0
  capstone.
