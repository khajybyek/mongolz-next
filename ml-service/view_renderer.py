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

  • ``abort_encoder`` / ``finish_encoder`` / ``verify_rendered_video`` —
    the encoder-failure contract shared with ``reveal_job``: a render that
    lost frames must raise, never return a short file as if it were whole.

  • ``sweep_view_cache`` — the bound on the derived-view cache (below).

  • Caching is handled by the caller (the FastAPI endpoint): once derived,
    the result lives at ``/tmp/mongolz-views/{recording_id}.mp4``.

Cache bound (2026-09-08 audit 4.6)
----------------------------------
The cache used to grow until the container was redeployed. It is now swept
every time a render completes, in two passes:

  1. entries whose mtime is older than ``VIEW_CACHE_MAX_AGE_SEC``
     (default 24 h) are removed — a derived view is plaintext footage on
     the container's disk, so it should not outlive a day of disuse;
  2. then the oldest entries are removed until the directory holds at most
     ``VIEW_CACHE_MAX_BYTES`` (default 1 GiB) — comfortably above the whole
     current corpus (29 recordings), so the bound only bites on runaway
     growth. Both are overridable via the environment variables of the
     same name.

Notes on the bound, deliberately:
  • Eviction is by render time (mtime), not by last read: a hot entry is
    re-derived on its next miss (5–30 s) rather than tracked. Keeping an
    atime-based LRU would need the endpoint to touch files on every hit.
  • Only files named ``<uuid>.mp4`` are candidates. ``.part`` siblings are
    in-flight renders owned by another request — deleting one would corrupt
    a concurrent render — and anything else in the directory is not ours.
  • The bound is enforced *after* a render, so the cache may momentarily
    exceed it by the entry just published.
  • A sweep failure (read-only FS, a racing unlink) is logged and never
    turned into a render failure; the render itself already succeeded.
  • An entry evicted in the same instant another request is opening it costs
    that request a re-render, nothing more — the encrypted original remains
    the single source of truth, the cache is only ever a derivation of it.

The masker is the same class the recording pipeline and the reveal output
use, so a face that the baked path would have hidden is never shown in
clear by the on-demand path.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import time

import cv2

from face_masker import FaceMasker

log = logging.getLogger("mongolz-ml.view")

# Permissive Haar preset: false positives only cost a little extra mosaic,
# which is the safe direction for a privacy view.
_HAAR_SCALE = 1.05
_HAAR_MIN_NEIGHBORS = 3
_HAAR_MIN_SIZE = (24, 24)
_PAD_RATIO = 0.35

# Kept in sync with `main._VIEW_CACHE_DIR`; the sweep only runs when a render
# lands inside this directory, so a render to a scratch path (tests, future
# callers) never touches unrelated files.
VIEW_CACHE_DIR = os.environ.get("VIEW_CACHE_DIR", "/tmp/mongolz-views")
VIEW_CACHE_MAX_BYTES = int(os.environ.get("VIEW_CACHE_MAX_BYTES", 1024 * 1024 * 1024))
VIEW_CACHE_MAX_AGE_SEC = float(os.environ.get("VIEW_CACHE_MAX_AGE_SEC", 24 * 3600))

# Cache entries are named after the recording UUID by the endpoint.
_CACHE_ENTRY_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$",
    re.IGNORECASE,
)

_MIN_RENDER_BYTES = 1000


# ── encoder lifecycle (shared with reveal_job) ─────────────────────────
def abort_encoder(encoder) -> None:
    """Tear down ffmpeg after the render has ALREADY failed. Never raises.

    Used on the error path so the original failure (a broken pipe, a decode
    error) reaches the caller instead of being masked by a teardown error —
    and so a wedged ffmpeg is not left holding CPU on the shared box.
    """
    if encoder is None:
        return
    stdin = getattr(encoder, "stdin", None)
    if stdin is not None:
        try:
            stdin.close()
        except (BrokenPipeError, OSError) as exc:
            log.debug("encoder stdin close failed during abort: %s", exc)
    try:
        encoder.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    except Exception as exc:  # noqa: BLE001 — teardown must not mask the real error
        log.debug("encoder wait failed during abort: %s", exc)
        return
    try:
        encoder.terminate()
        encoder.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            encoder.kill()
            encoder.wait(timeout=5)
        except Exception as exc:  # noqa: BLE001
            log.warning("encoder kill failed — process may be orphaned: %s", exc)
    except Exception as exc:  # noqa: BLE001
        log.debug("encoder terminate failed during abort: %s", exc)


