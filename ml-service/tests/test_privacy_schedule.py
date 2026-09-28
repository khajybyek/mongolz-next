"""Privacy schedule evaluation + cache (ADR 0012).

The SHARED_VECTORS list below is the contract between this module and
``public.effective_privacy_mode()``: the same list lives in
``supabase/tests/privacy_schedule.test.sql``. Change both or neither.
"""
from __future__ import annotations

import asyncio
import logging
import random
import threading
import time
from datetime import date, datetime, timedelta, timezone

import pytest

import privacy_schedule as ps
from privacy_schedule import (
    CameraSchedule,
    PrivacyScheduleCache,
    PrivacyScheduleUnavailable,
    Window,
    mode_at,
    mode_during,
    pad_intervals,
    private_intervals,
    schedule_from_rows,
)

CAM = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
CAM2 = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f702"


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def test_calendar_facts_used_by_the_vectors():
    # KST dates: 2026-09-25 Fri, 26 Sat, 27 Sun, 28 Mon.
    assert [date(2026, 9, d).strftime("%a") for d in (25, 26, 27, 28)] == ["Fri", "Sat", "Sun", "Mon"]


# ── Shared vectors — keep identical to supabase/tests/privacy_schedule.test.sql
# (vector, default, windows [(mode, starts_at, ends_at, weekdays)], instant UTC, expected)
# default None = camera id without a cameras row.
SHARED_VECTORS = [
    # 1. no windows, default standard → standard at any instant
    (1, "standard", [], "2026-09-28T00:00:00Z", "standard"),   # Mon 09:00 KST
    (1, "standard", [], "2026-09-28T03:00:00Z", "standard"),   # Mon 12:00 KST
    (1, "standard", [], "2026-09-25T13:00:00Z", "standard"),   # Fri 22:00 KST
    (1, "standard", [], "2026-09-26T15:30:00Z", "standard"),   # Sun 00:30 KST
    # 2. no windows, default private → private
    (2, "private", [], "2026-09-28T00:00:00Z", "private"),     # Mon 09:00 KST
    (2, "private", [], "2026-09-28T03:00:00Z", "private"),     # Mon 12:00 KST
    (2, "private", [], "2026-09-25T17:00:00Z", "private"),     # Sat 02:00 KST
    (2, "private", [], "2026-09-26T15:30:00Z", "private"),     # Sun 00:30 KST
    # 3. private 09:00–18:00 every day, default standard
    (3, "standard", [("private", "09:00", "18:00", 127)], "2026-09-28T00:00:00Z", "private"),   # 09:00 KST Mon
    (3, "standard", [("private", "09:00", "18:00", 127)], "2026-09-28T08:59:00Z", "private"),   # 17:59 KST
    (3, "standard", [("private", "09:00", "18:00", 127)], "2026-09-28T09:00:00Z", "standard"),  # 18:00 KST (end exclusive)
    (3, "standard", [("private", "09:00", "18:00", 127)], "2026-09-27T23:59:00Z", "standard"),  # 08:59 KST Mon
    # 4. overnight private 22:00–06:00, Friday only (32), default standard
    (4, "standard", [("private", "22:00", "06:00", 32)], "2026-09-25T13:00:00Z", "private"),   # 22:00 KST Fri
    (4, "standard", [("private", "22:00", "06:00", 32)], "2026-09-25T17:00:00Z", "private"),   # 02:00 KST Sat
    (4, "standard", [("private", "22:00", "06:00", 32)], "2026-09-24T17:00:00Z", "standard"),  # 02:00 KST Fri
    (4, "standard", [("private", "22:00", "06:00", 32)], "2026-09-25T21:00:00Z", "standard"),  # 06:00 KST Sat
    # 5. private 00:00–24:00 Saturday only (64), default standard
    (5, "standard", [("private", "00:00", "24:00", 64)], "2026-09-26T14:59:00Z", "private"),   # 23:59 KST Sat
    (5, "standard", [("private", "00:00", "24:00", 64)], "2026-09-26T15:00:00Z", "standard"),  # 00:00 KST Sun
    # 6. overlap: standard 08:00–20:00 + private 12:00–13:00 (both 127), default private
    (6, "private", [("standard", "08:00", "20:00", 127), ("private", "12:00", "13:00", 127)],
     "2026-09-28T03:30:00Z", "private"),   # 12:30 KST
    (6, "private", [("standard", "08:00", "20:00", 127), ("private", "12:00", "13:00", 127)],
     "2026-09-28T02:00:00Z", "standard"),  # 11:00 KST
    (6, "private", [("standard", "08:00", "20:00", 127), ("private", "12:00", "13:00", 127)],
     "2026-09-28T12:00:00Z", "private"),   # 21:00 KST (default)
    # 7. camera id without a cameras row → standard
    (7, None, [], "2026-09-28T03:30:00Z", "standard"),
]


