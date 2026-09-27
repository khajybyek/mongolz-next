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

Desired state wins over anything held in memory
-----------------------------------------------
The DB is authoritative about which cameras may run: ``cameras.enabled``
(the operator's toggle, mirrored onto ``camera_sessions.auto_resume`` by a
trigger) is re-read before every resume and every supervised restart, and
the supervisor also reconciles the sessions that are still alive. A
supervised restart persists only the fields describing the running session
— it never re-arms ``auto_resume``, which is how a disabled camera used to
come back after each redeploy (audit 4.5).

An unreadable registry means "unknown", never "stop": a Supabase blip must
not end a healthy capture loop.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from recording_pipeline import RecordingSession, redact_url
from capture_journal import recover_captures, recordings_directory
from recording_spool import get_recording_spool
from reveal_job import RevealProcessor
from storage import CameraDesiredState, seal_camera_url, unseal_camera_url

if TYPE_CHECKING:
    from face_engine import FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.manager")

RECORDINGS_DIR = recordings_directory()

SUPERVISOR_INTERVAL_SEC = 30.0
BACKOFF_BASE_SEC = 5.0
BACKOFF_CAP_SEC = 300.0
# A session that has been up this long is considered healthy again: the
# backoff exponent resets so a later drop starts the schedule from 5 s.
HEALTHY_RESET_SEC = 600.0


def backoff_delay(failures: int, base: float = BACKOFF_BASE_SEC, cap: float = BACKOFF_CAP_SEC) -> float:
    """5s · 2^n capped at 300s (n = consecutive failures before this retry)."""
    return min(base * (2 ** max(0, int(failures))), cap)


PUBLIC_REASON_MAX_LEN = 200
# Anything URL-shaped (scheme://…) or credential-shaped (user:pass@host).
# The reasons written today are fixed strings or exception type names, so
# this never fires; it exists so a future reason that echoes a source URL
# cannot reach /camera/active (the web and every operator reads it).
_URL_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*://\S*")
_CREDENTIAL_TOKEN = re.compile(r"\S*:\S*@\S+")


def public_reason(reason: str | None) -> str | None:
    """A supervisor reason safe to return to callers: no URL, no credentials,
    bounded length. ``None``/empty stays ``None``."""
    if not reason:
        return None
    text = _URL_TOKEN.sub("<redacted>", str(reason))
    text = _CREDENTIAL_TOKEN.sub("<redacted>", text)
    text = " ".join(text.split())[:PUBLIC_REASON_MAX_LEN]
    return text or None


