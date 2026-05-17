#!/usr/bin/env python3
"""MONGOLZ edge agent — on-prem RTSP capture with cloud upload.

The agent runs next to your CCTV cameras (Raspberry Pi 5, Intel NUC, Coral
TPU, etc.) and acts as a pre-filter for the cloud ML service:

  1. Opens the RTSP stream over the LAN (raw bandwidth never leaves the
     site).
  2. Samples one frame every `SAMPLE_INTERVAL_SEC` seconds.
  3. Cheap motion test — compare against the previous sampled frame, skip
     if absolute pixel diff < `MOTION_THRESHOLD`.
  4. Cheap face presence test — Haar cascade frontal face detector ships
     with OpenCV. If no faces present, drop the frame.
  5. POST the JPEG-encoded frame to the cloud ML service `/detect` for
     full InsightFace processing.

This is the standard pattern used by Verkada / Eufy / Reolink: the camera
RTSP credentials never leave the LAN; only frames-of-interest reach the
cloud; the cloud only spends GPU cycles on frames with faces in them.

Configuration via environment variables (or `.env` file in the same
directory):

  RTSP_URL         (required)  rtsp://user:pass@10.0.0.42/stream1
  ML_SERVICE_URL   (required)  https://mongolz-ml-production.up.railway.app
  ML_SERVICE_TOKEN (required)  Bearer token for the cloud ML service
  CAMERA_ID        (required)  Supabase camera UUID for tagging frames
  SAMPLE_INTERVAL_SEC          default 1.0
  MOTION_THRESHOLD             default 8.0 (mean abs diff per pixel)
  AGENT_NAME                   default `hostname`
  LOG_LEVEL                    default INFO

Run:
  $ python agent.py
  or (Docker):
  $ docker compose up -d
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import requests

# ─── Configuration ──────────────────────────────────────────────────────


@dataclass
class Config:
    rtsp_url: str
    ml_url: str
    ml_token: str
    camera_id: str
    sample_interval_sec: float
    motion_threshold: float
    agent_name: str

    @classmethod
    def from_env(cls) -> "Config":
        env_path = Path(__file__).parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

        def req(name: str) -> str:
            v = os.environ.get(name)
            if not v:
                raise SystemExit(f"Missing required env var: {name}")
            return v

        return cls(
            rtsp_url=req("RTSP_URL"),
            ml_url=req("ML_SERVICE_URL").rstrip("/"),
            ml_token=req("ML_SERVICE_TOKEN"),
            camera_id=req("CAMERA_ID"),
            sample_interval_sec=float(os.environ.get("SAMPLE_INTERVAL_SEC", "1.0")),
            motion_threshold=float(os.environ.get("MOTION_THRESHOLD", "8.0")),
            agent_name=os.environ.get("AGENT_NAME", socket.gethostname()),
        )


# ─── Helpers ────────────────────────────────────────────────────────────


def mean_abs_diff(a: np.ndarray, b: np.ndarray) -> float:
    """Cheap motion proxy: scalar mean |a - b| in 8-bit grey space."""
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    return float(np.mean(cv2.absdiff(ga, gb)))


def haar_has_face(frame: np.ndarray, cascade: cv2.CascadeClassifier) -> bool:
    """Quick frontal-face presence check using OpenCV's Haar cascade."""
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(grey, scaleFactor=1.2, minNeighbors=5, minSize=(40, 40))
    return len(faces) > 0


def encode_jpeg(frame: np.ndarray, quality: int = 80) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("cv2.imencode failed")
    return buf.tobytes()


# ─── Main loop ──────────────────────────────────────────────────────────


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    log = logging.getLogger("agent")
    cfg = Config.from_env()
    log.info("Edge agent %s starting (camera=%s, RTSP=%s)", cfg.agent_name, cfg.camera_id, cfg.rtsp_url)

    cap = cv2.VideoCapture(cfg.rtsp_url)
    if not cap.isOpened():
        log.error("Cannot open RTSP stream: %s", cfg.rtsp_url)
        sys.exit(1)

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        log.error("Failed to load Haar cascade at %s", cascade_path)
        sys.exit(1)

    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {cfg.ml_token}",
        "User-Agent": f"mongolz-edge-agent/{cfg.agent_name}",
    })

    prev_frame: np.ndarray | None = None
    sent = 0
    skipped_motion = 0
    skipped_no_face = 0
    errors = 0
    next_sample = 0.0

    try:
        while True:
            now = time.monotonic()
            if now < next_sample:
                # Drain the buffer so we read the most recent frame next time.
                cap.grab()
                continue
            ok, frame = cap.read()
            if not ok or frame is None:
                log.warning("Lost RTSP frame, retry in 1s")
                time.sleep(1.0)
                continue
            next_sample = now + cfg.sample_interval_sec

            # 1. Motion gate
            if prev_frame is not None:
                diff = mean_abs_diff(frame, prev_frame)
                if diff < cfg.motion_threshold:
                    skipped_motion += 1
                    prev_frame = frame
                    continue
            prev_frame = frame

            # 2. Face presence gate
            if not haar_has_face(frame, cascade):
                skipped_no_face += 1
                continue

            # 3. Upload
            try:
                payload = encode_jpeg(frame, quality=80)
                files = {"file": (f"{int(time.time())}.jpg", payload, "image/jpeg")}
                data = {"camera_id": cfg.camera_id}
                r = session.post(f"{cfg.ml_url}/detect", files=files, data=data, timeout=10)
                r.raise_for_status()
                sent += 1
                log.info(
                    "Sent frame (%d KB) → faces=%s  totals sent=%d skipped(motion)=%d skipped(no-face)=%d",
                    len(payload) // 1024, _faces_count(r), sent, skipped_motion, skipped_no_face,
                )
            except (requests.RequestException, ValueError) as e:
                errors += 1
                log.warning("Upload failed (%d total errors): %s", errors, e)
                time.sleep(min(2 ** min(errors, 5), 30))
    except KeyboardInterrupt:
        log.info("Stopping. sent=%d motion-skip=%d no-face-skip=%d errors=%d",
                 sent, skipped_motion, skipped_no_face, errors)
    finally:
        cap.release()


def _faces_count(response: requests.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict) and isinstance(body.get("faces"), list):
            return str(len(body["faces"]))
    except ValueError:
        pass
    return "?"


if __name__ == "__main__":
    main()
