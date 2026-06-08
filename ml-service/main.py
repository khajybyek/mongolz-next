"""
MONGOLZ ML Service — FastAPI
================================================================
InsightFace (RetinaFace + ArcFace) ажиллуулж дараах endpoint-уудыг өгнө:

  POST /embed          — image → 512-dim embedding (suspects.actions-аас дуудна)
  POST /detect         — image → faces[] (bbox + embedding)
  POST /search         — image → DB suspects/faces match (Supabase pgvector)
  POST /camera/start   — RTSP уншиж эхлэх (background worker)
  POST /camera/stop    — Камер зогсоох
  POST /reveal         — Бичлэгээс face reveal job
  GET  /stream/<id>/index.m3u8 — HLS playlist (live эсвэл бичлэг)

Deploy:
  - Railway: railway.json + Dockerfile
  - Modal: modal_app.py (тусдаа entrypoint)
  - Local: `uvicorn main:app --reload --port 8000`
"""

from __future__ import annotations

import asyncio
import hmac
import io
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

# Local-д ажиллахад .env файлыг автоматаар уншуулна
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from face_engine import FaceEngine
from camera_worker import CameraManager
from storage import SupabaseStorage
from crypto_utils import init_master_key, self_test as crypto_self_test, decrypt_bytes
from dp_embeddings import DPConfig, add_dp_noise, estimate_matching_accuracy, sweep_epsilon
from zk_reveal import full_protocol_demo as zk_demo
from anti_spoof import detect_spoof
from embedding_fusion import FrameEmbedding, fuse_weighted_mean, fuse_median, cosine_similarity
from telemetry import init_telemetry
from view_renderer import render_blurred_view

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("mongolz-ml")

ML_TOKEN = os.getenv("ML_SERVICE_TOKEN", "")
HLS_DIR = os.getenv("HLS_DIR", "/tmp/mongolz-hls")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ML_CORS_ORIGINS",
        "http://localhost:3000,https://mongolz.vercel.app",
    ).split(",")
    if origin.strip()
]
os.makedirs(HLS_DIR, exist_ok=True)

# Production-д ML_SERVICE_TOKEN заавал тохируулсан байх ёстой.
# Railway/Modal-д TOKEN-ыг алдаатай тохируулсан тохиолдолд server start-ад
# алдаатай явахгүйгээр шинээр сэрээлгэх вэ гэдгийг сэргийлнэ.
# Local dev-д ALLOW_NO_AUTH=1 тохируулж байж энэ шалгуурыг алгасна.
if not ML_TOKEN and os.getenv("ALLOW_NO_AUTH") != "1":
    raise RuntimeError(
        "ML_SERVICE_TOKEN тохируулагдаагүй! Production-д заавал шаардлагатай.\n"
        "Local dev-д хэрэгтэй бол ALLOW_NO_AUTH=1 тохируулна уу."
    )

face_engine: FaceEngine | None = None
camera_manager: CameraManager | None = None
storage: SupabaseStorage | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global face_engine, camera_manager, storage
    log.info("Initializing FaceEngine...")
    init_master_key()
    crypto_self_test()
    face_engine = FaceEngine()
    storage = SupabaseStorage()
    camera_manager = CameraManager(face_engine=face_engine, storage=storage, hls_dir=HLS_DIR)
    log.info("MONGOLZ ML service ready")
    yield
    log.info("Shutting down...")
    await camera_manager.stop_all()


