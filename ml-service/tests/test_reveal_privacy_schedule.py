"""Reveal job × privacy schedules (ADR 0012).

Footage captured while its camera was in `private` mode is never revealed:

  • protected stretches = recording_privacy_spans (open span → until the end)
    ∪ the camera's current schedule over [started_at, started_at + duration)
  • a span or schedule read failure fails the job closed (nothing decrypted)
  • protected end to end (or the whole requested range) → refused before any
    decryption or target unsealing
  • while rendering, a protected frame is never matched — no embedding, not
    even in the masker — and every face on it stays masked
  • the schedule part is widened by PRIVACY_SCHEDULE_PAD_SEC (the pipeline
    only knows a live frame's capture instant within a bound); most tests
    here pin the pad to 0 to check the exact arithmetic
  • refusals say WHY: captured in privacy mode (spans — final) vs covered by
    the camera's current schedule (released again if loosened)
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import cv2
import numpy as np
import pytest

import face_masker
import privacy_protection
import privacy_schedule
import reveal_job
from privacy_schedule import CameraSchedule, PrivacyScheduleCache, PrivacyScheduleUnavailable, Window
from reveal_job import (
    PRIVACY_SCHEDULE_WHOLE_RANGE_MSG,
    PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG,
    PRIVACY_UNAVAILABLE_MSG,
    PRIVACY_WHOLE_RANGE_MSG,
    PRIVACY_WHOLE_RECORDING_MSG,
    ProtectedTimeline,
    RevealProcessor,
    RevealRenderError,
    _span_offsets,
)
from tests.test_reveal_job import (
    JOB_ID,
    RECORDING_ID,
    FakeDB,
    FakeStorage,
    _job_row,
    _make_clip,
    needs_ffmpeg,
)

CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
# 17:59:50 KST, Monday 2026-09-28: a 09:00–18:00 private window ends 10 s in.
STARTED = datetime(2026, 9, 28, 8, 59, 50, tzinfo=timezone.utc)
BUSINESS_HOURS_PRIVATE = CameraSchedule("standard", (Window("private", "09:00", "18:00", 127),))
ALWAYS_PRIVATE = CameraSchedule("private")
STANDARD_ONLY = CameraSchedule("standard", (Window("standard", "08:00", "20:00", 127),))


@pytest.fixture(autouse=True)
def _exact_schedule(monkeypatch):
    """Pin the schedule pad to 0 so offsets are exact (the pad has its own tests)."""
    monkeypatch.setattr(privacy_protection, "PRIVACY_SCHEDULE_PAD_SEC", 0.0)


class ScheduleStorage:
    """``load_privacy_schedule`` stand-in for an injected PrivacyScheduleCache."""

    def __init__(self, schedule: CameraSchedule | None = None, error: Exception | None = None):
        self.schedule = schedule
        self.error = error
        self.reads: list[str] = []

    def load_privacy_schedule(self, camera_id: str) -> CameraSchedule | None:
        self.reads.append(camera_id)
        if self.error:
            raise self.error
        return self.schedule


def _span(start, end=None, source="schedule", recording_id=RECORDING_ID) -> dict:
    return {"recording_id": recording_id, "start_offset_sec": start, "end_offset_sec": end, "source": source}


def _processor(schedule_storage: ScheduleStorage | None = None, spans: list[dict] | None = None):
    storage = FakeStorage(FakeDB(_job_row(), None, b""))
    storage.spans = list(spans or [])
    cache = PrivacyScheduleCache(schedule_storage) if schedule_storage is not None else None
    return RevealProcessor(Mock(), storage, privacy_cache=cache), storage


def test_reveal_masker_blacks_out_bystanders_on_detector_outage():
    class BrokenEngine:
        def detect_all(self, _jpeg):
            raise RuntimeError("detector offline")

    processor = RevealProcessor(BrokenEngine(), SimpleNamespace(client=Mock()))
    frame = np.full((120, 120, 3), 200, dtype=np.uint8)
    output = processor._selective_blur(frame, keep_boxes=[(20, 20, 80, 80)])
    assert not np.any(output)


# ── 1. timeline arithmetic ─────────────────────────────────────────────
class TestProtectedTimeline:
    def test_half_open_intervals_and_open_span(self):
        t = ProtectedTimeline(intervals=((2.0, 4.0), (10.0, math.inf)))
        assert [t.covers(x) for x in (1.99, 2.0, 3.99, 4.0, 9.99, 10.0, 1e6)] == [
            False, True, True, False, False, True, True,
        ]

    def test_beyond_horizon_the_schedule_is_evaluated_directly(self):
        # Row said 5 s, file is longer: frames past the horizon are still judged.
        t = ProtectedTimeline(intervals=(), schedule=ALWAYS_PRIVATE, started_at=STARTED, horizon_sec=5.0)
        assert t.covers(4.9) is False  # inside the horizon only `intervals` count
        assert t.covers(5.0) is True
        t = ProtectedTimeline(schedule=BUSINESS_HOURS_PRIVATE, started_at=STARTED)
        assert t.covers(9.9) is True   # 17:59:59.9 KST
        assert t.covers(10.0) is False  # 18:00 KST — end exclusive

    def test_covers_range(self):
        t = ProtectedTimeline(intervals=((0.0, 4.0), (4.0, 10.0), (12.0, 20.0)))
        assert t.covers_range(0.0, 10.0) is True
        assert t.covers_range(0.0, 10.0, end_inclusive=True) is False  # 10.0 itself is not covered
        assert t.covers_range(0.0, 11.0) is False                     # gap [10, 12)
        assert t.covers_range(12.0, 15.0, end_inclusive=True) is True
        assert t.covers_range(5.0, 5.0) is False                      # empty: nothing to refuse
        assert t.covers_range(6.0, 3.0) is False
        assert ProtectedTimeline(intervals=((1.0, math.inf),)).covers_range(0.0, 5.0) is False
        assert ProtectedTimeline(intervals=((0.0, math.inf),)).covers_range(0.0, 5.0) is True

    @pytest.mark.parametrize(
        "row,expected",
        [
            (_span(0.0, 4.5), (0.0, 4.5)),
            (_span(3, None), (3.0, math.inf)),
            (_span("1.5", "2.5"), (1.5, 2.5)),
        ],
    )
    def test_span_rows(self, row, expected):
        assert _span_offsets(row) == expected

    @pytest.mark.parametrize(
        "row",
        [_span(None), _span(-1.0), _span(4.0, 4.0), _span(4.0, 3.0), _span(True), _span(float("nan")),
         _span(1.0, "x"), "not-a-row"],
    )
    def test_span_rows_the_db_would_not_allow_are_rejected(self, row):
        with pytest.raises(ValueError):
            _span_offsets(row)


# ── 2. loading the protected stretches ─────────────────────────────────
class TestLoadProtection:
    def test_current_consent_gate_protects_old_recording_without_capture_spans(self):
        proc, _ = _processor(ScheduleStorage(CameraSchedule("standard", consent_required=True)))
        timeline = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 30.0)
        assert timeline.intervals == ((0.0, 30.0),)
        assert timeline.covers_range(0.0, 30.0)

    def test_upload_without_camera_uses_spans_only(self):
        schedules = ScheduleStorage(ALWAYS_PRIVATE)
        proc, storage = _processor(schedules, spans=[_span(1.0, 2.0), _span(5.0), _span(0.0, 1.0, recording_id="other")])
        t = proc._load_privacy_protection(RECORDING_ID, None, STARTED, 30.0)
        assert t.intervals == ((1.0, 2.0), (5.0, math.inf))
        assert t.schedule is None
        assert schedules.reads == []  # no camera → no schedule read at all
        assert storage.span_reads == [RECORDING_ID]

    def test_spans_union_schedule_as_video_offsets(self):
        schedules = ScheduleStorage(BUSINESS_HOURS_PRIVATE)
        proc, _ = _processor(schedules, spans=[_span(20.0, 25.0), _span(8.0, 12.0, "fail_closed")])
        t = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 30.0)
        # schedule: private until 18:00 KST = offset 10 s; merged with [8, 12).
        assert t.intervals == ((0.0, 12.0), (20.0, 25.0))
        assert t.horizon_sec == 30.0
        assert schedules.reads == [CAM]

    def test_default_private_minus_standard_window(self):
        # Default private, standard 18:00–20:00: only the first 10 s (before
        # 18:00 KST) are private within a 60 s recording.
        schedule = CameraSchedule("private", (Window("standard", "18:00", "20:00", 127),))
        proc, _ = _processor(ScheduleStorage(schedule))
        t = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 60.0)
        assert t.intervals == ((0.0, 10.0),)

    def test_overnight_window_of_the_previous_day(self):
        # Fri 22:00–06:00 covers Sat 02:00 KST (2026-09-25T17:00Z).
        schedule = CameraSchedule("standard", (Window("private", "22:00", "06:00", 32),))
        proc, _ = _processor(ScheduleStorage(schedule))
        started = datetime(2026, 9, 25, 17, 0, tzinfo=timezone.utc)
        assert proc._load_privacy_protection(RECORDING_ID, CAM, started, 120.0).intervals == ((0.0, 120.0),)
        started_fri = datetime(2026, 9, 24, 17, 0, tzinfo=timezone.utc)  # 02:00 KST Fri → standard
        assert proc._load_privacy_protection(RECORDING_ID, CAM, started_fri, 120.0).intervals == ()

    def test_camera_without_cameras_row_or_standard_only_schedule(self):
        for schedule in (None, STANDARD_ONLY):
            proc, _ = _processor(ScheduleStorage(schedule), spans=[_span(3.0, 4.0)])
            t = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 30.0)
            assert t.intervals == ((3.0, 4.0),)
            assert t.schedule is None

    def test_unknown_duration_judges_every_frame_by_the_schedule(self):
        proc, _ = _processor(ScheduleStorage(BUSINESS_HOURS_PRIVATE))
        t = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, None)
        assert t.intervals == () and t.horizon_sec == 0.0
        assert t.covers(0.0) and t.covers(9.99) and not t.covers(10.0)

    @pytest.mark.parametrize(
        "setup",
        ["span_error", "span_malformed", "span_bad_row", "no_span_reader", "schedule_error"],
    )
    def test_any_read_failure_is_unavailable(self, setup):
        schedules = ScheduleStorage(BUSINESS_HOURS_PRIVATE)
        proc, storage = _processor(schedules, spans=[_span(1.0, 2.0)])
        if setup == "span_error":
            storage.span_error = ConnectionError("database down")
        elif setup == "span_malformed":
            storage.list_privacy_spans = lambda _rid: None
        elif setup == "span_bad_row":
            storage.spans = [_span(5.0, 1.0)]
        elif setup == "no_span_reader":
            proc.storage = SimpleNamespace(client=storage.client)
        else:
            schedules.error = ConnectionError("database down")
        with pytest.raises(PrivacyScheduleUnavailable):
            proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 30.0)

    def test_the_schedule_part_is_padded_on_both_sides(self, monkeypatch):
        # Private until 18:00 KST = offset 10 s; a 60 s pad protects [0, 70).
        # Spans are never padded: they are the pipeline's recorded decision.
        monkeypatch.setattr(privacy_protection, "PRIVACY_SCHEDULE_PAD_SEC", 60.0)
        proc, _ = _processor(ScheduleStorage(BUSINESS_HOURS_PRIVATE), spans=[_span(200.0, 210.0)])
        t = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 300.0)
        assert t.intervals == ((0.0, 70.0), (200.0, 210.0))
        assert t.spans == ((200.0, 210.0),)
        # A window that opens after the capture ends still reaches back into
        # it: a 60 s recording from 08:58:30 KST (ends 08:59:30) is protected
        # from 08:59:00 (09:00 - 60 s) = offset 30 s.
        started = datetime(2026, 9, 27, 23, 58, 30, tzinfo=timezone.utc)
        t = proc._load_privacy_protection(RECORDING_ID, CAM, started, 60.0)
        assert t.intervals == ((30.0, 180.0), (200.0, 210.0))

    def test_frames_beyond_the_horizon_are_judged_with_the_pad(self, monkeypatch):
        monkeypatch.setattr(privacy_protection, "PRIVACY_SCHEDULE_PAD_SEC", 60.0)
        proc, _ = _processor(ScheduleStorage(BUSINESS_HOURS_PRIVATE))
        t = proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, None)
        assert t.covers(69.9) is True    # 18:00:59.9 KST — within the pad
        assert t.covers(70.1) is False

    def test_unreadable_start_time_refuses_only_when_the_schedule_matters(self):
        proc, _ = _processor(ScheduleStorage(BUSINESS_HOURS_PRIVATE))
        with pytest.raises(PrivacyScheduleUnavailable, match="start time"):
            proc._load_privacy_protection(RECORDING_ID, CAM, None, 30.0)
        proc, _ = _processor(ScheduleStorage(STANDARD_ONLY))
        assert proc._load_privacy_protection(RECORDING_ID, CAM, None, 30.0).intervals == ()

    def test_default_is_the_process_wide_cache_and_it_fails_closed_before_init(self, monkeypatch):
        monkeypatch.setattr(privacy_schedule, "_cache", None)
        proc, _ = _processor()  # no injected cache
        with pytest.raises(PrivacyScheduleUnavailable):
            proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 30.0)
        installed = privacy_schedule.init_privacy_schedule_cache(ScheduleStorage(ALWAYS_PRIVATE))
        assert proc._privacy_schedule_cache() is installed
        assert proc._load_privacy_protection(RECORDING_ID, CAM, STARTED, 30.0).intervals == ((0.0, 30.0),)


# ── 3. refusal before decryption ───────────────────────────────────────
class TestRefusal:
    def test_whole_recording(self):
        t = ProtectedTimeline(intervals=((0.0, 12.0), (12.0, math.inf)))
        assert RevealProcessor._privacy_refusal(t, 30.0, None, None) == PRIVACY_WHOLE_RECORDING_MSG

    def test_schedule_only_coverage_says_so(self):
        # Spans cover [0, 12); the current schedule covers the rest: not
        # "captured in privacy mode" — withheld while the window exists.
        t = ProtectedTimeline(intervals=((0.0, math.inf),), span_intervals=((0.0, 12.0),))
        assert RevealProcessor._privacy_refusal(t, 30.0, None, None) == PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG
        assert RevealProcessor._privacy_refusal(t, 30.0, 2.0, 9.0) == PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG
        t = ProtectedTimeline(intervals=((0.0, 20.0),), span_intervals=((0.0, 5.0),))
        assert RevealProcessor._privacy_refusal(t, 30.0, 1.0, 4.0) == PRIVACY_WHOLE_RANGE_MSG
        assert RevealProcessor._privacy_refusal(t, 30.0, 1.0, 15.0) == PRIVACY_SCHEDULE_WHOLE_RANGE_MSG

    def test_messages_carry_stable_codes_for_the_web(self):
        codes = [m.split("]")[0] + "]" for m in (
            PRIVACY_UNAVAILABLE_MSG, PRIVACY_WHOLE_RECORDING_MSG, PRIVACY_WHOLE_RANGE_MSG,
            PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG, PRIVACY_SCHEDULE_WHOLE_RANGE_MSG,
        )]
        assert codes == [
            "[privacy_unavailable]", "[privacy_whole_recording]", "[privacy_whole_range]",
            "[privacy_schedule_whole_recording]", "[privacy_schedule_whole_range]",
        ]

    def test_whole_requested_range(self):
        t = ProtectedTimeline(intervals=((0.0, 10.0),))
        assert RevealProcessor._privacy_refusal(t, 30.0, 2.0, 9.5) == PRIVACY_WHOLE_RANGE_MSG
        # The render keeps t <= target_end in scope: 10.0 itself is standard.
        assert RevealProcessor._privacy_refusal(t, 30.0, 2.0, 10.0) is None
        # A range running past the end only needs coverage up to the end.
        t = ProtectedTimeline(intervals=((20.0, math.inf),))
        assert RevealProcessor._privacy_refusal(t, 30.0, 25.0, 99.0) == PRIVACY_WHOLE_RANGE_MSG

    def test_partial_or_unknown_length_is_not_refused(self):
        t = ProtectedTimeline(intervals=((0.0, 29.0),))
        assert RevealProcessor._privacy_refusal(t, 30.0, None, None) is None
        assert RevealProcessor._privacy_refusal(ProtectedTimeline(intervals=((0.0, math.inf),)), None, None, None) is None
        assert RevealProcessor._privacy_refusal(ProtectedTimeline(), 30.0, None, None) is None


# ── 4. rendering: protected frames are never matched and stay masked ───
FACE = (100, 60, 180, 150)  # x1, y1, x2, y2 in a 320x240 clip
FPS = 15


class FaceBoxEngine:
    """One face per frame. ``detect_all`` = full recognition (embedding that
    matches every target); ``detect_boxes`` = the detector alone (ADR 0012)."""

    def __init__(self):
        self.calls: list[str] = []

    def detect_all(self, _jpeg):
        self.calls.append("detect_all")
        return [SimpleNamespace(bbox=FACE, confidence=0.99, embedding=np.ones(512, np.float32))]

    def detect_boxes(self, _jpeg):
        self.calls.append("detect_boxes")
        return [SimpleNamespace(bbox=FACE, confidence=0.99)]

    @staticmethod
    def cosine(_a, _b) -> float:
        return 1.0


class CollectingEncoder:
    """ffmpeg stand-in that keeps every raw BGR frame written to it."""

    def __init__(self):
        self.frames: list[bytes] = []
        self.stdin = self

    def write(self, data: bytes) -> int:
        self.frames.append(bytes(data))
        return len(data)

    def close(self) -> None:
        pass

    def wait(self, timeout=None) -> int:
        return 0

    def terminate(self) -> None:
        pass

    kill = terminate


@pytest.fixture
def render_rig(tmp_path, monkeypatch):
    """A 30-frame clip, a collecting encoder, Haar off (the engine's box is
    the only face), and a record of what each frame went through."""
    src = str(tmp_path / "in.mp4")
    _make_clip(src, frames=30, fps=FPS)
    encoder = CollectingEncoder()
    monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(return_value=encoder))
    monkeypatch.setattr(reveal_job, "verify_rendered_video", lambda *a, **k: None)
    monkeypatch.setattr(face_masker.FaceMasker, "_detect_haar", lambda self, frame: [])
    engine = FaceBoxEngine()
    proc = RevealProcessor(engine, SimpleNamespace(client=Mock()))
    record = SimpleNamespace(matches=0, frames=[])

    real_find = proc._find_target_boxes
    real_blur = proc._selective_blur

    def find(frame, targets, threshold):
        record.matches += 1
        return real_find(frame, targets, threshold)

    def blur(frame, keep, *, identify=True):
        record.frames.append({"keep": list(keep), "identify": identify, "engine_calls": len(engine.calls)})
        return real_blur(frame, keep, identify=identify)

    proc._find_target_boxes = find
    proc._selective_blur = blur

    def decoded_input() -> list[np.ndarray]:
        cap = cv2.VideoCapture(src)
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()
        return frames

    def run(protection, **kwargs):
        return proc._process_video(
            input_mp4=src, output_mp4=str(tmp_path / "out.mp4"),
            target_embeddings=[np.ones(512, np.float32)], threshold=0.45, job_id=JOB_ID,
            protection=protection, **kwargs,
        )

    return SimpleNamespace(proc=proc, engine=engine, encoder=encoder, record=record, run=run,
                           decoded_input=decoded_input)


def _face_region(frame: np.ndarray) -> np.ndarray:
    x1, y1, x2, y2 = FACE
    return frame[y1:y2, x1:x2]


def test_protected_frames_skip_matching_and_stay_masked(render_rig, caplog):
    # Frames 15..29 (t >= 1.0 s) were captured in privacy mode.
    caplog.set_level(logging.INFO, logger="mongolz-ml.reveal")
    render_rig.run(ProtectedTimeline(intervals=((0.99, math.inf),)))

    frames = render_rig.record.frames
    assert len(frames) == 30
    # Matching ran on frames 0 and 10 only — never on a protected frame.
    assert render_rig.record.matches == 2
    for i, f in enumerate(frames):
        protected = i >= 15
        assert f["identify"] is (not protected), i
        assert (f["keep"] == []) is protected, i  # boxes from frame 10 are not carried over
    # No recognition model ran from the first protected frame on; the masker
    # placed its boxes with the detector alone.
    calls_after = render_rig.engine.calls[frames[15]["engine_calls"]:]
    assert "detect_all" not in calls_after
    assert "detect_boxes" in calls_after

    # Pixels: the target stays revealed before 1 s, is masked from 1 s on.
    source = render_rig.decoded_input()
    h, w = source[0].shape[:2]
    out = [np.frombuffer(b, np.uint8).reshape(h, w, 3) for b in render_rig.encoder.frames]
    for i in range(30):
        same = np.array_equal(_face_region(out[i]), _face_region(source[i]))
        assert same is (i < 15), i
    assert "15 frame(s) ≈ 1.0s withheld" in caplog.text


def test_matching_resumes_on_the_first_standard_frame(render_rig):
    # Frames 3..7 protected; frame 8 re-matches instead of waiting for frame 10.
    render_rig.run(ProtectedTimeline(intervals=((0.19, 0.5),)))
    frames = render_rig.record.frames
    assert render_rig.record.matches == 4  # frames 0, 8, 10, 20
    assert [i for i, f in enumerate(frames) if not f["identify"]] == [3, 4, 5, 6, 7]
    assert all(f["keep"] for i, f in enumerate(frames) if i not in (3, 4, 5, 6, 7))


def test_without_protection_nothing_changes(render_rig):
    render_rig.run(None)
    assert render_rig.record.matches == 3  # frames 0, 10, 20 — the legacy cadence
    assert all(f["identify"] and f["keep"] for f in render_rig.record.frames)


def test_render_that_reveals_nothing_is_refused(render_rig, tmp_path):
    with pytest.raises(RevealRenderError) as exc:
        render_rig.run(ProtectedTimeline(intervals=((0.0, math.inf),)))
    assert str(exc.value) == PRIVACY_WHOLE_RECORDING_MSG
    assert render_rig.record.matches == 0
    assert not (tmp_path / "out.mp4").exists()


def test_render_refusal_names_the_schedule_when_spans_do_not_cover(render_rig):
    with pytest.raises(RevealRenderError) as exc:
        render_rig.run(ProtectedTimeline(intervals=((0.0, math.inf),), span_intervals=((0.0, 0.5),)))
    assert str(exc.value) == PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG


def test_time_bounded_render_refused_when_its_whole_range_is_protected(render_rig):
    with pytest.raises(RevealRenderError) as exc:
        render_rig.run(ProtectedTimeline(intervals=((0.0, 1.0),)), target_start_sec=0.1, target_end_sec=0.6)
    assert str(exc.value) == PRIVACY_WHOLE_RANGE_MSG


# ── 5. the job: fail closed, refuse before decrypt ─────────────────────
@pytest.fixture
def job_rig(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    _make_clip(str(source))  # 8 frames @ 15 fps ≈ 0.53 s
    db = FakeDB(_job_row(), {"original_path": "rec.mp4", "has_original": True}, source.read_bytes())
    downloads: list[str] = []

    def download(path):
        downloads.append(path)
        return db.blob

    db.storage = SimpleNamespace(from_=lambda _bucket: SimpleNamespace(download=download))
    storage = FakeStorage(db)
    schedules = ScheduleStorage(None)
    proc = RevealProcessor(Mock(detect_all=Mock(return_value=[]), cosine=Mock(return_value=0.0)),
                           storage, privacy_cache=PrivacyScheduleCache(schedules))
    return SimpleNamespace(proc=proc, db=db, storage=storage, schedules=schedules, downloads=downloads)


def _refuses_before_decrypt(rig, monkeypatch):
    monkeypatch.setattr(reveal_job, "decrypt_bytes", Mock(side_effect=AssertionError("decrypted")))
    monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(side_effect=AssertionError("rendered")))
    rig.proc._collect_targets = Mock(side_effect=AssertionError("targets unsealed"))
    rig.proc._collect_targets_sealed = Mock(side_effect=AssertionError("targets unsealed"))


def _camera_recording(rig, **fields):
    rec = {"camera_id": CAM, "started_at": STARTED.isoformat(), "duration_sec": 30.0}
    rec.update(fields)
    rig.db.job["recordings"] = {**rig.db.job["recordings"], **rec}


@pytest.mark.asyncio
async def test_open_span_over_the_whole_recording_is_refused_before_decrypt(job_rig, monkeypatch):
    _refuses_before_decrypt(job_rig, monkeypatch)
    job_rig.db.job["recordings"]["duration_sec"] = 0.533
    job_rig.storage.spans = [_span(0.0, None, "fail_closed")]

    await job_rig.proc.run(JOB_ID)

    assert job_rig.db.job["status"] == "failed"
    assert job_rig.db.job["error_message"] == PRIVACY_WHOLE_RECORDING_MSG
    assert job_rig.downloads == []
    assert job_rig.storage.uploads == []


@pytest.mark.asyncio
async def test_schedule_private_for_the_whole_capture_is_refused_before_decrypt(job_rig, monkeypatch):
    _refuses_before_decrypt(job_rig, monkeypatch)
    _camera_recording(job_rig, duration_sec=8.0)  # 17:59:50–17:59:58 KST, all private
    job_rig.schedules.schedule = BUSINESS_HOURS_PRIVATE

    await job_rig.proc.run(JOB_ID)

    # No spans: the CURRENT schedule withholds it (released again if loosened).
    assert job_rig.db.job["error_message"] == PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG
    assert job_rig.schedules.reads == [CAM]
    assert job_rig.downloads == []


@pytest.mark.asyncio
async def test_protected_requested_range_is_refused_before_decrypt(job_rig, monkeypatch):
    _refuses_before_decrypt(job_rig, monkeypatch)
    _camera_recording(job_rig)
    job_rig.schedules.schedule = BUSINESS_HOURS_PRIVATE  # offsets [0, 10) private
    job_rig.db.job.update(target_start_sec=2.0, target_end_sec=8.0)

    await job_rig.proc.run(JOB_ID)

    assert job_rig.db.job["error_message"] == PRIVACY_SCHEDULE_WHOLE_RANGE_MSG
    assert job_rig.downloads == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["spans", "schedule"])
async def test_unreadable_spans_or_schedule_fail_closed(job_rig, monkeypatch, failure):
    _refuses_before_decrypt(job_rig, monkeypatch)
    _camera_recording(job_rig)
    if failure == "spans":
        job_rig.storage.span_error = ConnectionError("database down")
    else:
        job_rig.schedules.error = ConnectionError("database down")

    await job_rig.proc.run(JOB_ID)

    assert job_rig.db.job["status"] == "failed"
    assert job_rig.db.job["error_message"] == PRIVACY_UNAVAILABLE_MSG
    assert job_rig.downloads == []
    assert job_rig.storage.uploads == []


@pytest.mark.asyncio
async def test_retry_after_the_outage_reads_again(job_rig, monkeypatch):
    """Nothing is cached from a failed read: the next attempt re-reads."""
    _camera_recording(job_rig)
    job_rig.schedules.error = ConnectionError("database down")
    await job_rig.proc.run(JOB_ID)
    assert job_rig.db.job["error_message"] == PRIVACY_UNAVAILABLE_MSG
    job_rig.schedules.error = None
    job_rig.schedules.schedule = ALWAYS_PRIVATE
    job_rig.db.job.update(status="queued", worker_attempts=0)
    _refuses_before_decrypt(job_rig, monkeypatch)
    await job_rig.proc.run(JOB_ID)
    assert job_rig.schedules.reads == [CAM, CAM]
    assert job_rig.db.job["error_message"] == PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG


@pytest.mark.asyncio
async def test_without_duration_the_render_still_refuses_a_fully_protected_video(job_rig, monkeypatch):
    # No duration_sec → no pre-decrypt verdict; every frame is withheld and the
    # empty "reveal" is refused before anything is uploaded.
    monkeypatch.setattr(reveal_job.subprocess, "Popen", Mock(return_value=CollectingEncoder()))
    job_rig.storage.spans = [_span(0.0)]

    await job_rig.proc.run(JOB_ID)

    assert job_rig.downloads == ["rec.mp4"]
    assert job_rig.db.job["status"] == "failed"
    assert job_rig.db.job["error_message"] == PRIVACY_WHOLE_RECORDING_MSG
    assert job_rig.storage.uploads == []


@needs_ffmpeg
@pytest.mark.asyncio
async def test_partially_protected_recording_completes_with_the_stretch_withheld(job_rig, caplog):
    caplog.set_level(logging.INFO, logger="mongolz-ml.reveal")
    _camera_recording(job_rig, duration_sec=8 / 15)
    job_rig.schedules.schedule = STANDARD_ONLY
    job_rig.storage.spans = [_span(0.19, 0.4)]  # frames 3..5

    await job_rig.proc.run(JOB_ID)

    assert job_rig.db.job["status"] == "completed", job_rig.db.job.get("error_message")
    assert len(job_rig.storage.uploads) == 1
    assert "3 frame(s) ≈ 0.2s withheld" in caplog.text


@pytest.mark.asyncio
async def test_existing_guards_still_come_first(job_rig, monkeypatch):
    """4-eyes / lease: an unapproved job is never even inspected for privacy."""
    job_rig.db.job["approved_by"] = None
    _camera_recording(job_rig)
    await job_rig.proc.run(JOB_ID)
    assert job_rig.db.job["status"] == "queued"
    assert job_rig.storage.span_reads == [] and job_rig.schedules.reads == []
