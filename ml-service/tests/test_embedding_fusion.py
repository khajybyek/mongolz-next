"""Tests for multi-frame embedding fusion."""

import numpy as np

from embedding_fusion import (
    FrameEmbedding,
    fuse_weighted_mean,
    fuse_median,
    cosine_similarity,
    EMBEDDING_DIM,
)


def _unit(rng, seed):
    rng2 = np.random.default_rng(seed)
    v = rng2.standard_normal(EMBEDDING_DIM)
    return v / np.linalg.norm(v)


def test_weighted_mean_returns_unit_norm():
    rng = np.random.default_rng(0)
    frames = [FrameEmbedding(embedding=_unit(rng, i), quality=1.0) for i in range(5)]
    out = fuse_weighted_mean(frames)
    assert out is not None
    assert abs(np.linalg.norm(out) - 1.0) < 1e-5


def test_median_returns_unit_norm():
    rng = np.random.default_rng(0)
    frames = [FrameEmbedding(embedding=_unit(rng, i), quality=1.0) for i in range(5)]
    out = fuse_median(frames)
    assert out is not None
    assert abs(np.linalg.norm(out) - 1.0) < 1e-5


def test_weighted_mean_respects_quality():
    base = _unit(None, 1)
    outlier = _unit(None, 99)  # totally different identity
    frames = [
        FrameEmbedding(embedding=base, quality=1.0),
        FrameEmbedding(embedding=base, quality=1.0),
        FrameEmbedding(embedding=base, quality=1.0),
        FrameEmbedding(embedding=outlier, quality=0.05),  # low quality
    ]
    out = fuse_weighted_mean(frames)
    sim = cosine_similarity(out, base)
    # Should stay close to base because the outlier weight is small
    assert sim > 0.9


def test_median_robust_to_single_outlier():
    base = _unit(None, 1)
    outlier = _unit(None, 99)
    frames = [
        FrameEmbedding(embedding=base, quality=1.0),
        FrameEmbedding(embedding=base, quality=1.0),
        FrameEmbedding(embedding=base, quality=1.0),
        FrameEmbedding(embedding=outlier, quality=1.0),
    ]
    out = fuse_median(frames)
    sim = cosine_similarity(out, base)
    assert sim > 0.7  # Median pulls back toward majority


def test_empty_input_returns_none():
    assert fuse_weighted_mean([]) is None
    assert fuse_median([]) is None


def test_zero_quality_filtered_out():
    base = _unit(None, 1)
    frames = [
        FrameEmbedding(embedding=base, quality=0.0),
        FrameEmbedding(embedding=base, quality=0.0),
    ]
    assert fuse_weighted_mean(frames) is None
