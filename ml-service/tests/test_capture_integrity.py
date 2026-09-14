"""Source-clock and crash recovery regressions with real tiny media files."""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import cv2
import numpy as np
import pytest
import capture_journal
import crypto_utils
import recording_pipeline as pipeline
from capture_integrity import SourceSampler, close_encoder, validate_capture
from recording_spool import RecordingSpool
from tests.test_recording_spool import FakeStorage, make_session

class CaptureStorage(FakeStorage):
    client = None
    async def insert_recording_returning_id(self, **fields):
        recording_id = fields.pop("recording_id")
        self.rows[recording_id] = {"id": recording_id, **fields}
        return recording_id
    async def update_recording(self, recording_id, fields):
        if self.failure == "database":
            raise ConnectionError("database offline")
        self.rows[recording_id].update(fields)
    def upload_recording_ready(self, recording_id):
        return self.rows.get(recording_id, {}).get("capture_status") == "ready"

@pytest.fixture
def capture_spool(tmp_path, monkeypatch):
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"s" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    spool = RecordingSpool(tmp_path / "volume" / "spool")
    monkeypatch.setattr(pipeline, "get_recording_spool", lambda: spool)
    monkeypatch.setattr(capture_journal, "get_recording_spool", lambda: spool)
    monkeypatch.setenv("BLUR_STRATEGY", "on_demand")
    monkeypatch.setenv("RECORDING_SEGMENT_SECONDS", "1")
    monkeypatch.setenv("RECORDING_MIN_FREE_BYTES", "0")
    return spool

def new_session(tmp_path, storage, source="unopened-live-source"):
    session = pipeline.RecordingSession("capture_test", "Test camera", str(source),
        SimpleNamespace(cosine=lambda a, b: 0), storage, str(tmp_path / "hls"),
        str(tmp_path / "volume" / "captures"))
    session._process_arcface = AsyncMock()
    return session

def clip(path, fps, count):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (128, 96))
    assert writer.isOpened()
    for i in range(count):
        writer.write(np.full((96, 128, 3), i % 255, dtype=np.uint8))
    writer.release()

@pytest.mark.parametrize("fps,count", [(24,96), (25,100), (29.97,120), (30,120), (60,240)])
def test_file_duration_and_face_offsets_follow_source_not_processing_clock(tmp_path, capture_spool, fps, count):
    assert shutil.which("ffmpeg"), "Capture tests require the service's FFmpeg dependency"
    source = tmp_path / "source.mp4"
    clip(source, fps, count)
    storage = CaptureStorage()
    session = new_session(tmp_path, storage, source)
    async def run():
        await session.start()
        await session.task
        assert session.input_complete
        await session.stop()
    asyncio.run(run())
    assert session.processing_complete
    row = storage.rows[session.recording_id]
    assert row["capture_status"] == "ready"
    assert abs(row["duration_sec"] - count / fps) <= 1 / 15 + 0.001
    assert (datetime.fromisoformat(row["ended_at"]) - session.started_at).total_seconds() == pytest.approx(row["duration_sec"], abs=1e-6)
    output = tmp_path / "output.mp4"
    output.write_bytes(crypto_utils.decrypt_bytes(storage.objects[("recordings", session.filename_original)][0], session.recording_id))
    assert validate_capture(str(output), session.recorded_frames, 15) == row["duration_sec"]
    for call in session._process_arcface.call_args_list:
        offset = call.kwargs["source_offset_sec"]
        assert offset == int(offset)
        assert call.kwargs["captured_at"] == session.capture_started_at + timedelta(seconds=offset)
    assert len(session._process_arcface.call_args_list) >= 4

def test_vfr_sample_hold_and_missing_live_pts():
    sampler = SourceSampler(25, 10)
    output = []
    for frame, pts in enumerate((0, 0.04, 0.12, 0.28)):
        output.extend(sampler.push(frame, pts))
    output.extend(sampler.finish())
    assert output == [(0,0), (0.1,1), (0.2,2), (0.3,3)]
    assert abs(len(output) / 10 - 0.32) <= 0.1
    live = SourceSampler(30, 15)
    live.push("first", 0, fallback_sec=0)
    assert len(live.push("next", 0, fallback_sec=1)) == 15
    assert len(live.push("third", 0, fallback_sec=2)) == 15

def test_timestamp_discontinuity_does_not_build_unbounded_queue():
    sampler = SourceSampler(25, 15)
    sampler.push("one", 0)
    with pytest.raises(RuntimeError, match="discontinuity"):
        sampler.push("two", 3600)