def build(default, windows) -> CameraSchedule | None:
    if default is None:
        return None
    return CameraSchedule(default, tuple(Window(*w) for w in windows))


@pytest.mark.parametrize("vector,default,windows,instant,expected", SHARED_VECTORS)
def test_shared_vectors(vector, default, windows, instant, expected):
    assert mode_at(build(default, windows), utc(instant)) == expected


@pytest.mark.parametrize("vector,default,windows,instant,expected", SHARED_VECTORS)
def test_shared_vectors_agree_with_private_intervals(vector, default, windows, instant, expected):
    at = utc(instant)
    spans = private_intervals(build(default, windows), at - timedelta(hours=30), at + timedelta(hours=30))
    inside = any(a <= at < b for a, b in spans)
    assert inside == (expected == "private")


@pytest.mark.parametrize("vector,default,windows,instant,expected", SHARED_VECTORS)
def test_shared_vectors_through_the_cache(vector, default, windows, instant, expected):
    class Storage:
        def load_privacy_schedule(self, camera_id):
            return build(default, windows)

    mode, source = asyncio.run(PrivacyScheduleCache(Storage()).mode_at(CAM, utc(instant)))
    assert mode == expected
    assert source == ("none" if default is None else "schedule")


def test_naive_datetimes_are_utc():
    schedule = build("standard", [("private", "09:00", "18:00", 127)])
    assert mode_at(schedule, datetime(2026, 9, 28, 0, 0)) == "private"
    assert mode_at(schedule, datetime(2026, 9, 28, 9, 0)) == "standard"
    spans = private_intervals(schedule, datetime(2026, 9, 28), datetime(2026, 9, 29))
    assert spans == [(utc("2026-09-28T00:00:00Z"), utc("2026-09-28T09:00:00Z"))]
    assert all(a.tzinfo is not None for a, _ in spans)


# ── private_intervals ─────────────────────────────────────────────────
def test_intervals_clip_to_the_requested_range():
    schedule = build("standard", [("private", "09:00", "18:00", 127)])  # 00:00–09:00 UTC
    assert private_intervals(schedule, utc("2026-09-28T03:00:00Z"), utc("2026-09-29T03:00:00Z")) == [
        (utc("2026-09-28T03:00:00Z"), utc("2026-09-28T09:00:00Z")),
        (utc("2026-09-29T00:00:00Z"), utc("2026-09-29T03:00:00Z")),
    ]


def test_intervals_merge_adjacent_and_overlapping_windows():
    adjacent = build("standard", [("private", "09:00", "12:00", 127), ("private", "12:00", "18:00", 127)])
    overlapping = build("standard", [("private", "09:00", "13:00", 127), ("private", "12:00", "18:00", 127)])
    expected = [(utc("2026-09-28T00:00:00Z"), utc("2026-09-28T09:00:00Z"))]
    for schedule in (adjacent, overlapping):
        assert private_intervals(schedule, utc("2026-09-27T20:00:00Z"), utc("2026-09-28T20:00:00Z")) == expected
    # Whole-day windows on consecutive days merge across midnight.
    weekend = build("standard", [("private", "00:00", "24:00", 64 | 1)])  # Sat + Sun
    assert private_intervals(weekend, utc("2026-09-25T00:00:00Z"), utc("2026-09-29T00:00:00Z")) == [
        (utc("2026-09-25T15:00:00Z"), utc("2026-09-27T15:00:00Z")),
    ]


