"""Recording mode ``face_encrypted`` in the capture pipeline (ADR 0013).

* the stored video is the masked video (cipher pattern over every face box),
  encrypted at rest; NO raw original is written anywhere;
* every face box of every frame captured in standard privacy mode is sealed
  into the face envelope under its track's hash-chain key; frames captured in
  private mode — including the stretch before a private tick, which the span
  ledger covers — produce no blob;
* tracks share the chain-index counter with faces rows (unique per recording)
  and are linked to the face_id the ArcFace tick persisted/matched;
* journal, spool and delivery carry both artifacts; the row becomes ready
  only after both uploads; old manifests still deliver;
* a changed recording mode starts a new segment.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import cv2
import numpy as np
import pytest

import capture_journal
import crypto_utils
import recording_pipeline as rp
from capture_integrity import validate_capture
from cipher_mask import cipher_block
from face_envelope import EnvelopeReader, composite
from recording_spool import RecordingSpool
from tests.test_capture_integrity import CaptureStorage, capture_spool  # noqa: F401
from tests.test_privacy_pipeline import CAM, P, S, ScriptedCache, _Proc

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
HAVE_FFMPEG = shutil.which("ffmpeg") is not None
W, H = 160, 120
FACE = (50, 30, 100, 90)          # raw detection box (x1, y1, x2, y2)


class ModeCache:
    """Stands in for recording_mode.RecordingModeCache."""

    def __init__(self, mode="face_encrypted"):
        self.mode = mode
        self.peeks = 0

    async def mode_for(self, camera_id):
        return self.mode

    def peek(self, camera_id):
        self.peeks += 1
        return self.mode


class BoxEngine:
    """Detector + ArcFace stand-in: one face at ``box`` in every frame."""

    def __init__(self, box=FACE):
        self.box = box

    def detect_all(self, _jpeg):
        return [SimpleNamespace(bbox=self.box, confidence=0.99, embedding=np.ones(512, np.float32))]

    def detect_boxes(self, _jpeg):
        return [SimpleNamespace(bbox=self.box, confidence=0.99)]

    @staticmethod
    def cosine(a, b):
        return 0.0


def _face_frame(i: int = 0) -> np.ndarray:
    frame = np.full((H, W, 3), 40, np.uint8)
    yy, xx = np.mgrid[0:60, 0:50]
    tex = (128 + 100 * np.sin((xx + i) / 4.0) * np.cos(yy / 6.0)).astype(np.uint8)
    frame[30:90, 50:100] = np.dstack([tex, 255 - tex, tex // 2])
    return frame


def _session(tmp_path, *, privacy=None, mode_cache=None, engine=None, storage=None, fps=5):
    s = rp.RecordingSession(
        camera_id=CAM, camera_name="Gate", source_url="rtsp://10.0.0.9/live",
        engine=engine or BoxEngine(), storage=storage or CaptureStorage(),
        hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"), fps=fps,
        privacy_cache=privacy or ScriptedCache(S), recording_mode_cache=mode_cache or ModeCache(),
    )
    return s


def _scripted(tmp_path, privacy, *, boxes=(FACE,)):
    """Per-frame harness: fake pipes, a scripted masker, the real envelope."""
    s = _session(tmp_path, privacy=privacy)
    s._is_file_mode = True
    asyncio.run(s._refresh_recording_mode())
    assert s.blur_strategy == "face_encrypted" and s.recording_mode == "face_encrypted"
    s.hls = _Proc()
    s.masked_writer = _Proc()
    s._open_face_envelope(W, H)
    s.masker.step = lambda frame: [(b, 15, "standard") for b in boxes]
    s._draw_kst_timestamp = lambda *a, **k: None
    s._process_arcface = AsyncMock()
    s._row_inserted = True
    return s


@pytest.fixture(autouse=True)
def master(monkeypatch):
    key = secrets.token_bytes(32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", key)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    monkeypatch.setattr(rp, "PRIVACY_SPAN_RETRY_SEC", 0.0)
    return key


async def _emit(s, frames, start=0):
    for i in range(start, start + frames):
        await s._emit_frame(i / s.fps, _face_frame(i))


def _frames(proc) -> list[np.ndarray]:
    return [np.frombuffer(f, np.uint8).reshape(H, W, 3) for f in proc.stdin.frames]


# ── per frame ─────────────────────────────────────────────────────────
def test_stored_frames_carry_the_cipher_pattern_and_hls_stays_cubist(tmp_path):
    s = _scripted(tmp_path, ScriptedCache(S))
    asyncio.run(_emit(s, 5))
    inner = s.masker.padded_box(FACE, W, H)
    x1, y1, x2, y2 = inner
    stored, hls = _frames(s.masked_writer), _frames(s.hls)
    assert len(stored) == len(hls) == 5
    pattern = cipher_block(s._cipher, 1, x2 - x1, y2 - y1)
    for i, frame in enumerate(stored):
        # Exactly the keyed pattern inside the outline — no face pixel.
        assert np.array_equal(frame[y1 + 1:y2 - 1, x1 + 1:x2 - 1], pattern[1:-1, 1:-1])
        # Outside the box the frame is untouched.
        assert np.array_equal(frame[:, :x1], _face_frame(i)[:, :x1])
        # Live viewers keep the cubist mask (masked, but not the cipher).
        assert not np.array_equal(hls[i][y1:y2, x1:x2], frame[y1:y2, x1:x2])
        assert not np.array_equal(hls[i][30:90, 50:100], _face_frame(i)[30:90, 50:100])
    assert s.original_writer is None  # no raw original in this mode


def test_private_frames_and_the_stretch_before_a_private_tick_write_no_blob(tmp_path):
    # Ticks at frames 0, 5, 10 (fps 5): standard, private, standard.
    s = _scripted(tmp_path, ScriptedCache(S, P, S))

    async def run():
        await _emit(s, 15)
        await s._finalize_envelope()
        await s._settle_privacy_spans()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    assert reader.complete
    frames = sorted({h.frame_index for h in reader.headers()})
    # 0–4 were pending when the private tick at 5 arrived (the span ledger
    # opens that span at the previous tick, 0) → dropped; 5–9 private.
    assert frames == [10, 11, 12, 13, 14]
    assert reader.withheld_blobs == 10
    # Every frame is still masked in the stored video.
    assert len(s.masked_writer.stdin.frames) == 15
    # Exactly complementary to the capture-time privacy span (ADR 0012).
    spans = [(sp["start_offset_sec"], sp["end_offset_sec"]) for sp in s.privacy_spans.manifest_spans(s.recording_id)]
    assert spans == [(0.0, 2.0)]
    assert not any(0.0 <= f / s.fps < 2.0 for f in frames)


def test_detection_runs_are_recorded_in_private_frames_too(tmp_path):
    """FE-REGRESS-1: the runs a reveal uses to bound a one-sided sample are
    noted on every processed frame, blobs or not — a miss inside a private
    stretch (frame 7, no blob anyway) still splits the run, so a sample after
    it can never vouch for the frames before it."""
    s = _scripted(tmp_path, ScriptedCache(S, P, S))
    fresh = lambda f: f != 7   # noqa: E731
    s.masker.step = lambda frame: [(FACE, 15 if fresh(s.recorded_frames) else 14, "standard")]

    async def run():
        await _emit(s, 15)
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    assert sorted({h.frame_index for h in reader.headers()}) == [10, 11, 12, 13, 14]
    assert reader.tracks[1].runs == ((0, 6), (8, 14))


def test_standard_then_private_keeps_only_confirmed_frames(tmp_path):
    s = _scripted(tmp_path, ScriptedCache(S, S, P))

    async def run():
        await _emit(s, 15)
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    assert sorted({h.frame_index for h in reader.headers()}) == [0, 1, 2, 3, 4]


def test_tracks_share_the_chain_counter_with_faces_rows_and_get_linked(tmp_path):
    s = _scripted(tmp_path, ScriptedCache(S), boxes=(FACE, (110, 40, 150, 90)))
    face_chain: list[int] = []

    async def persist(frame, f, now, **_timing):
        index = s._face_chain_index          # exactly what _persist_face does
        s._face_chain_index += 1
        face_chain.append(index)
        return f"face-{index}", f"cam/x{index}.jpg.enc"

    s._process_arcface = rp.RecordingSession._process_arcface.__get__(s)
    s._persist_face = persist
    s._match_and_alert = AsyncMock()

    async def run():
        await _emit(s, 1)
        await asyncio.gather(*s.arcface_tasks)
        await _emit(s, 9, start=1)
        await asyncio.gather(*s.arcface_tasks)
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    track_chain = sorted(t.chain_index for t in reader.tracks.values())
    assert len(set(track_chain) | set(face_chain)) == len(track_chain) + len(face_chain)
    # BoxEngine reports one identified face at FACE → only track 1 is linked.
    assert reader.tracks[1].face_id == f"face-{face_chain[0]}"
    assert reader.tracks[2].face_id is None
    assert reader.tracks_for_faces([f"face-{face_chain[0]}"]) == {1}


def test_blobs_never_hold_the_other_face(tmp_path):
    other = (95, 30, 145, 90)  # padded boxes overlap
    s = _scripted(tmp_path, ScriptedCache(S), boxes=(FACE, other))

    async def run():
        await _emit(s, 1)
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    rects = {h.track_id: h.inner_rect for h in reader.headers()}
    for blob in reader.iter_blobs([1]):
        img = blob.decode()
        ox1, oy1, ox2, oy2 = rects[2]
        rx1, ry1 = blob.rect[0], blob.rect[1]
        overlap = img[max(oy1, blob.rect[1]) - ry1:min(oy2, blob.rect[3]) - ry1,
                      max(ox1, rx1) - rx1:min(ox2, blob.rect[2]) - rx1]
        assert overlap.size and overlap.mean() < 12


class DetectMasker(rp.FaceMasker):
    """The pipeline's real persistence cache, merge and padding, with
    scripted detections (``script(frame_index) -> boxes``)."""

    def __init__(self, script):
        super().__init__(None, persist_frames=rp.BLUR_PERSIST_FRAMES, pad_ratio=rp.BLUR_PAD_RATIO)
        self.script = script

    def _detect_haar(self, frame):
        return [(tuple(b), "standard") for b in self.script(self.frame_idx - 1)]

    def _detect_insight(self, frame):
        return []


def _moving_frame(i, x0, step, side, w=640, h=240):
    frame = np.full((h, w, 3), 40, np.uint8)
    x = x0 + step * i
    yy, xx = np.mgrid[0:side, 0:side]
    tex = (128 + 100 * np.sin(xx / 5.0) * np.cos(yy / 7.0)).astype(np.uint8)
    frame[60:60 + side, x:x + side] = np.dstack([tex, 255 - tex, tex // 2])
    return frame


def test_a_walking_face_is_one_sealed_track_restorable_on_every_frame(tmp_path):
    """FE-CAP-2 / FE-RQ-1: a face moving 0.6 widths per frame (a lateral walk
    at 15 fps) stays ONE track with one blob per frame; its own old positions
    are painted, never zeroed out of its blob, and restoring the track brings
    the face back on every frame."""
    side, step, frames = 60, 36, 14
    width = 20 + step * frames + side + 20
    s = _session(tmp_path, privacy=ScriptedCache(S))
    s._is_file_mode = True
    asyncio.run(s._refresh_recording_mode())
    s.hls, s.masked_writer = _Proc(), _Proc()
    s._open_face_envelope(width, 240)
    s.masker = DetectMasker(lambda f: [(20 + step * f, 60, 20 + step * f + side, 60 + side)])
    s._draw_kst_timestamp = lambda *a, **k: None
    s._process_arcface = AsyncMock()
    s._row_inserted = True
    originals = [_moving_frame(i, 20, step, side, w=width) for i in range(frames)]

    async def run():
        for i, frame in enumerate(originals):
            await s._emit_frame(i / s.fps, frame)
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    assert list(reader.tracks) == [1] and reader.tracks[1].blobs == frames
    assert reader.painted_count > 0                   # the trail is painted, not sealed
    stored = [np.frombuffer(f, np.uint8).reshape(240, width, 3) for f in s.masked_writer.stdin.frames]
    restored = [f.copy() for f in stored]
    rects = reader.rects_by_frame()
    for blob in reader.iter_blobs([1]):
        img = blob.decode()
        x1, y1 = 20 + step * blob.frame_index, 60
        rx, ry = blob.rect[0], blob.rect[1]
        face = img[y1 - ry:y1 - ry + side, x1 - rx:x1 - rx + side]
        assert (face.max(axis=2) == 0).mean() < 0.05, blob.frame_index   # < 5 % zeroed
        composite(restored[blob.frame_index], blob,
                  exclude=[r for t, r in rects[blob.frame_index] if t != blob.track_id])
    good = 0
    for i in range(frames):
        x1 = 20 + step * i
        diff = np.abs(restored[i][60:60 + side, x1:x1 + side].astype(int)
                      - originals[i][60:60 + side, x1:x1 + side].astype(int)).mean()
        good += diff < 12
    assert good >= int(0.95 * frames), good


def test_a_second_person_on_the_same_path_is_never_sealed_in_the_first_track(tmp_path):
    """FE-CAP-1: Y follows X on the same line 10 frames behind; X's stale
    boxes never take Y's detection, so no blob of X's track holds Y."""
    side, step, frames = 60, 36, 24
    width = 20 + step * frames + side + 20

    def boxes(f):
        out = [(20 + step * f, 60, 20 + step * f + side, 60 + side)]
        if f >= 10:
            out.append((20 + step * (f - 10), 60, 20 + step * (f - 10) + side, 60 + side))
        return out

    s = _session(tmp_path, privacy=ScriptedCache(S))
    s._is_file_mode = True
    asyncio.run(s._refresh_recording_mode())
    s.hls, s.masked_writer = _Proc(), _Proc()
    s._open_face_envelope(width, 240)
    s.masker = DetectMasker(boxes)
    s._draw_kst_timestamp = lambda *a, **k: None
    s._process_arcface = AsyncMock()
    s._row_inserted = True

    async def run():
        for i in range(frames):
            await s._emit_frame(i / s.fps, np.full((240, width, 3), 40, np.uint8))
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    people: dict[int, set[str]] = {}
    for h in reader.headers():
        x = h.inner_rect[0] + int(side * rp.BLUR_PAD_RATIO)
        who = "X" if x == 20 + step * h.frame_index else "Y"
        assert who == "X" or x == 20 + step * (h.frame_index - 10)
        people.setdefault(h.track_id, set()).add(who)
    assert sorted(len(v) for v in people.values()) == [1, 1], people


def test_the_tail_after_the_last_tick_is_decided_by_a_closing_check(tmp_path):
    """FE-CRYPTO-2: frames after the last tick are written only when a closing
    check says standard; private → dropped and covered by a span."""
    s = _scripted(tmp_path, ScriptedCache(S, P))

    async def run():
        await _emit(s, 4)                 # one tick (frame 0, standard); frames 0–3 pending
        await s._finalize_envelope()      # closing check: private
        await s._settle_privacy_spans()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    assert reader.complete and reader.headers() == []
    assert reader.withheld_blobs == 4
    spans = [(sp["start_offset_sec"], sp["end_offset_sec"]) for sp in s.privacy_spans.manifest_spans(s.recording_id)]
    assert spans == [(0.0, 4 / s.fps)]

    s2 = _scripted(tmp_path / "b", ScriptedCache(S))

    async def run2():
        await _emit(s2, 4)
        await s2._finalize_envelope()

    asyncio.run(run2())
    reader = EnvelopeReader(s2.envelope_path, s2.recording_id)
    assert sorted({h.frame_index for h in reader.headers()}) == [0, 1, 2, 3]


def _arcface_session(tmp_path, boxes, cosine):
    s = _scripted(tmp_path, ScriptedCache(S), boxes=boxes)
    s._process_arcface = rp.RecordingSession._process_arcface.__get__(s)
    s._match_and_alert = AsyncMock()
    s.face_memory = rp.SessionFaceMemory(cosine)
    return s


def test_tracks_are_sampled_even_when_the_faces_row_cannot_be_written(tmp_path):
    """FE-CAP-5: a DB / Storage outage during capture loses the faces row,
    not the identity: the track's sealed sample makes it restorable."""
    s = _arcface_session(tmp_path, (FACE,), lambda a, b: 0.0)
    s._persist_face = AsyncMock(side_effect=RuntimeError("recording row unavailable — face not persisted"))

    async def run():
        await _emit(s, 1)
        await asyncio.gather(*s.arcface_tasks)
        await _emit(s, 4, start=1)
        await s._finalize_envelope()

    asyncio.run(run())
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    assert reader.tracks[1].face_id is None
    samples = reader.open_samples()
    assert [f for f, _e in samples[1]] == [0]
    assert np.allclose(samples[1][0][1], np.ones(512, np.float32))


