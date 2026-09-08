"""A camera's status must mean "it is sending frames".

``camera_health()`` derived status purely from the newest FACE detection:

    last_seen >= now() - 5 min  → healthy
    last_seen >= now() - 30 min → stale
    otherwise                   → offline

so a working camera watching an empty corridor reported an outage after 30
quiet minutes, and the dots on /grid, /wall and /cameras lied. Nothing in the
database could know better, because only the capture loop knows whether frames
are arriving — so the capture loop now says so: every ``CAMERA_HEARTBEAT_SEC``
of successful reads it stamps ``camera_sessions.last_heartbeat_at``
(migration 20260909111000), and camera_health() reads liveness from there.

These tests pin the writer's contract: it beats on a cadence (never per
frame), only for a live camera with a session row, never blocks the capture
loop, never piles up in-flight writes, and stops when the loop does.
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets
import types

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault(
    "ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
)

import recording_pipeline as rp  # noqa: E402
from storage import SupabaseStorage  # noqa: E402

CAM = "44444444-4444-4444-8444-444444444444"
OTHER = "66666666-6666-4666-8666-666666666666"


# ── the writer inside the capture loop ───────────────────────────────────
class _RecordingStorage:
    def __init__(self, delay: float = 0.0):
        self.client = object()
        self.beats: list[tuple[str, int | None]] = []
        self.delay = delay

    def heartbeat_camera_session(self, camera_id, frames_total=None):
        if self.delay:
            # Simulates a slow PostgREST round trip. This runs in a worker
            # thread (asyncio.to_thread), which is the point: the capture loop
            # must not wait for it.
            import time as _t

            _t.sleep(self.delay)
        self.beats.append((camera_id, frames_total))
        return True


def _session(storage, *, enabled=True, camera_id=CAM):
    s = rp.RecordingSession.__new__(rp.RecordingSession)
    s.storage = storage
    s.camera_id = camera_id
    s.db_camera_id = camera_id
    s.recorded_frames = 0
    s._heartbeat_enabled = enabled
    s._last_beat_at = 0.0
    s._beat_task = None
    return s


async def _drain(session):
    task = session._beat_task
    if task is not None:
        await task


def test_beats_on_a_cadence_not_per_frame():
    async def scenario():
        st = _RecordingStorage()
        s = _session(st)

        # A capture loop calls this after every frame — at 15 fps that is 15
        # calls a second, and exactly one of them may reach the database.
        assert s.beat_if_due(1_000.0) is True
        for i in range(1, 200):
            assert s.beat_if_due(1_000.0 + i * (1 / 15)) is False
        await _drain(s)
        assert st.beats == [(CAM, 0)]

        # One interval later the next beat goes out.
        s.recorded_frames = 900
        assert s.beat_if_due(1_000.0 + rp.CAMERA_HEARTBEAT_SEC) is True
        await _drain(s)
        assert st.beats == [(CAM, 0), (CAM, 900)]

    asyncio.run(scenario())


def test_file_mode_and_ad_hoc_cameras_never_claim_to_be_live():
    async def scenario():
        st = _RecordingStorage()
        # A browser upload being processed: there is no camera in front of it.
        s = _session(st, enabled=False)
        assert s.beat_if_due(1_000.0) is False

        # A live session whose camera id is not a DB uuid has no session row.
        s2 = _session(st, camera_id=None)
        assert s2.beat_if_due(1_000.0) is False
        await asyncio.sleep(0)
        assert st.beats == []

    asyncio.run(scenario())


def test_a_slow_write_never_stacks_up_or_blocks_the_loop():
    async def scenario():
        st = _RecordingStorage(delay=0.25)
        s = _session(st)

        started = asyncio.get_running_loop().time()
        assert s.beat_if_due(1_000.0) is True
        # The loop keeps reading frames while the write is in flight …
        assert (asyncio.get_running_loop().time() - started) < 0.1
        # … and the next due beat is skipped rather than queued behind it.
        assert s.beat_if_due(1_000.0 + 10 * rp.CAMERA_HEARTBEAT_SEC) is False
        await _drain(s)
        assert st.beats == [(CAM, 0)]

    asyncio.run(scenario())


def test_a_failing_write_is_never_fatal():
    class _Broken(_RecordingStorage):
        def heartbeat_camera_session(self, camera_id, frames_total=None):
            raise ConnectionError("supabase down")

    async def scenario():
        s = _session(_Broken())
        assert s.beat_if_due(1_000.0) is True
        await _drain(s)          # must not raise
        # A missed beat only ages the row into `stale`; capture continues.
        assert s.beat_if_due(1_000.0 + rp.CAMERA_HEARTBEAT_SEC) is True
        await _drain(s)

    asyncio.run(scenario())


def test_stopping_the_session_stops_the_beating():
    async def scenario():
        st = _RecordingStorage()
        s = _session(st)
        assert s.beat_if_due(1_000.0) is True
        await s._stop_heartbeat()
        assert s._heartbeat_enabled is False
        assert s.beat_if_due(1_000.0 + 10 * rp.CAMERA_HEARTBEAT_SEC) is False
        assert st.beats == [(CAM, 0)]      # the in-flight beat was awaited

    asyncio.run(scenario())


def test_heartbeat_interval_env_override():
    assert rp._env_seconds("MONGOLZ_TEST_UNSET_HEARTBEAT", 30.0, 5.0) == 30.0
    os.environ["MONGOLZ_TEST_HEARTBEAT"] = "12"
    try:
        assert rp._env_seconds("MONGOLZ_TEST_HEARTBEAT", 30.0, 5.0) == 12.0
        os.environ["MONGOLZ_TEST_HEARTBEAT"] = "0.1"     # below the floor
        assert rp._env_seconds("MONGOLZ_TEST_HEARTBEAT", 30.0, 5.0) == 5.0
        os.environ["MONGOLZ_TEST_HEARTBEAT"] = "nonsense"
        assert rp._env_seconds("MONGOLZ_TEST_HEARTBEAT", 30.0, 5.0) == 30.0
    finally:
        os.environ.pop("MONGOLZ_TEST_HEARTBEAT", None)
    # The interval must stay well under camera_health()'s 90 s healthy window.
    assert 5.0 <= rp.CAMERA_HEARTBEAT_SEC <= 45.0


# ── the storage statement ────────────────────────────────────────────────
class _Query:
    def __init__(self, store: dict, calls: list):
        self.store, self.calls = store, calls
        self._payload: dict | None = None
        self._filters: list[tuple[str, object]] = []

    def update(self, fields):
        self._payload = fields
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def execute(self):
        self.calls.append((self._payload, list(self._filters)))
        updated = []
        for row in self.store.values():
            if all(row.get(c) == v for c, v in self._filters):
                row.update(self._payload or {})
                updated.append(row)
        return types.SimpleNamespace(data=updated)


class _FakeClient:
    def __init__(self, rows):
        self.store = {r["camera_id"]: r for r in rows}
        self.calls: list = []

    def table(self, name):
        assert name == "camera_sessions"
        return _Query(self.store, self.calls)


def _storage(rows):
    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = _FakeClient(rows)
    return st


def test_only_the_heartbeat_column_of_the_right_row_is_written():
    st = _storage([
        {"camera_id": CAM, "auto_resume": True, "last_error": "RTSP dropped",
         "updated_at": "2026-09-01T00:00:00+00:00", "last_heartbeat_at": None},
        {"camera_id": OTHER, "auto_resume": True, "last_heartbeat_at": None},
    ])

    assert st.heartbeat_camera_session(CAM, 42) is True

    payload, filters = st.client.calls[0]
    assert list(payload) == ["last_heartbeat_at"]          # nothing else
    assert filters == [("camera_id", CAM)]
    row = st.client.store[CAM]
    assert row["last_heartbeat_at"] is not None
    # `updated_at` still means "the session description changed", and the
    # reason the previous loop died stays visible to the operator.
    assert row["updated_at"] == "2026-09-01T00:00:00+00:00"
    assert row["last_error"] == "RTSP dropped"
    assert st.client.store[OTHER]["last_heartbeat_at"] is None


def test_no_session_row_is_not_an_error():
    st = _storage([])
    assert st.heartbeat_camera_session(CAM) is False


def test_a_broken_or_absent_client_never_raises():
    st = SupabaseStorage.__new__(SupabaseStorage)

    class _Broken:
        def table(self, _n):
            raise RuntimeError("db down")

    st.client = _Broken()
    assert st.heartbeat_camera_session(CAM) is False

    st.client = None
    assert st.heartbeat_camera_session(CAM) is False
