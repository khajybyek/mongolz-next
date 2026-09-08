"""/eval/bench must measure what it says it measures.

The benchmark ran on a uniform-random-noise image. The detector finds no face
in noise, so ``embed_single()`` performed a detection, then a padded retry, and
returned None: the "Embedding generation" row on /benchmarks never timed an
embedding, the "End-to-end" row was three failed detections, and the headline
FPS was the throughput of finding nothing.

Fixed by benchmarking a real face (the committed samples/00..02.jpg, scaled to
a camera-sized frame) and by publishing what was measured — the input, how
many faces were found, and whether the embedding row is real
(``embedding_measured``). A run that finds no face now says so instead of
quietly publishing the cost of a failure as an embedding latency.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

HEADERS = {"Authorization": "Bearer test-token"}


class _FakeFace:
    def __init__(self):
        self.bbox = (10.0, 10.0, 90.0, 90.0)
        self.embedding = np.zeros(512, dtype=np.float32)


class _FakeEngine:
    """Stands in for InsightFace: `faces` is what the detector "finds"."""

    def __init__(self, faces: int):
        self.faces = faces
        self.detect_calls = 0
        self.embed_calls = 0
        self.seen: list[bytes] = []

    def detect_all(self, image_bytes):
        self.detect_calls += 1
        self.seen.append(image_bytes)
        return [_FakeFace() for _ in range(self.faces)]

    def embed_single(self, image_bytes):
        self.embed_calls += 1
        return np.zeros(512, dtype=np.float32) if self.faces else None

    def info(self):
        return {"model": "fake", "embedding_dim": 512, "det_size": [320, 320]}


# ── the input itself ─────────────────────────────────────────────────────
def test_bench_frame_is_a_real_committed_face_sample():
    data, label, expects_face = main.bench_frame()

    assert expects_face is True, "the committed samples must be used"
    assert label.startswith("sample face (") and label.endswith(".jpg)")

    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert img is not None, "the benchmark input must be a decodable JPEG"
    h, w = img.shape[:2]
    # Scaled to a camera-sized frame so the numbers describe the recording
    # pipeline rather than a 1024px portrait.
    assert max(h, w) <= main.BENCH_MAX_SIDE
    assert min(h, w) > 0

    # And it is not the old noise: a photograph is nothing like uniform noise
    # (random RGB has a per-channel std of ~74).
    assert float(img.std()) < 70.0


def test_bench_frame_falls_back_to_labelled_noise(monkeypatch):
    """With the samples stripped from the image, the run must be visibly not
    a face benchmark — never silently one."""
    monkeypatch.setattr(main, "BENCH_SAMPLES_DIR", "/nonexistent/samples")
    data, label, expects_face = main.bench_frame()
    assert expects_face is False
    assert "NO FACE" in label
    assert cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR) is not None


# ── the response ─────────────────────────────────────────────────────────
def test_bench_reports_a_measured_embedding(monkeypatch):
    engine = _FakeEngine(faces=1)
    monkeypatch.setattr(main, "face_engine", engine)

    res = TestClient(main.app).post("/eval/bench?iterations=3", headers=HEADERS)
    assert res.status_code == 200
    data = res.json()

    assert data["faces_detected"] == 1
    assert data["embedding_measured"] is True
    assert "warning" not in data
    assert data["input_source"].startswith("sample face (")
    # Rendered verbatim on /benchmarks — it must name the input, not just a size.
    assert "sample face" in data["input_resolution"]
    assert data["input_resolution"].split(" ")[0].count("x") == 1

    # Every row was actually timed, and each one says what it ran.
    for row in ("detection", "embedding", "end_to_end"):
        assert data[row]["n"] == 3
        assert row in data["measures"]
    assert data["effective_fps"] > 0
    assert data["effective_fps_end_to_end"] > 0

    # 1 warmup + 3 iterations of detect, and 3 embeds — the same frame each time.
    assert engine.detect_calls == 4 and engine.embed_calls == 3
    assert len(set(engine.seen)) == 1


def test_bench_admits_when_no_face_was_found(monkeypatch):
    """The exact old defect: nothing detected, so nothing was embedded."""
    monkeypatch.setattr(main, "face_engine", _FakeEngine(faces=0))

    data = TestClient(main.app).post("/eval/bench?iterations=2", headers=HEADERS).json()

    assert data["faces_detected"] == 0
    assert data["embedding_measured"] is False
    assert "warning" in data and "embedding" in data["warning"]


def test_bench_still_requires_the_service_token():
    assert TestClient(main.app).post("/eval/bench").status_code in (401, 403)


def test_bench_needs_an_engine(monkeypatch):
    monkeypatch.setattr(main, "face_engine", None)
    assert TestClient(main.app).post("/eval/bench", headers=HEADERS).status_code == 503


@pytest.mark.parametrize("arr,expected_n", [([], 0), ([1.0], 1), ([3.0, 1.0, 2.0], 3)])
def test_bench_stats_shape(arr, expected_n):
    stats = main.bench_stats(arr)
    assert stats["n"] == expected_n
    if expected_n:
        assert stats["min_ms"] <= stats["p50_ms"] <= stats["max_ms"]
