#!/usr/bin/env python3
"""Offline, local-only evaluation of the production FaceMasker on annotated CCTV media.

The manifest format and interpretation of these *screening* metrics are in
``docs/operations/masking-evaluation.md``. No input pixels, biometric templates,
camera URLs, or source paths are included in the report.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import re
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from face_masker import Box, FaceMasker  # noqa: E402
from recording_pipeline import (  # noqa: E402
    BLUR_PAD_RATIO,
    BLUR_PERSIST_FRAMES,
    HAAR_MIN_NEIGHBORS,
    HAAR_MIN_SIZE,
    HAAR_SCALE_FACTOR,
    INSIGHTFACE_BLUR_EVERY_N,
    INSIGHTFACE_MIN_CONFIDENCE,
)


IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp"})
VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".mkv", ".avi"})
ASSET_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MODEL_FILES = (
    "det_10g.onnx", "w600k_r50.onnx", "1k3d68.onnx",
    "2d106det.onnx", "genderage.onnx",
)


@dataclass(frozen=True)
class Asset:
    asset_id: str
    kind: str
    path: Path
    annotations: dict[int, tuple[Box, ...]]


def _boxes(value: object, label: str) -> tuple[Box, ...]:
    if not isinstance(value, list):
        raise ValueError(f"{label}: faces must be an array")
    boxes: list[Box] = []
    for box in value:
        if (not isinstance(box, list) or len(box) != 4
                or any(type(v) is not int for v in box)):
            raise ValueError(f"{label}: every face must be four integer xyxy coordinates")
        x1, y1, x2, y2 = box
        if min(x1, y1) < 0 or x2 <= x1 or y2 <= y1:
            raise ValueError(f"{label}: face boxes must have positive area and origin")
        boxes.append((x1, y1, x2, y2))
    return tuple(boxes)


def load_manifest(manifest_path: Path) -> list[Asset]:
    """Validate every source before opening any video; accept no network paths."""
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("cannot read a valid local JSON manifest") from exc
    if (not isinstance(manifest, dict) or type(manifest.get("schema_version")) is not int
            or manifest["schema_version"] != 1):
        raise ValueError("manifest schema_version must be 1")
    if manifest.get("consent_confirmed") is not True:
        raise ValueError("manifest must explicitly confirm consent for all media")
    entries = manifest.get("assets")
    if not isinstance(entries, list) or not entries:
        raise ValueError("manifest must contain at least one asset")

    root = manifest_path.parent.resolve()
    assets: list[Asset] = []
    seen_ids: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("asset entries must be objects")
        asset_id = entry.get("id")
        if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
            raise ValueError("asset id must use 1-64 ASCII letters, digits, _ or -")
        if asset_id in seen_ids:
            raise ValueError(f"{asset_id}: duplicate asset id")
        seen_ids.add(asset_id)
        kind = entry.get("type")
        if kind not in ("image", "video"):
            raise ValueError(f"{asset_id}: type must be image or video")
        source = entry.get("path")
        if (not isinstance(source, str) or not source or "://" in source
                or Path(source).is_absolute()):
            raise ValueError(f"{asset_id}: path must be a local relative file")
        try:
            path = (root / source).resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise ValueError(f"{asset_id}: local source is unavailable") from exc
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"{asset_id}: source must be a file inside the manifest directory")
        allowed = IMAGE_SUFFIXES if kind == "image" else VIDEO_SUFFIXES
        if path.suffix.lower() not in allowed:
            raise ValueError(f"{asset_id}: unsupported local media type")

        if kind == "image":
            if "frames" in entry:
                raise ValueError(f"{asset_id}: image assets use faces, not frames")
            annotations = {0: _boxes(entry.get("faces"), asset_id)}
        else:
            if "faces" in entry:
                raise ValueError(f"{asset_id}: video assets use annotated frames")
            frames = entry.get("frames")
            if not isinstance(frames, list) or not frames:
                raise ValueError(f"{asset_id}: video must have annotated frames")
            annotations = {}
            for item in frames:
                if not isinstance(item, dict) or type(item.get("frame")) is not int or item["frame"] < 0:
                    raise ValueError(f"{asset_id}: frame must be a nonnegative integer")
                index = item["frame"]
                if index in annotations:
                    raise ValueError(f"{asset_id}: duplicate frame annotation")
                annotations[index] = _boxes(item.get("faces"), asset_id)
        assets.append(Asset(asset_id, kind, path, annotations))
    return assets


def _local_insight_engine(model_root: Path):
    """Load the same model pack as production, with no download opportunity."""
    model_dir = model_root.expanduser().resolve() / "models" / "buffalo_l"
    if not model_dir.is_dir() or any(not (model_dir / name).is_file() for name in MODEL_FILES):
        raise ValueError("local buffalo_l model pack is incomplete; refusing model download")
    from insightface.app import FaceAnalysis  # imported only on explicit request
    from face_engine import FaceEngine

    # InsightFace prints absolute model paths during initialization. Keep them
    # out of logs and reports, even for a source path with a private username.
    try:
        with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink):
            app = FaceAnalysis(name="buffalo_l", root=str(model_root.expanduser()),
                               providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=0, det_size=(320, 320))
    except Exception as exc:  # model libraries may include local paths in errors
        raise ValueError("local InsightFace model initialization failed") from exc
    engine = FaceEngine.__new__(FaceEngine)
    engine.app = app
    return engine


def _mask_rects(masker: FaceMasker, width: int, height: int) -> list[Box]:
    """Mirror FaceMasker's padded mask footprint, excluding too-small boxes."""
    rects: list[Box] = []
    for (x1, y1, x2, y2), _ttl, _tier in masker.cache:
        pad_x = int((x2 - x1) * masker.pad_ratio)
        pad_y = int((y2 - y1) * masker.pad_ratio)
        rect = (max(0, x1 - pad_x), max(0, y1 - pad_y),
                min(width, x2 + pad_x), min(height, y2 + pad_y))
        if rect[2] - rect[0] >= 8 and rect[3] - rect[1] >= 8:
            rects.append(rect)
    return rects


