from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).parents[1] / "agent.py"
SPEC = importlib.util.spec_from_file_location("mongolz_edge_agent", MODULE_PATH)
assert SPEC and SPEC.loader
agent = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = agent
SPEC.loader.exec_module(agent)


def outbox(tmp_path: Path, max_bytes: int = 1024 * 1024):
    return agent.EncryptedOutbox(tmp_path, b"k" * 32, max_bytes)


def config(tmp_path: Path):
    return agent.Config(
        rtsp_url="rtsp://operator:secret@10.0.0.2/live?token=hidden",
        ml_url="https://ml.example",
        ml_token="token",
        camera_id="00000000-0000-0000-0000-000000000001",
        agent_id="00000000-0000-0000-0000-000000000002",
        sample_interval_sec=1,
        motion_threshold=8,
        heartbeat_interval_sec=30,
        request_timeout_sec=10,
        max_spool_bytes=1024 * 1024,
        spool_dir=tmp_path,
        spool_key=b"k" * 32,
        agent_name="gate-a",
    )


class Response:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise agent.requests.HTTPError(f"{self.status_code}")

    def json(self):
        return self._body


def test_outbox_encrypts_before_delivery_and_round_trips(tmp_path):
    queue = outbox(tmp_path)
    payload = b"private-jpeg-pixels"
    entry = queue.enqueue(payload, "2026-09-15T00:00:00+00:00")
    assert payload not in entry.payload_path.read_bytes()
    assert queue.read(entry) == payload
    assert entry.metadata["payload_sha256"]
    assert queue.depth() == 1


def test_failed_delivery_stays_encrypted_and_backs_off(tmp_path, monkeypatch):
    queue = outbox(tmp_path)
    entry = queue.enqueue(b"jpeg")
    delivery = agent.CloudDelivery(config(tmp_path), queue, agent.Stats(tmp_path / "stats.json"))
    monkeypatch.setattr(delivery.session, "post", lambda *a, **k: Response(503))
    assert delivery.send_one() is False
    assert queue.depth() == 1
    metadata = json.loads(entry.meta_path.read_text())
    assert metadata["attempts"] == 1
    assert metadata["next_attempt_epoch"] > metadata["created_epoch"]


def test_outbox_recovers_metadata_after_crash(tmp_path):
    queue = outbox(tmp_path)
    entry = queue.enqueue(b"private-jpeg", "2026-09-15T00:00:00+00:00")
    entry.meta_path.unlink()

    recovered = queue.entries()

    assert len(recovered) == 1
    assert recovered[0].event_id == entry.event_id
    assert recovered[0].metadata["last_error"] == "metadata-recovered-after-crash"
    assert queue.read(recovered[0]) == b"private-jpeg"


def test_acknowledged_delivery_is_removed_once(tmp_path, monkeypatch):
    queue = outbox(tmp_path)
    entry = queue.enqueue(b"jpeg")
    delivery = agent.CloudDelivery(config(tmp_path), queue, agent.Stats(tmp_path / "stats.json"))
    monkeypatch.setattr(delivery.session, "post", lambda *a, **k: Response(200, {
        "ok": True, "event_id": entry.event_id, "face_count": 1, "duplicate": True,
        "capture_enabled": False,
    }))
    assert delivery.send_one() is True
    assert queue.depth() == 0
    assert not entry.meta_path.exists()
    assert not entry.payload_path.exists()
    assert delivery.stats.sent_total == 1
    assert delivery.capture_enabled is False


def test_spool_never_evicts_old_evidence_when_full(tmp_path):
    queue = outbox(tmp_path, max_bytes=4200)
    first = queue.enqueue(b"a" * 100)
    with pytest.raises(agent.SpoolFull):
        queue.enqueue(b"b" * 100)
    assert first.meta_path.exists() and first.payload_path.exists()


def test_camera_credentials_and_query_are_redacted():
    safe = agent.redact_url("rtsp://operator:secret@10.0.0.2/live?token=hidden")
    assert safe == "rtsp://***@10.0.0.2/live"
    assert "operator" not in safe and "secret" not in safe and "token" not in safe
