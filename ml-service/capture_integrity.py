"""Capture integrity and a source-clock to constant-frame-rate sampler."""
from __future__ import annotations

import math
import subprocess

import cv2


def close_encoder(proc) -> None:
    if proc is None:
        return
    failed = False
    if proc.stdin and not proc.stdin.closed:
        try:
            proc.stdin.close()
        except (BrokenPipeError, OSError):
            failed = True
    try:
        code = proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        raise RuntimeError("capture encoder timed out") from None
    if failed or code != 0:
        raise RuntimeError("capture encoder failed")


def validate_capture(path: str, expected_frames: int, fps: float) -> float:
    """Decode the entire bounded segment; header metadata alone is insufficient."""
    cap = cv2.VideoCapture(path)
    try:
        if not cap.isOpened() or expected_frames <= 0:
            raise RuntimeError("capture contains no readable frames")
        count = 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            count += 1
        encoded_fps = cap.get(cv2.CAP_PROP_FPS)
        if count != expected_frames or not math.isfinite(encoded_fps) or abs(encoded_fps - fps) > 0.02:
            raise RuntimeError("capture is incomplete or has invalid timing")
        return count / fps
    finally:
        cap.release()


class SourceSampler:
    """Sample-and-hold by presentation time, including irregular/VFR intervals.

    Delay one input frame so its actual interval is known. Missing/nonmonotonic
    PTS falls back to the reported input rate. Output duration differs from the
    source by at most one output frame, never by a rounded skip ratio.
    """
    def __init__(self, input_fps: float, output_fps: float):
        if not all(math.isfinite(rate) and rate > 0 for rate in (input_fps, output_fps)):
            raise ValueError("source and output frame rates must be positive")
        self.input_fps = input_fps
        self.output_fps = output_fps
        self.index = 0
        self.output_index = 0
        self.previous = None
        self.previous_time = 0.0
        self.origin = None

    def push(self, frame, pts_sec: float, *, fallback_sec: float | None = None):
        if self.origin is None:
            self.origin = pts_sec if math.isfinite(pts_sec) and pts_sec >= 0 else 0.0
        source_time = pts_sec - self.origin
        if not math.isfinite(source_time) or source_time < 0 or (self.index and source_time <= self.previous_time):
            source_time = (fallback_sec if fallback_sec is not None else self.previous_time + 1 / self.input_fps) if self.index else 0.0
            source_time = max(self.previous_time, source_time)
        # Discontinuous timestamps must not allocate an unbounded duplicate queue.
        if self.index and source_time - self.previous_time > 10:
            raise RuntimeError("source timestamp discontinuity")
        emitted = self._until(source_time)
        self.previous, self.previous_time = frame, source_time
        self.index += 1
        return emitted

    def _until(self, end):
        result = []
        while self.previous is not None and self.output_index / self.output_fps < end - 1e-8:
            result.append((self.output_index / self.output_fps, self.previous))
            self.output_index += 1
        return result

    def finish(self):
        return self._until(self.previous_time + 1 / self.input_fps)
