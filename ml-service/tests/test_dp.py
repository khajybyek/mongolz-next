"""Tests for differential privacy embeddings."""

import numpy as np
import pytest

from dp_embeddings import DPConfig, add_dp_noise, estimate_matching_accuracy, sweep_epsilon


class TestDPConfig:
    def test_sigma_decreases_with_epsilon(self):
        low = DPConfig(epsilon=1.0)
        high = DPConfig(epsilon=10.0)
        assert low.sigma > high.sigma

    def test_privacy_loss_str(self):
        cfg = DPConfig(epsilon=5.0, delta=1e-5)
        assert "5.0" in cfg.privacy_loss_str()
        assert "1e-05" in cfg.privacy_loss_str()


class TestAddNoise:
    def test_output_is_unit_norm(self):
        rng = np.random.default_rng(0)
        emb = rng.standard_normal(512)
        emb /= np.linalg.norm(emb)

        cfg = DPConfig(epsilon=5.0)
        noisy = add_dp_noise(emb, cfg, rng)
        assert abs(np.linalg.norm(noisy) - 1.0) < 1e-5

    def test_noise_changes_embedding(self):
        rng = np.random.default_rng(0)
        emb = rng.standard_normal(512).astype(np.float64)
        emb /= np.linalg.norm(emb)

        cfg = DPConfig(epsilon=5.0)
        noisy = add_dp_noise(emb, cfg, rng)
        assert not np.allclose(emb, noisy, atol=1e-3)

    def test_disabled_returns_original(self):
        emb = np.ones(512, dtype=np.float64) / np.sqrt(512)
        cfg = DPConfig(enabled=False)
        result = add_dp_noise(emb, cfg)
        np.testing.assert_array_equal(result, emb)

    def test_wrong_dimension_raises(self):
        cfg = DPConfig(epsilon=5.0)
        with pytest.raises(ValueError):
            add_dp_noise(np.zeros(256), cfg)


class TestEstimateAccuracy:
    def test_high_epsilon_preserves_accuracy(self):
        cfg = DPConfig(epsilon=50.0)
        result = estimate_matching_accuracy(cfg, n_trials=200, threshold=0.45)
        assert result["f1"] > 0.8

    def test_returns_required_keys(self):
        cfg = DPConfig(epsilon=5.0)
        result = estimate_matching_accuracy(cfg, n_trials=100)
        for key in ["epsilon", "sigma", "f1", "precision", "recall", "tp", "fp", "fn", "tn"]:
            assert key in result


class TestSweep:
    def test_sweep_returns_list(self):
        results = sweep_epsilon(epsilons=[1.0, 10.0], n_trials=100)
        assert len(results) == 2
        assert results[0]["epsilon"] == 1.0
        assert results[1]["epsilon"] == 10.0
