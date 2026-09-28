from __future__ import annotations

import hashlib
import os
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")

import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
import main
import privacy_schedule
from privacy_schedule import CameraSchedule, PrivacyScheduleCache, Window

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


def _use_schedule(monkeypatch, store):
    """Install a real PrivacyScheduleCache reading from the fake storage."""
    monkeypatch.setattr(privacy_schedule, "_cache", PrivacyScheduleCache(store))


def test_edge_delivery_is_durable_and_idempotent(monkeypatch):
    engine = SimpleNamespace(detect_all=Mock(return_value=[object(), object()]))
    store = SimpleNamespace(
        client=object(),
        load_privacy_schedule=Mock(return_value=CameraSchedule("standard")),
        upsert_edge_agent=Mock(return_value=True),
        get_edge_event=Mock(side_effect=[None, {
            "id": EVENT, "agent_id": AGENT, "camera_id": CAMERA,
            "payload_sha256": hashlib.sha256(JPEG).hexdigest(), "face_count": 2,
        }]),
        insert_edge_event=Mock(return_value={"id": EVENT}),
    )
    monkeypatch.setattr(main, "face_engine", engine)
    monkeypatch.setattr(main, "storage", store)
    _use_schedule(monkeypatch, store)
    client = TestClient(main.app)
    body = {**fields(), "event_id": EVENT}

    first = client.post("/edge/detect", headers=HEADERS, data=body, files={"file": ("frame.jpg", JPEG, "image/jpeg")})
    second = client.post("/edge/detect", headers=HEADERS, data=body, files={"file": ("frame.jpg", JPEG, "image/jpeg")})
    assert first.status_code == 200 and first.json() == {
        "ok": True, "event_id": EVENT, "face_count": 2, "duplicate": False,
        "capture_enabled": True, "privacy_mode": "standard",
    }
    # A duplicate delivery is answered from the stored event, not re-evaluated.
    assert second.status_code == 200 and second.json()["duplicate"] is True
    assert second.json()["face_count"] == 2 and second.json()["privacy_mode"] is None
    store.load_privacy_schedule.assert_called_once()
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


# ── Privacy schedule (ADR 0012) ────────────────────────────────────────
def _private_store(schedule_or_error):
    loader = (
        Mock(side_effect=schedule_or_error)
        if isinstance(schedule_or_error, Exception)
        else Mock(return_value=schedule_or_error)
    )
    return SimpleNamespace(
        client=object(),
        load_privacy_schedule=loader,
        upsert_edge_agent=Mock(return_value=True),
        get_edge_event=Mock(return_value=None),
        insert_edge_event=Mock(return_value={"id": EVENT}),
    )


