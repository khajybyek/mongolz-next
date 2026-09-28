"""SupabaseStorage privacy schedule / span helpers (ADR 0012) against an
in-memory PostgREST stand-in. Every helper raises on failure — the callers
fail closed or retry."""
from __future__ import annotations

import os
import types

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")

import pytest  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from privacy_schedule import CameraSchedule, PrivacySpanNotFound, Window  # noqa: E402
from storage import SupabaseStorage  # noqa: E402

CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
REC = "8b3c4d5e-6f70-4a81-9c92-b4d5e6f7a802"


class _Query:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.op, self.payload, self.filters, self.order_by, self.columns = "select", None, [], None, None

    def select(self, columns):
        self.columns = columns
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def upsert(self, row, on_conflict="", ignore_duplicates=False):
        self.op, self.payload = "upsert", row
        self.on_conflict, self.ignore_duplicates = on_conflict, ignore_duplicates
        return self

    def update(self, fields):
        self.op, self.payload = "update", fields
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def limit(self, _n):
        return self

    def order(self, col):
        self.order_by = col
        return self

    def execute(self):
        self.client.calls.append((self.table, self.op, self.columns, self.payload, list(self.filters)))
        if self.client.fail:
            raise ConnectionError("database offline")
        rows = self.client.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = {"id": len(rows) + 1, "end_offset_sec": None, **self.payload}
            rows.append(row)
            return types.SimpleNamespace(data=[row])
        if self.op == "upsert":
            key = self.on_conflict
            existing = next((r for r in rows if r.get(key) == self.payload.get(key)), None)
            if existing is not None:
                if self.ignore_duplicates:
                    return types.SimpleNamespace(data=[])
                existing.update(self.payload)  # ON CONFLICT DO UPDATE SET <payload columns>
                return types.SimpleNamespace(data=[dict(existing)])
            row = {"id": len(rows) + 1, "end_offset_sec": None, **self.payload}
            if key == "id":
                row["id"] = self.payload["id"]
            rows.append(row)
            return types.SimpleNamespace(data=[dict(row)])
        matched = [r for r in rows if all(r.get(c) == v for c, v in self.filters)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        if self.order_by:
            matched = sorted(matched, key=lambda r: r[self.order_by])
        return types.SimpleNamespace(data=[dict(r) for r in matched])


class _Client:
    def __init__(self, **tables):
        self.tables = {name: list(rows) for name, rows in tables.items()}
        self.calls: list = []
        self.fail = False

    def table(self, name):
        return _Query(self, name)


def _storage(**tables) -> SupabaseStorage:
    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = _Client(**tables)
    return st


def test_load_privacy_schedule_reads_default_and_windows():
    st = _storage(
        cameras=[{"id": CAM, "privacy_default": "private"}],
        masking_schedules=[
            {"camera_id": CAM, "window_mode": "standard", "starts_at": "08:00", "ends_at": "20:00", "weekdays": 62},
            {"camera_id": "other", "window_mode": "private", "starts_at": "00:00", "ends_at": "24:00", "weekdays": 127},
        ],
    )
    assert st.load_privacy_schedule(CAM) == CameraSchedule("private", (Window("standard", "08:00", "20:00", 62),))
    assert [(c[0], c[2]) for c in st.client.calls] == [
        ("cameras", "id, privacy_default, privacy_loosened_at"),
        ("masking_schedules", "window_mode, starts_at, ends_at, weekdays"),
    ]


def test_load_privacy_schedule_reads_when_it_was_last_loosened():
    st = _storage(
        cameras=[{"id": CAM, "privacy_default": "standard", "privacy_loosened_at": "2026-09-15T08:00:00+00:00"}],
        masking_schedules=[],
    )
    schedule = st.load_privacy_schedule(CAM)
    assert schedule.loosened_at == datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc)
    st = _storage(cameras=[{"id": CAM, "privacy_default": "standard", "privacy_loosened_at": 17}])
    with pytest.raises(ValueError):
        st.load_privacy_schedule(CAM)


def test_load_privacy_schedule_without_camera_row_is_none():
    st = _storage(cameras=[])
    assert st.load_privacy_schedule(CAM) is None
    assert len(st.client.calls) == 1  # no window query for an unknown camera


@pytest.mark.parametrize(
    "camera,window",
    [
        ({"id": CAM, "mask_default": "masked"}, None),               # pre-migration schema
        ({"id": CAM, "privacy_default": "private"},
         {"camera_id": CAM, "window_mode": "revealed", "starts_at": "08:00", "ends_at": "20:00", "weekdays": 1}),
    ],
)
def test_load_privacy_schedule_rejects_values_it_cannot_apply(camera, window):
    st = _storage(cameras=[camera], masking_schedules=[window] if window else [])
    with pytest.raises(ValueError):
        st.load_privacy_schedule(CAM)


def test_privacy_helpers_raise_without_a_client_or_database():
    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = None
    for call in (
        lambda: st.load_privacy_schedule(CAM),
        lambda: st.open_privacy_span(REC, 0.0, "schedule"),
        lambda: st.close_privacy_span(1, 2.0),
        lambda: st.list_privacy_spans(REC),
        lambda: st.upsert_privacy_spans(REC, []),
        lambda: st.ensure_recording_placeholder(REC, {}),
    ):
        with pytest.raises(RuntimeError):
            call()
    st = _storage()
    st.client.fail = True
    with pytest.raises(ConnectionError):
        st.load_privacy_schedule(CAM)
    with pytest.raises(ConnectionError):
        st.list_privacy_spans(REC)