def finish_encoder(encoder, *, label: str, wait_timeout: float = 30.0) -> None:
    """Close stdin, reap ffmpeg, and RAISE unless it exited cleanly.

    This is the whole point of the audit finding: the frame loop finishing is
    not evidence that the encoder wrote a complete file. A non-zero exit (OOM
    kill, disk full, x264 error) or a hung process must fail the render.
    """
    stdin = getattr(encoder, "stdin", None)
    close_failed = False
    if stdin is not None:
        try:
            stdin.close()
        except (BrokenPipeError, OSError) as exc:
            log.warning("%s encoder stdin close failed: %s", label, exc)
            close_failed = True
    try:
        exit_code = encoder.wait(timeout=wait_timeout)
    except subprocess.TimeoutExpired as exc:
        encoder.terminate()
        try:
            encoder.wait(timeout=5)
        except subprocess.TimeoutExpired:
            encoder.kill()
            encoder.wait()
        raise RuntimeError(f"{label} encoder timed out") from exc
    if close_failed or exit_code != 0:
        raise RuntimeError(f"{label} encoder failed (exit={exit_code})")


def frame_count_tolerance(expected_frames: int) -> int:
    """Frames the container may legitimately under-report.

    The output is a fragmented MP4 (`frag_keyframe+empty_moov`); OpenCV
    derives ``CAP_PROP_FRAME_COUNT`` from the container's duration and
    timebase, so a fractional fps (14.99, 29.97) can round the count by a
    frame. Measured on this stack the count is exact, so the tolerance is a
    guard against rounding, not a licence to lose footage: 1 frame, or 0.1%
    of the render for long clips (≥ 1000 frames), whichever is larger. A
    truncated render loses seconds to minutes — orders of magnitude more.
    """
    return max(1, int(expected_frames) // 1000)


def verify_rendered_video(
    path: str,
    expected_frames: int,
    *,
    label: str,
    min_bytes: int = _MIN_RENDER_BYTES,
) -> None:
    """Raise unless ``path`` is a playable video holding ~``expected_frames``.

    Checked before anything publishes the artifact (cache rename, storage
    upload): the file must exist, be non-trivial, decode its first frame, and
    report a frame count within ``frame_count_tolerance`` of what was written.
    """
    if expected_frames <= 0:
        raise RuntimeError(f"{label} render produced no frames")
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        raise RuntimeError(f"{label} render produced no output file") from exc
    if size < min_bytes:
        raise RuntimeError(f"{label} render produced an empty output file")

    rendered = cv2.VideoCapture(path)
    try:
        if not rendered.isOpened():
            raise RuntimeError(f"{label} render produced an unreadable file")
        readable, _frame = rendered.read()
        reported = int(rendered.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        rendered.release()
    if not readable:
        raise RuntimeError(f"{label} render produced an unreadable file")
    if reported < expected_frames - frame_count_tolerance(expected_frames):
        raise RuntimeError(
            f"{label} encoder produced an incomplete recording "
            f"({reported}/{expected_frames} frames)"
        )


# ── derived-view cache bound ───────────────────────────────────────────
def sweep_view_cache(
    cache_dir: str | None = None,
    *,
    max_bytes: int | None = None,
    max_age_sec: float | None = None,
) -> tuple[int, int]:
    """Enforce the cache bound. Returns ``(entries_removed, bytes_freed)``.

    Age first, then size (oldest render evicted first). Only ``<uuid>.mp4``
    entries are touched — never a ``.part`` sibling being written by a
    concurrent render, never a foreign file. Housekeeping, so per-file OS
    errors are logged and skipped instead of failing the caller's render.
    """
    directory = cache_dir or VIEW_CACHE_DIR
    limit_bytes = VIEW_CACHE_MAX_BYTES if max_bytes is None else max_bytes
    limit_age = VIEW_CACHE_MAX_AGE_SEC if max_age_sec is None else max_age_sec

    try:
        names = os.listdir(directory)
    except OSError as exc:
        log.warning("view cache sweep skipped (%s): %s", directory, exc)
        return (0, 0)

    entries: list[tuple[float, int, str]] = []  # (mtime, size, path)
    for name in names:
        if not _CACHE_ENTRY_RE.match(name):
            continue
        path = os.path.join(directory, name)
        try:
            st = os.stat(path)
        except OSError:
            continue  # vanished under us — nothing to account for
        if not os.path.isfile(path):
            continue
        entries.append((st.st_mtime, st.st_size, path))

    entries.sort()  # oldest first
    removed = 0
    freed = 0

    def _drop(entry: tuple[float, int, str]) -> bool:
        nonlocal removed, freed
        _mtime, size, path = entry
        try:
            os.unlink(path)
        except FileNotFoundError:
            return True  # already gone; still off the books
        except OSError as exc:
            log.warning("view cache: could not evict %s: %s", os.path.basename(path), exc)
            return False
        removed += 1
        freed += size
        return True

    now = time.time()
    survivors: list[tuple[float, int, str]] = []
    for entry in entries:
        if limit_age > 0 and now - entry[0] > limit_age:
            if not _drop(entry):
                survivors.append(entry)
            continue
        survivors.append(entry)

    if limit_bytes >= 0:
        total = sum(size for _m, size, _p in survivors)
        for entry in survivors:
            if total <= limit_bytes:
                break
            if _drop(entry):
                total -= entry[1]

    if removed:
        log.info(
            "view cache swept: %d entry(-ies) dropped, %.1fMB freed (bound %.0fMB / %.0fh)",
            removed, freed / (1024 * 1024),
            limit_bytes / (1024 * 1024), limit_age / 3600,
        )
    return (removed, freed)


def discard_partial(path: str) -> None:
    """Remove a half-written render. Never raises (cleanup, not a result)."""
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError as exc:
        log.warning("could not remove partial render %s: %s", path, exc)


def render_blurred_view(
    input_mp4: str,
    output_mp4: str,
    engine=None,
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> int:
    """Read ``input_mp4`` → mask every face → write ``output_mp4``.

    Returns the number of frames processed. Raises ``RuntimeError`` on input,
    encoder or verification failure, leaving no output file behind; callers
    must not publish a failed render as a cache hit.

    The function is synchronous and CPU-bound — callers should invoke it via
    ``asyncio.to_thread`` so it does not stall the event loop.
    """
    try:
        return _render(input_mp4, output_mp4, engine, start_sec, end_sec)
    except BaseException:
        # A short file must not outlive the failure that produced it — the
        # endpoint also unlinks its `.part`, this makes the function's own
        # contract complete for any caller.
        discard_partial(output_mp4)
        raise


def _render(
    input_mp4: str,
    output_mp4: str,
    engine=None,
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> int:
    cap = cv2.VideoCapture(input_mp4)
    if not cap.isOpened():
        raise RuntimeError(f"input MP4 open failed: {input_mp4}")

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0

    if w <= 0 or h <= 0:
        cap.release()
        raise RuntimeError(f"input MP4 has invalid dimensions: {w}x{h}")

    bounded = start_sec is not None or end_sec is not None
    if bounded:
        if start_sec is None or end_sec is None or start_sec < 0 or end_sec <= start_sec:
            cap.release()
            raise RuntimeError("clip range is invalid")
        if end_sec - start_sec > 300:
            cap.release()
            raise RuntimeError("clip range exceeds 300 seconds")
        cap.set(cv2.CAP_PROP_POS_MSEC, start_sec * 1000.0)
        max_frames = max(1, int(round((end_sec - start_sec) * fps)))
    else:
        max_frames = None

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
        try:
            while True:
                if max_frames is not None and frame_count >= max_frames:
                    break
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

            if frame_count == 0:
                raise RuntimeError("view input contains no readable frames")
        except BaseException:
            # Reap ffmpeg without masking the failure that got us here.
            abort_encoder(encoder)
            raise
    finally:
        cap.release()

    finish_encoder(encoder, label="view")
    verify_rendered_video(output_mp4, frame_count, label="view")

    log.info(
        "view rendered: %d frame(s), %d with face mask (%.1f%%)",
        frame_count, blurred_count,
        100.0 * blurred_count / max(1, frame_count),
    )

    # Bound the cache the moment we add to it (see the module docstring). The
    # freshly rendered file is still a `.part` sibling here, so the sweep can
    # never evict the render that just succeeded.
    if os.path.dirname(os.path.abspath(output_mp4)) == os.path.abspath(VIEW_CACHE_DIR):
        sweep_view_cache()

    return frame_count


def render_blurred_frame(input_mp4: str, at_sec: float, engine=None) -> bytes:
    """Return one fully masked JPEG frame for an evidence package."""
    if at_sec < 0:
        raise RuntimeError("frame timestamp is invalid")
    cap = cv2.VideoCapture(input_mp4)
    try:
        if not cap.isOpened():
            raise RuntimeError("input MP4 open failed")
        cap.set(cv2.CAP_PROP_POS_MSEC, at_sec * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            raise RuntimeError("evidence frame is unavailable")
        masker = FaceMasker(
            engine,
            haar_scale=_HAAR_SCALE,
            haar_neighbors=_HAAR_MIN_NEIGHBORS,
            haar_min_size=_HAAR_MIN_SIZE,
            pad_ratio=_PAD_RATIO,
        )
        masked = masker.mask(frame)
        encoded, jpeg = cv2.imencode(".jpg", masked, [cv2.IMWRITE_JPEG_QUALITY, 88])
        if not encoded:
            raise RuntimeError("evidence frame encoding failed")
        return jpeg.tobytes()
    finally:
        cap.release()
