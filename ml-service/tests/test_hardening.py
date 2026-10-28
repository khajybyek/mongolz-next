"""Small hardening checks: key-rotation-safe chain unseal, log redaction,
camera request validation, pgvector text parsing."""

from __future__ import annotations

import os
import secrets

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")

import numpy as np
import pytest
import cv2
from cryptography.exceptions import InvalidTag
from pydantic import ValidationError

import hierarchical_keys as hk
import main
from reveal_job import _parse_reveal_level
from recording_pipeline import open_video_capture, redact_url


def test_opencv_native_diagnostics_are_silent():
    native_logging = cv2.utils.logging
    assert native_logging.getLogLevel() == native_logging.LOG_LEVEL_SILENT


def test_network_capture_uses_ffmpeg_with_bounded_io(monkeypatch):
    calls = []
    monkeypatch.setattr(cv2, "VideoCapture", lambda *args: calls.append(args) or object())
    open_video_capture("https://user:secret@camera.invalid/mjpeg")  # pragma: allowlist secret
    assert calls == [(
        "https://user:secret@camera.invalid/mjpeg",  # pragma: allowlist secret
        cv2.CAP_FFMPEG,
        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000],
    )]


def test_local_capture_keeps_automatic_backend(monkeypatch):
    calls = []
    monkeypatch.setattr(cv2, "VideoCapture", lambda *args: calls.append(args) or object())
    open_video_capture("/tmp/fixture.mp4")
    assert calls == [("/tmp/fixture.mp4",)]


def test_unseal_at_index_tries_previous_master():
    old, new = secrets.token_bytes(32), secrets.token_bytes(32)
    rec, ci = "rec-rotation", 4
    blob = hk.encrypt_face(b"crop-bytes", hk.key_at_index(rec, ci, old))
    # active master alone fails, active+prev succeeds, order irrelevant for result
    with pytest.raises(InvalidTag):
        hk.unseal_at_index(blob, rec, ci, 0, [new])
    assert hk.unseal_at_index(blob, rec, ci, 0, [new, old]) == b"crop-bytes"
    assert hk.unseal_at_index(blob, rec, ci, 2, [new, old]) == b"crop-bytes"  # level ≤ index


def test_unseal_at_index_refuses_below_level():
    master = secrets.token_bytes(32)
    blob = hk.encrypt_face(b"x", hk.key_at_index("r", 1, master))
    with pytest.raises(PermissionError):
        hk.unseal_at_index(blob, "r", 1, 3, [master])


@pytest.mark.parametrize("value", [None, True, False, "0", 1.0, -1, 100, object()])
def test_reveal_level_parser_fails_closed(value):
    assert _parse_reveal_level(value) is None


@pytest.mark.parametrize("value", [0, 1, 42, 99])
def test_reveal_level_parser_accepts_only_persisted_scope(value):
    assert _parse_reveal_level(value) == value


@pytest.mark.parametrize(
    "url,expected",
    [
        ("rtsp://admin:s3cret@192.168.0.15:554/h264", "rtsp://***@192.168.0.15:554/h264"),  # pragma: allowlist secret
        ("rtsp://192.168.0.15:554/h264", "rtsp://192.168.0.15:554/h264"),
        ("http://user@cam.local/mjpeg", "http://***@cam.local/mjpeg"),
        (0, "0"),
        ("/tmp/upload.mp4", "/tmp/upload.mp4"),
    ],
)
def test_redact_url(url, expected):
    assert redact_url(url) == expected


@pytest.mark.parametrize("camera_id", ["../etc", "a/b", "", "x" * 65, "..", ".hidden"])
def test_camera_start_rejects_path_like_ids(camera_id):
    with pytest.raises(ValidationError):
        main.CameraStartReq(camera_id=camera_id, url="rtsp://h/s")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "/tmp/x.mp4", "concat:a|b", "ftp://h/x"])
def test_camera_start_rejects_non_network_sources(url):
    with pytest.raises(ValidationError):
        main.CameraStartReq(camera_id="cam-1", url=url)


def test_camera_start_accepts_network_and_device_sources():
    assert main.CameraStartReq(camera_id="cam-1", url="rtsp://u:p@h:554/s").url.startswith("rtsp://")
    assert main.CameraStartReq(camera_id="cam-1", url="0").url == "0"


def test_embedding_to_np_parses_pgvector_text():
    v = np.linspace(0, 1, 512, dtype=np.float32)
    text = "[" + ",".join(f"{x:.6f}" for x in v) + "]"
    parsed = main._embedding_to_np(text)
    assert parsed is not None and parsed.shape == (512,)
    assert np.allclose(parsed, v, atol=1e-5)
    assert main._embedding_to_np("[0.1,0.2]") is None  # wrong dimension
    assert main._embedding_to_np(None) is None
    assert main._embedding_to_np("garbage") is None


# ── /camera/active (live grid / wall attach) ─────────────────────────────
class _DoneTask:
    def done(self):
        return True


class _LiveTask:
    def done(self):
        return False


class _Session:
    def __init__(self, task, name="Gate A", fps=15):
        self.task = task
        self.camera_name = name
        self.fps = fps
        self.source_url = "rtsp://admin:secret@10.0.0.5/stream"  # pragma: allowlist secret
        from datetime import datetime, timezone

        self.started_at = datetime(2026, 9, 7, 1, 2, 3, tzinfo=timezone.utc)


class _Manager:
    def __init__(self):
        self.sessions = {"cam-live": _Session(_LiveTask()), "cam-done": _Session(_DoneTask())}
        self.supervision = {}

    def active_count(self):
        return 1


def test_camera_active_lists_only_running_sessions_without_urls(monkeypatch):
    from camera_worker import CameraManager
    from fastapi.testclient import TestClient

    mgr = _Manager()
    # Borrow the real method so the test exercises the production code path.
    mgr.active_sessions = CameraManager.active_sessions.__get__(mgr)
    mgr.reconnecting_sessions = CameraManager.reconnecting_sessions.__get__(mgr)
    monkeypatch.setattr(main, "camera_manager", mgr)

    client = TestClient(main.app)
    denied = client.get("/camera/active")
    assert denied.status_code == 401

    res = client.get("/camera/active", headers={"Authorization": "Bearer test-token"})
    assert res.status_code == 200
    cams = res.json()["cameras"]
    assert [c["camera_id"] for c in cams] == ["cam-live"]
    assert cams[0]["camera_name"] == "Gate A"
    assert cams[0]["fps"] == 15
    assert cams[0]["started_at"].startswith("2026-09-07T01:02:03")
    assert cams[0]["state"] == "running"
    # The finished session has no supervision entry (user stop / dropped), so
    # it is not "reconnecting" either.
    assert res.json()["reconnecting"] == []
    assert "secret" not in res.text and "rtsp" not in res.text


def test_camera_active_without_manager_is_empty(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(main, "camera_manager", None)
    res = TestClient(main.app).get("/camera/active", headers={"Authorization": "Bearer test-token"})
    assert res.status_code == 200 and res.json() == {"cameras": [], "reconnecting": []}