def test_a_weak_dedup_match_does_not_link_a_bystander_to_someone_else(tmp_path):
    """FE-CRYPTO-1: Y's detection is 0.40 like X's memory entry (above
    DEDUP_THRESHOLD, below ALERT_THRESHOLD): no faces row for Y, and Y's track
    is NOT linked to X's face_id — but sampled with Y's own embedding."""
    x_box, y_box = (10, 20, 60, 80), (100, 20, 150, 80)
    emb_x, emb_y = np.eye(512, dtype=np.float32)[0], np.eye(512, dtype=np.float32)[1]

    class TwoPeople:
        cosine = staticmethod(lambda a, b: 1.0 if np.array_equal(a, b) else 0.40)

        def __init__(self):
            self.calls = 0

        def detect_all(self, _jpeg):
            self.calls += 1
            if self.calls == 1:
                return [SimpleNamespace(bbox=x_box, confidence=0.99, embedding=emb_x)]
            return [SimpleNamespace(bbox=y_box, confidence=0.99, embedding=emb_y)]

    s = _arcface_session(tmp_path, (x_box,), TwoPeople.cosine)
    s.engine = TwoPeople()
    s._persist_face = AsyncMock(return_value=("face-x", "cam/x.jpg.enc"))

    async def run():
        await _emit(s, 1)                          # tick 0: X, persisted
        await asyncio.gather(*s.arcface_tasks)
        s.masker.step = lambda frame: [(y_box, 15, "standard")]  # X left; Y arrives
        await _emit(s, 5, start=1)                 # tick at frame 5: Y
        await asyncio.gather(*s.arcface_tasks)
        await s._finalize_envelope()

    asyncio.run(run())
    assert s._persist_face.await_count == 1        # Y matched X's entry: no row for Y
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    by_face = {t.track_id: t.face_id for t in reader.tracks.values()}
    assert by_face == {1: "face-x", 2: None}
    samples = reader.open_samples()
    assert np.array_equal(samples[2][0][1], emb_y) and np.array_equal(samples[1][0][1], emb_x)