# Production-д OpenAPI schema + Swagger UI disable хийнэ — attacker-д endpoint enumeration хийх боломж олгохгүй.
# Local dev-д ALLOW_API_DOCS=1 тохируулсан тохиолдолд л идэвхтэй.
_DOCS_ENABLED = os.getenv("ALLOW_API_DOCS") == "1"
app = FastAPI(
    title="MONGOLZ ML Service",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _DOCS_ENABLED else None,
    redoc_url="/redoc" if _DOCS_ENABLED else None,
    openapi_url="/openapi.json" if _DOCS_ENABLED else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_telemetry(app)


# ── Auth ────────────────────────────────────────────────────────
async def require_token(authorization: str | None = Header(default=None)):
    # ALLOW_NO_AUTH=1 (зөвхөн local dev-д) auth-ыг алгасна.
    # Production-д ML_TOKEN заавал тохируулсан байна — startup-аас өмнө
    # шалгагдсан тул энд "fail open" гарахгүй.
    if not ML_TOKEN and os.getenv("ALLOW_NO_AUTH") == "1":
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    # Constant-time compare so token-length / prefix oracle attacks can't
    # measure how many bytes matched.
    if not hmac.compare_digest(authorization.removeprefix("Bearer "), ML_TOKEN):
        raise HTTPException(403, "Invalid token")


# ── Health ──────────────────────────────────────────────────────
@app.get("/")
def health():
    return {
        "ok": True,
        "service": "mongolz-ml",
        "engine": face_engine.info() if face_engine else None,
        "active_cameras": camera_manager.active_count() if camera_manager else 0,
    }


# ── Embedding ──────────────────────────────────────────────────
@app.post("/embed", dependencies=[Depends(require_token)])
async def embed_endpoint(file: UploadFile = File(...)):
    if not face_engine:
        raise HTTPException(503, "engine not ready")

    image_bytes = await file.read()
    embedding = face_engine.embed_single(image_bytes)
    if embedding is None:
        raise HTTPException(422, "no face found")

    return {"embedding": embedding.tolist()}


# ── Detect ──────────────────────────────────────────────────────
@app.post("/detect", dependencies=[Depends(require_token)])
async def detect_endpoint(file: UploadFile = File(...)):
    if not face_engine:
        raise HTTPException(503, "engine not ready")

    image_bytes = await file.read()
    faces = face_engine.detect_all(image_bytes)
    return {
        "faces": [
            {
                "bbox": list(map(float, f.bbox)),
                "confidence": float(f.confidence),
                "embedding": f.embedding.tolist(),
            }
            for f in faces
        ]
    }


# ── Detect with quality ────────────────────────────────────────
@app.post("/detect/quality", dependencies=[Depends(require_token)])
async def detect_quality_endpoint(file: UploadFile = File(...)):
    if not face_engine:
        raise HTTPException(503, "engine not ready")
    image_bytes = await file.read()
    faces = face_engine.detect_with_quality(image_bytes)
    return {
        "faces": [
            {
                "bbox": list(map(float, f.bbox)),
                "confidence": float(f.confidence),
                "embedding": f.embedding.tolist(),
                "quality": {
                    "sharpness": f.quality.sharpness,
                    "brightness": f.quality.brightness,
                    "size_score": f.quality.size_score,
                    "overall": f.quality.overall,
                } if f.quality else None,
            }
            for f in faces
        ]
    }


# ── Search (DB-тэй харьцуулах) ─────────────────────────────────
class SearchResp(BaseModel):
    matches: list[dict[str, Any]]


@app.post("/search", response_model=SearchResp, dependencies=[Depends(require_token)])
async def search_endpoint(file: UploadFile = File(...), threshold: float = 0.5, limit: int = 20):
    if not face_engine or not storage:
        raise HTTPException(503, "service not ready")

    image_bytes = await file.read()
    embedding = face_engine.embed_single(image_bytes)
    if embedding is None:
        raise HTTPException(422, "no face found")

    matches = await storage.match_faces(embedding.tolist(), threshold=threshold, limit=limit)
    return {"matches": matches}


# ── Camera control ─────────────────────────────────────────────
class CameraStartReq(BaseModel):
    camera_id: str
    url: str
    fps: int = Field(default=15, ge=5, le=30)


@app.post("/camera/start", dependencies=[Depends(require_token)])
async def camera_start(req: CameraStartReq):
    if not camera_manager:
        raise HTTPException(503, "manager not ready")

    await camera_manager.start(req.camera_id, req.url, fps=req.fps)
    return {"ok": True, "camera_id": req.camera_id}


class CameraStopReq(BaseModel):
    camera_id: str


@app.post("/camera/stop", dependencies=[Depends(require_token)])
async def camera_stop(req: CameraStopReq):
    if not camera_manager:
        raise HTTPException(503, "manager not ready")
    await camera_manager.stop(req.camera_id)
    return {"ok": True}


# ── HLS Stream ──────────────────────────────────────────────────
_HLS_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _safe_hls_path(camera_id: str, segment: str) -> str:
    """Resolve a path inside HLS_DIR with traversal defence-in-depth.

    The endpoint is already gated by `require_token`, but we still treat
    `camera_id` / `segment` as untrusted: reject anything with a path
    separator, anchor or relative segment, then verify the resolved
    absolute path is rooted inside HLS_DIR. Refusing is preferable to
    accidentally serving `/etc/passwd` if a future caller bypasses the
    Next.js proxy.
    """
    if not _HLS_NAME_RE.match(camera_id) or not _HLS_NAME_RE.match(segment):
        raise HTTPException(400, "invalid path component")
    root = os.path.realpath(HLS_DIR)
    candidate = os.path.realpath(os.path.join(root, camera_id, segment))
    if not candidate.startswith(root + os.sep) and candidate != root:
        raise HTTPException(400, "path escapes HLS_DIR")
    return candidate


@app.get("/stream/{camera_id}/index.m3u8", dependencies=[Depends(require_token)])
async def stream_playlist(camera_id: str):
    path = _safe_hls_path(camera_id, "index.m3u8")
    if not os.path.exists(path):
        raise HTTPException(404, "stream not active")
    return FileResponse(path, media_type="application/vnd.apple.mpegurl")


@app.get("/stream/{camera_id}/{segment}", dependencies=[Depends(require_token)])
async def stream_segment(camera_id: str, segment: str):
    if not segment.endswith(".ts"):
        raise HTTPException(400, "invalid segment")
    path = _safe_hls_path(camera_id, segment)
    if not os.path.exists(path):
        raise HTTPException(404, "segment not found")
    return FileResponse(path, media_type="video/MP2T")


# ── Reveal job ──────────────────────────────────────────────────
class RevealRunReq(BaseModel):
    job_id: str  # DB-д аль хэдийн үүссэн reveal_jobs row-ийн id


@app.post("/reveal/run", dependencies=[Depends(require_token)])
async def reveal_run_endpoint(req: RevealRunReq):
    """Next.js DB-д job үүсгэсний дараа дуудна — background-д ажиллана."""
    if not camera_manager:
        raise HTTPException(503, "service not ready")

    asyncio.create_task(camera_manager.reveal_job(req.job_id))
    return {"ok": True, "job_id": req.job_id}


# ── On-demand view derivation (#3: one encrypted source) ───────
#
# For recordings stored with `blur_strategy='on_demand'`, no plaintext
# "blurred MP4" is persisted — only the AES-encrypted original. The playback
# view shown to unauthorised viewers is derived at view-time: decrypt the
# original, run Haar face detection per frame, paint cubist polygon mosaic
# over every face, encode a fresh MP4. The result is cached in /tmp; second
# and subsequent requests are zero-cost.
#
# The encrypted original is the single source of truth — reveal flow stays
# unchanged (decrypt + selective-unblur via reveal_job.py).
_VIEW_CACHE_DIR = "/tmp/mongolz-views"
os.makedirs(_VIEW_CACHE_DIR, exist_ok=True)
_view_locks: dict[str, asyncio.Lock] = {}
_MAX_VIEW_LOCKS = 512  # bound the dict so a viewer can't grow it without limit
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Global cold-render concurrency cap. Each miss spawns ffmpeg + per-frame
# OpenCV decode/blur — multi-second CPU on the single Railway box. Without a
# ceiling, a viewer fanning out across many distinct recording IDs (each a
# fresh per-recording lock, so they DON'T serialise) could saturate CPU and
# starve live recording. This semaphore bounds total concurrent renders;
# excess requests queue and are served from cache once a sibling finishes.
_MAX_CONCURRENT_RENDERS = 2
_render_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_RENDERS)


