"""Reveal of a face_encrypted recording (ADR 0013).

A face_encrypted recording has no raw original: the stored video is the
masked video (every face box painted with the keyed cipher pattern) and each
face box of each frame is sealed in the face envelope under its track's
hash-chain key. An approved reveal:

  • collects the target embeddings (existing plain / sealed embedding and
    reveal_level rules) and selects tracks by their OWN sealed identity
    samples (capture-time ArcFace embeddings) at the job threshold — no
    detector, no embedding of any video frame, no faces row needed; a face_id
    link alone selects nothing;
  • restores a selected track only where the samples nearest before and
    after a blob both match the target;
  • unseals ONLY those blobs — a blob of any other track is never read, let
    alone decrypted, and every other face stays the cipher pattern in the
    output;
  • leaves sealed what reveal_level (ADR 0009), never_reveal zones, protected
    (private) stretches (ADR 0012) and the requested window exclude;
  • fails with [face_envelope_empty] when nothing is left to unseal,
    [face_envelope_invalid] on a damaged / tampered envelope or masked video
    (the stored object fails its at-rest authentication, a header disagrees
    with the sealed index, a blob or sample fails authentication) and
    [face_envelope_unavailable] when a source cannot be downloaded;
  • keeps every existing guard (4-eyes, lease, privacy refusal) in front.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import math
import secrets
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import cv2
import numpy as np
import pytest

import crypto_utils
import face_envelope
import privacy_protection
import reveal_job
from cipher_mask import CipherPalette, paint_cipher, visual_key
from face_envelope import EnvelopeWriter, blank_foreign_regions, crop_rect
from hierarchical_keys import encrypt_face, key_at_index
from privacy_schedule import PrivacyScheduleCache
from reveal_job import (
    FACE_ENVELOPE_EMPTY_MSG,
    FACE_ENVELOPE_INVALID_MSG,
    FACE_ENVELOPE_UNAVAILABLE_MSG,
    PRIVACY_WHOLE_RECORDING_MSG,
    RevealProcessor,
)
from tests.test_reveal_job import JOB_ID, RECORDING_ID, FakeDB, FakeStorage, _job_row, _Query, needs_ffmpeg

REAL_POPEN = subprocess.Popen  # captured before any test patches it
SAMPLES = Path(__file__).resolve().parent.parent / "samples"
W, H, FPS, FRAMES = 320, 240, 15, 12
CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
STARTED = datetime(2026, 9, 30, 3, 0, 0, tzinfo=timezone.utc)
MASKED_PATH = f"{CAM}/20260930_120000_{RECORDING_ID}_masked.mp4.enc"
ENVELOPE_PATH = f"{CAM}/20260930_120000_{RECORDING_ID}_faces.mfe.enc"
FACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
FACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
# Painted (inner) boxes of the two people, far from the watermark bar.
BOX_A = (40, 70, 110, 160)
BOX_B = (200, 70, 270, 160)


def _unit(i: int) -> np.ndarray:
    v = np.zeros(512, np.float32)
    v[i] = 1.0
    return v


EMB_A, EMB_B, EMB_NOBODY = _unit(0), _unit(1), _unit(2)


@pytest.fixture(autouse=True)
def master(monkeypatch):
    key = secrets.token_bytes(32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", key)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    monkeypatch.setattr(privacy_protection, "PRIVACY_SCHEDULE_PAD_SEC", 0.0)
    return key


# ── the recording: original faces → masked video + sealed envelope ─────
def _face_pixels(seed: int, box, frame: int) -> np.ndarray:
    """A smooth, person-specific texture (JPEG-friendly)."""
    x1, y1, x2, y2 = box
    yy, xx = np.mgrid[0:y2 - y1, 0:x2 - x1].astype(np.float32)
    a = 128 + 90 * np.sin((xx + 2 * frame) / (5.0 + seed)) * np.cos(yy / (7.0 + seed))
    b = 128 + 90 * np.cos((xx + yy) / (9.0 + 2 * seed))
    return np.dstack([a, b, 255 - a]).clip(0, 255).astype(np.uint8)


def _original(i: int, boxes) -> np.ndarray:
    frame = np.full((H, W, 3), 60, np.uint8)
    frame[:, :, 1] = np.linspace(40, 120, W, dtype=np.uint8)[None, :]
    for seed, box in enumerate(boxes, start=1):
        x1, y1, x2, y2 = box
        frame[y1:y2, x1:x2] = _face_pixels(seed, box, i)
    return frame


class Recording:
    """A face_encrypted segment built the way the capture pipeline builds it
    (crop_rect + blank_foreign_regions + EnvelopeWriter + paint_cipher)."""

    def __init__(self, tmp_path, master, *, tracks=None, links=None, finalize=True, frames=FRAMES,
                 originals=None, samples=None, detected=None):
        # tracks: {track_id: (chain_index, box)}
        # samples: {track_id: [(frame_index, embedding), …]} — the identity
        # samples the recognition tick sealed (default: one per track at
        # frame 0, track 1 = A, track 2 = B).
        # detected: {track_id: frames with a FRESH detection} — the tracker's
        # detection runs (default: every frame, as a face Haar finds on every
        # frame).
        self.tracks = tracks or {1: (0, BOX_A), 2: (1, BOX_B)}
        links = {1: FACE_A, 2: FACE_B} if links is None else links
        if samples is None:
            samples = {tid: [(0, emb)] for tid, emb in ((1, EMB_A), (2, EMB_B)) if tid in self.tracks}
        self.originals = originals or [
            _original(i, [b for _c, b in self.tracks.values()]) for i in range(frames)
        ]
        frames = len(self.originals)
        palette = CipherPalette(visual_key(RECORDING_ID, master))
        env_path = tmp_path / "faces.mfe"
        writer = EnvelopeWriter(env_path, RECORDING_ID, width=W, height=H, fps=FPS, master=master)
        masked = []
        for i, original in enumerate(self.originals):
            stored = original.copy()
            inners = {tid: box for tid, (_c, box) in self.tracks.items()}
            for tid, (chain, inner) in self.tracks.items():
                rect, margins = crop_rect(inner, W, H, writer.margin)
                others = [b for t, b in inners.items() if t != tid]
                crop = blank_foreign_regions(original[rect[1]:rect[3], rect[0]:rect[2]], rect, others)
                writer.add_face(frame_index=i, t_offset=i / FPS, track_id=tid, chain_index=chain,
                                rect=rect, margins=margins, crop=crop)
            for tid, (_c, inner) in self.tracks.items():
                paint_cipher(stored, inner, palette, tid)
            writer.note_detections(i, [tid for tid in self.tracks if detected is None or i in detected.get(tid, ())])
            masked.append(stored)
        for tid, fid in links.items():
            writer.link(tid, fid)
        for tid, pairs in samples.items():
            for frame, emb in pairs:
                writer.add_sample(tid, self.tracks[tid][0], frame, emb)
        if finalize:
            writer.finalize(frames=frames)
        else:
            writer.abort()
        self.envelope_raw = env_path.read_bytes()

        video = tmp_path / "masked.mp4"
        vw = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
        assert vw.isOpened()
        for frame in masked:
            vw.write(frame)
        vw.release()
        self.masked_mp4 = video.read_bytes()
        cap = cv2.VideoCapture(str(video))
        self.decoded = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            self.decoded.append(frame)
        cap.release()
        assert len(self.decoded) == frames

    def objects(self) -> dict:
        return {
            ("recordings", MASKED_PATH): crypto_utils.encrypt_bytes(self.masked_mp4, RECORDING_ID),
            ("recordings", ENVELOPE_PATH): crypto_utils.encrypt_bytes(self.envelope_raw, RECORDING_ID),
        }

    def tamper_track(self, track_id: int) -> None:
        """Flip one ciphertext byte of every blob of ``track_id``."""
        reader = face_envelope.EnvelopeReader(self.envelope_raw, RECORDING_ID)
        data = bytearray(self.envelope_raw)
        for header in reader.headers([track_id]):
            data[header.ct_offset + 3] ^= 0x40
        self.envelope_raw = bytes(data)


def _face_row(face_id, emb, chain, master, *, plain=True) -> dict:
    sealed = encrypt_face(emb.astype(np.float32).tobytes(), key_at_index(RECORDING_ID, chain, master))
    return {
        "id": face_id,
        "recording_id": RECORDING_ID,
        "chain_index": chain,
        "embedding": emb.tolist() if plain else None,
        "embedding_sealed": base64.b64encode(sealed).decode(),
    }


# ── a PostgREST fake that honours eq / in_ on faces ───────────────────
class _FilteringQuery(_Query):
    def execute(self):
        if self.table_name == "faces" and self.op == "select":
            if self.db.error:
                raise self.db.error
            self.db.face_queries.append((dict(self.eqs), {k: list(v) for k, v in self.ins.items()}))
            rows = [dict(r) for r in self.db.faces]
            for key, value in self.eqs.items():
                rows = [r for r in rows if r.get(key) == value]
            for key, values in self.ins.items():
                rows = [r for r in rows if r.get(key) in values]
            return SimpleNamespace(data=rows)
        return super().execute()


class FaceDB(FakeDB):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.face_queries: list = []

    def table(self, name):
        return _FilteringQuery(self, name)


class CollectingEncoder:
    """ffmpeg stand-in: keeps every raw frame, writes a placeholder file on
    exit so the upload step has an artifact (verify is patched out)."""

    def __init__(self, out_path: str):
        self.out_path = out_path
        self.frames: list[bytes] = []
        self.stdin = self

    def write(self, data: bytes) -> int:
        self.frames.append(bytes(data))
        return len(data)

    def close(self) -> None:
        pass

    def wait(self, timeout=None) -> int:
        with open(self.out_path, "wb") as f:
            f.write(b"\0" * 4096)
        return 0

    def terminate(self) -> None:
        pass

    kill = terminate


class NoEngine:
    """The face_encrypted reveal must not run a detector or embed a frame."""

    def __getattr__(self, name):
        raise AssertionError(f"engine.{name} used by a face_encrypted reveal")


class ScheduleStorage:
    def __init__(self, schedule=None):
        self.schedule = schedule

    def load_privacy_schedule(self, _camera_id):
        return self.schedule


@pytest.fixture
def rig(tmp_path, master, monkeypatch):
    """A face_encrypted recording, a job selecting FACE_A (detected face),
    the fake DB/storage, a collecting encoder and a spy on blob decryption."""
    rec = Recording(tmp_path, master)
    job = _job_row(
        method="detected_face",
        face_id=FACE_A,
        face_ids=[FACE_A],
        query_embedding=EMB_A.tolist(),
        query_embeddings=[EMB_A.tolist()],
    )
    job["recordings"] = {
        "filename": "seg.mp4", "storage_path": MASKED_PATH, "camera_id": None,
        "started_at": STARTED.isoformat(), "duration_sec": None, "blur_strategy": "face_encrypted",
    }
    db = FaceDB(job, {
        "blur_strategy": "face_encrypted", "has_original": True, "original_path": None,
        "storage_path": MASKED_PATH, "face_envelope_path": ENVELOPE_PATH,
    }, b"")
    db.faces = [_face_row(FACE_A, EMB_A, 2, master), _face_row(FACE_B, EMB_B, 3, master)]
    objects: dict = {}
    downloads: list[str] = []

    def bucket(name):
        def download(path):
            downloads.append(path)
            return objects[(name, path)]
        return SimpleNamespace(download=download)

    db.storage = SimpleNamespace(from_=bucket)
    storage = FakeStorage(db)
    proc = RevealProcessor(NoEngine(), storage, privacy_cache=PrivacyScheduleCache(ScheduleStorage()))

    encoders: list[CollectingEncoder] = []

    def popen(cmd, **_kw):
        enc = CollectingEncoder(cmd[-1])
        encoders.append(enc)
        return enc

    monkeypatch.setattr(reveal_job.subprocess, "Popen", popen)
    monkeypatch.setattr(reveal_job, "verify_rendered_video", lambda *a, **k: None)
    # Pixel assertions compare exact regions: no watermark overlay.
    monkeypatch.setattr(RevealProcessor, "_draw_watermark", staticmethod(lambda frame, *_a, **_k: frame))

    opened: list[tuple[int, int, int]] = []
    real_open = face_envelope._open_blob

    def spy(key, header, ct, aad):
        opened.append((header.track_id, header.frame_index, header.chain_index))
        return real_open(key, header, ct, aad)

    monkeypatch.setattr(face_envelope, "_open_blob", spy)

    def run():
        objects.clear()
        objects.update(rig.rec.objects())
        asyncio.run(proc.run(JOB_ID))

    def output_frames() -> list[np.ndarray]:
        assert len(encoders) == 1
        return [np.frombuffer(b, np.uint8).reshape(H, W, 3) for b in encoders[0].frames]

    rig = SimpleNamespace(rec=rec, db=db, storage=storage, proc=proc, run=run, opened=opened,
                        downloads=downloads, encoders=encoders, output_frames=output_frames,
                        master=master, tmp_path=tmp_path)
    return rig


def _region(frame: np.ndarray, box) -> np.ndarray:
    x1, y1, x2, y2 = box
    return frame[y1:y2, x1:x2].astype(np.int16)


def _mad(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean())


def _completed(rig) -> None:
    assert rig.db.job["status"] == "completed", rig.db.job.get("error_message")
    assert len(rig.storage.uploads) == 1
    bucket, path, size = rig.storage.uploads[0]
    assert bucket == "revealed" and path == rig.db.job["output_path"] and path.startswith(f"{JOB_ID}/")
    assert size > 0


def _failed_with(rig, message: str) -> None:
    assert rig.db.job["status"] == "failed"
    assert rig.db.job["error_message"] == message
    assert rig.storage.uploads == []


# ── 1. only the selected person is restored ───────────────────────────
def test_restores_only_the_selected_person_and_bystanders_stay_cipher(rig, caplog):
    caplog.set_level(logging.INFO, logger="mongolz-ml.reveal")
    rig.run()
    _completed(rig)

    # Only FACE_A's track was decrypted — every one of its blobs, no other.
    assert rig.opened and {t for t, _f, _c in rig.opened} == {1}
    assert sorted(f for _t, f, _c in rig.opened) == list(range(FRAMES))
    assert sorted(rig.downloads) == sorted([MASKED_PATH, ENVELOPE_PATH])

    out = rig.output_frames()
    assert len(out) == FRAMES
    for i in range(FRAMES):
        original, masked = rig.rec.originals[i], rig.rec.decoded[i]
        # A: the real face is back (lossy JPEG crop), not the cipher pattern.
        assert _mad(_region(out[i], BOX_A), _region(original, BOX_A)) < 8, i
        assert _mad(_region(masked, BOX_A), _region(original, BOX_A)) > 40, i
        # B: still exactly the stored cipher pattern — never restored.
        assert np.array_equal(_region(out[i], BOX_B), _region(masked, BOX_B)), i
        assert _mad(_region(out[i], BOX_B), _region(original, BOX_B)) > 40, i
    assert "unsealed 1 track(s), 12 blob(s)" in caplog.text


def test_a_second_person_is_restored_only_when_selected(rig):
    rig.db.job.update(face_ids=[FACE_A, FACE_B], query_embeddings=[EMB_A.tolist(), EMB_B.tolist()])
    rig.run()
    _completed(rig)
    assert {t for t, _f, _c in rig.opened} == {1, 2}
    out = rig.output_frames()
    assert _mad(_region(out[0], BOX_B), _region(rig.rec.originals[0], BOX_B)) < 8


def test_blobs_of_unselected_tracks_are_never_read(rig):
    """B's blobs are corrupted in the envelope: a reveal of A never touches
    them (it would fail authentication if it did) and completes."""
    rig.rec.tamper_track(2)
    rig.run()
    _completed(rig)
    assert {t for t, _f, _c in rig.opened} == {1}


def test_a_tampered_selected_blob_fails_and_publishes_nothing(rig):
    rig.rec.tamper_track(1)
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)


def test_no_detector_or_frame_embedding_runs(rig):
    # NoEngine raises on any attribute: the job would have crashed.
    rig.run()
    _completed(rig)


@pytest.mark.skipif(not (SAMPLES / "01.jpg").exists(), reason="sample face images not present")
def test_real_faces_only_the_selected_one_comes_back(tmp_path, rig, monkeypatch):
    # A fixed master keeps the correlation figure deterministic (the cipher
    # cells are a keystream sample; the exact-pixel check is the proof).
    master = bytes(range(32))
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", master)
    faces = [cv2.imread(str(SAMPLES / f"0{i}.jpg")) for i in range(2)]
    frame = np.full((H, W, 3), 90, np.uint8)
    for img, (x1, y1, x2, y2) in zip(faces, (BOX_A, BOX_B)):
        frame[y1:y2, x1:x2] = cv2.resize(img, (x2 - x1, y2 - y1), interpolation=cv2.INTER_AREA)
    (tmp_path / "real").mkdir()
    rig.rec = Recording(tmp_path / "real", master, originals=[frame.copy() for _ in range(6)])
    rig.run()
    _completed(rig)
    out = rig.output_frames()
    gray = lambda img, box: cv2.cvtColor(  # noqa: E731
        np.ascontiguousarray(img[box[1] + 2:box[3] - 2, box[0] + 2:box[2] - 2]), cv2.COLOR_BGR2GRAY
    ).astype(float).ravel()
    restored = _mad(_region(out[0], BOX_A), _region(frame, BOX_A))
    r_b = np.corrcoef(gray(out[0], BOX_B), gray(frame, BOX_B))[0, 1]
    print(f"real faces: restored A diff {restored:.1f}, bystander B correlation {r_b:.3f}")
    assert restored < 10, restored
    for i, frame_out in enumerate(out):  # B: bit for bit the stored cipher pattern
        assert np.array_equal(_region(frame_out, BOX_B), _region(rig.rec.decoded[i], BOX_B)), i
    assert abs(r_b) < 0.2, r_b  # … which says nothing about B's face
    assert {t for t, _f, _c in rig.opened} == {1}


def test_overlapping_boxes_keep_the_other_persons_pixels(tmp_path, master, rig):
    """A's crop reaches into B's painted box (and the boxes overlap): the
    restored output keeps every pixel of B's box as stored."""
    box_a, box_b = (60, 70, 140, 160), (132, 80, 212, 170)
    (tmp_path / "overlap").mkdir()
    rig.rec = Recording(tmp_path / "overlap", master, tracks={1: (0, box_a), 2: (1, box_b)})
    rig.run()
    _completed(rig)
    out = rig.output_frames()
    for i in range(FRAMES):
        assert np.array_equal(_region(out[i], box_b), _region(rig.rec.decoded[i], box_b)), i
        # A's own part outside B's box is restored.
        left = (box_a[0], box_a[1], box_b[0] - 8, box_a[3])
        assert _mad(_region(out[i], left), _region(rig.rec.originals[i], left)) < 8, i


