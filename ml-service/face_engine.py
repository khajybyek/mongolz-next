"""
FaceEngine — InsightFace (RetinaFace + ArcFace 512-dim) wrapper.
Хуучин mongolz/app.py-ийн face detect/embed логикийг task-зориулсан service-руу шилжүүлсэн.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np
from insightface.app import FaceAnalysis

log = logging.getLogger("mongolz-ml.face")


@dataclass
class FaceQuality:
    sharpness: float
    brightness: float
    size_score: float
    overall: float

@dataclass
class DetectedFace:
    bbox: tuple[float, float, float, float]
    confidence: float
    embedding: np.ndarray
    quality: FaceQuality | None = None


@dataclass
class DetectedBox:
    """A detector hit WITHOUT any biometric template (ADR 0012)."""
    bbox: tuple[float, float, float, float]
    confidence: float


class FaceEngine:
    """InsightFace 512-dim ArcFace + RetinaFace."""

    def __init__(self, det_size: tuple[int, int] = (320, 320)):
        log.info("Loading InsightFace (buffalo_l)...")
        self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=det_size)
        log.info("InsightFace ready (det_size=%s)", det_size)

    def info(self) -> dict:
        return {"model": "buffalo_l", "embedding_dim": 512, "det_size": [320, 320]}

    @staticmethod
    def _decode_image(image_bytes: bytes) -> np.ndarray:
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("cannot decode image")
        return img

    def detect_all(self, image_bytes: bytes) -> list[DetectedFace]:
        img = self._decode_image(image_bytes)
        faces = self.app.get(img)
        out: list[DetectedFace] = []
        for f in faces:
            x1, y1, x2, y2 = f.bbox.astype(float).tolist()
            if x2 - x1 < 20 or y2 - y1 < 20:
                continue
            emb = f.normed_embedding.astype(np.float32)
            if emb.shape[0] != 512:
                continue
            out.append(DetectedFace((x1, y1, x2, y2), float(f.det_score), emb))
        return out

    def detect_boxes(self, image_bytes: bytes) -> list[DetectedBox]:
        """RetinaFace boxes only — the detection model alone, no landmark,
        gender/age or ArcFace model, so no embedding is ever computed.

        Used to place masks where identification is switched off (a camera in
        `private` privacy mode, ADR 0012). Same detector, threshold and size
        filter as ``detect_all``, so the boxes are the ones ``detect_all``
        would have returned.
        """
        img = self._decode_image(image_bytes)
        detector = self.app.det_model
        try:
            bboxes, _kpss = detector.detect(img, max_num=0, metric="default")
        except TypeError:
            # A detector whose keyword arguments changed (library update):
            # the positional call is the stable part of the API. There is no
            # fallback to the full pipeline — it would compute embeddings.
            bboxes, _kpss = detector.detect(img)
        out: list[DetectedBox] = []
        for row in bboxes:
            x1, y1, x2, y2, score = (float(v) for v in row[:5])
            if x2 - x1 < 20 or y2 - y1 < 20:
                continue
            out.append(DetectedBox((x1, y1, x2, y2), score))
        return out

    def embed_single(self, image_bytes: bytes) -> np.ndarray | None:
        """Зургийн хамгийн том нүүрний embedding-ийг буцаана."""
        faces = self.detect_all(image_bytes)
        if not faces:
            # Padding fallback — хуучин логик хадгалсан
            faces = self._padded_retry(image_bytes)
        if not faces:
            return None
        # Хамгийн том bbox-той
        faces.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
        return faces[0].embedding

    def _padded_retry(self, image_bytes: bytes) -> list[DetectedFace]:
        """Анхны detect фэйл болсон бол 30% padding нэмж дахин оролдох."""
        img = self._decode_image(image_bytes)
        h, w = img.shape[:2]
        pad_h, pad_w = int(h * 0.3), int(w * 0.3)
        padded = cv2.copyMakeBorder(
            img, pad_h, pad_h, pad_w, pad_w, cv2.BORDER_CONSTANT, value=(128, 128, 128)
        )
        ok, encoded = cv2.imencode(".jpg", padded)
        if not ok:
            return []
        return self.detect_all(encoded.tobytes())

    def compute_quality(self, image_bytes: bytes, bbox: tuple[float, float, float, float]) -> FaceQuality:
        img = self._decode_image(image_bytes)
        h, w = img.shape[:2]
        x1, y1, x2, y2 = int(max(0, bbox[0])), int(max(0, bbox[1])), int(min(w, bbox[2])), int(min(h, bbox[3]))
        roi = img[y1:y2, x1:x2]
        if roi.size == 0:
            return FaceQuality(0, 0, 0, 0)

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        sharpness = min(1.0, laplacian_var / 500.0)

        mean_brightness = gray.mean() / 255.0
        brightness = 1.0 - abs(mean_brightness - 0.5) * 2

        face_area = (x2 - x1) * (y2 - y1)
        size_score = min(1.0, face_area / (80 * 80))

        overall = sharpness * 0.4 + brightness * 0.3 + size_score * 0.3
        return FaceQuality(
            round(sharpness, 3), round(brightness, 3),
            round(size_score, 3), round(overall, 3),
        )

    def detect_with_quality(self, image_bytes: bytes) -> list[DetectedFace]:
        faces = self.detect_all(image_bytes)
        for f in faces:
            f.quality = self.compute_quality(image_bytes, f.bbox)
        return faces

    @staticmethod
    def cosine(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))