def _get_view_lock(recording_id: str) -> asyncio.Lock:
    """Per-recording asyncio lock so concurrent cold-cache requests for the
    same recording don't trigger redundant render work.

    The dict is bounded at `_MAX_VIEW_LOCKS`: when it grows past the cap we
    evict entries that are not currently held. Eviction is race-free because
    `_get_view_lock` runs synchronously (no await) before the caller's
    `async with`, so a freshly-returned lock can't be evicted mid-use; and
    even if an evicted id is re-requested, the cache-recheck + atomic
    `os.replace` keep a duplicate render harmless (just wasteful)."""
    lock = _view_locks.get(recording_id)
    if lock is None:
        if len(_view_locks) >= _MAX_VIEW_LOCKS:
            for k in [k for k, lk in _view_locks.items() if not lk.locked()]:
                del _view_locks[k]
                if len(_view_locks) < _MAX_VIEW_LOCKS:
                    break
        lock = asyncio.Lock()
        _view_locks[recording_id] = lock
    return lock


@app.get(
    "/recording/{recording_id}/view",
    dependencies=[Depends(require_token)],
)
async def render_view_endpoint(recording_id: str):
    """Derive the blurred playback view from the encrypted original MP4.

    Result is cached at `/tmp/mongolz-views/{recording_id}.mp4`. Returns
    `video/mp4`. On cache hit serves immediately; on cache miss generates
    in-process (5–30s for typical clips) under a per-recording lock.
    """
    # UUID validation — also blocks `..` / path traversal via the cache key.
    if not _UUID_RE.match(recording_id):
        raise HTTPException(400, "invalid recording_id")
    if not storage or not storage.client:
        raise HTTPException(503, "service not ready")

    cache_path = os.path.join(_VIEW_CACHE_DIR, f"{recording_id}.mp4")

    # Fast path — cache hit
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        return FileResponse(cache_path, media_type="video/mp4")

    # Cold path — derive under per-recording lock so a thundering herd of
    # concurrent requests only does the work once.
    async with _get_view_lock(recording_id):
        # Re-check after lock acquisition (sibling coroutine may have won)
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
            return FileResponse(cache_path, media_type="video/mp4")

        # 1) Look up recording row → original_path
        # Error detail is logged server-side only; the client gets a generic
        # message so internal paths / stack detail never leak to a viewer.
        try:
            res = (
                storage.client.table("recordings")
                .select("original_path, has_original")
                .eq("id", recording_id)
                .single()
                .execute()
            )
        except Exception as e:
            log.warning("view: recording lookup failed (%s): %s", recording_id[:8], e)
            raise HTTPException(500, "recording lookup failed")
        if not res or not res.data:
            raise HTTPException(404, "recording not found")
        if not res.data.get("has_original"):
            raise HTTPException(404, "no original available — cannot derive view")
        original_path = res.data.get("original_path")
        if not original_path:
            raise HTTPException(404, "original_path empty")

        # 2) Download encrypted original + decrypt
        try:
            blob = storage.client.storage.from_("recordings").download(original_path)
            if isinstance(original_path, str) and original_path.endswith(".enc"):
                blob = decrypt_bytes(blob, recording_id=recording_id)
        except Exception as e:
            log.warning("view: download/decrypt failed (%s): %s", recording_id[:8], e)
            raise HTTPException(500, "could not prepare recording")

        # 3) Render via Haar + cubist (CPU-bound → off-loop thread).
        # Write to a `.part` sibling first then atomic-rename so partial
        # cache files never serve to clients. The global semaphore caps how
        # many renders run at once so a fan-out of distinct IDs can't
        # exhaust the box.
        import tempfile
        tmp_out = cache_path + ".part"
        with tempfile.TemporaryDirectory() as tmp:
            input_mp4 = os.path.join(tmp, "in.mp4")
            with open(input_mp4, "wb") as f:
                f.write(blob)
            try:
                async with _render_semaphore:
                    await asyncio.to_thread(render_blurred_view, input_mp4, tmp_out)
            except Exception as e:
                log.warning("view: render failed (%s): %s", recording_id[:8], e)
                try:
                    os.unlink(tmp_out)
                except OSError:
                    pass
                raise HTTPException(500, "render failed")

        if not os.path.exists(tmp_out) or os.path.getsize(tmp_out) < 1000:
            try:
                os.unlink(tmp_out)
            except OSError:
                pass
            raise HTTPException(500, "render produced empty output")
        os.replace(tmp_out, cache_path)

        log.info(
            "view derived: recording=%s size=%dKB",
            recording_id[:8], os.path.getsize(cache_path) // 1024,
        )
        return FileResponse(cache_path, media_type="video/mp4")


