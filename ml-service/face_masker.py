"""
face_masker
===========

One face-masking implementation for every path that produces pixels a
non-authorised viewer can see:

  * the live HLS stream written by ``recording_pipeline``,
  * the baked blurred MP4 written by ``recording_pipeline`` (legacy mode),
  * the on-demand blurred view (``view_renderer``),
  * the non-target faces of a reveal output (``reveal_job``).

Before this module the view and reveal paths used a bare frontal Haar
cascade per frame with no persistence, so a profile / tilted / briefly
occluded face was rendered un-blurred while the recording pipeline used a
much stronger Haar + InsightFace + TTL-cache scheme. Privacy guarantees must
not depend on which code path rendered the frame.

Algorithm (per frame):
  1. Haar cascade (cheap) — every frame.
  2. InsightFace RetinaFace (robust to pose) — every ``insight_every_n``
     frames when an engine is supplied; low-confidence detections dropped.
  3. Persistence cache: every detection is kept alive for
     ``persist_frames`` frames so a missed detection does not expose the
     face; overlapping boxes are merged (IoU) keeping the most protective
     privacy tier.
  4. Padding + cubist polygon mosaic (``_cubist_anonymize``) on every cached
     box, except boxes overlapping ``keep_boxes`` (reveal targets).
"""

from __future__ import annotations

import logging
from typing import Callable, Iterable

import cv2
import numpy as np

log = logging.getLogger("mongolz-ml.masker")

Box = tuple[int, int, int, int]
CachedBox = tuple[Box, int, str]  # (bbox, ttl, tier)

_HAAR_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
_TIER_RANK = {"vip": 2, "standard": 1, "relaxed": 0}


def iou(a: Box, b: Box) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def merge_overlapping(cache: list[CachedBox], iou_threshold: float = 0.4) -> list[CachedBox]:
    """Merge boxes with IoU > threshold. The fresher (higher TTL) box wins on
    geometry; the more protective tier wins on tier."""
    kept: list[CachedBox] = []
    for box, ttl, tier in sorted(cache, key=lambda x: -x[1]):
        dup = next((i for i, (kb, _t, _r) in enumerate(kept) if iou(box, kb) > iou_threshold), None)
        if dup is None:
            kept.append((box, ttl, tier))
        else:
            kbox, kttl, ktier = kept[dup]
            if _TIER_RANK.get(tier, 1) > _TIER_RANK.get(ktier, 1):
                kept[dup] = (kbox, kttl, tier)
    return kept