def test_encoder_exit_broken_pipe_and_timeout_are_errors():
    proc = Mock()
    proc.stdin.closed = False
    proc.wait.return_value = 1
    with pytest.raises(RuntimeError, match="encoder failed"):
        close_encoder(proc)
    proc.poll.return_value = None
    proc.stdin.write.side_effect = BrokenPipeError()
    with pytest.raises(RuntimeError, match="input failed"):
        pipeline.RecordingSession._write_safe(proc, np.zeros((8,8,3), dtype=np.uint8))
    proc.wait.side_effect = [subprocess.TimeoutExpired("ffmpeg",10), 0]
    with pytest.raises(RuntimeError, match="timed out"):
        close_encoder(proc)
    proc.terminate.assert_called_once()

def test_invalid_or_missing_frames_never_enter_delivery(tmp_path, capture_spool):
    storage = CaptureStorage()
    session = make_session(tmp_path,"on_demand",storage)
    Path(session.original_path).write_bytes(b"invalid mp4" * 200)
    with pytest.raises(RuntimeError, match="readable"):
        asyncio.run(session._finalize())
    assert not capture_spool.has_pending(session.recording_id)
    assert storage.uploads == 0
    clip(Path(session.original_path),15,44)
    with pytest.raises(RuntimeError, match="incomplete"):
        asyncio.run(session._finalize())
    assert storage.uploads == 0

def test_hard_kill_loses_only_current_segment_and_recovers_previous_commits(tmp_path,capture_spool):
    storage = CaptureStorage()
    session = new_session(tmp_path,storage)
    async def capture_then_crash():
        session._journal_active()
        await session._open_recording_row()
        session.original_writer = pipeline._ffmpeg_mp4_writer(session.original_path,128,96,15)
        for i in range(35):
            await session._emit_frame(i/15,np.full((96,128,3),i,dtype=np.uint8))
        session.original_writer.kill()
        session.original_writer.wait()
        try:
            session.original_writer.stdin.close()
        except BrokenPipeError:
            pass  # Expected after killing an encoder with buffered stdin.
        await asyncio.gather(*session.arcface_tasks)
    asyncio.run(capture_then_crash())
    committed_ids = [path.parent.name for path in capture_spool.root.glob("*/manifest.json")]
    assert len(committed_ids) == 2
    assert session.journal_path.exists()
    root = str(Path(session.rec_dir).parent)
    asyncio.run(capture_journal.recover_captures(storage,root))
    RecordingSpool(capture_spool.root).retry_due(storage)
    for recording_id in committed_ids:
        assert storage.rows[recording_id]["capture_status"] == "ready"
        assert storage.rows[recording_id]["duration_sec"] == 1
    assert storage.rows[session.recording_id]["capture_status"] == "partial"
    assert not storage.rows[session.recording_id]["has_original"]
    assert not session.journal_path.exists()
    assert not list(Path(root).rglob("*.mp4"))

def test_validated_journal_recovers_before_or_after_spool_delivery(tmp_path,capture_spool,monkeypatch):
    storage = CaptureStorage()
    session = new_session(tmp_path,storage)
    original_enqueue = capture_spool.enqueue
    async def crash_before_enqueue():
        session._journal_active()
        await session._open_recording_row()
        session.original_writer = pipeline._ffmpeg_mp4_writer(session.original_path,128,96,15)
        for i in range(10):
            await session._emit_frame(i/15,np.zeros((96,128,3),dtype=np.uint8))
        await session._close_writers()
        monkeypatch.setattr(capture_spool,"enqueue",Mock(side_effect=OSError("disk interruption")))
        with pytest.raises(OSError):
            await session._finalize()
    asyncio.run(crash_before_enqueue())
    assert json.loads(session.journal_path.read_text())["state"] == "validated"
    journal = session.journal_path.read_bytes()
    monkeypatch.setattr(capture_spool,"enqueue",original_enqueue)
    root = str(Path(session.rec_dir).parent)
    asyncio.run(capture_journal.recover_captures(storage,root))
    assert storage.rows[session.recording_id]["capture_status"] == "ready"
    assert not session.journal_path.exists()
    assert not capture_spool.has_pending(session.recording_id)
    session.journal_path.write_bytes(journal)
    asyncio.run(capture_journal.recover_captures(storage,root))
    assert not session.journal_path.exists()
    assert not capture_spool.has_pending(session.recording_id)
    assert len(storage.rows) == 1

