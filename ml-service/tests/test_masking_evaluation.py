"""Exercise local-only manifest guards and real FaceMasker evaluation cadence."""

from __future__ import annotations

import json
from dataclasses import dataclass

import cv2
import numpy as np
import pytest

from eval.evaluate_masking import _local_insight_engine, evaluate, load_manifest, main
from face_masker import FaceMasker


@dataclass
class _Detection:
    bbox: tuple[int, int, int, int]
    confidence: float = 0.99
    embedding: np.ndarray | None = None


class _FirstFrameOnly:
    def __init__(self):
        self.calls = 0

    def detect_all(self, _jpeg):
        self.calls += 1
        return [_Detection((35, 25, 105, 95))] if self.calls == 1 else []


def _manifest(tmp_path, entry, consent=True):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "consent_confirmed": consent,
        "assets": [entry],
    }), encoding="utf-8")
    return path


def test_manifest_requires_consent_and_in_root_local_media(tmp_path):
    img = np.random.default_rng(2).integers(0, 256, (120, 160, 3), dtype=np.uint8)
    cv2.imwrite(str(tmp_path / "frame.png"), img)
    entry = {"id": "frame-a", "type": "image", "path": "frame.png", "faces": [[1, 2, 30, 40]]}
    assert load_manifest(_manifest(tmp_path, entry))[0].annotations[0] == ((1, 2, 30, 40),)
    with pytest.raises(ValueError, match="consent"):
        load_manifest(_manifest(tmp_path, entry, consent=False))
    entry["path"] = "rtsp://camera:password@example.test/live"
    with pytest.raises(ValueError, match="local relative"):
        load_manifest(_manifest(tmp_path, entry))
    entry["path"] = "/tmp/secret.png"
    with pytest.raises(ValueError, match="local relative"):
        load_manifest(_manifest(tmp_path, entry))
    entry["path"] = "outside.png"
    actual_outside = tmp_path.parent / f"{tmp_path.name}-outside.png"
    cv2.imwrite(str(actual_outside), img)
    (tmp_path / "outside.png").symlink_to(actual_outside)
    with pytest.raises(ValueError, match="source"):
        load_manifest(_manifest(tmp_path, entry))


def test_sequential_video_scores_persisted_mask_then_miss(tmp_path):
    video = tmp_path / "clip.mp4"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 15, (160, 120))
    assert writer.isOpened()
    for seed in range(3):
        frame = np.random.default_rng(seed).integers(0, 256, (120, 160, 3), dtype=np.uint8)
        writer.write(frame)
    writer.release()
    entry = {
        "id": "moving_face", "type": "video", "path": "clip.mp4",
        "frames": [{"frame": i, "faces": [[35, 25, 105, 95]]} for i in range(3)],
    }
    assets = load_manifest(_manifest(tmp_path, entry))

    def factory():
        return FaceMasker(_FirstFrameOnly(), insight_every_n=1,
                          persist_frames=2, haar_neighbors=99)

    report = evaluate(assets, factory)
    assert report["summary"]["processed_frames"] == 3
    assert report["summary"]["annotated_faces"] == 3
    assert report["summary"]["suspected_exposures"] == 1
    assert report["summary"]["face_mean_abs_delta_mean"] > 0
    assert report["suspected_exposures"][0]["frame"] == 2
    assert report["suspected_exposures"][0]["coverage"] == 0
    assert report["assets"][0]["latency"]["p95_ms"] >= 0


def test_annotation_bounds_and_frame_limit_are_explicit(tmp_path):
    cv2.imwrite(str(tmp_path / "frame.png"), np.zeros((40, 60, 3), dtype=np.uint8))
    entry = {"id": "oversize", "type": "image", "path": "frame.png", "faces": [[0, 0, 70, 20]]}
    assets = load_manifest(_manifest(tmp_path, entry))
    with pytest.raises(ValueError, match="annotation exceeds"):
        evaluate(assets, lambda: FaceMasker(None))
    with pytest.raises(ValueError, match="max_frames"):
        evaluate(assets, lambda: FaceMasker(None), max_frames=0)


def test_cli_report_omits_local_paths_and_refuses_input_overwrite(tmp_path, capsys):
    cv2.imwrite(str(tmp_path / "private-frame.png"), np.zeros((40, 60, 3), dtype=np.uint8))
    entry = {"id": "frame_zero", "type": "image", "path": "private-frame.png", "faces": []}
    manifest = _manifest(tmp_path, entry)
    report = tmp_path / "report.json"
    assert main(["--manifest", str(manifest), "--detector", "haar", "--report", str(report)]) == 0
    assert str(tmp_path) not in capsys.readouterr().out
    saved = report.read_text(encoding="utf-8")
    assert "private-frame.png" not in saved
    assert saved.count('"frame_zero"') == 1
    assert main(["--manifest", str(manifest), "--detector", "haar",
                 "--report", str(tmp_path / "private-frame.png")]) == 1
    assert "overwrite" in capsys.readouterr().err


def test_insight_run_refuses_missing_local_model_without_download(tmp_path):
    with pytest.raises(ValueError, match="refusing model download"):
        _local_insight_engine(tmp_path)


def test_strict_blackout_is_counted_as_protected(tmp_path):
    frame = np.random.default_rng(8).integers(0, 256, (120, 160, 3), dtype=np.uint8)
    cv2.imwrite(str(tmp_path / "frame.png"), frame)
    entry = {"id": "outage", "type": "image", "path": "frame.png",
             "faces": [[35, 25, 105, 95]]}

    class BrokenEngine:
        def detect_all(self, _jpeg):
            raise RuntimeError("detector unavailable")

    assets = load_manifest(_manifest(tmp_path, entry))
    result = evaluate(assets, lambda: FaceMasker(BrokenEngine(), fail_closed=True,
                                                   haar_neighbors=99))
    assert result["summary"]["blackout_frames"] == 1
    assert result["summary"]["detector_unavailable_frames"] == 1
    assert result["summary"]["suspected_exposures"] == 0
    assert result["summary"]["face_coverage_min"] == 1
