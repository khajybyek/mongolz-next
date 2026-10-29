"""On-demand view + evidence renderers × privacy schedules (ADR 0012).

Frames captured in `private` mode are masked with the detector alone — no
ArcFace embedding is computed for them, not even transiently — and the
strongest (VIP) mask, exactly as the live pipeline masks them at capture.
When the spans / schedule cannot be read the WHOLE recording is treated as
protected: the masked view is still served, never refused.
"""
from __future__ import annotations

import base64
import math
import os
import secrets
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import face_masker  # noqa: E402
import privacy_protection  # noqa: E402
import privacy_schedule  # noqa: E402
import view_renderer  # noqa: E402
from privacy_protection import ProtectedTimeline, fail_closed_timeline  # noqa: E402
from privacy_schedule import CameraSchedule, PrivacyScheduleCache, Window  # noqa: E402
from tests.test_view_renderer import _ffmpeg_available, _make_synthetic_mp4  # noqa: E402

pytestmark = pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg binary not available")

FACE = (100, 60, 180, 150)
CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
REC = "22222222-2222-2222-2222-222222222222"


class BoxEngine:
    """One face per frame; records which detection path ran."""

    def __init__(self):
        self.calls: list[str] = []

    def detect_all(self, _jpeg):
        self.calls.append("detect_all")
        return [SimpleNamespace(bbox=FACE, confidence=0.99, embedding=np.ones(512, np.float32))]

    def detect_boxes(self, _jpeg):
        self.calls.append("detect_boxes")
        return [SimpleNamespace(bbox=FACE, confidence=0.99)]


@pytest.fixture
def tiers(monkeypatch):
    """Record the tier every mask call used (Haar off: the engine's box only)."""
    monkeypatch.setattr(face_masker.FaceMasker, "_detect_haar", lambda self, frame: [])
    seen: list[set[str]] = []
    real_mask = face_masker.FaceMasker.mask

    def mask(self, frame, keep_boxes=(), keep_iou=0.3):
        out = real_mask(self, frame, keep_boxes, keep_iou)
        seen.append({tier for _b, _t, tier in self.cache})
        return out

    monkeypatch.setattr(face_masker.FaceMasker, "mask", mask)
    return seen


def test_protected_frames_are_masked_without_any_embedding(tmp_path, tiers):
    src, out = str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4")
    _make_synthetic_mp4(src, frames=15, fps=15)
    engine = BoxEngine()
    # Frames at t >= 0.5 s (8..14) were captured in privacy mode.
    view_renderer.render_blurred_view(src, out, engine, protection=ProtectedTimeline(intervals=((0.5, math.inf),)))
    # InsightFace runs on masker frames 1, 5, 10, 15 = t 0, 0.27, 0.6, 0.93.
    assert engine.calls == ["detect_all", "detect_all", "detect_boxes", "detect_boxes"]
    assert tiers[0] == {"standard"} and tiers[-1] == {"vip"}


def test_without_protection_the_view_is_unchanged(tmp_path, tiers):
    src, out = str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4")
    _make_synthetic_mp4(src, frames=15, fps=15)
    engine = BoxEngine()
    view_renderer.render_blurred_view(src, out, engine)
    assert engine.calls == ["detect_all"] * 4
    assert all(t == {"standard"} for t in tiers)


def test_fail_closed_masks_every_frame_in_privacy_mode(tmp_path, tiers):
    src, out = str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4")
    _make_synthetic_mp4(src, frames=15, fps=15)
    engine = BoxEngine()
    assert view_renderer.render_blurred_view(src, out, engine, protection=fail_closed_timeline()) == 15
    assert engine.calls == ["detect_boxes"] * 4
    assert all(t == {"vip"} for t in tiers)
    assert os.path.getsize(out) > 1000  # still a playable masked view


def test_bounded_clip_uses_the_recording_timeline(tmp_path):
    src, out = str(tmp_path / "in.mp4"), str(tmp_path / "clip.mp4")
    _make_synthetic_mp4(src, frames=45, fps=15)
    engine = BoxEngine()
    # Evidence clip 1.0–2.0 s; protected [0, 1.5): the first half of the clip.
    view_renderer.render_blurred_view(src, out, engine, 1.0, 2.0,
                                      ProtectedTimeline(intervals=((0.0, 1.5),)))
    assert engine.calls[0] == "detect_boxes" and engine.calls[-1] == "detect_all"


def test_evidence_frame_in_privacy_mode_uses_the_detector_alone(tmp_path):
    src = str(tmp_path / "in.mp4")
    _make_synthetic_mp4(src, frames=30, fps=15)
    engine = BoxEngine()
    view_renderer.render_blurred_frame(src, 1.5, engine, ProtectedTimeline(intervals=((1.0, 2.0),)))
    assert engine.calls == ["detect_boxes"]
    engine.calls.clear()
    view_renderer.render_blurred_frame(src, 0.5, engine, ProtectedTimeline(intervals=((1.0, 2.0),)))
    assert engine.calls == ["detect_all"]


