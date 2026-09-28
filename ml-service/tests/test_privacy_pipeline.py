"""Privacy schedule enforcement in the capture pipeline (ADR 0012).

`private` ticks create no ArcFace task (no embeddings, face rows, crops,
matching or alerts) while masking is untouched; the capture-time spans are
persisted off the event loop, survive a missing recording row and DB errors,
and follow segment rotation and finalize.
"""
from __future__ import annotations

import asyncio
import base64
import os
import secrets
import shutil
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())

import numpy as np  # noqa: E402
import pytest  # noqa: E402

import recording_pipeline as rp  # noqa: E402
from camera_worker import CameraManager, CameraSupervision  # noqa: E402
from privacy_schedule import PrivacySpanNotFound  # noqa: E402
from tests.test_capture_integrity import CaptureStorage, capture_spool  # noqa: E402,F401

CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
P = ("private", "schedule")
PF = ("private", "fail_closed")
S = ("standard", "schedule")


class _Engine:
    def detect_all(self, _b):
        return []

    @staticmethod
    def cosine(a, b):
        return 0.0


class _Stdin:
    def __init__(self):
        self.frames: list[bytes] = []
        self.closed = False

    def write(self, data):
        self.frames.append(data)


class _Proc:
    def __init__(self):
        self.stdin = _Stdin()

    def poll(self):
        return None


class ScriptedCache:
    """Answers from a script (the last entry repeats); records every call as
    ``(camera_id, start, end)`` — ``mode_at`` is a range of one instant."""

    def __init__(self, *modes):
        self.modes = list(modes)
        self.calls = []

    async def mode_during(self, camera_id, start, end):
        self.calls.append((camera_id, start, end))
        return self.modes.pop(0) if len(self.modes) > 1 else self.modes[0]

    async def mode_at(self, camera_id, at):
        return await self.mode_during(camera_id, at, at)


class SpanStorage:
    """recording_privacy_spans with the FK to recordings enforced."""

    client = None

    def __init__(self):
        self.rows: set[str] = set()
        self.spans: dict[int, dict] = {}
        self.calls: list[tuple] = []
        self.fail_next = 0

    def _maybe_fail(self):
        if self.fail_next:
            self.fail_next -= 1
            raise ConnectionError("database offline")

    def open_privacy_span(self, recording_id, start_offset_sec, source, client_span_id=None):
        self.calls.append(("open", recording_id, start_offset_sec, source))
        self._maybe_fail()
        if recording_id not in self.rows:
            raise RuntimeError("insert violates foreign key constraint")
        return self._upsert(recording_id, client_span_id, start_offset_sec, source)

    def _upsert(self, recording_id, client_span_id, start, source, end=None):
        """ON CONFLICT (client_span_id) DO UPDATE — never clears an end."""
        for span_id, row in self.spans.items():
            if client_span_id and row.get("client_span_id") == client_span_id:
                row.update(recording_id=recording_id, start_offset_sec=start, source=source)
                if end is not None:
                    row["end_offset_sec"] = end
                return span_id
        span_id = len(self.spans) + 1
        self.spans[span_id] = {
            "recording_id": recording_id, "start_offset_sec": start,
            "end_offset_sec": end, "source": source, "client_span_id": client_span_id,
        }
        return span_id

    # Spool delivery (ADR 0012: spans travel with their segment).
    def ensure_recording_placeholder(self, recording_id, _fields):
        self.calls.append(("placeholder", recording_id))
        self.rows.add(recording_id)

    def upsert_privacy_spans(self, recording_id, spans):
        self.calls.append(("deliver_spans", recording_id, len(spans)))
        for span in spans:
            self._upsert(recording_id, span["client_span_id"], span["start_offset_sec"],
                         span["source"], span["end_offset_sec"])

    def close_privacy_span(self, span_id, end_offset_sec):
        self.calls.append(("close", span_id, end_offset_sec))
        self._maybe_fail()
        if span_id not in self.spans:
            raise PrivacySpanNotFound(span_id)
        self.spans[span_id]["end_offset_sec"] = end_offset_sec

    def table(self):
        return sorted(
            (s["recording_id"], s["start_offset_sec"], s["end_offset_sec"], s["source"])
            for s in self.spans.values()
        )


