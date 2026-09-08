"""Unit tests for the privacy-zone filter helpers on RevealProcessor.

We don't instantiate the full processor (it pulls in InsightFace +
Supabase storage); the two helpers under test are pure and only need
the static-method signatures, so we exercise them by name.
"""
from __future__ import annotations

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from reveal_job import RevealProcessor


def test_box_center_in_zone_inside():
    # 100x100 frame, bbox in top-left quadrant, zone covers top-left half.
    zone = {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}
    assert RevealProcessor._box_center_in_zone((10, 10, 30, 30), 100, 100, zone) is True


def test_box_center_in_zone_outside():
    zone = {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}
    # Center (75, 75) — bottom-right quadrant, outside the zone.
    assert RevealProcessor._box_center_in_zone((50, 50, 100, 100), 100, 100, zone) is False


def test_box_center_in_zone_edge():
    # Center exactly on the edge — counted as inside (inclusive).
    zone = {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}
    assert RevealProcessor._box_center_in_zone((40, 40, 60, 60), 100, 100, zone) is True


def test_box_center_in_zone_zero_frame_safe():
    # Degenerate frame dims must not divide by zero — return False.
    zone = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    assert RevealProcessor._box_center_in_zone((0, 0, 10, 10), 0, 0, zone) is False


def test_box_center_in_zone_missing_fields_default_to_zero():
    # Zone with no w/h still safely returns False (zero-size zone).
    zone: dict = {}
    assert RevealProcessor._box_center_in_zone((10, 10, 20, 20), 100, 100, zone) is False


def test_filter_by_privacy_zones_keeps_outside_boxes():
    # Class methods need a self only for storage access; we don't touch it.
    proc = RevealProcessor.__new__(RevealProcessor)
    zones = [{"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}]
    inside = (10, 10, 30, 30)
    outside = (60, 60, 90, 90)
    result = proc._filter_by_privacy_zones([inside, outside], zones, 100, 100)
    assert result == [outside]


def test_filter_by_privacy_zones_blocks_overlap_with_any_zone():
    proc = RevealProcessor.__new__(RevealProcessor)
    zones = [
        {"x": 0.0, "y": 0.0, "w": 0.3, "h": 0.3},
        {"x": 0.7, "y": 0.7, "w": 0.3, "h": 0.3},
    ]
    in_first = (5, 5, 15, 15)  # center (10,10) → in first zone
    in_second = (80, 80, 90, 90)  # center (85,85) → in second zone
    in_middle = (40, 40, 60, 60)  # center (50,50) → outside both
    result = proc._filter_by_privacy_zones(
        [in_first, in_middle, in_second], zones, 100, 100
    )
    assert result == [in_middle]


def test_filter_by_privacy_zones_empty_zones_passes_through():
    proc = RevealProcessor.__new__(RevealProcessor)
    boxes = [(10, 10, 30, 30), (60, 60, 90, 90)]
    assert proc._filter_by_privacy_zones(boxes, [], 100, 100) == boxes


def _processor_with_zone_query(data=None, error=None):
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.execute.return_value = SimpleNamespace(data=data)
    query.execute.side_effect = error
    db = Mock()
    db.table.return_value = query
    return RevealProcessor(Mock(), SimpleNamespace(client=db)), query


def test_zone_lookup_distinguishes_successful_empty_result():
    processor, _ = _processor_with_zone_query(data=[])
    assert processor._load_privacy_zones("camera-1") == []


def test_uploaded_recording_without_camera_has_no_camera_rules():
    processor = RevealProcessor(Mock(), SimpleNamespace(client=None))
    assert processor._load_privacy_zones(None) == []
    with pytest.raises(RuntimeError, match="privacy rules unavailable"):
        processor._load_privacy_zones("camera-1")


@pytest.mark.parametrize("data", [None, {}, "invalid"])
def test_zone_lookup_rejects_malformed_response(data):
    processor, _ = _processor_with_zone_query(data=data)
    with pytest.raises(RuntimeError, match="privacy rules unavailable"):
        processor._load_privacy_zones("camera-1")


@pytest.mark.asyncio
async def test_zone_outage_fails_job_before_original_or_render():
    processor, zones = _processor_with_zone_query(error=ConnectionError("database down"))
    job_query = Mock()
    job_query.select.return_value = job_query
    job_query.eq.return_value = job_query
    job_query.maybe_single.return_value = job_query
    job_query.execute.return_value = SimpleNamespace(data={
        "status": "queued", "recording_id": "recording-1",
        "recordings": {"camera_id": "camera-1"},
    })
    processor.storage.client.table.side_effect = lambda name: job_query if name == "reveal_jobs" else zones
    processor._fail = AsyncMock()
    processor._lookup_original = AsyncMock()
    processor._process_video = Mock()

    await processor.run("job-1")

    processor._fail.assert_awaited_once()
    assert "Privacy rules unavailable" in processor._fail.await_args.args[1]
    processor._lookup_original.assert_not_awaited()
    processor._process_video.assert_not_called()
    processor.storage.client.storage.from_.assert_not_called()

    # A later retry must query the rules again instead of caching the failure.
    zones.execute.side_effect = None
    zones.execute.return_value = SimpleNamespace(data=[{"x": 0, "y": 0, "w": 1, "h": 1}])
    assert len(processor._load_privacy_zones("camera-1")) == 1


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
