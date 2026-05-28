"""Tests for view_renderer — on-demand blurred-view derivation.

The render function reads an MP4, detects faces frame-by-frame (Haar), paints
a cubist polygon mosaic over each detection, and writes a fresh H.264 MP4
via ffmpeg. These tests verify the contract without needing real face data:
  • happy path on a synthetic noise clip → output exists, frame count matches
  • bad input → clear RuntimeError
"""

from __future__ import annotations

import base64
import os
import secrets
import subprocess

os.environ.setdefault(
    "ML_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import view_renderer  # noqa: E402


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=True,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


pytestmark = pytest.mark.skipif(
    not _ffmpeg_available(),
    reason="ffmpeg binary not available in the test environment",
)


def _make_synthetic_mp4(path: str, w: int = 320, h: int = 240, frames: int = 8, fps: int = 15) -> int:
    """Write a synthetic MP4 with deterministic noise frames. Returns frame count."""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(path, fourcc, fps, (w, h))
    assert writer.isOpened(), "synthetic MP4 writer failed to open"
    rng = np.random.RandomState(42)
    written = 0
    for _ in range(frames):
        frame = rng.randint(0, 255, (h, w, 3), dtype=np.uint8)
        writer.write(frame)
        written += 1
    writer.release()
    return written


class TestRenderBlurredView:
    def test_smoke_synthetic_clip(self, tmp_path):
        """Random-noise clip with no real faces → renders to a valid MP4.

        We don't assert blur was applied (no real face = no detection); we
        assert the function executes end-to-end and produces output that
        OpenCV can read back.
        """
        input_mp4 = str(tmp_path / "in.mp4")
        output_mp4 = str(tmp_path / "out.mp4")
        n_in = _make_synthetic_mp4(input_mp4, frames=8)

        n_processed = view_renderer.render_blurred_view(input_mp4, output_mp4)

        assert n_processed == n_in, (
            f"expected {n_in} frames processed, got {n_processed}"
        )
        assert os.path.exists(output_mp4), "output MP4 should be written"
        assert os.path.getsize(output_mp4) > 100, "output MP4 is suspiciously small"

        # Reopen to verify it's a valid MP4
        cap = cv2.VideoCapture(output_mp4)
        try:
            assert cap.isOpened(), "rendered MP4 is not openable"
            n_read = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            assert n_read >= 1, f"expected ≥1 frame in output, got {n_read}"
        finally:
            cap.release()

    def test_missing_input_raises(self, tmp_path):
        """Bad input path → RuntimeError surfaces cleanly to the caller."""
        with pytest.raises(RuntimeError):
            view_renderer.render_blurred_view(
                "/nonexistent-path-xyz.mp4",
                str(tmp_path / "out.mp4"),
            )

    def test_zero_dim_input_raises(self, tmp_path):
        """Empty file masquerading as MP4 → RuntimeError, not silent corruption.

        OpenCV opens the empty file but reports 0×0 — we should bail out.
        """
        bad = tmp_path / "empty.mp4"
        bad.write_bytes(b"")
        with pytest.raises(RuntimeError):
            view_renderer.render_blurred_view(str(bad), str(tmp_path / "out.mp4"))
