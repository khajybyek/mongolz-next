"""A face is never persisted without its recording row.

Regression: when the placeholder ``recordings`` insert failed at segment
start (transient DB blip), ``_persist_face`` still sealed the crop and
embedding with ``key_at_index(recording_id, …)`` but wrote the face with
``recording_id = NULL`` — nothing back-linked it later, so secure-crop and
reveal could never decrypt that evidence again.
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())

import numpy as np  # noqa: E402
import pytest  # noqa: E402

import crypto_utils  # noqa: E402
import recording_pipeline as rp  # noqa: E402
from storage import SupabaseStorage  # noqa: E402

REC = "11111111-2222-4333-8444-555555555555"
CAM = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7"


class _Face:
    embedding = np.ones(512, dtype=np.float32)
    bbox = (10.0, 10.0, 90.0, 90.0)
    confidence = 0.9


class _FlakyStorage:
    def __init__(self, fail_inserts: int):
        self.client = object()
        self.fail_inserts = fail_inserts
        self.row_inserts = 0
        self.uploads: list = []
        self.faces: list = []

    async def insert_recording_returning_id(self, **kw):
        self.row_inserts += 1
        if self.row_inserts <= self.fail_inserts:
            raise ConnectionError("db blip")
        return kw["recording_id"]

    def upload_bytes(self, bucket, path, data, content_type):
        self.uploads.append((bucket, path))
        return path

    async def insert_face(self, **kw):
        self.faces.append(kw)
        return "face-1"


def _session(storage, monkeypatch):
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"k" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    s = rp.RecordingSession.__new__(rp.RecordingSession)
    s.storage = storage
    s.recording_id = REC
    s.camera_id = CAM
    s.db_camera_id = CAM
    s.camera_name = "Gate"
    s.display_filename = "x.mp4"
    s.filename_original = f"{CAM}/x_original.mp4.enc"
    s.started_at = datetime(2026, 9, 23, tzinfo=timezone.utc)
    s.blur_strategy = "on_demand"
    s._row_inserted = False
    s._delivery_enqueued = False
    s._face_chain_index = 0
    return s


def test_failed_row_insert_is_retried_before_the_face_is_sealed(monkeypatch):
    st = _FlakyStorage(fail_inserts=1)
    s = _session(st, monkeypatch)
    asyncio.run(s._open_recording_row())  # segment start: the blip
    assert s._row_inserted is False

    frame = np.zeros((120, 120, 3), dtype=np.uint8)
    face_id, path = asyncio.run(s._persist_face(frame, _Face(), 1000.0))
    assert face_id == "face-1" and path.endswith(".enc")
    assert st.faces[0]["recording_id"] == REC  # never NULL
    assert s._row_inserted is True


def test_face_is_not_persisted_while_the_row_is_unavailable(monkeypatch):
    st = _FlakyStorage(fail_inserts=99)
    s = _session(st, monkeypatch)
    frame = np.zeros((120, 120, 3), dtype=np.uint8)
    with pytest.raises(RuntimeError, match="recording row unavailable"):
        asyncio.run(s._persist_face(frame, _Face(), 1000.0))
    # Nothing sealed with this recording's key was left behind, and the
    # chain index was not consumed.
    assert st.uploads == [] and st.faces == []
    assert s._face_chain_index == 0


def test_row_insert_with_known_id_is_idempotent():
    """A retry whose first attempt actually landed must not fail on the
    primary key nor overwrite the row (ON CONFLICT DO NOTHING)."""
    storage = SupabaseStorage.__new__(SupabaseStorage)
    client = MagicMock()
    query = client.table.return_value.upsert.return_value
    query.execute.return_value = SimpleNamespace(data=[])  # conflict → no row returned
    storage.client = client
    rec_id = asyncio.run(storage.insert_recording_returning_id(
        filename="x.mp4", storage_path="p", duration_sec=None, size_bytes=None,
        encrypted=True, has_original=False, camera_id=None, camera_name=None,
        started_at="2026-09-23T00:00:00+00:00", ended_at=None, recording_id=REC,
    ))
    assert rec_id == REC
    _, kwargs = client.table.return_value.upsert.call_args
    assert kwargs == {"on_conflict": "id", "ignore_duplicates": True}
    client.table.return_value.insert.assert_not_called()
