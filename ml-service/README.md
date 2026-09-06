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
| GET  | `/camera/active` | running cameras: `camera_id`, `camera_name`, `started_at`, `fps`, `restart_count`, `last_error` (never a URL) |
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