# ── Upload-аас бичлэг боловсруулах ─────────────────────────────
# Browser MediaRecorder (Тухайн төхөөрөмж) эсвэл Гар утас mode-аас ирсэн
# webm/mp4 blob-ыг IP CCTV pipeline-тай яг адил бүрэн боловсруулна:
#   • Blurred MP4 (face blur with persistence + padding)
#   • Original MP4 (AES-256-GCM encrypted)
#   • Faces with bbox + recording_id (ArcFace dedup 0.45)
@app.post("/process-upload", dependencies=[Depends(require_token)])
async def process_upload_endpoint(
    file: UploadFile = File(...),
    camera_name: str = "Browser camera",
):
    if not face_engine or not storage:
        raise HTTPException(503, "service not ready")

    # File-ийг түр хадгална (tmpfile)
    import tempfile
    suffix = ".webm" if (file.content_type or "").endswith("webm") else ".mp4"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="mongolz_upload_")
    with os.fdopen(fd, "wb") as f:
        f.write(await file.read())

    size_mb = os.path.getsize(tmp_path) / 1024 / 1024
    log.info("Process upload: %s (%.1fMB) → background pipeline", os.path.basename(tmp_path), size_mb)

    from recording_pipeline import RecordingSession
    from uuid import uuid4

    virtual_camera_id = f"upload_{uuid4().hex[:8]}"
    session = RecordingSession(
        camera_id=virtual_camera_id,
        camera_name=camera_name,
        source_url=tmp_path,
        engine=face_engine,
        storage=storage,
        hls_dir=HLS_DIR,
        recordings_dir="/tmp/mongolz-rec",
        fps=15,
        db_camera_id=None,  # browser upload — no real camera FK
    )

    async def _process_in_background():
        try:
            await session.start()
            if session.task:
                try:
                    await asyncio.wait_for(session.task, timeout=300)
                except asyncio.TimeoutError:
                    log.warning("Process upload timeout — finalize-руу шилжилт")
                    session.stop_flag.set()
            await session.stop()
            log.info("✓ Background process complete: recording_id=%s", session.recording_id)
        except Exception as e:
            log.exception("Background process failed: %s", e)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # Fire-and-forget — Vercel timeout-аас зайлсхийнэ
    asyncio.create_task(_process_in_background())

    return {
        "ok": True,
        "recording_id": session.recording_id,
        "camera_id": virtual_camera_id,
        "size_mb": round(size_mb, 2),
        "status": "processing",
    }