# ── 2. target resolution: the tracks' own identity samples ────────────
def test_target_matching_no_track_fails_before_the_masked_video_is_fetched(rig):
    rig.db.job.update(face_ids=None, face_id=None, method="upload",
                      query_embedding=EMB_NOBODY.tolist(), query_embeddings=None)
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_EMPTY_MSG)
    assert rig.downloads == [ENVELOPE_PATH] and rig.opened == []


def test_suspect_or_photo_target_resolves_through_the_tracks_samples(rig):
    rig.db.job.update(face_ids=None, face_id=None, method="suspect",
                      query_embedding=(EMB_A * 0.9 + EMB_NOBODY * 0.1).tolist(), query_embeddings=None)
    rig.run()
    _completed(rig)
    assert {t for t, _f, _c in rig.opened} == {1}


def test_no_faces_row_is_needed(rig):
    """FE-CAP-5: faces rows lost to a DB / Storage outage during capture do
    not make the recording unrestorable — the envelope's samples select."""
    rig.db.faces = []
    rig.db.job.update(face_ids=None, face_id=None, method="upload", query_embeddings=None)
    rig.run()
    _completed(rig)
    assert {t for t, _f, _c in rig.opened} == {1}
    assert rig.db.face_queries == []


def test_a_face_id_link_alone_selects_nothing(tmp_path, master, rig):
    """FE-CRYPTO-1: a bystander linked to the target's face_id by the weak
    capture-time dedup match (cosine 0.40 < the 0.45 reveal threshold) is
    NOT restored: selection uses the bystander's own sample."""
    bystander = (0.40 * EMB_A + np.sqrt(1 - 0.40 ** 2) * EMB_NOBODY).astype(np.float32)
    (tmp_path / "dedup").mkdir()
    rig.rec = Recording(tmp_path / "dedup", master, links={1: FACE_A, 2: FACE_A},
                        samples={1: [(0, EMB_A)], 2: [(0, bystander)]})
    rig.run()
    _completed(rig)
    assert {t for t, _f, _c in rig.opened} == {1}
    out = rig.output_frames()
    assert np.array_equal(_region(out[0], BOX_B), _region(rig.rec.decoded[0], BOX_B))