def _monotonic_to_utc_iso(at: float, now_mono: float, now_wall: datetime) -> str:
    """Convert a ``time.monotonic()`` instant to ISO-8601 UTC (second precision)."""
    wall = now_wall + timedelta(seconds=at - now_mono)
    return wall.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
        # monotonic time of the next supervisor tick (None = no loop running).
        # Retries only happen on a tick, so "next try" is the first tick at or
        # after the backoff deadline, not the deadline itself.
        self._next_tick_at: float | None = None
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
                    "frames_total": getattr(s, "total_frames", 0),
                    "capture_status": "capturing",
                    "segment_duration_sec": getattr(s, "segment_duration_sec", 120),
                    "restart_count": sup.restart_count if sup else 0,
                    "last_error": public_reason(sup.last_error) if sup else None,
                    "state": "running",
                    "next_retry_at": None,
                }
            )
        return out

    def _effective_retry_at(self, deadline: float, now: float) -> float:
        """The supervisor tick that will actually act on ``deadline``.

        Without a running loop (tests, shutdown) the deadline itself is the
        best answer. A tick time already in the past means a tick is running
        right now; ``now`` stands in for it."""
        tick = getattr(self, "_next_tick_at", None)
        if tick is None:
            return deadline
        tick = max(tick, now)
        if deadline <= tick:
            return tick
        steps = math.ceil((deadline - tick) / SUPERVISOR_INTERVAL_SEC)
        return tick + steps * SUPERVISOR_INTERVAL_SEC

    def reconnecting_sessions(
        self, now: float | None = None, now_wall: datetime | None = None
    ) -> list[dict]:
        """Supervised cameras whose capture loop is NOT running — dropped and
        waiting for (or between) supervisor retries. ``/camera/active`` used to
        hide them entirely, so an unreachable source looked merely idle.

        Same privacy rule as ``active_sessions``: no URL, and ``last_error``
        passes through ``public_reason``. ``next_retry_at`` is ISO-8601 UTC, or
        None until the supervisor has noticed the drop (≤ one tick)."""
        now = time.monotonic() if now is None else now
        now_wall = datetime.now(timezone.utc) if now_wall is None else now_wall
        out: list[dict] = []
        for camera_id, sup in list(self.supervision.items()):
            session = self.sessions.get(camera_id)
            if session is not None:
                if getattr(session, "stopped_by_user", False):
                    continue
                if session.task and not session.task.done():
                    continue  # running → reported by active_sessions
            reason = sup.last_error
            if reason is None and session is not None:
                reason = self._exit_reason(session)
            retry_at = (
                _monotonic_to_utc_iso(
                    self._effective_retry_at(sup.next_retry_at, now), now, now_wall
                )
                if sup.next_retry_at is not None
                else None
            )
            out.append(
                {
                    "camera_id": camera_id,
                    "camera_name": sup.camera_name,
                    "started_at": None,
                    "fps": sup.fps,
                    "frames_total": 0,
                    "capture_status": "reconnecting",
                    "restart_count": sup.restart_count,
                    "last_error": public_reason(reason),
                    "state": "backoff",
                    "next_retry_at": retry_at,
                }
            )
        return out

    # ── registry helpers (never raise) ────────────────────────
    async def _persist_started(
        self, session: RecordingSession, url: str, *, supervised: bool = False
    ) -> None:
        # camera_sessions.camera_id is a uuid FK → cameras; ad-hoc ids
        # (tests, virtual sources) simply are not persisted.
        if not session.db_camera_id:
            return
        try:
            sealed = seal_camera_url(session.db_camera_id, url)
            if supervised:
                # Crash recovery is OUR decision, not the operator's: refresh
                # the session description and leave auto_resume exactly as the
                # operator (or the disable trigger) set it.
                await asyncio.to_thread(
                    self.storage.touch_camera_session,
                    session.db_camera_id, sealed, session.camera_name, session.fps,
                )
            else:
                await asyncio.to_thread(
                    self.storage.upsert_camera_session,
                    session.db_camera_id, sealed, session.camera_name, session.fps,
                )
        except Exception as e:  # noqa: BLE001
            log.warning(
                "camera %s: registry %s failed: %s",
                session.camera_id, "touch" if supervised else "upsert", type(e).__name__,
            )

    async def _desired_state(self, camera_id: str) -> CameraDesiredState:
        """Fresh ``cameras.enabled`` / ``camera_sessions.auto_resume``.

        Ad-hoc (non-UUID) camera ids have no rows to read — they are always
        "unknown", i.e. allowed, so demo / test sources keep working.
        """
        if RecordingSession._validate_uuid(camera_id) is None:
            return CameraDesiredState()
        try:
            return await asyncio.to_thread(self.storage.camera_desired_state, camera_id)
        except Exception as e:  # noqa: BLE001 — unknown, never "stop"
            log.warning("camera %s: desired-state read failed: %s", camera_id, type(e).__name__)
            return CameraDesiredState()

    async def start_refusal(self, camera_id: str) -> str | None:
        """Why an explicit start must be refused, or None. Used by
        ``/camera/start`` so the service does not depend on its caller having
        checked the operator's toggle."""
        return (await self._desired_state(camera_id)).start_refusal()

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
            # An explicit operator start (supervised=False) is newer than any
            # earlier stop and must replace the dead session — returning here
            # used to answer /camera/start ok:true while capturing nothing.
            if supervised and (
                getattr(existing, "stopped_by_user", False)
                or camera_id not in self.supervision
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
        await self._persist_started(session, url, supervised=supervised)

    async def stop(self, camera_id: str, *, by_user: bool = True):
        # Keep the session registered until finalize (including durable spool
        # enqueue) succeeds. If Storage/disk fails, the next stop request can
        # retry the same recording instead of losing the only local path.
        session = self.sessions.get(camera_id)
        if by_user:
            self.supervision.pop(camera_id, None)
            # Flag first so a supervisor tick racing with this stop never
            # mistakes the finished task for a crash.
            if session:
                session.stopped_by_user = True
            await self._persist_resume_flag(camera_id, False)
        if not session:
            return
        try:
            await session.stop()
        except Exception as e:  # noqa: BLE001
            if not by_user or self._finalize_retry_possible(session):
                # A validated segment is still on disk (spool entry or
                # journal): keep the session so the next stop can retry.
                raise
            # Nothing left to retry: the capture loop is over and no segment
            # awaits delivery. Keeping the entry only made every later stop
            # fail and every later start a no-op.
            self.sessions.pop(camera_id, None)
            log.warning("Камер %s: stopped; finalize failed: %s", camera_id, type(e).__name__)
            return
        self.sessions.pop(camera_id, None)
        log.info("Камер %s зогсолоо", camera_id)

    @staticmethod
    def _finalize_retry_possible(session) -> bool:
        task = getattr(session, "task", None)
        if task is None or not task.done():
            return True
        recording_id = getattr(session, "recording_id", None)
        if recording_id is None:
            return True
        try:
            if get_recording_spool().has_pending(recording_id):
                return True
        except Exception:  # noqa: BLE001 — unknown spool state: keep for retry
            return True
        journal = getattr(session, "journal_path", None)
        return bool(getattr(session, "_validated", False) and journal is not None and journal.exists())

    async def stop_all(self):
        """Process shutdown: close sessions but leave auto_resume untouched so
        the next boot brings the same cameras back."""
        await self.stop_supervisor()
        await asyncio.gather(
            *(self.stop(c, by_user=False) for c in list(self.sessions.keys())),
            return_exceptions=True,
        )

    # ── auto-resume ───────────────────────────────────────────
    @staticmethod
    def _embedded_enabled(row: dict) -> bool | None:
        """cameras.enabled from the PostgREST embed, or None when the row was
        fetched without it (schema-cache fallback in list_resumable_sessions).
        The embed is an object for a to-one FK, but tolerate a list too."""
        camera = row.get("cameras")
        if isinstance(camera, list):
            camera = camera[0] if camera else None
        if not isinstance(camera, dict):
            return None
        enabled = camera.get("enabled")
        return None if enabled is None else bool(enabled)

    async def resume_persisted(self) -> int:
        """Start every camera_sessions row with auto_resume=true whose camera
        is still enabled. Called once at boot after the engine is ready; a
        failure on one camera is recorded on its row and never aborts
        startup.

        A row the operator disabled while this service was down is skipped
        (and the reason recorded), not started: that is the whole point of
        the disable trigger, which a supervised restart used to undo."""
        await recover_captures(self.storage, RECORDINGS_DIR)
        try:
            rows = await asyncio.to_thread(self.storage.list_resumable_sessions)
        except Exception as e:  # noqa: BLE001
            log.warning("resume: registry unavailable: %s", type(e).__name__)
            return 0
        resumed = 0
        skipped = 0
        for row in rows:
            camera_id = str(row.get("camera_id") or "")
            if not camera_id:
                continue
            # The embed answers for free; without it (fallback select) ask the
            # DB per camera rather than resuming a camera that may be off.
            enabled = self._embedded_enabled(row)
            refusal = None
            if enabled is False:
                refusal = "camera disabled by operator"
            elif enabled is None:
                refusal = (await self._desired_state(camera_id)).resume_refusal()
            if refusal:
                skipped += 1
                log.info("Камер %s: auto-resume skipped — %s", camera_id, refusal)
                await self._persist_error(camera_id, f"auto-resume skipped: {refusal}")
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
            log.info(
                "Auto-resume: %d/%d camera(s) restarted, %d skipped (disabled / stopped)",
                resumed, len(rows), skipped,
            )
        return resumed

    # ── supervisor ────────────────────────────────────────────
    def start_supervisor(self) -> None:
        if self._supervisor_task and not self._supervisor_task.done():
            return
        self._supervisor_task = asyncio.create_task(self._supervise_forever())

    async def stop_supervisor(self) -> None:
        task, self._supervisor_task = self._supervisor_task, None
        self._next_tick_at = None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def _supervise_forever(self) -> None:
        while True:
            self._next_tick_at = time.monotonic() + SUPERVISOR_INTERVAL_SEC
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

    async def _drop(self, camera_id: str, reason: str) -> None:
        """Stop supervising a camera the DB says must not run.

        The capture loop is closed through ``stop(by_user=False)`` so the
        recording is finalised (and spooled) rather than leaked, and
        auto_resume is left exactly as it is — it is already false, or the
        camera/row is gone. If the close itself fails, the session stays
        registered for a later ``/camera/stop`` retry, but supervision ends
        either way: this camera must not be restarted."""
        log.info("Камер %s: supervision dropped — %s", camera_id, reason)
        await self._persist_error(camera_id, f"stopped: {reason}")
        try:
            await self.stop(camera_id, by_user=False)
        except Exception as e:  # noqa: BLE001
            log.warning("Камер %s: drop cleanup failed: %s", camera_id, type(e).__name__)
        finally:
            self.supervision.pop(camera_id, None)

    async def supervise_once(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for camera_id, session in list(self.sessions.items()):
            sup = self.supervision.get(camera_id)
            if sup is None or getattr(session, "stopped_by_user", False):
                continue
            if session.task and not session.task.done():
                # Reconcile: the operator may have disabled (or deleted) this
                # camera while the web action's stop call could not reach us,
                # in which case a healthy loop is still recording something it
                # must not. Only the toggle counts here — auto_resume governs
                # RESTARTS, and a stale false (a failed registry write on the
                # start that is running right now) must not kill a live
                # session. Unknown (registry unreadable) keeps it running.
                refusal = (await self._desired_state(camera_id)).start_refusal()
                if refusal:
                    await self._drop(camera_id, refusal)
                    continue
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
            # The desired state may have changed while we backed off — never
            # restart a camera the operator disabled or stopped meanwhile.
            refusal = (await self._desired_state(camera_id)).resume_refusal()
            if refusal:
                await self._drop(camera_id, refusal)
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
