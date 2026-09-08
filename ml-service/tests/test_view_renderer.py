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
from types import SimpleNamespace
from unittest.mock import Mock

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
    @pytest.mark.parametrize("filename", ["out.mp4", "out.mp4.part"])
    def test_smoke_synthetic_clip(self, tmp_path, filename):
        """Random-noise clip with no real faces → renders to a valid MP4.

        We don't assert blur was applied (no real face = no detection); we
        assert the function executes end-to-end and produces output that
        OpenCV can read back.
        """
        input_mp4 = str(tmp_path / "in.mp4")
        output_mp4 = str(tmp_path / filename)
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
            n_read = 0
            while cap.read()[0]:
                n_read += 1
            assert n_read == n_in, "every input frame must remain playable"
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

    def test_encoder_nonzero_exit_is_not_success(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        _make_synthetic_mp4(src)
        encoder = Mock()
        encoder.wait.return_value = 1
        monkeypatch.setattr(view_renderer.subprocess, "Popen", Mock(return_value=encoder))
        with pytest.raises(RuntimeError, match="encoder failed"):
            view_renderer.render_blurred_view(src, str(tmp_path / "out.mp4.part"))

    def test_encoder_broken_pipe_is_not_partial_success(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        _make_synthetic_mp4(src)
        encoder = Mock()
        encoder.stdin.write.side_effect = BrokenPipeError()
        encoder.wait.return_value = 0
        monkeypatch.setattr(view_renderer.subprocess, "Popen", Mock(return_value=encoder))
        with pytest.raises(RuntimeError, match="encoder input failed"):
            view_renderer.render_blurred_view(src, str(tmp_path / "out.mp4.part"))
        encoder.wait.assert_called_once()

    def test_encoder_timeout_terminates_and_reaps(self, tmp_path, monkeypatch):
        src = str(tmp_path / "in.mp4")
        _make_synthetic_mp4(src)
        encoder = Mock()
        encoder.wait.side_effect = [subprocess.TimeoutExpired("ffmpeg", 30), 0]
        monkeypatch.setattr(view_renderer.subprocess, "Popen", Mock(return_value=encoder))
        with pytest.raises(RuntimeError, match="encoder timed out"):
            view_renderer.render_blurred_view(src, str(tmp_path / "out.mp4.part"))
        encoder.terminate.assert_called_once()
        assert encoder.wait.call_count == 2


@pytest.fixture
def view_endpoint(tmp_path, monkeypatch):
    """Exercise the real route and encoder with an isolated encrypted recording."""
    os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
    import crypto_utils
    import main
    from fastapi.testclient import TestClient

    rec_id = "22222222-2222-2222-2222-222222222222"
    source = tmp_path / "source.mp4"
    _make_synthetic_mp4(str(source))
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"t" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    encrypted = crypto_utils.encrypt_bytes(source.read_bytes(), recording_id=rec_id)
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.maybe_single.return_value = query
    query.execute.return_value = SimpleNamespace(data={"original_path": "test.enc", "has_original": True})
    db = Mock()
    db.table.return_value = query
    db.storage.from_.return_value.download.return_value = encrypted
    monkeypatch.setattr(main, "storage", SimpleNamespace(client=db))
    monkeypatch.setattr(main, "face_engine", None)
    monkeypatch.setattr(main, "ML_TOKEN", "test-token")
    monkeypatch.setattr(main, "_VIEW_CACHE_DIR", str(tmp_path))
    return TestClient(main.app), rec_id, db


def test_view_endpoint_cold_then_warm_cache(view_endpoint, tmp_path):
    client, rec_id, db = view_endpoint
    cold = client.get(f"/recording/{rec_id}/view", headers={"Authorization": "Bearer test-token"})
    assert cold.status_code == 200, cold.text
    assert cold.headers["content-type"] == "video/mp4"
    assert len(cold.content) > 1000
    warm = client.get(f"/recording/{rec_id}/view", headers={"Authorization": "Bearer test-token"})
    assert warm.status_code == 200 and warm.content == cold.content
    db.storage.from_.return_value.download.assert_called_once()
    assert not (tmp_path / f"{rec_id}.mp4.part").exists()


def test_failed_view_render_never_publishes_cache(view_endpoint, tmp_path, monkeypatch):
    import main

    client, rec_id, _ = view_endpoint
    def fail_render(_input, output, _engine):
        with open(output, "wb") as partial:
            partial.write(b"partial" * 500)
        raise RuntimeError("encoder failed")
    monkeypatch.setattr(main, "render_blurred_view", fail_render)
    response = client.get(f"/recording/{rec_id}/view", headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 500
    assert not (tmp_path / f"{rec_id}.mp4").exists()
    assert not (tmp_path / f"{rec_id}.mp4.part").exists()


_SAMPLES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "samples")
_HAVE_SAMPLES = all(
    os.path.exists(os.path.join(_SAMPLES_DIR, f"0{i}.jpg")) for i in range(3)
)


@pytest.mark.skipif(not _HAVE_SAMPLES, reason="sample face images not present")
class TestRealFaceBlur:
    """The noise-only smoke test never triggers a detection, so it can't prove
    the blur path actually fires. These use the bundled real face photos to
    guarantee Haar detects → cubist mosaic is applied → pixels actually change.
    """

    def _build_face_clip(self, path: str, frames: int = 12) -> int:
        faces = [
            cv2.resize(cv2.imread(os.path.join(_SAMPLES_DIR, f"0{i}.jpg")), (640, 480))
            for i in range(3)
        ]
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 15, (640, 480))
        assert writer.isOpened()
        for i in range(frames):
            writer.write(faces[i % 3])
        writer.release()
        return frames

    def test_blur_actually_applied_to_real_faces(self, tmp_path):
        src = str(tmp_path / "faces.mp4")
        out = str(tmp_path / "view.mp4")
        n_in = self._build_face_clip(src)

        n = view_renderer.render_blurred_view(src, out)
        assert n == n_in
        assert os.path.getsize(out) > 1000

        # Compare frame 0 src-vs-rendered: a real face → cubist mosaic must
        # change a meaningful number of pixels. Pure passthrough would diff ~0.
        cap_s, cap_o = cv2.VideoCapture(src), cv2.VideoCapture(out)
        try:
            ok_s, fs = cap_s.read()
            ok_o, fo = cap_o.read()
            assert ok_s and ok_o
            diff = float(np.mean(np.abs(fs.astype(int) - fo.astype(int))))
        finally:
            cap_s.release()
            cap_o.release()
        assert diff > 1.0, f"blur did not fire — frame identical (diff={diff:.3f})"

    def test_encrypt_decrypt_render_roundtrip(self, tmp_path):
        """Mirror the production /recording/{id}/view path: an encrypted
        original is downloaded, decrypted, then rendered. Byte-exact decrypt
        + a valid rendered MP4 proves the endpoint's core is sound."""
        import crypto_utils

        crypto_utils._MASTER_KEY = None
        crypto_utils.init_master_key()

        src = str(tmp_path / "faces.mp4")
        self._build_face_clip(src)
        with open(src, "rb") as f:
            plain = f.read()

        rec_id = "11111111-1111-1111-1111-111111111111"
        enc = crypto_utils.encrypt_bytes(plain, recording_id=rec_id)
        dec = crypto_utils.decrypt_bytes(enc, recording_id=rec_id)
        assert dec == plain, "decrypt round-trip must be byte-exact"

        dec_path = str(tmp_path / "dec.mp4")
        with open(dec_path, "wb") as f:
            f.write(dec)
        out = str(tmp_path / "view.mp4")
        n = view_renderer.render_blurred_view(dec_path, out)
        assert n > 0 and os.path.getsize(out) > 1000