class FaceMasker:
    """Stateful per-stream masker (keeps the persistence cache between frames).

    ``engine`` is a ``FaceEngine`` (or anything with ``detect_all(jpeg_bytes)``
    returning objects with ``bbox``, ``confidence`` and ``embedding``); None
    means Haar-only. ``tier_for`` maps an embedding to a privacy tier
    ("vip" / "standard" / "relaxed"); default "standard".
    """

    def __init__(
        self,
        engine=None,
        *,
        tier_for: Callable[[np.ndarray], str] | None = None,
        haar_scale: float = 1.08,
        haar_neighbors: int = 5,
        haar_min_size: tuple[int, int] = (40, 40),
        insight_every_n: int = 5,
        insight_min_confidence: float = 0.55,
        persist_frames: int = 15,
        pad_ratio: float = 0.35,
        max_side: int = 640,
    ):
        self.engine = engine
        self.tier_for = tier_for
        self.haar_scale = haar_scale
        self.haar_neighbors = haar_neighbors
        self.haar_min_size = haar_min_size
        self.insight_every_n = max(1, insight_every_n)
        self.insight_min_confidence = insight_min_confidence
        self.persist_frames = max(1, persist_frames)
        self.pad_ratio = pad_ratio
        self.max_side = max_side
        # CascadeClassifier is not thread-safe → one per masker instance.
        self.haar = cv2.CascadeClassifier(_HAAR_PATH)
        if self.haar.empty():
            log.warning("Haar cascade failed to load (%s)", _HAAR_PATH)
        self.cache: list[CachedBox] = []
        self.frame_idx = 0

    # ── detection ──────────────────────────────────────────────
    def _detect_haar(self, frame: np.ndarray) -> list[tuple[Box, str]]:
        if self.haar.empty():
            return []
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.haar.detectMultiScale(
            gray,
            scaleFactor=self.haar_scale,
            minNeighbors=self.haar_neighbors,
            minSize=self.haar_min_size,
        )
        return [((int(x), int(y), int(x + w), int(y + h)), "standard") for (x, y, w, h) in faces]

    def _detect_insight(self, frame: np.ndarray) -> list[tuple[Box, str]]:
        if self.engine is None:
            return []
        h, w = frame.shape[:2]
        scale = 1.0
        small = frame
        if max(h, w) > self.max_side:
            scale = self.max_side / max(h, w)
            small = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode(".jpg", small)
        if not ok:
            return []
        try:
            detected = self.engine.detect_all(encoded.tobytes())
        except Exception as e:  # noqa: BLE001 — detection failure must never expose a face; Haar+cache still apply
            log.debug("InsightFace mask detection skipped: %s", e)
            return []
        out: list[tuple[Box, str]] = []
        inv = 1.0 / scale
        for d in detected:
            if d.confidence < self.insight_min_confidence:
                continue
            x1, y1, x2, y2 = (int(v * inv) for v in d.bbox)
            tier = "standard"
            if self.tier_for is not None:
                try:
                    tier = self.tier_for(d.embedding)
                except Exception:  # noqa: BLE001
                    tier = "standard"
            out.append(((x1, y1, x2, y2), tier))
        return out

    # ── public API ─────────────────────────────────────────────
    def step(self, frame: np.ndarray) -> list[CachedBox]:
        """Advance one frame: detect, refresh the persistence cache, return it."""
        self.frame_idx += 1
        new: list[tuple[Box, str]] = self._detect_haar(frame)
        # Frame 1 too: a masker often renders a single frame (evidence
        # stills) or starts a clip / stream / seek, and its first frames must
        # not be Haar-only — profile and tilted faces are what Haar misses.
        if self.frame_idx == 1 or self.frame_idx % self.insight_every_n == 0:
            new.extend(self._detect_insight(frame))
        self.cache = [(b, ttl - 1, tier) for (b, ttl, tier) in self.cache if ttl > 1]
        for box, tier in new:
            self.cache.append((box, self.persist_frames, tier))
        self.cache = merge_overlapping(self.cache)
        return self.cache

    def mask(self, frame: np.ndarray, keep_boxes: Iterable[Box] = (), keep_iou: float = 0.3) -> np.ndarray:
        """Return a copy of ``frame`` with every cached face masked, except
        faces overlapping a ``keep_boxes`` entry (reveal targets)."""
        # Local import: recording_pipeline imports this module too.
        from recording_pipeline import _cubist_anonymize

        boxes = self.step(frame)
        if not boxes:
            return frame
        keep = list(keep_boxes)
        h, w = frame.shape[:2]
        out = frame.copy()
        for (x1, y1, x2, y2), _ttl, tier in boxes:
            if keep and any(iou((x1, y1, x2, y2), kb) > keep_iou for kb in keep):
                continue
            bw, bh = x2 - x1, y2 - y1
            pad_x = int(bw * self.pad_ratio)
            pad_y = int(bh * self.pad_ratio)
            x1p, y1p = max(0, x1 - pad_x), max(0, y1 - pad_y)
            x2p, y2p = min(w, x2 + pad_x), min(h, y2 + pad_y)
            if x2p - x1p < 8 or y2p - y1p < 8:
                continue
            roi = out[y1p:y2p, x1p:x2p]
            if roi.size == 0:
                continue
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            seed = (cx >> 5) * 7919 + (cy >> 5) * 31
            out[y1p:y2p, x1p:x2p] = _cubist_anonymize(roi, seed=seed, privacy_tier=tier)
        return out
