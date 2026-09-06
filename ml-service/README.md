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
| POST | `/camera/start` · `/camera/stop` | RTSP/HTTP camera recording session (HLS + encrypted original) |
| POST | `/camera/test` | reachability probe (8 s cap, dedicated thread pool) |
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