def test_detector_outage_blacks_out_playback_and_evidence(tmp_path):
    """A failed detector cannot publish raw pixels via derived media."""
    class BrokenEngine:
        def detect_all(self, _jpeg):
            raise RuntimeError("detector offline")

    src, out = str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4")
    _make_synthetic_mp4(src, frames=8, fps=15)
    engine = BrokenEngine()

    assert view_renderer.render_blurred_view(src, out, engine) == 8
    cap = cv2.VideoCapture(out)
    try:
        ok, frame = cap.read()
        assert ok and frame is not None
        assert int(frame.max()) <= 16
    finally:
        cap.release()

    jpeg = view_renderer.render_blurred_frame(src, 0.0, engine)
    decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None and int(decoded.max()) <= 16


# ── the endpoints load the protection (and fail closed) ─────────────────
@pytest.fixture
def endpoint(tmp_path, monkeypatch):
    import crypto_utils
    import main
    from fastapi.testclient import TestClient

    source = tmp_path / "source.mp4"
    _make_synthetic_mp4(str(source))
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"t" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    encrypted = crypto_utils.encrypt_bytes(source.read_bytes(), recording_id=REC)
    row = {"original_path": "x.enc", "has_original": True, "camera_id": CAM,
           "started_at": "2026-09-28T08:59:50+00:00", "duration_sec": 30.0,
           "storage_path": "x.enc", "capture_status": "ready"}
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.maybe_single.return_value = query
    query.execute.return_value = SimpleNamespace(data=row)
    db = Mock()
    db.table.return_value = query
    db.storage.from_.return_value.download.return_value = encrypted
    store = SimpleNamespace(client=db, list_privacy_spans=Mock(return_value=[]))
    monkeypatch.setattr(main, "storage", store)
    monkeypatch.setattr(main, "face_engine", None)
    monkeypatch.setattr(main, "ML_TOKEN", "test-token")
    monkeypatch.setattr(main, "_VIEW_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(privacy_protection, "PRIVACY_SCHEDULE_PAD_SEC", 0.0)
    rendered: list[ProtectedTimeline] = []

    def fake_render(_input, output, _engine, _start=None, _end=None, protection=None):
        rendered.append(protection)
        with open(output, "wb") as handle:
            handle.write(b"\0" * 2000)
        return 8

    def fake_frame(_input, _at, _engine, protection=None):
        rendered.append(protection)
        return b"\xff\xd8jpeg"

    monkeypatch.setattr(main, "render_blurred_view", fake_render)
    monkeypatch.setattr(main, "render_blurred_frame", fake_frame)
    return SimpleNamespace(client=TestClient(main.app), store=store, rendered=rendered, monkeypatch=monkeypatch)


HEADERS = {"Authorization": "Bearer test-token"}


def _install_schedule(monkeypatch, schedule_or_error):
    loader = (Mock(side_effect=schedule_or_error) if isinstance(schedule_or_error, Exception)
              else Mock(return_value=schedule_or_error))
    monkeypatch.setattr(privacy_schedule, "_cache",
                        PrivacyScheduleCache(SimpleNamespace(load_privacy_schedule=loader)))


def test_view_renders_protected_stretches_from_spans_and_schedule(endpoint):
    # Private until 18:00 KST = offset 10 s; a span covers [20, 25).
    _install_schedule(endpoint.monkeypatch, CameraSchedule("standard", (Window("private", "09:00", "18:00", 127),)))
    endpoint.store.list_privacy_spans.return_value = [
        {"start_offset_sec": 20.0, "end_offset_sec": 25.0, "source": "schedule"},
    ]
    response = endpoint.client.get(f"/recording/{REC}/view", headers=HEADERS)
    assert response.status_code == 200
    (protection,) = endpoint.rendered
    assert protection.intervals == ((0.0, 10.0), (20.0, 25.0))


@pytest.mark.parametrize("failure", ["spans", "schedule"])
def test_view_fails_closed_to_the_whole_recording_but_still_serves(endpoint, failure):
    if failure == "spans":
        endpoint.store.list_privacy_spans.side_effect = ConnectionError("database down")
        _install_schedule(endpoint.monkeypatch, CameraSchedule("standard"))
    else:
        _install_schedule(endpoint.monkeypatch, ConnectionError("database down"))
    response = endpoint.client.get(f"/recording/{REC}/view", headers=HEADERS)
    assert response.status_code == 200
    (protection,) = endpoint.rendered
    assert protection.covers(0.0) and protection.covers(1e6)


def test_evidence_frame_and_clip_get_the_protection(endpoint):
    _install_schedule(endpoint.monkeypatch, CameraSchedule("private"))
    frame = endpoint.client.get(f"/recording/{REC}/evidence-frame?at_sec=1.0", headers=HEADERS)
    clip = endpoint.client.get(f"/recording/{REC}/evidence-clip?start_sec=0&end_sec=1", headers=HEADERS)
    assert frame.status_code == 200 and clip.status_code == 200
    assert len(endpoint.rendered) == 2
    assert all(p.covers(0.0) and p.covers(29.0) for p in endpoint.rendered)


def test_health_reports_the_privacy_schedule_capability():
    import main
    from fastapi.testclient import TestClient

    body = TestClient(main.app).get("/").json()
    assert body["privacy_schedules"] == main.PRIVACY_SCHEDULES_CAPABILITY == 1


def test_started_at_parse_matches_the_reveal_job():
    assert privacy_protection.parse_timestamp("2026-09-28T08:59:50Z") == datetime(
        2026, 9, 28, 8, 59, 50, tzinfo=timezone.utc)
