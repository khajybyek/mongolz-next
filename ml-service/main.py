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
import io
import logging
import os
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

# Local-д ажиллахад .env файлыг автоматаар уншуулна
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from face_engine import FaceEngine
from camera_worker import CameraManager
from storage import SupabaseStorage
from crypto_utils import init_master_key, self_test as crypto_self_test
from dp_embeddings import DPConfig, add_dp_noise, estimate_matching_accuracy, sweep_epsilon
from zk_reveal import full_protocol_demo as zk_demo
from telemetry import init_telemetry

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


app = FastAPI(title="MONGOLZ ML Service", version="1.0.0", lifespan=lifespan)

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
    if authorization.removeprefix("Bearer ") != ML_TOKEN:
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
@app.get("/stream/{camera_id}/index.m3u8", dependencies=[Depends(require_token)])
async def stream_playlist(camera_id: str):
    path = os.path.join(HLS_DIR, camera_id, "index.m3u8")
    if not os.path.exists(path):
        raise HTTPException(404, "stream not active")
    return FileResponse(path, media_type="application/vnd.apple.mpegurl")


@app.get("/stream/{camera_id}/{segment}", dependencies=[Depends(require_token)])
async def stream_segment(camera_id: str, segment: str):
    if not segment.endswith(".ts"):
        raise HTTPException(400, "invalid segment")
    path = os.path.join(HLS_DIR, camera_id, segment)
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