def test_overnight_window_belongs_to_its_start_day():
    schedule = build("standard", [("private", "22:00", "06:00", 32)])  # Fri 22:00 → Sat 06:00 KST
    week = private_intervals(schedule, utc("2026-09-20T00:00:00Z"), utc("2026-09-28T00:00:00Z"))
    assert week == [(utc("2026-09-25T13:00:00Z"), utc("2026-09-25T21:00:00Z"))]
    # A range starting at Sat 00:00 KST still sees the window that started on
    # Friday (the day before the range).
    assert private_intervals(schedule, utc("2026-09-25T15:00:00Z"), utc("2026-09-26T15:00:00Z")) == [
        (utc("2026-09-25T15:00:00Z"), utc("2026-09-25T21:00:00Z")),
    ]


def test_default_private_minus_standard_windows():
    schedule = build("private", [("standard", "08:00", "20:00", 127), ("private", "12:00", "13:00", 127)])
    # Monday 00:00 KST → Tuesday 00:00 KST.
    assert private_intervals(schedule, utc("2026-09-27T15:00:00Z"), utc("2026-09-28T15:00:00Z")) == [
        (utc("2026-09-27T15:00:00Z"), utc("2026-09-27T23:00:00Z")),  # 00:00–08:00 KST
        (utc("2026-09-28T03:00:00Z"), utc("2026-09-28T04:00:00Z")),  # 12:00–13:00 KST
        (utc("2026-09-28T11:00:00Z"), utc("2026-09-28T15:00:00Z")),  # 20:00–24:00 KST
    ]
    # Standard windows only on weekdays other than the queried one → all private.
    no_cover = build("private", [("standard", "08:00", "20:00", 64)])  # Sat only
    assert private_intervals(no_cover, utc("2026-09-27T15:00:00Z"), utc("2026-09-28T15:00:00Z")) == [
        (utc("2026-09-27T15:00:00Z"), utc("2026-09-28T15:00:00Z")),
    ]


def test_intervals_edge_cases():
    assert private_intervals(None, utc("2026-09-28T00:00:00Z"), utc("2026-09-29T00:00:00Z")) == []
    schedule = build("private", [])
    at = utc("2026-09-28T00:00:00Z")
    assert private_intervals(schedule, at, at) == []
    assert private_intervals(schedule, at, at - timedelta(seconds=1)) == []
    assert private_intervals(build("standard", []), at, at + timedelta(days=3)) == []


def _random_schedule(rng: random.Random) -> CameraSchedule:
    def hhmm(minutes: int) -> str:
        return f"{minutes // 60:02d}:{minutes % 60:02d}"

    windows = []
    for _ in range(rng.randint(0, 4)):
        start = rng.randrange(0, 24 * 60, 15)
        end = rng.randrange(15, 24 * 60 + 1, 15)
        if start == end:
            continue
        windows.append(Window(rng.choice(["standard", "private"]), hhmm(start), hhmm(end), rng.randint(1, 127)))
    return CameraSchedule(rng.choice(["standard", "private"]), tuple(windows))


def test_intervals_match_mode_at_on_random_schedules():
    rng = random.Random(20260928)
    base = utc("2026-09-20T00:00:00Z")
    for _ in range(150):
        schedule = _random_schedule(rng)
        start = base + timedelta(minutes=rng.randrange(0, 7 * 24 * 60))
        end = start + timedelta(minutes=rng.randrange(1, 4 * 24 * 60))
        spans = private_intervals(schedule, start, end)
        # Merged, sorted, non-empty, clipped.
        assert all(a < b for a, b in spans)
        assert all(spans[i][1] < spans[i + 1][0] for i in range(len(spans) - 1))
        assert all(start <= a and b <= end for a, b in spans)
        samples = [start + (end - start) * rng.random() for _ in range(40)]
        samples += [a for a, _ in spans] + [b - timedelta(microseconds=1) for _, b in spans]
        samples += [b for _, b in spans if b < end]
        for at in samples:
            inside = any(a <= at < b for a, b in spans)
            assert inside == (mode_at(schedule, at) == "private"), (schedule, at)


# ── validation ────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "args",
    [
        ("masked", "09:00", "18:00", 127),     # old mode value
        ("revealed", "09:00", "18:00", 127),
        ("private", "24:00", "06:00", 127),    # start may not be 24:00
        ("private", "09:00", "09:00", 127),    # empty window
        ("private", "25:00", "26:00", 127),
        ("private", "9:00", "18:00", 127),
        ("private", "09:00", "18:00", 0),
        ("private", "09:00", "18:00", 128),
        ("private", "09:00", "18:00", True),
        ("private", None, "18:00", 127),
    ],
)
def test_window_rejects_values_the_db_rejects(args):
    with pytest.raises(ValueError):
        Window(*args)


