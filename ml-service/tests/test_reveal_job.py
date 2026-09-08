"""Reveal render failure contract (audit 4.6).

A reveal output is the forensic artifact the 4-eyes approval exists to
control. Before this batch, an ffmpeg that died mid-render (OOM on the shared
Railway box, disk full, x264 error) made `encoder.stdin.write` raise, the loop
`break`, and the job upload whatever bytes existed and report `completed` — an
investigation could act on a truncated video with no signal frames were
missing. These tests pin the new contract:

  • encoder dies mid-write        → job `failed`, NOTHING uploaded
  • encoder exits non-zero        → render raises, no artifact
  • encoder hangs                 → terminated/killed, render raises
  • output short of what we wrote → rejected before upload
  • DB read failures              → honest reason, not "no original" / "no target"
  • a healthy render              → still completes and uploads (regression guard)
"""

from __future__ import annotations

import base64
import os
import secrets
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault(
    "ML_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import reveal_job  # noqa: E402
from reveal_job import RevealDataError, RevealProcessor, RevealRenderError  # noqa: E402


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=True,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


HAVE_FFMPEG = _ffmpeg_available()
needs_ffmpeg = pytest.mark.skipif(
    not HAVE_FFMPEG, reason="ffmpeg binary not available in the test environment"
)

JOB_ID = "33333333-3333-3333-3333-333333333333"
RECORDING_ID = "44444444-4444-4444-4444-444444444444"


def _make_clip(path: str, w: int = 320, h: int = 240, frames: int = 8, fps: int = 15) -> int:
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    assert writer.isOpened(), "synthetic MP4 writer failed to open"
    rng = np.random.RandomState(7)
    for _ in range(frames):
        writer.write(rng.randint(0, 255, (h, w, 3), dtype=np.uint8))
    writer.release()
    return frames


def _engine() -> Mock:
    """Face engine that detects nothing — the render path is what's under test."""
    engine = Mock()
    engine.detect_all.return_value = []
    engine.cosine.return_value = 0.0
    return engine


# ── a small PostgREST-shaped fake so we can assert what was written ────
class _Query:
    def __init__(self, db: "FakeDB", table: str):
        self.db = db
        self.table_name = table
        self.op = "select"
        self.fields: dict = {}
        self.eqs: dict = {}
        self.ins: dict = {}

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def update(self, fields):
        self.op = "update"
        self.fields = fields
        return self

    def eq(self, key, value):
        self.eqs[key] = value
        return self

    def in_(self, key, values):
        self.ins[key] = list(values)
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self.db.error:
            raise self.db.error
        if self.op == "update":
            return SimpleNamespace(data=self.db.apply_update(self))
        if self.table_name == "reveal_jobs":
            return SimpleNamespace(data=dict(self.db.job))
        if self.table_name == "recordings":
            return SimpleNamespace(data=self.db.recording)
        if self.table_name == "privacy_zones":
            return SimpleNamespace(data=list(self.db.zones))
        if self.table_name == "faces":
            return SimpleNamespace(data=list(self.db.faces))
        raise AssertionError(f"unexpected table {self.table_name}")


class FakeDB:
    def __init__(self, job: dict, recording: dict | None, blob: bytes):
        self.job = job
        self.recording = recording
        self.zones: list[dict] = []
        self.faces: list[dict] = []
        self.error: Exception | None = None
        self.updates: list[dict] = []
        self.blob = blob
        self.storage = SimpleNamespace(
            from_=lambda _bucket: SimpleNamespace(download=lambda _p: self.blob)
        )

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def apply_update(self, q: _Query) -> list[dict]:
        self.updates.append(dict(q.fields))
        # Compare-and-set semantics: `.eq("status", ...)` / `.in_("status", …)`
        # only match when the row is in that state, like PostgREST.
        want_eq = q.eqs.get("status")
        want_in = q.ins.get("status")
        current = self.job.get("status")
        if want_eq is not None and current != want_eq:
            return []
        if want_in is not None and current not in want_in:
            return []
        self.job.update(q.fields)
        return [dict(self.job)]


class FakeStorage:
    def __init__(self, db: FakeDB):
        self.client = db
        self.uploads: list[tuple[str, str, int]] = []
        self.upload_error: Exception | None = None
        self.upload_returns: str | None = None

    def upload_bytes(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        if self.upload_error:
            raise self.upload_error
        self.uploads.append((bucket, path, len(data)))
        return path if self.upload_returns is None else self.upload_returns


def _job_row(**overrides) -> dict:
    row = {
        "id": JOB_ID,
        "status": "queued",
        "recording_id": RECORDING_ID,
        "recordings": {
            "filename": "clip.mp4",
            "storage_path": "rec.mp4",
            "camera_id": None,  # uploaded footage → no camera privacy zones
        },
        "reveal_level": 0,
        "threshold": 0.45,
        "query_embedding": [0.1] * 512,
        "requested_email": "admin@mongolz.local",
        "created_at": "2026-09-08T00:00:00+00:00",
        "target_start_sec": None,
        "target_end_sec": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def processor(tmp_path):
    """RevealProcessor wired to the fake DB + storage, with a real clip blob."""
    source = tmp_path / "source.mp4"
    _make_clip(str(source))
    db = FakeDB(
        _job_row(),
        {"original_path": "rec.mp4", "has_original": True},
        source.read_bytes(),
    )
    storage = FakeStorage(db)
    return RevealProcessor(_engine(), storage), db, storage


# ── encoder doubles ────────────────────────────────────────────────────
class _DyingStdin:
    """Writes fine for `ok_frames`, then behaves like a pipe to a dead ffmpeg."""

    def __init__(self, ok_frames: int):
        self.ok_frames = ok_frames
        self.writes = 0

    def write(self, data: bytes) -> int:
        self.writes += 1
        if self.writes > self.ok_frames:
            raise BrokenPipeError(32, "Broken pipe")
        return len(data)

    def close(self) -> None:
        pass


def _dying_encoder(ok_frames: int = 3, exit_code: int = -9) -> Mock:
    enc = Mock()
    enc.stdin = _DyingStdin(ok_frames)
    enc.wait.return_value = exit_code
    return enc


class _DroppingWriter:
    """Forwards the first `keep` frames to the real ffmpeg, silently drops the
    rest — a write path that *reports* success while losing footage."""

    def __init__(self, pipe, keep: int):
        self._pipe = pipe
        self._keep = keep
        self.writes = 0

    def write(self, data: bytes) -> int:
        self.writes += 1
        if self.writes <= self._keep:
            return self._pipe.write(data)
        return len(data)

    def flush(self) -> None:
        self._pipe.flush()

    def close(self) -> None:
        self._pipe.close()


# ── 1. encoder dies mid-write ──────────────────────────────────────────
class TestEncoderDeath:
    def test_process_video_raises_and_removes_partial(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        out = str(tmp_path / "out.mp4")
        _make_clip(src)
        with open(out, "wb") as stale:
            stale.write(b"partial" * 500)  # bytes from the doomed render
        enc = _dying_encoder(ok_frames=3)
        monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(return_value=enc))

        proc = RevealProcessor(_engine(), SimpleNamespace(client=Mock()))
        with pytest.raises(RevealRenderError, match="тасарсан"):
            proc._process_video(
                input_mp4=src, output_mp4=out, target_embeddings=[np.ones(512, np.float32)],
                threshold=0.45, job_id=JOB_ID,
            )
        assert not os.path.exists(out), "a truncated render must not survive on disk"
        enc.wait.assert_called()  # ffmpeg reaped, not left running on the box

    @pytest.mark.asyncio
    @needs_ffmpeg
    async def test_job_fails_and_publishes_nothing(self, processor, monkeypatch):
        proc, db, storage = processor
        monkeypatch.setattr(
            reveal_job.subprocess, "Popen", Mock(return_value=_dying_encoder(ok_frames=3))
        )

        await proc.run(JOB_ID)

        assert storage.uploads == [], "a failed render must never be uploaded"
        assert db.job["status"] == "failed"
        assert "тасарсан" in db.job["error_message"]
        assert db.job.get("output_path") is None
        assert not any(u.get("status") == "completed" for u in db.updates)


# ── 2. encoder exits non-zero / hangs ──────────────────────────────────
class TestEncoderExit:
    def test_nonzero_exit_is_not_success(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        _make_clip(src)
        enc = Mock()
        enc.wait.return_value = 1
        monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(return_value=enc))
        proc = RevealProcessor(_engine(), SimpleNamespace(client=Mock()))
        with pytest.raises(RevealRenderError, match="бүрэн үүсээгүй"):
            proc._process_video(
                input_mp4=src, output_mp4=str(tmp_path / "out.mp4"),
                target_embeddings=[np.ones(512, np.float32)], threshold=0.45, job_id=JOB_ID,
            )

    def test_hung_encoder_is_terminated(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        _make_clip(src)
        enc = Mock()
        enc.wait.side_effect = [subprocess.TimeoutExpired("ffmpeg", 30), 0]
        monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(return_value=enc))
        proc = RevealProcessor(_engine(), SimpleNamespace(client=Mock()))
        with pytest.raises(RevealRenderError, match="timed out"):
            proc._process_video(
                input_mp4=src, output_mp4=str(tmp_path / "out.mp4"),
                target_embeddings=[np.ones(512, np.float32)], threshold=0.45, job_id=JOB_ID,
            )
        enc.terminate.assert_called_once()

    def test_empty_input_is_not_an_empty_success(self, tmp_path):
        empty = tmp_path / "empty.mp4"
        empty.write_bytes(b"")
        proc = RevealProcessor(_engine(), SimpleNamespace(client=Mock()))
        with pytest.raises(RevealRenderError):
            proc._process_video(
                input_mp4=str(empty), output_mp4=str(tmp_path / "out.mp4"),
                target_embeddings=[np.ones(512, np.float32)], threshold=0.45, job_id=JOB_ID,
            )


# ── 3. output shorter than what we wrote ───────────────────────────────
@needs_ffmpeg
class TestTruncatedOutput:
    def _truncating_popen(self, keep: int):
        real_popen = subprocess.Popen

        def factory(cmd, **kwargs):
            proc = real_popen(cmd, **kwargs)
            proc.stdin = _DroppingWriter(proc.stdin, keep)
            return proc

        return factory

    def test_short_render_is_rejected(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        out = str(tmp_path / "out.mp4")
        _make_clip(src, frames=8)
        monkeypatch.setattr(reveal_job.subprocess, "Popen", self._truncating_popen(keep=4))
        proc = RevealProcessor(_engine(), SimpleNamespace(client=Mock()))

        # Must fail on the frame-count check specifically (ffmpeg itself exits
        # 0 here — the encoder "succeeded" while footage went missing).
        with pytest.raises(RevealRenderError, match=r"incomplete recording \(4/8 frames\)"):
            proc._process_video(
                input_mp4=src, output_mp4=out,
                target_embeddings=[np.ones(512, np.float32)], threshold=0.45, job_id=JOB_ID,
            )
        assert not os.path.exists(out)

    @pytest.mark.asyncio
    async def test_job_with_short_render_uploads_nothing(self, processor, monkeypatch):
        proc, db, storage = processor
        monkeypatch.setattr(reveal_job.subprocess, "Popen", self._truncating_popen(keep=4))

        await proc.run(JOB_ID)

        assert storage.uploads == []
        assert db.job["status"] == "failed"
        assert "incomplete recording" in db.job["error_message"]

    def test_tolerance_admits_container_rounding_only(self):
        from view_renderer import frame_count_tolerance

        # A fragmented-MP4 count may round by a frame; losing half a clip is
        # never rounding.
        assert frame_count_tolerance(8) == 1
        assert frame_count_tolerance(9000) == 9


# ── 4. healthy render still completes (regression guard) ───────────────
@needs_ffmpeg
@pytest.mark.asyncio
async def test_healthy_render_completes_and_uploads(processor):
    proc, db, storage = processor

    await proc.run(JOB_ID)

    assert db.job["status"] == "completed", db.job.get("error_message")
    assert storage.uploads == [("revealed", f"{JOB_ID}.mp4", storage.uploads[0][2])]
    assert storage.uploads[0][2] > 1000
    assert db.job["output_path"] == f"{JOB_ID}.mp4"
    assert db.job["progress"] == 100


# ── 5. upload / bookkeeping failures stay failures ─────────────────────
@needs_ffmpeg
@pytest.mark.asyncio
async def test_silent_noop_upload_is_not_completion(processor):
    """`upload_bytes` returns "" when there is no storage client — that must
    fail the job, not complete it with a dangling output_path."""
    proc, db, storage = processor
    storage.upload_returns = ""

    await proc.run(JOB_ID)

    assert db.job["status"] == "failed"
    assert db.job["error_message"] == "Upload алдаа"


@needs_ffmpeg
@pytest.mark.asyncio
async def test_upload_exception_fails_the_job(processor):
    proc, db, storage = processor
    storage.upload_error = ConnectionError("storage down")

    await proc.run(JOB_ID)

    assert db.job["status"] == "failed"
    assert storage.uploads == []


# ── 6. read failures report the real reason ────────────────────────────
@pytest.mark.asyncio
async def test_recording_lookup_outage_is_not_reported_as_missing_original(processor):
    proc, db, storage = processor

    async def boom(_rec_id):
        raise RevealDataError("recording lookup failed")

    proc._lookup_original = boom
    await proc.run(JOB_ID)

    assert db.job["status"] == "failed"
    assert "уншиж чадсангүй" in db.job["error_message"]
    assert "Original бичлэг алга" not in db.job["error_message"]
    assert storage.uploads == []


@pytest.mark.asyncio
async def test_lookup_original_raises_on_db_error(processor):
    proc, db, _storage = processor
    db.error = ConnectionError("database down")
    with pytest.raises(RevealDataError):
        await proc._lookup_original(RECORDING_ID)


def test_sealed_target_lookup_outage_raises(processor):
    """A DB outage must not be shown to the admin as "no faces within your
    reveal level" — that reads as an authority decision."""
    proc, db, _storage = processor
    db.error = ConnectionError("database down")
    with pytest.raises(RevealDataError):
        proc._collect_targets_sealed(
            {"face_ids": ["face-1"]}, RECORDING_ID, reveal_level=3
        )


def test_face_embedding_failsafe_outage_raises(processor):
    proc, db, _storage = processor
    db.error = ConnectionError("database down")
    with pytest.raises(RevealDataError):
        proc._collect_targets({"face_ids": ["face-1"]})


# ── 7. the 4-eyes gate is not weakened by the new failure paths ────────
@pytest.mark.asyncio
async def test_pending_approval_job_is_never_rendered(processor, monkeypatch):
    proc, db, storage = processor
    db.job["status"] = "pending_approval"
    monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(side_effect=AssertionError))

    await proc.run(JOB_ID)

    assert db.job["status"] == "pending_approval"
    assert storage.uploads == []


@pytest.mark.asyncio
async def test_unreadable_job_row_does_not_clobber_pending_approval(processor):
    """The blind fail-marking path (job status unknown) is status-guarded."""
    proc, db, storage = processor
    db.job["status"] = "pending_approval"
    db.error = ConnectionError("database down")

    await proc.run(JOB_ID)

    assert db.job["status"] == "pending_approval", "4-eyes state must survive a read error"
    assert storage.uploads == []


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