def _session(tmp_path, cache, storage, *, camera_id=CAM, fps=1):
    s = rp.RecordingSession(
        camera_id=camera_id, camera_name="Gate", source_url="rtsp://10.0.0.9/live",
        engine=_Engine(), storage=storage,
        hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"), fps=fps,
        privacy_cache=cache,
    )
    s._is_file_mode = True  # no capacity probe / rotation unless a test enables it
    s.blur_strategy = "on_demand"
    s.hls = _Proc()
    s.original_writer = _Proc()
    s.masker.mask = lambda frame: np.full_like(frame, 7)
    s._draw_kst_timestamp = lambda *a, **k: None
    s._process_arcface = AsyncMock()
    s._row_inserted = True
    storage.rows.add(s.recording_id)
    return s


async def _emit(s, count, *, start=0, drain=True):
    for i in range(start, start + count):
        await s._emit_frame(i / s.fps, np.full((8, 8, 3), 200, dtype=np.uint8))
        task = s.privacy_spans.task
        if drain and task is not None and not task.done():
            await task


@pytest.fixture(autouse=True)
def _fast_retry(monkeypatch):
    monkeypatch.setattr(rp, "PRIVACY_SPAN_RETRY_SEC", 0.0)


# ── per-tick mode ─────────────────────────────────────────────────────
def test_private_ticks_create_no_arcface_task_and_one_span(tmp_path):
    cache = ScriptedCache(S, S, P, P, S)
    storage = SpanStorage()
    s = _session(tmp_path, cache, storage)

    async def run():
        await _emit(s, 5)
        await s._settle_privacy_spans()

    asyncio.run(run())
    # Recognition only on the standard ticks (offsets 0, 1, 4).
    assert [c.kwargs["source_offset_sec"] for c in s._process_arcface.call_args_list] == [0.0, 1.0, 4.0]
    # Masking is identical in both modes: every live frame masked, every
    # original frame written.
    assert len(s.hls.stdin.frames) == 5 and len(s.original_writer.stdin.frames) == 5
    assert all(set(np.frombuffer(f, dtype=np.uint8).tolist()) == {7} for f in s.hls.stdin.frames)
    # Evaluated per tick at the frame's CAPTURE time, for the DB camera id
    # (file mode: the source clock is all there is — a range of one instant).
    assert [c[0] for c in cache.calls] == [CAM] * 5
    assert [c[1] for c in cache.calls] == [s.capture_started_at + timedelta(seconds=i) for i in range(5)]
    assert all(c[1] == c[2] for c in cache.calls)
    # Entered at tick 2 → opened at the previous tick (1.0); left at tick 4.
    assert storage.table() == [(s.recording_id, 1.0, 4.0, "schedule")]
    assert s.privacy_mode == "standard"


def test_mode_reaches_the_masker_before_the_tick_frame_is_masked(tmp_path):
    # fps 2 → ticks on frames 0 and 2; the flag seen by each mask call must be
    # the mode of the latest tick INCLUDING the frame being masked.
    s = _session(tmp_path, ScriptedCache(P, S), SpanStorage(), fps=2)
    seen = []

    def spy(frame):
        seen.append(s.masker.embeddings_allowed)
        return np.full_like(frame, 7)

    s.masker.mask = spy

    async def run():
        await _emit(s, 4)

    asyncio.run(run())
    # Frame 0 of a private session is masked without identification.
    assert seen == [False, False, True, True]
    assert s._process_arcface.call_count == 1  # only the standard tick (frame 2)


