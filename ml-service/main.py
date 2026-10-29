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
import hashlib
import hmac
import io
import logging
import os
import re
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4
from datetime import datetime, timezone

# Local-д ажиллахад .env файлыг автоматаар уншуулна
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# Native OpenCV diagnostics can echo a complete credential-bearing camera URL
# before Python gets a chance to redact it. Application-level errors already
# expose a safe camera id and reason, so keep the native channel silent.
os.environ["OPENCV_LOG_LEVEL"] = "SILENT"
import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from face_engine import FaceEngine
from camera_worker import CameraManager
from storage import SupabaseStorage
from recording_spool import get_recording_spool
from privacy_schedule import get_privacy_schedule_cache, init_privacy_schedule_cache
from privacy_protection import (
    ProtectedTimeline,
    fail_closed_timeline,
    load_protected_timeline,
    parse_duration,
    parse_timestamp,
)
from durable_jobs import UploadStore, UploadWorker, RevealWorker, UploadConflict
from crypto_utils import init_master_key, self_test as crypto_self_test, decrypt_bytes, master_key_candidates
from demo_source import DEMO_FPS, DEMO_HEIGHT, DEMO_WIDTH, demo_name, is_demo_url, resolve_demo_source
from hierarchical_keys import unseal_at_index
from dp_embeddings import DPConfig, add_dp_noise, estimate_matching_accuracy, sweep_epsilon
from zk_reveal import full_protocol_demo as zk_demo
from anti_spoof import detect_spoof
from embedding_fusion import FrameEmbedding, fuse_weighted_mean, fuse_median, cosine_similarity
from tcp_forward import tunnel_status
from telemetry import init_telemetry
from view_renderer import render_blurred_frame, render_blurred_view

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("mongolz-ml")

try:
    _cv_logging = cv2.utils.logging
    _cv_logging.setLogLevel(_cv_logging.LOG_LEVEL_SILENT)
except (AttributeError, TypeError):
    # Some OpenCV builds only honour OPENCV_LOG_LEVEL at import time.
    pass


_CRED_URL_RE = re.compile(r"(\w+://)[^/@\s]+@")


def _sentry_scrub(value):
    """Recursively redact user:pass@ in any string inside an event."""
    if isinstance(value, str):
        return _CRED_URL_RE.sub(r"\1***@", value)
    if isinstance(value, dict):
        return {k: _sentry_scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sentry_scrub(v) for v in value]
    return value


def _sentry_scrub_event(event, _hint):
    try:
        return _sentry_scrub(event)
    except Exception:  # noqa: BLE001 — a scrubber bug must not drop the event silently
        return event


