# MONGOLZ ML Service

InsightFace + FFmpeg-тулгуурласан Python FastAPI service.
Next.js front-end-ийн real-time CCTV/face recognition хэсгийг ажиллуулна.

## Local дев

```bash
cd ml-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # SUPABASE_URL/KEY-ээ оруул
uvicorn main:app --reload --port 8000
```

## Endpoint-ууд

Every route except `GET /` requires `Authorization: Bearer $ML_SERVICE_TOKEN`
(fail-secure: the service refuses to start without the token). `/docs`,
`/redoc`, `/openapi.json` are disabled unless `ALLOW_API_DOCS=1`.

| Method | Path | Зориулалт |
|--------|------|-----------|
| GET  | `/` | health (`engine_loaded`, active cameras) |
| POST | `/embed` | image → 512-dim ArcFace embedding |
| POST | `/detect` | image → faces[] (bbox + confidence + embedding) |
| POST | `/detect/quality` | faces[] + sharpness/brightness/size quality score |
| POST | `/search` | image → DB face matches (`match_faces` pgvector RPC) |
| POST | `/camera/start` · `/camera/stop` | RTSP/HTTP/`demo://` camera recording session (HLS + encrypted original). Start registers the camera in `camera_sessions` (URL sealed with the master key) so it auto-resumes after a redeploy; stop clears `auto_resume`. Optional `camera_name` |
| GET  | `/camera/active` | running cameras: `camera_id`, `camera_name`, `started_at`, `fps`, `restart_count`, `last_error`, `privacy_mode` (`standard` / `private` / null; never a URL) |
| POST | `/camera/test` | reachability probe (8 s cap, dedicated thread pool); `demo://<name>` answers `{ok, info:{640×360@15}}` without probing |
| GET  | `/stream/{camera_id}/index.m3u8` · `/{segment}` | live HLS |
| POST | `/process-upload` | browser recording; chunked (`session_id`, `chunk_index`, `is_final`) or single-shot |
| GET  | `/recording/{id}/view` | on-demand blurred view derived from the encrypted original (ADR 0010, disk-cached) |
| GET  | `/face/{id}/secure-crop?level=N` | decrypt a per-face sealed crop (ADR 0009 forward hash chain, `ML_ENCRYPTION_KEY_PREV` fallback) |
| POST | `/reveal/run` | run an approved reveal job (4-eyes; refuses non-queued jobs; one at a time, off the event loop) |
| POST | `/reveal/verify-blob` | backup verification — decrypt smoke test |
| POST | `/cluster` | DBSCAN cosine clustering of all face embeddings |
| POST | `/eval/detection` · `/eval/blur` · `/eval/recognition` · `/eval/compare` · `/eval/bench` · GET `/eval/system` | evaluation harness + benchmarks |
| POST | `/dp/add-noise` · `/dp/evaluate` · `/dp/sweep` | differential-privacy embedding experiments |
| POST | `/zk/demo` · `/zk/simulate` | zero-knowledge reveal proof-of-concept |
| POST | `/embedding/fuse` | multi-frame embedding fusion |
| POST | `/anti-spoof` | heuristic liveness (Laplacian + HSV + FFT) |

Masking is implemented once in `face_masker.py` (Haar every frame + InsightFace
every Nth frame + persistence cache + tier-aware cubist mosaic) and shared by the
baked recording path, the on-demand view and the reveal output.

### Privacy schedules (ADR 0012)

`privacy_schedule.py` evaluates each camera's `cameras.privacy_default` +
`masking_schedules` windows (Asia/Seoul, same rules as the SQL
`effective_privacy_mode()`). Schedules can only tighten protection: masking is
always on, and `private` switches OFF ArcFace embeddings, face rows/crops,
suspect matching, alerts and `/edge/detect` inference for frames captured then.
The pipeline evaluates the mode once per second of video. A live frame's
capture instant is a bound: the source clock is re-anchored to the wall clock
when the source opens and at every rotation (from the rotation frame's arrival
minus the measured backlog, read before the old segment is finalized), and the
tick is judged over
`[min(estimate, now) - PRIVACY_CLOCK_MARGIN_SEC (5 s), now]` — private if any
instant is (`PrivacyScheduleCache.mode_during`). It records
`recording_privacy_spans` (video offsets; every write an upsert on
`client_span_id`), and each segment's spans also go into its capture journal and
spool manifest, so the delivery writes them before the uploads and before the
row is ready. The
schedule is cached per camera for 30 s (refreshed in a worker thread, never
blocking capture); if it cannot be read for 10 min (or was never read) the
camera fails closed to `private` (`privacy_source: "fail_closed"` on
`/camera/active`). `/edge/detect` uses `edge_mode` (the range from 5 s before
`min(captured_at, receipt)` to receipt — a frame cannot be captured after it
arrived — and `cameras.privacy_loosened_at`). `GET /` reports
`privacy_schedules: 1` so the web can tell an enforcing build from an older one.

