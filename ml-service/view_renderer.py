"""
view_renderer
=============

On-demand blurred-view derivation from an encrypted original MP4.

Architecture decision (#3): one encrypted artifact (`*_original.mp4.enc`) is
the single source of truth for every recording. The blurred playback view
shown to unauthorised viewers is *derived at view-time* — no separate
plaintext "blurred MP4" is persisted.

This module exposes:

  • ``render_blurred_view(input_mp4, output_mp4)`` — read an already-decrypted
    MP4, run Haar face detection per frame, paint cubist polygon mosaic over
    every detection (with 35% padding so motion doesn't expose features),
    write a new H.264 MP4 via ffmpeg.

  • Caching is handled by the caller (the FastAPI endpoint): once derived,
    the result lives at ``/tmp/mongolz-views/{recording_id}.mp4`` until the
    container restarts. Cache hits are zero-cost.

Why Haar-only (not ArcFace)? View-time blur has *no targets to match* — we
just need "anything that looks like a face" → blur it. Haar runs in ~5-10ms
per frame on Railway CPU; ArcFace would be 50-100x heavier for no
information gain.

Re-uses ``_cubist_anonymize`` from ``recording_pipeline`` so the visual
output of an on-demand-derived view is pixel-identical (up to detection
noise) to a legacy "baked" blurred MP4.
"""

from __future__ import annotations

import logging
import subprocess

import cv2

from recording_pipeline import _cubist_anonymize

log = logging.getLogger("mongolz-ml.view")

# Haar tuning: more permissive than recording_pipeline (scaleFactor 1.05,
# minNeighbors 3) because we ONLY need to find faces — false positives just
# mean a bit of extra blurring, which is on the safe side for privacy.
_HAAR_SCALE = 1.05
_HAAR_MIN_NEIGHBORS = 3
_HAAR_MIN_SIZE = (24, 24)
_PAD_RATIO = 0.35


def _new_haar() -> cv2.CascadeClassifier:
    """Per-call Haar classifier (CascadeClassifier is not thread-safe)."""
    return cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )


def render_blurred_view(input_mp4: str, output_mp4: str) -> int:
    """Read ``input_mp4`` → detect+blur every face → write ``output_mp4``.

    Returns the number of frames processed. Raises ``RuntimeError`` if the
    input can't be opened.

    The function is synchronous and CPU-bound — callers should invoke it via
    ``asyncio.to_thread`` so it does not stall the event loop.
    """
    cap = cv2.VideoCapture(input_mp4)
    if not cap.isOpened():
        raise RuntimeError(f"input MP4 open failed: {input_mp4}")

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0

    if w <= 0 or h <= 0:
        cap.release()
        raise RuntimeError(f"input MP4 has invalid dimensions: {w}x{h}")

    encoder = subprocess.Popen(
        [
            "ffmpeg", "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{w}x{h}",
            "-r", f"{fps:.2f}",
            "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            "-movflags", "frag_keyframe+empty_moov+faststart",
            output_mp4,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    haar = _new_haar()
    frame_count = 0
    blurred_count = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break

            if not haar.empty():
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                faces = haar.detectMultiScale(
                    gray,
                    scaleFactor=_HAAR_SCALE,
                    minNeighbors=_HAAR_MIN_NEIGHBORS,
                    minSize=_HAAR_MIN_SIZE,
                )
                if len(faces) > 0:
                    out_frame = frame.copy()
                    for (x, y, fw, fh) in faces:
                        x1, y1 = int(x), int(y)
                        x2, y2 = int(x + fw), int(y + fh)
                        pad_x = int(fw * _PAD_RATIO)
                        pad_y = int(fh * _PAD_RATIO)
                        x1p = max(0, x1 - pad_x)
                        y1p = max(0, y1 - pad_y)
                        x2p = min(w, x2 + pad_x)
                        y2p = min(h, y2 + pad_y)
                        if x2p - x1p < 8 or y2p - y1p < 8:
                            continue
                        roi = out_frame[y1p:y2p, x1p:x2p]
                        if roi.size == 0:
                            continue
                        cx = (x1 + x2) // 2
                        cy = (y1 + y2) // 2
                        # Stable seed per coarse location — small jitter
                        # between frames will reuse the same polygon layout.
                        seed = (cx >> 5) * 7919 + (cy >> 5) * 31
                        out_frame[y1p:y2p, x1p:x2p] = _cubist_anonymize(roi, seed=seed)
                    frame = out_frame
                    blurred_count += 1

            try:
                if encoder.stdin is None:
                    break
                encoder.stdin.write(frame.tobytes())
            except (BrokenPipeError, OSError):
                break

            frame_count += 1
    finally:
        cap.release()
        if encoder.stdin:
            try:
                encoder.stdin.close()
            except Exception:
                pass
        try:
            encoder.wait(timeout=30)
        except subprocess.TimeoutExpired:
            encoder.terminate()

    log.info(
        "view rendered: %d frame(s), %d with face blur (%.1f%%)",
        frame_count, blurred_count,
        100.0 * blurred_count / max(1, frame_count),
    )
    return frame_count
