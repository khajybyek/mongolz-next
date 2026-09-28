"""Privacy spans travel with their segment (ADR 0012).

A span used to live only in the session's memory until a live write
succeeded; a session that ended during a database outage lost it while the
spool later delivered the footage — spanless, so a later loosening of the
schedule made footage captured in private mode revealable. Now:

  * finalize puts the segment's spans into the validated capture journal and
    the spool manifest;
  * the spool delivery upserts them (keyed by client_span_id) BEFORE the row
    becomes ready (has_original / capture_status='ready'), and keeps the
    delivery pending when they cannot be written;
  * journal recovery hands them to the spool again.
"""
from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest

import capture_journal
import recording_pipeline as rp
from tests.test_capture_integrity import CaptureStorage, capture_spool  # noqa: F401
from tests.test_privacy_pipeline import CAM, P, ScriptedCache, SpanStorage
from tests.test_recording_spool import ORIGINAL, FakeStorage, spool  # noqa: F401

SPAN = {"client_span_id": "5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11", "start_offset_sec": 0.0,
        "end_offset_sec": 2.5, "source": "fail_closed"}


class OrderedStorage(FakeStorage):
    """Records the order of delivery writes; spans need the row to exist."""

    def __init__(self, failure=None):
        super().__init__(failure)
        self.events: list[str] = []
        self.spans: dict[str, dict] = {}

    def ensure_recording_placeholder(self, recording_id, fields):
        self.events.append("placeholder")
        self.rows.setdefault(recording_id, {**fields, "capture_status": "capturing", "has_original": False})

    def upsert_privacy_spans(self, recording_id, spans):
        self.events.append("spans")
        if self.failure == "spans":
            raise ConnectionError("span table unavailable")
        assert self.rows[recording_id]["capture_status"] != "ready"
        for span in spans:
            self.spans[span["client_span_id"]] = {**span, "recording_id": recording_id}

    def commit_recording_delivery(self, recording_id, fields):
        self.events.append("commit")
        super().commit_recording_delivery(recording_id, fields)


def _enqueue(spool, tmp_path, recording_id, spans):
    source = tmp_path / "original.mp4"
    source.write_bytes(ORIGINAL)
    row = {"capture_status": "ready", "has_original": True, "camera_id": CAM}
    spool.enqueue(recording_id, row, [{"source": str(source), "path": "cam/x.mp4.enc", "original": True}],
                  privacy_spans=spans)


def test_delivery_writes_spans_before_the_row_is_ready(spool, tmp_path):
    storage = OrderedStorage()
    rid = "8b3c4d5e-6f70-4a81-9c92-b4d5e6f7a802"
    _enqueue(spool, tmp_path, rid, [SPAN])
    manifest = json.loads((spool.root / rid / "manifest.json").read_text())
    assert manifest["privacy_spans"] == [SPAN]

    assert spool.deliver(storage, rid) is True
    assert storage.events == ["placeholder", "spans", "commit"]
    assert storage.spans[SPAN["client_span_id"]]["end_offset_sec"] == 2.5
    assert storage.rows[rid]["capture_status"] == "ready"


def test_unwritable_spans_keep_the_delivery_pending(spool, tmp_path):
    storage = OrderedStorage(failure="spans")
    rid = "8b3c4d5e-6f70-4a81-9c92-b4d5e6f7a803"
    _enqueue(spool, tmp_path, rid, [SPAN])
    assert spool.deliver(storage, rid) is False
    assert "commit" not in storage.events  # never ready without its spans
    assert spool.has_pending(rid)
    storage.failure = None
    assert spool.deliver(storage, rid, force=True) is True
    assert storage.events[-3:] == ["placeholder", "spans", "commit"]


def test_a_span_write_that_keeps_failing_never_re_uploads_the_segment(spool, tmp_path, caplog):
    """ML deployed before migration 20260928100000 (or the migration rolled
    back): the span table is missing, every live tick fails closed, every
    segment carries a span, and every delivery attempt fails at the span
    write. The spans are written before the uploads, so a retry costs one
    database call — not a re-upload of the whole segment — and the log says
    why the footage is held."""
    storage = OrderedStorage(failure="spans")
    rid = "8b3c4d5e-6f70-4a81-9c92-b4d5e6f7a805"
    _enqueue(spool, tmp_path, rid, [SPAN])
    with caplog.at_level("ERROR", logger="mongolz-ml.recording-spool"):
        for _ in range(5):
            assert spool.deliver(storage, rid, force=True) is False
    assert storage.uploads == 0
    assert "commit" not in storage.events and spool.has_pending(rid)
    assert "privacy spans could not be written" in caplog.text
    assert "20260928100000" in caplog.text
    manifest = json.loads((spool.root / rid / "manifest.json").read_text())
    assert manifest["last_stage"] == "privacy_spans"
    # The migration lands: one upload, spans before the row is ready.
    storage.failure = None
    assert spool.deliver(storage, rid, force=True) is True
    assert storage.uploads == 1
    assert storage.events[-3:] == ["placeholder", "spans", "commit"]
    assert storage.rows[rid]["capture_status"] == "ready"