@pytest.mark.parametrize(
    "schedule_or_error",
    [
        CameraSchedule("private"),
        # Unreadable schedule → fail closed, exactly like a private camera.
        ConnectionError("database offline"),
    ],
    ids=["private-default", "fail-closed"],
)
def test_edge_private_mode_runs_no_inference(monkeypatch, schedule_or_error):
    engine = SimpleNamespace(detect_all=Mock(return_value=[object()]))
    store = _private_store(schedule_or_error)
    monkeypatch.setattr(main, "face_engine", engine)
    monkeypatch.setattr(main, "storage", store)
    _use_schedule(monkeypatch, store)

    response = TestClient(main.app).post(
        "/edge/detect", headers=HEADERS, data={**fields(), "event_id": EVENT},
        files={"file": ("frame.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 200
    assert response.json() == {
        "ok": True, "event_id": EVENT, "face_count": 0, "duplicate": False,
        "capture_enabled": True, "privacy_mode": "private",
    }
    engine.detect_all.assert_not_called()
    # The delivery is still durably acknowledged, with no faces counted.
    assert store.insert_edge_event.call_args.kwargs["face_count"] == 0


def _post(client, event_id, captured_at):
    return client.post(
        "/edge/detect", headers=HEADERS,
        data={**fields(), "event_id": event_id, "captured_at": captured_at},
        files={"file": ("frame.jpg", JPEG, "image/jpeg")},
    )


def _edge_rig(monkeypatch, schedule, received_at):
    engine = SimpleNamespace(detect_all=Mock(return_value=[object(), object(), object()]))
    store = _private_store(schedule)
    monkeypatch.setattr(main, "face_engine", engine)
    monkeypatch.setattr(main, "storage", store)
    monkeypatch.setattr(main, "_utc_now", lambda: datetime.fromisoformat(received_at.replace("Z", "+00:00")))
    _use_schedule(monkeypatch, store)
    return TestClient(main.app), engine


BUSINESS_HOURS = CameraSchedule("standard", (Window("private", "09:00", "18:00", 127),))


def test_edge_mode_is_evaluated_at_capture_time_not_arrival(monkeypatch):
    # Private 09:00–18:00 KST every day; both frames arrive at 19:00:30 KST.
    # 2026-09-15T00:00Z = 09:00 KST (inside), 10:00Z = 19:00 KST (outside).
    client, engine = _edge_rig(monkeypatch, BUSINESS_HOURS, "2026-09-15T10:00:30Z")
    inside = _post(client, EVENT, "2026-09-15T00:00:00Z")
    outside = _post(client, "00000000-0000-0000-0000-000000000004", "2026-09-15T10:00:00Z")
    assert inside.json()["privacy_mode"] == "private" and inside.json()["face_count"] == 0
    assert outside.json()["privacy_mode"] == "standard" and outside.json()["face_count"] == 3
    engine.detect_all.assert_called_once()


def test_edge_frame_is_private_when_private_at_receipt(monkeypatch):
    # A Pi without an RTC boots at 09:05 KST with its clock still at 18:00 the
    # day before: the stamp says standard, the receipt time says private.
    client, engine = _edge_rig(monkeypatch, BUSINESS_HOURS, "2026-09-15T00:05:00Z")
    stale_clock = _post(client, EVENT, "2026-09-14T09:00:00Z")  # 18:00 KST, end-exclusive → standard
    assert stale_clock.json()["privacy_mode"] == "private" and stale_clock.json()["face_count"] == 0
    engine.detect_all.assert_not_called()


def test_edge_frame_is_private_when_a_private_window_lies_between_capture_and_receipt(monkeypatch):
    # Private 12:00–12:10 KST; stamped 11:55, received 12:20 (25 min apart):
    # both ends are standard, but the frame may have been captured at 12:05.
    lunch = CameraSchedule("standard", (Window("private", "12:00", "12:10", 127),))
    client, engine = _edge_rig(monkeypatch, lunch, "2026-09-15T03:20:00Z")
    assert _post(client, EVENT, "2026-09-15T02:55:00Z").json()["privacy_mode"] == "private"
    engine.detect_all.assert_not_called()
    # More than an hour apart only the two ends count (an old outbox entry
    # would otherwise always be private).
    client, engine = _edge_rig(monkeypatch, lunch, "2026-09-15T04:00:00Z")
    assert _post(client, EVENT, "2026-09-15T02:55:00Z").json()["privacy_mode"] == "standard"
    engine.detect_all.assert_called_once()


def test_edge_frame_captured_before_a_loosening_stays_private(monkeypatch):
    # The private window was deleted at 17:00 KST (privacy_loosened_at); an
    # outbox delivered afterwards must not identify frames captured before it,
    # although the current schedule no longer shows that window.
    loosened = CameraSchedule("standard", loosened_at=datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc))
    client, engine = _edge_rig(monkeypatch, loosened, "2026-09-15T10:00:30Z")
    before = _post(client, EVENT, "2026-09-15T07:30:00Z")
    after = _post(client, "00000000-0000-0000-0000-000000000004", "2026-09-15T10:00:00Z")
    assert before.json()["privacy_mode"] == "private" and before.json()["face_count"] == 0
    assert after.json()["privacy_mode"] == "standard" and after.json()["face_count"] == 3
    engine.detect_all.assert_called_once()
