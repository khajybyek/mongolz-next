"""Protected stretches of one stored recording (ADR 0012).

Footage captured while its camera was in ``private`` mode is never revealed
and never identified. Every path that renders a stored recording asks the
same question — "which offsets of this video are protected?" — and gets the
same answer from ``load_protected_timeline``:

  * the capture-time spans the pipeline wrote (``recording_privacy_spans``;
    an open span protects until the end of the video), ∪
  * the camera's CURRENT schedule over the capture period, widened by
    ``PRIVACY_SCHEDULE_PAD_SEC`` on both sides.

Why the pad: the pipeline only knows a live frame's capture instant within a
bound (the camera's source clock against the wall clock, re-anchored at every
segment — see ``recording_pipeline``), and ``recordings.started_at`` +
offset is the pipeline's estimate, not the exact instant. The spans record
what the pipeline actually decided; the padded schedule is the backstop for
spans that never reached the database and for windows added after capture
("retroactive" tightening — the schedule part is released again if that
window is later loosened, the span part never is).

Callers:
  * ``reveal_job``    — never matches or un-masks a protected frame; refuses a
                        request that is protected end to end; a read error
                        fails the job closed.
  * ``view_renderer`` — the on-demand playback view and the evidence clip /
                        frame mask protected frames with the detector alone
                        (no embedding computed) and the strongest mask; a read
                        error treats the WHOLE recording as protected (the
                        masked view is still served).
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from privacy_schedule import (
    CameraSchedule,
    PrivacyScheduleUnavailable,
    mode_at,
    mode_during,
    pad_intervals,
    private_intervals,
)

log = logging.getLogger("mongolz-ml.privacy-protection")


def _env_seconds(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, default))
    except ValueError:
        return default
    return value if math.isfinite(value) and value >= 0 else default


# How far the schedule-derived part is widened on each side (seconds). Must be
# at least the pipeline's capture-clock bound (PRIVACY_CLOCK_MARGIN_SEC plus
# live lag and in-segment drift); the pipeline logs a warning whenever a
# tick's bound exceeds it.
PRIVACY_SCHEDULE_PAD_SEC = _env_seconds("PRIVACY_SCHEDULE_PAD_SEC", 60.0)

Offsets = tuple[float, float]


def parse_timestamp(value: object) -> datetime | None:
    """PostgREST timestamptz → aware UTC datetime (naive = UTC); None if unreadable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def finite_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_duration(value: object) -> float | None:
    """``recordings.duration_sec`` (double precision) → positive seconds, else None."""
    seconds = finite_float(value)
    return seconds if seconds is not None and seconds > 0 else None


def span_offsets(row: object) -> Offsets:
    """One ``recording_privacy_spans`` row → [start, end) video offsets.

    ``end_offset_sec`` NULL = never closed (the capture crashed or the close
    was never persisted) → protected until the end of the recording. A row the
    DB constraints would not allow raises ValueError: facts that cannot be
    read are not guessed at (the caller fails closed instead)."""
    if not isinstance(row, dict):
        raise ValueError("privacy span row is not an object")
    start = finite_float(row.get("start_offset_sec"))
    if start is None or start < 0:
        raise ValueError(f"invalid start_offset_sec {row.get('start_offset_sec')!r}")
    if row.get("end_offset_sec") is None:
        return start, math.inf
    end = finite_float(row.get("end_offset_sec"))
    if end is None or end <= start:
        raise ValueError(f"invalid end_offset_sec {row.get('end_offset_sec')!r}")
    return start, end


def merge_offsets(intervals: Iterable[Offsets]) -> tuple[Offsets, ...]:
    merged: list[list[float]] = []
    for a, b in sorted(i for i in intervals if i[0] < i[1]):
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return tuple((a, b) for a, b in merged)


def may_be_private(schedule: CameraSchedule | None) -> bool:
    return schedule is not None and (
        schedule.default == "private" or any(w.mode == "private" for w in schedule.windows)
    )


def _covers_range(intervals: tuple[Offsets, ...], start: float, end: float, end_inclusive: bool) -> bool:
    if end < start or (end == start and not end_inclusive):
        return False
    cursor = start
    for a, b in intervals:
        if b <= cursor:
            continue
        if a > cursor:
            return False  # an unprotected gap at `cursor`
        cursor = b
        if cursor > end or (cursor == end and not end_inclusive):
            return True
    return False