def test_partial_recovery_keeps_retry_marker_during_database_outage(tmp_path,capture_spool):
    storage = CaptureStorage("database")
    session = new_session(tmp_path,storage)
    asyncio.run(session._open_recording_row())
    session._journal_active()
    Path(session.original_path).write_bytes(b"unfinished plaintext")
    root = str(Path(session.rec_dir).parent)
    asyncio.run(capture_journal.recover_captures(storage,root))
    assert not Path(session.original_path).exists()
    assert session.journal_path.exists()
    storage.failure = None
    asyncio.run(capture_journal.recover_captures(storage,root))
    assert not session.journal_path.exists()
    assert storage.rows[session.recording_id]["capture_status"] == "partial"

def test_capture_directory_must_be_within_real_production_mount(tmp_path,monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID","production")
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH",str(tmp_path))
    monkeypatch.setenv("RECORDINGS_DIR","/tmp/captures")
    monkeypatch.setattr(capture_journal.os.path,"ismount",lambda path: True)
    with pytest.raises(RuntimeError,match="mounted Railway volume"):
        capture_journal.recordings_directory()
    monkeypatch.delenv("RECORDINGS_DIR")
    assert capture_journal.recordings_directory() == str(tmp_path/"mongolz-recordings")
    monkeypatch.setattr(capture_journal.os.path,"ismount",lambda path: False)
    with pytest.raises(RuntimeError,match="mounted Railway volume"):
        capture_journal.recordings_directory()

def test_capacity_stops_capture_before_disk_exhaustion(tmp_path,capture_spool,monkeypatch):
    monkeypatch.setenv("RECORDING_MAX_PENDING_BYTES","10")
    (capture_spool.root/"pending.enc").write_bytes(b"x" * 11)
    with pytest.raises(RuntimeError,match="capacity exhausted"):
        capture_journal.check_capture_capacity(str(tmp_path),capture_spool.root)

def test_interrupted_capture_gets_metadata_after_initial_database_outage(tmp_path,capture_spool):
    storage = CaptureStorage()
    session = new_session(tmp_path,storage)
    # No recording row was ever inserted; the active journal is the record.
    session._journal_active()
    root = str(Path(session.rec_dir).parent)
    asyncio.run(capture_journal.recover_captures(storage,root))
    assert storage.rows[session.recording_id]["capture_status"] == "partial"
    assert storage.rows[session.recording_id]["camera_name"] == "Test camera"
    assert storage.rows[session.recording_id]["ended_at"]
    assert not session.journal_path.exists()

def test_valid_upload_is_complete_while_remote_delivery_is_pending(tmp_path,capture_spool):
    source = tmp_path / "source.mp4"
    clip(source,25,25)
    storage = CaptureStorage("upload")
    session = new_session(tmp_path,storage,source)
    async def run():
        await session.start()
        await session.task
        await session.stop()
    asyncio.run(run())
    assert session.input_complete and session.processing_complete
    assert capture_spool.has_pending(session.recording_id)
    assert storage.rows[session.recording_id]["capture_status"] == "capturing"
    assert not Path(session.original_path).exists()
    storage.failure = None
    assert capture_spool.deliver(storage,session.recording_id,force=True)
    assert storage.rows[session.recording_id]["capture_status"] == "ready"

def test_cancel_preserves_sources_owned_by_preparing_spool(tmp_path,capture_spool,monkeypatch):
    import recording_spool
    storage = CaptureStorage()
    session = new_session(tmp_path,storage)
    clip(Path(session.original_path),15,15)
    monkeypatch.setattr(recording_spool,"encrypt_bytes",Mock(side_effect=OSError("disk full")))
    with pytest.raises(OSError):
        capture_spool.enqueue(session.recording_id,{},[{"source":session.original_path,"path":session.filename_original,"original":True}])
    assert capture_spool.has_pending(session.recording_id)
    asyncio.run(session.stop(finalize=False))
    assert Path(session.original_path).exists()
    assert not session.processing_complete

def test_stop_without_eof_cannot_publish_partial_upload(tmp_path,capture_spool):
    storage = CaptureStorage()
    session = new_session(tmp_path,storage)
    session._is_file_mode = True
    asyncio.run(session._open_recording_row())
    clip(Path(session.original_path),15,15)
    session.recorded_frames = 15
    with pytest.raises(RuntimeError,match="EOF"):
        asyncio.run(session.stop())
    assert storage.rows[session.recording_id]["capture_status"] == "failed"
    assert not session.processing_complete
    assert not capture_spool.has_pending(session.recording_id)
    assert not Path(session.original_path).exists()

def test_missing_capture_source_never_creates_poison_spool_manifest(tmp_path,capture_spool):
    from uuid import uuid4
    recording_id = str(uuid4())
    with pytest.raises(FileNotFoundError):
        capture_spool.enqueue(recording_id,{},[{"source":str(tmp_path/"retired.mp4"),"path":"original.enc","original":True}])
    assert not capture_spool.has_pending(recording_id)
