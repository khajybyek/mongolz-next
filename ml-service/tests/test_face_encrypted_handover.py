"""A track handed from one person to another through a detection gap
(ADR 0013, FE-REGRESS-1) — the real capture pipeline, then the real reveal.

The tracker is geometric: when person A leaves a spot and person B steps
into it within TRACK_MAX_GAP frames, B's detection continues A's track. The
identity samples decide what a reveal may restore, and a sample only vouches
for frames on its own side of a missed detection:

* head — A at the kiosk on frames 1–3, B from frame 5; the track's only
  sample is B (tick 5). A reveal of B must never unseal A's frames.
* tail — A on frames 0–6 (samples at ticks 0 and 5), B from frame 8. A
  reveal of A must never unseal B's frames after the gap.

Pipeline: _emit_frame → FaceMasker persistence → IoUTracker → envelope
(blobs + detection runs) → _process_arcface identity samples; scripted
detections and a scripted ArcFace (a marker in the frame names who is there).
"""
from __future__ import annotations

import asyncio
import secrets
from pathlib import Path
from types import SimpleNamespace
from typing import Callable
from unittest.mock import AsyncMock

import cv2
import numpy as np
import pytest

import crypto_utils
import face_envelope
import privacy_protection
import recording_pipeline as rp
import reveal_job
from face_envelope import EnvelopeReader
from privacy_schedule import PrivacyScheduleCache
from reveal_job import RevealProcessor
from tests.test_capture_integrity import CaptureStorage
from tests.test_privacy_pipeline import CAM, S, ScriptedCache, _Proc
from tests.test_reveal_face_encrypted import CollectingEncoder, FaceDB, ScheduleStorage
from tests.test_reveal_job import JOB_ID, RECORDING_ID, FakeStorage, _job_row

W, H, FPS, N = 320, 240, 5, 10
BOX_A = (100, 60, 170, 130)        # A's detection at the kiosk
BOX_B = (104, 62, 174, 132)        # B steps into (almost) the same spot
EMB = {"A": np.eye(512, dtype=np.float32)[0], "B": np.eye(512, dtype=np.float32)[1]}
MARKER = {None: 50, "A": 150, "B": 250}


def _texture(seed: int, h: int, w: int) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = 128 + 100 * np.sin(xx / (3.0 + seed)) * np.cos(yy / (4.0 + 2 * seed))
    return np.dstack([a, 255 - a, (a * (0.3 + 0.3 * seed)) % 255]).astype(np.uint8)


def _frame(who: str | None) -> np.ndarray:
    fr = np.full((H, W, 3), 50, np.uint8)
    if who is not None:
        x1, y1, x2, y2 = BOX_A if who == "A" else BOX_B
        fr[y1:y2, x1:x2] = _texture(1 if who == "A" else 3, y2 - y1, x2 - x1)
    fr[H - 16:H, W - 16:W] = MARKER[who]          # read by the scripted ArcFace
    return fr


class _Masker(rp.FaceMasker):
    """Real persistence cache, merge and padding; scripted detections."""

    def __init__(self, who_at: Callable[[int], str | None]):
        super().__init__(None, persist_frames=rp.BLUR_PERSIST_FRAMES, pad_ratio=rp.BLUR_PAD_RATIO)
        self._who_at = who_at

    def _detect_haar(self, frame):
        who = self._who_at(self.frame_idx - 1)
        return [((BOX_A if who == "A" else BOX_B), "standard")] if who else []

    def _detect_insight(self, frame):
        return []


class _ArcFace:
    """Whoever the frame marker names is present at their box."""

    cosine = staticmethod(lambda a, b: float(np.dot(a, b)))

    def detect_all(self, jpeg):
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        v = float(img[H - 12:H - 4, W - 12:W - 4].mean())
        if v < 100:
            return []
        who = "A" if v < 200 else "B"
        return [SimpleNamespace(bbox=BOX_A if who == "A" else BOX_B, confidence=0.99, embedding=EMB[who])]


class _FaceEncrypted:
    async def mode_for(self, camera_id):
        return "face_encrypted"

    def peek(self, camera_id):
        return "face_encrypted"


