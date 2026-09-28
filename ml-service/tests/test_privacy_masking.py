"""Privacy-mode masking (ADR 0012): the mask stays on, identification stops.

FaceMasker's InsightFace pass used ``detect_all`` (which runs ArcFace) and the
live pipeline's ``tier_for`` compared every face with the suspect watchlist to
pick the mosaic tier. In `private` mode neither may happen: boxes come from the
detector alone — never from a ``detect_all`` fallback — and every box gets the
most protective tier.
"""
from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace

import cv2
import numpy as np

from face_engine import DetectedBox, FaceEngine
from face_masker import FaceMasker


@dataclass
class _Det:
    bbox: tuple[float, float, float, float]
    confidence: float
    embedding: np.ndarray


BOX = (40, 40, 140, 140)


class _Engine:
    def __init__(self):
        self.calls: list[str] = []

    def detect_all(self, _jpeg):
        self.calls.append("detect_all")
        return [_Det(BOX, 0.99, np.ones(512, dtype=np.float32))]

    def detect_boxes(self, _jpeg):
        self.calls.append("detect_boxes")
        return [DetectedBox(BOX, 0.99)]


class _LegacyEngine:
    """No detect_boxes (older engine / test fake)."""

    def __init__(self):
        self.calls: list[str] = []

    def detect_all(self, _jpeg):
        self.calls.append("detect_all")
        return [_Det(BOX, 0.99, np.ones(512, dtype=np.float32))]


def _frame() -> np.ndarray:
    return np.random.default_rng(3).integers(0, 255, size=(200, 200, 3), dtype=np.uint8)


def test_standard_mode_keeps_embedding_tiers():
    engine, looked_up = _Engine(), []
    masker = FaceMasker(engine, tier_for=lambda e: looked_up.append(e) or "relaxed",
                        insight_every_n=1, haar_neighbors=99)
    frame = _frame()
    out = masker.mask(frame)
    assert engine.calls == ["detect_all"] and len(looked_up) == 1
    assert masker.cache[0][2] == "relaxed"
    assert not np.array_equal(out[40:140, 40:140], frame[40:140, 40:140])


def test_private_mode_uses_the_detector_alone_and_the_most_protective_tier():
    engine, looked_up = _Engine(), []
    masker = FaceMasker(engine, tier_for=lambda e: looked_up.append(e) or "relaxed",
                        insight_every_n=1, haar_neighbors=99)
    masker.embeddings_allowed = False
    frame = _frame()
    out = masker.mask(frame)
    assert engine.calls == ["detect_boxes"]  # no ArcFace pass
    assert looked_up == []                   # no watchlist comparison
    assert masker.cache[0][2] == "vip"
    # The face is still masked.
    assert not np.array_equal(out[40:140, 40:140], frame[40:140, 40:140])
    masker.embeddings_allowed = True
    masker.mask(frame)
    assert engine.calls[-1] == "detect_all" and len(looked_up) == 1


def test_private_mode_never_falls_back_to_detect_all(caplog):
    # An engine without a detector-only call: no InsightFace pass at all in
    # private mode (it would compute an ArcFace embedding) — Haar and the
    # persistence cache still mask, and the gap is logged once as an error.
    engine, looked_up = _LegacyEngine(), []
    masker = FaceMasker(engine, tier_for=lambda e: looked_up.append(e) or "relaxed",
                        insight_every_n=1, haar_neighbors=99)
    masker.embeddings_allowed = False
    with caplog.at_level("ERROR", logger="mongolz-ml.masker"):
        masker.mask(_frame())
        masker.mask(_frame())
    assert engine.calls == [] and looked_up == []
    assert caplog.text.count("no embedding is ever computed") == 1


def test_boxes_cached_on_a_standard_frame_keep_masking_a_private_one():
    engine = _LegacyEngine()
    masker = FaceMasker(engine, insight_every_n=1, haar_neighbors=99, persist_frames=5)
    frame = _frame()
    masker.mask(frame)                      # standard: detect_all places the box
    masker.embeddings_allowed = False
    out = masker.mask(frame)                # private: no detection, cache persists
    assert engine.calls == ["detect_all"]
    assert not np.array_equal(out[40:140, 40:140], frame[40:140, 40:140])