def test_standard_camera_and_cameraless_sessions_are_unchanged(tmp_path):
    cache = ScriptedCache(S)
    storage = SpanStorage()
    s = _session(tmp_path, cache, storage)
    upload_cache = ScriptedCache(P)
    upload = _session(tmp_path / "u", upload_cache, SpanStorage(), camera_id="upload_1234abcd")

    async def run():
        await _emit(s, 3)
        await _emit(upload, 3)

    asyncio.run(run())
    assert s._process_arcface.call_count == 3 and upload._process_arcface.call_count == 3
    assert storage.calls == [] and s.privacy_mode == "standard"
    # No DB camera (browser upload) → standard without asking the cache.
    assert upload_cache.calls == [] and upload.privacy_mode == "standard"


def test_span_opens_at_segment_start_and_closes_at_finalize(tmp_path):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P), storage)

    async def run():
        await _emit(s, 3)
        assert storage.table() == [(s.recording_id, 0.0, None, "schedule")]  # open while capturing
        assert s.privacy_mode == "private"
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert s._process_arcface.call_count == 0
    assert storage.table() == [(s.recording_id, 0.0, 3.0, "schedule")]


def test_fail_closed_tick_marks_the_span_before_it_is_persisted(tmp_path):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P, PF, S), storage)
    s._row_inserted = False  # nothing can be written yet

    async def run():
        await _emit(s, 3)
        assert storage.calls == []
        s._row_inserted = True
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert storage.table() == [(s.recording_id, 0.0, 2.0, "fail_closed")]


def test_fail_closed_tick_after_persistence_covers_the_whole_stretch(tmp_path):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P, PF, S), storage)

    async def run():
        await _emit(s, 3)
        await s._settle_privacy_spans()

    asyncio.run(run())
    # The 'schedule' row was already written; a fail_closed replacement covers
    # the same start, so the stretch reads as fail_closed.
    assert storage.table() == [
        (s.recording_id, 0.0, 1.0, "schedule"),
        (s.recording_id, 0.0, 2.0, "fail_closed"),
    ]


def test_spans_wait_for_the_recording_row_then_flush(tmp_path):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P), storage)
    s._row_inserted = False
    storage.rows.clear()

    async def run():
        await _emit(s, 2)
        assert storage.calls == []  # the current segment's row does not exist yet
        assert s.privacy_spans.has_work()
        # Row inserted later (e.g. by a face persist retry or finalize).
        s._row_inserted = True
        storage.rows.add(s.recording_id)
        await _emit(s, 1, start=2)
        assert storage.table() == [(s.recording_id, 0.0, None, "schedule")]

    asyncio.run(run())


def test_db_errors_are_retried_and_never_stop_the_recording(tmp_path):
    storage = SpanStorage()
    storage.fail_next = 2
    s = _session(tmp_path, ScriptedCache(P, P, P, S), storage)

    async def run():
        await _emit(s, 4)
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert len(s.original_writer.stdin.frames) == 4
    assert storage.table() == [(s.recording_id, 0.0, 3.0, "schedule")]
    assert [c[0] for c in storage.calls].count("open") == 3  # two failures, then success


def test_unpersistable_spans_are_reported_at_stop(tmp_path, caplog):
    storage = SpanStorage()
    storage.fail_next = 10**6
    s = _session(tmp_path, ScriptedCache(P), storage)

    async def run():
        await _emit(s, 2)
        await s._settle_privacy_spans()

    with caplog.at_level("WARNING", logger="mongolz-ml.recording"):
        asyncio.run(run())
    assert "not persisted" in caplog.text and s.recording_id in caplog.text


def test_vanished_recording_drops_its_span(tmp_path):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P, P, S), storage)

    async def run():
        await _emit(s, 1)
        storage.spans.clear()  # recording deleted → spans cascaded away
        await _emit(s, 2, start=1)
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert not s.privacy_spans.has_work()


