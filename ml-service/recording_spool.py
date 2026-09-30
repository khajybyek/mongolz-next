"""Durable encrypted recording delivery, independent of camera/process lifetime.

Mount RECORDING_SPOOL_DIR on persistent storage in production. One manifest
owns a stable recording UUID and object paths; replay uses Storage upsert and
a database upsert, so a lost acknowledgement never creates a second row.
Both original and baked playback files are encrypted while awaiting delivery.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
import fcntl
import json
import logging
import os
from pathlib import Path
import shutil
import tempfile
import time
from uuid import UUID

from crypto_utils import decrypt_bytes, encrypt_bytes

log = logging.getLogger("mongolz-ml.recording-spool")
RETRY_INTERVAL_SEC = 30
_spool: RecordingSpool | None = None


def _sync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_write(path: Path, data: bytes) -> None:
    """Never expose a partial ciphertext or manifest, including after reboot."""
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync_dir(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


class RecordingSpool:
    def __init__(self, directory: str | Path):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.root / ".locks").mkdir(exist_ok=True, mode=0o700)
        _sync_dir(self.root.parent)
        self._worker: asyncio.Task | None = None
        self._stop = asyncio.Event()

    @classmethod
    def from_env(cls) -> RecordingSpool:
        configured = os.getenv("RECORDING_SPOOL_DIR")
        volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
        if not configured and volume:
            configured = str(Path(volume) / "recording-spool")
        if os.getenv("RAILWAY_ENVIRONMENT_ID"):
            if not configured or not volume:
                raise RuntimeError("Recording delivery requires a mounted Railway volume")
            root = Path(configured).resolve()
            mount = Path(volume).resolve()
            if not os.path.ismount(mount) or not root.is_relative_to(mount):
                raise RuntimeError("Recording delivery requires RECORDING_SPOOL_DIR inside the mounted Railway volume")
        return cls(configured or str(Path.home() / ".mongolz" / "recording-spool"))

    def _directory(self, recording_id: str) -> Path:
        return self.root / str(UUID(recording_id))

    @contextmanager
    def _locked(self, directory: Path):
        # Stable lock buckets survive job cleanup (at most 256 tiny files).
        # Never unlink a locked inode while another worker may be waiting.
        with (self.root / ".locks" / f"{directory.name[:2]}.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    @staticmethod
    def _save(directory: Path, manifest: dict) -> None:
        _atomic_write(directory / "manifest.json", json.dumps(manifest).encode())

    def _prepare(self, directory: Path, manifest: dict) -> None:
        # A preparing manifest is committed BEFORE any source is removed.
        # Restart can finish an interrupted encryption or clean a plaintext
        # source left by a crash between ciphertext fsync and unlink.
        for artifact in manifest["artifacts"]:
            source = Path(artifact["source"])
            sealed = directory / artifact["file"]
            context = artifact["key_context"]
            if not sealed.exists():
                _atomic_write(sealed, encrypt_bytes(source.read_bytes(), context))
            else:
                # Verify a surviving artifact before dropping its source.
                decrypt_bytes(sealed.read_bytes(), context)
            source.unlink(missing_ok=True)
        manifest["state"] = "ready"
        self._save(directory, manifest)

    def enqueue(
        self,
        recording_id: str,
        row: dict,
        artifacts: list[dict],
        privacy_spans: list[dict] | None = None,
    ) -> None:
        """Atomically register delivery, seal artifacts, then remove plaintext.

        artifacts: source, path (remote key), original (remote stays encrypted
        with the per-recording key — the raw original, and both artifacts of a
        face_encrypted segment: the masked video and the face envelope, ADR
        0013), optional kind (informational).
        privacy_spans (ADR 0012): the segment's capture-time privacy spans
        (``client_span_id, start_offset_sec, end_offset_sec, source``); the
        delivery writes them before the row is marked ready.
        A local encryption/disk failure raises and preserves the manifest and
        every source not yet safely encrypted. Network is never needed here.
        """
        directory = self._directory(recording_id)
        with self._locked(directory):
            directory.mkdir(mode=0o700, exist_ok=True)
            manifest_path = directory / "manifest.json"
            if manifest_path.exists():
                manifest = json.loads(manifest_path.read_text())
                if privacy_spans and not manifest.get("privacy_spans"):
                    manifest["privacy_spans"] = list(privacy_spans)
                    self._save(directory, manifest)
            else:
                # A capture journal may outlive a successfully delivered
                # manifest. Check under the same delivery lock, so replay
                # never publishes an unrecoverable preparing manifest after
                # the delivery worker has retired all of its sources.
                if any(not Path(a["source"]).is_file() for a in artifacts):
                    raise FileNotFoundError("Capture sources have already been retired")
                manifest = {
                    "version": 1, "recording_id": recording_id, "row": row,
                    "state": "preparing", "attempts": 0, "next_retry_at": 0,
                    "last_error": None, "artifacts": [
                        {
                            "source": str(Path(a["source"]).resolve()),
                            "path": a["path"], "original": a["original"],
                            "file": f"{index}.enc",
                            "key_context": recording_id if a["original"] else f"spool:playback:{recording_id}",
                            # Informational (face_encrypted: masked_video /
                            # face_envelope); manifests without it deliver alike.
                            **({"kind": a["kind"]} if a.get("kind") else {}),
                        }
                        for index, a in enumerate(artifacts)
                    ],
                }
                if privacy_spans:
                    manifest["privacy_spans"] = list(privacy_spans)
                self._save(directory, manifest)
                _sync_dir(self.root)
            self._prepare(directory, manifest)

    def deliver(self, storage, recording_id: str, *, force: bool = False) -> bool:
        directory = self._directory(recording_id)
        if not (directory / "manifest.json").exists():
            return True
        delivered = False
        with self._locked(directory):
            manifest_path = directory / "manifest.json"
            if not manifest_path.exists():
                return True
            manifest = json.loads(manifest_path.read_text())
            if not force and manifest["next_retry_at"] > time.time():
                return False
            spans = manifest.get("privacy_spans") or []
            stage = "prepare"
            try:
                self._prepare(directory, manifest)
                if spans:
                    # ADR 0012: the spans reach the database BEFORE the row is
                    # ready (has_original / capture_status='ready'), so the
                    # footage is never revealable without them. The
                    # placeholder is a no-op when the row already exists.
                    # Written before the uploads, so a span write that keeps
                    # failing (for example ML deployed before migration
                    # 20260928100000) costs one database call per retry, not
                    # a re-upload of the whole segment.
                    stage = "privacy_spans"
                    storage.ensure_recording_placeholder(recording_id, manifest["row"])
                    storage.upsert_privacy_spans(recording_id, spans)
                stage = "upload"
                for artifact in manifest["artifacts"]:
                    ciphertext = (directory / artifact["file"]).read_bytes()
                    plaintext = decrypt_bytes(ciphertext, artifact["key_context"])
                    payload = ciphertext if artifact["original"] else plaintext
                    content_type = "application/octet-stream" if artifact["original"] else "video/mp4"
                    uploaded = storage.upload_bytes("recordings", artifact["path"], payload, content_type)
                    if uploaded != artifact["path"]:
                        raise RuntimeError("Storage did not acknowledge recording upload")
                stage = "commit"
                storage.commit_recording_delivery(recording_id, manifest["row"])
                # Delete only after both remote objects AND the recording row
                # are acknowledged. A crash before cleanup replays idempotently.
                shutil.rmtree(directory)
                _sync_dir(self.root)
                delivered = True
            except Exception as exc:
                manifest["attempts"] += 1
                manifest["last_error"] = type(exc).__name__
                manifest["last_stage"] = stage
                manifest["next_retry_at"] = time.time() + min(30 * 2 ** min(manifest["attempts"] - 1, 7), 3600)
                self._save(directory, manifest)
                log.error("Recording %s delivery pending (attempt %d, %s)",
                          recording_id, manifest["attempts"], manifest["last_error"])
                if stage == "privacy_spans":
                    # Not transient-looking on purpose: the footage stays in
                    # the spool (encrypted, not playable, not revealable)
                    # until its spans can be written, and capture stops once
                    # the spool reaches RECORDING_MAX_PENDING_BYTES.
                    log.error(
                        "Recording %s: its privacy spans could not be written (%s) — delivery held "
                        "until they are. Check that migration 20260928100000 (recording_privacy_spans) "
                        "is applied and the database is reachable (ADR 0012)",
                        recording_id, manifest["last_error"],
                    )
        return delivered

    def has_pending(self, recording_id: str) -> bool:
        return (self._directory(recording_id) / "manifest.json").exists()

    def retry_due(self, storage) -> None:
        for manifest in sorted(self.root.glob("*/manifest.json")):
            try:
                self.deliver(storage, manifest.parent.name)
            except Exception as exc:
                # A corrupt job or unavailable disk must not starve others.
                log.error("Spool job %s could not be retried (%s)", manifest.parent.name, type(exc).__name__)

    async def _run(self, storage) -> None:
        # First pass runs at startup; persisted backoff remains respected.
        while not self._stop.is_set():
            await asyncio.to_thread(self.retry_due, storage)
            try:
                await asyncio.wait_for(self._stop.wait(), RETRY_INTERVAL_SEC)
            except asyncio.TimeoutError:
                pass

    def start(self, storage) -> None:
        if self._worker and not self._worker.done():
            return
        self._stop.clear()
        self._worker = asyncio.create_task(self._run(storage))

    async def stop(self) -> None:
        self._stop.set()
        if self._worker:
            # Do not cancel a to_thread upload: let its commit/lock finish.
            await self._worker
            self._worker = None


def get_recording_spool() -> RecordingSpool:
    global _spool
    if _spool is None:
        _spool = RecordingSpool.from_env()
    return _spool