def test_a_full_envelope_rotates_the_segment(tmp_path):
    """FE-CAP-4: the envelope never grows past FACE_ENVELOPE_MAX_BYTES."""
    s = _scripted(tmp_path, ScriptedCache(S))
    s._is_file_mode = False
    s.envelope_max_bytes = 20_000
    rotations = []

    async def rotate(source_sec, w, h):
        rotations.append(s.recorded_frames)
        s.recorded_frames = 0
        s._envelope_pending, s._envelope_pending_bytes = [], 0
        s._envelope.abort()
        s.envelope_path = f"{s.envelope_path}.{len(rotations)}"
        s._open_face_envelope(w, h)

    s._rotate_segment = rotate
    s._capture_bounds = lambda sec: (rp.datetime.now(rp.timezone.utc),) * 3
    s._poll_recording_mode = lambda: None
    s.check_capacity = None

    async def run():
        s._last_capacity_check = 1e18
        for i in range(40):
            await s._emit_frame(i / s.fps, _face_frame(i))

    asyncio.run(run())
    assert rotations and all(r > 0 for r in rotations)
    assert s._envelope.bytes_written + s._envelope_pending_bytes < 20_000 + 12_000


def test_behind_real_time_the_stored_video_repeats_the_last_masked_frame(tmp_path):
    """FE-CAP-3: a held frame repeats the previous stored (masked) frame, runs
    no detector, and re-seals the previous crops under its own frame index."""
    s = _scripted(tmp_path, ScriptedCache(S))
    s._lag_guard = True
    steps = []
    real_step = s.masker.step
    s.masker.step = lambda frame: steps.append(1) or real_step(frame)
    holds = iter([False, True, True, False, False])
    s._should_hold = lambda sec, shape, previous=None: next(holds) and previous is not None

    async def run():
        await _emit(s, 5)
        await s._finalize_envelope()

    asyncio.run(run())
    assert len(steps) == 3                              # frames 1 and 2 ran no detector
    stored = _frames(s.masked_writer)
    assert np.array_equal(stored[1], stored[0]) and np.array_equal(stored[2], stored[0])
    reader = EnvelopeReader(s.envelope_path, s.recording_id)
    blobs = {b.frame_index: b for b in reader.iter_blobs([1])}
    assert sorted(blobs) == [0, 1, 2, 3, 4]
    assert blobs[1].jpeg == blobs[0].jpeg == blobs[2].jpeg  # same crop, sealed per frame
    assert blobs[3].jpeg != blobs[0].jpeg


