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
import math
import os
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta

# Korea Standard Time (UTC+9) — filename болон video overlay-д хэрэглэнэ
KST = timezone(timedelta(hours=9))
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np

from urllib.parse import urlsplit, urlunsplit

from crypto_utils import master_key
from recording_spool import get_recording_spool
from demo_source import is_demo_url, resolve_demo_source
from face_masker import FaceMasker
from hierarchical_keys import key_at_index, encrypt_face as _seal_embedding


def redact_url(url: str | int) -> str:
    """rtsp://user:pass@host/… → rtsp://***@host/… for logs (invariant 11)."""
    if not isinstance(url, str) or "://" not in url:
        return str(url)
    try:
        parts = urlsplit(url)
        if parts.username is None and parts.password is None:
            return url
        host = parts.hostname or ""
        if parts.port:
            host = f"{host}:{parts.port}"
        return urlunsplit((parts.scheme, f"***@{host}", parts.path, parts.query, parts.fragment))
    except ValueError:
        return "<unparsable url>"

# OpenCV built-in Haar cascade — MediaPipe-аас илүү найдвартай (Python 3.14
# дээр mediapipe.solutions API-г арилгасан тул).
_HAAR_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"

if TYPE_CHECKING:
    from face_engine import DetectedFace, FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.recording")

