"""Outage/restart tests use real encryption and filesystem commits; no network."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from uuid import uuid4

import pytest
import cv2
import numpy as np

import crypto_utils
import recording_pipeline as pipeline
import recording_spool as spool_module
from recording_spool import RecordingSpool
from storage import SupabaseStorage

def _video_bytes(shade):
    # The delivery tests also cross capture validation. Use actual decodable
    # media so outage replay can never regress to accepting arbitrary bytes.
    with tempfile.TemporaryDirectory() as directory:
        path = str(Path(directory) / "video.mp4")
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 15, (64, 48))
        assert writer.isOpened()
        for i in range(45):
            writer.write(np.full((48, 64, 3), (shade + i) % 255, dtype=np.uint8))
        writer.release()
        return Path(path).read_bytes()


ORIGINAL = _video_bytes(10)
PLAYBACK = _video_bytes(100)


class FakeStorage:
    def __init__(self, failure=None):
        self.failure = failure
        self.objects = {}
        self.rows = {}
        self.deleted = []
        self.uploads = 0

    def upload_bytes(self, bucket, path, payload, content_type):
        self.uploads += 1
        if self.failure == "upload":
            raise ConnectionError("simulated Storage outage")
        self.objects[(bucket, path)] = (payload, content_type)
        return path

    def commit_recording_delivery(self, recording_id, fields):
        if self.failure == "database":
            raise ConnectionError("simulated DB outage")
        self.rows[recording_id] = {"id": recording_id, **fields}
        if self.failure == "lost_database_ack":
            raise ConnectionError("DB committed but connection closed before response")

    async def delete_recording(self, recording_id):
        self.deleted.append(recording_id)
        self.rows.pop(recording_id, None)


@pytest.fixture
def spool(tmp_path, monkeypatch):
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"s" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    result = RecordingSpool(tmp_path / "persistent-volume")
    monkeypatch.setattr(pipeline, "get_recording_spool", lambda: result)
    return result


def make_session(tmp_path, mode, storage):
    # Exercise the real _finalize without loading models/starting FFmpeg.
    session = pipeline.RecordingSession.__new__(pipeline.RecordingSession)
    session.recording_id = str(uuid4())
    session.arcface_tasks = []
    session.recorded_frames = 45
    session.fps = 15
    session.started_at = datetime.now(timezone.utc)
    session.storage = storage
    session.blur_strategy = mode
    session._row_inserted = True
    session._delivery_enqueued = False
    session.db_camera_id = None
    session.camera_name = "Test camera"
    session.display_filename = "test.mp4"
    session.blurred_path = str(tmp_path / "playback.mp4")
    session.original_path = str(tmp_path / "original.mp4")
    session.filename_original = f"camera/{session.recording_id}/original.enc"
    session.filename_blurred = f"camera/{session.recording_id}/playback.mp4"
    Path(session.original_path).write_bytes(ORIGINAL)
    if mode == "baked":
        Path(session.blurred_path).write_bytes(PLAYBACK)
    storage.rows[session.recording_id] = {"id": session.recording_id, "ended_at": None}
    return session


@pytest.mark.parametrize("mode", ["baked", "on_demand"])
@pytest.mark.parametrize("failure", ["upload", "database", "lost_database_ack"])
def test_outage_restart_replays_without_plaintext_or_duplicate_rows(tmp_path, monkeypatch, spool, mode, failure):
    storage = FakeStorage(failure)
    session = make_session(tmp_path, mode, storage)
    asyncio.run(session._finalize())

    assert not Path(session.original_path).exists()
    assert not Path(session.blurred_path).exists()
    manifest_path = spool.root / session.recording_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    assert manifest["attempts"] == 1
    assert manifest["next_retry_at"] > 0
    assert manifest["last_error"] == "ConnectionError"
    for sealed in manifest_path.parent.glob("*.enc"):
        assert ORIGINAL not in sealed.read_bytes()
        assert PLAYBACK not in sealed.read_bytes()

    # Simulate an independent process reopening only the persistent volume.
    restarted = RecordingSpool(spool.root)
    storage.failure = None
    monkeypatch.setattr(spool_module.time, "time", lambda: manifest["next_retry_at"] + 1)
    restarted.retry_due(storage)
    assert not restarted.has_pending(session.recording_id)
    assert len(storage.rows) == 1
    row = storage.rows[session.recording_id]
    assert row["duration_sec"] == 3 and row["ended_at"]
    encrypted, content_type = storage.objects[("recordings", session.filename_original)]
    assert content_type == "application/octet-stream"
    assert crypto_utils.decrypt_bytes(encrypted, session.recording_id) == ORIGINAL
    if mode == "baked":
        assert storage.objects[("recordings", session.filename_blurred)] == (PLAYBACK, "video/mp4")
    else:
        assert len(storage.objects) == 1

    # A repeated stop/finalize after worker delivery cannot delete the row.
    asyncio.run(session._finalize())
    assert storage.deleted == [] and len(storage.rows) == 1


def test_interrupted_sealing_resumes_from_manifest(tmp_path, monkeypatch, spool):
    storage = FakeStorage()
    session = make_session(tmp_path, "baked", storage)
    real_encrypt = spool_module.encrypt_bytes

    def fail_playback(plaintext, context):
        if context.startswith("spool:"):
            raise OSError("simulated disk/encryption failure")
        return real_encrypt(plaintext, context)

    monkeypatch.setattr(spool_module, "encrypt_bytes", fail_playback)
    with pytest.raises(OSError):
        asyncio.run(session._finalize())
    assert not Path(session.original_path).exists()  # safely sealed already
    assert Path(session.blurred_path).exists()  # never destroy an unsealed source
    assert spool.has_pending(session.recording_id)
    assert storage.uploads == 0

    monkeypatch.setattr(spool_module, "encrypt_bytes", real_encrypt)
    RecordingSpool(spool.root).retry_due(storage)
    assert not Path(session.blurred_path).exists()
    assert not spool.has_pending(session.recording_id)
    assert storage.rows[session.recording_id]["ended_at"]


def test_retry_backoff_survives_new_spool_instance(tmp_path, spool):
    storage = FakeStorage("upload")
    session = make_session(tmp_path, "on_demand", storage)
    asyncio.run(session._finalize())
    attempts = storage.uploads
    RecordingSpool(spool.root).retry_due(storage)
    assert storage.uploads == attempts


def test_startup_worker_then_periodic_delivery(tmp_path, monkeypatch, spool):
    storage = FakeStorage()
    first = make_session(tmp_path, "on_demand", storage)
    spool.enqueue(first.recording_id, {"filename": "first.mp4"}, [
        {"source": first.original_path, "path": first.filename_original, "original": True},
    ])
    monkeypatch.setattr(spool_module, "RETRY_INTERVAL_SEC", 0.01)

    async def wait_delivered(recording_id):
        for _ in range(100):
            if not spool.has_pending(recording_id):
                return
            await asyncio.sleep(0.01)
        pytest.fail("delivery worker did not drain the job")

    async def run():
        spool.start(storage)
        try:
            await wait_delivered(first.recording_id)
            second = make_session(tmp_path, "on_demand", storage)
            await asyncio.to_thread(spool.enqueue, second.recording_id, {"filename": "second.mp4"}, [
                {"source": second.original_path, "path": second.filename_original, "original": True},
            ])
            await wait_delivered(second.recording_id)
        finally:
            await spool.stop()

    asyncio.run(run())
    assert len(storage.rows) == 2


def test_missing_storage_ack_preserves_ciphertext(tmp_path, spool):
    storage = FakeStorage()
    storage.upload_bytes = lambda *args: ""
    session = make_session(tmp_path, "on_demand", storage)
    asyncio.run(session._finalize())
    assert spool.has_pending(session.recording_id)
    assert storage.rows[session.recording_id]["ended_at"] is None


def test_database_delivery_upserts_fixed_id_and_requires_ack():
    storage = SupabaseStorage.__new__(SupabaseStorage)
    calls = []
    class Query:
        def upsert(self, row, on_conflict):
            calls.append((row, on_conflict))
            return self
        def execute(self):
            return SimpleNamespace(data=[{"id": "recording-1"}])
    storage.client = SimpleNamespace(table=lambda table: Query())
    storage.commit_recording_delivery("recording-1", {"filename": "one.mp4"})
    storage.commit_recording_delivery("recording-1", {"filename": "one.mp4"})
    assert calls == [({"id": "recording-1", "filename": "one.mp4"}, "id")] * 2
    storage.client = None
    with pytest.raises(RuntimeError):
        storage.commit_recording_delivery("recording-1", {})


def test_railway_without_persistent_spool_fails_closed(monkeypatch):
    monkeypatch.delenv("RECORDING_SPOOL_DIR", raising=False)
    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "test-environment")
    with pytest.raises(RuntimeError, match="mounted Railway volume"):
        RecordingSpool.from_env()


def test_railway_spool_must_be_inside_real_mount(monkeypatch, tmp_path):
    mount = tmp_path / "volume"
    mount.mkdir()
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "test-environment")
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", str(mount))
    monkeypatch.setenv("RECORDING_SPOOL_DIR", str(mount / "spool"))
    monkeypatch.setattr(spool_module.os.path, "ismount", lambda path: False)
    with pytest.raises(RuntimeError, match="mounted Railway volume"):
        RecordingSpool.from_env()

    monkeypatch.setattr(spool_module.os.path, "ismount", lambda path: True)
    monkeypatch.setenv("RECORDING_SPOOL_DIR", str(tmp_path / "outside"))
    with pytest.raises(RuntimeError, match="inside the mounted Railway volume"):
        RecordingSpool.from_env()