def test_a_malformed_response_is_retried_not_dropped(tmp_path):
    storage = SpanStorage()
    real_open = storage.open_privacy_span
    answers = iter([KeyError("id")])

    def flaky_open(*args):
        error = next(answers, None)
        if error is not None:
            raise error  # e.g. a response without "id" — not "span gone"
        return real_open(*args)

    storage.open_privacy_span = flaky_open
    s = _session(tmp_path, ScriptedCache(P, P, S), storage)

    async def run():
        await _emit(s, 3)
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert storage.table() == [(s.recording_id, 0.0, 2.0, "schedule")]


def test_rotation_closes_and_reopens_spans_per_segment(tmp_path, monkeypatch):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P), storage)
    first = s.recording_id
    s._is_file_mode = False
    s.segment_duration_sec = 3
    monkeypatch.setattr(rp, "check_capture_capacity", lambda *a, **k: None)
    monkeypatch.setattr(rp, "get_recording_spool", lambda: SimpleNamespace(root=str(tmp_path)))
    monkeypatch.setattr(rp, "_ffmpeg_mp4_writer", lambda *a, **k: _Proc())
    s._close_writers = AsyncMock()
    s._finalize = AsyncMock()
    s._journal_active = Mock()
    ids = [first]
    attempts = []

    async def open_row():
        # The second segment's row cannot be inserted (DB blip that outlasts
        # it); its spans wait, and the flush keeps retrying the insert.
        if s.recording_id not in ids:
            ids.append(s.recording_id)
        attempts.append(s.recording_id)
        s._row_inserted = s.recording_id != ids[1] if len(ids) > 1 else True
        if s._row_inserted:
            storage.rows.add(s.recording_id)

    s._open_recording_row = open_row

    async def run():
        await _emit(s, 7)  # segments: 3 frames, 3 frames, 1 frame
        # The second segment's span waits for its row; the others are written.
        assert storage.table() == sorted([
            (ids[0], 0.0, 3.0, "schedule"),
            (ids[2], 0.0, None, "schedule"),
        ], key=lambda row: row[0])
        storage.rows.add(ids[1])  # spool delivered the second segment's row
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert len(ids) == 3
    # In private mode no ArcFace task retries the row insert — the span
    # flush does (rotation's attempt + at least one flush retry).
    assert attempts.count(ids[1]) >= 2
    assert storage.table() == sorted([
        (ids[0], 0.0, 3.0, "schedule"),
        (ids[1], 0.0, 3.0, "schedule"),
        (ids[2], 0.0, 1.0, "schedule"),
    ])
    assert s._process_arcface.call_count == 0


def test_span_flush_retries_a_failed_row_insert_in_private_mode(tmp_path):
    storage = SpanStorage()
    s = _session(tmp_path, ScriptedCache(P), storage)
    s._row_inserted = False
    storage.rows.clear()
    inserts = []

    async def insert_recording_returning_id(*, recording_id, **_row):
        inserts.append(recording_id)
        if len(inserts) == 1:
            raise ConnectionError("database offline")
        storage.rows.add(recording_id)
        return recording_id

    storage.insert_recording_returning_id = insert_recording_returning_id

    async def run():
        await _emit(s, 3)
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert s._row_inserted is True
    assert inserts[:2] == [s.recording_id, s.recording_id]
    assert storage.table() == [(s.recording_id, 0.0, 3.0, "schedule")]


def test_lost_open_response_does_not_orphan_an_open_row(tmp_path):
    # The first INSERT commits but its response is lost: the retry is an
    # upsert on the span's client id, so no row is left open forever.
    storage = SpanStorage()
    real_open = storage.open_privacy_span
    lost = []

    def open_then_lose(*args):
        span_id = real_open(*args)
        if not lost:
            lost.append(span_id)
            raise TimeoutError("response lost after commit")
        return span_id

    storage.open_privacy_span = open_then_lose
    s = _session(tmp_path, ScriptedCache(S, P, P, S), storage)

    async def run():
        await _emit(s, 4)
        await s._settle_privacy_spans()

    asyncio.run(run())
    assert storage.table() == [(s.recording_id, 0.0, 3.0, "schedule")]


