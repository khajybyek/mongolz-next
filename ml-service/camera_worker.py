"""
CameraManager — олон камеруудын RecordingSession-уудыг удирдана.
Reveal job-уудыг async background-д явуулна.

Auto-resume + supervision
-------------------------
Every started camera is written to ``public.camera_sessions`` (source URL
sealed with the master key, never plaintext) so a redeploy / crash restart
brings the same cameras back (``resume_persisted``). A supervisor task
re-opens sessions whose capture loop ended without the user asking
(RTSP dropped, source unreachable, crash) with exponential backoff per
camera; ``/camera/stop`` is the only thing that clears ``auto_resume``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from recording_pipeline import RecordingSession, redact_url
from reveal_job import RevealProcessor
from storage import seal_camera_url, unseal_camera_url

if TYPE_CHECKING:
    from face_engine import FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.manager")

RECORDINGS_DIR = os.getenv("RECORDINGS_DIR", "/tmp/mongolz-recordings")

SUPERVISOR_INTERVAL_SEC = 30.0
BACKOFF_BASE_SEC = 5.0
BACKOFF_CAP_SEC = 300.0
# A session that has been up this long is considered healthy again: the
# backoff exponent resets so a later drop starts the schedule from 5 s.
HEALTHY_RESET_SEC = 600.0


def backoff_delay(failures: int, base: float = BACKOFF_BASE_SEC, cap: float = BACKOFF_CAP_SEC) -> float:
    """5s · 2^n capped at 300s (n = consecutive failures before this retry)."""
    return min(base * (2 ** max(0, int(failures))), cap)


@dataclass
class CameraSupervision:
    """Per-camera restart bookkeeping. ``url`` stays in memory only — it is
    never logged or returned; the DB holds the sealed form."""

    url: str = field(repr=False)
    fps: int = 15
    camera_name: str | None = None
    restart_count: int = 0
    failures: int = 0
    last_error: str | None = None
    next_retry_at: float | None = None
    running_since: float = field(default_factory=time.monotonic)


class CameraManager:
    def __init__(self, face_engine: "FaceEngine", storage: "SupabaseStorage", hls_dir: str):
        self.engine = face_engine
        self.storage = storage
        self.hls_dir = hls_dir
        self.sessions: dict[str, RecordingSession] = {}
        self.supervision: dict[str, CameraSupervision] = {}
        self.reveal = RevealProcessor(face_engine, storage)
        self._supervisor_task: asyncio.Task | None = None
        os.makedirs(RECORDINGS_DIR, exist_ok=True)

    def active_count(self) -> int:
        return sum(1 for s in self.sessions.values() if s.task and not s.task.done())

    def active_sessions(self) -> list[dict]:
        """Cameras whose capture task is still running (for the live grid / wall).

        Source URLs are deliberately NOT included — they may carry RTSP
        credentials; callers only need the id, display name, timing and
        the supervisor's restart history.
        """
        out: list[dict] = []
        for camera_id, s in self.sessions.items():
            if not (s.task and not s.task.done()):
                continue
            started = getattr(s, "started_at", None)
            sup = self.supervision.get(camera_id)
            out.append(
                {
                    "camera_id": camera_id,
                    "camera_name": getattr(s, "camera_name", None),
                    "started_at": started.isoformat() if started else None,
                    "fps": getattr(s, "fps", None),
                    "restart_count": sup.restart_count if sup else 0,
                    "last_error": sup.last_error if sup else None,
                }
            )
        return out

    # ── registry helpers (never raise) ────────────────────────
    async def _persist_started(self, session: RecordingSession, url: str) -> None:
        # camera_sessions.camera_id is a uuid FK → cameras; ad-hoc ids
        # (tests, virtual sources) simply are not persisted.
        if not session.db_camera_id:
            return
        try:
            sealed = seal_camera_url(session.db_camera_id, url)
            await asyncio.to_thread(
                self.storage.upsert_camera_session,
                session.db_camera_id, sealed, session.camera_name, session.fps,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("camera %s: registry upsert failed: %s", session.camera_id, type(e).__name__)

    async def _persist_resume_flag(self, camera_id: str, auto_resume: bool) -> None:
        if RecordingSession._validate_uuid(camera_id) is None:
            return
        try:
            await asyncio.to_thread(self.storage.set_camera_session_resume, camera_id, auto_resume)
        except Exception as e:  # noqa: BLE001
            log.warning("camera %s: registry flag failed: %s", camera_id, type(e).__name__)

    async def _persist_error(self, camera_id: str, message: str) -> None:
        if RecordingSession._validate_uuid(camera_id) is None:
            return
        try:
            await asyncio.to_thread(self.storage.record_camera_session_error, camera_id, message)
        except Exception as e:  # noqa: BLE001
            log.warning("camera %s: registry error record failed: %s", camera_id, type(e).__name__)

    # ── lifecycle ─────────────────────────────────────────────
    async def start(
        self,
        camera_id: str,
        url: str,
        fps: int = 15,
        camera_name: str | None = None,
        *,
        supervised: bool = False,
    ):
        existing = self.sessions.get(camera_id)
        if existing and existing.task and not existing.task.done():
            log.info("Камер %s аль хэдийн ажиллаж байна", camera_id)
            return
        if existing:
            # A finished/crashed session still owns ffmpeg pipes and an
            # unfinalised recording — close it before replacing.
            try:
                await existing.stop()
            except Exception as e:  # noqa: BLE001
                log.warning("Camera %s: stale session cleanup failed: %s", camera_id, e)
            # /camera/stop may have landed while we awaited the cleanup: the
            # operator's stop wins over a supervised restart.
            if getattr(existing, "stopped_by_user", False) or (
                supervised and camera_id not in self.supervision
            ):
                log.info("Камер %s: restart cancelled — stopped by user", camera_id)
                return

        session = RecordingSession(
            camera_id=camera_id,
            camera_name=camera_name,
            source_url=url,
            engine=self.engine,
            storage=self.storage,
            hls_dir=self.hls_dir,
            recordings_dir=RECORDINGS_DIR,
            fps=fps,
        )
        # Only now drop the dead session: if the constructor above raised, the
        # old entry stays in self.sessions and the supervisor keeps retrying.
        if existing is not None:
            self.sessions.pop(camera_id, None)
        await session.start()
        self.sessions[camera_id] = session

        sup = self.supervision.get(camera_id)
        if sup is None:
            sup = CameraSupervision(url=url, fps=fps, camera_name=camera_name)
            self.supervision[camera_id] = sup
        else:
            sup.url, sup.fps, sup.camera_name = url, fps, camera_name
        sup.running_since = time.monotonic()
        sup.next_retry_at = None
        if not supervised:
            # An explicit (re)start means the operator believes the source is
            # fixed — begin the backoff schedule afresh.
            sup.failures = 0
        log.info("Камер %s эхэллээ: %s", camera_id, redact_url(url))
        await self._persist_started(session, url)

    async def stop(self, camera_id: str, *, by_user: bool = True):
        session = self.sessions.pop(camera_id, None)
        if by_user:
            self.supervision.pop(camera_id, None)
            # Flag first so a supervisor tick racing with this stop never
            # mistakes the finished task for a crash.
            if session:
                session.stopped_by_user = True
            await self._persist_resume_flag(camera_id, False)
        if not session:
            return
        await session.stop()
        log.info("Камер %s зогсолоо", camera_id)

    async def stop_all(self):
        """Process shutdown: close sessions but leave auto_resume untouched so
        the next boot brings the same cameras back."""
        await self.stop_supervisor()
        await asyncio.gather(
            *(self.stop(c, by_user=False) for c in list(self.sessions.keys())),
            return_exceptions=True,
        )

    # ── auto-resume ───────────────────────────────────────────
    async def resume_persisted(self) -> int:
        """Start every camera_sessions row with auto_resume=true. Called once
        at boot after the engine is ready; a failure on one camera is
        recorded on its row and never aborts startup."""
        try:
            rows = await asyncio.to_thread(self.storage.list_resumable_sessions)
        except Exception as e:  # noqa: BLE001
            log.warning("resume: registry unavailable: %s", type(e).__name__)
            return 0
        resumed = 0
        for row in rows:
            camera_id = str(row.get("camera_id") or "")
            if not camera_id:
                continue
            try:
                url = unseal_camera_url(camera_id, row["sealed_url"])
                fps = int(row.get("fps") or 15)
                await self.start(camera_id, url, fps=fps, camera_name=row.get("camera_name"))
                resumed += 1
            except Exception as e:  # noqa: BLE001
                msg = f"auto-resume failed: {type(e).__name__}"
                log.warning("camera %s: %s", camera_id, msg)
                await self._persist_error(camera_id, msg)
        if rows:
            log.info("Auto-resume: %d/%d camera(s) restarted", resumed, len(rows))
        return resumed

    # ── supervisor ────────────────────────────────────────────
    def start_supervisor(self) -> None:
        if self._supervisor_task and not self._supervisor_task.done():
            return
        self._supervisor_task = asyncio.create_task(self._supervise_forever())

    async def stop_supervisor(self) -> None:
        task, self._supervisor_task = self._supervisor_task, None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def _supervise_forever(self) -> None:
        while True:
            await asyncio.sleep(SUPERVISOR_INTERVAL_SEC)
            try:
                await self.supervise_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — the loop must outlive any single bad tick
                log.exception("camera supervisor tick failed")

    @staticmethod
    def _exit_reason(session: RecordingSession) -> str:
        task = session.task
        if task is None:
            return "capture task never started"
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return "capture task cancelled"
        if exc is not None:
            # Type only: cv2/ffmpeg messages can echo the source URL.
            return f"capture task failed: {type(exc).__name__}"
        return getattr(session, "exit_reason", None) or "capture loop ended unexpectedly"

    async def supervise_once(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for camera_id, session in list(self.sessions.items()):
            sup = self.supervision.get(camera_id)
            if sup is None or getattr(session, "stopped_by_user", False):
                continue
            if session.task and not session.task.done():
                if sup.failures and now - sup.running_since >= HEALTHY_RESET_SEC:
                    sup.failures = 0
                continue

            if sup.next_retry_at is None:
                # First tick after the drop: record why, schedule the retry.
                reason = self._exit_reason(session)
                delay = backoff_delay(sup.failures)
                sup.last_error = reason
                sup.failures += 1
                sup.next_retry_at = now + delay
                log.warning(
                    "Камер %s down (%s) — restart #%d in %.0fs",
                    camera_id, reason, sup.restart_count + 1, delay,
                )
                await self._persist_error(camera_id, reason)
                continue

            if now < sup.next_retry_at:
                continue
            sup.restart_count += 1
            log.info("Камер %s: supervisor restart #%d", camera_id, sup.restart_count)
            try:
                await self.start(camera_id, sup.url, fps=sup.fps, camera_name=sup.camera_name, supervised=True)
            except Exception as e:  # noqa: BLE001
                # start() itself failed (e.g. mkdir) — treat like another drop.
                reason = f"restart failed: {type(e).__name__}"
                sup.last_error = reason
                sup.next_retry_at = now + backoff_delay(sup.failures)
                sup.failures += 1
                log.warning("Камер %s: %s", camera_id, reason)
                await self._persist_error(camera_id, reason)

    async def reveal_job(self, job_id: str, _req=None):
        """main.py-аас дуудна. Background-д ажиллана."""
        try:
            await self.reveal.run(job_id)
        except Exception as e:
            log.error("Reveal job %s exception: %s", job_id, e, exc_info=True)