@dataclass(frozen=True)
class ProtectedTimeline:
    """Stretches of one stored video captured in `private` mode (ADR 0012).

    ``intervals`` are merged, sorted half-open [a, b) offsets in seconds of
    the video's own timeline (frame n sits at n / fps — the pipeline's
    ``recorded_frames / fps`` and the renderers' frame time); ``b`` may be
    ``inf`` (an open span: until the end). They are the union of the spans
    and the padded schedule.

    ``span_intervals`` are the capture-time spans alone (None = same as
    ``intervals``): they tell "captured in privacy mode" apart from "withheld
    by the camera's current schedule" in refusal messages.

    The schedule part of ``intervals`` covers [0, ``horizon_sec``) — the
    length ``recordings.duration_sec`` reports. A frame beyond it (a row
    without a duration, or a file longer than its row says) is checked
    against the schedule directly (with the same pad), so no frame escapes it.
    """

    intervals: tuple[Offsets, ...] = ()
    schedule: CameraSchedule | None = None
    started_at: datetime | None = None
    horizon_sec: float = 0.0
    span_intervals: tuple[Offsets, ...] | None = None
    pad_sec: float = 0.0

    @property
    def spans(self) -> tuple[Offsets, ...]:
        return self.intervals if self.span_intervals is None else self.span_intervals

    def covers(self, offset_sec: float) -> bool:
        if any(a <= offset_sec < b for a, b in self.intervals):
            return True
        if self.schedule is not None and self.started_at is not None and offset_sec >= self.horizon_sec:
            at = self.started_at + timedelta(seconds=max(0.0, offset_sec))
            if self.pad_sec > 0:
                pad = timedelta(seconds=self.pad_sec)
                return mode_during(self.schedule, at - pad, at + pad) == "private"
            return mode_at(self.schedule, at) == "private"
        return False

    def covered_by_spans(self, offset_sec: float) -> bool:
        return any(a <= offset_sec < b for a, b in self.spans)

    def covers_range(self, start: float, end: float, *, end_inclusive: bool = False) -> bool:
        """True when every offset of [start, end) — or [start, end] — is
        protected. An empty range is not "covered": there is nothing to refuse."""
        return _covers_range(self.intervals, start, end, end_inclusive)

    def spans_cover_range(self, start: float, end: float, *, end_inclusive: bool = False) -> bool:
        """``covers_range`` for the capture-time spans alone."""
        return _covers_range(self.spans, start, end, end_inclusive)

    def protected_seconds(self, total_sec: float) -> float:
        return sum(max(0.0, min(b, total_sec) - max(a, 0.0)) for a, b in self.intervals)


def fail_closed_timeline() -> ProtectedTimeline:
    """The whole recording protected — for renderers that must fail closed
    but still produce a (fully masked) picture."""
    return ProtectedTimeline(intervals=((0.0, math.inf),), span_intervals=())


def load_protected_timeline(
    storage: Any,
    schedule_cache: Any,
    recording_id: str,
    camera_id: str | None,
    started_at: datetime | None,
    duration_sec: float | None,
    *,
    pad_sec: float | None = None,
) -> ProtectedTimeline:
    """Protected stretches of one recording, as video offsets (module docstring).

    ``started_at`` is the pipeline's capture-time estimate of the stored
    video's offset 0 (frame n of a segment is stamped started_at + n / fps);
    the schedule is evaluated over [started_at, started_at + duration_sec)
    and every private interval widened by ``pad_sec`` on both sides.

    Footage without a camera (browser uploads, or a camera deleted since) is
    judged by its spans alone. Synchronous (PostgREST reads) — run it in a
    worker thread. Raises ``PrivacyScheduleUnavailable`` when either source
    cannot be read or understood.
    """
    pad = PRIVACY_SCHEDULE_PAD_SEC if pad_sec is None else max(0.0, float(pad_sec))
    loader = getattr(storage, "list_privacy_spans", None)
    if loader is None:
        raise PrivacyScheduleUnavailable("privacy span storage is not configured")
    try:
        rows = loader(recording_id)
        if not isinstance(rows, list):
            raise ValueError("invalid privacy span response")
        spans = [span_offsets(row) for row in rows]
    except Exception as exc:  # noqa: BLE001 — every failure means "unknown"
        raise PrivacyScheduleUnavailable(
            f"privacy spans of recording {str(recording_id)[:8]} could not be read ({type(exc).__name__})"
        ) from exc

    schedule = None
    if camera_id:
        # Raises PrivacyScheduleUnavailable on any read error.
        schedule = schedule_cache.schedule_strict(camera_id)
    intervals = list(spans)
    horizon = 0.0
    if may_be_private(schedule):
        if started_at is None:
            # Without the capture time the schedule cannot be placed on the
            # video's timeline — refuse rather than guess.
            raise PrivacyScheduleUnavailable("recording start time is unreadable")
        if duration_sec:
            horizon = duration_sec
            margin = timedelta(seconds=pad)
            try:
                windows = pad_intervals(
                    private_intervals(
                        schedule,
                        started_at - margin,
                        started_at + timedelta(seconds=duration_sec) + margin,
                    ),
                    margin,
                )
            except Exception as exc:  # noqa: BLE001
                raise PrivacyScheduleUnavailable(
                    f"privacy schedule could not be evaluated ({type(exc).__name__})"
                ) from exc
            intervals.extend(
                (max(0.0, (a - started_at).total_seconds()), (b - started_at).total_seconds())
                for a, b in windows
            )
    else:
        schedule = None  # standard only: nothing to evaluate per frame

    protection = ProtectedTimeline(
        intervals=merge_offsets(intervals),
        schedule=schedule,
        started_at=started_at,
        horizon_sec=horizon,
        span_intervals=merge_offsets(spans),
        pad_sec=pad,
    )
    if protection.intervals or protection.schedule is not None:
        log.info(
            "Recording %s: %d privacy span row(s); protected ≈ %.1fs of %s (schedule %s, pad %.0fs)",
            str(recording_id)[:8], len(rows),
            protection.protected_seconds(duration_sec or math.inf),
            f"{duration_sec:.1f}s" if duration_sec else "unknown length",
            "applies" if protection.schedule is not None else "standard only",
            pad,
        )
    return protection