# ── Eval endpoint ──────────────────────────────────────────────
@app.post("/eval/detection", dependencies=[Depends(require_token)])
async def eval_detection_endpoint(
    file: UploadFile = File(...),
    gt_boxes: str = Form("[]"),
):
    """
    Detection accuracy eval: upload image + ground-truth boxes (JSON),
    returns Precision/Recall/F1/FPR.
    """
    import json
    from eval_metrics import evaluate_detection

    if not face_engine:
        raise HTTPException(503, "engine not ready")

    image_bytes = await file.read()
    faces = face_engine.detect_all(image_bytes)
    pred_boxes = [(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]) for f in faces]

    try:
        gt = [tuple(b) for b in json.loads(gt_boxes)]
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "gt_boxes must be JSON array of [x1,y1,x2,y2]")

    metrics = evaluate_detection(pred_boxes, gt)
    return {
        "predicted_count": len(pred_boxes),
        "gt_count": len(gt),
        "metrics": metrics.to_dict(),
    }


@app.post("/eval/blur", dependencies=[Depends(require_token)])
async def eval_blur_endpoint(
    original: UploadFile = File(...),
    blurred: UploadFile = File(...),
    face_boxes: str = Form("[]"),
):
    """
    Blur quality eval: compare original vs blurred image at face regions.
    Returns SSIM per face and blur effectiveness.
    """
    import json
    from eval_metrics import compute_blur_quality

    orig_bytes = await original.read()
    blur_bytes = await blurred.read()

    orig_img = cv2.imdecode(np.frombuffer(orig_bytes, np.uint8), cv2.IMREAD_COLOR)
    blur_img = cv2.imdecode(np.frombuffer(blur_bytes, np.uint8), cv2.IMREAD_COLOR)

    if orig_img is None or blur_img is None:
        raise HTTPException(400, "cannot decode images")

    try:
        boxes = [tuple(b) for b in json.loads(face_boxes)]
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "face_boxes must be JSON array")

    if not boxes and face_engine:
        faces = face_engine.detect_all(orig_bytes)
        boxes = [(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]) for f in faces]

    result = compute_blur_quality(orig_img, blur_img, boxes)
    return result


@app.post("/eval/recognition", dependencies=[Depends(require_token)])
async def eval_recognition_endpoint(
    similarities: str = Form(...),
    labels: str = Form(...),
    threshold: float = Form(0.45),
):
    """
    Recognition metrics: pass arrays of similarities and boolean labels.
    Returns Precision/Recall/F1/FPR/AUC + ROC points.
    """
    import json
    from eval_metrics import compute_recognition_metrics

    try:
        sims = json.loads(similarities)
        lbls = json.loads(labels)
    except json.JSONDecodeError:
        raise HTTPException(400, "similarities and labels must be JSON arrays")

    if len(sims) != len(lbls):
        raise HTTPException(400, "similarities and labels must have same length")

    result = compute_recognition_metrics(sims, [bool(l) for l in lbls], threshold)
    return result