def test_schedule_validation_and_rows():
    with pytest.raises(ValueError):
        CameraSchedule("masked")
    schedule = schedule_from_rows("private", [
        {"window_mode": "standard", "starts_at": "08:00", "ends_at": "24:00", "weekdays": 62},
    ])
    assert schedule == CameraSchedule("private", (Window("standard", "08:00", "24:00", 62),))
    with pytest.raises(ValueError):
        schedule_from_rows("standard", [{"window_mode": "masked", "starts_at": "08:00", "ends_at": "09:00", "weekdays": 1}])


# ── cache ─────────────────────────────────────────────────────────────
class Clock:
    def __init__(self, now: float = 1000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now


class ScriptedStorage:
    """load_privacy_schedule answers from a script (values or exceptions);
    the last entry repeats."""

    def __init__(self, *script, delay: float = 0.0, gate: threading.Event | None = None):
        self.script = list(script)
        self.calls: list[str] = []
        self.threads: list[int] = []
        self.windows: list[tuple[float, float]] = []
        self.delay = delay
        self.gate = gate

    def load_privacy_schedule(self, camera_id):
        self.calls.append(camera_id)
        self.threads.append(threading.get_ident())
        started = time.monotonic()
        if self.gate is not None:
            assert self.gate.wait(5)
        if self.delay:
            time.sleep(self.delay)
        self.windows.append((started, time.monotonic()))
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, BaseException):
            raise item
        return item


PRIVATE = CameraSchedule("private")
STANDARD = CameraSchedule("standard")
AT = utc("2026-09-28T03:00:00Z")


async def _drain(cache: PrivacyScheduleCache, camera_id: str = CAM) -> None:
    task = cache._entries[camera_id].refresh
    if task is not None:
        await task


def test_cache_ids_without_a_camera_are_standard_and_never_read():
    storage = ScriptedStorage(PRIVATE)
    cache = PrivacyScheduleCache(storage)

    async def run():
        for camera_id in (None, "", "cam-1", "upload_1234abcd", "not-a-uuid"):
            assert await cache.mode_at(camera_id, AT) == ("standard", "none")

    asyncio.run(run())
    assert storage.calls == []
    assert cache.schedule_strict(None) is None and cache.schedule_strict("cam-1") is None


def test_cache_camera_without_row_is_standard():
    cache = PrivacyScheduleCache(ScriptedStorage(None))
    assert asyncio.run(cache.mode_at(CAM, AT)) == ("standard", "none")


def test_cache_never_loaded_fails_closed(caplog):
    cache = PrivacyScheduleCache(ScriptedStorage(ConnectionError("db down")))
    with caplog.at_level(logging.WARNING, logger="mongolz-ml.privacy-schedule"):
        assert asyncio.run(cache.mode_at(CAM, AT)) == ("private", "fail_closed")
    assert any("failing closed" in r.getMessage() for r in caplog.records)


def test_cache_without_storage_fails_closed():
    cache = PrivacyScheduleCache(None)
    assert asyncio.run(cache.mode_at(CAM, AT)) == ("private", "fail_closed")
    with pytest.raises(PrivacyScheduleUnavailable):
        cache.schedule_strict(CAM)


def test_cache_ttl_refresh_is_stale_while_revalidate():
    clock = Clock()
    storage = ScriptedStorage(PRIVATE, STANDARD)
    cache = PrivacyScheduleCache(storage, clock=clock)

    async def run():
        assert await cache.mode_at(CAM, AT) == ("private", "schedule")
        clock.now += 10
        assert await cache.mode_at(CAM, AT) == ("private", "schedule")
        assert len(storage.calls) == 1  # fresh: no read
        clock.now += 21  # 31 s old → refresh in the background, old value now
        assert await cache.mode_at(CAM, AT) == ("private", "schedule")
        await _drain(cache)
        assert await cache.mode_at(CAM, AT) == ("standard", "schedule")
        assert len(storage.calls) == 2

    asyncio.run(run())


