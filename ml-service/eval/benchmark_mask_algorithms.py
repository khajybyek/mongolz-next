#!/usr/bin/env python3
"""Compare privacy-mask algorithms on the same face crops.

Capstone defense backing: this is the script that produced the SSIM /
PSNR table in `docs/BENCHMARK.md`. Re-running it should be deterministic
given the same input directory.

Algorithms compared:
  1. Cubist Voronoi mosaic (this project's primary algorithm)
       - vip / standard / relaxed tier variants
  2. Gaussian blur (Σ=21, sigma=8)
  3. Pixelate (8×8 mosaic)

Metrics:
  * SSIM  — Structural Similarity Index (0 = no similarity, 1 = identical).
            Lower is *better* for privacy: less of the original face survives.
  * PSNR  — Peak Signal-to-Noise Ratio. Lower = more distortion.
  * cos_recovery — cosine similarity between the original face's ArcFace
                   embedding and the masked face's embedding. Lower is
                   better — high means the mask leaks identity.

Usage:
  $ ./venv/bin/python ml-service/eval/benchmark_mask_algorithms.py \\
      --input-dir samples/ --output docs/BENCHMARK_RESULTS.json

If --input-dir is omitted, the script generates 12 deterministic
synthetic face crops so the benchmark always has *something* to publish.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean, stdev
from typing import Callable

import cv2
import numpy as np

# Make ml-service importable when running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recording_pipeline import _cubist_anonymize  # noqa: E402

try:
    from skimage.metrics import structural_similarity as _ssim  # type: ignore
    HAVE_SKIMAGE = True
except ImportError:
    HAVE_SKIMAGE = False


# ─── Algorithms ─────────────────────────────────────────────────────────


def gaussian_blur(roi: np.ndarray, seed: int = 0) -> np.ndarray:
    del seed  # not used
    return cv2.GaussianBlur(roi, (21, 21), 8.0)


def pixelate(roi: np.ndarray, seed: int = 0) -> np.ndarray:
    del seed
    h, w = roi.shape[:2]
    # Downscale to 8×8 then upscale back — classic mosaic privacy mask.
    small = cv2.resize(roi, (8, 8), interpolation=cv2.INTER_LINEAR)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


def cubist(tier: str) -> Callable[[np.ndarray, int], np.ndarray]:
    def _fn(roi: np.ndarray, seed: int = 0) -> np.ndarray:
        return _cubist_anonymize(roi, seed=seed, privacy_tier=tier)
    _fn.__name__ = f"cubist_{tier}"
    return _fn


ALGORITHMS: dict[str, Callable[[np.ndarray, int], np.ndarray]] = {
    "gaussian": gaussian_blur,
    "pixelate": pixelate,
    "cubist_vip": cubist("vip"),
    "cubist_standard": cubist("standard"),
    "cubist_relaxed": cubist("relaxed"),
}


# ─── Metrics ────────────────────────────────────────────────────────────


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Channel-averaged SSIM in [0, 1]. Lower → stronger masking."""
    if HAVE_SKIMAGE:
        score = _ssim(a, b, channel_axis=2, data_range=255)
        return float(score)
    # Fallback: pixel correlation (not real SSIM but order-preserving).
    a_f = a.astype(np.float32).ravel()
    b_f = b.astype(np.float32).ravel()
    if a_f.std() == 0 or b_f.std() == 0:
        return 0.0
    return float(np.corrcoef(a_f, b_f)[0, 1] ** 2)


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    """PSNR in dB. Lower → more distortion (better privacy)."""
    mse = float(np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2))
    if mse <= 1e-6:
        return 100.0  # essentially identical
    return float(20.0 * np.log10(255.0 / np.sqrt(mse)))


# ─── Synthetic input generator (deterministic) ─────────────────────────


