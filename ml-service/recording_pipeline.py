"""
RecordingSession — нэг камерны "live + saved-blurred + original" тус бүрийг бичих pipeline.

Урсгал
------
RTSP/Webcam frame
   ├─→ HLS (unblurred, live view-нд)
   ├─→ Blurred MP4 (recordings bucket — public-read for admins)
   └─→ Original MP4 (recordings bucket — `has_original=true` тэмдэглэгдсэн, private RLS)

`stop()` дуудахад:
   1. Бүх ffmpeg pipe-уудыг close хийж дуусгана
   2. Blurred + Original MP4-уудыг Supabase Storage-руу upload
   3. recordings table-руу row insert (has_original=true)
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone, timedelta

# Korea Standard Time (UTC+9) — filename болон video overlay-д хэрэглэнэ
KST = timezone(timedelta(hours=9))
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np

from crypto_utils import encrypt_bytes, master_key
from hierarchical_keys import key_at_index, encrypt_face as _seal_embedding

# OpenCV built-in Haar cascade — MediaPipe-аас илүү найдвартай (Python 3.14
# дээр mediapipe.solutions API-г арилгасан тул).
_HAAR_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"

if TYPE_CHECKING:
    from face_engine import FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.recording")

# ── Constants ─────────────────────────────────────────────────
ALERT_THRESHOLD = 0.45
# Dedup: цаг хугацааны цонхгүй — БҮТЭН session дотор cosine sim > THRESHOLD
# нэг л хүн гэж тоомсорлож faces row-г 1 удаа л бичнэ.
#
# ArcFace cosine similarity-н бодит scale:
#   • Ижил хүн, ижил өнцөг   → 0.70-0.90
#   • Ижил хүн, өөр өнцөг    → 0.40-0.70  ← энэ хүрээг бас catch хийх хэрэгтэй
#   • Өөр хүн                → 0.00-0.40
#
# Тиймээс 0.45-р threshold нь "ижил хүний бүх өнцгийг" нэгтгэнэ.
# Хуучин 0.75 нь front-only-д л ажилладаг байсан (side-profile нь шинэ
# row болж хадгалагддаг асуудалтай).
DEDUP_THRESHOLD = 0.35  # Хатуу — нэг хүний бүх өнцгийг 1-2 frame-д нэгтгэнэ
TIER_MATCH_THRESHOLD = 0.40  # Per-face suspect match для tier resolution
ALERT_COOLDOWN_SEC = 15
BLUR_KERNEL = (51, 51)
BLUR_SIGMA = 30

# ── Robust blur tunables ──────────────────────────────────────
# Detection амжилтгүй болсон frame-д blur-ыг үргэлжлүүлэх давталт.
# Багасгасан 15 frame (~1 сек @ 15fps) — false positive хурдан арилна.
BLUR_PERSIST_FRAMES = 15
# Detected bbox-ын эргэн тойронд нэмэх padding (хувиар).
BLUR_PAD_RATIO = 0.30
# InsightFace blur detection давтамж — primary detector (RetinaFace).
# 5 frame тутамд (~3 удаа/сек) ажиллах нь accuracy-ыг сайн хадгална.
INSIGHTFACE_BLUR_EVERY_N = 5
# InsightFace confidence threshold — энэ доороос ирсэн detection-уудыг
# false positive гэж тоомсорлож алгасна.
INSIGHTFACE_MIN_CONFIDENCE = 0.55

# Haar cascade — STRICT preset (false positive багасгах):
#   - minNeighbors хэт жижиг бол хувцас, монитор гэх мэт зүйлийг face гэдэг
#   - minSize хэт жижиг бол shadow / texture зураг бүрэн face гэдэг
HAAR_SCALE_FACTOR = 1.1
HAAR_MIN_NEIGHBORS = 8
HAAR_MIN_SIZE = (60, 60)
# Mosaic block size — face area-ыг N×N болгож зэрэг бууруулна.
# Жижиг тоо = илүү агрессив anonymize (information theory-р irreversible).
# 8×8 = 64 пиксел үлдэх (100×100 царайнаас 99.4% information алга).
MOSAIC_BLOCK_SIZE = 8


def _mosaic_anonymize(roi: np.ndarray, block_size: int = MOSAIC_BLOCK_SIZE) -> np.ndarray:
    """Face ROI-ийг irreversible mosaic болгоно (fallback хувилбар).

    Алгоритм: ROI-ийг block_size × block_size болгож resize (information loss),
    дараа нь NEAREST interpolation-аар original size руу буцааж томруулна.
    """
    h, w = roi.shape[:2]
    if h < 4 or w < 4:
        return roi
    bs = max(2, min(block_size, h // 2, w // 2))
    small = cv2.resize(roi, (bs, bs), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


# ── Cubist Mosaic — MONGOLZ оригинал алгоритм ──
# Voronoi tessellation-аар нүүрийг polygon-уудаар сольж "cubist art" эффект
# үүсгэнэ. Polygon бүрд тухайн хэсгийн дундаж өнгөөр fill хийнэ.
#
# Privacy: Нүүрний features (нүд, ам, дотрох detail) бүрэн арилна — зөвхөн
# polygon-ы дундах өнгө л үлдэнэ. ML reconstruction боломжгүй.
#
# Visual: Cubist artist хэв шиг polygon mosaic — энгийн pixelated mosaic-аас
# илүү гоё, "хийсэн" гоо зүйтэй.
#
# Reveal: Original encrypted MP4-аас decrypt хийн polygon хэсгүүдийг replace.
CUBIST_MIN_POLYGONS = 18
CUBIST_MAX_POLYGONS = 40

# Tier-aware tuning. Capstone thesis: protection level depends on who the
# subject is. VIP / protected witness → smaller cells (more polygons + heavier
# blur) make even contour-recovery attacks harder. Relaxed (public figure
# with no news-value privacy concern) → larger cells + lighter blur.
_TIER_CUBIST = {
    "vip":      {"min": 50, "max": 90, "scale_div": 250, "blur_sigma": 1.6},
    "standard": {"min": CUBIST_MIN_POLYGONS, "max": CUBIST_MAX_POLYGONS,
                 "scale_div": 600, "blur_sigma": 0.7},
    "relaxed":  {"min": 10, "max": 18, "scale_div": 1200, "blur_sigma": 0.4},
}


def _cubist_anonymize(
    roi: np.ndarray,
    seed: int = 0,
    privacy_tier: str = "standard",
) -> np.ndarray:
    """Voronoi tessellation polygon mosaic — нүүрийг cubist art болгоно.

    Args:
        roi: BGR face region (numpy array, H×W×3).
        seed: Тогтмол хэв үүсгэхэд хэрэглэх — ижил seed = ижил polygon байрлал.
        privacy_tier: 'vip' / 'standard' / 'relaxed' — protection strength.

    Returns:
        Polygon-уудаар filled face area. Хэт жижиг ROI-д mosaic-руу буцаана.
    """
    h, w = roi.shape[:2]
    if h < 16 or w < 16:
        return _mosaic_anonymize(roi)

    tier_cfg = _TIER_CUBIST.get(privacy_tier, _TIER_CUBIST["standard"])

    # Polygon тоо: ROI хэмжээ дээр scale (tier-аар тоон границ тохиргоо)
    area = h * w
    num_points = max(int(tier_cfg["min"]), min(int(tier_cfg["max"]), area // int(tier_cfg["scale_div"])))

    rng = np.random.RandomState(seed & 0x7FFFFFFF)
    pts_x = rng.randint(2, max(3, w - 2), num_points)
    pts_y = rng.randint(2, max(3, h - 2), num_points)

    # Ирмэгийн цэгүүд — дугуй хэлбэртэй биш бүх talбайг хамруулах
    edge_x = np.array([0, w // 2, w - 1, 0, w - 1, 0, w // 2, w - 1], dtype=np.int32)
    edge_y = np.array([0, 0, 0, h // 2, h // 2, h - 1, h - 1, h - 1], dtype=np.int32)
    pts_x = np.concatenate([pts_x, edge_x])
    pts_y = np.concatenate([pts_y, edge_y])

    rect = (0, 0, w, h)
    try:
        subdiv = cv2.Subdiv2D(rect)
        for x, y in zip(pts_x, pts_y):
            try:
                subdiv.insert((float(x), float(y)))
            except cv2.error:
                continue
        facets, _centers = subdiv.getVoronoiFacetList([])
    except cv2.error:
        # Voronoi алдаа — fallback mosaic
        return _mosaic_anonymize(roi)

    output = np.zeros_like(roi)

    for facet in facets:
        if len(facet) < 3:
            continue
        # Polygon-ийг integer coordinate болгож clip хийнэ
        ifacet = np.array(np.round(facet), dtype=np.int32)
        ifacet[:, 0] = np.clip(ifacet[:, 0], 0, w - 1)
        ifacet[:, 1] = np.clip(ifacet[:, 1], 0, h - 1)

        # Polygon mask
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, ifacet, 255)

        if int(mask.sum()) < 4:
            continue

        # Polygon-ийн дундаж өнгө (BGR)
        avg = cv2.mean(roi, mask=mask)
        color = (int(avg[0]), int(avg[1]), int(avg[2]))

        cv2.fillConvexPoly(output, ifacet, color)

    # Polygon ирмэгийг хэт хатуу биш болгоно (бага зэрэг blend).
    # Tier-аар sigma тохируулна — VIP илүү blur, relaxed бага.
    sigma = float(tier_cfg["blur_sigma"])
    output = cv2.GaussianBlur(output, (3, 3), sigma)
    return output


def _ffmpeg_mp4_writer(out_path: str, width: int, height: int, fps: int) -> subprocess.Popen:
    """BGR raw → libx264 mp4 (fragmented, тасардсан ч хүчинтэй)."""
    return subprocess.Popen(
        [
            "ffmpeg", "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            out_path,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _ffmpeg_hls_writer(out_dir: str, width: int, height: int, fps: int) -> subprocess.Popen:
    """BGR raw → HLS m3u8 (live view-нд, low-latency)."""
    return subprocess.Popen(
        [
            "ffmpeg", "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-f", "hls",
            "-hls_time", "2",
            "-hls_list_size", "6",
            "-hls_flags", "delete_segments+append_list",
            os.path.join(out_dir, "index.m3u8"),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


class RecordingSession:
    """
    Нэг камерны бүрэн pipeline. main.py-аас CameraManager.start() дуудах үед үүснэ.
    """

    def __init__(
        self,
        camera_id: str,
        camera_name: str | None,
        source_url: str,
        engine: "FaceEngine",
        storage: "SupabaseStorage",
        hls_dir: str,
        recordings_dir: str,
        fps: int = 15,
        db_camera_id: str | None = None,
    ):
        self.camera_id = camera_id
        self.camera_name = camera_name
        self.source_url = source_url
        self.engine = engine
        self.storage = storage
        self.fps = fps
        # camera_id (string) — storage path, HLS folder
        # db_camera_id (uuid|None) — DB foreign key. None for browser uploads.
        self.db_camera_id: str | None = db_camera_id if db_camera_id is not None else self._validate_uuid(camera_id)

        self.hls_dir = os.path.join(hls_dir, camera_id)
        self.rec_dir = os.path.join(recordings_dir, camera_id)
        Path(self.hls_dir).mkdir(parents=True, exist_ok=True)
        Path(self.rec_dir).mkdir(parents=True, exist_ok=True)

        # Filename timestamp KST-аар үүсгэнэ (UTC биш) — хэрэглэгч KST-аар хардаг
        ts = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
        # Recording UUID-ыг session-ийн эхэнд үүсгэнэ — encryption key
        # derivation-д ашиглана. Storage path-д бас оруулж encrypted блоб-уудыг
        # тэмдэглэх боломжтой болгоё.
        self.recording_id: str = str(uuid.uuid4())

        # Blur strategy (#3 — one encrypted source).
        # Default 'on_demand': no plaintext blurred MP4 is persisted; the
        # playback view is derived at request time from the encrypted original
        # via the ML /recording/{id}/view endpoint. Set BLUR_STRATEGY=baked to
        # keep the legacy double-artifact behaviour (blurred MP4 + encrypted
        # original) as an emergency rollback without a code deploy.
        _bs = os.getenv("BLUR_STRATEGY", "on_demand").strip().lower()
        self.blur_strategy: str = _bs if _bs in ("baked", "on_demand") else "on_demand"

        self.blurred_path = os.path.join(self.rec_dir, f"{ts}_blurred.mp4")
        self.original_path = os.path.join(self.rec_dir, f"{ts}_original.mp4")
        # `.enc` extension — Storage дээр encrypted blob гэдгийг тэмдэглэх
        self.filename_blurred = f"{camera_id}/{ts}_blurred.mp4"
        self.filename_original = f"{camera_id}/{ts}_original.mp4.enc"
        # Display filename in DB row — neutral for on_demand (no _blurred / _original
        # suffix since neither separate plaintext exists from the viewer's perspective).
        self.display_filename = (
            f"{ts}_blurred.mp4" if self.blur_strategy == "baked" else f"{ts}.mp4"
        )
        self.started_at = datetime.now(timezone.utc)

        # OpenCV Haar cascade — нүүрийг хурдан илрүүлэх (per-frame blur-д)
        self.detector = cv2.CascadeClassifier(_HAAR_PATH)
        if self.detector.empty():
            log.warning("Haar cascade ачаалагдсангүй (path=%s)", _HAAR_PATH)

        # Pipes (lifespan-д init болно)
        self.cap: cv2.VideoCapture | None = None
        self.hls: subprocess.Popen | None = None
        self.blurred_writer: subprocess.Popen | None = None
        self.original_writer: subprocess.Popen | None = None

        # Async control
        self.stop_flag = asyncio.Event()
        self.task: asyncio.Task | None = None
        # In-flight ArcFace processing task-уудыг track хийнэ — finalize-ын
        # өмнө бүгдийг await хийхэд хэрэглэнэ (race condition засвар).
        self.arcface_tasks: list[asyncio.Task] = []

        # Persistent blur cache: (bbox, ttl_frames, tier). Detection амжилтгүй
        # болсон frame-уудад өмнөх box-уудыг үргэлжлүүлэн blur хийнэ.
        # Үр дүнд хүн хөдөлсөн ч face гэнэт илэрхий гарахгүй.
        # tier нь last-known privacy_tier — InsightFace step-аас embedding-аар
        # шинэчлэгдэнэ; Haar нь embedding-гүй тул "standard" заана.
        self._blur_box_cache: list[tuple[tuple[int, int, int, int], int, str]] = []
        self._blur_frame_idx = 0

        # ArcFace session-wide dedup + alert state.
        # session_embeddings — бүтэн session-ийн уникал хүний embedding жагсаалт.
        # Шинэ нүүр илэрвэл бүх элементтэй харьцуулах: cosine > DEDUP_THRESHOLD
        # (0.45) бол ижил хүн гэж тоомсорлож алгасна.
        self.session_embeddings: list[np.ndarray] = []
        # Serialises the dedup-check-and-append + DB writes across overlapping
        # _process_arcface tasks (the capture loop spawns one every N frames
        # without awaiting the prior one). Without this, two tasks both see
        # "no match", both append, and emit duplicate faces/alerts.
        self._arcface_lock = asyncio.Lock()
        # Hash-chain position for hierarchical per-face keys (ADR 0009).
        # Each saved face increments this; its embedding is sealed with
        # K_index so a lower-authority reveal key can never unseal it.
        self._face_chain_index = 0
        self.last_alert_at: dict[str, float] = {}

        # Suspect cache: загвар эхлэхэд DB-ээс татаж нэг л удаа кэшилнэ.
        # Per-frame face embedding-ийг энэ кэштэй харьцуулж, аль ч suspect-той
        # cosine sim >= TIER_MATCH_THRESHOLD бол түүний privacy_tier-ийг
        # Cubist mask-руу дамжуулна. None бол "standard".
        # Refresh нь session lifetime-аар бус — шинэ session шинэ кэш.
        self.suspect_cache: list[tuple[np.ndarray, str]] = []  # (embedding, tier)
        self._load_suspect_cache()

        # Жинхэнэ видео уртыг хадгалах (frame_idx / output_fps).
        # File mode-д ended_at - started_at нь processing time-ыг агуулдаг тул
        # бичлэгийн жинхэнэ урт тэрнийг ашигладаггүй.
        self.recorded_frames: int = 0

    @staticmethod
    def _validate_uuid(value: str | None) -> str | None:
        """Return value if it's a valid UUID, else None (for DB camera_id column)."""
        if not value:
            return None
        try:
            uuid.UUID(value)
            return value
        except (ValueError, AttributeError):
            return None

    def _load_suspect_cache(self) -> None:
        """Pre-load every suspect's (embedding, privacy_tier) into RAM.

        Called once at session start. Per-frame face embeddings get matched
        against this cache to pick the Cubist tier:
          * match >= TIER_MATCH_THRESHOLD → use matched suspect's tier
          * no match                       → "standard"

        Failures are non-fatal: empty cache → everyone gets "standard" (the
        previous behaviour), pipeline continues unchanged.
        """
        try:
            res = (
                self.storage.client.table("suspects")
                .select("embedding, privacy_tier")
                .execute()
            )
            cache: list[tuple[np.ndarray, str]] = []
            for row in res.data or []:
                emb_raw = row.get("embedding")
                tier_raw = row.get("privacy_tier") or "standard"
                if not emb_raw:
                    continue
                try:
                    if isinstance(emb_raw, str):
                        cleaned = emb_raw.strip().lstrip("[").rstrip("]")
                        if not cleaned:
                            continue
                        emb = np.fromstring(cleaned, sep=",", dtype=np.float32)
                    else:
                        emb = np.asarray(emb_raw, dtype=np.float32)
                    if emb.size != 512:
                        continue
                    tier = tier_raw if tier_raw in ("vip", "standard", "relaxed") else "standard"
                    cache.append((emb, tier))
                except Exception:
                    continue
            self.suspect_cache = cache
            log.info(
                "Suspect cache loaded: %d entries (vip=%d, relaxed=%d, standard=%d)",
                len(cache),
                sum(1 for _, t in cache if t == "vip"),
                sum(1 for _, t in cache if t == "relaxed"),
                sum(1 for _, t in cache if t == "standard"),
            )
        except Exception as e:
            log.warning("Suspect cache load failed (fallback to standard tier): %s", e)
            self.suspect_cache = []

    def _resolve_tier(self, face_embedding: np.ndarray) -> str:
        """Match a face embedding against the suspect cache → return the
        privacy_tier of the best match (if similarity >= threshold),
        otherwise 'standard'.

        Cosine similarity on already-L2-normalised ArcFace embeddings is
        just the dot product; with ~10-100 suspects this is microseconds.
        """
        if not self.suspect_cache:
            return "standard"
        best_sim = 0.0
        best_tier = "standard"
        for (emb, tier) in self.suspect_cache:
            sim = float(np.dot(face_embedding, emb))
            if sim > best_sim:
                best_sim = sim
                best_tier = tier
        return best_tier if best_sim >= TIER_MATCH_THRESHOLD else "standard"

    def _draw_kst_timestamp(self, frame: np.ndarray, frame_idx: int) -> None:
        """Frame дээр KST timestamp burn-in нэмнэ (in-place).
        Timestamp = session.started_at + (frame_idx / fps), KST-аар форматлав.
        """
        h, w = frame.shape[:2]
        # Video дотрох энэ frame-ийн жинхэнэ цаг (UTC), дараа KST-руу
        video_sec = frame_idx / max(1, self.fps)
        frame_time = self.started_at + timedelta(seconds=video_sec)
        kst_time = frame_time.astimezone(KST)
        text = kst_time.strftime("%Y-%m-%d %H:%M:%S KST")

        # Хэмжээ frame-ийн өргөнтэй уялдуулна (640px≈0.5, 1080px≈0.7)
        font_scale = max(0.4, min(0.7, w / 1500))
        thickness = max(1, int(font_scale * 2))
        margin = max(10, int(w * 0.012))

        # Зүүн дээд буланд харласан background-той цагаан текст
        size, baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        tw, th = size
        # Хагас тунгалаг хар хэвтээ зурвас
        x1, y1 = margin - 4, margin - 4
        x2, y2 = margin + tw + 4, margin + th + baseline + 4
        overlay = frame.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
        # Цагаан текст
        cv2.putText(
            frame, text, (margin, margin + th),
            cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255),
            thickness, cv2.LINE_AA,
        )

    # ────────────────────────────────────────────
    # Lifecycle
    # ────────────────────────────────────────────
    async def start(self):
        self.task = asyncio.create_task(self._run())

    async def stop(self):
        self.stop_flag.set()
        if self.task:
            try:
                await asyncio.wait_for(self.task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self.task.cancel()

        for proc in (self.hls, self.blurred_writer, self.original_writer):
            if proc and proc.stdin:
                try:
                    proc.stdin.close()
                except Exception:
                    pass
            if proc:
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.terminate()

        # Upload + DB-д бичих
        await self._finalize()

    async def _finalize(self):
        # Race-condition засвар: бүх in-flight arcface task-уудыг дуусгана
        # эс тэгвээс late-finishing face insert-ууд recording_id NULL хэвээр
        # үлдэх, faces_in_recording RPC-д харагдахгүй болно.
        if self.arcface_tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self.arcface_tasks, return_exceptions=True),
                    timeout=15,
                )
            except asyncio.TimeoutError:
                log.warning(
                    "arcface tasks дуусахгүй, %d task үлдсэн",
                    sum(1 for t in self.arcface_tasks if not t.done()),
                )

        ended_at = datetime.now(timezone.utc)
        # Жинхэнэ видео урт = recorded frames / output fps
        # Бичлэгийн processing хугацаагаар бус, видео файлын жинхэнэ уртаар хадгална
        if self.recorded_frames > 0 and self.fps > 0:
            duration = int(self.recorded_frames / self.fps)
        else:
            duration = int((ended_at - self.started_at).total_seconds())

        async def upload_plain(local_path: str, storage_path: str) -> int | None:
            """Файлыг plaintext-ээр Storage-руу хуулах (blurred MP4-д)."""
            if not os.path.exists(local_path):
                return None
            size = os.path.getsize(local_path)
            if size < 1000:
                return None
            with open(local_path, "rb") as f:
                self.storage.upload_bytes(
                    "recordings", storage_path, f.read(), "video/mp4"
                )
            return size

        async def upload_encrypted(
            local_path: str, storage_path: str, recording_id: str
        ) -> tuple[int | None, int | None]:
            """Файлыг AES-256-GCM-аар encrypt хийгээд Storage-руу хуулах.
            Буцаах: (plaintext_size, encrypted_size).
            """
            if not os.path.exists(local_path):
                return None, None
            plaintext_size = os.path.getsize(local_path)
            if plaintext_size < 1000:
                return None, None
            with open(local_path, "rb") as f:
                plaintext = f.read()
            ciphertext = encrypt_bytes(plaintext, recording_id=recording_id)
            self.storage.upload_bytes(
                "recordings", storage_path, ciphertext, "application/octet-stream"
            )
            return plaintext_size, len(ciphertext)

        try:
            # In on_demand mode the blurred MP4 is never written to disk,
            # so upload_plain returns None (no-op). In baked mode it uploads
            # the plaintext blurred MP4 as before.
            blurred_size = await upload_plain(self.blurred_path, self.filename_blurred)
            original_plain, original_enc = await upload_encrypted(
                self.original_path, self.filename_original, self.recording_id
            )

            # Decide whether the session produced enough to persist:
            #   • baked    — needs the blurred MP4 upload to succeed (legacy)
            #   • on_demand — needs the encrypted original (the view is
            #     derived from it at request time; no blurred MP4 exists)
            have_artifact = (
                (self.blur_strategy == "baked" and blurred_size is not None)
                or (self.blur_strategy == "on_demand" and original_plain is not None)
            )

            if have_artifact:
                if self.blur_strategy == "baked":
                    row_filename = os.path.basename(self.blurred_path)
                    row_storage_path = self.filename_blurred
                    row_size_bytes = blurred_size
                else:
                    # On-demand: no separate playback artifact. Point
                    # storage_path at the encrypted original so the row is
                    # internally consistent; the playback page routes via
                    # /api/recordings/{id}/view based on blur_strategy.
                    row_filename = self.display_filename
                    row_storage_path = self.filename_original
                    row_size_bytes = original_plain

                rec_id = await self.storage.insert_recording_returning_id(
                    recording_id=self.recording_id,
                    filename=row_filename,
                    storage_path=row_storage_path,
                    duration_sec=duration,
                    size_bytes=row_size_bytes,
                    encrypted=True,  # original AES-256-GCM-аар хамгаалагдсан
                    has_original=bool(original_plain),
                    camera_id=self.db_camera_id,
                    camera_name=self.camera_name,
                    started_at=self.started_at.isoformat(),
                    ended_at=ended_at.isoformat(),
                    original_path=self.filename_original if original_plain else None,
                    blur_strategy=self.blur_strategy,
                )
                if rec_id:
                    try:
                        if self.storage.client:
                            query = self.storage.client.table("faces").update(
                                {"recording_id": rec_id}
                            )
                            if self.db_camera_id is not None:
                                query = query.eq("camera_id", self.db_camera_id)
                            else:
                                query = query.is_("camera_id", "null")
                            query.gte(
                                "detected_at", self.started_at.isoformat()
                            ).lte("detected_at", ended_at.isoformat()).execute()
                    except Exception as e:
                        log.warning("Face → recording link failed: %s", e)

                if self.blur_strategy == "baked":
                    log.info(
                        "✓ Recording finalized [baked]: %s (%dMB blurred · %s original [%s encrypted via AES-256-GCM])",
                        self.filename_blurred,
                        (blurred_size or 0) // 1024 // 1024,
                        f"{original_plain // 1024 // 1024}MB" if original_plain else "—",
                        f"{original_enc // 1024 // 1024}MB" if original_enc else "—",
                    )
                else:
                    log.info(
                        "✓ Recording finalized [on_demand]: %s (%sMB original → %sMB encrypted via AES-256-GCM; view derived at request time)",
                        self.filename_original,
                        f"{original_plain // 1024 // 1024}" if original_plain else "—",
                        f"{original_enc // 1024 // 1024}" if original_enc else "—",
                    )
        except Exception as e:
            log.error("Finalize failed: %s", e)
        finally:
            # Local-аас plaintext файлуудыг цэвэрлэх (Storage-д шифрлэгдсэн
            # хувилбар л үлдэнэ — local дээр original байх боломжгүй).
            for p in (self.blurred_path, self.original_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

    # ────────────────────────────────────────────
    # Main loop
    # ────────────────────────────────────────────
    async def _run(self):
        # HLS folder-ийг арилгаад дахин үүсгэх
        shutil.rmtree(self.hls_dir, ignore_errors=True)
        os.makedirs(self.hls_dir, exist_ok=True)

        # Numeric string ("0", "1", ...) бол webcam device index болгож хөрвүүлнэ.
        # RTSP URL, file path-уудыг хэвээр нь дамжуулна.
        src: str | int = (
            int(self.source_url)
            if isinstance(self.source_url, str) and self.source_url.isdigit()
            else self.source_url
        )
        # File mode detection — local file path бол EOF дээр зогсооно
        # (хэрэв live stream бол EOF гэдэг алхам байхгүй болохоор retry).
        is_file_mode = (
            isinstance(self.source_url, str)
            and not self.source_url.isdigit()
            and "://" not in self.source_url
            and os.path.isfile(self.source_url)
        )
        self.cap = cv2.VideoCapture(src)
        if not self.cap.isOpened():
            log.error("Камер нээгдсэнгүй: %s", self.source_url)
            return

        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        # File mode-д file fps-ийг ашиглана; live mode-д configured self.fps
        # 30-60 fps браузер бичлэгүүдийг 15 fps-руу буурууж 2-4x хурдасгана.
        # Output fps хэвээр өндөр (smooth playback) — input frame skip ашиглана.
        input_fps = self.cap.get(cv2.CAP_PROP_FPS) or self.fps
        if is_file_mode:
            target_fps = 15
            self.fps = min(int(round(input_fps)), target_fps)
            frame_skip_ratio = max(1, int(round(input_fps / target_fps)))
        else:
            frame_skip_ratio = 1
        log.info(
            "Камер %s: %dx%d input=%dfps output=%dfps skip=%d %s",
            self.camera_id, w, h, int(input_fps), self.fps, frame_skip_ratio,
            "[FILE MODE]" if is_file_mode else "[LIVE]",
        )

        # File mode-д HLS хэрэггүй (live preview-тэй холбоогүй)
        if not is_file_mode:
            self.hls = _ffmpeg_hls_writer(self.hls_dir, w, h, self.fps)
        # On-demand mode: skip the blurred encoder pipe entirely. Frees an
        # ffmpeg process + per-frame BGR write + the heavy _blur_with_mediapipe
        # call below (~10-30% recording-time CPU saved).
        if self.blur_strategy == "baked":
            self.blurred_writer = _ffmpeg_mp4_writer(self.blurred_path, w, h, self.fps)
        self.original_writer = _ffmpeg_mp4_writer(self.original_path, w, h, self.fps)

        frame_idx = 0
        read_idx = 0
        process_every_n = max(self.fps, 10)  # ArcFace embed/match ~1s/once

        try:
            while not self.stop_flag.is_set():
                ok, frame = self.cap.read()
                if not ok or frame is None:
                    if is_file_mode:
                        # EOF — file дуусчихсан, loop-аас гарна
                        log.info("File processing complete, %d frame written", frame_idx)
                        self.stop_flag.set()
                        break
                    await asyncio.sleep(0.1)
                    continue

                read_idx += 1
                # Frame skip: 30 fps file → process every 2nd → 15 fps output
                if frame_skip_ratio > 1 and (read_idx % frame_skip_ratio) != 0:
                    continue

                # Per-frame: MediaPipe blur is only needed when baking a
                # blurred MP4. On-demand mode skips this (the view is derived
                # at request time from the encrypted original).
                if self.blur_strategy == "baked":
                    blurred = await asyncio.to_thread(self._blur_with_mediapipe, frame)
                    self._draw_kst_timestamp(blurred, frame_idx)

                # KST timestamp burn-in on the original (also flows to HLS).
                # Recording-ийн жинхэнэ цаг харагдах нь видеоны forensic мэдээлэл.
                self._draw_kst_timestamp(frame, frame_idx)

                # Pipes
                self._write_safe(self.hls, frame)            # LIVE = unblurred
                if self.blur_strategy == "baked":
                    self._write_safe(self.blurred_writer, blurred)  # SAVED = blurred
                self._write_safe(self.original_writer, frame)   # ORIGINAL kept for reveal

                # Periodic ArcFace match (alerts + insert face row)
                if frame_idx % process_every_n == 0:
                    # Track-д хадгалж finalize-д бүгдийг хүлээх
                    t = asyncio.create_task(self._process_arcface(frame))
                    self.arcface_tasks.append(t)

                frame_idx += 1
                self.recorded_frames = frame_idx
                await asyncio.sleep(0)
        finally:
            self.cap.release()

    @staticmethod
    def _write_safe(proc: subprocess.Popen | None, frame: np.ndarray):
        if not proc or not proc.stdin:
            return
        try:
            proc.stdin.write(frame.tobytes())
        except (BrokenPipeError, OSError):
            pass

    # ────────────────────────────────────────────
    # Robust blur — Haar (every frame) + InsightFace (every Nth) +
    # persistence cache + 35% padding.
    # Үр дүн: detection амжилтгүй болсон frame-д ч blur хэвээр.
    # ────────────────────────────────────────────
    def _blur_with_mediapipe(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        self._blur_frame_idx += 1
        new_boxes: list[tuple[int, int, int, int]] = []

        # Step 1: Haar cascade (cheap, ~5ms) — every frame
        if not self.detector.empty():
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            haar_faces = self.detector.detectMultiScale(
                gray,
                scaleFactor=HAAR_SCALE_FACTOR,
                minNeighbors=HAAR_MIN_NEIGHBORS,
                minSize=HAAR_MIN_SIZE,
            )
            for (x, y, fw, fh) in haar_faces:
                # Haar has no embedding — default to "standard" tier. If
                # InsightFace overlaps this region in the same / next pass it
                # will replace with the proper tier via the merge logic.
                new_boxes.append((int(x), int(y), int(x + fw), int(y + fh), "standard"))

        # Step 2: InsightFace primary detection (every Nth frame) — confidence
        # threshold-ээр false positive шүүх. Haar-аас илүү ялгаа гаргадаг.
        # Бид энд ArcFace embedding-ээ авч suspect cache-тэй харьцуулан
        # тохирох privacy_tier-ийг box-руу холбоно (per-face tier mask).
        if self._blur_frame_idx % INSIGHTFACE_BLUR_EVERY_N == 0:
            try:
                ok, encoded = cv2.imencode(".jpg", frame)
                if ok:
                    detected = self.engine.detect_all(encoded.tobytes())
                    for d in detected:
                        # Зөвхөн өндөр итгэлцэлтэй detection-ыг авна
                        if d.confidence < INSIGHTFACE_MIN_CONFIDENCE:
                            continue
                        x1, y1, x2, y2 = map(int, d.bbox)
                        tier = self._resolve_tier(d.embedding)
                        new_boxes.append((x1, y1, x2, y2, tier))
            except Exception as e:
                log.debug("InsightFace blur skipped: %s", e)

        # Step 3: Cache TTL decay → шинэ box-уудыг fresh TTL-тэй нэмэх
        self._blur_box_cache = [
            (b, ttl - 1, tier) for (b, ttl, tier) in self._blur_box_cache if ttl > 1
        ]
        for nb in new_boxes:
            bx1, by1, bx2, by2, btier = nb
            self._blur_box_cache.append(((bx1, by1, bx2, by2), BLUR_PERSIST_FRAMES, btier))

        # Дотор давхардсан box-уудыг IoU-аар нэгтгэнэ
        self._blur_box_cache = self._merge_overlapping_boxes(self._blur_box_cache)

        # Step 4: Cache хоосон → frame буцаах. Бусад тохиолдолд padding-тай blur
        if not self._blur_box_cache:
            return frame

        out = frame.copy()
        for (x1, y1, x2, y2), _ttl, tier in self._blur_box_cache:
            bw, bh = x2 - x1, y2 - y1
            pad_x = int(bw * BLUR_PAD_RATIO)
            pad_y = int(bh * BLUR_PAD_RATIO)
            x1p = max(0, x1 - pad_x)
            y1p = max(0, y1 - pad_y)
            x2p = min(w, x2 + pad_x)
            y2p = min(h, y2 + pad_y)
            if x2p - x1p < 10 or y2p - y1p < 10:
                continue
            roi = out[y1p:y2p, x1p:x2p]
            # Seed-ийг bbox center-ээс үүсгэнэ — ижил байрлалд ижил polygon
            # хэв (coarse grid 32px-ээр rounded → жижиг хөдөлгөөнд тогтвортой).
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            seed = (cx >> 5) * 7919 + (cy >> 5) * 31
            out[y1p:y2p, x1p:x2p] = _cubist_anonymize(roi, seed=seed, privacy_tier=tier)
        return out

    @staticmethod
    def _merge_overlapping_boxes(
        cache: list[tuple[tuple[int, int, int, int], int, str]],
        iou_threshold: float = 0.4,
    ) -> list[tuple[tuple[int, int, int, int], int, str]]:
        """Cache доторх IoU > threshold-той box-уудыг нэгтгэнэ.
        Илүү шинэ TTL (өндөр)-ийг үлдээж бусдыг хаяна.
        Tier-ийн хувьд: давхцаж буй box-уудаас VIP > standard > relaxed-ийн
        тэргүүлэх дарааллаар ялах — нэг хүн VIP бөгөөд другаа standard бол
        VIP мask ашиглана (худалдан сэргийлэх protection).
        """
        tier_rank = {"vip": 2, "standard": 1, "relaxed": 0}

        # TTL буурах эрэмбээр sort — шинэ detection эхэнд
        cache_sorted = sorted(cache, key=lambda x: -x[1])
        kept: list[tuple[tuple[int, int, int, int], int, str]] = []
        for box, ttl, tier in cache_sorted:
            duplicate_idx: int | None = None
            for idx, (kbox, _kttl, _ktier) in enumerate(kept):
                # Inline IoU
                ax1, ay1, ax2, ay2 = box
                bx1, by1, bx2, by2 = kbox
                ix1, iy1 = max(ax1, bx1), max(ay1, by1)
                ix2, iy2 = min(ax2, bx2), min(ay2, by2)
                iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
                inter = iw * ih
                area_a = (ax2 - ax1) * (ay2 - ay1)
                area_b = (bx2 - bx1) * (by2 - by1)
                union = area_a + area_b - inter
                iou = inter / union if union > 0 else 0
                if iou > iou_threshold:
                    duplicate_idx = idx
                    break
            if duplicate_idx is None:
                kept.append((box, ttl, tier))
            else:
                # Existing wins on bbox + TTL, but we may need to upgrade the
                # tier to the more protective one.
                kbox, kttl, ktier = kept[duplicate_idx]
                if tier_rank.get(tier, 1) > tier_rank.get(ktier, 1):
                    kept[duplicate_idx] = (kbox, kttl, tier)
        return kept

    # ────────────────────────────────────────────
    # ArcFace processing (periodic — DB-д тэмдэглэх + alert)
    # ────────────────────────────────────────────
    async def _process_arcface(self, frame: np.ndarray):
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            return
        try:
            faces = await asyncio.to_thread(self.engine.detect_all, encoded.tobytes())
        except Exception as e:
            log.debug("ArcFace skipped: %s", e)
            return
        if not faces:
            return

        now = time.time()
        # Serialise the read-modify-write on session_embeddings (+ DB inserts)
        # so concurrent arcface tasks can't both miss-then-append the same
        # person. Detection (the CPU-heavy to_thread above) already ran
        # outside the lock, so parallelism where it matters is preserved.
        async with self._arcface_lock:
          for f in faces:
            # Session-wide dedup: cosine sim > DEDUP_THRESHOLD (0.45) бол
            # ижил хүн гэж тоомсорлож алгасна (faces row үүсгэхгүй).
            # ArcFace empirical scale-ийн дагуу 0.45 нь "same person across
            # angles" хүртэл нэгтгэдэг.
            if any(
                self.engine.cosine(f.embedding, prev) > DEDUP_THRESHOLD
                for prev in self.session_embeddings
            ):
                continue
            self.session_embeddings.append(f.embedding)

            # Save crop + insert face row + bbox (frame_h/w-д харьцангуй)
            x1, y1, x2, y2 = map(int, f.bbox)
            crop = frame[max(0, y1):y2, max(0, x1):x2]
            ok2, crop_bytes = cv2.imencode(".jpg", crop)
            if not (ok2 and self.storage.client):
                continue

            h, w = frame.shape[:2]
            bbox = {
                "x": max(0.0, x1 / w),
                "y": max(0.0, y1 / h),
                "w": (x2 - x1) / w,
                "h": (y2 - y1) / h,
            }

            filename = f"{self.camera_id}_{int(now * 1000)}_{uuid.uuid4().hex[:8]}.jpg"
            path = f"{self.camera_id}/{filename}"
            self.storage.upload_bytes("faces", path, crop_bytes.tobytes(), "image/jpeg")

            # ── Hierarchical key seal (ADR 0009) ──
            # Seal this face's embedding with its chain key K_index. A reveal
            # requester only obtains the embedding (and thus can target the
            # face) if they hold a key at or above this chain level. Best-effort:
            # any failure falls back to plain-embedding-only (legacy behaviour),
            # so sealing can never break recording.
            chain_index = self._face_chain_index
            embedding_sealed: str | None = None
            try:
                k = key_at_index(self.recording_id, chain_index, master_key())
                emb_bytes = np.asarray(f.embedding, dtype=np.float32).tobytes()
                embedding_sealed = base64.b64encode(_seal_embedding(emb_bytes, k)).decode()
            except Exception as e:  # noqa: BLE001 — never break capture on seal error
                log.warning("Face %d embedding seal алдаа: %s", chain_index, e)
                embedding_sealed = None
            self._face_chain_index += 1

            face_id = await self.storage.insert_face(
                filename=filename,
                image_path=path,
                embedding=f.embedding.tolist(),
                camera_id=self.db_camera_id,
                bbox=bbox,
                chain_index=chain_index,
                embedding_sealed=embedding_sealed,
            )

            # Suspect match → alert?
            matches = await self.storage.match_suspects(
                f.embedding.tolist(), threshold=ALERT_THRESHOLD, limit=1
            )
            if matches:
                m = matches[0]
                # Coerce similarity once: the PostgREST RPC can return it as a
                # string or None, which would crash the "%.2f" logger
                # ("must be real number, not str") and corrupt the alert row.
                try:
                    sim = float(m["similarity"])
                except (TypeError, ValueError):
                    sim = 0.0
                last = self.last_alert_at.get(m["id"], 0)
                if now - last >= ALERT_COOLDOWN_SEC:
                    self.last_alert_at[m["id"]] = now
                    await self.storage.insert_alert(
                        suspect_id=m["id"],
                        suspect_name=m["name"],
                        face_id=face_id,
                        similarity=sim,
                        screenshot_path=path,
                        camera_id=self.db_camera_id,
                        camera_name=self.camera_name,
                    )
                    log.warning("🚨 ALERT: %s (%.2f)", m["name"], sim)
