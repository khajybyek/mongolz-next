"""The capture loop never parks the ML event loop on source I/O.

Regression: ``open_video_capture`` and ``cap.read()`` ran directly inside the
async ``_run``; an unreachable or stalling source blocked for its full 5 s
timeout, freezing every other camera, HLS writer and HTTP handler (the
production camera is restarted every 300 s against an offline LAN).
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets
import time

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())

import recording_pipeline as rp  # noqa: E402

BLOCK_SEC = 0.6


class _Engine:
    def detect_all(self, _b):
        return []

    @staticmethod
    def cosine(a, b):
        return 0.0


class _SlowSuspectClient:
    """PostgREST stand-in whose round trip blocks the calling thread."""

    def table(self, _name):
        return self

    def select(self, *_a):
        return self

    def execute(self):
        time.sleep(BLOCK_SEC)
        return type("R", (), {"data": []})()


class _Storage:
    def __init__(self):
        self.client = _SlowSuspectClient()


class _Unreachable:
    def isOpened(self):
        return False

    def release(self):
        pass


async def _max_stall(coro) -> float:
    """Run coro while a ticker measures the longest gap between ticks."""
    stall = 0.0
    done = asyncio.Event()

    async def ticker():
        nonlocal stall
        last = time.perf_counter()
        while not done.is_set():
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            stall = max(stall, now - last)
            last = now

    t = asyncio.create_task(ticker())
    try:
        await coro
    finally:
        done.set()
        await t
    return stall


def test_unreachable_source_and_suspect_load_do_not_stall_the_loop(tmp_path, monkeypatch):
    def slow_open(_src):
        time.sleep(BLOCK_SEC)
        return _Unreachable()

    monkeypatch.setattr(rp, "open_video_capture", slow_open)
    session = rp.RecordingSession(
        camera_id="rtsp-cam", camera_name="Gate", source_url="rtsp://10.0.0.9/live",
        engine=_Engine(), storage=_Storage(),
        hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"), fps=15,
    )

    async def run():
        t0 = time.perf_counter()
        stall = await _max_stall(session._run())
        elapsed = time.perf_counter() - t0
        return stall, elapsed

    stall, elapsed = asyncio.run(run())
    assert session.exit_reason == "source unreachable at open"
    assert elapsed >= 2 * BLOCK_SEC * 0.9  # both blocking calls really ran
    assert stall < BLOCK_SEC / 2, stall