# ── Face clustering (DBSCAN) ───────────────────────────────────
@app.post("/cluster", dependencies=[Depends(require_token)])
async def cluster_endpoint(eps: float = 0.5, min_samples: int = 2, limit: int = 500):
    """Fetch face embeddings from DB, cluster with DBSCAN, store results."""
    if not storage:
        raise HTTPException(503, "storage not ready")

    from sklearn.cluster import DBSCAN

    resp = storage.client.from_("faces").select("id, embedding").limit(limit).execute()
    rows = resp.data or []
    if not rows:
        return {"clusters": [], "noise": 0, "total": 0}

    ids = [r["id"] for r in rows]
    embeddings = np.array([r["embedding"] for r in rows], dtype=np.float32)

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalized = embeddings / norms
    dist_matrix = 1 - normalized @ normalized.T

    db = DBSCAN(eps=eps, min_samples=min_samples, metric="precomputed")
    labels = db.fit_predict(dist_matrix)

    clusters: dict[int, list[str]] = {}
    noise_count = 0
    for face_id, label in zip(ids, labels):
        if label == -1:
            noise_count += 1
        else:
            clusters.setdefault(int(label), []).append(face_id)

    for cluster_id, face_ids_list in clusters.items():
        for fid in face_ids_list:
            storage.client.from_("faces").update({"cluster_id": cluster_id}).eq("id", fid).execute()

    return {
        "total": len(ids),
        "cluster_count": len(clusters),
        "noise": noise_count,
        "clusters": [
            {"id": k, "size": len(v), "face_ids": v[:10]}
            for k, v in sorted(clusters.items())
        ],
    }


