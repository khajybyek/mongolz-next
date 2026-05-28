# 0010 — On-demand blurred view from encrypted original

* **Status:** Accepted
* **Date:** 2026-05-28

## Context

Through Polish Phase 2 every finalised recording produced **two
playback artifacts** that were stored side-by-side in the `recordings`
bucket:

1. `*_blurred.mp4` — plaintext H.264, cubist mosaic baked into the
   pixels at write time. Served to viewers via a Supabase signed URL.
2. `*_original.mp4.enc` — AES-256-GCM-encrypted source frames, kept
   only for the reveal flow (ADR 0002).

The original was already the **single cryptographic source of truth**:
reveal jobs decrypt it, run InsightFace selectively, and re-emit a
watermarked MP4. The plaintext blurred artifact existed only because
the playback page needs *something* to stream to unauthorised viewers.

This had three concrete costs:

- **Storage doubled.** Every recording stored an unencrypted blurred
  copy alongside the encrypted master. For a defense system whose
  whole pitch is "everything sensitive is encrypted at rest", an
  always-plaintext per-recording artifact is a weak spot.
- **Recording-time CPU wasted.** The pipeline ran cubist Voronoi
  tessellation per detected face per frame, ran an extra ffmpeg
  encoder pipe, and wrote a second MP4 — even when no viewer would
  ever open the recording.
- **Two artifacts must agree.** Any blur-algorithm bug or change
  produced stale blurred MP4s that didn't match the (still recoverable)
  original. Re-baking required a separate migration script.

Constraints when redesigning:

- The browser must never receive the master key — view derivation has
  to happen server-side.
- Existing recordings (28 rows at the time of the change) must keep
  playing without back-fill.
- Reveal flow (ADR 0002 + ADR 0009) stays untouched.

## Decision

**One encrypted source per recording. Derive the blurred view at
request time. Cache it.**

```
                            ┌──────────────────────────┐
                            │ recordings bucket        │
                            │   *_original.mp4.enc     │  ← single source of truth
                            └─────────────┬────────────┘
                                          │ AES-256-GCM decrypt
                                          │ (per-recording HKDF key)
                                          ▼
              ┌────────────────────────────────────────────────┐
              │ ML service: /recording/{id}/view               │
              │   • Haar face detect per frame                 │
              │   • Cubist Voronoi mosaic + 35% padding        │
              │   • ffmpeg H.264 re-encode                     │
              │   • Cache → /tmp/mongolz-views/<id>.mp4        │
              │   • Per-recording asyncio lock (single writer) │
              └────────────────────────────────────────────────┘
                                          │ video/mp4 stream
                                          ▼
              ┌─────────────────────────────────────────────┐
              │ Next.js /api/recordings/[id]/view           │
              │   • requireUserApi() + auditor block        │
              │   • RLS-enforced recording lookup           │
              │   • Bearer-token proxy to ML                │
              │   • Cache-Control: private, max-age=300     │
              └─────────────────────────────────────────────┘
```

### Backward compatibility

A new `recordings.blur_strategy` column with values
`'baked' | 'on_demand'` discriminates the old and new paths:

| `blur_strategy` | `storage_path`           | Playback URL                       |
| --------------- | ------------------------ | ---------------------------------- |
| `baked`         | `*_blurred.mp4` (plain)  | Supabase signed URL (existing)     |
| `on_demand`     | `*_original.mp4.enc`     | `/api/recordings/[id]/view` (new)  |

Existing rows default to `baked` via the column default; new
`RecordingSession` instances persist `on_demand`. The playback page
branches on this column, so legacy recordings continue to stream from
their stored blurred MP4 indefinitely.

### Rollback flag

The recording pipeline reads a `BLUR_STRATEGY` env var on Railway. If
the on-demand path develops an issue mid-launch, setting
`BLUR_STRATEGY=baked` reverts the pipeline to the legacy double-artifact
behaviour without a code deploy.

## Consequences

### Gains

- **No plaintext recording bytes persisted.** The only thing in the
  `recordings` bucket for new clips is AES-256-GCM ciphertext. A leaked
  storage key now yields opaque blobs, not playable video.
- **Lower recording-time CPU.** The blurred ffmpeg pipe and per-frame
  `_blur_with_mediapipe` call are skipped entirely (~10–30% of the
  recording loop on Railway CPU).
- **Single source of truth.** The blurred view is *derived*, not
  *stored*; the encrypted original is the only authoritative artifact.
  Algorithm changes propagate automatically on next cache miss.

### Costs

- **First view is slow.** Cold cache must decrypt + detect + blur +
  re-encode before bytes flow. For a 720p 1-minute clip on Railway
  CPU this is ~5–30 s. Subsequent hits in the same container lifetime
  are zero-cost.
- **Ephemeral cache.** The `/tmp` cache is gone after a Railway
  container restart. Worst case: every recording's first view after a
  redeploy pays the render cost again. Acceptable for capstone scale;
  productionising would move the cache to the `recordings` bucket as
  a derived-but-regenerable artifact.
- **Centralised render load.** All viewers' blur requests funnel
  through one ML instance. At capstone scale (≤10 concurrent viewers)
  this is fine; horizontal-scaling Railway would shard cache and add
  read-through behaviour.

### What it doesn't change

- ADR 0002 (per-recording HKDF AES-GCM) — the on-demand endpoint
  reuses the exact same `crypto_utils.decrypt_bytes` call.
- ADR 0009 (hierarchical per-face keys) — those gate which faces a
  given reveal authority can unseal; on-demand view always renders
  every face blurred regardless of authority.
- Reveal flow (`reveal_job.py`) — unchanged, decrypts the same
  `*.mp4.enc` and produces selectively-unblurred output.

## Implementation

| File                                              | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `supabase/migrations/20260528000000_*.sql`        | `blur_strategy` column + CHECK constraint          |
| `ml-service/view_renderer.py`                     | Haar + cubist render function                      |
| `ml-service/main.py`                              | `GET /recording/{id}/view` endpoint + cache lock   |
| `ml-service/recording_pipeline.py`                | Skip blurred writer/upload in on_demand mode       |
| `ml-service/storage.py`                           | Persist `blur_strategy` on insert                  |
| `app/api/recordings/[id]/view/route.ts`           | Next.js auth-gated proxy to ML                     |
| `app/(app)/playback/[id]/page.tsx`                | Branch on `blur_strategy`                          |
| `lib/database.types.ts`                           | `BlurStrategy` type + `Recording.blur_strategy`    |
| `ml-service/tests/test_view_renderer.py`          | 3 unit tests (smoke + 2 error paths)               |

Commit: `5050261` (feature). Follow-up: `84e7fe6` (entrypoint
SIGPIPE fix that unblocked the Railway deploy).