def _init_sentry() -> bool:
    """Optional error reporting. Only when SENTRY_DSN is set and the SDK is
    importable; otherwise log once and run without it. The DSN itself is a
    credential and is never logged."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        log.info("Sentry: SENTRY_DSN unset — error reporting disabled")
        return False
    try:
        import sentry_sdk
    except ImportError:
        log.warning("Sentry: SENTRY_DSN set but sentry-sdk not installed — disabled")
        return False
    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get("RAILWAY_ENVIRONMENT_NAME", "production"),
            traces_sample_rate=0.0,
            send_default_pii=False,
            # Frame locals and request bodies can carry RTSP URLs with
            # credentials (capture loop, /camera/start) — never ship them.
            include_local_variables=False,
            max_request_body_size="never",
            before_send=_sentry_scrub_event,
        )
    except Exception as e:  # noqa: BLE001 — observability must never block boot
        log.warning("Sentry: init failed (%s) — disabled", type(e).__name__)
        return False
    log.info("Sentry: enabled")
    return True


_init_sentry()

ML_TOKEN = os.getenv("ML_SERVICE_TOKEN", "")
HLS_DIR = os.getenv("HLS_DIR", "/tmp/mongolz-hls")  # noqa: S108 — container-private /tmp
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ML_CORS_ORIGINS",
        "http://localhost:3000,https://aicctv.dev",
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
upload_store: UploadStore | None = None
upload_worker: UploadWorker | None = None
reveal_worker: RevealWorker | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global face_engine, camera_manager, storage, upload_store, upload_worker, reveal_worker
    log.info("Initializing FaceEngine...")
    init_master_key()
    crypto_self_test()
    face_engine = FaceEngine()
    storage = SupabaseStorage()
    # Per-camera privacy schedules (ADR 0012) for the capture pipeline,
    # /edge/detect and the reveal job — before any camera can start.
    init_privacy_schedule_cache(storage)
    recording_spool = get_recording_spool()
    recording_spool.start(storage)
    camera_manager = CameraManager(face_engine=face_engine, storage=storage, hls_dir=HLS_DIR)
    # Admission is closed unless inputs survive a Railway container restart.
    # Other service functions can still start when the upload volume is absent.
    try:
        upload_store = UploadStore.from_env()
    except (RuntimeError, OSError):
        upload_store = None
        log.error("Durable upload volume unavailable; upload admission disabled")
    if upload_store:
        from recording_pipeline import RecordingSession
        upload_worker = UploadWorker(upload_store, storage, recording_spool,
            lambda **kwargs: RecordingSession(engine=face_engine, storage=storage, **kwargs),
            hls_dir=HLS_DIR)
        upload_worker.start()
    reveal_worker = RevealWorker(storage, camera_manager.reveal)
    reveal_worker.start()
    from retention_worker import run_retention_worker
    retention_task = asyncio.create_task(run_retention_worker(storage))
    # Bring back the cameras that were running before this (re)deploy, then
    # keep them alive. Both are best-effort: a bad row or dead source is
    # recorded on camera_sessions.last_error, never raised into boot.
    try:
        await camera_manager.resume_persisted()
    except Exception:  # noqa: BLE001
        log.exception("camera auto-resume failed")
    camera_manager.start_supervisor()
    log.info("MONGOLZ ML service ready")
    try:
        yield
    finally:
        log.info("Shutting down...")
        retention_task.cancel()
        await asyncio.gather(retention_task, return_exceptions=True)
        await _stop_background_tasks()
        if upload_worker:
            await upload_worker.stop()
        if reveal_worker:
            await reveal_worker.stop()
        await camera_manager.stop_all()
        await recording_spool.stop()


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
    # Bytes, not str: hmac.compare_digest raises TypeError on non-ASCII str
    # input, which turned a garbage header into a 500 + traceback.
    supplied = authorization.removeprefix("Bearer ").encode("utf-8", "surrogateescape")
    if not hmac.compare_digest(supplied, ML_TOKEN.encode("utf-8")):
        raise HTTPException(403, "Invalid token")


# ── Health ──────────────────────────────────────────────────────
# Versioned capability flags the web app checks before it presents a feature
# as enforced (the web auto-deploys on push, this service is deployed by
# hand — an older build silently ignores privacy schedules).
#   privacy_schedules 1 = ADR 0012 enforced: capture (clock-bounded, spans
#   delivered with each segment), /edge/detect, reveal, on-demand view and
#   evidence renderers.
PRIVACY_SCHEDULES_CAPABILITY = 1


@app.get("/")
def health():
    """Liveness + tunnel readiness.

    ``ok`` keeps its old meaning — "this API is up" — so /api/uptime does not
    start flapping when the tailnet drops. The tunnel state sits ALONGSIDE
    it: the registered camera is only reachable over Tailscale, and a dead
    tunnel used to be invisible (health said ok while no frame could ever
    arrive). Booleans + a short reason only: no host, URL or key.
    """
    return {
        "ok": True,
        "service": "mongolz-ml",
        "engine": face_engine.info() if face_engine else None,
        "active_cameras": camera_manager.active_count() if camera_manager else 0,
        "tunnel": tunnel_status(),
        "durable_uploads_ready": upload_store is not None,
        "privacy_schedules": PRIVACY_SCHEDULES_CAPABILITY,
    }


# ── Embedding ──────────────────────────────────────────────────
_MAX_IMAGE_BYTES = 12 * 1024 * 1024


def _embed_or_400(image_bytes: bytes):
    """embed_single with decode failures mapped to a client error."""
    if not image_bytes or len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "image missing or too large")
    try:
        return face_engine.embed_single(image_bytes)
    except ValueError:
        raise HTTPException(400, "cannot decode image")


def _detect_or_400(image_bytes: bytes):
    if not image_bytes or len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "image missing or too large")
    try:
        return face_engine.detect_all(image_bytes)
    except ValueError:
        raise HTTPException(400, "cannot decode image")


def _detect_quality_or_400(image_bytes: bytes):
    if not image_bytes or len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "image missing or too large")
    try:
        return face_engine.detect_with_quality(image_bytes)
    except ValueError:
        raise HTTPException(400, "cannot decode image")


# Admin eval / benchmark endpoints run InsightFace for seconds at a time.
# They run in a worker thread (never on the event loop, which carries capture,
# HLS and health probes) and one at a time, so a benchmark never overlaps a
# second one on the shared ONNX sessions.
_EVAL_SLOT = asyncio.Semaphore(1)


@app.post("/embed", dependencies=[Depends(require_token)])
async def embed_endpoint(file: UploadFile = File(...)):
    if not face_engine:
        raise HTTPException(503, "engine not ready")

    image_bytes = await file.read()
    embedding = await asyncio.to_thread(_embed_or_400, image_bytes)
    if embedding is None:
        raise HTTPException(422, "no face found")

    return {"embedding": embedding.tolist()}


# ── Detect ──────────────────────────────────────────────────────
@app.post("/detect", dependencies=[Depends(require_token)])
async def detect_endpoint(file: UploadFile = File(...)):
    if not face_engine:
        raise HTTPException(503, "engine not ready")

    image_bytes = await file.read()
    faces = await asyncio.to_thread(_detect_or_400, image_bytes)
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


# ── Durable edge delivery ─────────────────────────────────────
_EDGE_AGENT_VERSION = "1.0.0"


def _edge_uuid(value: str, field: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError):
        raise HTTPException(400, f"invalid {field}")


def _utc_now() -> datetime:
    """Server receipt time for edge frames (a seam for tests)."""
    return datetime.now(timezone.utc)


def _edge_captured_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        parsed = parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        raise HTTPException(400, "invalid captured_at")
    # A broken device clock must not poison the operator timeline. Offline
    # queues may legitimately arrive much later, so reject only future values.
    age = (datetime.now(timezone.utc) - parsed).total_seconds()
    if age < -300:
        raise HTTPException(400, "captured_at outside accepted range")
    return parsed.isoformat()


async def _publish_edge_status(
    *, agent_id: str, agent_name: str, camera_id: str, version: str,
    state: str, queue_depth: int, oldest_queued_at: str | None,
    sent_total: int, failed_total: int, last_error: str | None,
) -> bool:
    if not storage or not storage.client:
        raise HTTPException(503, "service not ready")
    if queue_depth < 0 or sent_total < 0 or failed_total < 0:
        raise HTTPException(400, "invalid edge counters")
    if oldest_queued_at:
        oldest_queued_at = _edge_captured_at(oldest_queued_at)
    try:
        return await asyncio.to_thread(
            storage.upsert_edge_agent,
            agent_id=agent_id,
            name=(agent_name.strip() or "edge-agent")[:120],
            camera_id=camera_id,
            version=(version.strip() or _EDGE_AGENT_VERSION)[:40],
            state=state,
            queue_depth=queue_depth,
            oldest_queued_at=oldest_queued_at,
            sent_total=sent_total,
            failed_total=failed_total,
            last_error=last_error,
        )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("edge heartbeat rejected (%s): %s", agent_id[:8], type(exc).__name__)
        raise HTTPException(400, "edge device or camera is not registered")


@app.post("/edge/heartbeat", dependencies=[Depends(require_token)])
async def edge_heartbeat_endpoint(
    agent_id: str = Form(...),
    agent_name: str = Form(...),
    camera_id: str = Form(...),
    version: str = Form(_EDGE_AGENT_VERSION),
    state: str = Form("online"),
    queue_depth: int = Form(0),
    oldest_queued_at: str | None = Form(None),
    sent_total: int = Form(0),
    failed_total: int = Form(0),
    last_error: str | None = Form(None),
):
    agent_id = _edge_uuid(agent_id, "agent_id")
    camera_id = _edge_uuid(camera_id, "camera_id")
    capture_enabled = await _publish_edge_status(
        agent_id=agent_id, agent_name=agent_name, camera_id=camera_id,
        version=version, state=state, queue_depth=queue_depth,
        oldest_queued_at=oldest_queued_at, sent_total=sent_total,
        failed_total=failed_total, last_error=last_error,
    )
    return {"ok": True, "agent_id": agent_id, "capture_enabled": capture_enabled}


@app.post("/edge/detect", dependencies=[Depends(require_token)])
async def edge_detect_endpoint(
    file: UploadFile = File(...),
    event_id: str = Form(...),
    agent_id: str = Form(...),
    agent_name: str = Form(...),
    camera_id: str = Form(...),
    captured_at: str = Form(...),
    payload_sha256: str = Form(...),
    version: str = Form(_EDGE_AGENT_VERSION),
    queue_depth: int = Form(0),
    oldest_queued_at: str | None = Form(None),
    sent_total: int = Form(0),
    failed_total: int = Form(0),
):
    """Accept one frame from an encrypted edge outbox.

    The UUID primary key is the delivery key. A retry after a lost response
    receives the original acknowledgement without running inference twice.
    Only counts and integrity metadata are retained; the JPEG and biometric
    embeddings are discarded after inference.

    Privacy schedule (ADR 0012): a frame captured while the camera was in
    ``private`` mode is acknowledged without any inference (face_count 0).
    ``privacy_mode`` reports the mode used; a duplicate delivery is not
    re-evaluated and reports null.
    """
    if not face_engine or not storage or not storage.client:
        raise HTTPException(503, "service not ready")
    event_id = _edge_uuid(event_id, "event_id")
    agent_id = _edge_uuid(agent_id, "agent_id")
    camera_id = _edge_uuid(camera_id, "camera_id")
    captured_at = _edge_captured_at(captured_at)
    if not re.fullmatch(r"[0-9a-f]{64}", payload_sha256):
        raise HTTPException(400, "invalid payload_sha256")

    image_bytes = await file.read()
    if not image_bytes or len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "image missing or too large")
    actual_sha256 = hashlib.sha256(image_bytes).hexdigest()
    if not hmac.compare_digest(actual_sha256, payload_sha256):
        raise HTTPException(400, "payload checksum mismatch")

    capture_enabled = await _publish_edge_status(
        agent_id=agent_id, agent_name=agent_name, camera_id=camera_id,
        version=version, state="online", queue_depth=queue_depth,
        oldest_queued_at=oldest_queued_at, sent_total=sent_total,
        failed_total=failed_total, last_error=None,
    )
    try:
        existing = await asyncio.to_thread(storage.get_edge_event, event_id)
    except Exception as exc:
        log.warning("edge event lookup failed (%s): %s", event_id[:8], type(exc).__name__)
        raise HTTPException(503, "edge event registry unavailable")
    if existing:
        same_delivery = (
            existing.get("agent_id") == agent_id
            and existing.get("camera_id") == camera_id
            and existing.get("payload_sha256") == payload_sha256
        )
        if not same_delivery:
            raise HTTPException(409, "event_id already belongs to another payload")
        return {
            "ok": True, "event_id": event_id,
            "face_count": int(existing.get("face_count") or 0),
            "duplicate": True,
            "capture_enabled": capture_enabled,
            "privacy_mode": None,
        }

    # The schedule at CAPTURE time decides — but captured_at comes from the
    # device clock (no RTC / not NTP-synced / running fast, or an old outbox
    # entry), so the cache judges the capture as no later than receipt and a
    # few seconds earlier than the device claims: private when the camera is
    # private at receipt, anywhere between capture and receipt (≤ 1 h
    # apart), or the schedule was loosened after the capture. Unreadable →
    # private.
    privacy_mode, privacy_source = await get_privacy_schedule_cache().edge_mode(
        camera_id, datetime.fromisoformat(captured_at), _utc_now()
    )
    if privacy_mode == "standard":
        face_count = len(await asyncio.to_thread(_detect_or_400, image_bytes))
    else:
        # No detection, no embedding: the frame is dropped unprocessed.
        privacy_mode = "private"
        face_count = 0
        log.debug("edge event %s: camera in private mode (%s) — no inference", event_id[:8], privacy_source)
    try:
        await asyncio.to_thread(
            storage.insert_edge_event,
            event_id=event_id, agent_id=agent_id, camera_id=camera_id,
            captured_at=captured_at, payload_sha256=payload_sha256,
            face_count=face_count,
        )
    except Exception as exc:
        # A concurrent retry can win the INSERT after our lookup. Accept it
        # only when every immutable delivery field matches.
        try:
            existing = await asyncio.to_thread(storage.get_edge_event, event_id)
        except Exception:
            existing = None
        if existing and existing.get("agent_id") == agent_id \
           and existing.get("camera_id") == camera_id \
           and existing.get("payload_sha256") == payload_sha256:
            return {
                "ok": True, "event_id": event_id,
                "face_count": int(existing.get("face_count") or 0),
                "duplicate": True,
                "capture_enabled": capture_enabled,
                "privacy_mode": None,
            }
        log.warning("edge event persist failed (%s): %s", event_id[:8], type(exc).__name__)
        raise HTTPException(503, "edge event was not durably acknowledged")
    return {
        "ok": True, "event_id": event_id, "face_count": face_count,
        "duplicate": False, "capture_enabled": capture_enabled,
        "privacy_mode": privacy_mode,
    }


# ── Detect with quality ────────────────────────────────────────
@app.post("/detect/quality", dependencies=[Depends(require_token)])
async def detect_quality_endpoint(file: UploadFile = File(...)):
    if not face_engine:
        raise HTTPException(503, "engine not ready")
    image_bytes = await file.read()
    faces = await asyncio.to_thread(_detect_quality_or_400, image_bytes)
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
    threshold = min(1.0, max(0.0, float(threshold)))
    limit = min(200, max(1, int(limit)))

    image_bytes = await file.read()
    embedding = await asyncio.to_thread(_embed_or_400, image_bytes)
    if embedding is None:
        raise HTTPException(422, "no face found")

    matches = await storage.match_faces(embedding.tolist(), threshold=threshold, limit=limit)
    return {"matches": matches}


# ── Camera control ─────────────────────────────────────────────
_CAMERA_ID_RE = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
# demo://<name> is a synthetic looping source (demo_source.py allow-list);
# the shape is validated here, the name in resolve_demo_source.
_CAMERA_URL_RE = r"^(rtsps?|https?)://\S+$|^\d{1,2}$|^demo://[a-z0-9_-]{1,32}$"


class CameraStartReq(BaseModel):
    # Used as an HLS folder / storage key prefix → strict charset, no ".."
    camera_id: str = Field(pattern=_CAMERA_ID_RE)
    # Network cameras, a local device index or a demo source — never file
    # paths / other ffmpeg protocols (cv2.VideoCapture would open them).
    url: str = Field(pattern=_CAMERA_URL_RE, max_length=1024)
    fps: int = Field(default=15, ge=5, le=30)
    # Display name persisted with the auto-resume row (optional).
    camera_name: str | None = Field(default=None, max_length=120)


@app.post("/camera/start", dependencies=[Depends(require_token)])
async def camera_start(req: CameraStartReq):
    if not camera_manager:
        raise HTTPException(503, "manager not ready")

    # The web action checks cameras.enabled too, but this service must not
    # depend on its caller being correct: a disabled (or deleted) camera is
    # refused here as well. Ad-hoc ids and cameras we cannot read (registry
    # down) fall through — see CameraDesiredState.
    refusal = await camera_manager.start_refusal(req.camera_id)
    if refusal:
        log.info("Камер %s: start refused — %s", req.camera_id, refusal)
        raise HTTPException(409, refusal)

    if is_demo_url(req.url):
        # Generate (or reuse) the clip now so an unknown name fails the
        # request instead of a background task; ffmpeg runs off the loop.
        try:
            await asyncio.to_thread(resolve_demo_source, req.url)
        except ValueError:
            raise HTTPException(400, "unknown demo source")
        except Exception as e:  # noqa: BLE001
            log.error("demo source generation failed: %s", e)
            raise HTTPException(500, "demo source generation failed")

    await camera_manager.start(req.camera_id, req.url, fps=req.fps, camera_name=req.camera_name)
    return {"ok": True, "camera_id": req.camera_id}


class CameraStopReq(BaseModel):
    camera_id: str = Field(pattern=_CAMERA_ID_RE)


@app.post("/camera/privacy/hold", dependencies=[Depends(require_token)])
async def camera_privacy_hold(req: CameraStopReq):
    """Pin private and drain capture before an admin enables consent_required.

    The caller must not write the DB flag until this endpoint acknowledges.
    Stopping with by_user=False preserves auto-resume; any new session starts
    under the same process-wide private hold.
    """
    if not camera_manager:
        raise HTTPException(503, "manager not ready")
    cache = get_privacy_schedule_cache()
    try:
        cache.hold_private(req.camera_id)
    except ValueError:
        raise HTTPException(400, "registered camera UUID required")
    try:
        await camera_manager.stop(req.camera_id, by_user=False)
    except Exception as exc:  # noqa: BLE001 — hold stays on, no acknowledgement
        log.warning("camera %s: privacy hold drain failed (%s)", req.camera_id, type(exc).__name__)
        raise HTTPException(503, "camera privacy hold not confirmed")
    return {"ok": True, "privacy_mode": "private"}


@app.post("/camera/stop", dependencies=[Depends(require_token)])
async def camera_stop(req: CameraStopReq):
    if not camera_manager:
        raise HTTPException(503, "manager not ready")
    try:
        await camera_manager.stop(req.camera_id)
    except Exception as e:  # noqa: BLE001
        # The session stays registered so a retry can finalize it; answer a
        # generic 502 instead of an unhandled 500 with a traceback.
        log.warning("camera %s: stop failed: %s", req.camera_id, type(e).__name__)
        raise HTTPException(502, "camera stop failed; retry")
    return {"ok": True}


@app.post("/camera/privacy/refresh", dependencies=[Depends(require_token)])
async def camera_privacy_refresh(req: CameraStopReq):
    """Refresh a camera's capture/edge privacy policy after an admin edit.

    Invalidation makes a stale permissive policy fail closed immediately;
    the bounded read also reports whether the new policy was observed.
    """
    cache = get_privacy_schedule_cache()
    cache.invalidate(req.camera_id)
    mode, source = await cache.mode_at(req.camera_id, datetime.now(timezone.utc))
    consent_confirmed = cache.release_hold_if_consented(req.camera_id)
    return {"ok": True, "privacy_mode": mode, "privacy_source": source,
            "consent_confirmed": consent_confirmed}


@app.get("/camera/active", dependencies=[Depends(require_token)])
def camera_active():
    """Cameras currently being captured (HLS available). Feeds the multi-camera
    grid and the live wall so they can attach to streams started elsewhere.
    Each entry also carries the supervisor's ``restart_count`` and
    ``last_error`` (why the previous capture loop ended), ``state`` and
    ``next_retry_at``; never a URL.

    ``cameras`` keeps its original meaning (running, HLS playable — older
    callers treat every entry as a stream). Supervised cameras that dropped
    and are waiting for a retry are listed separately under ``reconnecting``
    with ``state = "backoff"`` and ``next_retry_at`` (ISO UTC or null).

    ``privacy_mode`` (ADR 0012) is ``"standard"`` | ``"private"`` as of the
    latest recognition tick, or null when not known yet / not capturing;
    ``privacy_source`` says why (``"schedule"`` | ``"consent"`` | ``"none"`` |
    ``"fail_closed"`` — the schedule could not be read, so recognition is off
    whatever the schedule says)."""
    if not camera_manager:
        return {"cameras": [], "reconnecting": []}
    return {
        "cameras": camera_manager.active_sessions(),
        "reconnecting": camera_manager.reconnecting_sessions(),
    }


# ── /camera/test — quick reachability probe before saving a config ──
class CameraTestReq(BaseModel):
    url: str = Field(max_length=1024)
    cam_type: str = Field(default="rtsp")


_CAMERA_TEST_TIMEOUT_SEC = 8.0
# Probes run on their own small pool: a hung cv2.VideoCapture (unreachable
# host, MJPEG with no connect timeout) must not eat the default executor
# that view rendering and the recording loop's detect() also rely on.
_probe_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="cam-probe")
_probe_slots = asyncio.Semaphore(2)
_PROBE_SCHEMES = ("rtsp://", "rtsps://", "http://", "https://")


_LOOPBACK_HOST_RE = re.compile(r"//(?:127\.0\.0\.1|localhost)(?::|/)")


def _is_loopback_forwarder_url(url: str) -> bool:
    """True if the URL targets the in-container tcp_forward listener.

    Local home cameras reach the ML container through Tailscale userspace
    + tcp_forward, so their URLs look like `rtsp://{user}:{password}@127.0.0.1:5554/…`.
    A probe failure on these URLs is most often a tailnet/subnet-router
    issue (home laptop offline), not bad credentials — we use this to
    return a clearer hint instead of the generic "check URL".
    """
    return bool(_LOOPBACK_HOST_RE.search(url))


def _probe_camera_sync(url: str) -> dict:
    """
    Blocking helper — open the URL via cv2.VideoCapture, grab one frame,
    return width/height/fps. Run inside a thread executor with an
    asyncio timeout (cv2 itself won't honour the timeout reliably; the
    enclosing task cancel is what saves the request from hanging).
    """
    is_forwarder = _is_loopback_forwarder_url(url)
    # Open/read timeouts (ms) so an unreachable host fails fast instead of
    # pinning the thread until the OS gives up.
    cap = cv2.VideoCapture(
        url,
        cv2.CAP_FFMPEG,
        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000],
    )
    try:
        if not cap.isOpened():
            if is_forwarder:
                return {
                    "ok": False,
                    "error": (
                        "Холбогдсонгүй (loopback forwarder). Home laptop "
                        "subnet router идэвхтэй эсэх болон tailnet status-ыг "
                        "шалгана уу."
                    ),
                }
            return {"ok": False, "error": "VideoCapture нээгдсэнгүй (URL/credentials шалга)"}
        ok, frame = cap.read()
        if not ok or frame is None:
            if is_forwarder:
                return {
                    "ok": False,
                    "error": (
                        "Forwarder холбогдсон ч frame ирэхгүй — tailnet "
                        "доош / RTSP transport (TCP) шалгана уу."
                    ),
                }
            return {"ok": False, "error": "Холбогдсон ч frame унших боломжгүй (codec/permission)"}
        h, w = frame.shape[:2]
        fps_raw = cap.get(cv2.CAP_PROP_FPS) or 0.0
        try:
            fps = round(float(fps_raw), 1)
        except (TypeError, ValueError):
            fps = 0.0
        return {"ok": True, "info": {"width": int(w), "height": int(h), "fps": fps}}
    finally:
        try:
            cap.release()
        except Exception:  # noqa: BLE001, S110
            pass


@app.post("/camera/test", dependencies=[Depends(require_token)])
async def camera_test(req: CameraTestReq):
    """Admin-аас камер нэмэх/засах үед URL хүрэх эсэхийг түргэн шалгана.

    USB / webcam — browser/host-side, энэ endpoint-оор шалгах боломжгүй
    (буцаалт нь UI-руу clear-error string).
    """
    cam_type = (req.cam_type or "").lower().strip()
    url = (req.url or "").strip()
    if not url:
        return {"ok": False, "error": "URL хоосон"}
    if is_demo_url(url):
        # Synthetic source — nothing to probe; the clip is generated at start.
        if demo_name(url) is None:
            return {"ok": False, "error": "Demo нэр буруу — lobby / gate / parking"}
        return {"ok": True, "info": {"width": DEMO_WIDTH, "height": DEMO_HEIGHT, "fps": DEMO_FPS}}
    if cam_type in ("usb", "webcam"):
        return {
            "ok": False,
            "error": "Энэ төрлийг ML-аас шалгах боломжгүй (browser/локал төхөөрөмж)",
        }
    if not url.lower().startswith(_PROBE_SCHEMES):
        return {"ok": False, "error": "Зөвхөн rtsp:// / http(s):// URL шалгана"}

    loop = asyncio.get_running_loop()
    try:
        async with _probe_slots:
            result = await asyncio.wait_for(
                loop.run_in_executor(_probe_pool, _probe_camera_sync, url),
                timeout=_CAMERA_TEST_TIMEOUT_SEC,
            )
    except asyncio.TimeoutError:
        return {
            "ok": False,
            "error": f"{int(_CAMERA_TEST_TIMEOUT_SEC)} секундын дотор холбогдсонгүй",
        }
    except Exception as e:  # noqa: BLE001
        log.warning("camera_test internal error: %s", e)
        return {"ok": False, "error": "ML-ийн дотоод алдаа"}

    return result


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
    # path comes from _safe_hls_path: name allow-list + realpath containment in HLS_DIR
    return FileResponse(path, media_type="application/vnd.apple.mpegurl")  # nosemgrep: python-tainted-request


@app.get("/stream/{camera_id}/{segment}", dependencies=[Depends(require_token)])
async def stream_segment(camera_id: str, segment: str):
    if not segment.endswith(".ts"):
        raise HTTPException(400, "invalid segment")
    path = _safe_hls_path(camera_id, segment)
    if not os.path.exists(path):
        raise HTTPException(404, "segment not found")
    # path comes from _safe_hls_path: name allow-list + realpath containment in HLS_DIR
    return FileResponse(path, media_type="video/MP2T")  # nosemgrep: python-tainted-request


# ── Reveal job ──────────────────────────────────────────────────
class RevealRunReq(BaseModel):
    job_id: str  # DB-д аль хэдийн үүссэн reveal_jobs row-ийн id


# asyncio only keeps weak references to tasks; a fire-and-forget task with no
# other reference can be garbage-collected mid-flight.
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


async def _stop_background_tasks() -> None:
    # `/reveal/run` starts the same leased processor used by the reconciler.
    # Letting those tasks outlive lifespan shutdown would keep decrypt/render
    # work running after the workers and cameras have already been stopped.
    tasks = tuple(_background_tasks)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


@app.post("/reveal/run", dependencies=[Depends(require_token)])
async def reveal_run_endpoint(req: RevealRunReq):
    """Next.js DB-д job үүсгэсний дараа дуудна — background-д ажиллана."""
    if not camera_manager:
        raise HTTPException(503, "service not ready")

    if not _UUID_RE.match(req.job_id):
        raise HTTPException(400, "invalid job_id")
    _spawn(camera_manager.reveal_job(req.job_id))
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
_VIEW_CACHE_DIR = "/tmp/mongolz-views"  # noqa: S108 — container-private /tmp
os.makedirs(_VIEW_CACHE_DIR, exist_ok=True)
# Bump when the view renderer's masking semantics change. A cached view is
# reusable only under this renderer version AND the current recording policy.
_VIEW_RENDERER_VERSION = "privacy-masked-v2"
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

    Result is cached at `/tmp/mongolz-views/{recording_id}.mp4`. A cache hit
    still reads the current recording and privacy policy before serving it.
    """
    # UUID validation — also blocks `..` / path traversal via the cache key.
    if not _UUID_RE.match(recording_id):
        raise HTTPException(400, "invalid recording_id")
    if not storage or not storage.client:
        raise HTTPException(503, "service not ready")

    cache_path = os.path.join(_VIEW_CACHE_DIR, f"{recording_id}.mp4")

    if _view_cache_matches(cache_path, None):
        # There is a published cache entry. Re-read spans and the camera
        # schedule, not just the recording row: privacy can tighten after the
        # first render, and a previously cached view would then be unsafe.
        _row, _protection, fingerprint = await _load_view_policy_or_discard(recording_id, cache_path)
        if _view_cache_matches(cache_path, fingerprint):
            # cache_path is _VIEW_CACHE_DIR/<id>.mp4 with id matched by the anchored _UUID_RE above
            return FileResponse(cache_path, media_type="video/mp4")  # nosemgrep: python-tainted-request
    return await _render_view_cold(recording_id, cache_path)