# ── Constants ─────────────────────────────────────────────────
# Live source: this many consecutive failed reads (0.1 s apart) means the
# feed is gone (RTSP dropped, MJPEG server closed) — exit so the supervisor
# re-opens it with backoff instead of spinning on a dead handle forever.
LIVE_READ_FAIL_LIMIT = 100
# Demo loop: consecutive re-opens that yield no frame before giving up
# (guards against a corrupt cached clip turning into a hot loop).
DEMO_REOPEN_LIMIT = 3
ALERT_THRESHOLD = 0.45
# Dedup: нэг хүнийг дахин дахин бичихээс сэргийлнэ — cosine sim > THRESHOLD
# бол «өмнө харсан хүн» гэж үзнэ.
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


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    """Env int reader — буруу утга бол default, ЧИМЭЭГҮЙ биш (log.warning)."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        log.warning("%s=%r нь бүхэл тоо биш — default %d ашиглав", name, raw, default)
        return default
    if value < minimum:
        log.warning("%s=%d хэт бага — доод хязгаар %d ашиглав", name, value, minimum)
        return minimum
    return value


# ── Session face memory (audit 4.7) ───────────────────────────
# ӨМНӨ: `session_embeddings` нь цаг хугацааны хязгааргүй байсан — session
# эхэлснээс хойш нэг удаа харагдсан хүн ТУХАЙН SESSION дуустал (auto-resume
# дээр хэд хоног) дахин хэзээ ч бүртгэгддэггүй, alert path-руу ч хүрдэггүй
# байв. «Энэ хүн харагдвал надад мэдэгд» гэсэн амлалт зөрчигдөж байсан.
#
# ОДОО: memory-д цонх нэмэв.
#   • SESSION_FACE_WINDOW_SEC (default 300 сек = 5 мин) — нэг хүний НОТЛОХ
#     БАРИМТ (faces мөр + битүүмжилсэн crop) хэр олон удаа бичигдэхийг
#     тодорхойлно. 5 минут гэдэг нь: (а) камерын өмнө зогсож байгаа хүн
#     цагт ≤12 мөр үүсгэнэ (42 нүүртэй энэ deployment-д боломжийн),
#     (б) alert_rules.dedup_window_sec-ийн DB default-той ижил тул
#     нотлох баримтын давтамж alert-ын давтамжаас илүү нягт болохгүй.
#   • SESSION_ALERT_RECHECK_SEC (default 60 сек) — dedup-д баригдсан
#     (өөрөөр хэлбэл шинэ мөр бичихгүй) хүнийг ХЭР ОЛОН удаа suspect-тэй
#     тааруулж alert давхаргад үзүүлэхийг тодорхойлно. Энэ нь хямд (нэг RPC),
#     мөр бичихгүй. Ингэснээр «хэр олон alert харагдах вэ» гэдгийг ML биш,
#     alert_rules (dedup цонх, burst, чимээгүй цаг) шийднэ — яг ёсоор нь.
#   Хоёулаа ML-ийн ALERT_COOLDOWN_SEC (15 сек, suspect тус бүрээр) дээр
#   нэмэгдэж ажиллана; DB-рүү спам явуулах давхарга байхгүй.
SESSION_FACE_WINDOW_SEC = _env_int("SESSION_FACE_WINDOW_SEC", 300, minimum=5)
SESSION_ALERT_RECHECK_SEC = _env_int("SESSION_ALERT_RECHECK_SEC", 60, minimum=5)
# Memory-ийн дээд хэмжээ — хөл ихтэй талбайд хугацаа дуусаагүй бичлэгүүд
# хуримтлагдахаас сэргийлнэ (мөн cosine харьцуулалт O(n)-ыг барина).
SESSION_MEMORY_MAX_ENTRIES = _env_int("SESSION_MEMORY_MAX_ENTRIES", 512, minimum=16)
# Detection дараалан унаж байвал хэдэн удаад нэг warning бичих вэ (эхнийх нь
# үргэлж бичигдэнэ). ~1 detect/сек тул 60 = ойролцоогоор минутанд нэг.
_DETECT_FAILURE_LOG_EVERY = 60
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


@dataclass
class SeenFace:
    """Session-ийн турш «энэ хүнийг харсан» гэсэн нэг бичлэг."""

    embedding: np.ndarray
    recorded_at: float          # энэ бичлэг үүссэн үе
    expires_at: float           # үүнээс хойш тухайн хүн ДАХИН бүртгэгдэнэ
    checked_at: float           # suspect match хамгийн сүүлд ажилласан үе
    face_id: str | None = None  # тэр мөрийн id (alert-д нотлох баримт болно)
    screenshot_path: str | None = None


class SessionFaceMemory:
    """Хугацааны цонхтой «өмнө харсан хүн» санах ой.

    Хоёр шийдвэрийг тусад нь гаргана:
      * ``lookup() is None``  → шинэ (эсвэл хугацаа нь дууссан) хүн: faces мөр
        + битүүмжилсэн crop бичих ёстой.
      * ``needs_recheck()``   → мөр бичихгүй ч suspect тааралтыг дахин
        ажиллуулж alert давхаргад үзүүлэх цаг болсон.

    Цонх нь БИЧСЭН үеэс хойш тоологдоно; дунд нь орсон давхардсан илрэлт
    цонхыг сунгахгүй. Энэ нь ЗОРИУДЫН сонголт: камерын өмнө байнга байгаа хүн
    цонх тутамд нэг мөр үлдээж, camera_health / heatmap / analytics зэрэг
    faces мөрөөр идэвхийг хэмждэг хэсгүүд «хүн байсаар байна» гэдгийг үнэн
    зөвөөр харуулна. (Alert нь энэ цонхноос ХАМААРАХГҮЙ — ``needs_recheck``
    нь ``SESSION_ALERT_RECHECK_SEC`` тутамд suspect тааралтыг дахин
    ажиллуулдаг тул сунгадаг цонх ч 4.7-гийн алдааг давтахгүй байсан.)

    Үнэ нь: байнга харагдаж буй хүн тутамд цонх бүрд нэг faces мөр + нэг
    битүүмжилсэн crop. Хэт их бол ``SESSION_FACE_WINDOW_SEC``-ийг өсгөнө;
    retention sweep нь хуучин мөрүүдийг цэвэрлэнэ.
    """

    def __init__(
        self,
        cosine,
        threshold: float = DEDUP_THRESHOLD,
        face_window_sec: int = SESSION_FACE_WINDOW_SEC,
        recheck_sec: int = SESSION_ALERT_RECHECK_SEC,
        max_entries: int = SESSION_MEMORY_MAX_ENTRIES,
    ):
        self._cosine = cosine
        self._threshold = threshold
        self.face_window_sec = max(1, int(face_window_sec))
        # Recheck нь face цонхноос урт байх нь утгагүй: цонх дуусмагц бүх зүйл
        # (мөр + alert) дахин ажилладаг тул түүнээс хэтэрсэн утгыг таслана.
        self.recheck_sec = min(max(1, int(recheck_sec)), self.face_window_sec)
        self.max_entries = max(1, int(max_entries))
        self._entries: list[SeenFace] = []

    def __len__(self) -> int:
        return len(self._entries)

    def prune(self, now: float) -> None:
        """Хугацаа нь дууссан бичлэгүүдийг хаяна (мөн дээд хэмжээг барина)."""
        self._entries = [e for e in self._entries if now <= e.expires_at]
        if len(self._entries) > self.max_entries:
            # Хамгийн эртнийхийг хаяна — идэвхтэй хүмүүс санах ойд үлдэнэ.
            self._entries.sort(key=lambda e: e.recorded_at)
            dropped = len(self._entries) - self.max_entries
            self._entries = self._entries[dropped:]
            log.warning(
                "Session face memory дүүрсэн — %d хамгийн эртний бичлэгийг хаяв (cap=%d)",
                dropped, self.max_entries,
            )

    def lookup(self, embedding: np.ndarray, now: float) -> SeenFace | None:
        """Цонхны дотор байгаа тохирох бичлэг, эсвэл None (= шинээр бичих).

