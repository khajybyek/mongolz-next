"""Tests for heuristic anti-spoofing."""

import numpy as np
import pytest

from anti_spoof import detect_spoof, THRESHOLD


@pytest.fixture
def rng():
    return np.random.default_rng(42)


def test_flat_image_scores_high(rng):
    """Solid color (printed photo simulator) should look fake."""
    img = np.full((96, 96, 3), 200, dtype=np.uint8)
    r = detect_spoof(img)
    assert r.is_spoof is True
    assert r.score >= THRESHOLD


def test_textured_random_noise_scores_lower(rng):
    """High-frequency texture is more 'live-like' than a flat patch."""
    img = rng.integers(0, 256, size=(96, 96, 3), dtype=np.uint8)
    r_noise = detect_spoof(img)
    flat = np.full((96, 96, 3), 200, dtype=np.uint8)
    r_flat = detect_spoof(flat)
    assert r_noise.score < r_flat.score


def test_tiny_image_inconclusive():
    img = np.full((8, 8, 3), 128, dtype=np.uint8)
    r = detect_spoof(img)
    assert r.is_spoof is False
    assert r.score == 0.0


def test_empty_image_safe():
    r = detect_spoof(np.zeros((0, 0, 3), dtype=np.uint8))
    assert r.is_spoof is False


def test_to_dict_shape():
    img = np.full((32, 32, 3), 200, dtype=np.uint8)
    r = detect_spoof(img)
    d = r.to_dict()
    assert "is_spoof" in d
    assert "spoof_score" in d
    assert "components" in d
    assert set(d["components"].keys()) == {"laplacian_var", "color_variance", "freq_anomaly"}
    assert d["threshold"] == THRESHOLD
