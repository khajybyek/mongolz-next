"""
view_renderer
=============

On-demand blurred-view derivation from an encrypted original MP4.

Architecture decision (#3 / ADR 0010): one encrypted artifact
(`*_original.mp4.enc`) is the single source of truth for every recording.
The blurred playback view shown to unauthorised viewers is *derived at
view-time* — no separate plaintext "blurred MP4" is persisted.

This module exposes:

  • ``render_blurred_view(input_mp4, output_mp4, engine=None)`` — read an
    already-decrypted MP4, mask every face with ``FaceMasker`` (Haar every
    frame + InsightFace every Nth frame when an engine is given + a
    persistence cache + 35% padding), write a new H.264 MP4 via ffmpeg.

  • Caching is handled by the caller (the FastAPI endpoint): once derived,
    the result lives at ``/tmp/mongolz-views/{recording_id}.mp4`` until the
    container restarts. Cache hits are zero-cost.

The masker is the same class the recording pipeline and the reveal output
use, so a face that the baked path would have hidden is never shown in
clear by the on-demand path.
"""

from __future__ import annotations

import logging
import subprocess

import cv2

from face_masker import FaceMasker

log = logging.getLogger("mongolz-ml.view")

# Permissive Haar preset: false positives only cost a little extra mosaic,
# which is the safe direction for a privacy view.
_HAAR_SCALE = 1.05
_HAAR_MIN_NEIGHBORS = 3
_HAAR_MIN_SIZE = (24, 24)
_PAD_RATIO = 0.35


def render_blurred_view(input_mp4: str, output_mp4: str, engine=None) -> int:
    """Read ``input_mp4`` → mask every face → write ``output_mp4``.

    Returns the number of frames processed. Raises ``RuntimeError`` on input
    or encoder failure; callers must not publish a failed render as a cache hit.

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
            # The endpoint writes an atomic cache sibling ending in .mp4.part.
            # FFmpeg cannot infer the output container from that suffix.
            "-f", "mp4",
            output_mp4,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    masker = FaceMasker(
        engine,
        haar_scale=_HAAR_SCALE,
        haar_neighbors=_HAAR_MIN_NEIGHBORS,
        haar_min_size=_HAAR_MIN_SIZE,
        pad_ratio=_PAD_RATIO,
    )
    frame_count = 0
    blurred_count = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break

            out_frame = masker.mask(frame)
            if out_frame is not frame:
                blurred_count += 1

            try:
                if encoder.stdin is None:
                    raise RuntimeError("view encoder input unavailable")
                encoder.stdin.write(out_frame.tobytes())
            except (BrokenPipeError, OSError) as exc:
                raise RuntimeError("view encoder input failed") from exc

            frame_count += 1
    finally:
        cap.release()
        close_failed = False
        if encoder.stdin:
            try:
                encoder.stdin.close()
            except (BrokenPipeError, OSError):
                close_failed = True
        try:
            exit_code = encoder.wait(timeout=30)
        except subprocess.TimeoutExpired as exc:
            encoder.terminate()
            try:
                encoder.wait(timeout=5)
            except subprocess.TimeoutExpired:
                encoder.kill()
                encoder.wait()
            raise RuntimeError("view encoder timed out") from exc
        if close_failed or exit_code != 0:
            raise RuntimeError("view encoder failed")

    if frame_count == 0:
        raise RuntimeError("view input contains no readable frames")
    rendered = cv2.VideoCapture(output_mp4)
    try:
        readable, _ = rendered.read()
        if not readable or int(rendered.get(cv2.CAP_PROP_FRAME_COUNT)) != frame_count:
            raise RuntimeError("view encoder produced an incomplete recording")
    finally:
        rendered.release()

    log.info(
        "view rendered: %d frame(s), %d with face mask (%.1f%%)",
        frame_count, blurred_count,
        100.0 * blurred_count / max(1, frame_count),
    )
    return frame_count
