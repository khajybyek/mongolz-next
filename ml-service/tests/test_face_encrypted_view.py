"""/recording/{id}/view and the evidence source for face_encrypted rows
(ADR 0013): the stored masked video is decrypted and streamed — no render,
no detector, no embedding — under the existing cache rules."""
from __future__ import annotations

import asyncio
import base64
import os
import secrets
import shutil
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import crypto_utils  # noqa: E402
import main  # noqa: E402

REC = "44444444-4444-4444-8444-444444444444"
AUTH = {"Authorization": "Bearer test-token"}
MASKED_PATH = "cam/20260930_120000_masked.mp4.enc"


def _masked_mp4(path) -> bytes:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 15, (64, 48))
    assert writer.isOpened()
    for i in range(10):
        writer.write(np.full((48, 64, 3), 20 * i, np.uint8))
    writer.release()
    return path.read_bytes()


def _client(tmp_path, monkeypatch, row, blob):
    query = Mock()
    for name in ("select", "eq", "maybe_single"):
        getattr(query, name).return_value = query
    query.execute.return_value = SimpleNamespace(data=row)
    bucket = Mock()
    bucket.download.return_value = blob
    db = Mock()
    db.table.return_value = query
    db.storage.from_.return_value = bucket
    monkeypatch.setattr(main, "storage", SimpleNamespace(client=db))
    monkeypatch.setattr(main, "ML_TOKEN", "test-token")
    monkeypatch.setattr(main, "_VIEW_CACHE_DIR", str(tmp_path / "views"))
    os.makedirs(tmp_path / "views", exist_ok=True)
    rendered = Mock(side_effect=AssertionError("face_encrypted must not be re-rendered"))
    monkeypatch.setattr(main, "render_blurred_view", rendered)
    return TestClient(main.app), bucket


@pytest.fixture
def row():
    return {"blur_strategy": "face_encrypted", "storage_path": MASKED_PATH, "has_original": True,
            "original_path": None, "camera_id": None, "started_at": None, "duration_sec": 0.67, "id": REC}


def test_view_streams_the_decrypted_masked_video(tmp_path, monkeypatch, row):
    crypto_utils.init_master_key()
    plain = _masked_mp4(tmp_path / "m.mp4")
    client, bucket = _client(tmp_path, monkeypatch, row, crypto_utils.encrypt_bytes(plain, REC))
    r = client.get(f"/recording/{REC}/view", headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"] == "video/mp4"
    assert r.content == plain
    bucket.download.assert_called_once_with(MASKED_PATH)
    assert (tmp_path / "views" / f"{REC}.mp4").read_bytes() == plain
    assert not (tmp_path / "views" / f"{REC}.mp4.part").exists()
    # Second request: the cache (row still exists) — no second download.
    r2 = client.get(f"/recording/{REC}/view", headers=AUTH)
    assert r2.status_code == 200 and r2.content == plain
    assert bucket.download.call_count == 1


def test_view_refuses_an_undelivered_row(tmp_path, monkeypatch, row):
    row["has_original"] = False
    client, bucket = _client(tmp_path, monkeypatch, row, b"")
    assert client.get(f"/recording/{REC}/view", headers=AUTH).status_code == 404
    bucket.download.assert_not_called()


def test_view_never_serves_a_corrupt_masked_video(tmp_path, monkeypatch, row):
    crypto_utils.init_master_key()
    client, _ = _client(tmp_path, monkeypatch, row, crypto_utils.encrypt_bytes(b"not a video" * 200, REC))
    assert client.get(f"/recording/{REC}/view", headers=AUTH).status_code == 500
    assert not os.listdir(tmp_path / "views")


def test_view_fails_closed_on_a_foreign_ciphertext(tmp_path, monkeypatch, row):
    crypto_utils.init_master_key()
    plain = _masked_mp4(tmp_path / "m.mp4")
    other = "55555555-5555-4555-8555-555555555555"
    client, _ = _client(tmp_path, monkeypatch, row, crypto_utils.encrypt_bytes(plain, other))
    assert client.get(f"/recording/{REC}/view", headers=AUTH).status_code == 500
    assert not os.listdir(tmp_path / "views")


def test_health_reports_the_face_encrypted_capability():
    body = TestClient(main.app).get("/").json()
    assert body["face_encrypted"] == main.FACE_ENCRYPTED_CAPABILITY == 1


def test_evidence_uses_the_masked_video_of_a_face_encrypted_recording(tmp_path, monkeypatch, row):
    crypto_utils.init_master_key()
    plain = _masked_mp4(tmp_path / "m.mp4")
    row["capture_status"] = "ready"
    client, bucket = _client(tmp_path, monkeypatch, row, crypto_utils.encrypt_bytes(plain, REC))
    monkeypatch.setattr(main, "_view_protection", lambda rid, r: None)
    blob, duration, _protection = asyncio.run(main._evidence_recording_blob(REC))
    assert blob == plain
    bucket.download.assert_called_once_with(MASKED_PATH)