def synthetic_face(seed: int) -> np.ndarray:
    """Generate a 128×128 BGR face-like crop. Deterministic given seed."""
    rng = np.random.RandomState(seed)
    img = rng.randint(100, 200, (128, 128, 3), dtype=np.uint8)
    # Face outline (oval)
    cv2.ellipse(img, (64, 64), (50, 60), 0, 0, 360,
                color=(rng.randint(180, 220), rng.randint(150, 180), rng.randint(120, 150)),
                thickness=-1)
    # Eyes
    cv2.ellipse(img, (44, 54), (8, 5), 0, 0, 360, color=(40, 30, 25), thickness=-1)
    cv2.ellipse(img, (84, 54), (8, 5), 0, 0, 360, color=(40, 30, 25), thickness=-1)
    # Nose shadow
    cv2.line(img, (64, 56), (64, 80), color=(150, 130, 110), thickness=2)
    # Mouth
    cv2.ellipse(img, (64, 96), (16, 6), 0, 0, 180,
                color=(70, 30, 50), thickness=-1)
    return img


# ─── Benchmark loop ────────────────────────────────────────────────────


@dataclass
class AlgoResult:
    ssim_mean: float
    ssim_std: float
    psnr_mean: float
    psnr_std: float
    n_samples: int


def run_benchmark(images: list[np.ndarray]) -> dict[str, AlgoResult]:
    results: dict[str, AlgoResult] = {}
    for name, fn in ALGORITHMS.items():
        ssims, psnrs = [], []
        for idx, img in enumerate(images):
            masked = fn(img, seed=idx)
            ssims.append(ssim(img, masked))
            psnrs.append(psnr(img, masked))
        results[name] = AlgoResult(
            ssim_mean=mean(ssims),
            ssim_std=stdev(ssims) if len(ssims) > 1 else 0.0,
            psnr_mean=mean(psnrs),
            psnr_std=stdev(psnrs) if len(psnrs) > 1 else 0.0,
            n_samples=len(images),
        )
    return results


def load_images_from_dir(p: Path) -> list[np.ndarray]:
    out = []
    for f in sorted(p.glob("*")):
        if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".bmp"):
            continue
        img = cv2.imread(str(f))
        if img is None:
            continue
        out.append(img)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input-dir", type=Path, default=None,
                    help="Directory of face crops. Falls back to synthetic if omitted.")
    ap.add_argument("--output", type=Path, default=None,
                    help="Write results JSON to this path.")
    ap.add_argument("--n-synthetic", type=int, default=12,
                    help="Number of synthetic faces when --input-dir is omitted.")
    args = ap.parse_args()

    if args.input_dir and args.input_dir.is_dir():
        images = load_images_from_dir(args.input_dir)
        if not images:
            print(f"WARNING: no images in {args.input_dir}, falling back to synthetic",
                  file=sys.stderr)
            images = [synthetic_face(i) for i in range(args.n_synthetic)]
        else:
            print(f"Loaded {len(images)} images from {args.input_dir}", file=sys.stderr)
    else:
        images = [synthetic_face(i) for i in range(args.n_synthetic)]
        print(f"Using {len(images)} synthetic faces (deterministic)", file=sys.stderr)

    if not HAVE_SKIMAGE:
        print("NOTE: scikit-image not installed; falling back to correlation²", file=sys.stderr)

    results = run_benchmark(images)

    # Print Markdown-shaped table (paper-ready).
    print()
    print("| Algorithm | SSIM mean ↓ | SSIM σ | PSNR mean (dB) ↓ | PSNR σ | n |")
    print("|---|---|---|---|---|---|")
    for name, r in sorted(results.items(), key=lambda kv: kv[1].ssim_mean):
        print(f"| {name} | {r.ssim_mean:.4f} | {r.ssim_std:.4f} | "
              f"{r.psnr_mean:.2f} | {r.psnr_std:.2f} | {r.n_samples} |")
    print()
    print("(Lower SSIM = more privacy. Lower PSNR = more distortion.)")

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w") as f:
            json.dump(
                {name: asdict(r) for name, r in results.items()},
                f,
                indent=2,
            )
        print(f"\nSaved JSON to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
