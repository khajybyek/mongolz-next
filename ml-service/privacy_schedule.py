"""Per-camera privacy schedules — tightening-only (ADR 0012).

Every camera is face-masked on every output (live HLS, on-demand view, baked
MP4) no matter what this module says; un-masking stays exclusively the 4-eyes
reveal job (ADR 0003). A schedule can only make protection STRONGER:

  * ``standard`` — today's behaviour: ArcFace embeddings, sealed face crops +
    ``faces`` rows, suspect matching → ``alerts``; footage may be revealed
    through the 4-eyes reveal job.
  * ``private``  — biometric processing OFF: no embeddings, no face rows or
    crops, no matching, no alerts, no edge inference; footage captured in
    this mode can never be revealed (the reveal job keeps it masked).

Face DETECTION used only to place the blur keeps running in both modes.

Evaluation rules (identical to ``public.effective_privacy_mode()`` in
supabase/migrations/20260928100000_privacy_schedules_enforced.sql — the
shared test vectors live in tests/test_privacy_schedule.py and
supabase/tests/privacy_schedule.test.sql):

  * Time zone Asia/Seoul; ``HH:MM`` strings; ``ends_at`` may be ``24:00``,
    ``starts_at`` may not; ``starts_at != ends_at``.
  * ``weekdays`` bitmask Sun=1, Mon=2 … Sat=64 (bit index = ISO dow % 7).
  * A window belongs to the weekday on which it STARTS: an overnight window
    (``starts_at > ends_at``) set on Friday covers Saturday 02:00, not
    Friday 02:00.
  * Precedence: any active ``private`` window → private; else any active
    ``standard`` window → standard; else the camera's ``privacy_default``;
    a camera id without a ``cameras`` row → standard.
  * The mode applies at CAPTURE time of a frame, not at viewing time.
  * ``cameras.consent_required=true`` overrides all standard windows: no
    consent-satisfaction ledger exists, so biometric processing pauses until
    the gate is removed through the audited admin action.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Callable, Iterable, Literal
from zoneinfo import ZoneInfo

log = logging.getLogger("mongolz-ml.privacy-schedule")

Mode = Literal["standard", "private"]
MODES: tuple[str, ...] = ("standard", "private")
SCHEDULE_TZ = ZoneInfo("Asia/Seoul")
# Edge frames (/edge/detect): seconds before min(captured_at, receipt) that
# still count as a possible capture instant — a device clock running a little
# fast. Same size as the capture pipeline's PRIVACY_CLOCK_MARGIN_SEC default.
EDGE_CLOCK_MARGIN_SEC = 5.0

# Same pattern as the masking_schedules CHECK constraints (20260923180000).
_HHMM_RE = re.compile(r"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$")
_ONE_DAY = timedelta(days=1)


def _hhmm_seconds(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60


def _weekday_bit(day: date) -> int:
    # isoweekday: Mon=1 … Sun=7 → Sun=bit 0, Mon=bit 1 … Sat=bit 6.
    return 1 << (day.isoweekday() % 7)


@dataclass(frozen=True)
class Window:
    """One ``masking_schedules`` row. Invalid values raise ``ValueError``:
    a schedule that cannot be understood must not be half-applied (the
    caller fails closed instead)."""

    mode: Mode
    starts_at: str
    ends_at: str
    weekdays: int

    def __post_init__(self) -> None:
        if self.mode not in MODES:
            raise ValueError(f"invalid window mode {self.mode!r}")
        for name in ("starts_at", "ends_at"):
            value = getattr(self, name)
            if not isinstance(value, str) or not _HHMM_RE.match(value):
                raise ValueError(f"invalid {name} {value!r}")
        if self.starts_at == "24:00":
            raise ValueError("starts_at may not be 24:00")
        if self.starts_at == self.ends_at:
            raise ValueError("starts_at and ends_at must differ (use 00:00-24:00 for a whole day)")
        if isinstance(self.weekdays, bool) or not isinstance(self.weekdays, int) \
                or not 1 <= self.weekdays <= 127:
            raise ValueError(f"invalid weekdays mask {self.weekdays!r}")

    @property
    def start_sec(self) -> int:
        return _hhmm_seconds(self.starts_at)

    @property
    def end_sec(self) -> int:
        return _hhmm_seconds(self.ends_at)

    @property
    def overnight(self) -> bool:
        return self.start_sec > self.end_sec

    def active_at_local(self, local: datetime) -> bool:
        """``local`` is an aware datetime in SCHEDULE_TZ."""
        day = local.date()
        t = local.hour * 3600 + local.minute * 60 + local.second + local.microsecond / 1e6
        s, e = self.start_sec, self.end_sec
        if s < e:
            return bool(self.weekdays & _weekday_bit(day)) and s <= t < e
        return (bool(self.weekdays & _weekday_bit(day)) and t >= s) or (
            bool(self.weekdays & _weekday_bit(day - _ONE_DAY)) and t < e
        )


@dataclass(frozen=True)
class CameraSchedule:
    default: Mode
    windows: tuple[Window, ...] = ()
    # ``cameras.privacy_loosened_at``: when the schedule was last LOOSENED
    # (a standard window added, a private one deleted, default → standard).
    # Not part of the evaluation rules — the current schedule no longer shows
    # the window that was removed, so late deliveries (edge frames captured
    # before a loosening) consult it to stay private.
    loosened_at: datetime | None = None
    # An unsatisfied consent requirement overrides every standard window.
    # There is no verified per-person consent ledger yet; a notice is not
    # evidence that biometric processing is authorised.
    consent_required: bool = False

    def __post_init__(self) -> None:
        if self.default not in MODES:
            raise ValueError(f"invalid privacy_default {self.default!r}")
        windows = tuple(self.windows)
        if not all(isinstance(w, Window) for w in windows):
            raise ValueError("windows must be Window instances")
        object.__setattr__(self, "windows", windows)
        if self.loosened_at is not None:
            if not isinstance(self.loosened_at, datetime):
                raise ValueError(f"invalid loosened_at {self.loosened_at!r}")
            object.__setattr__(self, "loosened_at", _as_utc(self.loosened_at))
        if not isinstance(self.consent_required, bool):
            raise ValueError(f"invalid consent_required {self.consent_required!r}")


def _parse_timestamp(value: Any) -> datetime | None:
    """PostgREST timestamptz → aware UTC datetime; None for NULL. Anything
    else unreadable raises ValueError (never guessed)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return _as_utc(value)
    if not isinstance(value, str) or not value:
        raise ValueError(f"invalid timestamp {value!r}")
    return _as_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