def test_an_unsampled_track_cannot_be_restored_even_when_linked(tmp_path, master, rig):
    (tmp_path / "unsampled").mkdir()
    rig.rec = Recording(tmp_path / "unsampled", master, samples={})
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_EMPTY_MSG)
    assert rig.opened == []
    assert rig.downloads == [ENVELOPE_PATH]  # the masked video is never fetched


def test_a_track_that_sampled_two_people_is_restored_only_between_samples_of_the_target(tmp_path, master, rig):
    """A track that swapped identity (two faces crossing): sampled A at frame
    0 and B at frame 8. Restoring A: frame 0 only (frames 1–7 lie between an
    A and a B sample; 8–11 after the B sample). Restoring B: frames 8–11."""
    (tmp_path / "mixed").mkdir()
    rig.rec = Recording(tmp_path / "mixed", master, tracks={1: (0, BOX_A)}, links={1: FACE_A},
                        samples={1: [(0, EMB_A), (8, EMB_B)]})
    rig.run()
    _completed(rig)
    assert sorted(f for _t, f, _c in rig.opened) == [0]

    rig.opened.clear()
    rig.encoders.clear()
    rig.storage.uploads.clear()
    rig.db.job.update(status="queued", face_ids=[FACE_B], face_id=FACE_B,
                      query_embeddings=[EMB_B.tolist()], query_embedding=EMB_B.tolist())
    rig.run()
    _completed(rig)
    assert sorted(f for _t, f, _c in rig.opened) == [8, 9, 10, 11]


