#!/usr/bin/env python3
"""MONGOLZ on-prem edge agent with an encrypted durable outbox."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import re
import socket
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Native FFmpeg/OpenCV diagnostics can echo a credential-bearing RTSP URL.
os.environ["OPENCV_LOG_LEVEL"] = "SILENT"
import cv2
import numpy as np
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = "1.0.0"
_CREDENTIAL_URL_RE = re.compile(r"(\w+://)[^/@\s]+@")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise SystemExit(f"{name} must be a number") from exc
    if not minimum <= value <= maximum:
        raise SystemExit(f"{name} must be between {minimum} and {maximum}")
    return value


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise SystemExit(f"{name} must be between {minimum} and {maximum}")
    return value


def _uuid_env(name: str) -> str:
    try:
        return str(uuid.UUID(os.environ.get(name, "")))
    except (TypeError, ValueError) as exc:
        raise SystemExit(f"{name} must be a UUID") from exc


def _spool_key() -> bytes:
    try:
        key = base64.b64decode(os.environ.get("EDGE_SPOOL_KEY", ""), validate=True)
    except Exception as exc:  # noqa: BLE001 — configuration boundary
        raise SystemExit("EDGE_SPOOL_KEY must be base64") from exc
    if len(key) != 32:
        raise SystemExit("EDGE_SPOOL_KEY must decode to exactly 32 bytes")
    return key


@dataclass(frozen=True)
class Config:
    rtsp_url: str
    ml_url: str
    ml_token: str
    camera_id: str
    agent_id: str
    sample_interval_sec: float
    motion_threshold: float
    heartbeat_interval_sec: float
    request_timeout_sec: float
    max_spool_bytes: int
    spool_dir: Path
    spool_key: bytes
    agent_name: str

    @classmethod
    def from_env(cls) -> "Config":
        env_path = Path(__file__).parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise SystemExit(f"Missing required env var: {name}")
            return value

        return cls(
            rtsp_url=required("RTSP_URL"),
            ml_url=required("ML_SERVICE_URL").rstrip("/"),
            ml_token=required("ML_SERVICE_TOKEN"),
            camera_id=_uuid_env("CAMERA_ID"),
            agent_id=_uuid_env("AGENT_ID"),
            sample_interval_sec=_bounded_float("SAMPLE_INTERVAL_SEC", 1.0, 0.1, 60.0),
            motion_threshold=_bounded_float("MOTION_THRESHOLD", 8.0, 0.0, 255.0),
            heartbeat_interval_sec=_bounded_float("HEARTBEAT_INTERVAL_SEC", 30.0, 5.0, 600.0),
            request_timeout_sec=_bounded_float("REQUEST_TIMEOUT_SEC", 10.0, 1.0, 60.0),
            max_spool_bytes=_bounded_int("MAX_SPOOL_BYTES", 2 * 1024**3, 1024**2, 1024**4),
            spool_dir=Path(os.environ.get("EDGE_SPOOL_DIR", "/var/lib/mongolz-edge")),
            spool_key=_spool_key(),
            agent_name=os.environ.get("AGENT_NAME", socket.gethostname()).strip()[:120] or "edge-agent",
        )


def redact_url(value: str) -> str:
    safe = _CREDENTIAL_URL_RE.sub(r"\1***@", value)
    return safe.split("?", 1)[0].split("#", 1)[0]


def mean_abs_diff(a: np.ndarray, b: np.ndarray) -> float:
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    return float(np.mean(cv2.absdiff(ga, gb)))


def haar_has_face(frame: np.ndarray, cascade: cv2.CascadeClassifier) -> bool:
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(grey, scaleFactor=1.2, minNeighbors=5, minSize=(40, 40))
    return len(faces) > 0


def encode_jpeg(frame: np.ndarray, quality: int = 80) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return buf.tobytes()


def _atomic_write(path: Path, body: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("wb") as handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


@dataclass(frozen=True)
class OutboxEntry:
    event_id: str
    metadata: dict[str, Any]
    meta_path: Path
    payload_path: Path


class SpoolFull(RuntimeError):
    pass


class EncryptedOutbox:
    def __init__(self, root: Path, key: bytes, max_bytes: int):
        self.root = root
        self.events = root / "events"
        self.events.mkdir(parents=True, exist_ok=True)
        self.cipher = AESGCM(key)
        self.max_bytes = max_bytes

    def size_bytes(self) -> int:
        total = 0
        for path in self.events.iterdir():
            if path.is_file() and not path.name.endswith(".tmp"):
                try:
                    total += path.stat().st_size
                except FileNotFoundError:
                    pass
        return total

    def _recover(self, payload_path: Path, meta_path: Path, event_id: str) -> dict[str, Any]:
        sealed = payload_path.read_bytes()
        if len(sealed) < 29:
            raise ValueError("sealed payload is truncated")
        payload = self.cipher.decrypt(sealed[:12], sealed[12:], event_id.encode())
        metadata = {
            "event_id": event_id,
            "captured_at": datetime.fromtimestamp(payload_path.stat().st_mtime, timezone.utc).isoformat(),
            "payload_sha256": hashlib.sha256(payload).hexdigest(),
            "created_epoch": payload_path.stat().st_mtime,
            "attempts": 0,
            "next_attempt_epoch": 0.0,
            "last_error": "metadata-recovered-after-crash",
        }
        _atomic_write(meta_path, json.dumps(metadata, separators=(",", ":")).encode())
        return metadata

    def entries(self) -> list[OutboxEntry]:
        found: list[OutboxEntry] = []
        # Payload is written first. Recover the narrow crash window before the
        # metadata rename, including the same window after acknowledgement.
        for payload_path in self.events.glob("*.enc"):
            meta_path = self.events / f"{payload_path.stem}.json"
            if meta_path.exists():
                continue
            try:
                event_id = str(uuid.UUID(payload_path.stem))
                self._recover(payload_path, meta_path, event_id)
                logging.getLogger("agent").warning("Recovered outbox metadata event=%s", event_id[:8])
            except Exception as exc:  # noqa: BLE001 — keep bytes for manual recovery
                logging.getLogger("agent").error(
                    "Could not recover encrypted outbox payload %s (%s)", payload_path.name, type(exc).__name__
                )
        for meta_path in self.events.glob("*.json"):
            try:
                event_id = str(uuid.UUID(meta_path.stem))
                payload_path = self.events / f"{event_id}.enc"
                if not payload_path.is_file():
                    raise ValueError("payload missing")
                try:
                    metadata = json.loads(meta_path.read_text())
                    if str(uuid.UUID(str(metadata["event_id"]))) != event_id:
                        raise ValueError("event id mismatch")
                except Exception:
                    metadata = self._recover(payload_path, meta_path, event_id)
                found.append(OutboxEntry(event_id, metadata, meta_path, payload_path))
            except Exception as exc:  # noqa: BLE001 — corrupt disk input
                logging.getLogger("agent").error(
                    "Quarantining corrupt outbox entry %s (%s)", meta_path.name, type(exc).__name__
                )
                try:
                    os.replace(meta_path, meta_path.with_suffix(".bad"))
                except OSError:
                    pass
        return sorted(found, key=lambda entry: float(entry.metadata.get("created_epoch", 0)))

    def enqueue(self, payload: bytes, captured_at: str | None = None) -> OutboxEntry:
        if self.size_bytes() + len(payload) + 4096 > self.max_bytes:
            raise SpoolFull("encrypted outbox capacity reached")
        event_id = str(uuid.uuid4())
        captured_at = captured_at or _utc_now()
        nonce = os.urandom(12)
        sealed = nonce + self.cipher.encrypt(nonce, payload, event_id.encode())
        payload_path = self.events / f"{event_id}.enc"
        meta_path = self.events / f"{event_id}.json"
        metadata = {
            "event_id": event_id,
            "captured_at": captured_at,
            "payload_sha256": hashlib.sha256(payload).hexdigest(),
            "created_epoch": time.time(),
            "attempts": 0,
            "next_attempt_epoch": 0.0,
            "last_error": None,
        }
        _atomic_write(payload_path, sealed)
        try:
            _atomic_write(meta_path, json.dumps(metadata, separators=(",", ":")).encode())
        except BaseException:
            payload_path.unlink(missing_ok=True)
            raise
        return OutboxEntry(event_id, metadata, meta_path, payload_path)

    def read(self, entry: OutboxEntry) -> bytes:
        sealed = entry.payload_path.read_bytes()
        if len(sealed) < 29:
            raise ValueError("sealed payload is truncated")
        payload = self.cipher.decrypt(sealed[:12], sealed[12:], entry.event_id.encode())
        if hashlib.sha256(payload).hexdigest() != entry.metadata.get("payload_sha256"):
            raise ValueError("payload checksum mismatch")
        return payload

    def due(self, now: float | None = None) -> OutboxEntry | None:
        now = time.time() if now is None else now
        return next((e for e in self.entries() if float(e.metadata.get("next_attempt_epoch", 0)) <= now), None)

    def mark_failure(self, entry: OutboxEntry, reason: str) -> None:
        attempts = int(entry.metadata.get("attempts", 0)) + 1
        metadata = dict(entry.metadata)
        metadata.update({
            "attempts": attempts,
            "next_attempt_epoch": time.time() + min(300, 2 ** min(attempts, 8)),
            "last_error": reason[:120],
        })
        _atomic_write(entry.meta_path, json.dumps(metadata, separators=(",", ":")).encode())

    @staticmethod
    def acknowledge(entry: OutboxEntry) -> None:
        entry.meta_path.unlink(missing_ok=True)
        entry.payload_path.unlink(missing_ok=True)

    def depth(self) -> int:
        return len(self.entries())

    def oldest_queued_at(self) -> str | None:
        entries = self.entries()
        return str(entries[0].metadata.get("captured_at")) if entries else None


class Stats:
    def __init__(self, path: Path):
        self.path = path
        try:
            body = json.loads(path.read_text())
        except Exception:
            body = {}
        self.sent_total = max(0, int(body.get("sent_total", 0)))
        self.failed_total = max(0, int(body.get("failed_total", 0)))

    def save(self) -> None:
        _atomic_write(self.path, json.dumps({
            "sent_total": self.sent_total,
            "failed_total": self.failed_total,
        }, separators=(",", ":")).encode())


class CloudDelivery:
    def __init__(self, cfg: Config, outbox: EncryptedOutbox, stats: Stats):
        self.cfg = cfg
        self.outbox = outbox
        self.stats = stats
        self.last_error: str | None = None
        self.capture_enabled = True
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {cfg.ml_token}",
            "User-Agent": f"mongolz-edge-agent/{VERSION}",
        })

    def _status_fields(self) -> dict[str, str]:
        return {
            "agent_id": self.cfg.agent_id,
            "agent_name": self.cfg.agent_name,
            "camera_id": self.cfg.camera_id,
            "version": VERSION,
            "state": "degraded" if self.last_error else "online",
            "queue_depth": str(self.outbox.depth()),
            "oldest_queued_at": self.outbox.oldest_queued_at() or "",
            "sent_total": str(self.stats.sent_total),
            "failed_total": str(self.stats.failed_total),
            "last_error": self.last_error or "",
        }

    def send_one(self) -> bool:
        entry = self.outbox.due()
        if not entry:
            return False
        try:
            payload = self.outbox.read(entry)
            data = self._status_fields()
            data.update({
                "event_id": entry.event_id,
                "captured_at": str(entry.metadata["captured_at"]),
                "payload_sha256": str(entry.metadata["payload_sha256"]),
            })
            response = self.session.post(
                f"{self.cfg.ml_url}/edge/detect",
                files={"file": (f"{entry.event_id}.jpg", payload, "image/jpeg")},
                data=data,
                timeout=self.cfg.request_timeout_sec,
            )
            if response.status_code >= 500 or response.status_code in {408, 425, 429}:
                raise requests.RequestException(f"http-{response.status_code}")
            response.raise_for_status()
            body = response.json()
            if body.get("ok") is not True or body.get("event_id") != entry.event_id:
                raise ValueError("invalid acknowledgement")
            EncryptedOutbox.acknowledge(entry)
            self.capture_enabled = body.get("capture_enabled") is not False
            self.stats.sent_total += 1
            self.stats.save()
            self.last_error = None
            logging.getLogger("agent").info(
                "Delivered event=%s faces=%s queue=%d",
                entry.event_id[:8], body.get("face_count", "?"), self.outbox.depth(),
            )
            return True
        except Exception as exc:  # noqa: BLE001 — retry boundary
            reason = str(exc) if isinstance(exc, (ValueError, requests.RequestException)) else type(exc).__name__
            reason = reason[:120]
            self.outbox.mark_failure(entry, reason)
            self.stats.failed_total += 1
            self.stats.save()
            self.last_error = reason
            logging.getLogger("agent").warning(
                "Delivery deferred event=%s reason=%s", entry.event_id[:8], reason
            )
            return False

    def heartbeat(self) -> bool:
        try:
            response = self.session.post(
                f"{self.cfg.ml_url}/edge/heartbeat",
                data=self._status_fields(),
                timeout=self.cfg.request_timeout_sec,
            )
            response.raise_for_status()
            body = response.json()
            if body.get("ok") is not True:
                raise ValueError("invalid heartbeat acknowledgement")
            self.capture_enabled = body.get("capture_enabled") is not False
            if self.outbox.depth() == 0:
                self.last_error = None
            return True
        except Exception as exc:  # noqa: BLE001 — offline is expected
            self.last_error = f"heartbeat-{type(exc).__name__}"[:120]
            return False


def write_health(cfg: Config, outbox: EncryptedOutbox, delivery: CloudDelivery, state: str) -> None:
    _atomic_write(cfg.spool_dir / "health.json", json.dumps({
        "version": VERSION,
        "agent_id": cfg.agent_id,
        "camera_id": cfg.camera_id,
        "updated_epoch": time.time(),
        "state": state,
        "queue_depth": outbox.depth(),
        "last_error": delivery.last_error,
    }, separators=(",", ":")).encode())


def healthcheck() -> int:
    root = Path(os.environ.get("EDGE_SPOOL_DIR", "/var/lib/mongolz-edge"))
    try:
        body = json.loads((root / "health.json").read_text())
        age = time.time() - float(body["updated_epoch"])
        return 0 if age <= 180 and body.get("state") != "fatal" else 1
    except Exception:
        return 1


def _open_capture(cfg: Config) -> cv2.VideoCapture | None:
    cap = cv2.VideoCapture(cfg.rtsp_url)
    if cap.isOpened():
        return cap
    cap.release()
    return None


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    log = logging.getLogger("agent")
    cfg = Config.from_env()
    cfg.spool_dir.mkdir(parents=True, exist_ok=True)
    outbox = EncryptedOutbox(cfg.spool_dir, cfg.spool_key, cfg.max_spool_bytes)
    stats = Stats(cfg.spool_dir / "stats.json")
    delivery = CloudDelivery(cfg, outbox, stats)
    log.info(
        "Edge agent %s starting camera=%s source=%s queued=%d",
        cfg.agent_name, cfg.camera_id, redact_url(cfg.rtsp_url), outbox.depth(),
    )

    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        raise SystemExit("Failed to load Haar cascade")

    cap: cv2.VideoCapture | None = None
    reconnect_at = 0.0
    reconnect_failures = 0
    next_sample = 0.0
    next_delivery = 0.0
    next_heartbeat = 0.0
    prev_frame: np.ndarray | None = None

    try:
        while True:
            now_mono = time.monotonic()
            if now_mono >= next_delivery:
                delivery.send_one()
                next_delivery = now_mono + 0.25
            if now_mono >= next_heartbeat:
                delivery.heartbeat()
                next_heartbeat = now_mono + cfg.heartbeat_interval_sec
            write_health(cfg, outbox, delivery, "degraded" if delivery.last_error else "online")

            if not delivery.capture_enabled:
                if cap is not None:
                    cap.release()
                    cap = None
                time.sleep(0.25)
                continue

            if cap is None and now_mono >= reconnect_at:
                cap = _open_capture(cfg)
                if cap is None:
                    reconnect_failures += 1
                    delay = min(60.0, 2 ** min(reconnect_failures, 6))
                    reconnect_at = now_mono + delay
                    delivery.last_error = "camera-unreachable"
                    log.warning("Camera unavailable; retry in %.0fs", delay)
                else:
                    reconnect_failures = 0
                    prev_frame = None
                    delivery.last_error = None
                    log.info("Camera connected")

            if cap is None:
                time.sleep(0.25)
                continue
            if outbox.size_bytes() >= cfg.max_spool_bytes:
                delivery.last_error = "spool-full"
                time.sleep(0.5)
                continue
            if now_mono < next_sample:
                cap.grab()
                time.sleep(0.01)
                continue

            ok, frame = cap.read()
            if not ok or frame is None:
                cap.release()
                cap = None
                reconnect_at = now_mono + 1.0
                delivery.last_error = "camera-frame-lost"
                continue
            next_sample = now_mono + cfg.sample_interval_sec
            if prev_frame is not None and mean_abs_diff(frame, prev_frame) < cfg.motion_threshold:
                prev_frame = frame
                continue
            prev_frame = frame
            if not haar_has_face(frame, cascade):
                continue
            try:
                entry = outbox.enqueue(encode_jpeg(frame))
                log.info("Queued event=%s queue=%d", entry.event_id[:8], outbox.depth())
            except SpoolFull:
                delivery.last_error = "spool-full"
                log.error("Encrypted outbox is full; capture paused until delivery recovers")
    except KeyboardInterrupt:
        log.info(
            "Stopping queue=%d sent=%d failures=%d",
            outbox.depth(), stats.sent_total, stats.failed_total,
        )
    finally:
        if cap is not None:
            cap.release()
        write_health(cfg, outbox, delivery, "stopped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--healthcheck", action="store_true")
    args = parser.parse_args()
    if args.healthcheck:
        sys.exit(healthcheck())
    main()