def schedule_from_rows(
    privacy_default: Any, rows: Iterable[dict], loosened_at: Any = None,
    consent_required: Any = False,
) -> CameraSchedule:
    """Build a schedule from ``cameras.privacy_default`` (+ ``privacy_loosened_at``)
    + ``masking_schedules`` rows (``window_mode, starts_at, ends_at, weekdays``).
    Raises ValueError on anything the DB constraints would not have allowed."""
    windows = tuple(
        Window(
            mode=row.get("window_mode"),
            starts_at=row.get("starts_at"),
            ends_at=row.get("ends_at"),
            weekdays=row.get("weekdays"),
        )
        for row in rows
    )
    return CameraSchedule(
        default=privacy_default, windows=windows,
        loosened_at=_parse_timestamp(loosened_at), consent_required=consent_required,
    )


def _as_utc(at: datetime) -> datetime:
    if at.tzinfo is None:
        return at.replace(tzinfo=timezone.utc)
    return at.astimezone(timezone.utc)


def mode_at(schedule: CameraSchedule | None, at: datetime) -> Mode:
    """Mode of a camera at an instant (naive datetimes are UTC).

    ``None`` = no cameras row → standard.
    """
    if schedule is None:
        return "standard"
    if schedule.consent_required:
        return "private"
    local = _as_utc(at).astimezone(SCHEDULE_TZ)
    active = {w.mode for w in schedule.windows if w.active_at_local(local)}
    if "private" in active:
        return "private"
    if "standard" in active:
        return "standard"
    return schedule.default


# ── Intervals ─────────────────────────────────────────────────
Interval = tuple[datetime, datetime]


def _local_instant(day: date, seconds: int) -> datetime:
    """``day`` + ``seconds`` of Seoul wall-clock time, as an aware UTC datetime
    (86400 seconds = the next day's 00:00, i.e. ``24:00``)."""
    midnight = datetime.combine(day, dtime(0), tzinfo=SCHEDULE_TZ)
    return (midnight + timedelta(seconds=seconds)).astimezone(timezone.utc)