`privacy_protection.py` builds a recording's protected timeline: the union of
its spans (an open span = until the end) and the camera's current schedule over
`[recordings.started_at, + duration_sec)`, widened by
`PRIVACY_SCHEDULE_PAD_SEC` (60 s) on both sides — `started_at` is the
pipeline's estimate of offset 0's capture time. The reveal job (`reveal_job.py`)
fails closed if either read fails; if the protected stretches cover the whole
recording (or the whole requested time range) it is refused before anything is
decrypted, with a coded message that says whether the spans or only the current
schedule cover it. Protected frames are never matched and every face on them
stays masked; the number of withheld seconds is logged. The on-demand view and
the evidence clip / frame (`view_renderer.py`) mask protected frames with
detector-only boxes and the VIP mask; an unreadable timeline masks the whole
recording that way (the view is still served). `FaceMasker` never computes an
embedding for a protected frame (no `detect_all` fallback).

### Recording mode `face_encrypted` (ADR 0013)

`cameras.recording_mode` (`standard` default | `face_encrypted`) is read per
segment through `recording_mode.RecordingModeCache` (a sibling of the privacy
schedule cache, its own query: 30 s TTL, unreadable → last known, never read →
face_encrypted (fail closed), missing column → standard); a change rotates the
running segment, and so does an envelope reaching `FACE_ENVELOPE_MAX_BYTES`
(40 MiB). In `face_encrypted` mode NO raw original is stored:

* `*_masked.mp4.enc` — the stored video: every face box (the masker's boxes and
  persistence) painted with the keyed cipher visual (`cipher_mask.py`: flat
  8–12 px AES-CTR cells per (recording, track) + a 1 px outline), encrypted at
  rest with the per-recording key. Live HLS keeps the cubist mask.
* `*_faces.mfe.enc` — the face envelope (`face_envelope.py`, format "MFE1"):
  every face box of every frame captured in `standard` privacy mode, JPEG
  q90 ≤ 192 px, sealed with AES-256-GCM under its track's hash-chain key
  `K_chain_index` (ADR 0009), AAD = recording + frame + track + chain index +
  geometry; a sealed index (its own key of the per-recording family) holds each
  track's identity samples (ArcFace embeddings sealed under the track's
  `K_chain_index`), `face_id` link and detection runs (frames with a fresh
  detection, noted in every privacy mode), plus fps/size, which the reader checks
  against the plaintext header. `face_tracker.py` follows FRESH detections
  (IoU or a velocity prediction, gap ≤ 5 frames); a stale masker box stays with
  the track that detected it and is sealed only as its last position (≤ 5
  frames), other stale boxes become pixel-free painted records; one sealed box
  per track and frame. A track takes its chain index from the counter faces
  rows use; the ArcFace tick (RetinaFace forced on that frame) samples every
  track with a fresh box there and links it to a persisted or strongly matched
  face_id (≥ 0.45). Blobs of the frames before a private tick, of private
  frames and of a segment tail the closing check judges private are never
  written. Pixels of other tracks' boxes are zeroed in each blob. Behind real
  time (live sources) the stored video repeats the last masked frame and the
  previous crops are re-sealed for it (`GET /camera/active` → `live_lag_sec`,
  `held_frames`).
* Row: `blur_strategy='face_encrypted'`, `storage_path` = masked video,
  `face_envelope_path` = envelope, `original_path` NULL, `has_original` true
  once delivered (= a restorable encrypted source exists). `/recording/{id}/view`
  decrypts and serves the masked video (no render). `GET /` reports
  `face_encrypted: 1`.
