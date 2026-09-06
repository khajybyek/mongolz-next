"""FaceMasker — the one masking path shared by baked, on-demand and reveal
outputs. Verifies the privacy-relevant behaviour without real faces:
persistence (a missed detection must not expose a face), reveal keep-boxes,
tier merging and IoU."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pytest

from face_masker import FaceMasker, iou, merge_overlapping


@dataclass
class _Det:
    bbox: tuple[float, float, float, float]
    confidence: float
    embedding: np.ndarray


class _OneShotEngine:
    """Reports one face on the first call only (simulates a detector miss)."""

    def __init__(self, box=(40, 40, 120, 120)):
        self.box = box
        self.calls = 0

    def detect_all(self, _jpeg: bytes):
        self.calls += 1
        if self.calls == 1:
            return [_Det(self.box, 0.99, np.zeros(512, dtype=np.float32))]
        return []


def _frame(h=200, w=200) -> np.ndarray:
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, size=(h, w, 3), dtype=np.uint8)


def _region_changed(a: np.ndarray, b: np.ndarray, box) -> bool:
    x1, y1, x2, y2 = box
    return not np.array_equal(a[y1:y2, x1:x2], b[y1:y2, x1:x2])


def test_iou_basic():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == pytest.approx(1.0)
    assert iou((0, 0, 10, 10), (10, 10, 20, 20)) == 0.0
    assert 0.0 < iou((0, 0, 10, 10), (5, 5, 15, 15)) < 1.0


def test_merge_keeps_most_protective_tier():
    merged = merge_overlapping(
        [((0, 0, 100, 100), 5, "relaxed"), ((2, 2, 100, 100), 15, "vip")]
    )
    assert len(merged) == 1
    assert merged[0][2] == "vip"
    assert merged[0][1] == 15  # fresher TTL wins


def test_persistence_keeps_masking_after_detector_miss():
    """Frame 1: InsightFace reports a face. Frames 2..persist_frames: nothing
    is detected, yet the region must stay masked; after the TTL it clears."""
    engine = _OneShotEngine()
    m = FaceMasker(engine, insight_every_n=1, persist_frames=4, haar_neighbors=99)
    frame = _frame()
    box = (40, 40, 120, 120)

    out1 = m.mask(frame)
    assert _region_changed(frame, out1, box), "first frame must be masked"

    for i in range(3):  # TTL 4 → frames 2,3,4 still masked
        out = m.mask(frame)
        assert _region_changed(frame, out, box), f"frame {i + 2} lost persistence"

    out_after = m.mask(frame)
    assert out_after is frame, "cache expired → frame returned untouched"


def test_keep_boxes_leave_target_unmasked():
    engine = _OneShotEngine()
    m = FaceMasker(engine, insight_every_n=1, persist_frames=4, haar_neighbors=99)
    frame = _frame()
    box = (40, 40, 120, 120)
    out = m.mask(frame, keep_boxes=[box])
    assert not _region_changed(frame, out, box)


def test_low_confidence_detections_are_ignored():
    class LowConf(_OneShotEngine):
        def detect_all(self, _jpeg):
            self.calls += 1
            return [_Det(self.box, 0.2, np.zeros(512, dtype=np.float32))]

    m = FaceMasker(LowConf(), insight_every_n=1, haar_neighbors=99)
    frame = _frame()
    assert m.mask(frame) is frame


def test_engine_failure_never_raises():
    class Broken:
        def detect_all(self, _jpeg):
            raise RuntimeError("model crashed")

    m = FaceMasker(Broken(), insight_every_n=1, haar_neighbors=99)
    frame = _frame()
    assert m.mask(frame) is frame  # Haar-only path still runs