# ── capture clock (ADR 0012: the capture instant is only known within a bound)
def _live(tmp_path, cache, storage, monkeypatch):
    s = _session(tmp_path, cache, storage)
    s._is_file_mode = False
    s.segment_duration_sec = 10_000
    monkeypatch.setattr(rp, "check_capture_capacity", lambda *a, **k: None)
    monkeypatch.setattr(rp, "get_recording_spool", lambda: SimpleNamespace(root=str(tmp_path)))
    return s


def test_live_ticks_are_judged_over_source_clock_to_wall_clock(tmp_path, monkeypatch):
    cache = ScriptedCache(S)
    s = _live(tmp_path, cache, SpanStorage(), monkeypatch)
    # __init__ ran long before the first frame (suspect load, warm-up, open):
    # the stale anchor stamps frames early — the bound reaches up to `now`.
    s.capture_started_at = rp.datetime.now(rp.timezone.utc) - timedelta(seconds=40)
    asyncio.run(_emit(s, 1))
    (camera, lower, upper), = cache.calls
    estimate = s.capture_started_at
    now = rp.datetime.now(rp.timezone.utc)
    assert camera == CAM
    assert lower == estimate - timedelta(seconds=rp.PRIVACY_CLOCK_MARGIN_SEC)
    assert now - timedelta(seconds=2) <= upper <= now


def test_start_of_a_private_window_is_never_identified_with_a_stale_anchor(tmp_path, monkeypatch):
    """The clock_demo scenario with the real cache and a real window: the
    private window opened at the start of the current minute, but the stale
    anchor stamps the frame 10 s before it — the source-clock estimate alone
    says standard. The wall-clock end of the bound makes the tick private."""
    from privacy_schedule import SCHEDULE_TZ, CameraSchedule, PrivacyScheduleCache, Window, mode_at

    local = rp.datetime.now(rp.timezone.utc).astimezone(SCHEDULE_TZ).replace(second=0, microsecond=0)
    after = local + timedelta(minutes=1)
    end = "24:00" if after.date() != local.date() else after.strftime("%H:%M")
    schedule = CameraSchedule("standard", (Window("private", local.strftime("%H:%M"), end, 127),))
    cache = PrivacyScheduleCache(SimpleNamespace(load_privacy_schedule=lambda _cid: schedule))
    s = _live(tmp_path, cache, SpanStorage(), monkeypatch)
    s.capture_started_at = local.astimezone(rp.timezone.utc) - timedelta(seconds=10)

    assert mode_at(schedule, s.capture_started_at) == "standard"  # what the old code evaluated
    asyncio.run(_emit(s, 1))
    assert (s.privacy_mode, s.privacy_source) == ("private", "schedule")
    s._process_arcface.assert_not_called()


def test_source_open_and_rotation_reanchor_the_capture_clock(tmp_path, monkeypatch):
    s = _live(tmp_path, ScriptedCache(S), SpanStorage(), monkeypatch)
    stale = rp.datetime.now(rp.timezone.utc) - timedelta(seconds=90)
    s.capture_started_at = s.started_at = stale
    s.live_lag_sec = 0.5
    s._reanchor_capture_clock(12.0)
    now = rp.datetime.now(rp.timezone.utc)
    # Frame at source time 12 s is captured "now minus the live lag".
    estimate = s.capture_started_at + timedelta(seconds=12.0)
    assert now - timedelta(seconds=1.5) <= estimate <= now - timedelta(seconds=0.5)

    monkeypatch.setattr(rp, "_ffmpeg_mp4_writer", lambda *a, **k: _Proc())
    s._close_writers = AsyncMock()
    s._finalize = AsyncMock()
    s._journal_active = Mock()
    s._open_recording_row = AsyncMock()
    s.capture_started_at = stale
    asyncio.run(s._rotate_segment(30.0, 8, 8))
    now = rp.datetime.now(rp.timezone.utc)
    # The new segment's started_at is the wall-clock estimate of its frame 0,
    # not the drifted source clock.
    assert now - timedelta(seconds=2) <= s.started_at <= now


