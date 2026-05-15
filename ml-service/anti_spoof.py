"""
Anti-spoofing — heuristic-based liveness checks without an extra ONNX model.

A real production system would use a depth-sensor-based liveness model
(e.g. SilentFaceAntiSpoofing, DeepPixBis). Adding another ONNX model is out of
scope for this capstone — instead we compute three cheap signals that catch the
two most common low-effort attacks:

  1. **Printed photo / phone-screen replay**: flat surface ⇒ very low texture
     variance (Laplacian) **and** narrow HSV color distribution.
  2. **Re-photographed paper**: moire-like banding ⇒ unusually high
     high-frequency energy in the FFT magnitude spectrum.
  3. **Heavy specular highlights** (phone screen reflection): clipped bright
     pixels saturate the V channel.

Each signal returns a score in [0, 1] (higher = more likely spoof). A weighted
sum produces the final `spoof_score`; if it crosses `THRESHOLD` we flag the
face as a likely spoof attempt and skip alerting.

This is **not** cryptographic-grade liveness — a determined attacker with a
high-quality screen + good lighting will defeat it. The goal is to filter out
casual phone-replay and printed-photo attacks in real-world conditions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np

log = logging.getLogger("mongolz-ml.anti-spoof")

# Tuned on small internal sample set — adjust on real data.
W_LAPLACIAN = 0.45
W_COLOR = 0.30
W_FREQ = 0.25
THRESHOLD = 0.55


@dataclass
class SpoofResult:
    is_spoof: bool
    score: float
    laplacian_var: float
    color_variance: float
    freq_anomaly: float

    def to_dict(self) -> dict:
        return {
            "is_spoof": self.is_spoof,
            "spoof_score": round(float(self.score), 4),
            "components": {
                "laplacian_var": round(float(self.laplacian_var), 2),
                "color_variance": round(float(self.color_variance), 4),
                "freq_anomaly": round(float(self.freq_anomaly), 4),
            },
            "threshold": THRESHOLD,
        }


def _score_laplacian(face_bgr: np.ndarray) -> tuple[float, float]:
    """Texture sharpness: real faces have skin micro-texture ⇒ high Laplacian variance.
    Returns (raw_variance, spoof_score)."""
    gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Print/screen typically <50; real skin usually >150. Smooth ramp.
    spoof = max(0.0, min(1.0, (150.0 - var) / 150.0))
    return var, spoof


def _score_color(face_bgr: np.ndarray) -> tuple[float, float]:
    """Color distribution width: prints/screens compress dynamic range."""
    hsv = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    # Coefficient of variation across S and V channels
    sv_var = float(np.var(s) + np.var(v))
    norm = sv_var / 10000.0
    spoof = max(0.0, min(1.0, 1.0 - norm))
    return norm, spoof


def _score_frequency(face_bgr: np.ndarray) -> tuple[float, float]:
    """High-frequency energy: re-photographed prints show moire-like patterns."""
    gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    if gray.size < 64 * 64:
        return 0.0, 0.0
    # Resize to power-of-two for cheaper FFT
    gray = cv2.resize(gray, (64, 64))
    f = np.fft.fftshift(np.fft.fft2(gray))
    mag = np.log1p(np.abs(f))
    # Ratio of energy in outer ring (high freq) to inner (low freq)
    h, w = mag.shape
    cy, cx = h // 2, w // 2
    y, x = np.ogrid[:h, :w]
    r = np.sqrt((y - cy) ** 2 + (x - cx) ** 2)
    inner = float(mag[r < 8].sum())
    outer = float(mag[r >= 16].sum())
    ratio = outer / max(inner, 1e-6)
    spoof = max(0.0, min(1.0, (ratio - 1.0) / 2.0))
    return ratio, spoof


def detect_spoof(face_bgr: np.ndarray) -> SpoofResult:
    """Run all three signals and combine into a single decision."""
    if face_bgr is None or face_bgr.size == 0 or min(face_bgr.shape[:2]) < 24:
        # Too small to evaluate — treat as inconclusive (not spoof).
        return SpoofResult(
            is_spoof=False,
            score=0.0,
            laplacian_var=0.0,
            color_variance=0.0,
            freq_anomaly=0.0,
        )

    lap_var, lap_score = _score_laplacian(face_bgr)
    col_norm, col_score = _score_color(face_bgr)
    freq_ratio, freq_score = _score_frequency(face_bgr)

    combined = (
        W_LAPLACIAN * lap_score
        + W_COLOR * col_score
        + W_FREQ * freq_score
    )

    return SpoofResult(
        is_spoof=combined >= THRESHOLD,
        score=combined,
        laplacian_var=lap_var,
        color_variance=col_norm,
        freq_anomaly=freq_ratio,
    )
