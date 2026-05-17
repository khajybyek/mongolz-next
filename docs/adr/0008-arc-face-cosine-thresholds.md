# 0008 — ArcFace + pgvector cosine thresholds (0.45 / 0.35)

* **Status:** Accepted
* **Date:** 2026-02-26

## Context

The system needs to answer two cross-camera identity questions:

1. **Suspect alert** — "Is this detected face the same person as a row
   in `suspects`?" (false-positive cost: an admin opens an alert).
2. **Deduplication** — "Did we already alert on this face in the last
   hour?" (false-positive cost: missed alert).

Both reduce to a cosine-similarity threshold on 512-dimensional ArcFace
embeddings stored in `pgvector` columns.

Threshold choice has a precision/recall trade-off. The ArcFace paper
reports operating points at 0.30 (high precision, low recall) through
0.55 (high recall, low precision) on LFW.

## Decision

Two distinct thresholds, both queryable as `match_suspects` /
`match_faces` SQL functions:

| Use case | Threshold | Rationale |
|---|---|---|
| Suspect alert (`ALERT_THRESHOLD`) | **0.45** | Balanced operating point; a TP-FP curve on our test set peaked F1 here. Operators see a manageable rate without missing obvious matches. Tunable per-suspect via `/active-learning` page (F1-optimal threshold from feedback) |
| Dedup (`DEDUP_THRESHOLD`) | **0.35** | More aggressive merging — the same person at the same camera within a minute should *almost certainly* be one alert. Slight risk of merging two similar-looking strangers, accepted because the cost is just a missed second alert |

Both are exposed as environment variables on the ML service so they can
be tuned without a redeploy.

The pgvector index uses **HNSW (m=16, ef_construction=64)** for
sub-millisecond approximate-nearest-neighbour queries at ≥ 50k row
counts. Cosine distance metric matches ArcFace's normalised embedding
space.

## Consequences

### Positive

- One number controls each policy — easy to A/B test.
- `/active-learning` uses TP/FP labels to suggest the F1-optimal
  threshold per suspect — recover from the global default with data.
- `pgvector` keeps the search in-database; no separate FAISS service.

### Negative

- Thresholds are bound to the specific buffalo_l ArcFace model. A
  model swap requires re-tuning + invalidating the historical
  embeddings (they'd live in a slightly different feature space).
  Mitigation: ADR-out-of-scope: model versioning with a `model_id`
  column on `faces` + `suspects`.
- Cosine on un-normalised vectors would silently degrade. The ML
  service enforces unit norm on both insert and query.

### Drift

If new ArcFace versions ship, run the benchmark script on a held-out
set and update the threshold table here in a new ADR.
