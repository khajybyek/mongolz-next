"""cameras.recording_mode through the cached camera read (ADR 0013).

Never loaded (read failed or still pending) → face_encrypted, the stricter
mode (fail closed: a raw original is never stored only because the setting
was unreadable); unreadable → last known; a missing column (ML before its
migration) → standard; ≤ ttl to take effect; separate from the
privacy-schedule query so a missing column never makes the privacy schedule
unreadable.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from recording_mode import RecordingModeCache, get_recording_mode_cache
from storage import SupabaseStorage

CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ModeStorage:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = 0

    def load_recording_mode(self, camera_id):
        self.calls += 1
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer


def _cache(storage, clock):
    return RecordingModeCache(storage, ttl_sec=30, wait_sec=1, retry_sec=5, clock=clock)


def test_first_read_waits_and_fresh_values_are_cached():
    clock, storage = Clock(), ModeStorage("face_encrypted")
    cache = _cache(storage, clock)

    async def run():
        assert await cache.mode_for(CAM) == "face_encrypted"
        clock.now += 29
        assert await cache.mode_for(CAM) == "face_encrypted"
        return storage.calls

    assert asyncio.run(run()) == 1


def test_a_change_is_seen_after_the_ttl():
    clock, storage = Clock(), ModeStorage("standard", "face_encrypted")
    cache = _cache(storage, clock)

    async def run():
        assert await cache.mode_for(CAM) == "standard"
        clock.now += 31
        assert await cache.mode_for(CAM) == "face_encrypted"

    asyncio.run(run())


def test_never_loaded_fails_closed_and_unreadable_keeps_the_last_known_mode():
    clock = Clock()
    storage = ModeStorage(ConnectionError("down"))
    cache = _cache(storage, clock)

    async def run():
        # Never read: the stricter mode, never a raw original by accident.
        assert await cache.mode_for(CAM) == "face_encrypted"
        assert cache.peek(CAM) is None                           # nothing is KNOWN yet
        storage.answers = ["standard"]
        clock.now += 6                                           # past retry_sec
        assert await cache.mode_for(CAM) == "standard"
        storage.answers = [ConnectionError("down again")]
        clock.now += 31
        assert await cache.mode_for(CAM) == "standard"          # last known, not the fallback
        storage.answers = ["face_encrypted"]
        clock.now += 31
        assert await cache.mode_for(CAM) == "face_encrypted"
        storage.answers = [ConnectionError("down again")]
        clock.now += 31
        assert await cache.mode_for(CAM) == "face_encrypted"    # last known
        storage.answers = ["bogus"]
        clock.now += 31
        assert await cache.mode_for(CAM) == "face_encrypted"    # invalid value ≠ a mode

    asyncio.run(run())


def test_a_read_slower_than_the_wait_fails_closed_then_rotates_to_standard():
    clock = Clock()

    class Slow:
        def load_recording_mode(self, _cid):
            import time
            time.sleep(0.3)
            return "standard"

    cache = RecordingModeCache(Slow(), ttl_sec=30, wait_sec=0.05, retry_sec=5, clock=clock)

    async def run():
        assert await cache.mode_for(CAM) == "face_encrypted"   # still pending at segment start
        await asyncio.sleep(0.5)
        assert cache.peek(CAM) == "standard"                   # the capture loop rotates on this

    asyncio.run(run())


def test_a_missing_column_means_the_mode_does_not_exist_yet():
    class ApiError(Exception):
        code = "42703"

    clock = Clock()
    cache = _cache(ModeStorage(ApiError("column cameras.recording_mode does not exist")), clock)
    assert asyncio.run(cache.mode_for(CAM)) == "standard"
    clock2 = Clock()
    cache2 = _cache(ModeStorage(RuntimeError("column cameras.recording_mode does not exist")), clock2)
    assert asyncio.run(cache2.mode_for(CAM)) == "standard"


def test_no_camera_row_and_non_uuid_ids_are_standard():
    clock = Clock()
    cache = _cache(ModeStorage(None), clock)
    assert asyncio.run(cache.mode_for(CAM)) == "standard"
    assert asyncio.run(cache.mode_for("upload_1234")) == "standard"
    assert asyncio.run(cache.mode_for(None)) == "standard"


def test_unconfigured_storage_records_standard():
    assert asyncio.run(RecordingModeCache(None).mode_for(CAM)) == "standard"
    assert asyncio.run(RecordingModeCache(SimpleNamespace()).mode_for(CAM)) == "standard"


def test_peek_never_waits_and_refreshes_in_the_background():
    clock, storage = Clock(), ModeStorage("face_encrypted")
    cache = _cache(storage, clock)

    async def run():
        assert cache.peek(CAM) is None             # nothing known yet; refresh scheduled
        await asyncio.sleep(0.05)
        assert cache.peek(CAM) == "face_encrypted"

    asyncio.run(run())
    assert cache.peek("not-a-uuid") is None


def test_invalidate_forces_the_next_read():
    clock, storage = Clock(), ModeStorage("standard", "face_encrypted")
    cache = _cache(storage, clock)

    async def run():
        assert await cache.mode_for(CAM) == "standard"
        cache.invalidate(CAM)
        assert await cache.mode_for(CAM) == "face_encrypted"

    asyncio.run(run())


def test_process_wide_cache_defaults_to_standard():
    assert asyncio.run(get_recording_mode_cache().mode_for(CAM)) in ("standard", "face_encrypted")


def _storage_with(rows):
    query = Mock()
    for name in ("select", "eq", "limit"):
        getattr(query, name).return_value = query
    query.execute.return_value = SimpleNamespace(data=rows)
    storage = SupabaseStorage.__new__(SupabaseStorage)
    storage.client = SimpleNamespace(table=Mock(return_value=query))
    return storage, query


def test_storage_reads_the_column_on_its_own_query():
    storage, query = _storage_with([{"id": CAM, "recording_mode": "face_encrypted"}])
    assert storage.load_recording_mode(CAM) == "face_encrypted"
    query.select.assert_called_once_with("id, recording_mode")
    storage, _ = _storage_with([])
    assert storage.load_recording_mode(CAM) is None
    storage, _ = _storage_with([{"id": CAM, "recording_mode": "masked"}])
    with pytest.raises(ValueError):
        storage.load_recording_mode(CAM)
    storage, _ = _storage_with(None)
    with pytest.raises(RuntimeError):
        storage.load_recording_mode(CAM)


def test_privacy_schedule_query_does_not_touch_recording_mode():
    storage, query = _storage_with(None)
    query.execute.side_effect = [
        SimpleNamespace(data=[{"id": CAM, "privacy_default": "standard", "privacy_loosened_at": None}]),
        SimpleNamespace(data=[]),
    ]
    assert storage.load_privacy_schedule(CAM).default == "standard"
    selected = [c.args[0] for c in query.select.call_args_list]
    assert all("recording_mode" not in s for s in selected)
