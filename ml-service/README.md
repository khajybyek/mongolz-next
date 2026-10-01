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
