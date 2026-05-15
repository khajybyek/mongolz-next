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

| Method | Path | Зориулалт |
|--------|------|-----------|
| GET    | `/`  | health |
| POST   | `/embed`  | image → 512-dim ArcFace embedding |
| POST   | `/detect` | image → faces[] |
| POST   | `/search` | image → DB suspect/face match |
| POST   | `/camera/start` | RTSP уншиж эхлэх |
| POST   | `/camera/stop`  | Камер зогсоох |
| POST   | `/reveal` | Бичлэг face reveal job |
| GET    | `/stream/<id>/index.m3u8` | HLS playlist |

## Deploy

### Railway (Recommended)
```bash
cd ml-service
railway init
railway up
```
`railway.json` Dockerfile-аар build хийнэ. Env var-уудаа Railway dashboard дотор тавь.

### Modal (alternative)
GPU хэрэгтэй бол `modal_app.py` нэмж `modal deploy` ашиглана.

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