def _window_instances(schedule: CameraSchedule, mode: str, start: datetime, end: datetime) -> list[Interval]:
    """Concrete [start, end) instances of every ``mode`` window whose START
    day lies in local days start-1 … end+1 (an overnight window of the day
    before ``start`` can still cover it)."""
    first = start.astimezone(SCHEDULE_TZ).date() - _ONE_DAY
    last = end.astimezone(SCHEDULE_TZ).date() + _ONE_DAY
    out: list[Interval] = []
    day = first
    while day <= last:
        bit = _weekday_bit(day)
        for w in schedule.windows:
            if w.mode != mode or not w.weekdays & bit:
                continue
            a = _local_instant(day, w.start_sec)
            b = _local_instant(day + _ONE_DAY, w.end_sec) if w.overnight else _local_instant(day, w.end_sec)
            out.append((a, b))
        day += _ONE_DAY
    return out


def _merge(intervals: Iterable[Interval]) -> list[Interval]:
    merged: list[list[datetime]] = []
    for a, b in sorted(i for i in intervals if i[0] < i[1]):
        if merged and a <= merged[-1][1]:
            if b > merged[-1][1]:
                merged[-1][1] = b
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def _clip(intervals: Iterable[Interval], start: datetime, end: datetime) -> list[Interval]:
    out = []
    for a, b in intervals:
        a, b = max(a, start), min(b, end)
        if a < b:
            out.append((a, b))
    return out


def _complement(intervals: list[Interval], start: datetime, end: datetime) -> list[Interval]:
    """[start, end) minus the (merged) intervals."""
    out: list[Interval] = []
    cursor = start
    for a, b in _merge(_clip(intervals, start, end)):
        if a > cursor:
            out.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < end:
        out.append((cursor, end))
    return out


def private_intervals(schedule: CameraSchedule | None, start: datetime, end: datetime) -> list[Interval]:
    """Merged [a, b) intervals within [start, end) during which the camera is
    ``private`` — aware UTC datetimes (naive inputs are UTC).

    private = (union of private windows)
              ∪ (default == private ? [start, end) minus union of standard windows : ∅)

    ``mode_at(schedule, t) == "private"`` exactly when ``t`` lies in one of the
    returned intervals.
    """
    if schedule is None:
        return []
    start, end = _as_utc(start), _as_utc(end)
    if start >= end:
        return []
    if schedule.consent_required:
        return [(start, end)]
    private = _window_instances(schedule, "private", start, end)
    if schedule.default == "private":
        standard = _window_instances(schedule, "standard", start, end)
        private = private + _complement(standard, start, end)
    return _merge(_clip(private, start, end))


def mode_during(schedule: CameraSchedule | None, start: datetime, end: datetime) -> Mode:
    """``private`` when the camera is private at ANY instant of the closed
    range [min(start, end), max(start, end)], else ``standard``.

    Used where the capture instant of a frame is only known to lie within a
    bound (the capture pipeline: source clock ↔ wall clock; /edge/detect:
    device clock ↔ receipt): the frame is private if it may have been
    captured in private time. ``start == end`` is exactly ``mode_at``.
    """
    if schedule is None:
        return "standard"
    start, end = _as_utc(start), _as_utc(end)
    if end < start:
        start, end = end, start
    if mode_at(schedule, end) == "private" or private_intervals(schedule, start, end):
        return "private"
    return "standard"


def pad_intervals(intervals: Iterable[Interval], pad: timedelta) -> list[Interval]:
    """Widen every interval by ``pad`` on both sides and merge."""
    return _merge((a - pad, b + pad) for a, b in intervals)


# ── Cache ─────────────────────────────────────────────────────
class PrivacyScheduleUnavailable(RuntimeError):
    """The schedule could not be read. Callers fail closed (private)."""


class PrivacySpanNotFound(LookupError):
    """A ``recording_privacy_spans`` row no longer exists (its recording was
    deleted, cascading the spans). The writer drops the span instead of
    retrying forever."""


