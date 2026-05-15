"""
Quantitative evaluation metrics for MONGOLZ ML pipeline.
- Detection: Precision, Recall, F1, FPR (False Positive Rate)
- Blur quality: SSIM between original and blurred regions
- Recognition: Cosine similarity distribution, ROC AUC
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import cv2
import numpy as np

log = logging.getLogger("mongolz-ml.eval")


@dataclass
class DetectionMetrics:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    @property
    def precision(self) -> float:
        return self.tp / max(self.tp + self.fp, 1)

    @property
    def recall(self) -> float:
        return self.tp / max(self.tp + self.fn, 1)

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / max(p + r, 1e-8)

    @property
    def fpr(self) -> float:
        return self.fp / max(self.fp + self.tn, 1)

    def to_dict(self) -> dict:
        return {
            "tp": self.tp,
            "fp": self.fp,
            "fn": self.fn,
            "tn": self.tn,
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
            "fpr": round(self.fpr, 4),
        }


def iou(box_a: tuple, box_b: tuple) -> float:
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    union = area_a + area_b - inter
    return inter / max(union, 1e-8)


def evaluate_detection(
    predicted_boxes: list[tuple],
    gt_boxes: list[tuple],
    iou_threshold: float = 0.5,
    total_negative_regions: int = 0,
) -> DetectionMetrics:
    m = DetectionMetrics()
    matched_gt = set()

    for pred in predicted_boxes:
        best_iou = 0.0
        best_idx = -1
        for i, gt in enumerate(gt_boxes):
            if i in matched_gt:
                continue
            score = iou(pred, gt)
            if score > best_iou:
                best_iou = score
                best_idx = i
        if best_iou >= iou_threshold and best_idx >= 0:
            m.tp += 1
            matched_gt.add(best_idx)
        else:
            m.fp += 1

    m.fn = len(gt_boxes) - len(matched_gt)
    m.tn = total_negative_regions
    return m


def compute_ssim_region(original: np.ndarray, blurred: np.ndarray, bbox: tuple) -> float:
    x1, y1, x2, y2 = [int(v) for v in bbox]
    h, w = original.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)

    if x2 - x1 < 7 or y2 - y1 < 7:
        return 0.0

    roi_orig = cv2.cvtColor(original[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    roi_blur = cv2.cvtColor(blurred[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)

    c1, c2 = 6.5025, 58.5225
    mu1 = cv2.GaussianBlur(roi_orig.astype(np.float64), (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(roi_blur.astype(np.float64), (11, 11), 1.5)
    mu1_sq, mu2_sq, mu1_mu2 = mu1 * mu1, mu2 * mu2, mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(roi_orig.astype(np.float64) ** 2, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(roi_blur.astype(np.float64) ** 2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(
        roi_orig.astype(np.float64) * roi_blur.astype(np.float64), (11, 11), 1.5
    ) - mu1_mu2

    ssim_map = ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2)) / (
        (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)
    )
    return float(ssim_map.mean())


def compute_blur_quality(
    original: np.ndarray,
    blurred: np.ndarray,
    face_bboxes: list[tuple],
) -> dict:
    ssim_scores = []
    for bbox in face_bboxes:
        s = compute_ssim_region(original, blurred, bbox)
        ssim_scores.append(s)

    return {
        "face_count": len(face_bboxes),
        "ssim_per_face": [round(s, 4) for s in ssim_scores],
        "ssim_mean": round(float(np.mean(ssim_scores)) if ssim_scores else 0, 4),
        "blur_effectiveness": round(
            1.0 - float(np.mean(ssim_scores)) if ssim_scores else 0, 4
        ),
    }


def compute_recognition_metrics(
    similarities: list[float],
    labels: list[bool],
    threshold: float = 0.45,
) -> dict:
    tp = sum(1 for s, l in zip(similarities, labels) if s >= threshold and l)
    fp = sum(1 for s, l in zip(similarities, labels) if s >= threshold and not l)
    fn = sum(1 for s, l in zip(similarities, labels) if s < threshold and l)
    tn = sum(1 for s, l in zip(similarities, labels) if s < threshold and not l)

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-8)
    fpr = fp / max(fp + tn, 1)

    sorted_pairs = sorted(zip(similarities, labels), key=lambda x: -x[0])
    roc_points = []
    cum_tp, cum_fp = 0, 0
    total_pos = sum(labels)
    total_neg = len(labels) - total_pos

    for sim, label in sorted_pairs:
        if label:
            cum_tp += 1
        else:
            cum_fp += 1
        tpr = cum_tp / max(total_pos, 1)
        fpr_pt = cum_fp / max(total_neg, 1)
        roc_points.append({"threshold": round(sim, 4), "tpr": round(tpr, 4), "fpr": round(fpr_pt, 4)})

    auc = 0.0
    for i in range(1, len(roc_points)):
        dx = roc_points[i]["fpr"] - roc_points[i - 1]["fpr"]
        auc += dx * (roc_points[i]["tpr"] + roc_points[i - 1]["tpr"]) / 2

    return {
        "threshold": threshold,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "fpr": round(fpr, 4),
        "auc": round(auc, 4),
        "roc_points": roc_points[:50],
        "total_pairs": len(similarities),
    }


@dataclass
class EvalReport:
    detection: dict = field(default_factory=dict)
    blur_quality: dict = field(default_factory=dict)
    recognition: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "detection": self.detection,
            "blur_quality": self.blur_quality,
            "recognition": self.recognition,
        }
