"""Stopping a camera whose source never opened is a clean stop.

Regression: the only production camera sits behind an offline LAN. Its
capture loop ends at open with ``exit_reason = "source unreachable at open"``;
``_finish_stop`` then raised on that reason, ``CameraManager.stop`` never
popped the session and ``/camera/stop`` answered 500 — forever. Because the
session was already flagged ``stopped_by_user``, a later explicit Start with
a reachable source returned early while ``/camera/start`` said ``ok: true``.
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")
os.environ.setdefault(
    "ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
)

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import camera_worker  # noqa: E402
import main  # noqa: E402
import recording_pipeline as rp  # noqa: E402
from camera_worker import CameraManager, CameraSupervision  # noqa: E402

CAM = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7"


class _Engine:
    def detect_all(self, _b):
        return []

    @staticmethod
    def cosine(a, b):
        return 0.0


class _Storage:
    client = None

    def __init__(self):
        self.flags = []

    async def insert_recording_returning_id(self, **kw):
        return None

    async def update_recording(self, *a, **k):
        return None

    def upload_bytes(self, *a, **k):
        return ""

    def upsert_camera_session(self, *a):
        return True

    def touch_camera_session(self, *a):
        return True

    def set_camera_session_resume(self, camera_id, auto_resume):
        self.flags.append((camera_id, auto_resume))
        return True

    def record_camera_session_error(self, *a):
        return True

    def camera_desired_state(self, camera_id):
        return camera_worker.CameraDesiredState()


class _ClosedCapture:
    def isOpened(self):
        return False

    def release(self):
        pass

    def get(self, _prop):
        return 0


class _LiveCapture:
    """Opens and keeps delivering black frames until released."""

    def __init__(self):
        self.released = False

    def isOpened(self):
        return True

    def get(self, prop):
        import cv2

        return {cv2.CAP_PROP_FRAME_WIDTH: 64, cv2.CAP_PROP_FRAME_HEIGHT: 48, cv2.CAP_PROP_FPS: 15}.get(prop, 0)

    def read(self):
        return True, np.zeros((48, 64, 3), dtype=np.uint8)

    def release(self):
        self.released = True


def _manager(tmp_path, monkeypatch):
    monkeypatch.setattr(camera_worker, "RECORDINGS_DIR", str(tmp_path / "rec"))
    (tmp_path / "rec").mkdir()
    mgr = CameraManager.__new__(CameraManager)
    mgr.engine = _Engine()
    mgr.storage = _Storage()
    mgr.hls_dir = str(tmp_path / "hls")
    mgr.sessions = {}
    mgr.supervision = {}
    mgr._supervisor_task = None
    return mgr


def test_stop_of_never_opened_session_is_clean_and_start_replaces_it(tmp_path, monkeypatch):
    mgr = _manager(tmp_path, monkeypatch)
    # No encoders needed: the reachable run below only has to prove a new
    # capture loop is running.
    monkeypatch.setattr(rp, "_ffmpeg_hls_writer", lambda *a, **k: None)
    monkeypatch.setattr(rp, "_ffmpeg_mp4_writer", lambda *a, **k: None)
    caps = [_ClosedCapture()]
    monkeypatch.setattr(rp, "open_video_capture", lambda _src: caps[-1])

    async def run():
        await mgr.start(CAM, "rtsp://10.0.0.9/live")
        first = mgr.sessions[CAM]
        await asyncio.wait_for(first.task, timeout=5)
        assert first.exit_reason == "source unreachable at open"

        # Stop must not raise and must drop the dead session.
        await mgr.stop(CAM)
        assert CAM not in mgr.sessions
        # A second stop is a no-op, not another failure.
        await mgr.stop(CAM)

        # The source comes back; an explicit Start must really capture.
        caps.append(_LiveCapture())
        await mgr.start(CAM, "rtsp://10.0.0.9/live")
        second = mgr.sessions[CAM]
        assert second is not first
        # Wait for the first frame instead of a fixed sleep: a slow CI runner
        # can take longer than 0.2 s to schedule the capture thread.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 5
        while second.recorded_frames == 0 and not second.task.done() and loop.time() < deadline:
            await asyncio.sleep(0.02)
        assert second.task is not None and not second.task.done(), second.exit_reason
        assert second.recorded_frames > 0
        second.stop_flag.set()
        await asyncio.wait_for(second.task, timeout=5)

    asyncio.run(run())


def test_explicit_start_replaces_a_user_stopped_dead_session(tmp_path, monkeypatch):
    """Even when the dead entry lingers (flagged stopped_by_user), an
    operator's Start is newer than that stop and must not be swallowed."""
    mgr = _manager(tmp_path, monkeypatch)
    created = []

    class _Done:
        def done(self):
            return True

    class _Dead:
        task = _Done()
        stopped_by_user = True

        async def stop(self):
            return None

    class _Sess:
        def __init__(self, **kw):
            self.task = None
            self.camera_id = kw["camera_id"]
            self.db_camera_id = None
            created.append(self)

        async def start(self):
            return None

    monkeypatch.setattr(camera_worker, "RecordingSession", _Sess)
    mgr.sessions[CAM] = _Dead()
    asyncio.run(mgr.start(CAM, "rtsp://10.0.0.9/live"))
    assert len(created) == 1 and mgr.sessions[CAM] is created[0]

    # A SUPERVISED restart still honours the operator's stop.
    mgr.sessions[CAM] = _Dead()
    mgr.supervision[CAM] = CameraSupervision(url="rtsp://h/s")
    asyncio.run(mgr.start(CAM, "rtsp://10.0.0.9/live", supervised=True))
    assert len(created) == 1


def test_camera_stop_endpoint_maps_a_failed_stop_to_502(monkeypatch):
    class _Mgr:
        async def stop(self, camera_id):
            raise OSError("spool unavailable at /var/secret/path")

    monkeypatch.setattr(main, "camera_manager", _Mgr())
    client = TestClient(main.app)
    r = client.post("/camera/stop", json={"camera_id": CAM}, headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 502
    assert "secret" not in r.text


@pytest.mark.parametrize("pending", [True, False])
def test_failed_stop_keeps_session_only_when_a_retry_can_help(tmp_path, monkeypatch, pending):
    mgr = _manager(tmp_path, monkeypatch)

    class _Done:
        def done(self):
            return True

    class _Failing:
        task = _Done()
        recording_id = "11111111-2222-4333-8444-555555555555"
        _validated = False
        journal_path = tmp_path / "none.capture.json"
        stopped_by_user = False

        async def stop(self):
            raise RuntimeError("capture encoder input failed")

    class _Spool:
        def has_pending(self, _rid):
            return pending

    monkeypatch.setattr(camera_worker, "get_recording_spool", lambda: _Spool())
    session = _Failing()
    mgr.sessions[CAM] = session
    if pending:
        with pytest.raises(RuntimeError):
            asyncio.run(mgr.stop(CAM))
        assert mgr.sessions[CAM] is session
    else:
        asyncio.run(mgr.stop(CAM))
        assert CAM not in mgr.sessions
