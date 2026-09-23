"""FaceMasker regression.

The first frame of every masker runs InsightFace. Evidence stills
(``render_blurred_frame``) mask exactly one frame with a fresh masker, and
every clip / on-demand view / reveal / live stream starts with one — frames
1-4 used to be Haar-only, so a profile or tilted face appeared in clear.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass

import cv2
import numpy as np
import pytest

from face_masker import FaceMasker


@dataclass
class _Det:
    bbox: tuple[float, float, float, float]
    confidence: float
    embedding: np.ndarray


class _CountingEngine:
    def __init__(self, box=(60, 60, 140, 140)):
        self.box = box
        self.calls = 0

    def detect_all(self, _jpeg: bytes):
        self.calls += 1
        return [_Det(self.box, 0.99, np.zeros(512, dtype=np.float32))]


def _noise(h=240, w=320) -> np.ndarray:
    return np.random.default_rng(3).integers(0, 255, size=(h, w, 3), dtype=np.uint8)


def test_first_frame_runs_insightface():
    engine = _CountingEngine()
    masker = FaceMasker(engine, insight_every_n=5)
    frame = _noise()
    out = masker.mask(frame)
    assert engine.calls == 1
    x1, y1, x2, y2 = engine.box
    assert not np.array_equal(out[y1:y2, x1:x2], frame[y1:y2, x1:x2])
    # The cadence after frame 1 is unchanged: frames 2-4 skip, frame 5 runs.
    for _ in range(3):
        masker.mask(frame)
    assert engine.calls == 1
    masker.mask(frame)
    assert engine.calls == 2


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")
def test_single_evidence_frame_is_masked_by_insightface(tmp_path):
    import view_renderer

    path = str(tmp_path / "src.mp4")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 15, (320, 240))
    assert writer.isOpened()
    frame = _noise()
    for _ in range(30):
        writer.write(frame)
    writer.release()

    engine = _CountingEngine()
    jpeg = view_renderer.render_blurred_frame(path, 1.0, engine=engine)
    assert engine.calls == 1
    decoded = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    cap = cv2.VideoCapture(path)
    ok, original = cap.read()
    cap.release()
    assert ok
    x1, y1, x2, y2 = engine.box
    diff = np.abs(decoded[y1:y2, x1:x2].astype(int) - original[y1:y2, x1:x2].astype(int)).mean()
    assert diff > 20, diff  # masked, not just JPEG noise (~5)