def test_a_sample_never_vouches_for_frames_across_a_detection_gap(tmp_path, master, rig):
    """FE-REGRESS-1: the tracker is geometric, so a person can leave and
    another step into the same place within TRACK_MAX_GAP frames and continue
    the track. Head: detected 0–3, missed 4–5, detected 6–11, sampled only at
    6 (B) → restoring B opens 6–11, never A's frames 0–5. Tail: sampled at 0
    (A), detected 0–5, missed 6–7, detected 8–11 → restoring A opens 0–5,
    never the frames after the gap."""
    (tmp_path / "head").mkdir()
    rig.rec = Recording(tmp_path / "head", master, tracks={1: (0, BOX_A)}, links={},
                        samples={1: [(6, EMB_B)]}, detected={1: [0, 1, 2, 3, 6, 7, 8, 9, 10, 11]})
    rig.db.job.update(face_ids=[FACE_B], face_id=FACE_B,
                      query_embeddings=[EMB_B.tolist()], query_embedding=EMB_B.tolist())
    rig.run()
    _completed(rig)
    assert sorted(f for _t, f, _c in rig.opened) == [6, 7, 8, 9, 10, 11]

    (tmp_path / "tail").mkdir()
    rig.rec = Recording(tmp_path / "tail", master, tracks={1: (0, BOX_A)}, links={},
                        samples={1: [(0, EMB_A)]}, detected={1: [0, 1, 2, 3, 4, 5, 8, 9, 10, 11]})
    rig.opened.clear()
    rig.encoders.clear()
    rig.storage.uploads.clear()
    rig.db.job.update(status="queued", face_ids=[FACE_A], face_id=FACE_A,
                      query_embeddings=[EMB_A.tolist()], query_embedding=EMB_A.tolist())
    rig.run()
    _completed(rig)
    assert sorted(f for _t, f, _c in rig.opened) == [0, 1, 2, 3, 4, 5]


