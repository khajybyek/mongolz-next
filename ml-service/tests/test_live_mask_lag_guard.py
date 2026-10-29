"""Masked live HLS keeps up with real time without ever writing an unmasked
frame.

Regression (masked-live change 1ff609b): ``_emit_frame`` masked every live
frame inline; at 1080p that costs more than the 66 ms budget at 15 fps, so
the loop fell further and further behind the camera. Beyond
``LIVE_MASK_LAG_SEC`` the HLS writer now repeats the previous MASKED frame
for the slot instead of masking the new one.
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())

import numpy as np  # noqa: E402

import recording_pipeline as rp  # noqa: E402


class _Engine:
    def detect_all(self, _b):
        return []

    @staticmethod
    def cosine(a, b):
        return 0.0


class _Storage:
    client = None


class _Stdin:
    def __init__(self):
        self.frames: list[bytes] = []
        self.closed = False

    def write(self, data):
        self.frames.append(data)


class _Proc:
    def __init__(self):
        self.stdin = _Stdin()

    def poll(self):
        return None


def _session(tmp_path, monkeypatch, clock):
    monkeypatch.setattr(rp, "check_capture_capacity", lambda *a, **k: None)
    monkeypatch.setattr(rp.time, "monotonic", lambda: clock[0])
    s = rp.RecordingSession(
        camera_id="rtsp-cam", camera_name="Gate", source_url="rtsp://10.0.0.9/live",
        engine=_Engine(), storage=_Storage(),
        hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"), fps=15,
    )
    s.blur_strategy = "on_demand"
    s.hls = _Proc()
    s.original_writer = _Proc()
    s._lag_guard = True
    s._live_origin = 0.0

    async def _no_arcface(*a, **k):
        return None

    s._process_arcface = _no_arcface
    return s


def test_lagging_live_stream_repeats_masked_frames_never_raw(tmp_path, monkeypatch):
    clock = [0.0]
    s = _session(tmp_path, monkeypatch, clock)
    masked_calls = []

    def fake_mask(frame):
        masked_calls.append(1)
        out = frame.copy()
        out[:] = 7  # "masked" marker value
        return out

    monkeypatch.setattr(s.masker, "mask", fake_mask)
    monkeypatch.setattr(s, "_draw_kst_timestamp", lambda *a, **k: None)

    async def run():
        # Frame 0 at t=0.05 (baseline), frame 1 on time.
        for i, now in enumerate([0.05, 0.12]):
            clock[0] = now
            frame = np.full((8, 8, 3), 200 + i, dtype=np.uint8)
            await s._emit_frame(i / 15, frame)
        assert len(masked_calls) == 2 and s.held_frames == 0
        # The loop is now 2 s behind the source clock: frames are held.
        clock[0] = 2.3
        for i in range(2, 5):
            await s._emit_frame(i / 15, np.full((8, 8, 3), 250, dtype=np.uint8))
        assert len(masked_calls) == 2
        assert s.held_frames == 3 and s.live_lag_sec > 1.5
        # Caught up again → masking resumes.
        clock[0] = 0.05 + 30 / 15
        await s._emit_frame(30 / 15, np.full((8, 8, 3), 250, dtype=np.uint8))
        assert len(masked_calls) == 3

    asyncio.run(run())
    hls_frames = s.hls.stdin.frames
    assert len(hls_frames) == 6
    # Every HLS frame is a masked one (value 7) — the raw 200/201/250 pixels
    # never reach the stream.
    assert all(set(np.frombuffer(f, dtype=np.uint8).tolist()) == {7} for f in hls_frames)
    # The encrypted original still receives every raw frame.
    assert len(s.original_writer.stdin.frames) == 6


def test_file_and_demo_sources_never_hold(tmp_path, monkeypatch):
    clock = [100.0]
    s = _session(tmp_path, monkeypatch, clock)
    s._lag_guard = False
    s._last_masked = np.zeros((8, 8, 3), dtype=np.uint8)
    assert s._should_hold(0.0, (8, 8, 3)) is False
    assert s._should_hold(0.1, (8, 8, 3)) is False


def test_baked_and_demo_sources_measure_the_backlog_without_holding(tmp_path, monkeypatch):
    """Frames are never held in baked mode (every frame is masked) or for a
    paced demo source, but the backlog is still measured: every segment
    rotation re-anchors the capture clock from it (ADR 0012)."""
    for blur_strategy, lag_guard in (("baked", True), ("on_demand", False)):
        clock = [0.0]
        s = _session(tmp_path, monkeypatch, clock)
        s.blur_strategy = blur_strategy
        s._lag_guard = lag_guard
        s._lag_measured = True
        s._last_masked = np.zeros((8, 8, 3), dtype=np.uint8)
        assert s._should_hold(0.0, (8, 8, 3)) is False  # baseline
        clock[0] = 91.0
        assert s._should_hold(1.0, (8, 8, 3)) is False  # 90 s behind: measured, not held
        assert s.live_lag_sec == 90.0 and s.held_frames == 0
        assert s._live_backlog_sec(1.0) == 90.0


def test_no_previous_masked_frame_means_mask_now(tmp_path, monkeypatch):
    clock = [0.0]
    s = _session(tmp_path, monkeypatch, clock)
    assert s._should_hold(0.0, (8, 8, 3)) is False  # baseline
    clock[0] = 10.0
    assert s._should_hold(0.1, (8, 8, 3)) is False  # lagging, but nothing to repeat
    s._last_masked = np.zeros((4, 4, 3), dtype=np.uint8)
    assert s._should_hold(0.2, (8, 8, 3)) is False  # size changed → mask


def test_detector_outage_never_reaches_live_hls_as_raw_pixels(tmp_path, monkeypatch):
    """A broken face detector may interrupt the picture, but not expose it."""
    class BrokenEngine:
        def detect_all(self, _jpeg):
            raise RuntimeError("detector unavailable")

        @staticmethod
        def cosine(_a, _b):
            return 0.0

    clock = [0.0]
    s = _session(tmp_path, monkeypatch, clock)
    s.masker.engine = BrokenEngine()
    monkeypatch.setattr(s, "_draw_kst_timestamp", lambda *a, **k: None)
    raw = np.full((64, 64, 3), 200, dtype=np.uint8)

    asyncio.run(s._emit_frame(0.0, raw))

    assert s.masker.fail_closed is True
    assert s.hls.stdin.frames == [bytes(raw.size)]
    assert s.original_writer.stdin.frames == [raw.tobytes()]


def test_camera_clock_drift_does_not_freeze_the_stream(tmp_path, monkeypatch):
    """A camera whose PTS clock runs slow makes the measured lag grow even
    though frames arrive in real time. Holding cannot drain that, so the
    guard must re-anchor instead of repeating one frame for the session."""
    clock = [0.0]
    s = _session(tmp_path, monkeypatch, clock)
    s._last_masked = np.zeros((8, 8, 3), dtype=np.uint8)
    drift = 0.002  # exaggerated: 2 ms of extra lag per frame
    streak = longest = holds = 0
    for i in range(3000):
        clock[0] = i / 15 + i * drift
        if s._should_hold(i / 15, (8, 8, 3)):
            holds += 1
            streak += 1
            longest = max(longest, streak)
        else:
            streak = 0
    assert holds > 0  # the guard did trip
    assert longest <= 30  # but never froze beyond ~2 s of source time
    assert holds < 3000 * 0.2
    assert s.held_frames == holds


def test_genuine_backlog_keeps_holding_while_it_drains(tmp_path, monkeypatch):
    clock = [0.0]
    s = _session(tmp_path, monkeypatch, clock)
    assert s._should_hold(0.0, (8, 8, 3)) is False  # baseline
    s._last_masked = np.zeros((8, 8, 3), dtype=np.uint8)
    # 10 s behind; buffered frames now arrive much faster than real time.
    held = 0
    for i in range(1, 200):
        clock[0] = 10.0 + i * 0.001
        if not s._should_hold(i / 15, (8, 8, 3)):
            break
        held += 1
    # Held until the backlog drained below the threshold (~142 frames).
    assert held > 100
    assert s.live_lag_sec <= rp.LIVE_MASK_LAG_SEC + 0.1