def _view_cache_matches(cache_path: str, fingerprint: str | None) -> bool:
    """Only a complete, current-policy cache entry may be served.

    ``fingerprint=None`` just checks for a candidate, so the fast path need
    not query privacy policy when no video exists. Legacy MP4s without the
    metadata sidecar always miss once a fingerprint is supplied.
    """
    import json

    try:
        if os.path.getsize(cache_path) <= 1000:
            return False
        if fingerprint is None:
            return True
        with open(cache_path + ".json", encoding="utf-8") as handle:
            metadata = json.load(handle)
        return metadata.get("fingerprint") == fingerprint and metadata.get("version") == _VIEW_RENDERER_VERSION
    except (OSError, ValueError, AttributeError, TypeError):
        return False


def _view_policy_fingerprint(row: dict, protection: ProtectedTimeline) -> str:
    """Stable hash of the source and every input to the effective protection.

    The schedule is included as well as its precomputed intervals because
    frames beyond the row's duration are evaluated against that schedule at
    render time. No sensitive policy detail is written to the cache sidecar.
    """
    import json
    from dataclasses import asdict

    payload = {
        "renderer": _VIEW_RENDERER_VERSION,
        "source": {key: row.get(key) for key in (
            "original_path", "has_original", "camera_id", "started_at", "duration_sec", "capture_status",
        )},
        "protection": asdict(protection),
    }
    encoded = json.dumps(payload, default=str, sort_keys=True, separators=(",", ":"), allow_nan=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


async def _load_view_policy(recording_id: str) -> tuple[dict, ProtectedTimeline, str]:
    try:
        result = await asyncio.to_thread(
            lambda: storage.client.table("recordings")
            .select("original_path, has_original, camera_id, started_at, duration_sec, capture_status")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:  # noqa: BLE001 — never serve a cache on lookup failure
        log.warning("view: recording lookup failed (%s): %s", recording_id[:8], type(exc).__name__)
        raise HTTPException(503, "recording lookup failed")
    row = result.data if result else None
    if not row:
        raise HTTPException(404, "recording not found")
    if not row.get("has_original") or not row.get("original_path"):
        raise HTTPException(404, "no original available — cannot derive view")
    protection = await asyncio.to_thread(_view_protection, recording_id, row)
    return row, protection, _view_policy_fingerprint(row, protection)


def _discard_view_cache(cache_path: str) -> None:
    """Remove a stale video together with its policy metadata under the lock."""
    for path in (cache_path + ".json", cache_path):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


async def _load_view_policy_or_discard(recording_id: str, cache_path: str) -> tuple[dict, ProtectedTimeline, str]:
    """`_load_view_policy` for the fast path; drops the cached view of a recording that is gone.

    Retention / GDPR deletions happen web-side and never reach this host, so
    without this a derived view would outlive its recording until the sweep.
    Not for use while holding the per-recording lock (asyncio.Lock is not
    re-entrant): the cold path discards inline instead.
    """
    try:
        return await _load_view_policy(recording_id)
    except HTTPException as exc:
        if exc.status_code == 404:
            async with _get_view_lock(recording_id):
                _discard_view_cache(cache_path)
        raise


def _publish_view_cache(cache_path: str, partial_path: str, fingerprint: str) -> None:
    """Publish video + policy metadata; an interrupted publish always misses."""
    import json

    metadata_path = cache_path + ".json"
    partial_metadata = metadata_path + ".part"
    try:
        with open(partial_metadata, "w", encoding="utf-8") as handle:
            json.dump({"version": _VIEW_RENDERER_VERSION, "fingerprint": fingerprint}, handle)
        # Remove the old metadata before replacing the video. A reader may
        # see a miss during publication, but never a new video with old proof.
        try:
            os.unlink(metadata_path)
        except FileNotFoundError:
            pass
        os.replace(partial_path, cache_path)
        os.replace(partial_metadata, metadata_path)
    finally:
        for path in (partial_metadata, partial_path):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass


def _view_protection(recording_id: str, row: dict) -> ProtectedTimeline:
    """Protected stretches of a recording for the masked renderers (ADR 0012).

    Frames captured in privacy mode are masked with the detector alone and
    the strongest mask. Any read failure treats the WHOLE recording as
    protected — the masked view is still served (fail closed = stronger
    masking, never a refusal). Synchronous: call it in a worker thread."""
    try:
        return load_protected_timeline(
            storage, get_privacy_schedule_cache(), recording_id,
            row.get("camera_id"), parse_timestamp(row.get("started_at")),
            parse_duration(row.get("duration_sec")),
        )
    except Exception as exc:  # noqa: BLE001 — unknown ⇒ everything protected
        log.warning(
            "view: privacy protection of %s unreadable (%s) — masking the whole recording in privacy mode",
            recording_id[:8], type(exc).__name__,
        )
        return fail_closed_timeline()


async def _evidence_recording_blob(recording_id: str) -> tuple[bytes, int | None, ProtectedTimeline]:
    """Load the best available recording source for a fully masked export."""
    if not storage or not storage.client:
        raise HTTPException(503, "service not ready")
    try:
        result = await asyncio.to_thread(
            lambda: storage.client.table("recordings")
            .select("original_path,storage_path,has_original,duration_sec,capture_status,camera_id,started_at")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        log.warning("evidence: recording lookup failed (%s): %s", recording_id[:8], type(exc).__name__)
        raise HTTPException(500, "recording lookup failed")
    row = result.data if result else None
    if not row:
        raise HTTPException(404, "recording not found")
    if row.get("capture_status") != "ready":
        raise HTTPException(409, "recording is not ready")
    path = row.get("original_path") if row.get("has_original") else row.get("storage_path")
    if not path:
        raise HTTPException(404, "recording source unavailable")
    try:
        def _download() -> bytes:
            body = storage.client.storage.from_("recordings").download(path)
            return decrypt_bytes(body, recording_id=recording_id) if str(path).endswith(".enc") else body
        blob = await asyncio.to_thread(_download)
    except Exception as exc:
        log.warning("evidence: source preparation failed (%s): %s", recording_id[:8], type(exc).__name__)
        raise HTTPException(500, "recording source unavailable")
    protection = await asyncio.to_thread(_view_protection, recording_id, row)
    duration = int(row["duration_sec"]) if row.get("duration_sec") is not None else None
    return blob, duration, protection


def _evidence_range(start_sec: float, end_sec: float, duration_sec: int | None) -> tuple[float, float]:
    if start_sec < 0 or end_sec <= start_sec or end_sec - start_sec > 300:
        raise HTTPException(400, "invalid evidence range")
    if duration_sec is not None and end_sec > duration_sec + 0.25:
        raise HTTPException(400, "evidence range exceeds recording")
    return float(start_sec), float(end_sec)


@app.get("/recording/{recording_id}/evidence-clip", dependencies=[Depends(require_token)])
async def evidence_clip_endpoint(recording_id: str, start_sec: float, end_sec: float):
    """Render the selected interval with every face masked."""
    if not _UUID_RE.match(recording_id):
        raise HTTPException(400, "invalid recording_id")
    blob, duration, protection = await _evidence_recording_blob(recording_id)
    start_sec, end_sec = _evidence_range(start_sec, end_sec, duration)
    work = tempfile.mkdtemp(prefix="mongolz-evidence-")
    input_mp4 = os.path.join(work, "source.mp4")
    output_mp4 = os.path.join(work, "masked-clip.mp4")
    try:
        with open(input_mp4, "wb") as handle:
            handle.write(blob)
        async with _render_semaphore:
            await asyncio.to_thread(
                render_blurred_view, input_mp4, output_mp4, face_engine, start_sec, end_sec, protection
            )
        if not os.path.isfile(output_mp4) or os.path.getsize(output_mp4) < 1000:
            raise RuntimeError("empty clip")
    except Exception as exc:
        shutil.rmtree(work, ignore_errors=True)
        log.warning("evidence: clip render failed (%s): %s", recording_id[:8], type(exc).__name__)
        raise HTTPException(500, "evidence clip render failed")
    return FileResponse(
        output_mp4,
        media_type="video/mp4",
        filename=f"{recording_id}-masked.mp4",
        background=BackgroundTask(shutil.rmtree, work, ignore_errors=True),
    )


@app.get("/recording/{recording_id}/evidence-frame", dependencies=[Depends(require_token)])
async def evidence_frame_endpoint(recording_id: str, at_sec: float):
    """Return one masked representative JPEG for an evidence package."""
    if not _UUID_RE.match(recording_id):
        raise HTTPException(400, "invalid recording_id")
    blob, duration, protection = await _evidence_recording_blob(recording_id)
    if at_sec < 0 or (duration is not None and at_sec > duration + 0.25):
        raise HTTPException(400, "invalid evidence timestamp")
    try:
        with tempfile.TemporaryDirectory(prefix="mongolz-evidence-frame-") as work:
            input_mp4 = os.path.join(work, "source.mp4")
            with open(input_mp4, "wb") as handle:
                handle.write(blob)
            async with _render_semaphore:
                jpeg = await asyncio.to_thread(
                    render_blurred_frame, input_mp4, at_sec, face_engine, protection
                )
    except Exception as exc:
        log.warning("evidence: frame render failed (%s): %s", recording_id[:8], type(exc).__name__)
        raise HTTPException(500, "evidence frame render failed")
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


async def _render_view_cold(recording_id: str, cache_path: str):
    # Cold path — derive under per-recording lock so a thundering herd of
    # concurrent requests only does the work once.
    async with _get_view_lock(recording_id):
        # 1) Read the recording row and its privacy policy under the lock, so
        # the sidecar published below describes exactly what this render used.
        # Errors are logged server-side only (see _load_view_policy).
        try:
            row, protection, fingerprint = await _load_view_policy(recording_id)
        except HTTPException as exc:
            if exc.status_code == 404:
                _discard_view_cache(cache_path)
            raise
        # Re-check after lock acquisition: a sibling coroutine may already
        # have rendered under this same policy. A stale entry is replaced below.
        if _view_cache_matches(cache_path, fingerprint):
            return FileResponse(cache_path, media_type="video/mp4")
        original_path = row["original_path"]

        # 2) Download encrypted original + decrypt
        try:
            def _fetch() -> bytes:
                data = storage.client.storage.from_("recordings").download(original_path)
                if isinstance(original_path, str) and original_path.endswith(".enc"):
                    data = decrypt_bytes(data, recording_id=recording_id)
                return data

            blob = await asyncio.to_thread(_fetch)
        except Exception as e:
            log.warning("view: download/decrypt failed (%s): %s", recording_id[:8], e)
            raise HTTPException(500, "could not prepare recording")

        # Frames captured in privacy mode (ADR 0012) are masked without any
        # embedding; unreadable protection masks the whole recording that way.
        # `protection` was read in step 1 together with the fingerprint.

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
                    await asyncio.to_thread(
                        render_blurred_view, input_mp4, tmp_out, face_engine, None, None, protection
                    )
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
        _publish_view_cache(cache_path, tmp_out, fingerprint)

        log.info(
            "view derived: recording=%s size=%dKB",
            recording_id[:8], os.path.getsize(cache_path) // 1024,
        )
        return FileResponse(cache_path, media_type="video/mp4")


# ── Per-face crop decryption (ADR 0009 — pixel-level hash-chain seal) ──
@app.get("/face/{face_id}/secure-crop", dependencies=[Depends(require_token)])
async def secure_crop_endpoint(face_id: str, level: int = 0):
    """Decrypt a per-face crop sealed with the hash-chain key K_index.

    THREAT MODEL — read honestly:
    The ML service holds the master key and can derive ANY K_index, so it is
    the *trusted decryption authority*. The `level` gate (ci < level → 403) is
    enforced HERE and at the Next proxy that supplies `level` after admin auth —
    it is authorization, not a cryptographic impossibility against this service.
    What the forward hash chain *does* buy: if per-level keys are ever handed
    out out-of-band (a party gets only K_level, not the master), that holder can
    derive K_level..N but NEVER below level (SHA-256 preimage resistance); and a
    thief of the `.enc` storage blobs + one K_level can only open faces ≥ level.
    So the seal is meaningful for storage-at-rest / delegated-key compromise,
    NOT against a holder of ML_SERVICE_TOKEN (who can already call this with
    level=0). `level` is server-supplied by the proxy and not client-forgeable
    through the normal path.
    """
    if not _UUID_RE.match(face_id):
        raise HTTPException(400, "invalid face_id")
    if not storage or not storage.client:
        raise HTTPException(503, "service not ready")

    try:
        res = await asyncio.to_thread(
            lambda: storage.client.table("faces")
            .select("recording_id, chain_index, image_path, crop_sealed")
            .eq("id", face_id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        log.warning("secure-crop: face lookup failed (%s): %s", face_id[:8], e)
        raise HTTPException(500, "face lookup failed")

    row = res.data if res else None
    if not row:
        raise HTTPException(404, "face not found")
    if not row.get("crop_sealed"):
        raise HTTPException(404, "crop not sealed")
    rec_id = row.get("recording_id")
    ci = row.get("chain_index")
    image_path = row.get("image_path")
    if rec_id is None or ci is None or not image_path:
        raise HTTPException(404, "face missing chain data")

    try:
        level = max(0, int(level))
    except (TypeError, ValueError):
        level = 0

    # Forward-only authority: K_level cannot derive K_index when index < level.
    if ci < level:
        raise HTTPException(403, "insufficient authority for this face")

    try:
        blob = await asyncio.to_thread(
            lambda: storage.client.storage.from_("faces").download(f"{image_path}.enc")
        )
    except Exception as e:
        log.warning("secure-crop: download failed (%s): %s", face_id[:8], e)
        raise HTTPException(500, "could not fetch crop")

    # Derive K_index by walking the chain forward from K_level (models a real
    # level-holder who only possesses K_level, not the master). The previous
    # master (ML_ENCRYPTION_KEY_PREV) is tried after the active one so a key
    # rotation never orphans sealed crops.
    try:
        jpeg = unseal_at_index(blob, rec_id, int(ci), level, master_key_candidates())
    except PermissionError:
        raise HTTPException(403, "insufficient authority for this face")
    except Exception as e:
        log.warning("secure-crop: decrypt failed (%s): %s", face_id[:8], type(e).__name__)
        raise HTTPException(500, "could not decrypt crop")

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=60"},
    )


# ── Durable uploads ─────────────────────────────────────────────
# Service-token callers must pass the authenticated principal from the Next
# proxy. Receipt status means durable acceptance, never render completion.
_UPLOAD_MAX_CHUNK_BYTES = 8 * 1024 * 1024


@app.post("/process-upload", dependencies=[Depends(require_token)])
async def process_upload_endpoint(
    file: UploadFile = File(...),
    requested_by: str = Form(...),
    camera_name: str = Form("Browser camera"),
    session_id: str | None = Form(None),
    chunk_index: int = Form(0),
    is_final: bool = Form(True),
):
    if not face_engine or not storage or not upload_store:
        raise HTTPException(503, "Durable upload storage unavailable; retry after service recovery")
    try:
        owner = str(UUID(requested_by))
        job_id = str(UUID(session_id)) if session_id else str(uuid4())
    except ValueError:
        raise HTTPException(400, "invalid upload identity")
    camera_name = (camera_name or "").strip()[:80] or "Browser camera"
    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()
    suffix = ".webm" if content_type.endswith("webm") or filename.endswith(".webm") else ".mp4"
    # Read one byte beyond the bound; a hostile body cannot cause an unbounded
    # in-memory read before the limit is checked.
    limit = _UPLOAD_MAX_CHUNK_BYTES if session_id else 100 * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "upload too large")
    if not session_id and not data:
        raise HTTPException(400, "empty upload")
    try:
        receipt = await asyncio.to_thread(upload_store.accept, storage, job_id=job_id,
            owner=owner, camera_name=camera_name, suffix=suffix,
            index=chunk_index if session_id else 0, final=is_final if session_id else True, data=data)
    except UploadConflict as exc:
        raise HTTPException(409, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        log.warning("Upload acceptance unavailable (%s)", type(exc).__name__)
        raise HTTPException(503, "Could not durably accept upload; retry the same session")
    return JSONResponse(receipt, status_code=200 if receipt["status"] == "chunk_received" else 202)


class UploadActionReq(BaseModel):
    requested_by: UUID
    is_admin: bool = False


async def _authorized_upload(job_id: str, requested_by: str, is_admin: bool):
    if not storage:
        raise HTTPException(503, "service not ready")
    if not _UUID_RE.match(job_id) or not _UUID_RE.match(requested_by):
        raise HTTPException(400, "invalid upload identity")
    row = await asyncio.to_thread(storage.upload_job, job_id)
    if not row or (row["requested_by"] != requested_by and not is_admin):
        raise HTTPException(404, "upload not found")
    return row


def _upload_metadata(row: dict):
    return {key: row.get(key) for key in ("id", "recording_id", "camera_name", "status",
        "progress", "attempts", "error_message", "created_at", "updated_at", "completed_at")}


@app.get("/upload-jobs/{job_id}", dependencies=[Depends(require_token)])
async def upload_job_endpoint(job_id: str, requested_by: str, is_admin: bool = False):
    return _upload_metadata(await _authorized_upload(job_id, requested_by, is_admin))


@app.post("/upload-jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
async def upload_cancel_endpoint(job_id: str, req: UploadActionReq):
    row = await _authorized_upload(job_id, str(req.requested_by), req.is_admin)
    if row["status"] == "cancelled":
        return _upload_metadata(row)
    from durable_jobs import _now
    updated = await asyncio.to_thread(storage.update_upload_job, job_id,
        ("queued", "processing", "failed"), status="cancelled", completed_at=_now(), error_message=None)
    if not updated:
        raise HTTPException(409, "Upload is committing or has already completed")
    return _upload_metadata(updated)


@app.post("/upload-jobs/{job_id}/retry", dependencies=[Depends(require_token)])
async def upload_retry_endpoint(job_id: str, req: UploadActionReq):
    await _authorized_upload(job_id, str(req.requested_by), req.is_admin)
    if not upload_store:
        raise HTTPException(503, "Durable input storage unavailable")
    try:
        available = await asyncio.to_thread(upload_store.verify, job_id)
    except Exception:
        available = False
    if not available:
        raise HTTPException(409, "Input unavailable; submit the original video again")
    updated = await asyncio.to_thread(storage.update_upload_job, job_id, ("failed",),
        status="queued", progress=0, attempts=0, completed_at=None, error_message=None)
    if not updated:
        raise HTTPException(409, "Only failed uploads can be retried")
    return _upload_metadata(updated)


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
    async with _EVAL_SLOT:
        faces = await asyncio.to_thread(_detect_or_400, image_bytes)
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
    if len(orig_bytes) > _MAX_IMAGE_BYTES or len(blur_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "image too large")

    try:
        boxes = [tuple(b) for b in json.loads(face_boxes)]
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "face_boxes must be JSON array")

    def _run():
        orig_img = cv2.imdecode(np.frombuffer(orig_bytes, np.uint8), cv2.IMREAD_COLOR)
        blur_img = cv2.imdecode(np.frombuffer(blur_bytes, np.uint8), cv2.IMREAD_COLOR)
        if orig_img is None or blur_img is None:
            raise HTTPException(400, "cannot decode images")
        use = boxes
        if not use and face_engine:
            faces = _detect_or_400(orig_bytes)
            use = [(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]) for f in faces]
        return compute_blur_quality(orig_img, blur_img, use)

    async with _EVAL_SLOT:
        return await asyncio.to_thread(_run)


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
def _embedding_to_np(raw) -> np.ndarray | None:
    """PostgREST returns pgvector columns as text ("[0.1,0.2,…]")."""
    if raw is None:
        return None
    try:
        if isinstance(raw, str):
            cleaned = raw.strip().lstrip("[").rstrip("]")
            if not cleaned:
                return None
            arr = np.fromstring(cleaned, sep=",", dtype=np.float32)
        else:
            arr = np.asarray(raw, dtype=np.float32)
        return arr if arr.size == 512 else None
    except (TypeError, ValueError):
        return None


def _cluster_sync(eps: float, min_samples: int, limit: int) -> dict:
    from sklearn.cluster import DBSCAN

    resp = storage.client.from_("faces").select("id, embedding").limit(limit).execute()
    rows = resp.data or []
    ids: list[str] = []
    vectors: list[np.ndarray] = []
    for r in rows:
        v = _embedding_to_np(r.get("embedding"))
        if v is not None:
            ids.append(r["id"])
            vectors.append(v)
    if not ids:
        return {"clusters": [], "noise": 0, "total": 0, "cluster_count": 0}

    embeddings = np.stack(vectors)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalized = embeddings / norms
    dist_matrix = np.clip(1 - normalized @ normalized.T, 0, 2)

    labels = DBSCAN(eps=eps, min_samples=min_samples, metric="precomputed").fit_predict(dist_matrix)

    clusters: dict[int, list[str]] = {}
    noise_count = 0
    for face_id, label in zip(ids, labels):
        if label == -1:
            noise_count += 1
        else:
            clusters.setdefault(int(label), []).append(face_id)

    # One UPDATE per cluster instead of one per face.
    for cluster_id, face_ids_list in clusters.items():
        storage.client.from_("faces").update({"cluster_id": cluster_id}).in_("id", face_ids_list).execute()
    noise_ids = [fid for fid, label in zip(ids, labels) if label == -1]
    if noise_ids:
        storage.client.from_("faces").update({"cluster_id": None}).in_("id", noise_ids).execute()

    return {
        "total": len(ids),
        "cluster_count": len(clusters),
        "noise": noise_count,
        "clusters": [
            {"id": k, "size": len(v), "face_ids": v[:10]}
            for k, v in sorted(clusters.items())
        ],
    }


@app.post("/cluster", dependencies=[Depends(require_token)])
async def cluster_endpoint(eps: float = 0.5, min_samples: int = 2, limit: int = 500):
    """Fetch face embeddings from DB, cluster with DBSCAN (cosine), store results."""
    if not storage or not storage.client:
        raise HTTPException(503, "storage not ready")
    if not (0 < eps <= 2):
        raise HTTPException(400, "eps must be in (0, 2]")
    min_samples = max(1, min(50, int(min_samples)))
    limit = max(1, min(5000, int(limit)))
    return await asyncio.to_thread(_cluster_sync, float(eps), min_samples, limit)


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

    async with _EVAL_SLOT:
        faces = await asyncio.to_thread(_detect_or_400, image_bytes)
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


# ── /eval/bench ───────────────────────────────────────────────
BENCH_SAMPLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
# The recording pipeline processes camera frames (640x480 / 640x360), so the
# benchmark input is scaled to that envelope: the numbers are meant to answer
# "how many camera frames per second can this box do", not "how fast is a
# 1024px portrait".
BENCH_MAX_SIDE = 640

# What each measured row actually runs. Shipped in the response so the page
# cannot label a number something it is not.
BENCH_MEASURES = {
    "detection": (
        "face_engine.detect_all() — RetinaFace detection; InsightFace "
        "computes each found face's 512-dim ArcFace embedding in the same "
        "pass, which is the per-frame cost the recording pipeline pays."
    ),
    "embedding": (
        "face_engine.embed_single() — the POST /embed path: detect, then "
        "take the largest face's embedding. Detection cost is INCLUDED "
        "(the model produces the embedding during detection); with no face "
        "in the frame this measures a failed detection plus a padded retry, "
        "which is why the input must contain a real face."
    ),
    "end_to_end": "detection + embedding on the same frame (detection therefore runs twice).",
    "effective_fps": "1000 / mean(detection) — sustained frames per second on the capture path.",
}


def bench_frame() -> tuple[bytes, str, bool]:
    """JPEG bytes for the benchmark, a label naming them, and whether the
    input is expected to contain a face.

    A benchmark must run the code path it claims to measure. The old input was
    uniform random NOISE: the detector finds nothing in it, so `embed_single`
    ran a detection plus a padded retry and returned None — the "embedding
    generation" row never timed an embedding and the FPS figure was the cost
    of three failed detections on a face-free image.

    The bundled AI-generated faces (samples/00..02.jpg, committed) are used
    instead, downscaled to a camera-sized frame. If they are unreadable the
    synthetic fallback is returned and LABELLED as face-free, so a run on a
    stripped image is visibly not a face benchmark rather than silently one.
    """
    for name in ("00.jpg", "01.jpg", "02.jpg"):
        try:
            with open(os.path.join(BENCH_SAMPLES_DIR, name), "rb") as fh:
                raw = fh.read()
        except OSError:
            continue
        img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        scale = min(1.0, BENCH_MAX_SIDE / float(max(h, w) or 1))
        if scale < 1.0:
            img = cv2.resize(
                img,
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        ok, encoded = cv2.imencode(".jpg", img)
        if ok:
            return encoded.tobytes(), f"sample face ({name})", True

    rng = np.random.default_rng(42)
    noise = rng.integers(0, 256, size=(480, 640, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", noise)
    if not ok:
        raise HTTPException(500, "failed to encode benchmark image")
    return encoded.tobytes(), "synthetic noise — NO FACE (samples missing)", False


def bench_stats(arr: list[float]) -> dict:
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


@app.post("/eval/bench", dependencies=[Depends(require_token)])
async def eval_bench_endpoint(iterations: int = 10):
    """Microbenchmark of the detect + embed path on a real face frame.

    Returns per-step latency stats (mean/p50/p95/p99), the sustained capture
    FPS, and — this is the part that was missing — what was actually measured:
    the input, how many faces the detector found in it, and whether the
    embedding row timed a real embedding (`embedding_measured`). A run that
    finds no face is reported as such instead of quietly publishing the cost
    of a failed detection as "embedding generation".
    """
    iterations = max(1, min(iterations, 100))
    if not face_engine:
        raise HTTPException(503, "engine not ready")

    img_bytes, input_label, expects_face = await asyncio.to_thread(bench_frame)

    def _measure():
        decoded = cv2.imdecode(np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        height, width = (decoded.shape[:2] if decoded is not None else (0, 0))
        detect_times: list[float] = []
        embed_times: list[float] = []
        total_times: list[float] = []
        faces_detected = 0
        embedding = None

        # Warmup — the first call pays model/JIT costs that belong to no row.
        try:
            warm = face_engine.detect_all(img_bytes)
            faces_detected = len(warm or [])
        except Exception as e:  # noqa: BLE001 — measured below; log, don't hide
            log.warning("bench warmup detection failed: %s", type(e).__name__)

        for _ in range(iterations):
            t0 = time.perf_counter()
            faces = face_engine.detect_all(img_bytes)
            t1 = time.perf_counter()
            detect_times.append((t1 - t0) * 1000)
            faces_detected = max(faces_detected, len(faces or []))

            t2 = time.perf_counter()
            embedding = face_engine.embed_single(img_bytes)
            t3 = time.perf_counter()
            embed_times.append((t3 - t2) * 1000)

            total_times.append((time.perf_counter() - t0) * 1000)
        return width, height, detect_times, embed_times, total_times, faces_detected, embedding

    # The whole timing loop runs in ONE worker thread (per-call thread hops
    # would leak into the timings); the loop used to block the event loop for
    # the entire run — ~5.7 s at 20 iterations, tens of seconds at 100.
    async with _EVAL_SLOT:
        (width, height, detect_times, embed_times, total_times,
         faces_detected, embedding) = await asyncio.to_thread(_measure)

    detection = bench_stats(detect_times)
    embedding_measured = faces_detected > 0 and embedding is not None
    mean_detect_ms = detection.get("mean_ms") or 0.0

    payload = {
        "iterations": iterations,
        # Rendered verbatim by /benchmarks — say what the frame was.
        "input_resolution": f"{width}x{height} · {input_label}",
        "input_source": input_label,
        "faces_detected": faces_detected,
        # False ⇒ the "embedding" row is the cost of a FAILED detection path,
        # not of an embedding. Never true on a face-free image.
        "embedding_measured": embedding_measured,
        "detection": detection,
        "embedding": bench_stats(embed_times),
        "end_to_end": bench_stats(total_times),
        "effective_fps": round(1000.0 / max(mean_detect_ms, 1e-6), 2),
        "effective_fps_end_to_end": round(
            1000.0 / max(sum(total_times) / len(total_times), 1e-6), 2
        ),
        "measures": BENCH_MEASURES,
        "engine": face_engine.info(),
    }
    if not embedding_measured:
        payload["warning"] = (
            "No face was detected in the benchmark input"
            + ("" if expects_face else " (sample images unavailable — synthetic noise used)")
            + " — the embedding row and end-to-end row time a failed detection, not an embedding."
        )
    return payload



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
    if not (0 < delta < 1):
        raise HTTPException(400, "delta must be in (0, 1)")
    n_trials = min(2000, max(50, int(n_trials)))
    return await asyncio.to_thread(sweep_epsilon, delta=delta, n_trials=n_trials)



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
    n_trials = min(1000, max(1, int(n_trials)))
    threshold = min(1.0, max(0.0, float(threshold)))

    # Up to 1000 proof round trips: CPU work, off the event loop.
    def _simulate():
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

    return await asyncio.to_thread(_simulate)


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
        # Download + AES-GCM decrypt of a whole recording: off the loop.
        blob = await asyncio.to_thread(storage.client.storage.from_("recordings").download, req.storage_path)
        if not blob or len(blob) < 32:
            return {"ok": False, "reason": "empty or truncated blob"}

        from crypto_utils import decrypt_bytes
        try:
            decoded = await asyncio.to_thread(decrypt_bytes, blob, req.recording_id)
            return {"ok": True, "bytes_decoded": len(decoded)}
        except Exception as e:
            return {"ok": False, "reason": f"decrypt failed: {type(e).__name__}"}
    except Exception as e:
        log.warning("verify-blob download failed (%s): %s", req.recording_id[:8], e)
        return {"ok": False, "reason": "download failed"}


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
        async with _EVAL_SLOT:
            faces = await asyncio.to_thread(_detect_or_400, data)
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

    # Local development only: the container starts uvicorn from the Dockerfile
    # CMD (--host 0.0.0.0). Here it binds to loopback unless HOST says otherwise.
    uvicorn.run("main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 8000)), reload=True)