@app.post("/eval/compare", dependencies=[Depends(require_token)])
async def eval_compare_endpoint(file: UploadFile = File(...)):
    """Compare blur algorithms: cubist mosaic vs gaussian vs pixelate."""
    import base64
    import time
    from eval_metrics import compute_ssim_region

    if not face_engine:
        raise HTTPException(503, "engine not ready")

    image_bytes = await file.read()
    orig = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if orig is None:
        raise HTTPException(400, "cannot decode image")

    faces = face_engine.detect_all(image_bytes)
    bboxes = [(int(f.bbox[0]), int(f.bbox[1]), int(f.bbox[2]), int(f.bbox[3])) for f in faces]

    results = []
    for algo in ["cubist", "gaussian", "pixelate"]:
        blurred = orig.copy()
        t0 = time.time()

        for (x1, y1, x2, y2) in bboxes:
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(orig.shape[1], x2), min(orig.shape[0], y2)
            roi = blurred[y1:y2, x1:x2]
            if roi.size == 0:
                continue

            if algo == "gaussian":
                ksize = max(51, ((x2 - x1) // 2) | 1)
                blurred[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (ksize, ksize), 30)
            elif algo == "pixelate":
                pw = max(1, (x2 - x1) // 8)
                ph = max(1, (y2 - y1) // 8)
                small = cv2.resize(roi, (pw, ph), interpolation=cv2.INTER_LINEAR)
                blurred[y1:y2, x1:x2] = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
            else:
                from recording_pipeline import _cubist_anonymize
                blurred[y1:y2, x1:x2] = _cubist_anonymize(roi, seed=42)

        elapsed_ms = int((time.time() - t0) * 1000)
        ssim_scores = [compute_ssim_region(orig, blurred, b) for b in bboxes]
        ssim_mean = float(np.mean(ssim_scores)) if ssim_scores else 0.0

        ok, enc = cv2.imencode(".jpg", blurred, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_b64 = base64.b64encode(enc.tobytes()).decode() if ok else ""

        results.append({
            "algorithm": algo,
            "processing_ms": elapsed_ms,
            "faces_found": len(bboxes),
            "ssim": round(ssim_mean, 4),
            "image_b64": img_b64,
        })

    return {"results": results}


@app.get("/eval/system", dependencies=[Depends(require_token)])
async def eval_system_endpoint():
    """
    System-wide eval: run a quick self-test and return current model info + thresholds.
    """
    return {
        "engine": face_engine.info() if face_engine else None,
        "thresholds": {
            "insightface_min_confidence": 0.55,
            "haar_min_neighbors": 8,
            "blur_persist_frames": 15,
            "alert_threshold": 0.45,
            "dedup_threshold": 0.35,
        },
        "active_cameras": camera_manager.active_count() if camera_manager else 0,
    }


@app.post("/eval/bench", dependencies=[Depends(require_token)])
async def eval_bench_endpoint(iterations: int = 10):
    """
    Run a microbenchmark on detect + embed using a synthetic image.
    Returns per-step latency stats (mean/p50/p95/p99) and effective FPS.
    """
    import time
    iterations = max(1, min(iterations, 100))
    if not face_engine:
        raise HTTPException(503, "engine not ready")

    # Encode synthetic image to JPEG so engine API (image_bytes) is satisfied.
    rng = np.random.default_rng(42)
    img = rng.integers(0, 256, size=(480, 640, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", img)
    if not ok:
        raise HTTPException(500, "failed to encode synthetic image")
    img_bytes = encoded.tobytes()

    detect_times: list[float] = []
    embed_times: list[float] = []
    total_times: list[float] = []

    # Warmup
    try:
        face_engine.detect_all(img_bytes)
    except Exception:
        pass

    for _ in range(iterations):
        t0 = time.perf_counter()
        faces = face_engine.detect_all(img_bytes)
        t1 = time.perf_counter()
        detect_times.append((t1 - t0) * 1000)

        # Embed the synthetic image as a whole to measure embedding latency.
        t2 = time.perf_counter()
        face_engine.embed_single(img_bytes)
        t3 = time.perf_counter()
        embed_times.append((t3 - t2) * 1000)

        # detect_count is informational; suppress lint about unused variable.
        del faces

        total_times.append((time.perf_counter() - t0) * 1000)

    def stats(arr: list[float]) -> dict:
        if not arr:
            return {"n": 0}
        s = sorted(arr)
        n = len(s)
        return {
            "n": n,
            "mean_ms": round(sum(s) / n, 2),
            "p50_ms": round(s[n // 2], 2),
            "p95_ms": round(s[min(n - 1, int(n * 0.95))], 2),
            "p99_ms": round(s[min(n - 1, int(n * 0.99))], 2),
            "min_ms": round(s[0], 2),
            "max_ms": round(s[-1], 2),
        }

    return {
        "iterations": iterations,
        "input_resolution": "640x480",
        "detection": stats(detect_times),
        "embedding": stats(embed_times),
        "end_to_end": stats(total_times),
        "effective_fps": round(1000.0 / max(sum(total_times) / len(total_times), 1e-6), 2),
        "engine": face_engine.info(),
    }



# ── Differential Privacy ──────────────────────────────────────
class DPRequest(BaseModel):
    embedding: list[float] = Field(..., min_length=512, max_length=512)
    epsilon: float = Field(5.0, gt=0)
    delta: float = Field(1e-5, gt=0, lt=1)


@app.post("/dp/add-noise", dependencies=[Depends(require_token)])
async def dp_add_noise(req: DPRequest):
    config = DPConfig(epsilon=req.epsilon, delta=req.delta)
    emb = np.array(req.embedding, dtype=np.float64)
    noisy = add_dp_noise(emb, config)
    return {
        "embedding": noisy.tolist(),
        "privacy": config.privacy_loss_str(),
        "sigma": round(config.sigma, 4),
    }


class DPEvalRequest(BaseModel):
    epsilon: float = Field(5.0, gt=0)
    delta: float = Field(1e-5, gt=0, lt=1)
    n_trials: int = Field(500, ge=100, le=5000)
    threshold: float = Field(0.45, ge=0, le=1)


@app.post("/dp/evaluate", dependencies=[Depends(require_token)])
async def dp_evaluate(req: DPEvalRequest):
    config = DPConfig(epsilon=req.epsilon, delta=req.delta)
    return estimate_matching_accuracy(config, req.n_trials, req.threshold)


@app.post("/dp/sweep", dependencies=[Depends(require_token)])
async def dp_sweep(
    delta: float = 1e-5,
    n_trials: int = 500,
):
    return sweep_epsilon(delta=delta, n_trials=n_trials)



# ── Zero-Knowledge Reveal ─────────────────────────────────────
class ZKDemoRequest(BaseModel):
    prover_embedding: list[float] = Field(..., min_length=512, max_length=512)
    verifier_embedding: list[float] = Field(..., min_length=512, max_length=512)
    threshold: float = Field(0.45, ge=0, le=1)


@app.post("/zk/demo", dependencies=[Depends(require_token)])
async def zk_demo_endpoint(req: ZKDemoRequest):
    prover = np.array(req.prover_embedding, dtype=np.float32)
    verifier = np.array(req.verifier_embedding, dtype=np.float32)
    return zk_demo(prover, verifier, req.threshold)


@app.post("/zk/simulate", dependencies=[Depends(require_token)])
async def zk_simulate(
    n_trials: int = 100,
    threshold: float = 0.45,
):
    rng = np.random.default_rng()
    results = {"success": 0, "fail_threshold": 0, "fail_proof": 0}

    for _ in range(n_trials):
        base = rng.standard_normal(512).astype(np.float32)
        base /= np.linalg.norm(base)

        if rng.random() > 0.5:
            query = base + rng.normal(0, 0.01, 512).astype(np.float32)
            query /= np.linalg.norm(query)
        else:
            query = rng.standard_normal(512).astype(np.float32)
            query /= np.linalg.norm(query)

        result = zk_demo(query, base, threshold)
        if result["result"]["valid"]:
            results["success"] += 1
        elif result["result"].get("reason") == "below_threshold":
            results["fail_threshold"] += 1
        else:
            results["fail_proof"] += 1

    results["total"] = n_trials
    return results


# ── Backup verification ───────────────────────────────────────
class VerifyBlobRequest(BaseModel):
    recording_id: str = Field(..., min_length=1, max_length=64)
    storage_path: str = Field(..., min_length=1, max_length=512)


@app.post("/reveal/verify-blob", dependencies=[Depends(require_token)])
async def verify_blob_endpoint(req: VerifyBlobRequest):
    """Backup verification: attempt decrypt without revealing plaintext."""
    if not storage or not storage.client:
        raise HTTPException(503, "storage not initialized")
    try:
        blob = storage.client.storage.from_("recordings").download(req.storage_path)
        if not blob or len(blob) < 32:
            return {"ok": False, "reason": "empty or truncated blob"}

        from crypto_utils import decrypt_bytes
        try:
            decoded = decrypt_bytes(blob, req.recording_id)
            return {"ok": True, "bytes_decoded": len(decoded)}
        except Exception as e:
            return {"ok": False, "reason": f"decrypt failed: {type(e).__name__}: {e}"}
    except Exception as e:
        return {"ok": False, "reason": f"download failed: {e}"}


# ── Multi-frame embedding fusion ──────────────────────────────
class FuseEmbedding(BaseModel):
    embedding: list[float] = Field(..., min_length=512, max_length=512)
    quality: float = Field(1.0, ge=0, le=1)


class FuseRequest(BaseModel):
    frames: list[FuseEmbedding] = Field(..., min_length=1, max_length=64)
    strategy: str = Field("weighted_mean", description="weighted_mean | median")


@app.post("/embedding/fuse", dependencies=[Depends(require_token)])
async def fuse_embeddings_endpoint(req: FuseRequest):
    items = [
        FrameEmbedding(embedding=np.array(f.embedding, dtype=np.float64), quality=f.quality)
        for f in req.frames
    ]
    if req.strategy == "median":
        fused = fuse_median(items)
    else:
        fused = fuse_weighted_mean(items)
    if fused is None:
        raise HTTPException(400, "no valid frames after filtering")

    # Convenience: pairwise similarity to the first frame for diagnostics.
    base = items[0].embedding
    return {
        "embedding": fused.tolist(),
        "strategy": req.strategy,
        "frame_count": len(items),
        "similarity_to_first": round(cosine_similarity(fused, base), 4),
    }


# ── Anti-Spoofing ─────────────────────────────────────────────
@app.post("/anti-spoof", dependencies=[Depends(require_token)])
async def anti_spoof_endpoint(file: UploadFile = File(...)):
    """
    Heuristic liveness check on an uploaded face image. Returns spoof_score in
    [0, 1] (higher = more likely a printed-photo / phone-screen replay attack).
    """
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(400, "empty file")
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "invalid image")

    if face_engine is not None:
        faces = face_engine.detect_all(data)
        if faces:
            # detect_all() returns DetectedFace dataclasses, not dicts —
            # access .bbox (subscripting would raise TypeError on every
            # image that actually contains a face).
            x1, y1, x2, y2 = (int(v) for v in faces[0].bbox)
            h, w = img.shape[:2]
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            roi = img[y1:y2, x1:x2]
            if roi.size > 0:
                img = roi

    result = detect_spoof(img)
    return result.to_dict()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