def test_cache_failed_refresh_keeps_last_good_until_max_stale(caplog):
    clock = Clock()
    storage = ScriptedStorage(STANDARD, ConnectionError("db down"))
    cache = PrivacyScheduleCache(storage, clock=clock)

    async def run():
        assert await cache.mode_at(CAM, AT) == ("standard", "schedule")
        for step in range(1, 12):  # every 5 s from t=31 to t=81
            clock.now = 1000 + 26 + 5 * step
            assert await cache.mode_at(CAM, AT) == ("standard", "schedule")
            await _drain(cache)
        warnings = [r for r in caplog.records if "refresh failed" in r.getMessage()]
        assert len(warnings) == 1 and "keeping the last good" in warnings[0].getMessage()
        clock.now = 1000 + 600
        assert await cache.mode_at(CAM, AT) == ("standard", "schedule")
        await _drain(cache)
        clock.now = 1000 + 601
        assert await cache.mode_at(CAM, AT) == ("private", "fail_closed")
        await _drain(cache)
        assert len([r for r in caplog.records if "refresh failed" in r.getMessage()]) >= 2

    with caplog.at_level(logging.WARNING, logger="mongolz-ml.privacy-schedule"):
        asyncio.run(run())


def test_cache_retries_are_spaced_and_recover():
    clock = Clock()
    storage = ScriptedStorage(ConnectionError("db down"), ConnectionError("db down"), PRIVATE)
    cache = PrivacyScheduleCache(storage, clock=clock, retry_sec=5)

    async def run():
        assert await cache.mode_at(CAM, AT) == ("private", "fail_closed")
        clock.now += 1
        assert await cache.mode_at(CAM, AT) == ("private", "fail_closed")
        assert len(storage.calls) == 1  # backoff: no hammering while down
        clock.now += 5
        assert await cache.mode_at(CAM, AT) == ("private", "fail_closed")  # no wait after the first
        await _drain(cache)
        assert len(storage.calls) == 2
        clock.now += 5
        await cache.mode_at(CAM, AT)
        await _drain(cache)
        assert await cache.mode_at(CAM, AT) == ("private", "schedule")

    asyncio.run(run())


def test_cache_concurrent_callers_share_one_refresh():
    gate = threading.Event()
    storage = ScriptedStorage(PRIVATE, gate=gate)
    cache = PrivacyScheduleCache(storage)

    async def run():
        async def release():
            await asyncio.sleep(0.05)
            gate.set()

        results = await asyncio.gather(*(cache.mode_at(CAM, AT) for _ in range(5)), release())
        return results[:5]

    assert asyncio.run(run()) == [("private", "schedule")] * 5
    assert storage.calls == [CAM]


def test_cache_refresh_runs_in_a_thread_and_never_blocks_the_loop():
    storage = ScriptedStorage(STANDARD, delay=0.2)
    cache = PrivacyScheduleCache(storage)
    ticks = []

    async def run():
        async def ticker():
            for _ in range(10):
                ticks.append(time.monotonic())
                await asyncio.sleep(0.01)

        return await asyncio.gather(cache.mode_at(CAM, AT), ticker())

    main_thread = threading.get_ident()
    result, _ = asyncio.run(run())
    assert result == ("standard", "schedule")
    (started, ended), = storage.windows
    # The loop kept running WHILE the read slept (a blocking read would push
    # every tick before or after that window).
    assert sum(1 for t in ticks if started < t < ended) >= 3
    assert storage.threads and storage.threads[0] != main_thread


def test_cache_initial_wait_is_bounded():
    storage = ScriptedStorage(PRIVATE, delay=0.4)
    cache = PrivacyScheduleCache(storage, wait_sec=0.05)

    async def run():
        started = time.monotonic()
        assert await cache.mode_at(CAM, AT) == ("private", "fail_closed")
        assert time.monotonic() - started < 0.3
        # A second caller while the same read is still running does not wait.
        started = time.monotonic()
        assert await cache.mode_at(CAM, AT) == ("private", "fail_closed")
        assert time.monotonic() - started < 0.1
        await _drain(cache)
        assert await cache.mode_at(CAM, AT) == ("private", "schedule")

    asyncio.run(run())
    assert len(storage.calls) == 1


