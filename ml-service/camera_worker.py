"""
CameraManager — олон камеруудын RecordingSession-уудыг удирдана.
Reveal job-уудыг async background-д явуулна.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING

from recording_pipeline import RecordingSession, redact_url
from reveal_job import RevealProcessor

if TYPE_CHECKING:
    from face_engine import FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.manager")

RECORDINGS_DIR = os.getenv("RECORDINGS_DIR", "/tmp/mongolz-recordings")


class CameraManager:
    def __init__(self, face_engine: "FaceEngine", storage: "SupabaseStorage", hls_dir: str):
        self.engine = face_engine
        self.storage = storage
        self.hls_dir = hls_dir
        self.sessions: dict[str, RecordingSession] = {}
        self.reveal = RevealProcessor(face_engine, storage)
        os.makedirs(RECORDINGS_DIR, exist_ok=True)

    def active_count(self) -> int:
        return sum(1 for s in self.sessions.values() if s.task and not s.task.done())

    def active_sessions(self) -> list[dict]:
        """Cameras whose capture task is still running (for the live grid / wall).

        Source URLs are deliberately NOT included — they may carry RTSP
        credentials; callers only need the id, display name and timing.
        """
        out: list[dict] = []
        for camera_id, s in self.sessions.items():
            if not (s.task and not s.task.done()):
                continue
            started = getattr(s, "started_at", None)
            out.append(
                {
                    "camera_id": camera_id,
                    "camera_name": getattr(s, "camera_name", None),
                    "started_at": started.isoformat() if started else None,
                    "fps": getattr(s, "fps", None),
                }
            )
        return out

    async def start(self, camera_id: str, url: str, fps: int = 15, camera_name: str | None = None):
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
            self.sessions.pop(camera_id, None)

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
        await session.start()
        self.sessions[camera_id] = session
        log.info("Камер %s эхэллээ: %s", camera_id, redact_url(url))

    async def stop(self, camera_id: str):
        session = self.sessions.pop(camera_id, None)
        if not session:
            return
        await session.stop()
        log.info("Камер %s зогсолоо", camera_id)

    async def stop_all(self):
        await asyncio.gather(
            *(self.stop(c) for c in list(self.sessions.keys())),
            return_exceptions=True,
        )

    async def reveal_job(self, job_id: str, _req=None):
        """main.py-аас дуудна. Background-д ажиллана."""
        try:
            await self.reveal.run(job_id)
        except Exception as e:
            log.error("Reveal job %s exception: %s", job_id, e, exc_info=True)