def test_track_confirmation_rules():
    runs = ((0, 3), (6, 11))
    head = reveal_job.TrackConfirmation(((6, True),), runs)
    assert [f for f in range(12) if head.confirms(f)] == [6, 7, 8, 9, 10, 11]
    tail = reveal_job.TrackConfirmation(((2, True),), runs)
    assert [f for f in range(12) if tail.confirms(f)] == [0, 1, 2, 3]
    # Between two samples both must match — unchanged, runs or not.
    both = reveal_job.TrackConfirmation(((2, True), (8, True)), runs)
    assert all(both.confirms(f) for f in range(0, 12))
    mixed = reveal_job.TrackConfirmation(((2, True), (8, False)), runs)
    assert [f for f in range(12) if mixed.confirms(f)] == [0, 1, 2]
    # Runs not recorded: a one-sided sample vouches for its own frame only.
    bare = reveal_job.TrackConfirmation(((6, True),), None)
    assert [f for f in range(12) if bare.confirms(f)] == [6]
    assert not reveal_job.TrackConfirmation(((6, False),), runs).confirms(7)


# ── 3. reveal_level (ADR 0009) ────────────────────────────────────────
def test_reveal_level_above_the_tracks_chain_index_unseals_nothing(rig, caplog, monkeypatch):
    # Level 2: FACE_A's row (chain 2) is within reach, the tracks (chains 0
    # and 1) are not — neither their blobs NOR their identity samples.
    caplog.set_level(logging.INFO, logger="mongolz-ml.reveal")
    samples: list = []
    real = face_envelope._open_sample
    monkeypatch.setattr(face_envelope, "_open_sample",
                        lambda *a: samples.append(1) or real(*a))
    rig.db.job["reveal_level"] = 2
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_EMPTY_MSG)
    assert rig.opened == [] and samples == []
    assert MASKED_PATH not in rig.downloads
    assert "2 beyond level" in caplog.text