"""
        self.prune(now)
        best: SeenFace | None = None
        best_sim = self._threshold
        for entry in self._entries:
            sim = self._cosine(embedding, entry.embedding)
            if sim > best_sim:
                best, best_sim = entry, sim
        return best

    def remember(
        self,
        embedding: np.ndarray,
        now: float,
        face_id: str | None,
        screenshot_path: str | None,
        ttl_sec: float | None = None,
    ) -> SeenFace:
        """Шинэ бичлэг нэмнэ.

        ``ttl_sec`` нь хадгалалт амжилтгүй болсон үед богино хугацаа өгөхөд
        хэрэглэгдэнэ (Storage унасан бол секунд тутам дахин оролдож лог
        дүүргэхгүй, гэхдээ 5 минут хүлээхгүй).
        """
        entry = SeenFace(
            embedding=embedding,
            recorded_at=now,
            expires_at=now + (self.face_window_sec if ttl_sec is None else max(1.0, ttl_sec)),
            checked_at=now,
            face_id=face_id,
            screenshot_path=screenshot_path,
        )
        self._entries.append(entry)
        self.prune(now)
        return entry

    def needs_recheck(self, entry: SeenFace, now: float) -> bool:
        return (now - entry.checked_at) >= self.recheck_sec

    @staticmethod
    def mark_checked(entry: SeenFace, now: float) -> None:
        entry.checked_at = now


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
            # HLS can only cut segments at keyframes; x264's default GOP (250
            # frames ≈ 16 s at 15 fps) made the first playlist appear after
            # ~20 s with 8 s segments. A 2 s GOP matches hls_time.
            "-g", str(max(1, fps * 2)), "-keyint_min", str(max(1, fps * 2)), "-sc_threshold", "0",
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

        # Different sessions can start within one second. Stable UUID paths
        # prevent a replayed delivery from overwriting a newer recording.
        artifact_stem = f"{ts}_{self.recording_id}"
        self.blurred_path = os.path.join(self.rec_dir, f"{artifact_stem}_blurred.mp4")
        self.original_path = os.path.join(self.rec_dir, f"{artifact_stem}_original.mp4")
        # `.enc` extension — Storage дээр encrypted blob гэдгийг тэмдэглэх
        self.filename_blurred = f"{camera_id}/{artifact_stem}_blurred.mp4"
        self.filename_original = f"{camera_id}/{artifact_stem}_original.mp4.enc"
        # Display filename in DB row — neutral for on_demand (no _blurred / _original
        # suffix since neither separate plaintext exists from the viewer's perspective).
        self.display_filename = (
            f"{ts}_blurred.mp4" if self.blur_strategy == "baked" else f"{ts}.mp4"
        )
        self.started_at = datetime.now(timezone.utc)

        # Shared masker (Haar every frame + InsightFace every Nth + TTL
        # persistence + tier-aware cubist) — identical to the view renderer
        # and the reveal path, so no code path is weaker than another.
        self.masker = FaceMasker(
            engine,
            tier_for=self._resolve_tier,
            haar_scale=HAAR_SCALE_FACTOR,
            haar_neighbors=HAAR_MIN_NEIGHBORS,
            haar_min_size=HAAR_MIN_SIZE,
            insight_every_n=INSIGHTFACE_BLUR_EVERY_N,
            insight_min_confidence=INSIGHTFACE_MIN_CONFIDENCE,
            persist_frames=BLUR_PERSIST_FRAMES,
            pad_ratio=BLUR_PAD_RATIO,
        )

        # Pipes (lifespan-д init болно)
        self.cap: cv2.VideoCapture | None = None
        self.hls: subprocess.Popen | None = None
        self.blurred_writer: subprocess.Popen | None = None
        self.original_writer: subprocess.Popen | None = None

        # Async control
        self.stop_flag = asyncio.Event()
        self.task: asyncio.Task | None = None
        # Supervisor contract (camera_worker): a session whose task finished
        # without this flag is a crash/drop and gets restarted with backoff;
        # exit_reason explains why (never contains the source URL).
        self.stopped_by_user = False
        self.exit_reason: str | None = None
        # In-flight ArcFace processing task-уудыг track хийнэ — finalize-ын
        # өмнө бүгдийг await хийхэд хэрэглэнэ (race condition засвар).
        self.arcface_tasks: list[asyncio.Task] = []

        # Whether the placeholder recordings row exists (inserted at start so
        # faces can reference it immediately — see _open_recording_row).
        self._row_inserted = False
        self._delivery_enqueued = False

        # ArcFace dedup + alert state.
        # face_memory — цонхтой «өмнө харсан хүн» бүртгэл (audit 4.7). Хугацаа
        # нь дуусмагц тухайн хүн faces хүснэгт БОЛОН alert зам руу дахин орно.
        self.face_memory = SessionFaceMemory(self.engine.cosine)
        # Дараалсан detection алдааны тоолуур (лог харагдуулахад).
        self._detect_failures = 0
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
            except Exception as e:  # noqa: BLE001 — _run already logged; still finalize below
                log.error("Capture loop for %s ended with error: %s", self.camera_id, e)

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

        # The HLS window is the one place un-masked faces touch the disk: the
        # live view is deliberately unblurred, and until now those segments
        # were only cleared when the SAME camera started again, so a stopped,
        # disabled or deleted camera left identifiable frames on the volume
        # indefinitely. Clear them here so "deleted when the session ends" is
        # true. Best-effort: a failure must never break stop().
        try:
            shutil.rmtree(self.hls_dir, ignore_errors=True)
            log.info("Камер %s: HLS цонх цэвэрлэгдлээ", self.camera_id)
        except Exception as e:  # noqa: BLE001
            log.warning("camera %s: HLS cleanup failed: %s", self.camera_id, type(e).__name__)

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

        def artifact_size(path: str) -> int | None:
            try:
                size = os.path.getsize(path)
                return size if size >= 1000 else None
            except FileNotFoundError:
                return None

        blurred_size = artifact_size(self.blurred_path)
        original_size = artifact_size(self.original_path)
        have_artifact = (
            (self.blur_strategy == "baked" and blurred_size is not None)
            or (self.blur_strategy == "on_demand" and original_size is not None)
        )
        spool = get_recording_spool()
        if not have_artifact:
            # A previous finalize may already have sealed the source files;
            # retry its manifest instead of deleting the capture placeholder.
            if spool.has_pending(self.recording_id):
                await asyncio.to_thread(spool.deliver, self.storage, self.recording_id)
                return
            if self._delivery_enqueued:
                # The background worker already acknowledged this delivery.
                return
            if self._row_inserted:
                await self.storage.delete_recording(self.recording_id)
            for path in (self.blurred_path, self.original_path):
                Path(path).unlink(missing_ok=True)
            return

        baked = self.blur_strategy == "baked"
        fields = {
            "filename": os.path.basename(self.blurred_path) if baked else self.display_filename,
            "storage_path": self.filename_blurred if baked else self.filename_original,
            "duration_sec": duration,
            "size_bytes": blurred_size if baked else original_size,
            "encrypted": True,
            "has_original": original_size is not None,
            "original_path": self.filename_original if original_size is not None else None,
            "ended_at": ended_at.isoformat(),
            "blur_strategy": self.blur_strategy,
            "camera_id": self.db_camera_id,
            "camera_name": self.camera_name,
            "started_at": self.started_at.isoformat(),
        }
        artifacts = []
        if original_size is not None:
            artifacts.append({"source": self.original_path, "path": self.filename_original, "original": True})
        if baked and blurred_size is not None:
            artifacts.append({"source": self.blurred_path, "path": self.filename_blurred, "original": False})

        # No network call precedes the encrypted, fsynced delivery manifest.
        # Disk/encryption failures propagate; already-sealed artifacts and
        # sources awaiting encryption remain recoverable by the spool worker.
        await asyncio.to_thread(spool.enqueue, self.recording_id, fields, artifacts)
        self._delivery_enqueued = True
        for path in (self.blurred_path, self.original_path):
            if artifact_size(path) is None:
                Path(path).unlink(missing_ok=True)
        delivered = await asyncio.to_thread(spool.deliver, self.storage, self.recording_id)
        if delivered:
            self._row_inserted = True
            log.info("Recording %s delivery complete", self.recording_id)
        else:
            log.warning("Recording %s encrypted and queued for delivery", self.recording_id)

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
        # demo://<name> → cached synthetic clip, but treated as LIVE below
        # (HLS on, loop on EOF, real-time pacing) — it stands in for a camera.
        is_demo = is_demo_url(self.source_url)
        if is_demo:
            try:
                src = await asyncio.to_thread(resolve_demo_source, self.source_url)
            except Exception as e:  # noqa: BLE001
                self.exit_reason = f"demo source unavailable: {type(e).__name__}"
                log.error("Demo source %s unavailable: %s", self.source_url, e)
                return
        # File mode detection — local file path бол EOF дээр зогсооно
        # (хэрэв live stream бол EOF гэдэг алхам байхгүй болохоор retry).
        is_file_mode = (
            not is_demo
            and isinstance(self.source_url, str)
            and not self.source_url.isdigit()
            and "://" not in self.source_url
            and os.path.isfile(self.source_url)
        )
        self.cap = cv2.VideoCapture(src)
        if not self.cap.isOpened():
            self.exit_reason = "source unreachable at open"
            log.error("Камер нээгдсэнгүй: %s", redact_url(self.source_url))
            return

        await self._open_recording_row()

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
        if is_demo and input_fps > 0:
            # Frames are paced at the clip's own rate, so the encoders must
            # be told that rate or HLS/MP4 timing drifts from wall clock.
            self.fps = max(1, int(round(input_fps)))
        log.info(
            "Камер %s: %dx%d input=%dfps output=%dfps skip=%d %s",
            self.camera_id, w, h, int(input_fps), self.fps, frame_skip_ratio,
            "[FILE MODE]" if is_file_mode else ("[DEMO]" if is_demo else "[LIVE]"),
        )

        # File mode-д HLS хэрэггүй (live preview-тэй холбоогүй)
        if not is_file_mode:
            self.hls = _ffmpeg_hls_writer(self.hls_dir, w, h, self.fps)
        # On-demand mode: skip the blurred encoder pipe entirely. Frees an
        # ffmpeg process + per-frame BGR write + the heavy FaceMasker.mask
        # call below (~10-30% recording-time CPU saved).
        if self.blur_strategy == "baked":
            self.blurred_writer = _ffmpeg_mp4_writer(self.blurred_path, w, h, self.fps)
        self.original_writer = _ffmpeg_mp4_writer(self.original_path, w, h, self.fps)

        frame_idx = 0
        read_idx = 0
        process_every_n = max(self.fps, 10)  # ArcFace embed/match ~1s/once
        read_failures = 0
        demo_reopens = 0
        # Demo pacing: a file decodes far faster than real time; emit frames
        # on the clip's clock so HLS viewers and KST burn-in see real time.
        frame_interval = 1.0 / max(1, self.fps)
        next_due = time.monotonic()

        try:
            while not self.stop_flag.is_set():
                ok, frame = self.cap.read()
                if not ok or frame is None:
                    if is_file_mode:
                        # EOF — file дуусчихсан, loop-аас гарна
                        log.info("File processing complete, %d frame written", frame_idx)
                        self.stop_flag.set()
                        break
                    if is_demo:
                        # EOF on the clip: rewind by re-opening; frame_idx keeps
                        # counting so timestamps and recording length stay
                        # continuous across loops.
                        demo_reopens += 1
                        if demo_reopens > DEMO_REOPEN_LIMIT:
                            self.exit_reason = "demo source yields no frames"
                            log.error("Demo %s: re-open produced no frames", self.camera_id)
                            break
                        self.cap.release()
                        self.cap = cv2.VideoCapture(src)
                        if not self.cap.isOpened():
                            self.exit_reason = "demo source re-open failed"
                            log.error("Demo %s: re-open failed", self.camera_id)
                            break
                        continue
                    read_failures += 1
                    if read_failures >= LIVE_READ_FAIL_LIMIT:
                        self.exit_reason = "source dropped (no frames)"
                        log.warning(
                            "Камер %s: %d consecutive read failures — source dropped",
                            self.camera_id, read_failures,
                        )
                        break
                    await asyncio.sleep(0.1)
                    continue
                read_failures = 0
                demo_reopens = 0

                read_idx += 1
                # Frame skip: 30 fps file → process every 2nd → 15 fps output
                if frame_skip_ratio > 1 and (read_idx % frame_skip_ratio) != 0:
                    continue

                # Per-frame masking is only needed when baking a blurred MP4.
                # On-demand mode skips this (the view is derived at request
                # time from the encrypted original by the same FaceMasker).
                if self.blur_strategy == "baked":
                    blurred = await asyncio.to_thread(self.masker.mask, frame)
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
                    # Track-д хадгалж finalize-д бүгдийг хүлээх. Drop finished
                    # ones first — a demo/live session runs for hours and only
                    # in-flight tasks matter to finalize.
                    self.arcface_tasks = [t for t in self.arcface_tasks if not t.done()]
                    t = asyncio.create_task(self._process_arcface(frame))
                    self.arcface_tasks.append(t)

                frame_idx += 1
                self.recorded_frames = frame_idx
                if is_demo:
                    next_due += frame_interval
                    delay = next_due - time.monotonic()
                    if delay > 0:
                        await asyncio.sleep(delay)
                    else:
                        # Fell behind (CPU contention) — resync rather than
                        # bursting frames to repay the debt.
                        next_due = time.monotonic()
                        await asyncio.sleep(0)
                else:
                    await asyncio.sleep(0)
        except Exception as e:  # noqa: BLE001 — log with traceback; stop()/_finalize still run
            self.exit_reason = f"capture loop crashed: {type(e).__name__}"
            log.exception("Capture loop crashed for camera %s", self.camera_id)
            self.stop_flag.set()
        finally:
            self.cap.release()
            # Close the encoder pipes here as well: if the loop crashed, stop()
            # may not be called by the manager and ffmpeg would linger.
            for proc in (self.hls, self.blurred_writer, self.original_writer):
                if proc and proc.stdin:
                    try:
                        proc.stdin.close()
                    except Exception:  # noqa: BLE001
                        pass

    async def _open_recording_row(self) -> None:
        """Insert the recordings row at session start.

        Faces are sealed with keys derived from ``self.recording_id`` and must
        reference it via FK immediately; previously the row was inserted only
        at finalize and faces were back-linked by a camera+time window, which
        cross-linked concurrent browser uploads (all camera_id NULL) and lost
        the seal context entirely if finalize never ran.
        """
        try:
            rec_id = await self.storage.insert_recording_returning_id(
                recording_id=self.recording_id,
                filename=self.display_filename,
                storage_path=self.filename_original,
                duration_sec=None,
                size_bytes=None,
                encrypted=True,
                has_original=False,
                camera_id=self.db_camera_id,
                camera_name=self.camera_name,
                started_at=self.started_at.isoformat(),
                ended_at=None,
                original_path=None,
                blur_strategy=self.blur_strategy,
            )
            self._row_inserted = bool(rec_id)
        except Exception as e:  # noqa: BLE001 — recording continues; finalize falls back to insert
            log.warning("recording row open failed (will insert at finalize): %s", e)
            self._row_inserted = False

    @staticmethod
    def _write_safe(proc: subprocess.Popen | None, frame: np.ndarray):
        if not proc or not proc.stdin:
            return
        try:
            proc.stdin.write(frame.tobytes())
        except (BrokenPipeError, OSError):
            pass

    # ────────────────────────────────────────────
    # ArcFace processing (periodic — DB-д тэмдэглэх + alert)
    # ────────────────────────────────────────────
    async def _process_arcface(self, frame: np.ndarray):
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            self._note_detect_failure(ValueError("frame JPEG encode амжилтгүй"))
            return
        try:
            faces = await asyncio.to_thread(self.engine.detect_all, encoded.tobytes())
        except Exception as e:  # noqa: BLE001
            # ӨМНӨ: log.debug — production-ын INFO түвшинд ХАРАГДДАГГҮЙ байсан.
            # Engine унасан бол alert зам бүхэлдээ хараагүй болно; үүнийг
            # чимээгүй өнгөрөөх нь болохгүй.
            self._note_detect_failure(e)
            return
        self._note_detect_success()
        if not faces:
            return

        now = time.time()
        # Serialise the memory read-modify-write (+ DB writes) across
        # overlapping arcface tasks so two of them can't both miss-then-record
        # the same person. Detection (the CPU-heavy to_thread above) already
        # ran outside the lock, so parallelism where it matters is preserved.
        async with self._arcface_lock:
            for f in faces:
                entry = self.face_memory.lookup(f.embedding, now)

                if entry is None:
                    # Шинэ хүн, эсвэл цонх нь дууссан хүн → нотлох баримт бичнэ.
                    # Алдаа гарсан ч alert зам ҮРГЭЛЖИЛНЭ: crop upload унасан
                    # гэдэг нь хяналтын жагсаалтын хүнийг чимээгүй алгасах
                    # шалтгаан биш (өмнө нь яг тэгдэг байсан).
                    face_id: str | None = None
                    screenshot_path: str | None = None
                    ttl: float | None = None
                    try:
                        face_id, screenshot_path = await self._persist_face(frame, f, now)
                    except Exception as e:  # noqa: BLE001 — тодорхой бүртгэнэ
                        log.exception("Нүүр хадгалахад алдаа (alert зам үргэлжилнэ): %s", e)
                        # Богино TTL: Storage сэргэмэгц нотлох баримт эргэж
                        # бичигдэнэ, гэхдээ секунд тутмын давталт үүсгэхгүй.
                        ttl = self.face_memory.recheck_sec
                    entry = self.face_memory.remember(
                        f.embedding, now, face_id, screenshot_path, ttl_sec=ttl
                    )
                    should_check = True
                else:
                    # Цонхны дотор — шинэ мөр бичихгүй. Гэхдээ suspect тааралтыг
                    # тогтмол давтаж alert давхаргад (dedup цонх, burst,
                    # чимээгүй цаг) шийдэх боломж өгнө.
                    should_check = self.face_memory.needs_recheck(entry, now)

                if not should_check:
                    continue
                self.face_memory.mark_checked(entry, now)
                try:
                    await self._match_and_alert(
                        f.embedding, entry.face_id, entry.screenshot_path, now
                    )
                except Exception as e:  # noqa: BLE001 — нэг alert-ын алдаа
                    # үлдсэн нүүрнүүдийг таслах ёсгүй (өмнө нь task бүхэлдээ
                    # унаж, хаана ч бүртгэгддэггүй байсан).
                    log.exception("Alert бичихэд алдаа: %s", e)

    def _note_detect_failure(self, error: Exception) -> None:
        """Detection алдааг харагдуулна: эхнийх нь болон дараа нь тогтмол
        давтамжтайгаар warning бичнэ (лог дүүргэхгүйгээр)."""
        self._detect_failures = getattr(self, "_detect_failures", 0) + 1
        if self._detect_failures == 1 or self._detect_failures % _DETECT_FAILURE_LOG_EVERY == 0:
            log.warning(
                "Камер %s: нүүр илрүүлэлт %d удаа дараалан амжилтгүй — alert зам "
                "хараагүй байна: %s",
                self.camera_id, self._detect_failures, error,
            )

    def _note_detect_success(self) -> None:
        if getattr(self, "_detect_failures", 0):
            log.info(
                "Камер %s: нүүр илрүүлэлт сэргэлээ (%d алдааны дараа)",
                self.camera_id, self._detect_failures,
            )
            self._detect_failures = 0

    async def _persist_face(
        self, frame: np.ndarray, f: DetectedFace, now: float
    ) -> tuple[str | None, str | None]:
        """Нэг нүүрийг битүүмжилж хадгалаад (face_id, storage path) буцаана.

        Амжилтгүй бол exception шидэж, ЯМАРЧ тохиолдолд plaintext crop
        бичихгүй (ADR 0009 / Tier 2 encrypt-only).
        """
        x1, y1, x2, y2 = map(int, f.bbox)
        crop = frame[max(0, y1):y2, max(0, x1):x2]
        ok, crop_bytes = cv2.imencode(".jpg", crop)
        if not ok:
            raise ValueError("crop JPEG encode амжилтгүй")
        if not self.storage.client:
            raise RuntimeError("Supabase client тохируулагдаагүй — нүүр хадгалагдахгүй")

        h, w = frame.shape[:2]
        bbox = {
            "x": max(0.0, x1 / w),
            "y": max(0.0, y1 / h),
            "w": (x2 - x1) / w,
            "h": (y2 - y1) / h,
        }

        filename = f"{self.camera_id}_{int(now * 1000)}_{uuid.uuid4().hex[:8]}.jpg"
        path = f"{self.camera_id}/{filename}"

        # ── Hierarchical key seal (ADR 0009 / Tier 2: encrypt-only) ──
        # Seal this face's embedding AND crop pixels with the per-face
        # chain key K_index, then upload ONLY the sealed crop at
        # `<path>.enc`. The plain crop is intentionally NOT written —
        # no plaintext face image is persisted at rest. Display sites
        # fetch it through /api/faces/[id]/secure-crop, which proxies
        # the ML decryption gated by the requester's reveal_level.
        #
        # The chain index is consumed even if the seal fails, so a
        # concurrent face never derives the same key.
        chain_index = self._face_chain_index
        self._face_chain_index += 1
        k = key_at_index(self.recording_id, chain_index, master_key())
        emb_bytes = np.asarray(f.embedding, dtype=np.float32).tobytes()
        embedding_sealed = base64.b64encode(_seal_embedding(emb_bytes, k)).decode()
        sealed_crop = _seal_embedding(crop_bytes.tobytes(), k)
        self.storage.upload_bytes(
            "faces", f"{path}.enc", sealed_crop, "application/octet-stream"
        )

        face_id = await self.storage.insert_face(
            filename=filename,
            image_path=path,
            embedding=f.embedding.tolist(),
            camera_id=self.db_camera_id,
            recording_id=self.recording_id if self._row_inserted else None,
            bbox=bbox,
            chain_index=chain_index,
            embedding_sealed=embedding_sealed,
            crop_sealed=True,
        )
        return face_id, path

    async def _match_and_alert(
        self,
        embedding: np.ndarray,
        face_id: str | None,
        screenshot_path: str | None,
        now: float,
    ) -> None:
        """Suspect тааралт → alert. Дуудагч нь exception-ыг барина."""
        matches = await self.storage.match_suspects(
            embedding.tolist(), threshold=ALERT_THRESHOLD, limit=1
        )
        if not matches:
            return
        m = matches[0]
        # Coerce similarity once: the PostgREST RPC can return it as a
        # string or None, which would crash the "%.2f" logger
        # ("must be real number, not str") and corrupt the alert row.
        try:
            sim = float(m["similarity"])
        except (TypeError, ValueError):
            sim = 0.0
        # A suspect with a zero / corrupt embedding yields NaN cosine
        # similarity from the RPC and would "match" every face.
        if not math.isfinite(sim) or sim < ALERT_THRESHOLD:
            log.warning(
                "Suspect %s: non-finite or sub-threshold similarity (%r) — ignored",
                m.get("id"), m.get("similarity"),
            )
            return

        last = self.last_alert_at.get(m["id"], 0)
        if now - last < ALERT_COOLDOWN_SEC:
            return
        # Cooldown-ыг оролдлогын өмнө тавина: DB унасан ч секунд тутам
        # дахин цохихгүй. Үр дүнг доор яг байгаагаар нь бүртгэнэ.
        self.last_alert_at[m["id"]] = now

        outcome = await self.storage.insert_alert(
            suspect_id=m["id"],
            suspect_name=m["name"],
            face_id=face_id,
            similarity=sim,
            screenshot_path=screenshot_path,
            camera_id=self.db_camera_id,
            camera_name=self.camera_name,
        )
        if outcome == "inserted":
            log.warning("🚨 ALERT: %s (%.2f)", m["name"], sim)
        elif outcome == "merged":
            log.info("🔁 ALERT нэгтгэв (dedup цонх): %s (%.2f)", m["name"], sim)
        else:
            # quiet_hours / burst_pending / no_client — storage давхарга
            # шалтгааныг бичсэн; энд «alert гарсан» гэж ХЭЛЭХГҮЙ.
            log.info("ALERT гараагүй (%s): %s (%.2f)", outcome, m["name"], sim)
