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
from cryptography.exceptions import InvalidTag
from pydantic import ValidationError

import hierarchical_keys as hk
import main
from recording_pipeline import redact_url


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


@pytest.mark.parametrize(
    "url,expected",
    [
        ("rtsp://admin:s3cret@192.168.0.15:554/h264", "rtsp://***@192.168.0.15:554/h264"),
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
