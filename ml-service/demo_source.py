"""
demo_source — synthetic looping camera feeds (``demo://<name>``).

A deployment with no reachable RTSP camera (Railway without a tailnet
laptop online, a grader's machine, a live demo on hotel wifi) still needs a
moving picture with detectable faces so the whole pipeline — HLS, masking,
ArcFace matching, alerts, encrypted recording — can be exercised end to end.

Each allow-listed name maps to a short MP4 built lazily from the three
bundled StyleGAN2 sample portraits with a Ken-Burns pan/zoom (ffmpeg
``zoompan``), so faces drift across the frame instead of sitting still.
Names differ in image order, pan direction and zoom speed so three demo
cameras don't look like mirrors of each other. The recording pipeline treats
the file as a LIVE source: it loops on EOF and paces frames to real time.

The clip is cached under ``DEMO_DIR`` (default ``/tmp/mongolz-demo``) and
regenerated whenever the cached file is missing or empty.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile
import threading

from ffmpeg_bin import ffmpeg

log = logging.getLogger("mongolz-ml.demo")

DEMO_SOURCES: frozenset[str] = frozenset({"lobby", "gate", "parking"})
DEMO_DIR = os.getenv("DEMO_DIR", "/tmp/mongolz-demo")  # noqa: S108 — container-private /tmp
DEMO_WIDTH, DEMO_HEIGHT, DEMO_FPS = 640, 360, 15
# 3 clips × 8 s → ~24 s loop; long enough for the periodic ArcFace pass
# (once per second) to see every face several times per cycle.
_CLIP_SEC = 8
_CLIP_FRAMES = _CLIP_SEC * DEMO_FPS

_SAMPLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
_SAMPLE_FILES = ("00.jpg", "01.jpg", "02.jpg")

# Same shape the API regex accepts; the allow-list decides validity.
_DEMO_URL_RE = re.compile(r"^demo://([a-z0-9_-]{1,32})$")

# Per-name look: image order, zoom speed/limit and pan axis+direction.
# ``pan`` is (axis, direction): the crop window slides along the axis from
# one edge to the other over the clip, so the face crosses the frame.
_PROFILES: dict[str, dict] = {
    "lobby": {"order": (0, 1, 2), "zoom_rate": 0.0020, "zoom_max": 1.35, "pan": ("x", +1)},
    "gate": {"order": (2, 0, 1), "zoom_rate": 0.0030, "zoom_max": 1.45, "pan": ("x", -1)},
    "parking": {"order": (1, 2, 0), "zoom_rate": 0.0012, "zoom_max": 1.25, "pan": ("y", +1)},
}

# Generation is rare and takes a few seconds; one lock keeps two concurrent
# /camera/start calls from racing on the same output file.
_gen_lock = threading.Lock()


def is_demo_url(url: object) -> bool:
    return isinstance(url, str) and bool(_DEMO_URL_RE.match(url))


def demo_name(url: object) -> str | None:
    """``demo://lobby`` → ``"lobby"`` when the name is allow-listed, else None."""
    if not isinstance(url, str):
        return None
    m = _DEMO_URL_RE.match(url)
    if not m or m.group(1) not in DEMO_SOURCES:
        return None
    return m.group(1)


def demo_path(name: str) -> str:
    return os.path.join(DEMO_DIR, f"{name}.mp4")


def _clip_filter(idx: int, profile: dict) -> str:
    """zoompan chain for one still image → ``_CLIP_FRAMES`` frames at 640x360.

    The portrait is shrunk to 480px and padded onto a dark 1280x720 canvas
    (not centre-cropped: the samples are tight face crops and Haar needs the
    whole face inside the frame). zoompan then crops a window that shrinks
    with ``zoom`` and slides along the pan axis.
    """
    axis, direction = profile["pan"]
    progress = f"on/{_CLIP_FRAMES - 1}"
    if direction < 0:
        progress = f"(1-{progress})"
    if axis == "x":
        x_expr, y_expr = f"(iw-iw/zoom)*{progress}", "(ih-ih/zoom)/2"
    else:
        x_expr, y_expr = "(iw-iw/zoom)/2", f"(ih-ih/zoom)*{progress}"
    zoom_expr = f"min(zoom+{profile['zoom_rate']},{profile['zoom_max']})"
    return (
        f"[{idx}:v]scale=480:480:flags=lanczos,"
        f"pad=1280:720:400:120:color=0x232833,"
        f"zoompan=z='{zoom_expr}':x='{x_expr}':y='{y_expr}':"
        f"d={_CLIP_FRAMES}:s={DEMO_WIDTH}x{DEMO_HEIGHT}:fps={DEMO_FPS},"
        f"format=yuv420p[v{idx}]"
    )


def build_ffmpeg_cmd(name: str, out_path: str) -> list[str]:
    profile = _PROFILES[name]
    inputs: list[str] = []
    chains: list[str] = []
    for idx, sample_idx in enumerate(profile["order"]):
        inputs += ["-i", os.path.join(_SAMPLES_DIR, _SAMPLE_FILES[sample_idx])]
        chains.append(_clip_filter(idx, profile))
    concat = "".join(f"[v{i}]" for i in range(len(chains))) + f"concat=n={len(chains)}:v=1:a=0[out]"
    return [
        ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
        *inputs,
        "-filter_complex", ";".join(chains + [concat]),
        "-map", "[out]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-r", str(DEMO_FPS), "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_path,
    ]


def _generate(name: str, out_path: str) -> None:
    missing = [f for f in _SAMPLE_FILES if not os.path.isfile(os.path.join(_SAMPLES_DIR, f))]
    if missing:
        raise RuntimeError(f"demo samples missing: {', '.join(missing)}")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    # Write to a sibling temp file and rename so a half-encoded MP4 is never
    # picked up as the cached clip by a concurrent reader.
    fd, tmp_path = tempfile.mkstemp(prefix=f".{name}-", suffix=".mp4", dir=os.path.dirname(out_path))
    os.close(fd)
    try:
        subprocess.run(  # noqa: S603 — fixed argv, no shell
            build_ffmpeg_cmd(name, tmp_path),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=180,
            check=True,
        )
        if os.path.getsize(tmp_path) == 0:
            raise RuntimeError("ffmpeg produced an empty file")
        os.replace(tmp_path, out_path)
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-3:]
        raise RuntimeError(f"ffmpeg failed for demo '{name}': {' | '.join(tail)}") from e
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def resolve_demo_source(url: str) -> str:
    """``demo://<name>`` → path of the cached MP4, generating it on first use.

    Raises ``ValueError`` for a name outside the allow-list and
    ``RuntimeError`` when ffmpeg cannot produce the clip.
    """
    name = demo_name(url)
    if name is None:
        raise ValueError("unknown demo source")
    path = demo_path(name)
    with _gen_lock:
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path
        log.info("Generating demo source '%s' → %s", name, path)
        _generate(name, path)
        log.info("Demo source '%s' ready (%d KB)", name, os.path.getsize(path) // 1024)
    return path
