"""Unit tests for the privacy-zone filter helpers on RevealProcessor.

We don't instantiate the full processor (it pulls in InsightFace +
Supabase storage); the two helpers under test are pure and only need
the static-method signatures, so we exercise them by name.
"""
from __future__ import annotations

import pytest

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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
