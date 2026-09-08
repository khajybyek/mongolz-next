"""insert_alert: rule selection, dedup and the operator workflow.

Audit 4.7/4.8 follow-up. Two regressions are pinned here:

  * the dedup key used to embed ``floor(now / window)``, so two sightings a
    couple of seconds apart raised TWO alerts whenever they straddled a
    bucket boundary — and two sightings a whole window apart could still
    merge because they shared a bucket;
  * a merge landed on ANY row with the key, including one the operator had
    already CLOSED, so a closed incident silently grew match_count instead
    of the re-appearance showing up in the queue.

No network: a fake supabase-py client keeps the alerts in a dict and
implements the filters insert_alert actually uses.
"""

from __future__ import annotations

import asyncio
import os
import types
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")

import pytest  # noqa: E402

import storage as storage_mod  # noqa: E402
from storage import SupabaseStorage  # noqa: E402

SUSPECT = "11111111-1111-4111-8111-111111111111"
CAMERA = "22222222-2222-4222-8222-222222222222"
# A wall-clock instant chosen so that t0 and t0+2 fall in DIFFERENT
# floor(now / 300) buckets — the exact shape that used to split one incident
# into two alerts seconds apart.
BOUNDARY_T = 1_800_000_299.0
assert int(BOUNDARY_T // 300) != int((BOUNDARY_T + 2) // 300)


# ── fake clock ───────────────────────────────────────────────────────────
class Clock:
    def __init__(self, t: float = BOUNDARY_T):
        self.t = t

    def advance(self, seconds: float) -> None:
        self.t += seconds

    def iso(self, offset: float = 0.0) -> str:
        return datetime.fromtimestamp(self.t + offset, timezone.utc).isoformat()


@pytest.fixture
def clock(monkeypatch) -> Clock:
    c = Clock()
    monkeypatch.setattr(storage_mod, "_unix_now", lambda: c.t)
    monkeypatch.setattr(storage_mod, "_iso_now", lambda: c.iso())
    monkeypatch.setattr(storage_mod, "_iso_minutes_ago", lambda seconds: c.iso(-seconds))
    # burst state is module-global; a leftover deque would change outcomes
    storage_mod._BURST_WINDOWS.clear()
    return c


def _parse(value):
    return datetime.fromisoformat(value) if isinstance(value, str) else value


# ── fake supabase-py client ──────────────────────────────────────────────
class _AlertQuery:
    def __init__(self, client: "FakeClient"):
        self.c = client
        self._op = None
        self._payload = None
        self._filters: list[tuple[str, str, object]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None

    # builders
    def select(self, _cols):
        self._op = "select"
        return self

    def insert(self, row):
        self._op, self._payload = "insert", row
        return self

    def update(self, fields):
        self._op, self._payload = "update", fields
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col, val):
        self._filters.append(("neq", col, val))
        return self

    def gte(self, col, val):
        self._filters.append(("gte", col, val))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    # execution
    def _matches(self, row) -> bool:
        for op, col, val in self._filters:
            cur = row.get(col)
            if op == "eq" and cur != val:
                return False
            if op == "neq" and cur == val:
                return False
            if op == "gte":
                if cur is None or _parse(cur) < _parse(val):
                    return False
        return True

    def execute(self):
        self.c.calls.append((self._op, list(self._filters)))
        if self._op == "insert":
            row = dict(self._payload)
            row.setdefault("id", f"alert-{len(self.c.alerts) + 1}")
            row.setdefault("state", "new")
            row.setdefault("created_at", self.c.now_iso())
            self.c.alerts[row["id"]] = row
            return types.SimpleNamespace(data=[row])
        if self._op == "update":
            if self.c.before_update:
                self.c.before_update()
                self.c.before_update = None
            updated = []
            for row in self.c.alerts.values():
                if self._matches(row):
                    row.update(self._payload)
                    updated.append(row)
            return types.SimpleNamespace(data=updated)
        rows = [r for r in self.c.alerts.values() if self._matches(r)]
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: _parse(r.get(col)), reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return types.SimpleNamespace(data=rows)


class _RulesQuery:
    def __init__(self, client: "FakeClient"):
        self.c = client
        self._min_similarity = 1.0

    def select(self, _cols):
        return self

    def eq(self, _col, _val):
        return self

    def lte(self, _col, val):
        # min_similarity picks WHICH rule applies; it is not an alert gate
        # (audit 4.8 is answered on the web side — see
        # app/api/alerts/apply-threshold/route.ts).
        self._min_similarity = val
        return self

    def execute(self):
        if self.c.rules_error:
            raise self.c.rules_error
        rows = [
            r for r in self.c.rules
            if float(r.get("min_similarity", 0)) <= float(self._min_similarity)
        ]
        return types.SimpleNamespace(data=rows)


class FakeClient:
    def __init__(self, rules=None, rules_error=None, clock: Clock | None = None):
        self.alerts: dict[str, dict] = {}
        self.rules = rules or []
        self.rules_error = rules_error
        self.calls: list = []
        self.before_update = None  # hook: simulate a close landing mid-merge
        self._clock = clock

    def now_iso(self) -> str:
        return self._clock.iso() if self._clock else datetime.now(timezone.utc).isoformat()

    def table(self, name):
        if name == "alerts":
            return _AlertQuery(self)
        if name == "alert_rules":
            return _RulesQuery(self)
        raise AssertionError(f"unexpected table {name}")


def make_storage(clock: Clock, **kw) -> tuple[SupabaseStorage, FakeClient]:
    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = FakeClient(clock=clock, **kw)
    return st, st.client


def sighting(st: SupabaseStorage, similarity: float = 0.9, camera: str | None = CAMERA) -> str:
    return asyncio.run(
        st.insert_alert(
            suspect_id=SUSPECT,
            suspect_name="Watchlisted person",
            face_id="face-1",
            similarity=similarity,
            screenshot_path="cam/face.jpg",
            camera_id=camera,
            camera_name="Dahua Live",
        )
    )


# ── dedup window ─────────────────────────────────────────────────────────
def test_two_sightings_inside_the_window_merge_without_a_rule(clock):
    """No alert_rules row exists in this deployment — «no rule» must still
    mean «dedup», otherwise every sighting writes its own alert."""
    st, fake = make_storage(clock)

    assert sighting(st) == "inserted"
    clock.advance(120)
    assert sighting(st, similarity=0.95) == "merged"

    assert len(fake.alerts) == 1
    row = next(iter(fake.alerts.values()))
    assert row["match_count"] == 2
    assert row["similarity"] == 0.95  # the strongest sighting wins
    assert _parse(row["last_seen_at"]) == _parse(clock.iso())


def test_sighting_after_the_window_raises_a_new_alert(clock):
    st, fake = make_storage(clock)
    assert sighting(st) == "inserted"
    clock.advance(storage_mod.DEFAULT_DEDUP_WINDOW_SEC + 1)
    assert sighting(st) == "inserted"
    assert len(fake.alerts) == 2


def test_boundary_sightings_seconds_apart_produce_one_alert(clock):
    """Regression: the old floor(now/window) key split this into two alerts."""
    st, fake = make_storage(clock)
    assert sighting(st) == "inserted"
    clock.advance(2)  # crosses a 300 s bucket boundary
    assert sighting(st) == "merged"
    assert len(fake.alerts) == 1
    key = next(iter(fake.alerts.values()))["dedup_key"]
    assert key == f"{SUSPECT}:{CAMERA}"  # suspect + camera only, no time bucket


def test_window_slides_with_last_seen_at(clock):
    """A person who keeps being seen stays ONE incident: the window is
    measured from last_seen_at, not from the alert's creation."""
    st, fake = make_storage(clock)
    assert sighting(st) == "inserted"
    for _ in range(4):
        clock.advance(200)  # < 300 s since the previous sighting each time
        assert sighting(st) == "merged"
    assert len(fake.alerts) == 1
    assert next(iter(fake.alerts.values()))["match_count"] == 5


def test_camera_is_part_of_the_key(clock):
    st, fake = make_storage(clock)
    assert sighting(st) == "inserted"
    clock.advance(5)
    assert sighting(st, camera="33333333-3333-4333-8333-333333333333") == "inserted"
    assert len(fake.alerts) == 2


# ── operator workflow ────────────────────────────────────────────────────
def test_closed_alert_is_never_merged_into(clock):
    st, fake = make_storage(clock)
    assert sighting(st) == "inserted"
    closed = next(iter(fake.alerts.values()))
    closed.update({"state": "closed", "closed_at": clock.iso()})

    clock.advance(30)  # well inside the dedup window
    assert sighting(st) == "inserted"

    assert len(fake.alerts) == 2
    assert closed["match_count"] == 1  # untouched
    assert closed["state"] == "closed"
    fresh = [r for r in fake.alerts.values() if r["id"] != closed["id"]][0]
    assert fresh["state"] == "new"


def test_acknowledged_alert_still_merges(clock):
    """Deliberate: acknowledged means «I am handling this», so a repeat
    sighting belongs to the same incident (and bumps match_count)."""
    st, fake = make_storage(clock)
    sighting(st)
    row = next(iter(fake.alerts.values()))
    row["state"] = "acknowledged"
    clock.advance(10)
    assert sighting(st) == "merged"
    assert len(fake.alerts) == 1
    assert row["state"] == "acknowledged" and row["match_count"] == 2


def test_close_landing_mid_merge_falls_back_to_a_new_alert(clock):
    """The read said «open», the operator closed it before the UPDATE ran.
    The CAS (.neq state closed) must win and the sighting must not be lost."""
    st, fake = make_storage(clock)
    sighting(st)
    row = next(iter(fake.alerts.values()))
    fake.before_update = lambda: row.update({"state": "closed"})

    clock.advance(10)
    assert sighting(st) == "inserted"
    assert len(fake.alerts) == 2
    assert row["match_count"] == 1


def test_older_open_alert_is_used_when_the_newest_is_closed(clock):
    st, fake = make_storage(clock)
    sighting(st)
    older = next(iter(fake.alerts.values()))
    older["state"] = "acknowledged"
    # A second, newer row for the same key that the operator closed.
    newer = dict(older)
    newer.update({"id": "alert-closed", "state": "closed", "last_seen_at": clock.iso(1)})
    fake.alerts[newer["id"]] = newer

    clock.advance(10)
    assert sighting(st) == "merged"
    assert older["match_count"] == 2 and newer["match_count"] == 1
    assert len(fake.alerts) == 2


# ── rules ────────────────────────────────────────────────────────────────
def _rule(**kw) -> dict:
    base = {
        "id": "rule-1",
        "name": "test rule",
        "suspect_id": None,
        "camera_id": None,
        "min_similarity": 0.4,
        "dedup_window_sec": 600,
        "burst_count": 1,
        "burst_window_sec": 60,
        "quiet_from": None,
        "quiet_to": None,
    }
    base.update(kw)
    return base


def test_rule_window_wins_over_the_default(clock):
    st, fake = make_storage(clock, rules=[_rule(dedup_window_sec=600)])
    assert sighting(st) == "inserted"
    clock.advance(400)  # past the 300 s default, inside the rule's 600 s
    assert sighting(st) == "merged"
    assert len(fake.alerts) == 1
    assert next(iter(fake.alerts.values()))["rule_id"] == "rule-1"


def test_rule_window_zero_disables_dedup(clock):
    """An admin who sets 0 asked for «every sighting is its own alert»."""
    st, fake = make_storage(clock, rules=[_rule(dedup_window_sec=0)])
    assert sighting(st) == "inserted"
    clock.advance(1)
    assert sighting(st) == "inserted"
    assert len(fake.alerts) == 2
    assert all(r["dedup_key"] is None for r in fake.alerts.values())


def test_rule_read_failure_falls_back_to_the_default_window(clock):
    """A transient alert_rules failure must not silently turn dedup off."""
    st, fake = make_storage(clock, rules_error=RuntimeError("db down"))
    assert sighting(st) == "inserted"
    clock.advance(10)
    assert sighting(st) == "merged"
    assert len(fake.alerts) == 1


def test_quiet_hours_suppress_and_report(clock, monkeypatch):
    monkeypatch.setattr(storage_mod, "_within_quiet_hours", lambda *_: True)
    st, fake = make_storage(clock, rules=[_rule(quiet_from="23:00", quiet_to="07:00")])
    assert sighting(st) == "quiet_hours"
    assert fake.alerts == {}


def test_burst_smoothing_holds_until_the_count_is_reached(clock):
    st, fake = make_storage(clock, rules=[_rule(burst_count=3, burst_window_sec=600)])
    assert sighting(st) == "burst_pending"
    clock.advance(10)
    assert sighting(st) == "burst_pending"
    clock.advance(10)
    assert sighting(st) == "inserted"
    assert len(fake.alerts) == 1


def test_malformed_rule_numbers_do_not_crash(clock):
    """PostgREST returns numerics as strings; a NULL window falls back."""
    st, fake = make_storage(
        clock, rules=[_rule(dedup_window_sec=None, burst_count="1", min_similarity="0.400")]
    )
    assert sighting(st) == "inserted"
    clock.advance(10)
    assert sighting(st) == "merged"


@pytest.mark.parametrize("order", [lambda rs: rs, lambda rs: rs[::-1]])
def test_equal_specificity_rules_pick_a_deterministic_winner(clock, order):
    """Two rules of the same specificity used to be resolved by whatever
    order PostgREST returned — a different dedup window and quiet window on
    every restart. The rule aimed closest at this match wins."""
    rules = [
        _rule(id="rule-a", min_similarity=0.4, dedup_window_sec=30),
        _rule(id="rule-b", min_similarity=0.8, dedup_window_sec=900),
    ]
    st, fake = make_storage(clock, rules=order(rules))
    assert sighting(st, similarity=0.9) == "inserted"
    assert next(iter(fake.alerts.values()))["rule_id"] == "rule-b"


def test_a_match_under_every_rule_floor_still_dedups(clock):
    """audit 4.8: raising a floor drops the rule, and «no rule» used to mean
    «no dedup window» — so the weak matches an operator tried to suppress
    arrived UNGROUPED. They now fall back to the default window."""
    st, fake = make_storage(clock, rules=[_rule(min_similarity=0.9)])
    assert sighting(st, similarity=0.5) == "inserted"
    clock.advance(10)
    assert sighting(st, similarity=0.5) == "merged"
    assert len(fake.alerts) == 1
    assert next(iter(fake.alerts.values()))["rule_id"] is None


def test_without_a_client_the_caller_is_told(clock):
    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = None
    assert sighting(st) == "no_client"


def test_terminal_insert_failure_propagates(clock):
    """A lost alert must never look like a delivered one."""
    st, fake = make_storage(clock)

    class _Broken(_AlertQuery):
        def execute(self):
            raise RuntimeError("insert failed")

    fake.table = lambda name: _Broken(fake) if name == "alerts" else _RulesQuery(fake)
    with pytest.raises(RuntimeError):
        sighting(st)
