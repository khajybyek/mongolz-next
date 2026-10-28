"""Absolute path of the FFmpeg executable.

Encoders are started by absolute path rather than by bare name (Ruff S607 /
Bandit B607): the binary is looked up once on the service's PATH and that
exact file is executed afterwards. A missing FFmpeg raises the same
FileNotFoundError that starting the process by name would have raised.
"""
from __future__ import annotations

import functools
import shutil


@functools.lru_cache(maxsize=1)
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        raise FileNotFoundError("ffmpeg executable not found on PATH")
    return path