def test_cache_invalidate_forces_a_fresh_read():
    clock = Clock()
    storage = ScriptedStorage(STANDARD, PRIVATE, STANDARD)
    cache = PrivacyScheduleCache(storage, clock=clock)

    async def run():
        assert await cache.mode_at(CAM, AT) == ("standard", "schedule")
        assert await cache.mode_at(CAM2, AT) == ("private", "schedule")
        cache.invalidate(CAM)
        clock.now += 1
        assert await cache.mode_at(CAM, AT) == ("standard", "schedule")  # waited for the fresh read
        assert storage.calls == [CAM, CAM2, CAM]
        cache.invalidate()
        clock.now += 1
        await cache.mode_at(CAM2, AT)
        assert storage.calls[-1] == CAM2

    asyncio.run(run())


def test_schedule_strict_reads_fresh_and_raises_on_any_error():
    storage = ScriptedStorage(PRIVATE, STANDARD, None, ValueError("bad row"))
    cache = PrivacyScheduleCache(storage)
    assert cache.schedule_strict(CAM) == PRIVATE
    assert cache.schedule_strict(CAM.upper()) == STANDARD  # never cached
    assert cache.schedule_strict(CAM) is None  # no cameras row
    with pytest.raises(PrivacyScheduleUnavailable) as err:
        cache.schedule_strict(CAM)
    assert isinstance(err.value.__cause__, ValueError)
    assert storage.calls == [CAM] * 4


def test_module_singleton(monkeypatch, caplog):
    monkeypatch.setattr(ps, "_cache", None)
    with caplog.at_level(logging.ERROR, logger="mongolz-ml.privacy-schedule"):
        fallback = ps.get_privacy_schedule_cache()
    assert "before init" in caplog.text
    assert asyncio.run(fallback.mode_at(CAM, AT)) == ("private", "fail_closed")
    installed = ps.init_privacy_schedule_cache(ScriptedStorage(STANDARD), ttl_sec=5)
    assert ps.get_privacy_schedule_cache() is installed and installed.ttl_sec == 5
    assert asyncio.run(installed.mode_at(CAM, AT)) == ("standard", "schedule")


# ── mode_during / edge_mode (a capture instant known only within a bound) ──
BUSINESS = CameraSchedule("standard", (Window("private", "09:00", "18:00", 127),))
LUNCH = CameraSchedule("standard", (Window("private", "12:00", "12:10", 127),))


@pytest.mark.parametrize("vector,default,windows,instant,expected", SHARED_VECTORS)
def test_mode_during_of_one_instant_is_mode_at(vector, default, windows, instant, expected):
    at = utc(instant)
    assert mode_during(build(default, windows), at, at) == expected


def test_mode_during_is_private_if_any_instant_is():
    # 08:59:57–09:00:01 KST touches the window start; order does not matter.
    a, b = utc("2026-09-27T23:59:57Z"), utc("2026-09-28T00:00:01Z")
    assert mode_during(BUSINESS, a, b) == "private"
    assert mode_during(BUSINESS, b, a) == "private"
    # Both ends standard, the window strictly inside the range.
    assert mode_during(LUNCH, utc("2026-09-28T02:55:00Z"), utc("2026-09-28T03:20:00Z")) == "private"
    # The closed upper end counts; the exclusive window end does not.
    assert mode_during(BUSINESS, utc("2026-09-27T23:59:00Z"), utc("2026-09-28T00:00:00Z")) == "private"
    assert mode_during(BUSINESS, utc("2026-09-28T09:00:00Z"), utc("2026-09-28T09:00:05Z")) == "standard"
    assert mode_during(None, a, b) == "standard"


def test_pad_intervals_widens_and_merges():
    pad = timedelta(seconds=60)
    spans = [(utc("2026-09-28T00:00:00Z"), utc("2026-09-28T00:01:00Z")),
             (utc("2026-09-28T00:02:30Z"), utc("2026-09-28T00:03:00Z"))]
    assert pad_intervals(spans, pad) == [(utc("2026-09-27T23:59:00Z"), utc("2026-09-28T00:04:00Z"))]


def test_schedule_rows_carry_the_loosening_time():
    schedule = schedule_from_rows("standard", [], "2026-09-15T08:00:00Z")
    assert schedule.loosened_at == utc("2026-09-15T08:00:00Z")
    assert schedule_from_rows("standard", []).loosened_at is None
    assert schedule_from_rows("standard", [], None) == CameraSchedule("standard")
    with pytest.raises(ValueError):
        schedule_from_rows("standard", [], "yesterday")
    # Not part of the evaluation rules.
    assert mode_at(schedule, utc("2026-09-15T07:00:00Z")) == "standard"


