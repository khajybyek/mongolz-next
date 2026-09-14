"""Durable encrypted upload inputs and periodically reconciled processing.

Railway requires a mounted volume. A 202 is issued only after encrypted parts,
the input manifest and the DB row are durable. File locks fence processors
sharing that volume; DB compare-and-set makes cancellation authoritative.
Temporary plaintext is reconstructed only while a worker owns the job.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import tempfile
import time
from uuid import UUID, uuid5, NAMESPACE_URL

from crypto_utils import encrypt_bytes, decrypt_bytes
from recording_spool import _atomic_write, _sync_dir

log = logging.getLogger("mongolz-ml.jobs")
MAX_INPUT_BYTES = 100 * 1024 * 1024
TERMINAL = {"ready", "failed", "cancelled"}


class UploadConflict(ValueError):
    pass


class UploadStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.root / ".locks").mkdir(exist_ok=True, mode=0o700)
        _sync_dir(self.root.parent)

    @classmethod
    def from_env(cls):
        volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
        base = Path(volume) if volume else Path.home() / ".mongolz"
        root = Path(os.getenv("UPLOAD_JOB_DIR") or base / "upload-jobs")
        if os.getenv("RAILWAY_ENVIRONMENT_ID"):
            if not volume or not os.path.ismount(volume) or not root.resolve().is_relative_to(Path(volume).resolve()):
                raise RuntimeError("Uploads require UPLOAD_JOB_DIR inside the mounted Railway volume")
        return cls(root)

    def directory(self, job_id: str) -> Path:
        return self.root / str(UUID(job_id))

    @contextmanager
    def lock(self, job_id: str, *, worker=False):
        # Separate acceptance and execution locks: re-sending a final chunk
        # returns its receipt immediately even during a long-running render.
        name = str(UUID(job_id)) + (".run" if worker else ".input")
        with (self.root / ".locks" / name).open("a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if worker else 0))
            except BlockingIOError:
                yield False
                return
            try:
                yield True
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def manifest(self, job_id: str) -> dict:
        return json.loads((self.directory(job_id) / "input.json").read_text())

    def accept(self, storage, *, job_id: str, owner: str, camera_name: str, suffix: str,
               index: int, final: bool, data: bytes) -> dict:
        job_id, owner = str(UUID(job_id)), str(UUID(owner))
        if not 0 <= index < 400 or suffix not in (".mp4", ".webm"):
            raise ValueError("Invalid upload metadata")
        directory = self.directory(job_id)
        with self.lock(job_id):
            directory.mkdir(exist_ok=True, mode=0o700)
            _sync_dir(self.root)
            path = directory / "input.json"
            if path.exists():
                manifest = self.manifest(job_id)
                if manifest["owner"] != owner:
                    raise UploadConflict("Upload belongs to another user")
                if manifest["suffix"] != suffix or manifest["camera_name"] != camera_name:
                    raise UploadConflict("Upload metadata changed; start a new upload")
                old = manifest["parts"].get(str(index))
                if manifest["accepted"] and data and (not old or old["sha256"] != hashlib.sha256(data).hexdigest()):
                    raise UploadConflict("Chunk content changed; start a new upload")
                if manifest["accepted"]:
                    # The immutable, fsynced input can repair a crash between
                    # manifest commit and DB insertion. Never reset job state.
                    return self._register(storage, manifest)
                if manifest["suffix"] != suffix or manifest["camera_name"] != camera_name:
                    raise UploadConflict("Upload metadata changed; start a new upload")
            else:
                manifest = {"id": job_id, "owner": owner, "camera_name": camera_name,
                            "suffix": suffix, "parts": {}, "accepted": False,
                            "recording_id": str(uuid5(NAMESPACE_URL, f"mongolz:upload:{job_id}"))}
            if data:
                digest = hashlib.sha256(data).hexdigest()
                old = manifest["parts"].get(str(index))
                if old and old["sha256"] != digest:
                    raise UploadConflict("Chunk content changed; start a new upload")
                total = sum(p["bytes"] for p in manifest["parts"].values()) + (0 if old else len(data))
                if total > MAX_INPUT_BYTES:
                    raise ValueError("Upload exceeds 100 MB")
                if not old:
                    reserve = int(os.getenv("UPLOAD_MIN_FREE_BYTES", str(256 * 1024 * 1024)))
                    limit = int(os.getenv("UPLOAD_MAX_PENDING_BYTES", str(2 * 1024 ** 3)))
                    used = sum(part.stat().st_size for part in self.root.glob("*/*.enc") if part.exists())
                    if used + len(data) > limit or shutil.disk_usage(self.root).free - len(data) < reserve:
                        raise OSError("Durable input capacity exhausted")
                _atomic_write(directory / f"{index}.enc", encrypt_bytes(data, f"upload:{job_id}:{index}"))
                manifest["parts"][str(index)] = {"sha256": digest, "bytes": len(data)}
            manifest["updated_at"] = time.time()
            _atomic_write(path, json.dumps(manifest).encode())
            if not final:
                return {"ok": True, "status": "chunk_received", "session_id": job_id, "chunk_index": index}
            expected = index + bool(data)
            if expected <= 0 or set(manifest["parts"]) != {str(i) for i in range(expected)}:
                raise ValueError("missing chunks; retry them before finalizing")
            manifest["accepted"] = True
            _atomic_write(path, json.dumps(manifest).encode())
            return self._register(storage, manifest)

    @staticmethod
    def _register(storage, manifest: dict) -> dict:
        row = storage.ensure_upload_job({"id": manifest["id"], "requested_by": manifest["owner"],
            "camera_name": manifest["camera_name"], "recording_id": manifest["recording_id"], "status": "queued"})
        return {"ok": True, "job_id": row["id"], "recording_id": row["recording_id"],
                "status": row["status"], "progress": row.get("progress", 0)}

    def assemble(self, job_id: str, destination: Path) -> None:
        manifest = self.manifest(job_id)
        if not manifest["accepted"]:
            raise ValueError("Input not accepted")
        with destination.open("wb") as out:
            for i in range(len(manifest["parts"])):
                data = decrypt_bytes((self.directory(job_id) / f"{i}.enc").read_bytes(), f"upload:{job_id}:{i}")
                if hashlib.sha256(data).hexdigest() != manifest["parts"][str(i)]["sha256"]:
                    raise ValueError("Input integrity check failed")
                out.write(data)

    def verify(self, job_id: str) -> bool:
        """Authenticate every retained chunk before exposing retry as viable."""
        manifest = self.manifest(job_id)
        if not manifest["accepted"]:
            return False
        for index, expected in manifest["parts"].items():
            data = decrypt_bytes(
                (self.directory(job_id) / f"{index}.enc").read_bytes(),
                f"upload:{job_id}:{index}",
            )
            if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
                return False
        return bool(manifest["parts"])

    def remove_bytes(self, job_id: str) -> None:
        # Keep the tiny immutable receipt. A lost HTTP response reuses the DB
        # job even after the input bytes have been retired.
        for file in self.directory(job_id).glob("*.enc"):
            file.unlink(missing_ok=True)
        shutil.rmtree(self.directory(job_id) / "work", ignore_errors=True)


class UploadWorker:
    def __init__(self, store, storage, spool, session_factory, *, hls_dir: str, timeout: float = 3600):
        self.store, self.storage, self.spool = store, storage, spool
        self.session_factory, self.hls_dir, self.timeout = session_factory, hls_dir, timeout
        self.task: asyncio.Task | None = None
        self.stopping = asyncio.Event()

    async def db(self, fn, *args, **kwargs):
        return await asyncio.to_thread(fn, *args, **kwargs)

    async def process(self, job_id: str):
        with self.store.lock(job_id, worker=True) as owned:
            if not owned:
                return
            manifest = self.store.manifest(job_id)
            if not manifest["accepted"]:
                return
            await self.db(self.store._register, self.storage, manifest)
            job = await self.db(self.storage.upload_job, job_id)
            if not job or job["status"] in TERMINAL:
                if job and job["status"] in {"ready", "cancelled"}:
                    self.store.remove_bytes(job_id)
                return
            rec = job["recording_id"]
            # A restart after finalize must resume delivery, never re-render.
            if self.spool.has_pending(rec) or await self.db(self.storage.upload_recording_ready, rec):
                await self.db(self.storage.update_upload_job, job_id, ("queued", "processing", "delivering"), status="delivering", progress=95)
                await self.db(self.spool.deliver, self.storage, rec)
                if not self.spool.has_pending(rec) and await self.db(self.storage.upload_recording_ready, rec):
                    updated = await self.db(self.storage.update_upload_job, job_id, ("delivering",), status="ready", progress=100, error_message=None, completed_at=_now())
                    if updated:
                        self.store.remove_bytes(job_id)
                return
            if job["attempts"] >= 5:
                await self.db(self.storage.update_upload_job, job_id, ("processing", "queued", "delivering"), status="failed", error_message="Worker interrupted repeatedly; retry the upload", completed_at=_now())
                return
            claimed = await self.db(self.storage.update_upload_job, job_id, ("queued", "processing", "delivering"),
                status="processing", progress=1, error_message=None, attempts=job["attempts"]+1)
            if not claimed:
                return
            session = None
            try:
                await self.db(self.storage.reset_uncommitted_upload, rec)
                work = self.store.directory(job_id) / "work"
                shutil.rmtree(work, ignore_errors=True)
                work.mkdir(mode=0o700)
                with tempfile.TemporaryDirectory(prefix="mongolz-job-") as tmp:
                    source = Path(tmp) / f"input{manifest['suffix']}"
                    await self.db(self.store.assemble, job_id, source)
                    session = self.session_factory(camera_id=f"upload_{job_id[:8]}", camera_name=job["camera_name"],
                        source_url=str(source), recording_id=rec, hls_dir=self.hls_dir,
                        recordings_dir=str(work), fps=15, db_camera_id=None)
                    await session.start()
                    started = time.monotonic()
                    while session.task and not session.task.done():
                        await asyncio.wait({session.task}, timeout=2)
                        current = await self.db(self.storage.upload_job, job_id)
                        if not current or current["status"] != "processing" or self.stopping.is_set():
                            await session.stop(finalize=False)
                            return
                        if time.monotonic()-started > self.timeout:
                            raise TimeoutError("Processing time limit reached; input retained for retry")
                        duration = getattr(session, "source_duration_sec", 0) or 0
                        offset = getattr(session, "capture_time_sec", 0) or 0
                        progress = min(90, max(1, round(offset/duration*90))) if duration else 1
                        await self.db(self.storage.update_upload_job, job_id, ("processing",), progress=progress)
                    if session.task:
                        await session.task
                    if not session.input_complete:
                        raise RuntimeError("Video did not reach a complete end of input")
                    # Delivery is a short non-cancellable commit phase. A
                    # cancellation that won first prevents finalize entirely.
                    if not await self.db(self.storage.update_upload_job, job_id, ("processing",), status="delivering", progress=90):
                        await session.stop(finalize=False)
                        return
                    await session.stop()
                    if not session.processing_complete:
                        raise RuntimeError("Video output validation failed")
                    # Finalize may queue a network retry. Do not call it ready
                    # until both Storage and the recording row acknowledge it.
                    if not self.spool.has_pending(rec) and await self.db(self.storage.upload_recording_ready, rec):
                        await self.db(self.storage.update_upload_job, job_id, ("delivering",), status="ready", progress=100, completed_at=_now())
                        self.store.remove_bytes(job_id)
            except asyncio.CancelledError:
                if session:
                    await session.stop(finalize=False)
                raise
            except Exception as exc:
                if session:
                    try:
                        await session.stop(finalize=False)
                    except Exception:
                        pass
                log.warning("Upload %s failed (%s)", job_id, type(exc).__name__)
                # Keep encrypted input. A DB outage leaves it discoverable by
                # the next scan; a cancelled row cannot be changed to failed.
                if self.spool.has_pending(rec):
                    # An encryption/delivery commit may already be durable.
                    # Preserve it for spool retry; never re-render over it.
                    await self.db(self.storage.update_upload_job, job_id, ("processing", "delivering"),
                        status="delivering", progress=95, error_message="Storage delivery pending; retrying automatically")
                else:
                    await self.db(self.storage.update_upload_job, job_id, ("processing", "delivering"), status="failed",
                        error_message="Processing timed out; retry available" if isinstance(exc, TimeoutError) else "Processing failed; input retained for retry",
                        completed_at=_now())

    async def run_once(self):
        for path in sorted(self.store.root.glob("*/input.json")):
            if self.stopping.is_set():
                return
            try:
                manifest = self.store.manifest(path.parent.name)
                if not manifest["accepted"] and time.time() - manifest.get("updated_at", 0) > 86400:
                    # Expire only abandoned, unaccepted chunks. A queued or
                    # failed accepted job keeps its input until completion or
                    # explicit cancellation, including lengthy outages.
                    with self.store.lock(path.parent.name):
                        current = self.store.manifest(path.parent.name)
                        if not current["accepted"] and time.time() - current.get("updated_at", 0) > 86400:
                            shutil.rmtree(path.parent)
                    continue
                await self.process(path.parent.name)
            except Exception as exc:
                log.warning("Upload reconciliation failed (%s)", type(exc).__name__)

    async def run(self):
        while not self.stopping.is_set():
            await self.run_once()
            try:
                await asyncio.wait_for(self.stopping.wait(), 5)
            except asyncio.TimeoutError:
                pass

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        self.stopping.set()
        if self.task:
            await self.task


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class RevealWorker:
    """Scan persisted queued/expired work, including lost trigger responses."""
    def __init__(self, storage, processor):
        self.storage, self.processor = storage, processor
        self.task: asyncio.Task | None = None
        self.stopping = asyncio.Event()

    async def run(self):
        while not self.stopping.is_set():
            try:
                ids = await asyncio.to_thread(self.storage.runnable_reveal_jobs)
                for job_id in ids:
                    if self.stopping.is_set():
                        break
                    await self.processor.run(job_id)
            except Exception as exc:
                log.warning("Reveal reconciliation failed (%s)", type(exc).__name__)
            try:
                await asyncio.wait_for(self.stopping.wait(), 10)
            except asyncio.TimeoutError:
                pass

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        self.stopping.set()
        if self.task:
            # A reveal can take minutes, longer than the platform's shutdown
            # grace period. Cancelling processor.run sets its shared `lost`
            # event, which stops the render thread at its next frame boundary;
            # the persisted lease then expires and the next process resumes it.
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