def test_segments_without_spans_deliver_exactly_as_before(spool, tmp_path):
    storage = OrderedStorage()
    rid = "8b3c4d5e-6f70-4a81-9c92-b4d5e6f7a804"
    _enqueue(spool, tmp_path, rid, None)
    assert "privacy_spans" not in json.loads((spool.root / rid / "manifest.json").read_text())
    assert spool.deliver(storage, rid) is True
    assert storage.events == ["commit"]


def test_journal_recovery_hands_the_spans_to_the_spool(capture_spool, tmp_path):
    rid = "8b3c4d5e-6f70-4a81-9c92-b4d5e6f7a805"
    source = tmp_path / "volume" / "captures" / "cam" / f"{rid}_original.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(ORIGINAL)
    capture_journal.write_journal(source.parent / f"{rid}.capture.json", {
        "state": "validated", "recording_id": rid,
        "row": {"capture_status": "ready", "has_original": True, "camera_id": CAM},
        "artifacts": [{"source": str(source), "path": "cam/x.mp4.enc", "original": True}],
        "privacy_spans": [SPAN],
    })
    storage = OrderedStorage()
    asyncio.run(capture_journal.recover_captures(storage, str(tmp_path / "volume" / "captures")))
    assert storage.events == ["placeholder", "spans", "commit"]
    assert list(storage.spans) == [SPAN["client_span_id"]]


def test_spans_survive_a_session_whose_live_writes_never_succeed(tmp_path, capture_spool):
    """Real encoders, spool and finalize. The span table rejects every live
    write (outage), the session stops, and the queued delivery still writes
    the spans — before each row becomes ready."""
    assert shutil.which("ffmpeg"), "Capture tests require the service's FFmpeg dependency"

    class Storage(CaptureStorage, SpanStorage):
        def __init__(self):
            CaptureStorage.__init__(self)
            self.spans, self.calls, self.fail_next = {}, [], 0

        def open_privacy_span(self, *args, **kwargs):
            raise ConnectionError("span table unavailable")

        def close_privacy_span(self, *args, **kwargs):
            raise ConnectionError("span table unavailable")

        def ensure_recording_placeholder(self, recording_id, fields):
            self.rows.setdefault(recording_id, {**fields, "capture_status": "capturing"})

        def upsert_privacy_spans(self, recording_id, spans):
            assert self.rows[recording_id]["capture_status"] != "ready"
            SpanStorage.upsert_privacy_spans(self, recording_id, spans)

    storage = Storage()
    session = rp.RecordingSession(
        CAM, "Gate", "unopened-live-source", SimpleNamespace(cosine=lambda a, b: 0), storage,
        str(tmp_path / "hls"), str(tmp_path / "volume" / "captures"),
        privacy_cache=ScriptedCache(P),
    )
    session._process_arcface = AsyncMock()
    recordings = []

    async def run():
        session._journal_active()
        await session._open_recording_row()
        session._source_opened = True
        session.original_writer = rp._ffmpeg_mp4_writer(session.original_path, 128, 96, 15)
        for i in range(20):
            if session.recording_id not in recordings:
                recordings.append(session.recording_id)
            await session._emit_frame(i / 15, np.full((96, 128, 3), i, dtype=np.uint8))
        await session.stop()

    asyncio.run(run())
    capture_spool.retry_due(storage)
    assert len(recordings) == 2
    assert all(storage.rows[r]["capture_status"] == "ready" for r in recordings)
    # Both segments private throughout: every span came from the delivery.
    assert storage.table() == sorted([
        (recordings[0], 0.0, 1.0, "schedule"),
        (recordings[1], 0.0, pytest.approx(5 / 15), "schedule"),
    ])
    assert not any(Path(tmp_path / "volume" / "spool").glob("*/manifest.json"))