def normalize_camera_id(camera_id: Any) -> str | None:
    """Canonical UUID string, or None for a missing / non-UUID id (browser
    uploads and ad-hoc cameras have no cameras row → standard)."""
    if not camera_id or not isinstance(camera_id, str):
        return None
    try:
        return str(uuid.UUID(camera_id))
    except (ValueError, AttributeError):
        return None


@dataclass
class _Entry:
    schedule: CameraSchedule | None = None
    private_hold: bool = False             # acknowledged before consent gate ON DB write
    loaded_at: float | None = None          # clock() of the last successful load
    initial: bool = True                    # first load attempt not finished yet
    forced: bool = False                    # invalidate() → refresh (and wait) next call
    forced_gen: int = 0                     # bumped by invalidate(); a refresh that
                                            # started earlier does not clear `forced`
    next_attempt_at: float = 0.0            # retry backoff after a failed refresh
    warned_at: float | None = None
    refresh: "asyncio.Task | None" = None
    refresh_started_at: float = 0.0


class PrivacyScheduleCache:
    """Per-camera schedule cache for the capture pipeline and /edge/detect.

    ``mode_at`` never blocks the event loop: the PostgREST read runs in a
    worker thread (``asyncio.to_thread``) and concurrent callers for one camera
    share a single refresh. Staleness policy:

      * fresher than ``ttl_sec``       → used as is;
      * older than ``ttl_sec``         → still used while a background refresh
        runs (the capture loop never waits for the database once a camera has a
        schedule), so an edit reaches running cameras within ~``ttl_sec``;
      * older than ``max_stale_sec`` or never loaded → ``("private",
        "fail_closed")``: recognition stays off until the schedule is readable.

    ``hold_private`` is the pre-write consent barrier: it pins the camera
    private before the DB flag changes and survives refresh failure. A hold is
    released only after a fresh DB read confirms consent_required=true.

    The only waits are bounded by ``wait_sec``: the very first load of a camera
    and the first load after ``invalidate()``. A failed refresh keeps the last
    good schedule (until ``max_stale_sec``), is retried after ``retry_sec`` and
    logs at most one warning per ``warn_every_sec`` per camera.
    """

    def __init__(
        self,
        storage: Any,
        *,
        ttl_sec: float = 30,
        max_stale_sec: float = 600,
        clock: Callable[[], float] = time.monotonic,
        wait_sec: float = 2.0,
        retry_sec: float = 5.0,
        warn_every_sec: float = 60.0,
    ):
        self._storage = storage
        self.ttl_sec = float(ttl_sec)
        self.max_stale_sec = float(max_stale_sec)
        self._clock = clock
        self.wait_sec = float(wait_sec)
        self.retry_sec = float(retry_sec)
        self.warn_every_sec = float(warn_every_sec)
        self._entries: dict[str, _Entry] = {}

    # ── reads ────────────────────────────────────────────────
    def _load(self, camera_id: str) -> CameraSchedule | None:
        loader = getattr(self._storage, "load_privacy_schedule", None)
        if loader is None:
            raise PrivacyScheduleUnavailable("privacy schedule storage is not configured")
        schedule = loader(camera_id)
        if schedule is not None and not isinstance(schedule, CameraSchedule):
            raise PrivacyScheduleUnavailable("storage returned an unexpected schedule type")
        return schedule

    def schedule_strict(self, camera_id: str | None) -> CameraSchedule | None:
        """Fresh read for worker threads / the reveal job — never cached.

        None for a missing / non-UUID id or a camera without a cameras row.
        Raises ``PrivacyScheduleUnavailable`` on ANY read error.
        """
        cid = normalize_camera_id(camera_id)
        if cid is None:
            return None
        try:
            return self._load(cid)
        except PrivacyScheduleUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 — every failure means "unknown"
            raise PrivacyScheduleUnavailable(
                f"privacy schedule for camera {cid} could not be read ({type(exc).__name__})"
            ) from exc

    async def _fresh_entry(self, camera_id: str | None) -> tuple[_Entry | None, float]:
        """The camera's cache entry after any refresh that is due (waiting
        only where the class docstring says), and the clock reading to judge
        its staleness by. ``(None, now)`` for a missing / non-UUID id."""
        cid = normalize_camera_id(camera_id)
        if cid is None:
            return None, self._clock()
        entry = self._entries.get(cid)
        if entry is None:
            entry = self._entries[cid] = _Entry()
        now = self._clock()
        stale = entry.loaded_at is None or (now - entry.loaded_at) >= self.ttl_sec
        if entry.forced or stale:
            task = self._ensure_refresh(cid, entry, now)
            if task is not None and (entry.initial or entry.forced):
                remaining = self.wait_sec - (now - entry.refresh_started_at)
                if remaining > 0:
                    try:
                        await asyncio.wait_for(asyncio.shield(task), remaining)
                    except asyncio.TimeoutError:
                        pass
                    except Exception:  # noqa: BLE001, S110 — _refresh records its own failure
                        pass
            now = self._clock()
        return entry, now

    async def mode_at(self, camera_id: str | None, at: datetime) -> tuple[Mode, str]:
        """``(mode, source)``; source is schedule, consent, none or fail_closed."""
        return await self.mode_during(camera_id, at, at)

    async def mode_during(self, camera_id: str | None, start: datetime, end: datetime) -> tuple[Mode, str]:
        """Like ``mode_at`` for a capture instant known only to lie in
        [start, end] (either order): private if ANY instant of it is private
        (see the module function ``mode_during``)."""
        entry, now = await self._fresh_entry(camera_id)
        if entry is None:
            return "standard", "none"
        def decide(schedule: CameraSchedule) -> Mode:
            # A policy was loosened after this frame may have been captured.
            # The present schedule can no longer prove what protected it then.
            earliest = min(_as_utc(start), _as_utc(end))
            if schedule.loosened_at is not None and earliest < schedule.loosened_at:
                return "private"
            return mode_during(schedule, start, end)

        return self._evaluate(entry, now, decide)

    async def edge_mode(
        self,
        camera_id: str | None,
        captured_at: datetime,
        received_at: datetime,
        *,
        max_gap_sec: float = 3600.0,
        clock_margin_sec: float = EDGE_CLOCK_MARGIN_SEC,
    ) -> tuple[Mode, str]:
        """Mode for a frame delivered by an edge agent (``/edge/detect``).

        ``captured_at`` comes from the device clock, which may be wrong
        (no RTC, not yet NTP-synced, running fast) or old (an offline
        outbox). The frame reached the server at ``received_at``, so it was
        captured no later than that: a ``captured_at`` after receipt (device
        clock ahead) only says so. With ``latest = min(captured_at,
        received_at)`` and ``earliest = latest - clock_margin_sec`` (a device
        clock running a little fast), the frame is treated as private when the
        camera is private
          * anywhere in [earliest, received_at], when ``received_at - latest``
            is at most ``max_gap_sec`` (a larger gap would make any delayed
            frame private), or else anywhere in [earliest, latest] or at
            ``received_at``, or
          * the schedule was LOOSENED after ``earliest``
            (``cameras.privacy_loosened_at``): the private time that covered
            the frame may no longer exist in the current schedule.
        """
        entry, now = await self._fresh_entry(camera_id)
        if entry is None:
            return "standard", "none"
        captured, received = _as_utc(captured_at), _as_utc(received_at)
        latest = min(captured, received)
        earliest = latest - timedelta(seconds=max(0.0, clock_margin_sec))

        def decide(schedule: CameraSchedule) -> Mode:
            if schedule.loosened_at is not None and earliest < schedule.loosened_at:
                return "private"
            if (received - latest).total_seconds() <= max_gap_sec:
                return mode_during(schedule, earliest, received)
            if mode_during(schedule, earliest, latest) == "private" or mode_at(schedule, received) == "private":
                return "private"
            return "standard"

        return self._evaluate(entry, now, decide)

    def _evaluate(
        self, entry: _Entry, now: float, decide: Callable[[CameraSchedule], Mode]
    ) -> tuple[Mode, str]:
        if entry.private_hold:
            return "private", "consent"
        # An admin changed a privacy control and asked for a fresh read. Never
        # reuse a previously permissive schedule while that read is pending
        # or failing: recognition must pause immediately.
        if entry.forced:
            return "private", "fail_closed"
        if entry.loaded_at is None or (now - entry.loaded_at) > self.max_stale_sec:
            return "private", "fail_closed"
        if entry.schedule is None:
            return "standard", "none"
        if entry.schedule.consent_required:
            return "private", "consent"
        return decide(entry.schedule), "schedule"

    def _ensure_refresh(self, cid: str, entry: _Entry, now: float) -> "asyncio.Task | None":
        loop = asyncio.get_running_loop()
        task = entry.refresh
        if task is not None and not task.done():
            if task.get_loop() is loop:
                return task
            entry.refresh = None  # left behind by a previous event loop (tests)
        if not (entry.initial or entry.forced) and now < entry.next_attempt_at:
            return None
        entry.refresh_started_at = now
        entry.refresh = loop.create_task(self._refresh(cid, entry))
        return entry.refresh

    async def _refresh(self, cid: str, entry: _Entry) -> None:
        generation = entry.forced_gen
        loaded = False
        try:
            schedule = await asyncio.to_thread(self._load, cid)
        except asyncio.CancelledError:
            # Loop shutdown: not an answer either way, the next call retries.
            raise
        except Exception as exc:  # noqa: BLE001 — keep the last good schedule
            now = self._clock()
            entry.next_attempt_at = now + self.retry_sec
            if entry.warned_at is None or now - entry.warned_at >= self.warn_every_sec:
                entry.warned_at = now
                usable = entry.loaded_at is not None and (now - entry.loaded_at) <= self.max_stale_sec
                log.warning(
                    "camera %s: privacy schedule refresh failed (%s) — %s",
                    cid, type(exc).__name__,
                    "keeping the last good schedule" if usable
                    else "failing closed: recognition off until it is readable",
                )
        else:
            loaded = True
            if entry.warned_at is not None:
                log.info("camera %s: privacy schedule readable again", cid)
                entry.warned_at = None
            entry.schedule = schedule
            entry.loaded_at = self._clock()
            entry.next_attempt_at = 0.0
        entry.initial = False
        if loaded and entry.forced_gen == generation:
            entry.forced = False

    def invalidate(self, camera_id: str | None = None) -> None:
        """Force a refresh on the next ``mode_at`` (all cameras when None).

        The next call waits (bounded by ``wait_sec``) for the fresh read; until
        that read succeeds the camera is private (fail-closed), even when a
        previously loaded schedule said standard.
        """
        if camera_id is None:
            entries = list(self._entries.values())
        else:
            cid = normalize_camera_id(camera_id)
            entries = [self._entries[cid]] if cid is not None and cid in self._entries else []
        for entry in entries:
            entry.forced = True
            entry.forced_gen += 1

    def hold_private(self, camera_id: str) -> None:
        """Pin one camera private before acknowledging a consent-tightening.

        The web action performs the DB write only after the ML process has
        installed this hold and drained its running capture session. The hold
        survives refresh failures and cannot be lifted by a stale schedule.
        """
        cid = normalize_camera_id(camera_id)
        if cid is None:
            raise ValueError("consent hold requires a registered camera UUID")
        entry = self._entries.setdefault(cid, _Entry())
        entry.private_hold = True
        self.invalidate(cid)

    def release_hold_if_consented(self, camera_id: str) -> bool:
        """Lift a pre-write hold only after a fresh read confirms the DB gate."""
        cid = normalize_camera_id(camera_id)
        entry = self._entries.get(cid) if cid is not None else None
        if entry is None or entry.forced or entry.loaded_at is None:
            return False
        if entry.schedule is None or not entry.schedule.consent_required:
            return False
        entry.private_hold = False
        return True


_cache: PrivacyScheduleCache | None = None


def init_privacy_schedule_cache(storage: Any, **kwargs: Any) -> PrivacyScheduleCache:
    """Install the process-wide cache (main.py lifespan, with the shared
    SupabaseStorage)."""
    global _cache
    _cache = PrivacyScheduleCache(storage, **kwargs)
    return _cache


def get_privacy_schedule_cache() -> PrivacyScheduleCache:
    """The process-wide cache used by the pipeline, /edge/detect and the
    reveal job. Used before ``init_privacy_schedule_cache`` it has no storage,
    so every real camera fails closed (private) — never open."""
    global _cache
    if _cache is None:
        log.error("privacy schedule cache used before init — every camera fails closed (private)")
        _cache = PrivacyScheduleCache(None)
    return _cache