def test_capture_bound_wider_than_the_schedule_pad_is_logged(tmp_path, monkeypatch, caplog):
    s = _live(tmp_path, ScriptedCache(S), SpanStorage(), monkeypatch)
    monkeypatch.setattr(rp, "PRIVACY_SCHEDULE_PAD_SEC", 10.0)
    s.capture_started_at = rp.datetime.now(rp.timezone.utc) - timedelta(seconds=120)
    # A freshly booted host (CI runners, a new container) has a small
    # time.monotonic(); the first warning must still be logged.
    real_time = rp.time
    monkeypatch.setattr(rp, "time", SimpleNamespace(
        monotonic=lambda: 5.0, time=real_time.time, sleep=real_time.sleep,
        perf_counter=real_time.perf_counter,
    ))
    with caplog.at_level("WARNING", logger="mongolz-ml.recording"):
        asyncio.run(_emit(s, 1))
    assert "exceeds PRIVACY_SCHEDULE_PAD_SEC" in caplog.text
    assert s.capture_clock_bound_sec >= 120


# The rotation re-anchor must not assume the rotation frame is captured "now"
# when "now" is after the old segment's finalize, nor that the loop has no
# backlog when frames are never held (baked rollback, demo). Both stamped the
# next segment late: its ticks were judged standard for frames captured in a
# private window, and the reveal's schedule backstop moved with started_at.
# The wall clock and the monotonic clock (the backlog measurement) advance
# together here, as they do in production.
_BUSINESS = ("09:00", "18:00")            # private window, KST, every day
_WINDOW_END = rp.datetime(2026, 9, 15, 9, 0, tzinfo=rp.timezone.utc)  # 18:00 KST


class _Clock:
    def __init__(self, wall):
        self.wall = wall
        self.mono = 5_000.0

    def advance(self, sec):
        self.wall += timedelta(seconds=sec)
        self.mono += sec


def _clocked(tmp_path, monkeypatch, clock, *, blur_strategy="on_demand", demo=False, segment_sec=3):
    from privacy_schedule import CameraSchedule, PrivacyScheduleCache, Window

    real_datetime = rp.datetime

    class FakeDatetime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return clock.wall if tz is not None else clock.wall.replace(tzinfo=None)

    monkeypatch.setattr(rp, "datetime", FakeDatetime)
    monkeypatch.setattr(rp, "time", SimpleNamespace(monotonic=lambda: clock.mono, time=lambda: 0.0))
    monkeypatch.setattr(rp, "_ffmpeg_mp4_writer", lambda *a, **k: _Proc())
    schedule = CameraSchedule("standard", (Window("private", *_BUSINESS, 127),))
    cache = PrivacyScheduleCache(SimpleNamespace(load_privacy_schedule=lambda _cid: schedule), clock=lambda: 0.0)
    storage = SpanStorage()
    s = _live(tmp_path, cache, storage, monkeypatch)
    s.segment_duration_sec = segment_sec
    s.blur_strategy = blur_strategy
    if blur_strategy == "baked":
        s.blurred_writer = _Proc()
    # What _run sets for a live (or demo) source.
    s._lag_guard = not demo
    s._lag_measured = True
    s._live_origin = clock.mono
    s._close_writers = AsyncMock()
    s._journal_active = Mock()

    async def open_row():
        s._row_inserted = True
        storage.rows.add(s.recording_id)

    s._open_recording_row = open_row
    s._reanchor_capture_clock(0.0)  # the source opens: frame 0 is captured now
    s.started_at = s.capture_started_at
    return s, schedule


