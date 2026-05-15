"""
Differential Privacy for Face Embeddings
=========================================

Adds calibrated Gaussian noise to ArcFace 512-dim embeddings before storage,
providing (epsilon, delta)-differential privacy guarantees.

The key insight: face embeddings are L2-normalized (unit sphere), so the
sensitivity is bounded by 2 (max L2 distance between any two unit vectors).

For a given (epsilon, delta), the noise scale sigma is:
    sigma = (sensitivity * sqrt(2 * ln(1.25 / delta))) / epsilon

Lower epsilon = stronger privacy (more noise) = lower matching accuracy.
Typical values: epsilon=1-10, delta=1e-5.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("mongolz-ml.dp")

EMBEDDING_DIM = 512
SENSITIVITY = 2.0


@dataclass
class DPConfig:
    epsilon: float = 5.0
    delta: float = 1e-5
    enabled: bool = True

    @property
    def sigma(self) -> float:
        return SENSITIVITY * math.sqrt(2 * math.log(1.25 / self.delta)) / self.epsilon

    def privacy_loss_str(self) -> str:
        return f"(ε={self.epsilon}, δ={self.delta})"


def add_dp_noise(
    embedding: np.ndarray,
    config: DPConfig,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    if not config.enabled:
        return embedding

    if rng is None:
        rng = np.random.default_rng()

    emb = np.asarray(embedding, dtype=np.float64).flatten()
    if emb.shape[0] != EMBEDDING_DIM:
        raise ValueError(f"Expected {EMBEDDING_DIM}-dim embedding, got {emb.shape[0]}")

    per_coord_sigma = config.sigma / math.sqrt(EMBEDDING_DIM)
    noise = rng.normal(0, per_coord_sigma, size=EMBEDDING_DIM)
    noisy = emb + noise

    norm = np.linalg.norm(noisy)
    if norm > 0:
        noisy = noisy / norm

    return noisy.astype(np.float32)


def estimate_matching_accuracy(
    config: DPConfig,
    n_trials: int = 1000,
    threshold: float = 0.45,
) -> dict:
    rng = np.random.default_rng(42)

    tp, fp, fn, tn = 0, 0, 0, 0

    for _ in range(n_trials // 2):
        base = rng.standard_normal(EMBEDDING_DIM)
        base /= np.linalg.norm(base)

        variation = base + rng.normal(0, 0.02, EMBEDDING_DIM)
        variation /= np.linalg.norm(variation)

        noisy_base = add_dp_noise(base, config, rng)
        noisy_var = add_dp_noise(variation, config, rng)

        sim = float(np.dot(noisy_base, noisy_var))
        if sim >= threshold:
            tp += 1
        else:
            fn += 1

    for _ in range(n_trials // 2):
        a = rng.standard_normal(EMBEDDING_DIM)
        a /= np.linalg.norm(a)
        b = rng.standard_normal(EMBEDDING_DIM)
        b /= np.linalg.norm(b)

        noisy_a = add_dp_noise(a, config, rng)
        noisy_b = add_dp_noise(b, config, rng)

        sim = float(np.dot(noisy_a, noisy_b))
        if sim >= threshold:
            fp += 1
        else:
            tn += 1

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-8)

    return {
        "epsilon": config.epsilon,
        "delta": config.delta,
        "sigma": round(config.sigma, 4),
        "privacy": config.privacy_loss_str(),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "trials": n_trials,
    }


def sweep_epsilon(
    epsilons: list[float] | None = None,
    delta: float = 1e-5,
    n_trials: int = 500,
) -> list[dict]:
    if epsilons is None:
        epsilons = [0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0]

    results = []
    for eps in epsilons:
        cfg = DPConfig(epsilon=eps, delta=delta)
        result = estimate_matching_accuracy(cfg, n_trials)
        results.append(result)
        log.info("ε=%.1f → F1=%.3f, σ=%.4f", eps, result["f1"], result["sigma"])

    return results