def test_reveal_level_within_reach_unseals_forward_from_k_level(tmp_path, master, rig, monkeypatch):
    (tmp_path / "levels").mkdir()
    rig.rec = Recording(tmp_path / "levels", master, tracks={1: (0, BOX_A), 2: (3, BOX_B)})
    rig.db.faces = [_face_row(FACE_A, EMB_A, 2, master), _face_row(FACE_B, EMB_B, 4, master)]
    rig.db.job.update(reveal_level=3, face_ids=[FACE_B], face_id=FACE_B,
                      query_embeddings=[EMB_B.tolist()], query_embedding=EMB_B.tolist())
    derived: list[int] = []
    real = face_envelope.key_at_index

    def spy(recording_id, index, master_key):
        derived.append(index)
        return real(recording_id, index, master_key)

    monkeypatch.setattr(face_envelope, "key_at_index", spy)
    rig.run()
    _completed(rig)
    assert {t for t, _f, _c in rig.opened} == {2}
    assert derived and set(derived) == {3}  # K_3 from the master, never K_0


def test_level_gated_target_rows_keep_the_existing_refusal(rig):
    # Level 3: FACE_A's row (chain 2) cannot be unsealed → the standard
    # path's "no target within your level" refusal, before any download.
    rig.db.job["reveal_level"] = 3
    rig.run()
    assert rig.db.job["status"] == "failed"
    assert rig.db.job["error_message"].startswith("Reveal level 3:")
    assert rig.downloads == [] and rig.opened == []


# ── 4. zones, protected stretches, window ─────────────────────────────
def _camera(rig):
    rig.db.job["recordings"]["camera_id"] = CAM


