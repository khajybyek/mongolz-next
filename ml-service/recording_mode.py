"""Per-camera recording mode (``cameras.recording_mode``, ADR 0013).

* ``standard`` (default) — encrypted whole original + masked view derived on
  demand (ADR 0002 / 0010).
* ``face_encrypted`` — no raw original: the stored video is the masked video
  (faces painted with the keyed cipher visual, encrypted at rest) plus a face
  envelope holding every face crop sealed with its per-face hash-chain key.

The mode applies to NEW segments. The capture pipeline reads it through this
cache — a sibling of the privacy schedule cache (``privacy_schedule``), NOT
part of its query, so a missing ``recording_mode`` column (ML deployed before
migration 20260930100000) can never make the privacy schedule unreadable:

  * fresher than ``ttl_sec`` (30 s)      → used as is;
  * stale                                 → a background refresh; the caller
    that starts a segment (``mode_for``) waits up to ``wait_sec`` for it;
  * unreadable                            → the last known mode;
  * never loaded (read failed or still    → ``face_encrypted``, the stricter
    pending when a segment starts)          mode: a camera must never store a
                                            raw original only because its
                                            setting could not be read (fail
                                            closed, like ADR 0012). A camera
                                            that turns out to be ``standard``
                                            rotates to it once the read
                                            succeeds (``peek``);
  * the column does not exist             → ``standard`` (the ML runs before
    (ML deployed before migration           its migration: no camera can be
    20260930100000)                         face_encrypted, and the old schema
                                            refuses face_encrypted rows).

A camera id without a ``cameras`` row (browser uploads, ad-hoc ids) is
``standard``. ``peek`` is the non-blocking read the capture loop uses once
per second to notice a change: a changed mode rotates the segment, so an
edit reaches a running camera within ~``ttl_sec``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable

from privacy_schedule import normalize_camera_id

log = logging.getLogger("mongolz-ml.recording-mode")

STANDARD = "standard"
FACE_ENCRYPTED = "face_encrypted"
RECORDING_MODES: tuple[str, ...] = (STANDARD, FACE_ENCRYPTED)


def _column_missing(exc: BaseException) -> bool:
    """PostgREST/PostgreSQL 'undefined column' (42703) for recording_mode."""
    code = str(getattr(exc, "code", "") or "")
    text = f"{getattr(exc, 'message', '')} {exc}".lower()
    return code == "42703" or ("recording_mode" in text and "does not exist" in text)


@dataclass
class _Entry:
    mode: str | None = None            # last known good value
    loaded_at: float | None = None
    next_attempt_at: float = 0.0
    refresh: "asyncio.Task | None" = None
    refresh_started_at: float = 0.0
    warned_at: float | None = None


class RecordingModeCache:
    def __init__(
        self,
        storage: Any,
        *,
        ttl_sec: float = 30.0,
        wait_sec: float = 2.0,
        retry_sec: float = 5.0,
        warn_every_sec: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._storage = storage
        self.ttl_sec = float(ttl_sec)
        self.wait_sec = float(wait_sec)
        self.retry_sec = float(retry_sec)
        self.warn_every_sec = float(warn_every_sec)
        self._clock = clock
        self._entries: dict[str, _Entry] = {}

    def _load(self, camera_id: str) -> str:
        loader = getattr(self._storage, "load_recording_mode", None) if self._storage is not None else None
        if loader is None or getattr(self._storage, "client", True) is None:
            # Not configured (uploads, tests, no Supabase client): no cameras
            # table to read, so nothing can be face_encrypted.
            return STANDARD
        mode = loader(camera_id)
        if mode is None:
            return STANDARD  # no cameras row
        if not isinstance(mode, str) or mode not in RECORDING_MODES:
            raise ValueError("invalid recording_mode")
        return mode

    def _stale(self, entry: _Entry, now: float) -> bool:
        return entry.loaded_at is None or (now - entry.loaded_at) >= self.ttl_sec

    def _ensure_refresh(self, cid: str, entry: _Entry, now: float) -> "asyncio.Task | None":
        loop = asyncio.get_running_loop()
        task = entry.refresh
        if task is not None and not task.done():
            if task.get_loop() is loop:
                return task
            entry.refresh = None  # left behind by an earlier event loop (tests)
        if now < entry.next_attempt_at:
            return None  # a failed read is retried after retry_sec
        entry.refresh_started_at = now
        entry.refresh = loop.create_task(self._refresh(cid, entry))
        return entry.refresh

    async def _refresh(self, cid: str, entry: _Entry) -> None:
        try:
            mode = await asyncio.to_thread(self._load, cid)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — keep the last known mode
            if _column_missing(exc):
                # The schema predates the mode: nothing can be face_encrypted.
                if entry.mode != STANDARD:
                    log.warning("camera %s: cameras.recording_mode does not exist (migration "
                                "20260930100000 not applied) — recording standard", cid)
                entry.mode = STANDARD
                entry.loaded_at = self._clock()
                entry.next_attempt_at = 0.0
                return
            now = self._clock()
            entry.next_attempt_at = now + self.retry_sec
            if entry.warned_at is None or now - entry.warned_at >= self.warn_every_sec:
                entry.warned_at = now
                log.warning(
                    "camera %s: recording mode unreadable (%s) — %s",
                    cid, type(exc).__name__,
                    f"keeping {entry.mode}" if entry.mode
                    else "new segments record face_encrypted (the stricter mode) until it is readable",
                )
            return
        if entry.warned_at is not None:
            log.info("camera %s: recording mode readable again", cid)
            entry.warned_at = None
        if entry.mode is not None and entry.mode != mode:
            log.info("camera %s: recording mode %s → %s (applies to the next segment)", cid, entry.mode, mode)
        entry.mode = mode
        entry.loaded_at = self._clock()
        entry.next_attempt_at = 0.0

    async def mode_for(self, camera_id: str | None) -> str:
        """The mode a NEW segment of ``camera_id`` records in (waits at most
        ``wait_sec`` for a due refresh). Never raises. A camera whose mode was
        never read successfully gets ``face_encrypted`` (fail closed)."""
        cid = normalize_camera_id(camera_id)
        if cid is None:
            return STANDARD
        try:
            entry = self._entries.setdefault(cid, _Entry())
            now = self._clock()
            if self._stale(entry, now):
                task = self._ensure_refresh(cid, entry, now)
                if task is not None:
                    remaining = self.wait_sec - (now - entry.refresh_started_at)
                    if remaining > 0:
                        try:
                            await asyncio.wait_for(asyncio.shield(task), remaining)
                        except asyncio.TimeoutError:
                            pass
                        except Exception:  # noqa: BLE001 — _refresh records its failure
                            pass
            if entry.mode is None:
                log.warning("camera %s: recording mode not read yet — this segment records "
                            "face_encrypted (the stricter mode)", cid)
                return FACE_ENCRYPTED
            return entry.mode
        except Exception as exc:  # noqa: BLE001 — never stops a capture
            log.warning("camera %s: recording mode lookup failed (%s)", cid, type(exc).__name__)
            entry = self._entries.get(cid)
            return (entry.mode if entry else None) or FACE_ENCRYPTED

    def peek(self, camera_id: str | None) -> str | None:
        """Last known mode (None before the first successful read) — never
        waits. Schedules a background refresh when due (needs a running loop)."""
        cid = normalize_camera_id(camera_id)
        if cid is None:
            return None
        entry = self._entries.setdefault(cid, _Entry())
        now = self._clock()
        if self._stale(entry, now):
            try:
                self._ensure_refresh(cid, entry, now)
            except RuntimeError:
                pass  # no running loop
        return entry.mode

    def invalidate(self, camera_id: str | None = None) -> None:
        """Force a refresh on the next read (all cameras when None)."""
        if camera_id is None:
            entries = list(self._entries.values())
        else:
            cid = normalize_camera_id(camera_id)
            entries = [self._entries[cid]] if cid in self._entries else []
        for entry in entries:
            entry.loaded_at = None  # the last known mode stays the fallback
            entry.next_attempt_at = 0.0


_cache: RecordingModeCache | None = None


def init_recording_mode_cache(storage: Any, **kwargs: Any) -> RecordingModeCache:
    """Install the process-wide cache (main.py lifespan)."""
    global _cache
    _cache = RecordingModeCache(storage, **kwargs)
    return _cache


def get_recording_mode_cache() -> RecordingModeCache:
    """Process-wide cache. Before ``init_recording_mode_cache`` it has no
    storage: ``_load`` answers ``standard`` for every camera (a successful
    read, so the fail-closed rule does not apply)."""
    global _cache
    if _cache is None:
        _cache = RecordingModeCache(None)
    return _cache