* Reveal (`reveal_job.py`, same 4-eyes / lease / privacy guards): the target
  embeddings (photo, suspect or detected faces; sealed ones unsealed from
  `K_level` above level 0) are compared with the identity samples of every
  track with `chain_index ≥ reveal_level` (`EnvelopeReader.open_samples`) — no
  detector or embedding runs on the video and no `faces` row is needed. A track
  with a sample ≥ the job threshold is selected; its blob at frame f is
  restored only when its samples nearest before and after f both match
  (before the first / after the last sample: only inside that sample's
  detection run, the unbroken stretch of fresh detections the envelope's
  sealed index records per track — a missed detection is where the geometric
  tracker can switch people). Of
  those, only the blobs outside `never_reveal` zones, protected (private)
  stretches and the requested window are unsealed
  (`EnvelopeReader.iter_blobs(accept=…)` never reads the others); they are
  composited onto the decrypted masked video, where everyone else stays cipher.
  Failures: `[face_envelope_empty]` (nothing left to unseal),
  `[face_envelope_invalid]` (the stored object fails its at-rest layer — any
  damaged byte — or the header disagrees with the index, a blob/sample fails
  authentication, or it does not fit the video), `[face_envelope_unavailable]`
  (row not delivered or a download failed). The output is a plaintext MP4 in
  the `revealed` bucket, as for standard reveals.
* Measured envelope size (bundled samples, 15 fps, the padded crop the
  pipeline seals — about 1.6 × the detector box + 12 px, capped at 192 px):
  64 px box ≈ 44–91 KiB, 96 px ≈ 72–152 KiB, 128 px ≈ 84–169 KiB, larger ≈
  90–182 KiB per face-second (flat to busy background; ADR 0013, Costs). A
  detector box above ~113 px is stored downscaled (the face ≈ 120 px). Plus
  ≈ 2.7 KiB per sampled track per second (identity samples) and 21 B per
  painted rectangle. Tunables: `FACE_ENVELOPE_JPEG_QUALITY` (90),
  `FACE_ENVELOPE_MAX_SIDE` (192), `FACE_ENVELOPE_MARGIN_PX` (6),
  `FACE_ENVELOPE_MAX_BYTES` (40 MiB).

### Demo camera sources

`demo://lobby`, `demo://gate`, `demo://parking` (allow-list in `demo_source.py`)
are synthetic looping feeds built lazily with ffmpeg from `samples/0{0,1,2}.jpg`
(640×360, 15 fps, ~24 s Ken-Burns pan/zoom so faces move and get detected).
They behave like live cameras: HLS on, loop on EOF, frames paced to real time.
Clips are cached under `DEMO_DIR` (default `/tmp/mongolz-demo`). `samples/`
must ship in the image (it is no longer excluded by `.dockerignore`).

### Auto-resume + supervisor

`camera_sessions` (camera_id, sealed_url, camera_name, fps, auto_resume,
last_error) records every started camera; on boot `CameraManager.resume_persisted()`
unseals and restarts rows with `auto_resume=true`. A supervisor task (every 30 s)
restarts sessions that ended without `/camera/stop` (crash, unreachable source,
RTSP dropped) with per-camera backoff `5s·2^n` capped at 300 s (counter resets
after 10 min healthy) and writes the reason to `last_error`.

### Extra environment variables

| Var | Purpose |
|-----|---------|
| `DEMO_DIR` | cache directory for generated `demo://` clips (default `/tmp/mongolz-demo`) |
| `PRIVACY_SPAN_RETRY_SEC` | spacing of retries for privacy-span writes that failed (default 5 s) |
| `SENTRY_DSN` | optional; when set `sentry-sdk` is initialised (`environment` = `RAILWAY_ENVIRONMENT_NAME` or `production`, no tracing, no PII). Unset → disabled, logged once |

## Deploy

### Railway (Recommended)
```bash
cd ml-service
railway init
railway up
```
`railway.json` Dockerfile-аар build хийнэ. Env var-уудаа Railway dashboard дотор тавь.

### Render / Fly.io
Dockerfile-тай тул шууд деplay хийгдэнэ.

## Архитектур

```
Next.js  ─── HTTP ──→  FastAPI  ─── pgvector ──→ Supabase
                          │
                          ├── InsightFace (CPU)
                          ├── OpenCV / RTSP
                          └── FFmpeg (HLS)
```
