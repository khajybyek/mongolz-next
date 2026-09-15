from __future__ import annotations

import hashlib
import os
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")

from fastapi.testclient import TestClient
import main

HEADERS = {"Authorization": "Bearer test-token"}
AGENT = "00000000-0000-0000-0000-000000000001"
CAMERA = "00000000-0000-0000-0000-000000000002"
EVENT = "00000000-0000-0000-0000-000000000003"
JPEG = b"not-a-real-jpeg-but-engine-is-mocked"


def fields():
    return {
        "agent_id": AGENT,
        "agent_name": "Gate A",
        "camera_id": CAMERA,
        "captured_at": "2026-09-15T00:00:00+00:00",
        "payload_sha256": hashlib.sha256(JPEG).hexdigest(),
        "version": "1.0.0",
        "queue_depth": "1",
        "sent_total": "4",
        "failed_total": "2",
    }


def test_edge_delivery_is_durable_and_idempotent(monkeypatch):
    engine = SimpleNamespace(detect_all=Mock(return_value=[object(), object()]))
    store = SimpleNamespace(
        client=object(),
        upsert_edge_agent=Mock(return_value=True),
        get_edge_event=Mock(side_effect=[None, {
            "id": EVENT, "agent_id": AGENT, "camera_id": CAMERA,
            "payload_sha256": hashlib.sha256(JPEG).hexdigest(), "face_count": 2,
        }]),
        insert_edge_event=Mock(return_value={"id": EVENT}),
    )
    monkeypatch.setattr(main, "face_engine", engine)
    monkeypatch.setattr(main, "storage", store)
    client = TestClient(main.app)
    body = {**fields(), "event_id": EVENT}

    first = client.post("/edge/detect", headers=HEADERS, data=body, files={"file": ("frame.jpg", JPEG, "image/jpeg")})
    second = client.post("/edge/detect", headers=HEADERS, data=body, files={"file": ("frame.jpg", JPEG, "image/jpeg")})
    assert first.status_code == 200 and first.json() == {
        "ok": True, "event_id": EVENT, "face_count": 2, "duplicate": False,
        "capture_enabled": True,
    }
    assert second.status_code == 200 and second.json()["duplicate"] is True
    engine.detect_all.assert_called_once()
    store.insert_edge_event.assert_called_once()
    assert store.upsert_edge_agent.call_count == 2


def test_edge_rejects_checksum_mismatch_before_inference(monkeypatch):
    engine = SimpleNamespace(detect_all=Mock(return_value=[]))
    store = SimpleNamespace(client=object(), upsert_edge_agent=Mock(return_value=True))
    monkeypatch.setattr(main, "face_engine", engine)
    monkeypatch.setattr(main, "storage", store)
    body = {**fields(), "event_id": EVENT, "payload_sha256": "a" * 64}
    response = TestClient(main.app).post(
        "/edge/detect", headers=HEADERS, data=body,
        files={"file": ("frame.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 400
    engine.detect_all.assert_not_called()
    store.upsert_edge_agent.assert_not_called()


def test_edge_heartbeat_contains_no_camera_url_or_credentials(monkeypatch):
    store = SimpleNamespace(client=object(), upsert_edge_agent=Mock(return_value=False))
    monkeypatch.setattr(main, "storage", store)
    data = fields()
    data.pop("captured_at")
    data.pop("payload_sha256")
    response = TestClient(main.app).post("/edge/heartbeat", headers=HEADERS, data=data)
    assert response.status_code == 200
    assert response.json()["capture_enabled"] is False
    kwargs = store.upsert_edge_agent.call_args.kwargs
    assert "url" not in kwargs and "token" not in kwargs
    assert kwargs["camera_id"] == CAMERA and kwargs["queue_depth"] == 1