def test_back_in_standard_the_live_hold_never_repeats_a_frame_from_before_the_face_encrypted_segment(tmp_path):
    """FE-REGRESS-3: standard → face_encrypted → standard on one live
    session. The standard live-lag guard repeats _last_masked, which a
    face_encrypted segment never updates; right after switching back (the
    rotation's finalize left the loop behind real time) the HLS must not
    repeat a frame captured before the face_encrypted period."""
    scene = lambda v: np.full((H, W, 3), v, np.uint8)   # noqa: E731
    cache = ModeCache("standard")
    s = _session(tmp_path, mode_cache=cache)
    s._is_file_mode = False
    s._last_capacity_check = 1e18
    s.segment_duration_sec = 10_000
    s.masker.step = lambda frame: []
    s._draw_kst_timestamp = lambda *a, **k: None
    s._process_arcface = AsyncMock()
    s._poll_recording_mode = lambda: None
    s._row_inserted = True
    s._lag_guard = s._lag_measured = True
    s._live_origin = rp.time.monotonic()

    async def run():
        await s._refresh_recording_mode()
        s.hls, s.original_writer = _Proc(), _Proc()
        await s._emit_frame(0.0, scene(10))                  # standard: becomes _last_masked
        cache.mode = "face_encrypted"
        await s._refresh_recording_mode()
        s.masked_writer = _Proc()
        s._open_face_envelope(W, H)
        for i in range(1, 6):
            await s._emit_frame(i / 5, scene(100 + i))
        await s._close_envelope_tail()
        s._envelope.abort()
        cache.mode = "standard"
        await s._refresh_recording_mode()
        s.hls, s.original_writer = _Proc(), _Proc()
        s._lag_baseline = -100.0                             # far behind real time
        await s._emit_frame(6 / 5, scene(200))

    asyncio.run(run())
    live = np.frombuffer(s.hls.stdin.frames[-1], np.uint8).reshape(H, W, 3)
    assert int(live[60, 80, 0]) == 200


