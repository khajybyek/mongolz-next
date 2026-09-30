# Architecture Decision Records

This directory captures the load-bearing engineering decisions behind
MONGOLZ Security. Each ADR follows the [Michael Nygard format][nygard]:
context → decision → consequences. They are written **retroactively**
during the capstone polish phase, but they describe the original
constraints that shaped each choice.

[nygard]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions

## Conventions

- One ADR per file, numbered `NNNN-kebab-title.md`.
- `Status` is one of: Proposed / Accepted / Deprecated / Superseded.
- Once accepted, an ADR is **immutable**. Replace via a new ADR that
  references the old one with `Supersedes: NNNN`.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-cubist-voronoi-mask.md) | Cubist Voronoi mosaic as the primary face-mask algorithm | Accepted |
| [0002](0002-per-recording-hkdf-aes-gcm.md) | Per-recording HKDF-derived AES-256-GCM encryption | Accepted |
| [0003](0003-four-eyes-reveal-approval.md) | Four-eyes principle for face reveal (super-admin exception since 2026-09-30) | Accepted, amended |
| [0004](0004-hash-chained-audit-log.md) | Hash-chained immutable audit log | Accepted |
| [0005](0005-supabase-rls-as-authorization.md) | Supabase RLS as primary authorization boundary | Accepted |
| [0006](0006-step-up-totp-reauth.md) | Step-up TOTP re-authentication for sensitive views | Accepted |
| [0007](0007-edge-agent-scaling.md) | On-prem edge agent for >5 cameras | Accepted |
| [0008](0008-arc-face-cosine-thresholds.md) | ArcFace + pgvector cosine thresholds (0.45 / 0.35) | Accepted |
| 0009 | [Hierarchical per-face keys](0009-hierarchical-per-face-keys.md) | Accepted |
| 0010 | [On-demand blurred view](0010-on-demand-blurred-view.md) | Accepted |
| 0011 | [Prove the second factor at the data tier](0011-mfa-at-the-data-tier.md) | Accepted |
| 0012 | [Privacy schedules can only tighten protection](0012-privacy-schedules-tightening-only.md) | Accepted |
| 0013 | [Optional face-encrypted recording mode](0013-face-encrypted-recording-mode.md) | Accepted |