def test_span_open_close_and_list():
    st = _storage(recording_privacy_spans=[])
    first = st.open_privacy_span(REC, 12.5, "fail_closed")
    second = st.open_privacy_span(REC, 0.0, "schedule")
    assert (first, second) == (1, 2)
    st.close_privacy_span(second, 4.0)
    st.close_privacy_span(second, 4.0)  # a retry after a lost response is harmless
    spans = st.list_privacy_spans(REC)
    assert [(s["start_offset_sec"], s["end_offset_sec"], s["source"]) for s in spans] == [
        (0.0, 4.0, "schedule"), (12.5, None, "fail_closed"),
    ]
    insert = next(c for c in st.client.calls if c[1] == "insert")
    assert insert[3] == {"recording_id": REC, "start_offset_sec": 12.5, "source": "fail_closed"}
    with pytest.raises(PrivacySpanNotFound):
        st.close_privacy_span(99, 1.0)
    with pytest.raises(ValueError):
        st.open_privacy_span(REC, 0.0, "revealed")


SPAN_KEY = "5d0f5a52-8a3e-4b0e-9d7e-3c1f0b8f2a11"


def test_open_with_a_client_key_is_idempotent():
    # The first attempt committed but its response was lost: the retry finds
    # that row instead of leaving it open forever beside a second one.
    st = _storage(recording_privacy_spans=[])
    first = st.open_privacy_span(REC, 9.0, "schedule", SPAN_KEY)
    retry = st.open_privacy_span(REC, 9.0, "fail_closed", SPAN_KEY)
    assert first == retry == 1
    st.close_privacy_span(first, 12.0)
    st.open_privacy_span(REC, 9.0, "fail_closed", SPAN_KEY)  # a late retry cannot clear the close
    rows = st.client.tables["recording_privacy_spans"]
    assert [(r["start_offset_sec"], r["end_offset_sec"], r["source"]) for r in rows] == [(9.0, 12.0, "fail_closed")]
    upsert = next(c for c in st.client.calls if c[1] == "upsert")
    assert "end_offset_sec" not in upsert[3] and upsert[3]["client_span_id"] == SPAN_KEY


def test_delivery_upserts_spans_by_client_key():
    st = _storage(recording_privacy_spans=[])
    live = st.open_privacy_span(REC, 0.0, "schedule", SPAN_KEY)  # written live, never closed
    st.upsert_privacy_spans(REC, [
        {"client_span_id": SPAN_KEY, "start_offset_sec": 0.0, "end_offset_sec": 30.0, "source": "schedule"},
        {"client_span_id": "b" * 8 + SPAN_KEY[8:], "start_offset_sec": 40.0, "end_offset_sec": None,
         "source": "fail_closed"},
    ])
    rows = st.client.tables["recording_privacy_spans"]
    assert [(r["id"], r["start_offset_sec"], r["end_offset_sec"], r["source"]) for r in rows] == [
        (live, 0.0, 30.0, "schedule"), (2, 40.0, None, "fail_closed"),
    ]
    # An open span is written without end_offset_sec, so it never clears a close.
    assert "end_offset_sec" not in st.client.calls[-1][3]
    with pytest.raises(ValueError):
        st.upsert_privacy_spans(REC, [{"client_span_id": SPAN_KEY, "start_offset_sec": 0, "source": "masked"}])


def test_placeholder_never_touches_an_existing_row():
    st = _storage(recordings=[{"id": REC, "capture_status": "ready", "has_original": True}])
    st.ensure_recording_placeholder(REC, {"capture_status": "ready", "has_original": True, "camera_id": CAM})
    assert st.client.tables["recordings"] == [{"id": REC, "capture_status": "ready", "has_original": True}]
    other = "9c4d5e6f-7081-4b92-8da3-c5e6f7a8b903"
    st.ensure_recording_placeholder(other, {"capture_status": "ready", "has_original": True, "camera_id": CAM})
    placeholder = st.client.tables["recordings"][1]
    assert placeholder["id"] == other and placeholder["capture_status"] == "capturing"
    assert placeholder["has_original"] is False and placeholder["original_path"] is None


@pytest.mark.parametrize("table", ["cameras", "masking_schedules", "recording_privacy_spans"])
@pytest.mark.parametrize("data", [None, {}, "rows"])
def test_malformed_response_is_an_error_not_no_rows(monkeypatch, table, data):
    """For these tables "no rows" means standard / nothing protected, so a
    response without a row list must raise (the callers fail closed) instead
    of reading as an empty result."""
    st = _storage(
        cameras=[{"id": CAM, "privacy_default": "private"}],
        masking_schedules=[],
        recording_privacy_spans=[],
    )
    real_execute = _Query.execute

    def execute(self):
        result = real_execute(self)
        return types.SimpleNamespace(data=data) if self.table == table else result

    monkeypatch.setattr(_Query, "execute", execute)
    if table == "recording_privacy_spans":
        call = lambda: st.list_privacy_spans(REC)  # noqa: E731
    else:
        call = lambda: st.load_privacy_schedule(CAM)  # noqa: E731
    with pytest.raises(RuntimeError, match=f"invalid {table} response"):
        call()