@pytest.fixture(autouse=True)
def master(monkeypatch):
    key = secrets.token_bytes(32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", key)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    monkeypatch.setattr(privacy_protection, "PRIVACY_SCHEDULE_PAD_SEC", 0.0)
    monkeypatch.setattr(rp, "PRIVACY_SPAN_RETRY_SEC", 0.0)
    return key


def _capture(tmp_path, who_at):
    s = rp.RecordingSession(
        camera_id=CAM, camera_name="Kiosk", source_url="rtsp://10.0.0.9/live", engine=_ArcFace(),
        storage=CaptureStorage(), hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"),
        fps=FPS, recording_id=RECORDING_ID, privacy_cache=ScriptedCache(S), recording_mode_cache=_FaceEncrypted(),
    )
    s._is_file_mode = True
    asyncio.run(s._refresh_recording_mode())
    s.hls, s.masked_writer = _Proc(), _Proc()
    s._open_face_envelope(W, H)
    s.masker = _Masker(who_at)
    s._draw_kst_timestamp = lambda *a, **k: None
    s._row_inserted = True
    s._persist_face = AsyncMock(side_effect=RuntimeError("no row"))   # samples need no faces row
    s._match_and_alert = AsyncMock()
    originals = [_frame(who_at(f)) for f in range(N)]

    async def run():
        for f in range(N):
            await s._emit_frame(f / FPS, originals[f])
            await asyncio.gather(*s.arcface_tasks)
        await s._finalize_envelope()

    asyncio.run(run())
    stored = [np.frombuffer(b, np.uint8).reshape(H, W, 3) for b in s.masked_writer.stdin.frames]
    return s, originals, stored


def _reveal(tmp_path, monkeypatch, s, stored, target: str):
    video = tmp_path / "masked.mp4"
    vw = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for fr in stored:
        vw.write(fr)
    vw.release()
    objects = {
        ("recordings", "m.mp4.enc"): crypto_utils.encrypt_bytes(video.read_bytes(), RECORDING_ID),
        ("recordings", "e.mfe.enc"): crypto_utils.encrypt_bytes(Path(s.envelope_path).read_bytes(), RECORDING_ID),
    }
    emb = EMB[target].tolist()
    job = _job_row(method="photo", query_embedding=emb, query_embeddings=[emb])
    job["recordings"] = {"filename": "seg.mp4", "storage_path": "m.mp4.enc", "camera_id": None,
                         "started_at": "2026-09-30T03:00:00+00:00", "duration_sec": N / FPS,
                         "blur_strategy": "face_encrypted"}
    db = FaceDB(job, {"blur_strategy": "face_encrypted", "has_original": True, "original_path": None,
                      "storage_path": "m.mp4.enc", "face_envelope_path": "e.mfe.enc"}, b"")
    db.storage = SimpleNamespace(from_=lambda name: SimpleNamespace(download=lambda p: objects[(name, p)]))
    proc = RevealProcessor(SimpleNamespace(), FakeStorage(db), privacy_cache=PrivacyScheduleCache(ScheduleStorage()))
    encoders: list = []
    monkeypatch.setattr(reveal_job.subprocess, "Popen",
                        lambda cmd, **_k: encoders.append(CollectingEncoder(cmd[-1])) or encoders[-1])
    monkeypatch.setattr(reveal_job, "verify_rendered_video", lambda *a, **k: None)
    monkeypatch.setattr(RevealProcessor, "_draw_watermark", staticmethod(lambda frame, *_a, **_k: frame))
    opened: list[int] = []
    real_open = face_envelope._open_blob
    monkeypatch.setattr(face_envelope, "_open_blob",
                        lambda key, h, ct, aad: opened.append(h.frame_index) or real_open(key, h, ct, aad))
    asyncio.run(proc.run(JOB_ID))
    assert db.job["status"] == "completed", db.job.get("error_message")
    out = [np.frombuffer(b, np.uint8).reshape(H, W, 3) for b in encoders[0].frames]
    return sorted(opened), out


def _mad(out, originals, frame, box) -> float:
    x1, y1, x2, y2 = box
    return float(np.abs(out[frame][y1:y2, x1:x2].astype(int) - originals[frame][y1:y2, x1:x2].astype(int)).mean())


def test_a_reveal_of_the_newcomer_never_restores_who_stood_there_before(tmp_path, monkeypatch):
    who_at = lambda f: "A" if 1 <= f <= 3 else ("B" if f >= 5 else None)  # noqa: E731
    s, originals, stored = _capture(tmp_path, who_at)
    reader = EnvelopeReader(s.envelope_path, RECORDING_ID)
    # The scenario: ONE track (A's, continued by B across the miss on frame
    # 4), sampled only at tick 5 — on B — with two detection runs.
    assert list(reader.tracks) == [1]
    track = reader.tracks[1]
    assert (track.first_frame, [x.frame_index for x in track.samples]) == (1, [5])
    assert track.runs == ((1, 3), (5, 9))

    opened, out = _reveal(tmp_path, monkeypatch, s, stored, "B")
    assert opened == [5, 6, 7, 8, 9]                 # A's blobs (1–4) never decrypted
    assert all(_mad(out, originals, f, BOX_A) > 30 for f in (1, 2, 3))   # A stays cipher
    assert all(_mad(out, originals, f, BOX_B) < 12 for f in (5, 6, 7, 8, 9))   # B restored


def test_a_reveal_of_the_first_person_never_restores_who_came_after_the_gap(tmp_path, monkeypatch):
    who_at = lambda f: "A" if f <= 6 else ("B" if f >= 8 else None)  # noqa: E731
    s, originals, stored = _capture(tmp_path, who_at)
    reader = EnvelopeReader(s.envelope_path, RECORDING_ID)
    assert list(reader.tracks) == [1]
    track = reader.tracks[1]
    assert [x.frame_index for x in track.samples] == [0, 5]
    assert track.runs == ((0, 6), (8, 9))

    opened, out = _reveal(tmp_path, monkeypatch, s, stored, "A")
    assert opened == [0, 1, 2, 3, 4, 5, 6]           # B's blobs (and the stale 7) stay sealed
    assert all(_mad(out, originals, f, BOX_B) > 30 for f in (8, 9))      # B stays cipher
    assert all(_mad(out, originals, f, BOX_A) < 12 for f in range(0, 7))  # A restored
