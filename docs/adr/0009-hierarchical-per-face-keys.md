# 0009 — Hierarchical per-face keys via hash chain

* **Status:** Accepted · implemented · **partially deployed** (settable from
  `/users`, but every production profile is still level 0 and self-promotion is
  an open gap — see "Deployment status" at the end)
* **Date:** 2026-05-19 · deployment status revised 2026-09-08

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
(+ `tests/test_hierarchical_keys.py`, 23 cases as of 2026-09-08 —
`pytest tests/test_hierarchical_keys.py --collect-only -q`;
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

## Honest threat model — what this protects (and what it does NOT)

> Added 2026-05-28 after a security review flagged over-claiming.

This is **storage-at-rest + delegated-key** access control, enforced as an
**authorization gate** by the trusted services — *not* a cryptographic
impossibility against our own backend.

- The **ML service holds the master key** and can derive any `Kᵢ`. It is the
  trusted decryptor. The `chain_index < level → 403` gate (in `reveal_job`
  and the `/face/{id}/secure-crop` endpoint) is **authorization**, supplied by
  the Next.js proxy after it authenticates an admin and reads their
  `reveal_level` server-side (not client-forgeable through the normal path).
- The **forward hash chain is meaningful** for two real threats:
  1. **Stolen storage blobs** — an attacker who exfiltrates the `*.enc`
     face crops/embeddings plus a single leaked `K_level` can open faces
     `≥ level` but never below (SHA-256 preimage resistance).
  2. **Out-of-band delegated keys** — if a per-level key is handed to a
     party directly (instead of going through the proxy), that party is
     forward-only bounded.
- It does **NOT** protect against a holder of `ML_SERVICE_TOKEN` (who can
  call the endpoint with `level=0`) or against the ML service itself.

### Deployment status (be accurate in the defense)

*Rewritten 2026-09-08. The previous text said "no admin UI currently sets it";
that has been false since the Tier 1 work landed — `/users` has set
`reveal_level` since commit `1f7b8ef`.*

**What is true today:**

1. **The control exists and is wired end-to-end.** `profiles.reveal_level`
   (0–99) is set from `/users` — `setRevealLevelAction` in
   `app/(app)/users/actions.ts`, surfaced as the Layers control in
   `users-table.tsx`. The action requires an admin session plus step-up
   reauth, validates with zod, writes an audit row (`USER_REVEAL_LEVEL`), and
   pins the super admin to level 0. The level is honoured by `reveal_job` and
   by `/api/faces/[id]/secure-crop` (`chain_index < level → 403`).
2. **It is not yet populated.** Every profile in production is still at level
   `0`: 3 admins, 1 viewer, 1 auditor, all director-level (verified
   2026-09-08: `select role, reveal_level, count(*) from public.profiles
   group by 1,2`). So in the deployment as it stands, every admin can still
   decrypt every face — not because the mechanism is missing, but because
   nobody has been graded down.
3. **KNOWN GAP — an admin can raise their own level.**
   `setRevealLevelAction` checks that the *target* is not the super admin, but
   it does **not** check that the caller is not the target, nor that the level
   being granted is at or below the caller's own. An admin at level 5 can set
   their own row to level 0 and unlock every face; the audit row records it
   after the fact but nothing stops it. Found in the 2026-09-08 audit
   (`docs/audits/2026-09-08-full-audit.mn.md` §5.2, remediation P1 #8) and
   **not fixed at the time of writing** — it is being handled as a separate
   change. Until it lands, the chain is a boundary against *stolen blobs* and
   *out-of-band delegated keys* (the two threats above), not against a hostile
   admin with a session.

**Say this, and nothing stronger:** "the hierarchical per-face key scheme is
implemented, verified by 23 tests
(`ml-service/tests/test_hierarchical_keys.py`), and settable from the admin UI;
levels are not yet assigned in production, and self-promotion is a known open
gap." Do not say "least-privilege enforced in production".