def test_cache_mode_during_uses_the_same_staleness_rules():
    clock = Clock()
    storage = ScriptedStorage(BUSINESS)
    cache = PrivacyScheduleCache(storage, clock=clock)
    a, b = utc("2026-09-27T23:59:57Z"), utc("2026-09-28T00:00:01Z")
    assert asyncio.run(cache.mode_during(CAM, a, b)) == ("private", "schedule")
    assert asyncio.run(cache.mode_during(CAM, a, a)) == ("standard", "schedule")
    assert asyncio.run(cache.mode_during("not-a-uuid", a, b)) == ("standard", "none")
    clock.now += 601
    storage.script = [ConnectionError("db down")]
    assert asyncio.run(cache.mode_during(CAM, a, a)) == ("private", "fail_closed")


@pytest.mark.parametrize(
    "schedule,captured,received,expected",
    [
        # stamped at 19:00 KST, received 30 s later → standard
        (BUSINESS, "2026-09-15T10:00:00Z", "2026-09-15T10:00:30Z", "standard"),
        # device clock behind: stamped 18:00 KST yesterday, received 09:05 → private at receipt
        (BUSINESS, "2026-09-14T09:00:00Z", "2026-09-15T00:05:00Z", "private"),
        # the window lies between stamp and receipt (25 min apart) → private
        (LUNCH, "2026-09-15T02:55:00Z", "2026-09-15T03:20:00Z", "private"),
        # more than an hour apart: only the ends count → standard
        (LUNCH, "2026-09-15T02:55:00Z", "2026-09-15T04:00:00Z", "standard"),
        # stamped inside the window, received after it → private at capture
        (BUSINESS, "2026-09-15T00:00:00Z", "2026-09-15T10:00:30Z", "private"),
        # captured before the schedule was loosened → private
        (CameraSchedule("standard", loosened_at=utc("2026-09-15T08:00:00Z")),
         "2026-09-15T07:30:00Z", "2026-09-15T10:00:30Z", "private"),
        (CameraSchedule("standard", loosened_at=utc("2026-09-15T08:00:00Z")),
         "2026-09-15T08:30:00Z", "2026-09-15T08:30:05Z", "standard"),
        # Regression — device clock AHEAD (the endpoint accepts up to 300 s):
        # really captured 17:59:58 KST (private), received 18:00:03, stamped
        # 18:00:48. A frame cannot be captured after receipt, so the range
        # judged is [receipt - margin, receipt], not [receipt, captured_at].
        (BUSINESS, "2026-09-15T09:00:48Z", "2026-09-15T09:00:03Z", "private"),
        # ... and once the window is further back than the margin → standard.
        (BUSINESS, "2026-09-15T09:00:48Z", "2026-09-15T09:00:06Z", "standard"),
        # A slightly fast clock on a past stamp: 18:00:02 KST stamped, the
        # margin reaches back into the window → private.
        (BUSINESS, "2026-09-15T09:00:02Z", "2026-09-15T09:00:30Z", "private"),
        # A fast clock must not hide a loosening that happened just before
        # receipt: stamped after the loosening, received 3 s after it.
        (CameraSchedule("standard", loosened_at=utc("2026-09-15T08:30:00Z")),
         "2026-09-15T08:31:00Z", "2026-09-15T08:30:03Z", "private"),
    ],
)
def test_edge_mode(schedule, captured, received, expected):
    cache = PrivacyScheduleCache(ScriptedStorage(schedule))
    assert asyncio.run(cache.edge_mode(CAM, utc(captured), utc(received))) == (expected, "schedule")


def test_edge_mode_fails_closed_and_ignores_ids_without_a_camera():
    assert asyncio.run(PrivacyScheduleCache(ScriptedStorage(ConnectionError("x"))).edge_mode(
        CAM, AT, AT)) == ("private", "fail_closed")
    assert asyncio.run(PrivacyScheduleCache(ScriptedStorage(PRIVATE)).edge_mode(
        "cam-1", AT, AT)) == ("standard", "none")