def test_blobs_in_a_never_reveal_zone_stay_sealed(rig):
    _camera(rig)
    rig.db.zones = [{"x": 0.05, "y": 0.2, "w": 0.35, "h": 0.6, "name": "desk", "never_reveal": True}]
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_EMPTY_MSG)
    assert rig.opened == []


def test_a_zone_over_someone_else_does_not_block_the_target(rig):
    _camera(rig)
    rig.db.zones = [{"x": 0.6, "y": 0.2, "w": 0.35, "h": 0.6, "name": "till", "never_reveal": True}]
    rig.run()
    _completed(rig)


def test_protected_stretch_blobs_stay_sealed_and_masked(rig):
    # Frames 5.. (t >= 1/3 s) were captured in privacy mode (open span).
    rig.storage.spans = [{"recording_id": RECORDING_ID, "start_offset_sec": 5 / FPS,
                          "end_offset_sec": None, "source": "schedule"}]
    rig.run()
    _completed(rig)
    assert sorted(f for _t, f, _c in rig.opened) == [0, 1, 2, 3, 4]
    out = rig.output_frames()
    for i in range(FRAMES):
        restored = _mad(_region(out[i], BOX_A), _region(rig.rec.originals[i], BOX_A)) < 8
        assert restored is (i < 5), i
        if i >= 5:
            assert np.array_equal(_region(out[i], BOX_A), _region(rig.rec.decoded[i], BOX_A)), i


def test_whole_recording_protected_is_refused_before_anything_is_read(rig):
    rig.db.job["recordings"]["duration_sec"] = FRAMES / FPS
    rig.storage.spans = [{"recording_id": RECORDING_ID, "start_offset_sec": 0.0,
                          "end_offset_sec": None, "source": "fail_closed"}]
    rig.run()
    _failed_with(rig, PRIVACY_WHOLE_RECORDING_MSG)
    assert rig.downloads == [] and rig.db.face_queries == []


def test_only_the_requested_window_is_unsealed(rig):
    rig.db.job.update(target_start_sec=0.2, target_end_sec=0.4)  # frames 3..6
    rig.run()
    _completed(rig)
    assert sorted(f for _t, f, _c in rig.opened) == [3, 4, 5, 6]


# ── 5. damaged or missing sources ──────────────────────────────────────
def test_envelope_without_its_index_is_invalid(tmp_path, master, rig):
    (tmp_path / "noindex").mkdir()
    rig.rec = Recording(tmp_path / "noindex", master, finalize=False)
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)
    assert rig.opened == []


def test_envelope_of_another_recording_is_invalid(tmp_path, master, rig):
    other = "55555555-5555-4555-8555-555555555555"
    writer = EnvelopeWriter(tmp_path / "other.mfe", other, width=W, height=H, fps=FPS, master=master)
    writer.finalize(frames=1)
    rig.rec.envelope_raw = (tmp_path / "other.mfe").read_bytes()
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)


def test_undelivered_row_is_unavailable(rig):
    rig.db.recording = dict(rig.db.recording, has_original=False)
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_UNAVAILABLE_MSG)
    assert rig.downloads == []


def test_row_without_an_envelope_is_unavailable(rig):
    rig.db.recording = dict(rig.db.recording, face_envelope_path=None)
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_UNAVAILABLE_MSG)


def test_a_damaged_envelope_object_is_invalid(rig):
    """FE-RQ-2: the stored object is ONE at-rest ciphertext — garbage, a cut
    or a single flipped bit fails it whole, and that is damage, not an
    outage (no 'retry')."""
    real = rig.rec.objects
    for damage in (lambda b: b"garbage" * 10, lambda b: b[:-500],
                   lambda b: b[:40] + bytes([b[40] ^ 1]) + b[41:]):
        def broken(damage=damage):
            objs = real()
            objs[("recordings", ENVELOPE_PATH)] = damage(objs[("recordings", ENVELOPE_PATH)])
            return objs

        rig.rec.objects = broken
        rig.db.job["status"] = "queued"
        rig.downloads.clear()
        rig.run()
        _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)
        assert MASKED_PATH not in rig.downloads


def test_a_damaged_masked_video_object_is_invalid(rig):
    real = rig.rec.objects

    def broken():
        objs = real()
        blob = objs[("recordings", MASKED_PATH)]
        objs[("recordings", MASKED_PATH)] = blob[:60] + bytes([blob[60] ^ 1]) + blob[61:]
        return objs

    rig.rec.objects = broken
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)
    assert rig.opened == []


def test_an_envelope_download_failure_is_unavailable(rig):
    real_objects = rig.rec.objects

    def missing():
        objs = real_objects()
        del objs[("recordings", ENVELOPE_PATH)]   # download raises KeyError
        return objs

    rig.rec.objects = missing
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_UNAVAILABLE_MSG)
    assert MASKED_PATH not in rig.downloads