def test_rotation_anchor_is_taken_before_the_finalize_stall(tmp_path, monkeypatch):
    """_finalize (ArcFace drain, full-decode validation, encryption) blocks
    the loop for longer than PRIVACY_CLOCK_MARGIN_SEC while a private window
    ends; the source buffers frames meanwhile and the loop drains them right
    after. Every frame was captured inside the window."""
    from privacy_schedule import mode_at

    stall = rp.PRIVACY_CLOCK_MARGIN_SEC + 7
    t0 = _WINDOW_END - timedelta(seconds=8)
    clock = _Clock(t0)
    s, schedule = _clocked(tmp_path, monkeypatch, clock)

    async def slow_finalize(**_kw):
        s._privacy_close_segment()
        clock.advance(stall)

    s._finalize = slow_finalize
    starts = {}

    async def run():
        for i in range(8):
            captured = t0 + timedelta(seconds=i)
            if clock.wall < captured:
                clock.advance((captured - clock.wall).total_seconds())  # read in real time
            else:
                clock.advance(0.05)  # buffered during the stall, drained now
            await s._emit_frame(float(i), np.full((8, 8, 3), 200, dtype=np.uint8))
            starts.setdefault(s.recording_id, (i, s.started_at))

    asyncio.run(run())
    assert all(mode_at(schedule, t0 + timedelta(seconds=i)) == "private" for i in range(8))
    s._process_arcface.assert_not_called()
    assert (s.privacy_mode, s.privacy_source) == ("private", "schedule")
    assert len(starts) == 3  # two rotations, the second one in the drained backlog
    for first, started_at in starts.values():
        # started_at is the capture instant of the segment's frame 0.
        assert abs((started_at - (t0 + timedelta(seconds=first))).total_seconds()) < 0.01, (first, started_at)


@pytest.mark.parametrize("blur_strategy,demo", [("baked", False), ("on_demand", True)])
def test_rotation_anchor_counts_the_backlog_of_sources_that_never_hold(tmp_path, monkeypatch, blur_strategy, demo):
    """Baked mode (the documented rollback) masks every frame and never
    holds; a demo source is paced, not held. A 90 s processing backlog —
    longer than the reveal's 60 s schedule pad — must still be measured, so
    the rotated segments are stamped at their real capture instants."""
    from privacy_protection import load_protected_timeline
    from privacy_schedule import mode_at

    backlog = rp.PRIVACY_SCHEDULE_PAD_SEC + 30
    t0 = _WINDOW_END - timedelta(seconds=100)
    clock = _Clock(t0)
    s, schedule = _clocked(tmp_path, monkeypatch, clock, blur_strategy=blur_strategy, demo=demo, segment_sec=5)

    async def finalize(**_kw):
        s._privacy_close_segment()

    s._finalize = finalize
    starts = {}

    async def run():
        for i in range(40):
            lag = backlog if i >= 5 else 0.0  # the loop fell 90 s behind after frame 4
            clock.advance((t0 + timedelta(seconds=i + lag) - clock.wall).total_seconds())
            await s._emit_frame(float(i), np.full((8, 8, 3), 200, dtype=np.uint8))
            starts.setdefault(s.recording_id, (i, s.started_at))

    asyncio.run(run())
    assert all(mode_at(schedule, t0 + timedelta(seconds=i)) == "private" for i in range(40))
    s._process_arcface.assert_not_called()
    assert s.live_lag_sec == pytest.approx(backlog, abs=0.01)
    no_spans = SimpleNamespace(list_privacy_spans=lambda _rid: [])
    strict = SimpleNamespace(schedule_strict=lambda _cid: schedule)
    assert len(starts) == 8
    for rid, (first, started_at) in starts.items():
        assert abs((started_at - (t0 + timedelta(seconds=first))).total_seconds()) < 0.01, (first, started_at)
        # The reveal/view schedule backstop alone (no spans) covers the
        # segment, because it is placed from started_at.
        timeline = load_protected_timeline(no_spans, strict, rid, CAM, started_at, 5.0)
        assert all(timeline.covers(k + 0.5) for k in range(5)), (first, started_at)