def _face_metrics(original: np.ndarray, masked: np.ndarray, face: Box,
                  rects: list[Box]) -> dict[str, float]:
    x1, y1, x2, y2 = face
    covered = np.zeros((y2 - y1, x2 - x1), dtype=bool)
    for rx1, ry1, rx2, ry2 in rects:
        ix1, iy1, ix2, iy2 = max(x1, rx1), max(y1, ry1), min(x2, rx2), min(y2, ry2)
        if ix2 > ix1 and iy2 > iy1:
            covered[iy1 - y1:iy2 - y1, ix1 - x1:ix2 - x1] = True
    delta = cv2.absdiff(original[y1:y2, x1:x2], masked[y1:y2, x1:x2])
    return {
        "coverage": float(covered.mean()),
        "altered_fraction": float(np.any(delta > 2, axis=2).mean()),
        "mean_abs_delta": float(delta.mean()),
    }


def _latency_summary(values: list[float]) -> dict[str, float]:
    return {
        "mean_ms": round(statistics.mean(values), 3),
        "p95_ms": round(float(np.percentile(values, 95)), 3),
        "max_ms": round(max(values), 3),
    }


def evaluate(
    assets: list[Asset],
    masker_factory: Callable[[], FaceMasker],
    *,
    min_coverage: float = 0.90,
    min_altered_fraction: float = 0.10,
    max_frames: int = 100_000,
) -> dict:
    """Process video sequentially so persistence and detector cadence are real."""
    if not (math.isfinite(min_coverage) and math.isfinite(min_altered_fraction)
            and 0 <= min_coverage <= 1 and 0 <= min_altered_fraction <= 1):
        raise ValueError("thresholds must be between 0 and 1")
    if max_frames < 1:
        raise ValueError("max_frames must be positive")
    if any(max(asset.annotations) >= max_frames for asset in assets):
        raise ValueError("annotated frame exceeds max_frames guard")

    per_asset = []
    misses = []
    all_latencies: list[float] = []
    face_coverages: list[float] = []
    face_altered: list[float] = []
    face_deltas: list[float] = []
    total_faces = 0
    annotated_frames = 0
    frames_with_miss = 0
    processed_frames = 0
    blackout_frames = 0
    detector_unavailable_frames = 0

    for asset in assets:
        masker = masker_factory()  # cache must never carry over to another clip
        latencies: list[float] = []
        asset_faces = 0
        asset_misses = 0
        asset_annotated = 0
        asset_blackouts = 0
        asset_detector_unavailable = 0
        asset_coverages: list[float] = []
        asset_altered: list[float] = []
        asset_deltas: list[float] = []
        capture = None
        if asset.kind == "video":
            capture = cv2.VideoCapture(str(asset.path))
            if not capture.isOpened():
                raise ValueError(f"{asset.asset_id}: cannot decode local video")
        try:
            last_index = max(asset.annotations)
            for frame_index in range(last_index + 1):
                if capture is None:
                    frame = cv2.imread(str(asset.path), cv2.IMREAD_COLOR)
                    ok = frame is not None
                else:
                    ok, frame = capture.read()
                if not ok or frame is None:
                    raise ValueError(f"{asset.asset_id}: media ended before annotated frame")
                start = time.perf_counter()
                masked = masker.mask(frame)
                latency_ms = (time.perf_counter() - start) * 1000
                # Strict live capture blacks out every pixel on detector
                # failure. A black input is safe too: changed-pixel fraction
                # cannot diagnose exposure on a full-black output.
                blackout = masker.fail_closed and not np.any(masked)
                if masker.fail_closed and masker._masking_unavailable:
                    detector_unavailable_frames += 1
                    asset_detector_unavailable += 1
                if blackout:
                    blackout_frames += 1
                    asset_blackouts += 1
                latencies.append(latency_ms)
                all_latencies.append(latency_ms)
                processed_frames += 1
                if frame_index not in asset.annotations:
                    continue
                annotated_frames += 1
                asset_annotated += 1
                height, width = frame.shape[:2]
                rects = [(0, 0, width, height)] if blackout else _mask_rects(masker, width, height)
                frame_missed = False
                for face_index, face in enumerate(asset.annotations[frame_index]):
                    x1, y1, x2, y2 = face
                    if x2 > width or y2 > height:
                        raise ValueError(f"{asset.asset_id}: annotation exceeds decoded frame")
                    metrics = _face_metrics(frame, masked, face, rects)
                    face_coverages.append(metrics["coverage"])
                    face_altered.append(metrics["altered_fraction"])
                    face_deltas.append(metrics["mean_abs_delta"])
                    asset_coverages.append(metrics["coverage"])
                    asset_altered.append(metrics["altered_fraction"])
                    asset_deltas.append(metrics["mean_abs_delta"])
                    total_faces += 1
                    asset_faces += 1
                    if not blackout and (metrics["coverage"] < min_coverage
                                         or metrics["altered_fraction"] < min_altered_fraction):
                        frame_missed = True
                        asset_misses += 1
                        misses.append({
                            "asset_id": asset.asset_id,
                            "frame": frame_index,
                            "face_index": face_index,
                            **{key: round(value, 4) for key, value in metrics.items()},
                        })
                if frame_missed:
                    frames_with_miss += 1
        finally:
            if capture is not None:
                capture.release()
        per_asset.append({
            "id": asset.asset_id,
            "type": asset.kind,
            "processed_frames": len(latencies),
            "blackout_frames": asset_blackouts,
            "detector_unavailable_frames": asset_detector_unavailable,
            "annotated_frames": asset_annotated,
            "annotated_faces": asset_faces,
            "suspected_exposures": asset_misses,
            "face_coverage_mean": round(statistics.mean(asset_coverages), 4) if asset_coverages else None,
            "face_altered_fraction_mean": round(statistics.mean(asset_altered), 4) if asset_altered else None,
            "face_mean_abs_delta_mean": round(statistics.mean(asset_deltas), 4) if asset_deltas else None,
            "latency": _latency_summary(latencies),
        })

    return {
        "schema_version": 1,
        "thresholds": {"min_coverage": min_coverage,
                       "min_altered_fraction": min_altered_fraction},
        "summary": {
            "processed_frames": processed_frames,
            "blackout_frames": blackout_frames,
            "detector_unavailable_frames": detector_unavailable_frames,
            "annotated_frames": annotated_frames,
            "annotated_faces": total_faces,
            "suspected_exposures": len(misses),
            "frames_with_suspected_exposure": frames_with_miss,
            "face_coverage_mean": round(statistics.mean(face_coverages), 4) if face_coverages else None,
            "face_coverage_min": round(min(face_coverages), 4) if face_coverages else None,
            "face_altered_fraction_mean": round(statistics.mean(face_altered), 4) if face_altered else None,
            "face_mean_abs_delta_mean": round(statistics.mean(face_deltas), 4) if face_deltas else None,
            "latency": _latency_summary(all_latencies),
        },
        "assets": per_asset,
        "suspected_exposures": misses,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--report", type=Path, help="Local JSON report; never contains source paths or pixels")
    parser.add_argument("--detector", choices=("haar", "insight"), required=True)
    parser.add_argument("--privacy-mode", choices=("standard", "private"), default="standard")
    parser.add_argument("--model-root", type=Path, default=Path("~/.insightface"))
    parser.add_argument("--min-coverage", type=float, default=0.90)
    parser.add_argument("--min-altered-fraction", type=float, default=0.10)
    parser.add_argument("--max-frames", type=int, default=100_000)
    args = parser.parse_args(argv)
    try:
        assets = load_manifest(args.manifest)
        if args.report:
            report_path = args.report.expanduser().resolve()
            if report_path == args.manifest.resolve() or any(
                report_path == asset.path for asset in assets
            ):
                raise ValueError("report would overwrite the manifest or source media")
        engine = _local_insight_engine(args.model_root) if args.detector == "insight" else None

        def make_masker() -> FaceMasker:
            masker = FaceMasker(
                engine,
                haar_scale=HAAR_SCALE_FACTOR,
                haar_neighbors=HAAR_MIN_NEIGHBORS,
                haar_min_size=HAAR_MIN_SIZE,
                insight_every_n=INSIGHTFACE_BLUR_EVERY_N,
                insight_min_confidence=INSIGHTFACE_MIN_CONFIDENCE,
                persist_frames=BLUR_PERSIST_FRAMES,
                pad_ratio=BLUR_PAD_RATIO,
                fail_closed=args.detector == "insight",
            )
            masker.embeddings_allowed = args.privacy_mode == "standard"
            return masker

        result = evaluate(assets, make_masker,
                          min_coverage=args.min_coverage,
                          min_altered_fraction=args.min_altered_fraction,
                          max_frames=args.max_frames)
        result["configuration"] = {"detector": args.detector, "privacy_mode": args.privacy_mode}
        if args.report:
            args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        summary = result["summary"]
        print(json.dumps({"configuration": result["configuration"], "summary": summary}))
        return 0 if summary["suspected_exposures"] == 0 else 2
    except ValueError as exc:
        # Never echo a potentially credential-bearing source or output path.
        print(f"Masking evaluation failed: {exc}", file=sys.stderr)
        return 1
    except OSError:
        print("Masking evaluation failed: local input or report I/O error", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
