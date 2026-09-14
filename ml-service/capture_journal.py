"""Recovery of the small capture-to-encrypted-spool commit window.

Only fully decoded, closed segments have state=validated. An interrupted active
segment is explicitly partial and its temporary plaintext is discarded. Thus a
hard kill can lose at most one configured segment; earlier commits survive.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import shutil

from recording_spool import _atomic_write, get_recording_spool

log = logging.getLogger("mongolz-ml.capture-recovery")


def recordings_directory() -> str:
    volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
    root = Path(os.getenv("RECORDINGS_DIR") or str(Path(volume or "/tmp") / "mongolz-recordings")).resolve()
    if os.getenv("RAILWAY_ENVIRONMENT_ID"):
        if not volume or not os.path.ismount(volume) or not root.is_relative_to(Path(volume).resolve()):
            raise RuntimeError("Capture requires RECORDINGS_DIR inside the mounted Railway volume")
    return str(root)


def write_journal(path: str | Path, data: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    _atomic_write(target, json.dumps(data).encode())


def check_capture_capacity(directory: str, spool_root: Path) -> None:
    maximum = int(os.getenv("RECORDING_MAX_PENDING_BYTES", str(2 * 1024 ** 3)))
    reserve = int(os.getenv("RECORDING_MIN_FREE_BYTES", str(256 * 1024 ** 2)))
    candidates = {Path(directory).resolve(), spool_root.resolve()}
    roots = {root for root in candidates if not any(root != parent and root.is_relative_to(parent) for parent in candidates)}
    total = 0
    for root in roots:
        for path in root.rglob("*"):
            try:
                if path.is_file():
                    total += path.stat().st_size
            except FileNotFoundError:
                pass  # The delivery worker may have just retired this file.
    if total >= maximum or shutil.disk_usage(directory).free < reserve:
        raise RuntimeError("recording capacity exhausted; delivery must recover")


async def recover_captures(storage, directory: str) -> None:
    spool = get_recording_spool()
    for journal in sorted(Path(directory).glob("*/*.capture.json")):
        try:
            data = json.loads(journal.read_text())
            recording_id = data["recording_id"]
            if data["state"] == "validated":
                # enqueue can remove sources before the caller removes its
                # journal. The startup spool worker may already have delivered
                # that manifest, so a missing source needs an explicit remote
                # acknowledgement instead of creating an unrecoverable job.
                if not spool.has_pending(recording_id):
                    missing = any(not Path(a["source"]).exists() for a in data["artifacts"])
                    if missing:
                        if not await asyncio.to_thread(storage.upload_recording_ready, recording_id):
                            raise RuntimeError("Validated capture has no source or delivery acknowledgement")
                        journal.unlink(missing_ok=True)
                        continue
                try:
                    await asyncio.to_thread(spool.enqueue, recording_id, data["row"], data["artifacts"])
                except FileNotFoundError:
                    # A delivery may win the race after has_pending above.
                    # enqueue checks sources while holding the spool lock.
                    if not await asyncio.to_thread(storage.upload_recording_ready, recording_id):
                        raise
                    journal.unlink(missing_ok=True)
                    continue
                await asyncio.to_thread(spool.deliver, storage, recording_id)
            else:
                # Never advertise an interrupted encoder as playable. Remove
                # plaintext even if the DB is down; leave the journal to retry
                # the visible partial-state update on the next startup.
                for path in data["sources"]:
                    Path(path).unlink(missing_ok=True)
                fields = {
                    "capture_status": "partial", "has_original": False,
                    "capture_error": "Service restarted before this segment was committed",
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                }
                if data.get("row"):
                    await asyncio.to_thread(storage.commit_recording_delivery, recording_id, {**data["row"], **fields})
                else:
                    await storage.update_recording(recording_id, fields)
            journal.unlink(missing_ok=True)
        except Exception as exc:
            log.warning("Capture recovery pending for %s (%s)", journal.name, type(exc).__name__)
