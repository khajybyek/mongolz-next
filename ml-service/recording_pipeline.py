"""
RecordingSession — нэг камерны "masked-live + saved-blurred + original" pipeline.

Урсгал
------
RTSP/Webcam frame
   ├─→ HLS (face-masked, live view-нд)
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
import stat
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

# Korea Standard Time (UTC+9) — filename болон video overlay-д хэрэглэнэ
KST = timezone(timedelta(hours=9))
from pathlib import Path
from typing import TYPE_CHECKING, Callable

import cv2
import numpy as np

from urllib.parse import urlsplit, urlunsplit

from crypto_utils import master_key
from recording_spool import get_recording_spool
from capture_integrity import close_encoder, validate_capture, SourceSampler
from capture_journal import write_journal, check_capture_capacity
from demo_source import is_demo_url, resolve_demo_source
from face_masker import FaceMasker
from hierarchical_keys import key_at_index, encrypt_face as _seal_embedding
from privacy_protection import PRIVACY_SCHEDULE_PAD_SEC
from privacy_schedule import PrivacyScheduleCache, PrivacySpanNotFound, get_privacy_schedule_cache


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


def open_video_capture(source: str | int):
    """Use FFmpeg explicitly for network sources with bounded open/read calls.

    OpenCV's automatic backend fallback may hand an HTTPS MJPEG URL to the
    image-sequence backend, which both fails incorrectly and can echo embedded
    credentials. Local files, demo clips and numeric devices keep auto mode.
    """
    if isinstance(source, str) and "://" in source:
        return cv2.VideoCapture(
            source,
            cv2.CAP_FFMPEG,
            [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000],
        )
    return cv2.VideoCapture(source)

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


def _env_seconds(name: str, default: float, floor: float) -> float:
    """Positive-seconds env override that never takes the service down."""
    try:
        return max(floor, float(os.getenv(name, "") or default))
    except (TypeError, ValueError):
        return default


# Capture heartbeat — «frames are still arriving on this camera».
#
# The status dots on /grid, /wall and /cameras used to be derived purely from
# the newest FACE detection, so a working camera watching an empty corridor
# read as «offline» after 30 minutes (audit: camera_health lies). The capture
# loop is the only component that knows whether frames are arriving, so it
# says so itself: every CAMERA_HEARTBEAT_SEC of successful reads it stamps
# public.camera_sessions.last_heartbeat_at, and camera_health() derives
# liveness from that stamp instead of from detections.
#
# camera_health() calls a camera healthy while the last beat is under 90 s
# old, so this interval must stay comfortably below that.
CAMERA_HEARTBEAT_SEC = _env_seconds("CAMERA_HEARTBEAT_SEC", 30.0, 5.0)

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
# Masked live HLS: when full-resolution masking cannot keep up with a live
# source (1080p Haar alone is ~125 ms/frame on one core, the budget at
# 15 fps is 66 ms), the capture falls further and further behind real time.
# Beyond this lag the HLS writer repeats the PREVIOUS MASKED frame instead of
# masking the new one, until the loop has caught up. Never an unmasked frame:
# a held slot shows slightly stale, already-masked pixels. The encrypted
# original still receives every frame. Downscaling the Haar pass instead was
# measured to lose ~25% of 60-90 px faces at 1080p — a privacy regression.
LIVE_MASK_LAG_SEC = _env_seconds("LIVE_MASK_LAG_SEC", 0.5, 0.1)
_LAG_LOG_EVERY_SEC = 60.0
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
    # The object that was ACTUALLY written for this face: the sealed crop
    # `<image_path>.enc` in the `faces` bucket (Tier 2 is encrypt-only — no
    # plaintext crop is persisted). Kept for logging/diagnostics only; the
    # alert row points at the face ROW (`face_id`), never at a storage path,
    # so every reader resolves the crop through /api/faces/[id]/secure-crop.
    crop_path: str | None = None


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
        crop_path: str | None,
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
            crop_path=crop_path,
        )
        self._entries.append(entry)
        self.prune(now)
        return entry

    def needs_recheck(self, entry: SeenFace, now: float) -> bool:
        return (now - entry.checked_at) >= self.recheck_sec

    @staticmethod
    def mark_checked(entry: SeenFace, now: float) -> None:
        entry.checked_at = now


# ── Capture-time privacy spans (ADR 0012) ─────────────────────
# A span is a stretch of ONE recording segment captured in `private` mode
# (face recognition off, never revealable). Offsets are seconds of the
# segment's own video timeline — the same timeline as faces.time_in_video_sec
# and the reveal job's frame_time_sec.
#
# Retry spacing for span writes that failed (DB down, or the recording row not
# delivered yet). The capture loop never waits for these writes.
PRIVACY_SPAN_RETRY_SEC = _env_seconds("PRIVACY_SPAN_RETRY_SEC", 5.0, 0.5)
# How long stop/finalize waits for the last span writes.
PRIVACY_SPAN_FLUSH_TIMEOUT_SEC = 10.0
_PRIVACY_SPAN_LOG_EVERY_SEC = 60.0

# Capture-clock bound for the privacy decision (ADR 0012). A live frame's
# capture instant is not known exactly: the source (PTS) clock is anchored to
# the wall clock when the source opens and at every segment rotation, then
# runs on its own (a slow or nominal-fps camera clock drifts), and frames can
# be buffered before they reach the loop. So every live tick is judged over
# [min(estimate, now) - PRIVACY_CLOCK_MARGIN_SEC, now] — `now` (the wall clock
# when the frame is processed) can never be earlier than the capture — and is
# private if ANY instant of that range is. The start of a private window can
# therefore never be identified, at the price of recognition resuming a few
# seconds after a private window ends.
PRIVACY_CLOCK_MARGIN_SEC = _env_seconds("PRIVACY_CLOCK_MARGIN_SEC", 5.0, 0.0)
_PRIVACY_CLOCK_LOG_EVERY_SEC = 300.0


@dataclass(eq=False)
class PrivacySpan:
    recording_id: str
    start: float
    source: str                 # 'schedule' | 'fail_closed'
    end: float | None = None
    db_id: int | None = None    # recording_privacy_spans.id once inserted
    close_saved: bool = False   # end_offset_sec persisted
    in_flight: bool = False     # a write for this span is running
    dropped: bool = False       # its recording row was deleted meanwhile
    # recording_privacy_spans.client_span_id — the idempotency key of every
    # write of this span (live open retries, spool delivery, recovery).
    client_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def as_manifest(self) -> dict:
        return {
            "client_span_id": self.client_id,
            "start_offset_sec": self.start,
            "end_offset_sec": self.end,
            "source": self.source,
        }

    @property
    def needs_write(self) -> bool:
        if self.dropped:
            return False
        return self.db_id is None or (self.end is not None and not self.close_saved)


class PrivacySpanLedger:
    """Per-session span bookkeeping, fed once per ArcFace tick.

    Rules (ADR 0012):
      * private and no open span in this segment → open one at the PREVIOUS
        tick's offset (0 at the segment start): the switch happened somewhere
        between the two ticks, so the boundary is covered conservatively;
      * standard while a span is open → close it at the current offset;
      * a ``fail_closed`` tick inside a span makes the span ``fail_closed``;
      * segment rotation / finalize → ``close_segment`` at the final offset;
        the next segment's first tick (offset 0) re-opens if still private.

    Writes happen in ``flush`` (off the event loop, via asyncio.to_thread);
    a span stays in memory until the DB has acknowledged it, so a missing
    recording row or a DB outage only delays persistence. Every span also
    travels with its segment: ``manifest_spans`` goes into the validated
    capture journal and the spool manifest at finalize, and the delivery
    upserts them (keyed by ``client_id``) before the row becomes ready — so a
    session that ends before the DB is back loses nothing.
    """

    MIN_SPAN_SEC = 1e-3  # end_offset_sec > start_offset_sec (DB CHECK)

    def __init__(self) -> None:
        self.spans: list[PrivacySpan] = []  # not yet fully persisted (+ the open one)
        self.open: PrivacySpan | None = None
        self.prev_tick = 0.0
        self.retry_at = 0.0
        self.task: asyncio.Task | None = None
        self.failures = 0
        self._logged_at = 0.0
        # Every span of a segment not yet handed to the spool (persisted or
        # not) — the segment's delivery carries them.
        self.by_recording: dict[str, list[PrivacySpan]] = {}
        # Segments whose delivery manifest carries their spans.
        self.handed_off: set[str] = set()

    def _add(self, span: PrivacySpan) -> PrivacySpan:
        self.spans.append(span)
        self.by_recording.setdefault(span.recording_id, []).append(span)
        return span

    def manifest_spans(self, recording_id: str) -> list[dict]:
        """The segment's spans for its delivery manifest / capture journal."""
        return [s.as_manifest() for s in self.by_recording.get(recording_id, []) if not s.dropped]

    def hand_off(self, recording_id: str) -> None:
        """The segment's manifest (with its spans) is durable on disk."""
        self.handed_off.add(recording_id)
        self.by_recording.pop(recording_id, None)

    def _close(self, span: PrivacySpan, end: float) -> None:
        span.end = end if end > span.start else span.start + self.MIN_SPAN_SEC
        if not any(s is span for s in self.spans):
            self.spans.append(span)

    def tick(self, recording_id: str, offset: float, mode: str, source: str) -> None:
        start, self.prev_tick = self.prev_tick, offset
        span = self.open
        if span is not None and span.recording_id != recording_id:
            # The segment changed without close_segment (should not happen):
            # leave that span open — readers treat it as "until the end of the
            # recording", which is where it really ended.
            self.open = span = None
        if mode == "private":
            wanted = "fail_closed" if source == "fail_closed" else "schedule"
            if span is None:
                self.open = self._add(PrivacySpan(recording_id, start, wanted))
            elif wanted == "fail_closed" and span.source != "fail_closed":
                if span.db_id is None and not span.in_flight:
                    span.source = "fail_closed"
                else:
                    # Already persisted as 'schedule': cover the whole stretch
                    # with a fail_closed span and retire the old one here.
                    self._close(span, offset)
                    self.open = self._add(PrivacySpan(recording_id, span.start, "fail_closed"))
        elif span is not None:
            self._close(span, offset)
            self.open = None

    def close_segment(self, recording_id: str, final_offset: float) -> None:
        span = self.open
        if span is not None and span.recording_id == recording_id:
            self._close(span, final_offset)
            self.open = None
        self.prev_tick = 0.0

    def has_work(self) -> bool:
        return any(s.needs_write for s in self.spans)

    def pending(self) -> list[PrivacySpan]:
        return [s for s in self.spans if s.needs_write]

    def _prune(self) -> None:
        self.spans = [s for s in self.spans if s.needs_write or s is self.open]

    async def flush(self, storage, *, row_ready: Callable[[str], bool], camera_id: str = "?") -> bool:
        """Persist pending spans in order. A failure blocks only the rest of
        that recording's spans (e.g. its row is not delivered yet). Returns
        True when nothing is left to write."""
        blocked: set[str] = set()
        while True:
            span = next(
                (s for s in self.spans if s.needs_write and s.recording_id not in blocked and not s.in_flight),
                None,
            )
            if span is None:
                break
            if not row_ready(span.recording_id):
                blocked.add(span.recording_id)
                continue
            span.in_flight = True
            try:
                if span.db_id is None:
                    # Upsert on the span's client id: a retry after a lost
                    # response finds the row the first attempt committed.
                    span.db_id = int(await asyncio.to_thread(
                        storage.open_privacy_span, span.recording_id, span.start, span.source,
                        span.client_id,
                    ))
                else:
                    await asyncio.to_thread(storage.close_privacy_span, span.db_id, span.end)
                    span.close_saved = True
                self.failures = 0
            except PrivacySpanNotFound:
                # The recording (and its spans) was deleted meanwhile.
                log.warning("camera %s: privacy span of recording %s vanished — dropped",
                            camera_id, span.recording_id)
                span.dropped = True
            except Exception as exc:  # noqa: BLE001 — retried; never stops capture
                blocked.add(span.recording_id)
                self.failures += 1
                now = time.monotonic()
                if self.failures == 1 or now - self._logged_at >= _PRIVACY_SPAN_LOG_EVERY_SEC:
                    self._logged_at = now
                    log.warning(
                        "camera %s: privacy span write for recording %s failed (%s) — kept in memory, retrying",
                        camera_id, span.recording_id, type(exc).__name__,
                    )
            finally:
                span.in_flight = False
        self._prune()
        return not self.has_work()


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
            "-g", str(max(1, int(round(fps * 2)))), "-keyint_min", str(max(1, int(round(fps * 2)))), "-sc_threshold", "0",
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
        recording_id: str | None = None,
        finalize_on_stop: bool = True,
        privacy_cache: PrivacyScheduleCache | None = None,
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
        Path(self.rec_dir).mkdir(parents=True, exist_ok=True, mode=0o700)
        # Owner-only (0o700): plaintext frames sit here until they are sealed.
        # Spelled with the stat constant because Semgrep's insecure-file-
        # permissions rule flags every numeric mode >= 0o650, 0o700 included.
        os.chmod(self.rec_dir, stat.S_IRWXU)

        # Filename timestamp KST-аар үүсгэнэ (UTC биш) — хэрэглэгч KST-аар хардаг
        ts = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
        # Recording UUID-ыг session-ийн эхэнд үүсгэнэ — encryption key
        # derivation-д ашиглана. Storage path-д бас оруулж encrypted блоб-уудыг
        # тэмдэглэх боломжтой болгоё.
        self.recording_id: str = str(uuid.UUID(recording_id)) if recording_id else str(uuid.uuid4())

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
        self.capture_started_at = self.started_at
        self.finalize_on_stop = finalize_on_stop
        self._stop_lock = asyncio.Lock()
        self.input_complete = False
        self.processing_complete = False
        self.capture_time_sec = 0.0
        self.source_duration_sec = 0.0
        self.total_frames = 0
        self.segment_duration_sec = min(300, _env_seconds("RECORDING_SEGMENT_SECONDS", 120, 1))
        self._segment_start_sec = 0.0
        self._is_file_mode = False
        self._encoder_error = None
        self._validated = False
        self._last_capacity_check = 0.0
        # Live-lag guard state (see LIVE_MASK_LAG_SEC).
        self._lag_guard = False
        # Backlog measured (baseline + live_lag_sec) even when frames are
        # never held: baked and demo sources too — the rotation re-anchor
        # needs it (ADR 0012).
        self._lag_measured = False
        self._live_origin = 0.0
        self._lag_baseline: float | None = None
        self._last_masked: np.ndarray | None = None
        self.live_lag_sec = 0.0
        self.held_frames = 0
        self._lag_logged_at = 0.0
        self._hold_streak = 0
        self._hold_streak_lag = 0.0
        # True once the source opened. A session whose source never opened
        # captured, journaled and inserted nothing, so stopping it is a clean
        # no-op rather than a finalize failure (see _finish_stop).
        self._source_opened = False

        # ── Capture heartbeat state (see CAMERA_HEARTBEAT_SEC) ──
        # Enabled inside the loop, and only for a LIVE camera with a real
        # camera_sessions row: a browser upload being processed in file mode
        # must never make its camera look like it is streaming.
        self._heartbeat_enabled = False
        self._last_beat_at = 0.0            # time.monotonic() of the last beat
        self._beat_task: asyncio.Task | None = None

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
        # Serialises cap.read() (which runs in a worker thread) with
        # cap.release(): a capture task cancelled while a read is in flight
        # must not free the VideoCapture under that thread.
        self._cap_lock = threading.Lock()
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
        # Loaded off the event loop at the start of _run (a synchronous
        # PostgREST call here stalled every other capture and HTTP handler).

        # Жинхэнэ видео уртыг хадгалах (frame_idx / output_fps).
        # File mode-д ended_at - started_at нь processing time-ыг агуулдаг тул
        # бичлэгийн жинхэнэ урт тэрнийг ашигладаггүй.
        self.recorded_frames: int = 0

        # Privacy schedule (ADR 0012), evaluated at every ArcFace tick for the
        # frame's capture time. None = the process-wide cache.
        # privacy_mode is reported by /camera/active (None until the first tick).
        self.privacy_cache = privacy_cache
        self.privacy_mode: str | None = None
        self.privacy_source: str | None = None
        self._privacy_ledger = PrivacySpanLedger()
        # Widest capture-clock bound (seconds) seen at a tick, and when a
        # bound wider than the reveal/view schedule pad was last logged.
        self.capture_clock_bound_sec = 0.0
        self._clock_logged_at = 0.0
        # Serialises recordings-row inserts (rotation, face persist and the
        # privacy span flush can all retry it).
        self._row_open_lock = asyncio.Lock()

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
    # Capture heartbeat
    # ────────────────────────────────────────────
    def beat_if_due(self, now: float | None = None) -> bool:
        """Stamp ``camera_sessions.last_heartbeat_at`` if a beat is due.

        Called only after a sampled frame was accepted by both required
        encoder pipes. A broken/exited encoder stops this heartbeat; readable
        output is separately verified before a segment becomes ready.

        Non-blocking by construction: the write is a PostgREST round trip, so
        it runs as a background task and at most ONE is ever in flight. A beat
        that cannot be written is skipped, never retried into a queue — the
        next frame is 1/fps away and will try again.

        Returns True when this call scheduled a beat (used by the tests).
        """
        if not self._heartbeat_enabled or not self.db_camera_id:
            return False
        now = time.monotonic() if now is None else now
        if (now - self._last_beat_at) < CAMERA_HEARTBEAT_SEC:
            return False
        if self._beat_task is not None and not self._beat_task.done():
            # Previous beat still in flight (slow DB) — do not pile up.
            return False
        self._last_beat_at = now
        self._beat_task = asyncio.create_task(self._write_heartbeat())
        return True

    async def _write_heartbeat(self) -> None:
        camera_id = self.db_camera_id
        if not camera_id:
            return
        try:
            await asyncio.to_thread(
                self.storage.heartbeat_camera_session, camera_id, getattr(self, "total_frames", self.recorded_frames)
            )
        except Exception as e:  # noqa: BLE001 — a missed beat is not an outage
            log.debug("camera %s: heartbeat skipped (%s)", self.camera_id, type(e).__name__)

    async def _stop_heartbeat(self) -> None:
        """Let an in-flight beat finish (briefly) so shutdown leaves no
        orphaned task, and stop scheduling new ones."""
        self._heartbeat_enabled = False
        task, self._beat_task = self._beat_task, None
        if task is None or task.done():
            return
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=2)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            task.cancel()
        except Exception:  # noqa: BLE001 — already logged inside the task
            pass

    # ────────────────────────────────────────────
    # Privacy schedule (ADR 0012)
    # ────────────────────────────────────────────
    @property
    def privacy_spans(self) -> PrivacySpanLedger:
        # Lazily created so sessions built without __init__ (tests) work too.
        ledger = self.__dict__.get("_privacy_ledger")
        if ledger is None:
            ledger = self.__dict__["_privacy_ledger"] = PrivacySpanLedger()
        return ledger

    async def _privacy_mode_at(self, captured_at: datetime) -> tuple[str, str]:
        """Privacy mode of a frame captured at ``captured_at``."""
        return await self._privacy_mode_between(captured_at, captured_at)

    async def _privacy_mode_between(self, lower: datetime, upper: datetime) -> tuple[str, str]:
        """Privacy mode of a frame captured at some instant of [lower, upper]:
        private if ANY instant of it is private (see PRIVACY_CLOCK_MARGIN_SEC).

        No DB camera (browser uploads, ad-hoc ids) → standard. Never raises:
        an unexpected error fails closed (private)."""
        camera_id = getattr(self, "db_camera_id", None)
        if not camera_id:
            return "standard", "none"
        try:
            cache = getattr(self, "privacy_cache", None) or get_privacy_schedule_cache()
            during = getattr(cache, "mode_during", None)
            if during is not None:
                return await during(camera_id, lower, upper)
            # A cache without range support: private if either end is.
            answers = [await cache.mode_at(camera_id, lower)]
            if upper != lower:
                answers.append(await cache.mode_at(camera_id, upper))
            for wanted in ("fail_closed", "schedule", "none"):
                for mode, source in answers:
                    if mode == "private" and source == wanted:
                        return mode, source
            return answers[-1]
        except Exception as exc:  # noqa: BLE001 — unknown ⇒ private
            log.warning("camera %s: privacy mode evaluation failed (%s) — failing closed",
                        self.camera_id, type(exc).__name__)
            return "private", "fail_closed"

    def _reanchor_capture_clock(
        self, source_sec: float, *, arrived_at: datetime | None = None, backlog: float | None = None,
    ) -> None:
        """Re-anchor the source clock to the wall clock: the frame at
        ``source_sec`` reached the loop at ``arrived_at`` (default: now) after
        waiting ``backlog`` seconds in the source's buffer (default: the
        backlog measured now). Called when a live source opens and at every
        rotation, so the suspect-cache load, the schedule warm-up and the open
        itself no longer stamp frames early, and a source clock that runs fast
        cannot carry its drift beyond one segment."""
        if backlog is None:
            backlog = self._live_backlog_sec(source_sec)
        at = arrived_at if arrived_at is not None else datetime.now(timezone.utc)
        self.capture_started_at = at - timedelta(seconds=source_sec + max(0.0, backlog))

    def _live_backlog_sec(self, source_sec: float) -> float:
        """How long the frame at ``source_sec`` waited before the loop saw it,
        measured now: monotonic time since the live origin minus the source
        time, minus the connect baseline (see _should_hold, which keeps the
        baseline for every live and demo source). Before the first measured
        frame: the last measured lag (0 at the source open)."""
        baseline = getattr(self, "_lag_baseline", None)
        if baseline is None:
            return max(0.0, float(getattr(self, "live_lag_sec", 0.0) or 0.0))
        behind = time.monotonic() - getattr(self, "_live_origin", 0.0) - source_sec
        return max(0.0, behind - baseline)

    def _capture_bounds(self, source_sec: float) -> tuple[datetime, datetime, datetime]:
        """``(estimate, lower, upper)`` of a frame's capture instant.

        File mode (browser uploads): the source clock is all there is, so the
        bound collapses to the estimate. Live: [min(estimate, now) - margin,
        now] — see PRIVACY_CLOCK_MARGIN_SEC."""
        estimate = self.capture_started_at + timedelta(seconds=source_sec)
        if getattr(self, "_is_file_mode", False):
            return estimate, estimate, estimate
        upper = datetime.now(timezone.utc)
        lower = min(estimate, upper) - timedelta(seconds=PRIVACY_CLOCK_MARGIN_SEC)
        bound = (upper - lower).total_seconds()
        if bound > getattr(self, "capture_clock_bound_sec", 0.0):
            self.capture_clock_bound_sec = bound
        if bound > PRIVACY_SCHEDULE_PAD_SEC:
            now = time.monotonic()
            if now - getattr(self, "_clock_logged_at", 0.0) >= _PRIVACY_CLOCK_LOG_EVERY_SEC:
                self._clock_logged_at = now
                log.warning(
                    "camera %s: capture-time bound %.1fs exceeds PRIVACY_SCHEDULE_PAD_SEC=%.0fs — "
                    "the pipeline stays conservative, the reveal/view schedule backstop is narrower",
                    self.camera_id, bound, PRIVACY_SCHEDULE_PAD_SEC,
                )
        return estimate, lower, upper

    def _note_privacy_tick(self, mode: str, source: str, offset: float) -> None:
        old_mode = getattr(self, "privacy_mode", None)
        old_source = getattr(self, "privacy_source", None)
        self.privacy_mode, self.privacy_source = mode, source
        first_standard = old_mode is None and mode == "standard"
        fail_closed_changed = old_mode is not None and (
            (source == "fail_closed") != (old_source == "fail_closed")
        )
        if (mode != old_mode and not first_standard) or fail_closed_changed:
            (log.warning if source == "fail_closed" else log.info)(
                "camera %s: privacy mode → %s (source=%s)", self.camera_id, mode, source,
            )
        # Masking stays on in both modes; only its identification part stops.
        masker = getattr(self, "masker", None)
        if masker is not None:
            masker.embeddings_allowed = mode == "standard"
        self.privacy_spans.tick(self.recording_id, offset, mode, source)
        self._schedule_privacy_flush()

    def _privacy_row_ready(self, recording_id: str) -> bool:
        # The current segment's row may not exist yet (inserted at finalize
        # after a failed open); earlier segments are attempted — their rows
        # arrive with the spool delivery, and a failed attempt is retried.
        return recording_id != self.recording_id or bool(getattr(self, "_row_inserted", False))

    def _schedule_privacy_flush(self, *, force: bool = False) -> asyncio.Task | None:
        """Start a background span flush if work is pending (one at a time,
        spaced by PRIVACY_SPAN_RETRY_SEC after a failed pass)."""
        ledger = self.privacy_spans
        if ledger.task is not None and not ledger.task.done():
            return ledger.task
        if not ledger.has_work():
            return None
        if not force and time.monotonic() < ledger.retry_at:
            return None
        ledger.task = asyncio.create_task(self._flush_privacy_spans())
        return ledger.task

    async def _flush_privacy_spans(self) -> None:
        ledger = self.privacy_spans
        rid = self.recording_id
        if (
            not getattr(self, "_row_inserted", False)
            and not getattr(self, "_delivery_enqueued", False)
            and any(s.recording_id == rid for s in ledger.pending())
        ):
            # In private mode no ArcFace task runs, so nothing else would
            # retry a recordings-row insert that failed at segment start.
            try:
                await self._open_recording_row()
            except Exception as exc:  # noqa: BLE001 — retried next pass
                log.debug("camera %s: recording row retry failed (%s)", self.camera_id, type(exc).__name__)
        try:
            done = await ledger.flush(self.storage, row_ready=self._privacy_row_ready,
                                      camera_id=str(self.camera_id))
        except Exception as exc:  # noqa: BLE001 — never stops the recording
            log.warning("camera %s: privacy span flush failed (%s)", self.camera_id, type(exc).__name__)
            done = False
        ledger.retry_at = 0.0 if done else time.monotonic() + PRIVACY_SPAN_RETRY_SEC

    def _privacy_close_segment(self) -> None:
        """Close the current segment's open span at its final offset."""
        ledger = self.__dict__.get("_privacy_ledger")
        if ledger is None:
            return
        if ledger.open is not None:
            fps = getattr(self, "fps", 0) or 0
            final = self.recorded_frames / fps if fps else ledger.open.start
            ledger.close_segment(self.recording_id, final)
        ledger.prev_tick = 0.0

    async def _settle_privacy_spans(self) -> None:
        """At stop: close the open span and give pending writes a bounded
        last chance. Never raises."""
        ledger = self.__dict__.get("_privacy_ledger")
        if ledger is None:
            return
        try:
            self._privacy_close_segment()
            deadline = time.monotonic() + PRIVACY_SPAN_FLUSH_TIMEOUT_SEC
            for _ in range(2):  # the pass in flight (if any), then one fresh pass
                task = self._schedule_privacy_flush(force=True)
                remaining = deadline - time.monotonic()
                if task is None or remaining <= 0:
                    break
                await asyncio.wait_for(asyncio.shield(task), remaining)
                if not ledger.has_work():
                    break
        except Exception as exc:  # noqa: BLE001 — includes the timeout
            log.warning("camera %s: privacy span settle interrupted (%s)", self.camera_id, type(exc).__name__)
        pending = ledger.pending()
        # Spans of a segment whose delivery manifest carries them are written
        # by the spool together with the recording row (before it is ready).
        carried = [s for s in pending if s.recording_id in ledger.handed_off]
        lost = [s for s in pending if s.recording_id not in ledger.handed_off]
        if carried:
            log.info(
                "camera %s: %d privacy span(s) travel with the queued delivery of %s",
                self.camera_id, len(carried), ", ".join(sorted({s.recording_id for s in carried})),
            )
        if lost:
            log.warning(
                "camera %s: %d privacy span write(s) not persisted for recording(s) %s "
                "(reveal still re-evaluates the schedule for that footage)",
                self.camera_id, len(lost), ", ".join(sorted({s.recording_id for s in lost})),
            )

    # ────────────────────────────────────────────
    # Lifecycle
    # ────────────────────────────────────────────
    async def start(self):
        self.task = asyncio.create_task(self._run())

    async def _close_writers(self, *, include_hls=True):
        failure = None
        names = ["blurred_writer", "original_writer"] + (["hls"] if include_hls else [])
        for name in names:
            proc = getattr(self, name, None)
            try:
                await asyncio.to_thread(close_encoder, proc)
            except RuntimeError as exc:
                failure = failure or exc
            finally:
                setattr(self, name, None)
        if failure:
            self._encoder_error = str(failure)
            raise failure

    @property
    def journal_path(self):
        return Path(self.rec_dir) / f"{self.recording_id}.capture.json"

    def _journal_active(self):
        if not self._is_file_mode:
            write_journal(self.journal_path, {
                "state": "active", "recording_id": self.recording_id,
                "sources": [self.original_path, self.blurred_path],
                # Recovery can describe an interrupted segment even when its
                # initial DB insert failed during an outage.
                "row": self._capture_row(),
            })

    def _capture_row(self):
        return {
            "filename": self.display_filename, "storage_path": self.filename_original,
            "duration_sec": None, "size_bytes": None, "encrypted": True,
            "has_original": False, "camera_id": self.db_camera_id,
            "camera_name": self.camera_name, "started_at": self.started_at.isoformat(),
            "ended_at": None, "original_path": None, "blur_strategy": self.blur_strategy,
            "capture_status": "capturing",
        }

    async def _mark_failed(self, reason, *, partial=False):
        self.exit_reason = reason
        self.processing_complete = False
        if self._row_inserted:
            await self.storage.update_recording(self.recording_id, {
                "capture_status": "partial" if partial else "failed",
                "capture_error": reason, "has_original": False,
                "ended_at": datetime.now(timezone.utc).isoformat(),
            })

    async def stop(self, *, finalize: bool | None = None):
        # The supervisor, user stop and shutdown may converge on one session.
        # Only one caller may close/commit its encoders at a time.
        async with self._stop_lock:
            await self._finish_stop(finalize=finalize)

    async def _finish_stop(self, *, finalize: bool | None = None):
        should_finalize = self.finalize_on_stop if finalize is None else finalize
        self.stop_flag.set()
        await self._stop_heartbeat()
        if self.task:
            try:
                await asyncio.wait_for(self.task, timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)
                self._encoder_error = "capture cancelled before completion"
            except Exception as exc:
                self._encoder_error = f"capture failed: {type(exc).__name__}"
        try:
            await self._close_writers()
            if self._never_opened():
                # Unreachable source (or missing demo clip): nothing was
                # recorded, journaled or inserted. Treating this as a finalize
                # failure made /camera/stop answer 500 forever and left the
                # dead session registered, so a later Start was a no-op.
                for path in (self.original_path, self.blurred_path):
                    Path(path).unlink(missing_ok=True)
                self.journal_path.unlink(missing_ok=True)
                return
            if not should_finalize:
                # Once handed off, the spool owns these inputs (a preparing
                # manifest may still need one). Cancellation must not unlink
                # them or undo a concurrent successful delivery.
                if self._delivery_enqueued or get_recording_spool().has_pending(self.recording_id):
                    return
                await self._mark_failed("capture interrupted before completion", partial=True)
                for path in (self.original_path, self.blurred_path):
                    Path(path).unlink(missing_ok=True)
                self.journal_path.unlink(missing_ok=True)
                return
            if self._encoder_error:
                raise RuntimeError(self._encoder_error)
            if self._is_file_mode and not self.input_complete:
                raise RuntimeError("source processing did not reach EOF")
            await self._finalize()
            self.processing_complete = self.input_complete and self._validated
        except Exception as exc:
            # Preserve a validated segment and its journal on encryption/disk
            # failure. It can still be committed by recovery. Invalid media
            # has no replay value and must not retain plaintext indefinitely.
            if not self._validated and not get_recording_spool().has_pending(self.recording_id):
                for path in (self.original_path, self.blurred_path):
                    Path(path).unlink(missing_ok=True)
            try:
                await self._mark_failed(f"capture finalization failed: {type(exc).__name__}")
                if not self._validated:
                    self.journal_path.unlink(missing_ok=True)
            except Exception:
                log.warning("Capture failure state pending for %s", self.recording_id)
            raise
        finally:
            shutil.rmtree(self.hls_dir, ignore_errors=True)
            await self._settle_privacy_spans()

    def _never_opened(self) -> bool:
        return (
            not getattr(self, "_source_opened", True)
            and not self._row_inserted
            and not self._delivery_enqueued
            and self.recorded_frames == 0
            and not get_recording_spool().has_pending(self.recording_id)
        )

    async def _finalize(self, *, deliver=True):
        # The segment ends here: close its privacy span at the final offset
        # (idempotent; spans are persisted by the flush, not by delivery).
        self._privacy_close_segment()
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
            duration = self.recorded_frames / self.fps
        else:
            duration = int((ended_at - self.started_at).total_seconds())

        def artifact_size(path: str) -> int | None:
            try:
                size = os.path.getsize(path)
                return size if size > 0 else None
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
                self._delivery_enqueued = self._validated = True
                return
            if self._delivery_enqueued:
                # The background worker already acknowledged this delivery.
                return
            raise RuntimeError("capture contains no media artifact")

        if getattr(self, "_encoder_error", None):
            raise RuntimeError(self._encoder_error)
        for artifact in ([self.original_path] + ([self.blurred_path] if self.blur_strategy == "baked" else [])):
            await asyncio.to_thread(validate_capture, artifact, self.recorded_frames, self.fps)
        self._validated = True
        ended_at = self.started_at + timedelta(seconds=duration)
        baked = self.blur_strategy == "baked"
        fields = {
            "capture_status": "ready",
            "capture_error": None,
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
        # ADR 0012: the segment's privacy spans travel with it (journal +
        # spool manifest), so its delivery writes them before the row is
        # ready even if the live span writes never got through.
        ledger = self.__dict__.get("_privacy_ledger")
        spans = ledger.manifest_spans(self.recording_id) if ledger is not None else []
        if hasattr(self, "rec_dir") and not self._is_file_mode:
            # Close+decode validation precedes the durable handoff marker.
            # fsync input files before committing their recoverable metadata.
            for artifact in artifacts:
                with open(artifact["source"], "rb") as source:
                    os.fsync(source.fileno())
            journal = {
                "state": "validated", "recording_id": self.recording_id,
                "row": fields, "artifacts": artifacts,
            }
            if spans:
                journal["privacy_spans"] = spans
            write_journal(self.journal_path, journal)
        await asyncio.to_thread(
            spool.enqueue, self.recording_id, fields, artifacts,
            **({"privacy_spans": spans} if spans else {}),
        )
        if ledger is not None and spans:
            ledger.hand_off(self.recording_id)
        if hasattr(self, "rec_dir"):
            self.journal_path.unlink(missing_ok=True)
        self._delivery_enqueued = True
        for path in (self.blurred_path, self.original_path):
            if artifact_size(path) is None:
                Path(path).unlink(missing_ok=True)
        delivered = await asyncio.to_thread(spool.deliver, self.storage, self.recording_id) if deliver else False
        if delivered:
            self._row_inserted = True
            log.info("Recording %s delivery complete", self.recording_id)
        else:
            log.warning("Recording %s encrypted and queued for delivery", self.recording_id)

    # ────────────────────────────────────────────
    # Main loop
    # ────────────────────────────────────────────
    async def _rotate_segment(self, source_sec: float, width: int, height: int):
        # The frame at source_sec reached the loop NOW. Closing the encoders
        # and finalizing the old segment (ArcFace drain, full-decode
        # validation, fsync, encryption) can block for many seconds, and the
        # source buffers frames meanwhile — so the re-anchor below uses the
        # arrival instant and the backlog measured here, never the time after
        # that stall (which would stamp the whole next segment late and move
        # the tick bound past the real capture instants; ADR 0012).
        arrived_at = datetime.now(timezone.utc)
        backlog = self._live_backlog_sec(source_sec)
        # Close the privacy span at the old segment's final offset; the new
        # segment's first tick (offset 0) re-opens one if still private.
        self._privacy_close_segment()
        await self._close_writers(include_hls=False)
        await self._finalize(deliver=False)
        self.recording_id = str(uuid.uuid4())
        # Re-anchor the capture clock (fast-clock drift never carries into
        # the next segment); started_at = the capture estimate of the
        # segment's frame 0.
        self._reanchor_capture_clock(source_sec, arrived_at=arrived_at, backlog=backlog)
        self.started_at = self.capture_started_at + timedelta(seconds=source_sec)
        ts = self.started_at.astimezone(KST).strftime("%Y%m%d_%H%M%S")
        stem = f"{ts}_{self.recording_id}"
        self.original_path = os.path.join(self.rec_dir, f"{stem}_original.mp4")
        self.blurred_path = os.path.join(self.rec_dir, f"{stem}_blurred.mp4")
        self.filename_original = f"{self.camera_id}/{stem}_original.mp4.enc"
        self.filename_blurred = f"{self.camera_id}/{stem}_blurred.mp4"
        self.display_filename = f"{ts}.mp4"
        self.recorded_frames = 0
        self._segment_start_sec = source_sec
        self._face_chain_index = 0
        self._row_inserted = self._delivery_enqueued = self._validated = False
        self.arcface_tasks = []
        # Every segment needs its own evidence keys and face rows.
        self.face_memory = SessionFaceMemory(self.engine.cosine)
        self._journal_active()
        await self._open_recording_row()
        self.original_writer = _ffmpeg_mp4_writer(self.original_path, width, height, self.fps)
        if self.blur_strategy == "baked":
            self.blurred_writer = _ffmpeg_mp4_writer(self.blurred_path, width, height, self.fps)

    async def _emit_frame(self, source_sec: float, source_frame):
        h, w = source_frame.shape[:2]
        if not self._is_file_mode and time.monotonic() - self._last_capacity_check >= 5:
            spool = get_recording_spool()
            await asyncio.to_thread(check_capture_capacity, str(Path(self.rec_dir).parent), spool.root)
            self._last_capacity_check = time.monotonic()
        if not self._is_file_mode and self.recorded_frames / self.fps >= self.segment_duration_sec:
            await self._rotate_segment(source_sec, w, h)
        offset = self.recorded_frames / self.fps
        tick = self.recorded_frames % max(1, round(self.fps)) == 0
        if tick:
            # ADR 0012: the camera's privacy schedule at CAPTURE time decides
            # whether frames may be used for identification. Evaluated before
            # masking: in `private` mode the masker places boxes with the
            # detector alone (no embedding, no watchlist tier lookup).
            # A live frame's capture instant is only known within a bound
            # (PRIVACY_CLOCK_MARGIN_SEC): private if any instant of it is.
            captured_at, lower, upper = self._capture_bounds(source_sec)
            mode, source = await self._privacy_mode_between(lower, upper)
            self._note_privacy_tick(mode, source, offset)
        original = source_frame.copy()
        # Every live viewer receives the privacy-filtered frame. The same
        # masking pass feeds the optional legacy baked recording so enabling
        # it does not double the detector cost. The encrypted original keeps
        # the unmasked pixels for an authorised, audited reveal path.
        masked = None
        if self.hls is not None or self.blur_strategy == "baked":
            if self._should_hold(source_sec, original.shape):
                # Behind real time: repeat the last MASKED frame for this
                # slot rather than fall further behind (never unmasked).
                masked = self._last_masked
            else:
                masked = await asyncio.to_thread(self.masker.mask, original.copy())
                self._draw_kst_timestamp(masked, self.recorded_frames)
                if self._lag_guard:
                    self._last_masked = masked
        if self.blur_strategy == "baked":
            self._write_safe(self.blurred_writer, masked)
        self._write_safe(self.hls, masked)
        self._draw_kst_timestamp(original, self.recorded_frames)
        self._write_safe(self.original_writer, original)
        if tick:
            self.arcface_tasks = [t for t in self.arcface_tasks if not t.done()]
            # `private` → no ArcFace task at all (no embeddings, face rows,
            # crops, suspect matching or alerts). Tasks started before a flip
            # finish: their frames were captured in standard mode.
            if mode == "standard":
                self.arcface_tasks.append(asyncio.create_task(
                    self._process_arcface(original, source_offset_sec=offset, captured_at=captured_at)
                ))
        self.recorded_frames += 1
        self.total_frames += 1
        self.capture_time_sec = source_sec
        self.beat_if_due()
        await asyncio.sleep(0)

    def _read_frame(self):
        with self._cap_lock:
            return self.cap.read()

    def _release_cap(self) -> None:
        with self._cap_lock:
            if self.cap is not None:
                self.cap.release()

    def _should_hold(self, source_sec: float, shape) -> bool:
        """True when the live loop lags real time by more than
        LIVE_MASK_LAG_SEC and a previous masked frame of the same size can be
        repeated. Only for live network sources writing the HLS stream in
        on_demand mode (a baked recording must mask every frame).

        The backlog itself (baseline + ``live_lag_sec``) is measured for every
        live and demo source, baked mode included, because every segment
        rotation re-anchors the capture clock from it (ADR 0012)."""
        guard = getattr(self, "_lag_guard", False) and self.blur_strategy != "baked"
        if not (guard or getattr(self, "_lag_measured", False)):
            return False
        behind = time.monotonic() - self._live_origin - source_sec
        if self._lag_baseline is None or behind < self._lag_baseline:
            # First frame: absorb the connect / buffering offset. Later, a
            # smaller offset (camera clock running fast) re-anchors downward.
            self._lag_baseline = behind
            self._hold_streak = 0
            return False
        lag = max(0.0, behind - self._lag_baseline)
        if not guard:
            # Measured, never held (baked must mask every frame; a demo
            # source is paced). Without holding, a backlog cannot be told
            # apart from a slow source clock, so both count as backlog and
            # the rotation anchor errs early — the side the privacy bound
            # tolerates.
            self.live_lag_sec = lag
            return False
        hold = (
            lag > LIVE_MASK_LAG_SEC
            and self._last_masked is not None
            and self._last_masked.shape == shape
        )
        if hold:
            # A genuine backlog drains while frames are held (holding is
            # cheap, so buffered frames arrive faster than real time and the
            # lag shrinks). Camera clock drift (a slow PTS clock, a nominal
            # MJPEG fps) does not: frames keep arriving in real time and the
            # lag never shrinks, which would freeze the stream on one frame
            # for the rest of the session. After ~2 s of held source time
            # without the lag shrinking, re-anchor the baseline instead.
            if self._hold_streak == 0:
                self._hold_streak_lag = lag
            self._hold_streak += 1
            if self._hold_streak >= max(1, round(self.fps * 2)):
                if lag >= self._hold_streak_lag - LIVE_MASK_LAG_SEC / 2:
                    self._lag_baseline = behind
                    self._hold_streak = 0
                    self.live_lag_sec = 0.0
                    return False
                self._hold_streak = 0  # draining: keep holding
        else:
            self._hold_streak = 0
        self.live_lag_sec = lag
        if hold:
            self.held_frames += 1
        now = time.monotonic()
        if hold and now - self._lag_logged_at >= _LAG_LOG_EVERY_SEC:
            self._lag_logged_at = now
            log.warning(
                "camera %s: masking behind real time by %.1fs — repeating masked frames (%d held so far)",
                self.camera_id, lag, self.held_frames,
            )
        return hold

    async def _run(self):
        await asyncio.to_thread(self._load_suspect_cache)
        if self.db_camera_id:
            # Warm the privacy schedule while the source opens, so the first
            # tick does not wait for (or fail closed on) the initial read.
            await self._privacy_mode_at(datetime.now(timezone.utc))
        shutil.rmtree(self.hls_dir, ignore_errors=True)
        os.makedirs(self.hls_dir, exist_ok=True)
        src = int(self.source_url) if isinstance(self.source_url, str) and self.source_url.isdigit() else self.source_url
        is_demo = is_demo_url(self.source_url)
        if is_demo:
            try:
                src = await asyncio.to_thread(resolve_demo_source, self.source_url)
            except Exception as exc:
                self.exit_reason = f"demo source unavailable: {type(exc).__name__}"
                self._encoder_error = self.exit_reason
                return
        self._is_file_mode = not is_demo and isinstance(src, str) and "://" not in src and os.path.isfile(src)
        # Off the loop: opening an unreachable RTSP/MJPEG source blocks for
        # the full 5 s connect timeout, which froze the whole ML API.
        self.cap = await asyncio.to_thread(open_video_capture, src)
        if not self.cap.isOpened():
            self.exit_reason = "source unreachable at open"
            self._encoder_error = self.exit_reason
            self.cap.release()
            return
        w, h = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        input_fps = self.cap.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(input_fps) or input_fps <= 0:
            input_fps = self.fps
        self.fps = min(input_fps, 15.0) if self._is_file_mode else float(self.fps)
        self.source_duration_sec = self.cap.get(cv2.CAP_PROP_FRAME_COUNT) / input_fps if self._is_file_mode else 0
        self._source_opened = True
        if not self._is_file_mode:
            # Frame 0 (source time 0) is captured about now — not when
            # __init__ ran before the suspect load, schedule warm-up and open.
            self._reanchor_capture_clock(0.0)
            self.started_at = self.capture_started_at
        self._journal_active()
        await self._open_recording_row()
        self._heartbeat_enabled = not self._is_file_mode and bool(self.db_camera_id)
        sampler = SourceSampler(input_fps, self.fps)
        input_index = 0
        read_failures = demo_reopens = 0
        demo_due = time.monotonic()
        live_origin = demo_due
        self._live_origin = live_origin
        self._lag_guard = not self._is_file_mode and not is_demo
        self._lag_measured = not self._is_file_mode
        try:
            if not self._is_file_mode:
                self.hls = _ffmpeg_hls_writer(self.hls_dir, w, h, self.fps)
            if self.blur_strategy == "baked":
                self.blurred_writer = _ffmpeg_mp4_writer(self.blurred_path, w, h, self.fps)
            self.original_writer = _ffmpeg_mp4_writer(self.original_path, w, h, self.fps)
            while not self.stop_flag.is_set():
                # A stalling source blocks read() for up to its 5 s timeout;
                # run it off the loop. release() happens only after this loop
                # exits, so no read thread is ever inside cap.read() then.
                ok, frame = await asyncio.to_thread(self._read_frame)
                if not ok or frame is None:
                    if self._is_file_mode:
                        expected = self.cap.get(cv2.CAP_PROP_FRAME_COUNT)
                        if math.isfinite(expected) and expected > 0 and input_index < round(expected):
                            raise RuntimeError("source ended before all frames were decoded")
                        for ts, pending in sampler.finish():
                            await self._emit_frame(ts, pending)
                        self.input_complete = True
                        self.stop_flag.set()
                        break
                    if is_demo:
                        demo_reopens += 1
                        if demo_reopens > DEMO_REOPEN_LIMIT:
                            self.exit_reason = "demo source yields no frames"
                            break
                        self.cap.release()
                        self.cap = await asyncio.to_thread(open_video_capture, src)
                        if not self.cap.isOpened():
                            self.exit_reason = "demo source re-open failed"
                            break
                        continue
                    read_failures += 1
                    if read_failures >= LIVE_READ_FAIL_LIMIT:
                        self.exit_reason = "source dropped (no frames)"
                        break
                    await asyncio.sleep(0.1)
                    continue
                read_failures = demo_reopens = 0
                # File PTS preserves VFR intervals. Demo loops use a continuous
                # frame clock; live source PTS is normalized by the sampler.
                pts = input_index / input_fps if is_demo else self.cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
                fallback = None if self._is_file_mode or is_demo else time.monotonic() - live_origin
                for ts, sampled in sampler.push(frame, pts, fallback_sec=fallback):
                    await self._emit_frame(ts, sampled)
                input_index += 1
                if is_demo:
                    demo_due += 1 / input_fps
                    await asyncio.sleep(max(0, demo_due - time.monotonic()))
                else:
                    await asyncio.sleep(0)
            if not self._is_file_mode:
                for ts, pending in sampler.finish():
                    await self._emit_frame(ts, pending)
        except Exception as exc:
            self.exit_reason = f"capture failed: {type(exc).__name__}"
            if not self._validated:
                self._encoder_error = self.exit_reason
            self.stop_flag.set()
            log.exception("Capture loop crashed for camera %s", self.camera_id)
        finally:
            self._heartbeat_enabled = False
            # Waits for an in-flight read (bounded by the source's read
            # timeout) when the task was cancelled mid-read.
            self._release_cap()
            # stop/rotation performs the checked wait; close here so a crashed
            # loop cannot leave encoders waiting on stdin indefinitely.
            for proc in (self.hls, self.blurred_writer, self.original_writer):
                if proc and proc.stdin and not proc.stdin.closed:
                    try:
                        proc.stdin.close()
                    except (BrokenPipeError, OSError):
                        self._encoder_error = "capture encoder input failed"

    async def _open_recording_row(self) -> None:
        """Insert the recordings row at session start.

        Faces are sealed with keys derived from ``self.recording_id`` and must
        reference it via FK immediately; previously the row was inserted only
        at finalize and faces were back-linked by a camera+time window, which
        cross-linked concurrent browser uploads (all camera_id NULL) and lost
        the seal context entirely if finalize never ran.
        """
        lock = self.__dict__.get("_row_open_lock")
        if lock is None:
            lock = self.__dict__["_row_open_lock"] = asyncio.Lock()
        async with lock:
            if self._row_inserted:
                return  # a concurrent retry (span flush / face persist) won
            recording_id = self.recording_id
            try:
                rec_id = await self.storage.insert_recording_returning_id(
                    recording_id=recording_id,
                    **self._capture_row(),
                )
                if recording_id == self.recording_id:
                    self._row_inserted = bool(rec_id)
            except Exception as e:  # noqa: BLE001 — recording continues; finalize falls back to insert
                log.warning("recording row open failed (will insert at finalize): %s", e)
                if recording_id == self.recording_id:
                    self._row_inserted = False

    @staticmethod
    def _write_safe(proc: subprocess.Popen | None, frame: np.ndarray):
        if not proc or not proc.stdin:
            return
        try:
            if proc.poll() is not None:
                raise RuntimeError("capture encoder exited before input completed")
            proc.stdin.write(frame.tobytes())
        except (BrokenPipeError, OSError, ValueError) as exc:
            raise RuntimeError("capture encoder input failed") from exc

    # ────────────────────────────────────────────
    # ArcFace processing (periodic — DB-д тэмдэглэх + alert)
    # ────────────────────────────────────────────
    async def _process_arcface(self, frame: np.ndarray, *, source_offset_sec=None, captured_at=None):
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

        now = captured_at.timestamp() if captured_at is not None else time.time()
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
                    crop_path: str | None = None
                    ttl: float | None = None
                    try:
                        timing = {} if source_offset_sec is None else {
                            "source_offset_sec": source_offset_sec, "captured_at": captured_at,
                        }
                        face_id, crop_path = await self._persist_face(frame, f, now, **timing)
                    except Exception as e:  # noqa: BLE001 — тодорхой бүртгэнэ
                        log.exception("Нүүр хадгалахад алдаа (alert зам үргэлжилнэ): %s", e)
                        # Богино TTL: Storage сэргэмэгц нотлох баримт эргэж
                        # бичигдэнэ, гэхдээ секунд тутмын давталт үүсгэхгүй.
                        ttl = self.face_memory.recheck_sec
                    entry = self.face_memory.remember(
                        f.embedding, now, face_id, crop_path, ttl_sec=ttl
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
                    await self._match_and_alert(f.embedding, entry.face_id, now)
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
        self, frame: np.ndarray, f: DetectedFace, now: float, *, source_offset_sec=None, captured_at=None
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
        #
        # The seal key is derived from the recording id, so a face whose row
        # FK is NULL can never be decrypted again (secure-crop / reveal need
        # the id). If the row insert failed at segment start (transient DB
        # blip), retry it now; if it still fails, persist nothing — the
        # caller retries after a short TTL and no orphaned blob is left.
        if not self._row_inserted and not self._delivery_enqueued:
            await self._open_recording_row()
        if not self._row_inserted:
            raise RuntimeError("recording row unavailable — face not persisted")
        recording_id = self.recording_id
        chain_index = self._face_chain_index
        self._face_chain_index += 1
        k = key_at_index(recording_id, chain_index, master_key())
        emb_bytes = np.asarray(f.embedding, dtype=np.float32).tobytes()
        embedding_sealed = base64.b64encode(_seal_embedding(emb_bytes, k)).decode()
        sealed_crop = _seal_embedding(crop_bytes.tobytes(), k)
        # Storage upload off the event loop (it ran synchronously under
        # _arcface_lock and stalled capture for the whole round trip).
        await asyncio.to_thread(
            self.storage.upload_bytes, "faces", f"{path}.enc", sealed_crop, "application/octet-stream"
        )

        face_id = await self.storage.insert_face(
            filename=filename,
            image_path=path,
            embedding=f.embedding.tolist(),
            camera_id=self.db_camera_id,
            recording_id=recording_id,
            bbox=bbox,
            chain_index=chain_index,
            embedding_sealed=embedding_sealed,
            crop_sealed=True,
            detection_confidence=getattr(f, "confidence", None),
            source_offset_sec=source_offset_sec,
            detected_at=captured_at.isoformat() if captured_at is not None else None,
        )
        # Return the object that was actually uploaded. `path` itself is only
        # the DB pointer (faces.image_path); the bytes live at `<path>.enc`
        # and nothing plaintext exists at `path`. Handing the plain path on
        # was how alerts ended up referencing objects that do not exist.
        return face_id, f"{path}.enc"

    async def _match_and_alert(
        self,
        embedding: np.ndarray,
        face_id: str | None,
        now: float,
    ) -> None:
        """Suspect тааралт → alert. Дуудагч нь exception-ыг барина.

        The alert's evidence is the FACE ROW (``face_id``), never a storage
        path: since Tier 2 the only crop object is the sealed
        ``<image_path>.enc`` in the `faces` bucket, while
        ``alerts.screenshot_path`` is an `alert-screenshots` bucket path (see
        the backup manifest). Writing the plain crop path there produced a
        reference that resolved to nothing in any bucket — every alert
        screenshot in the UI was a dead link. Readers now go through
        /api/faces/[id]/secure-crop, which decrypts the sealed crop under the
        caller's reveal_level.
        """
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
            # No alert screenshot object is produced by this pipeline (see the
            # docstring). NULL is the honest value; face_id carries the crop.
            screenshot_path=None,
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