def test_capture_rotation_and_stop_persist_spans_end_to_end(tmp_path, capture_spool):
    """Real encoders, spool and finalize: 35 frames at 15 fps with 1 s
    segments → three recordings, each fully covered by a closed span."""
    assert shutil.which("ffmpeg"), "Capture tests require the service's FFmpeg dependency"

    class Storage(CaptureStorage, SpanStorage):
        def __init__(self):
            CaptureStorage.__init__(self)
            self.spans, self.calls, self.fail_next = {}, [], 0

        def open_privacy_span(self, recording_id, start_offset_sec, source, client_span_id=None):
            self.calls.append(("open", recording_id, start_offset_sec, source))
            if recording_id not in self.rows:
                raise RuntimeError("insert violates foreign key constraint")
            return self._upsert(recording_id, client_span_id, start_offset_sec, source)

        def ensure_recording_placeholder(self, recording_id, fields):
            self.calls.append(("placeholder", recording_id))
            if recording_id not in self.rows:
                self.rows[recording_id] = {**fields, "capture_status": "capturing", "has_original": False}

        def upsert_privacy_spans(self, recording_id, spans):
            # Spans land BEFORE the row is marked ready.
            assert self.rows[recording_id]["capture_status"] != "ready"
            SpanStorage.upsert_privacy_spans(self, recording_id, spans)

    storage = Storage()
    session = rp.RecordingSession(
        CAM, "Gate", "unopened-live-source", SimpleNamespace(cosine=lambda a, b: 0), storage,
        str(tmp_path / "hls"), str(tmp_path / "volume" / "captures"), privacy_cache=ScriptedCache(P),
    )
    session._process_arcface = AsyncMock()
    recordings = []

    async def run():
        session._journal_active()
        await session._open_recording_row()
        session._source_opened = True
        session.original_writer = rp._ffmpeg_mp4_writer(session.original_path, 128, 96, 15)
        for i in range(35):
            if session.recording_id not in recordings:
                recordings.append(session.recording_id)
            await session._emit_frame(i / 15, np.full((96, 128, 3), i, dtype=np.uint8))
        await session.stop()

    asyncio.run(run())
    capture_spool.retry_due(storage)  # the background delivery of rotated segments
    assert len(recordings) == 3
    assert all(storage.rows[r]["capture_status"] == "ready" for r in recordings)
    assert storage.table() == sorted([
        (recordings[0], 0.0, 1.0, "schedule"),
        (recordings[1], 0.0, 1.0, "schedule"),
        (recordings[2], 0.0, pytest.approx(5 / 15), "schedule"),
    ])
    session._process_arcface.assert_not_called()


# ── /camera/active ────────────────────────────────────────────────────
class _LiveTask:
    def done(self):
        return False


class _DoneTask:
    def done(self):
        return True

    def exception(self):
        return None


def test_camera_active_reports_privacy_mode(tmp_path):
    mgr = CameraManager.__new__(CameraManager)
    mgr._next_tick_at = None
    private = SimpleNamespace(task=_LiveTask(), camera_name="Lobby", privacy_mode="private",
                              privacy_source="fail_closed", stopped_by_user=False, exit_reason=None)
    unknown = SimpleNamespace(task=_LiveTask(), camera_name="Gate", stopped_by_user=False, exit_reason=None)
    dropped = SimpleNamespace(task=_DoneTask(), camera_name="Yard", privacy_mode="private",
                              stopped_by_user=False, exit_reason="source dropped (no frames)")
    mgr.sessions = {"a": private, "b": unknown, "c": dropped}
    mgr.supervision = {"c": CameraSupervision(url="rtsp://h/s")}
    active = {row["camera_id"]: (row["privacy_mode"], row["privacy_source"]) for row in mgr.active_sessions()}
    # The source tells the UI WHY recognition is off (fail_closed ≠ schedule).
    assert active == {"a": ("private", "fail_closed"), "b": (None, None)}
    (row,) = mgr.reconnecting_sessions()
    assert row["camera_id"] == "c" and row["privacy_mode"] is None and row["privacy_source"] is None
