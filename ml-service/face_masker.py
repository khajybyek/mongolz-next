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

``mask()`` = ``step()`` (1–3) + ``paint()`` (4). A ``face_encrypted``
recording (ADR 0013) calls them separately: the same ``step()`` boxes (and
the same ``padded_box`` rectangles) get the cubist mask on the live stream
and the keyed cipher visual (``cipher_mask``) in the stored masked video.
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

    ``embeddings_allowed = False`` (a frame captured in `private` privacy
    mode, ADR 0012 — live capture, the on-demand view, evidence exports and
    reveal) switches identification off without weakening the mask: the
    InsightFace pass uses the engine's detector-only ``detect_boxes`` and
    NEVER ``detect_all``, so no ArcFace embedding is computed for that frame;
    ``tier_for`` — which compares faces with the suspect watchlist — is never
    called; and every box (Haar and InsightFace) gets ``blind_tier`` (default
    "vip", the most protective mask) so nobody is masked more weakly than
    identification would have allowed. An engine without a working
    ``detect_boxes`` leaves such frames to Haar + the persistence cache and
    logs an error once — computing an embedding is not the fallback.
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
        blind_tier: str = "vip",
    ):
        self.engine = engine
        self.tier_for = tier_for
        self.embeddings_allowed = True
        self.blind_tier = blind_tier if blind_tier in _TIER_RANK else "vip"
        self._blind_fallback_logged = False
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
        # One-shot request for an InsightFace pass on the next step (a
        # face_encrypted recognition tick samples the tracks with a FRESH box
        # on its frame, so profile faces need RetinaFace there).
        self.insight_due = False

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
        tier = "standard" if self.embeddings_allowed else self.blind_tier
        return [((int(x), int(y), int(x + w), int(y + h)), tier) for (x, y, w, h) in faces]

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
        jpeg = encoded.tobytes()
        identify = self.embeddings_allowed
        if identify:
            try:
                detected = self.engine.detect_all(jpeg)
            except Exception as e:  # noqa: BLE001 — detection failure must never expose a face; Haar+cache still apply
                log.debug("InsightFace mask detection skipped: %s", e)
                return []
        else:
            # Privacy mode: the detector alone. Looked up on the class so a
            # Mock engine cannot fabricate one. Never detect_all — it would
            # compute an ArcFace embedding for a frame captured in private mode.
            if getattr(type(self.engine), "detect_boxes", None) is None:
                self._note_blind_unavailable("engine has no detect_boxes")
                return []
            try:
                detected = self.engine.detect_boxes(jpeg)
            except Exception as e:  # noqa: BLE001 — Haar + cache still apply
                self._note_blind_unavailable(f"detect_boxes failed ({type(e).__name__})")
                return []
        out: list[tuple[Box, str]] = []
        inv = 1.0 / scale
        for d in detected:
            if d.confidence < self.insight_min_confidence:
                continue
            x1, y1, x2, y2 = (int(v * inv) for v in d.bbox)
            if not identify:
                tier = self.blind_tier  # no watchlist comparison; the strongest mask
            elif self.tier_for is not None:
                try:
                    tier = self.tier_for(d.embedding)
                except Exception:  # noqa: BLE001
                    tier = "standard"
            else:
                tier = "standard"
            out.append(((x1, y1, x2, y2), tier))
        return out

    def _note_blind_unavailable(self, reason: str) -> None:
        if not self._blind_fallback_logged:
            self._blind_fallback_logged = True
            log.error(
                "privacy-mode masking: %s — frames captured in private mode are masked by "
                "Haar + the persistence cache only (no embedding is ever computed for them)",
                reason,
            )

    # ── public API ─────────────────────────────────────────────
    def step(self, frame: np.ndarray) -> list[CachedBox]:
        """Advance one frame: detect, refresh the persistence cache, return it.
        An entry whose ttl equals ``persist_frames`` was detected on THIS
        frame (fresh); a lower ttl is an earlier detection kept alive (stale)
        — its geometry is exactly that earlier detection's."""
        self.frame_idx += 1
        new: list[tuple[Box, str]] = self._detect_haar(frame)
        # Frame 1 too: a masker often renders a single frame (evidence
        # stills) or starts a clip / stream / seek, and its first frames must
        # not be Haar-only — profile and tilted faces are what Haar misses.
        insight = self.frame_idx == 1 or self.frame_idx % self.insight_every_n == 0 or self.insight_due
        self.insight_due = False
        if insight:
            new.extend(self._detect_insight(frame))
        self.cache = [(b, ttl - 1, tier) for (b, ttl, tier) in self.cache if ttl > 1]
        for box, tier in new:
            self.cache.append((box, self.persist_frames, tier))
        self.cache = merge_overlapping(self.cache)
        return self.cache

    def padded_box(self, box: Box, width: int, height: int) -> Box | None:
        """The padded, frame-clipped rectangle that masking paints for a
        detection box, or None when it is too small to paint (< 8 px)."""
        x1, y1, x2, y2 = box
        bw, bh = x2 - x1, y2 - y1
        pad_x = int(bw * self.pad_ratio)
        pad_y = int(bh * self.pad_ratio)
        x1p, y1p = max(0, x1 - pad_x), max(0, y1 - pad_y)
        x2p, y2p = min(width, x2 + pad_x), min(height, y2 + pad_y)
        if x2p - x1p < 8 or y2p - y1p < 8:
            return None
        return (x1p, y1p, x2p, y2p)

    def paint(
        self,
        frame: np.ndarray,
        boxes: Iterable[CachedBox],
        keep_boxes: Iterable[Box] = (),
        keep_iou: float = 0.3,
    ) -> np.ndarray:
        """Cubist-mask ``boxes`` (the persistence cache ``step`` returned) on
        a copy of ``frame``, except faces overlapping a ``keep_boxes`` entry."""
        # Local import: recording_pipeline imports this module too.
        from recording_pipeline import _cubist_anonymize

        boxes = list(boxes)
        if not boxes:
            return frame
        keep = list(keep_boxes)
        h, w = frame.shape[:2]
        out = frame.copy()
        for (x1, y1, x2, y2), _ttl, tier in boxes:
            if keep and any(iou((x1, y1, x2, y2), kb) > keep_iou for kb in keep):
                continue
            padded = self.padded_box((x1, y1, x2, y2), w, h)
            if padded is None:
                continue
            x1p, y1p, x2p, y2p = padded
            roi = out[y1p:y2p, x1p:x2p]
            if roi.size == 0:
                continue
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            seed = (cx >> 5) * 7919 + (cy >> 5) * 31
            out[y1p:y2p, x1p:x2p] = _cubist_anonymize(roi, seed=seed, privacy_tier=tier)
        return out

    def mask(self, frame: np.ndarray, keep_boxes: Iterable[Box] = (), keep_iou: float = 0.3) -> np.ndarray:
        """Return a copy of ``frame`` with every cached face masked, except
        faces overlapping a ``keep_boxes`` entry (reveal targets)."""
        return self.paint(frame, self.step(frame), keep_boxes, keep_iou)