def test_a_header_that_disagrees_with_the_sealed_index_is_invalid(rig):
    """FE-CRYPTO-3: fps / width / height come from the authenticated index;
    a rewritten plaintext header (fps 1e9 would put every blob at t≈0 and
    past a protected stretch) makes the envelope unusable."""
    import json as _json
    import struct as _struct

    raw = rig.rec.envelope_raw
    magic, version, flags, hlen = _struct.unpack("<4sBBH", raw[:8])
    header = _json.loads(raw[8:8 + hlen])
    for field_name, value in (("fps", 1e9), ("width", W * 2)):
        tampered = dict(header, **{field_name: value})
        body = _json.dumps(tampered, separators=(",", ":")).encode()
        rig.rec.envelope_raw = _struct.pack("<4sBBH", magic, version, flags, len(body)) + body + raw[8 + hlen:]
        rig.db.job["status"] = "queued"
        rig.run()
        _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)
        assert rig.opened == []


def test_recording_lookup_outage_is_reported_as_such(rig):
    async def boom(_rid):
        raise reveal_job.RevealDataError("down")

    rig.proc._lookup_face_encrypted_source = boom
    rig.run()
    assert rig.db.job["status"] == "failed"
    assert "уншиж чадсангүй" in rig.db.job["error_message"]


def test_envelope_geometry_that_does_not_fit_the_video_is_invalid(tmp_path, master, rig):
    writer = EnvelopeWriter(tmp_path / "wide.mfe", RECORDING_ID, width=W * 2, height=H, fps=FPS, master=master)
    rect, margins = crop_rect(BOX_A, W * 2, H, writer.margin)
    writer.add_face(frame_index=0, t_offset=0.0, track_id=1, chain_index=0, rect=rect, margins=margins,
                    crop=rig.rec.originals[0][rect[1]:rect[3], rect[0]:rect[2]])
    writer.link(1, FACE_A)
    writer.add_sample(1, 0, 0, EMB_A)
    writer.finalize(frames=1)
    rig.rec.envelope_raw = (tmp_path / "wide.mfe").read_bytes()
    rig.run()
    _failed_with(rig, FACE_ENVELOPE_INVALID_MSG)


# ── 6. existing guards stay in front ──────────────────────────────────
def test_pending_approval_job_is_never_inspected(rig):
    rig.db.job["status"] = "pending_approval"
    rig.run()
    assert rig.db.job["status"] == "pending_approval"
    assert rig.downloads == [] and rig.db.face_queries == [] and rig.opened == []


def test_standard_rows_keep_the_original_path(rig, monkeypatch):
    """A row without blur_strategy face_encrypted never enters this path."""
    rig.db.job["recordings"]["blur_strategy"] = "on_demand"
    called = Mock(side_effect=AssertionError("face_encrypted path"))
    monkeypatch.setattr(rig.proc, "_run_face_encrypted", called)
    rig.db.recording = {"original_path": None, "has_original": False}
    rig.run()
    assert rig.db.job["error_message"] == "Original бичлэг алга — reveal боломжгүй"
    called.assert_not_called()


def test_messages_carry_stable_codes_for_the_web():
    codes = [m.split("]")[0] + "]" for m in (
        FACE_ENVELOPE_EMPTY_MSG, FACE_ENVELOPE_UNAVAILABLE_MSG, FACE_ENVELOPE_INVALID_MSG,
    )]
    assert codes == ["[face_envelope_empty]", "[face_envelope_unavailable]", "[face_envelope_invalid]"]


# ── 7. real encoder (regression guard for the published artifact) ─────
@needs_ffmpeg
def test_real_encoder_publishes_a_playable_restored_video(rig, monkeypatch):
    from view_renderer import verify_rendered_video

    monkeypatch.setattr(reveal_job.subprocess, "Popen", REAL_POPEN)
    monkeypatch.setattr(reveal_job, "verify_rendered_video", verify_rendered_video)
    captured: dict = {}
    real_upload = rig.storage.upload_bytes

    def upload(bucket, path, data, content_type):
        captured["data"] = data
        return real_upload(bucket, path, data, content_type)

    rig.storage.upload_bytes = upload
    rig.run()
    _completed(rig)
    out = rig.tmp_path / "out.mp4"
    out.write_bytes(captured["data"])
    cap = cv2.VideoCapture(str(out))
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    assert len(frames) == FRAMES
    assert _mad(_region(frames[0], BOX_A), _region(rig.rec.originals[0], BOX_A)) < 15
    assert _mad(_region(frames[0], BOX_B), _region(rig.rec.originals[0], BOX_B)) > 40
    assert rig.db.job["output_duration_sec"] == math.floor(FRAMES / FPS)
