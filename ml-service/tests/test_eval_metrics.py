"""Tests for eval_metrics — detection, blur, recognition metrics."""

import numpy as np
import pytest

from eval_metrics import (
    DetectionMetrics,
    iou,
    evaluate_detection,
    compute_blur_quality,
    compute_recognition_metrics,
)


class TestDetectionMetrics:
    def test_perfect_precision(self):
        m = DetectionMetrics(tp=10, fp=0, fn=2, tn=0)
        assert m.precision == 1.0

    def test_perfect_recall(self):
        m = DetectionMetrics(tp=10, fp=5, fn=0, tn=0)
        assert m.recall == 1.0

    def test_f1_score(self):
        m = DetectionMetrics(tp=8, fp=2, fn=2, tn=0)
        assert 0.79 < m.f1 < 0.81

    def test_zero_division_safe(self):
        m = DetectionMetrics()
        assert m.precision == 0
        assert m.recall == 0
        assert m.f1 == 0
        assert m.fpr == 0

    def test_to_dict_keys(self):
        m = DetectionMetrics(tp=1, fp=1, fn=1, tn=1)
        d = m.to_dict()
        assert set(d.keys()) == {"tp", "fp", "fn", "tn", "precision", "recall", "f1", "fpr"}


class TestIoU:
    def test_perfect_overlap(self):
        assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0

    def test_no_overlap(self):
        assert iou((0, 0, 5, 5), (10, 10, 20, 20)) == 0.0

    def test_partial_overlap(self):
        result = iou((0, 0, 10, 10), (5, 5, 15, 15))
        assert 0.1 < result < 0.2

    def test_contained_box(self):
        result = iou((0, 0, 20, 20), (5, 5, 15, 15))
        assert result == pytest.approx(100 / 400, abs=0.01)


class TestEvaluateDetection:
    def test_all_correct(self):
        preds = [(0, 0, 10, 10), (20, 20, 30, 30)]
        gts = [(0, 0, 10, 10), (20, 20, 30, 30)]
        m = evaluate_detection(preds, gts)
        assert m.tp == 2
        assert m.fp == 0
        assert m.fn == 0

    def test_false_positives(self):
        preds = [(0, 0, 10, 10), (50, 50, 60, 60)]
        gts = [(0, 0, 10, 10)]
        m = evaluate_detection(preds, gts)
        assert m.tp == 1
        assert m.fp == 1

    def test_false_negatives(self):
        preds = [(0, 0, 10, 10)]
        gts = [(0, 0, 10, 10), (50, 50, 60, 60)]
        m = evaluate_detection(preds, gts)
        assert m.fn == 1


class TestBlurQuality:
    def test_identical_images(self):
        img = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
        result = compute_blur_quality(img, img.copy(), [(10, 10, 90, 90)])
        assert result["ssim_mean"] > 0.95

    def test_completely_different(self):
        orig = np.zeros((100, 100, 3), dtype=np.uint8)
        blurred = np.full((100, 100, 3), 255, dtype=np.uint8)
        result = compute_blur_quality(orig, blurred, [(10, 10, 90, 90)])
        assert result["ssim_mean"] < 0.1

    def test_no_faces(self):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        result = compute_blur_quality(img, img, [])
        assert result["face_count"] == 0


class TestRecognitionMetrics:
    def test_perfect_classification(self):
        sims = [0.9, 0.8, 0.1, 0.05]
        labels = [True, True, False, False]
        result = compute_recognition_metrics(sims, labels, threshold=0.45)
        assert result["precision"] == 1.0
        assert result["recall"] == 1.0
        assert result["f1"] == 1.0

    def test_all_false_positives(self):
        sims = [0.9, 0.8]
        labels = [False, False]
        result = compute_recognition_metrics(sims, labels, threshold=0.45)
        assert result["precision"] == 0

    def test_auc_range(self):
        sims = [0.9, 0.7, 0.5, 0.3, 0.1]
        labels = [True, True, False, False, False]
        result = compute_recognition_metrics(sims, labels)
        assert 0 <= result["auc"] <= 1.0

    def test_roc_points_present(self):
        sims = [0.8, 0.3]
        labels = [True, False]
        result = compute_recognition_metrics(sims, labels)
        assert len(result["roc_points"]) > 0