def test_maskers_without_tiers_get_the_strongest_mask_in_private_mode():
    # The on-demand view and the reveal masker have no watchlist tiers; in
    # private mode they still mask every face with the most protective tier.
    masker = FaceMasker(_Engine(), insight_every_n=1, haar_neighbors=99)
    masker.mask(_frame())
    assert masker.cache[0][2] == "standard"
    masker = FaceMasker(_Engine(), insight_every_n=1, haar_neighbors=99)
    masker.embeddings_allowed = False
    masker.mask(_frame())
    assert masker.cache[0][2] == "vip"


def test_haar_boxes_get_the_strongest_mask_in_private_mode():
    masker = FaceMasker(None)
    masker.haar = SimpleNamespace(empty=lambda: False, detectMultiScale=lambda *a, **k: [(40, 40, 100, 100)])
    assert masker._detect_haar(_frame()) == [((40, 40, 140, 140), "standard")]
    masker.embeddings_allowed = False
    assert masker._detect_haar(_frame()) == [((40, 40, 140, 140), "vip")]


def test_detect_boxes_runs_only_the_detection_model():
    calls = []

    def detect(img, max_num=0, metric="default"):
        calls.append((img.shape, max_num, metric))
        return np.array([[10, 12, 60, 70, 0.93], [0, 0, 10, 10, 0.99]], dtype=np.float32), None

    engine = FaceEngine.__new__(FaceEngine)
    engine.app = SimpleNamespace(
        det_model=SimpleNamespace(detect=detect),
        get=lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("full pipeline must not run")),
    )
    ok, jpeg = cv2.imencode(".jpg", np.zeros((80, 90, 3), dtype=np.uint8))
    assert ok
    boxes = engine.detect_boxes(jpeg.tobytes())
    assert calls == [((80, 90, 3), 0, "default")]
    assert len(boxes) == 1  # the 10 px box is dropped, as in detect_all
    assert boxes[0].bbox == (10.0, 12.0, 60.0, 70.0)
    assert abs(boxes[0].confidence - 0.93) < 1e-6
    assert not hasattr(boxes[0], "embedding")


def test_detect_boxes_survives_a_detector_keyword_change():
    calls = []

    def detect(img, *args, **kwargs):
        if kwargs:
            raise TypeError("detect() got an unexpected keyword argument 'metric'")
        calls.append(img.shape)
        return np.array([[10, 12, 60, 70, 0.93]], dtype=np.float32), None

    engine = FaceEngine.__new__(FaceEngine)
    engine.app = SimpleNamespace(
        det_model=SimpleNamespace(detect=detect),
        get=lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("full pipeline must not run")),
    )
    ok, jpeg = cv2.imencode(".jpg", np.zeros((80, 90, 3), dtype=np.uint8))
    assert ok
    boxes = engine.detect_boxes(jpeg.tobytes())
    assert calls == [(80, 90, 3)] and boxes[0].bbox == (10.0, 12.0, 60.0, 70.0)


def test_a_failing_detector_only_pass_never_falls_back_to_full_detection(caplog):
    class Flaky(_Engine):
        def detect_boxes(self, _jpeg):
            self.calls.append("detect_boxes")
            raise RuntimeError("model API changed")

    engine, looked_up = Flaky(), []
    masker = FaceMasker(engine, tier_for=lambda e: looked_up.append(e) or "relaxed",
                        insight_every_n=1, haar_neighbors=99)
    masker.embeddings_allowed = False
    with caplog.at_level("ERROR", logger="mongolz-ml.masker"):
        masker.mask(_frame())
    assert engine.calls == ["detect_boxes"] and looked_up == []
    assert masker.cache == []
    assert "detect_boxes failed (RuntimeError)" in caplog.text