# ── end to end (real FFmpeg, spool, delivery) ─────────────────────────
def _clip(path, frames, make):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 15, (make(0).shape[1], make(0).shape[0]))
    assert writer.isOpened()
    for i in range(frames):
        writer.write(make(i))
    writer.release()


def _run_session(s):
    async def run():
        await s.start()
        await s.task
        await s.stop()
    asyncio.run(run())


def _decoded(path):
    cap = cv2.VideoCapture(str(path))
    out = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        out.append(frame)
    cap.release()
    return out


def _restore(masked_frames, reader, track_ids):
    by_frame = reader.rects_by_frame()
    restored = [f.copy() for f in masked_frames]
    for blob in reader.iter_blobs(track_ids):
        others = [r for tid, r in by_frame[blob.frame_index] if tid not in set(track_ids)]
        composite(restored[blob.frame_index], blob, exclude=others)
    return restored


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg binary not available")
def test_end_to_end_delivers_masked_video_and_envelope_and_no_original(tmp_path, capture_spool):
    source = tmp_path / "source.mp4"
    _clip(source, 30, _face_frame)
    storage = CaptureStorage()
    s = _session(tmp_path, storage=storage)
    s.source_url = str(source)
    s._persist_face = AsyncMock(return_value=("face-row-1", "cam/f.jpg.enc"))
    s._match_and_alert = AsyncMock()
    _run_session(s)

    assert s.processing_complete
    row = storage.rows[s.recording_id]
    assert row["capture_status"] == "ready" and row["blur_strategy"] == "face_encrypted"
    assert row["storage_path"] == s.filename_masked and row["storage_path"].endswith("_masked.mp4.enc")
    assert row["face_envelope_path"] == s.filename_envelope and row["face_envelope_path"].endswith("_faces.mfe.enc")
    assert row["original_path"] is None and row["has_original"] is True
    assert set(storage.objects) == {("recordings", s.filename_masked), ("recordings", s.filename_envelope)}
    for key in storage.objects:
        assert storage.objects[key][1] == "application/octet-stream"
    # Nothing plaintext and no original was left on disk.
    assert not [p for p in Path(s.rec_dir).rglob("*") if p.is_file()]

    masked = tmp_path / "masked.mp4"
    masked.write_bytes(crypto_utils.decrypt_bytes(storage.objects[("recordings", s.filename_masked)][0], s.recording_id))
    assert validate_capture(str(masked), s.recorded_frames, 15) == row["duration_sec"]
    reader = EnvelopeReader.from_stored(storage.objects[("recordings", s.filename_envelope)][0], s.recording_id,
                                        s.filename_envelope)
    assert reader.complete and reader.frames == s.recorded_frames == 30
    assert list(reader.tracks) == [1] and reader.tracks[1].face_id == "face-row-1"
    assert reader.tracks[1].blobs == 30

    frames = _decoded(masked)
    x1, y1, x2, y2 = reader.headers()[0].inner_rect
    src = [_face_frame(i) for i in range(30)]
    before = np.mean([np.abs(f[40:80, 60:90].astype(int) - s_[40:80, 60:90].astype(int)).mean()
                      for f, s_ in zip(frames, src)])
    restored = _restore(frames, reader, [1])
    after = np.mean([np.abs(f[40:80, 60:90].astype(int) - s_[40:80, 60:90].astype(int)).mean()
                     for f, s_ in zip(restored, src)])
    print(f"e2e synthetic: masked diff {before:.1f}, restored diff {after:.1f}")
    assert before > 40 and after < 15, (before, after)


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg binary not available")
@pytest.mark.skipif(not (SAMPLES / "00.jpg").exists(), reason="sample face images not present")
def test_end_to_end_with_real_faces(tmp_path, capture_spool, monkeypatch):
    # A fixed master keeps the correlation check deterministic: the cipher
    # cells are a keystream sample, and a random key occasionally lands a
    # pattern whose |r| with one face crosses the bound by chance.
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", bytes(range(32)))
    faces = [cv2.resize(cv2.imread(str(SAMPLES / f"0{i}.jpg")), (640, 480)) for i in range(3)]
    source = tmp_path / "faces.mp4"
    _clip(source, 15, lambda i: faces[(i // 5) % 3])
    storage = CaptureStorage()
    s = _session(tmp_path, storage=storage, engine=SimpleNamespace(cosine=lambda a, b: 0.0))
    s.source_url = str(source)
    s._process_arcface = AsyncMock()
    _run_session(s)

    row = storage.rows[s.recording_id]
    assert row["blur_strategy"] == "face_encrypted" and row["capture_status"] == "ready"
    masked = tmp_path / "masked.mp4"
    masked.write_bytes(crypto_utils.decrypt_bytes(storage.objects[("recordings", s.filename_masked)][0], s.recording_id))
    reader = EnvelopeReader.from_stored(storage.objects[("recordings", s.filename_envelope)][0], s.recording_id)
    assert reader.blob_count >= 15  # Haar found the faces in every frame
    frames = _decoded(masked)
    header = next(h for h in reader.headers() if h.frame_index == 0)
    ix1, iy1, ix2, iy2 = header.inner_rect
    gray = lambda img: cv2.cvtColor(img[iy1 + 2:iy2 - 2, ix1 + 2:ix2 - 2], cv2.COLOR_BGR2GRAY).astype(float).ravel()
    r = np.corrcoef(gray(frames[0]), gray(faces[0]))[0, 1]
    print(f"e2e real faces: blobs {reader.blob_count}, correlation {r:.3f}")
    assert abs(r) < 0.15, r  # the stored face region says nothing about the face
    restored = _restore(frames, reader, list(reader.tracks))
    diff = np.abs(restored[0][iy1:iy2, ix1:ix2].astype(int) - faces[0][iy1:iy2, ix1:ix2].astype(int)).mean()
    print(f"e2e real faces: restored diff {diff:.1f}")
    assert diff < 20, diff


# ── journal / spool / recovery ────────────────────────────────────────
def test_interrupted_face_encrypted_segment_is_discarded_on_recovery(tmp_path, capture_spool):
    storage = CaptureStorage()
    s = _session(tmp_path, storage=storage)
    asyncio.run(s._refresh_recording_mode())
    s._is_file_mode = False
    s._journal_active()
    journal = json.loads(s.journal_path.read_text())
    assert journal["sources"] == [s.masked_path, s.envelope_path]
    assert journal["row"]["blur_strategy"] == "face_encrypted"
    assert journal["row"]["storage_path"] == s.filename_masked
    assert "face_envelope_path" not in journal["row"]
    Path(s.masked_path).write_bytes(b"unfinished masked video")
    s._open_face_envelope(W, H)
    root = str(Path(s.rec_dir).parent)
    asyncio.run(capture_journal.recover_captures(storage, root))
    assert not Path(s.masked_path).exists() and not Path(s.envelope_path).exists()
    assert storage.rows[s.recording_id]["capture_status"] == "partial"


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg binary not available")
def test_validated_journal_recovers_both_artifacts(tmp_path, capture_spool, monkeypatch):
    storage = CaptureStorage()
    s = _session(tmp_path, storage=storage, fps=15)
    s.segment_duration_sec = 120
    s._process_arcface = AsyncMock()
    original_enqueue = capture_spool.enqueue

    async def crash_before_enqueue():
        await s._refresh_recording_mode()
        s._journal_active()
        await s._open_recording_row()
        s._open_segment_writers(W, H)
        for i in range(10):
            await s._emit_frame(i / 15, _face_frame(i))
        await s._close_writers()
        monkeypatch.setattr(capture_spool, "enqueue", Mock(side_effect=OSError("disk interruption")))
        with pytest.raises(OSError):
            await s._finalize()

    asyncio.run(crash_before_enqueue())
    journal = json.loads(s.journal_path.read_text())
    assert journal["state"] == "validated"
    assert [a["path"] for a in journal["artifacts"]] == [s.filename_masked, s.filename_envelope]
    assert journal["row"]["face_envelope_path"] == s.filename_envelope
    monkeypatch.setattr(capture_spool, "enqueue", original_enqueue)
    asyncio.run(capture_journal.recover_captures(storage, str(Path(s.rec_dir).parent)))
    row = storage.rows[s.recording_id]
    assert row["capture_status"] == "ready" and row["face_envelope_path"] == s.filename_envelope
    assert set(storage.objects) == {("recordings", s.filename_masked), ("recordings", s.filename_envelope)}
    reader = EnvelopeReader.from_stored(storage.objects[("recordings", s.filename_envelope)][0], s.recording_id)
    assert reader.complete and reader.frames == 10
    assert not s.journal_path.exists()


def test_placeholder_row_names_no_envelope(tmp_path):
    from storage import SupabaseStorage

    captured = {}

    class Query:
        def upsert(self, row, **_kw):
            captured.update(row)
            return self

        def execute(self):
            return SimpleNamespace(data=[captured])

    storage = SupabaseStorage.__new__(SupabaseStorage)
    storage.client = SimpleNamespace(table=lambda name: Query())
    storage.ensure_recording_placeholder("r1", {"face_envelope_path": "cam/x_faces.mfe.enc", "capture_status": "ready"})
    assert captured["face_envelope_path"] is None and captured["capture_status"] == "capturing"
    captured.clear()
    storage.ensure_recording_placeholder("r2", {"storage_path": "cam/x.mp4.enc"})
    assert "face_envelope_path" not in captured  # standard rows never send the column


def test_old_manifest_without_kind_still_delivers(tmp_path, capture_spool):
    rid = "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f"
    source = tmp_path / "orig.mp4"
    source.write_bytes(b"legacy original bytes" * 100)
    directory = capture_spool.root / rid
    directory.mkdir()
    # Exactly the manifest shape written before ADR 0013.
    manifest = {
        "version": 1, "recording_id": rid, "row": {"capture_status": "ready", "has_original": True},
        "state": "preparing", "attempts": 0, "next_retry_at": 0, "last_error": None,
        "artifacts": [{"source": str(source), "path": "cam/o.mp4.enc", "original": True,
                       "file": "0.enc", "key_context": rid}],
    }
    (directory / "manifest.json").write_text(json.dumps(manifest))
    storage = CaptureStorage()
    assert RecordingSpool(capture_spool.root).deliver(storage, rid) is True
    assert crypto_utils.decrypt_bytes(storage.objects[("recordings", "cam/o.mp4.enc")][0], rid) == \
        b"legacy original bytes" * 100


def test_row_is_ready_only_after_both_uploads(tmp_path, capture_spool):
    rid = "7d8e9f0a-1b2c-4d3e-9f4a-5b6c7d8e9f0a"
    masked, envelope = tmp_path / "m.mp4", tmp_path / "e.mfe"
    masked.write_bytes(b"masked" * 300)
    envelope.write_bytes(b"MFE1envelope" * 30)

    class Flaky(CaptureStorage):
        def upload_bytes(self, bucket, path, payload, content_type):
            if path.endswith(".mfe.enc") and self.failure == "envelope":
                raise ConnectionError("storage outage")
            return super().upload_bytes(bucket, path, payload, content_type)

    storage = Flaky("envelope")
    capture_spool.enqueue(rid, {"capture_status": "ready", "blur_strategy": "face_encrypted"}, [
        {"source": str(masked), "path": "cam/x_masked.mp4.enc", "original": True, "kind": "masked_video"},
        {"source": str(envelope), "path": "cam/x_faces.mfe.enc", "original": True, "kind": "face_envelope"},
    ])
    manifest = json.loads((capture_spool.root / rid / "manifest.json").read_text())
    assert [a["kind"] for a in manifest["artifacts"]] == ["masked_video", "face_envelope"]
    assert capture_spool.deliver(storage, rid, force=True) is False
    assert rid not in storage.rows  # the masked video alone never makes the row ready
    storage.failure = None
    assert RecordingSpool(capture_spool.root).deliver(storage, rid, force=True) is True
    assert storage.rows[rid]["capture_status"] == "ready"
    assert crypto_utils.decrypt_bytes(storage.objects[("recordings", "cam/x_faces.mfe.enc")][0], rid) == \
        b"MFE1envelope" * 30


# ── recording mode per segment ────────────────────────────────────────
@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg binary not available")
def test_a_changed_mode_starts_a_new_segment(tmp_path, capture_spool):
    storage = CaptureStorage()
    cache = ModeCache("standard")
    s = _session(tmp_path, storage=storage, mode_cache=cache, fps=15)
    s.segment_duration_sec = 120
    s._process_arcface = AsyncMock()
    frames = [np.full((96, 128, 3), i, np.uint8) for i in range(40)]

    async def run():
        await s._refresh_recording_mode()
        assert s.blur_strategy == "on_demand"
        s._journal_active()
        await s._open_recording_row()
        s._open_segment_writers(128, 96)
        first = s.recording_id
        for i in range(20):
            if i == 10:
                cache.mode = "face_encrypted"   # admin tightened the camera
            await s._emit_frame(i / 15, frames[i])
        assert s.recording_id != first and s.blur_strategy == "face_encrypted"
        for i in range(20, 40):
            await s._emit_frame(i / 15, frames[i])
        await s._close_writers()
        await s._finalize()
        return first

    first = asyncio.run(run())
    RecordingSpool(capture_spool.root).retry_due(storage)
    old, new = storage.rows[first], storage.rows[s.recording_id]
    # Frames 0–15 (the mode is noticed at the tick of frame 15) stay standard.
    assert old["blur_strategy"] == "on_demand" and old["original_path"] and old["duration_sec"] == 16 / 15
    assert new["blur_strategy"] == "face_encrypted" and new["original_path"] is None
    assert new["face_envelope_path"] == s.filename_envelope and new["duration_sec"] == 24 / 15


def test_uploads_without_a_camera_always_record_standard(tmp_path):
    s = rp.RecordingSession(
        camera_id="upload_1234", camera_name=None, source_url="/tmp/x.mp4", engine=BoxEngine(),
        storage=CaptureStorage(), hls_dir=str(tmp_path / "h"), recordings_dir=str(tmp_path / "r"),
        db_camera_id=None, recording_mode_cache=ModeCache(),
    )
    assert asyncio.run(s._refresh_recording_mode()) == "standard"
    assert s.blur_strategy in ("on_demand", "baked")


def test_unreadable_mode_keeps_the_segment_recording(tmp_path):
    class Broken:
        async def mode_for(self, _cid):
            raise ConnectionError("db down")

        def peek(self, _cid):
            raise ConnectionError("db down")

    s = _session(tmp_path, mode_cache=Broken())
    # Never read: the stricter mode (no raw original only because the
    # setting could not be read).
    assert asyncio.run(s._refresh_recording_mode()) == "face_encrypted"
    s.recording_mode, s._recording_mode_known = "standard", True
    assert asyncio.run(s._refresh_recording_mode()) == "standard"  # last known
    s._poll_recording_mode()
    assert s._mode_rotation_due is False


def test_active_sessions_report_the_recording_mode():
    from camera_worker import CameraManager, CameraSupervision
    from tests.test_privacy_pipeline import _DoneTask, _LiveTask

    mgr = CameraManager.__new__(CameraManager)
    mgr._next_tick_at = None
    live = SimpleNamespace(task=_LiveTask(), camera_name="Gate", recording_mode="face_encrypted",
                           stopped_by_user=False, exit_reason=None, live_lag_sec=0.734, held_frames=12)
    dropped = SimpleNamespace(task=_DoneTask(), camera_name="Yard", recording_mode="face_encrypted",
                              stopped_by_user=False, exit_reason="source dropped (no frames)")
    mgr.sessions = {"a": live, "c": dropped}
    mgr.supervision = {"c": CameraSupervision(url="rtsp://h/s")}
    (row,) = mgr.active_sessions()
    assert row["recording_mode"] == "face_encrypted"
    assert row["live_lag_sec"] == 0.73 and row["held_frames"] == 12
    (row,) = mgr.reconnecting_sessions()
    assert row["recording_mode"] is None  # not capturing → unknown
