"""Session face dedup: the time window that makes a repeat sighting real.

Audit 4.7 — the session memory used to be unbounded in time: a watch-listed
person seen at 09:05 was silently dropped at 14:00 and the next day, because
the frame was deduped BEFORE the suspect match ran. With auto-resume a
capture session lives for days, so «alert me when this person appears»
was only ever true for the first appearance.

These tests pin the fixed contract:
  * inside the window   → no second faces row (evidence is not duplicated);
  * after the window    → the person re-enters BOTH the faces table and the
    alert path;
  * a hit inside the window does NOT extend the window (otherwise a person
    permanently in frame is suppressed forever — the same bug in miniature);
  * the alert layer is re-consulted on a cadence of its own, so alert_rules
    (dedup window, burst, quiet hours) decides what the operator sees;
  * a crop/upload failure no longer swallows the alert.
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault(
    "ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
)

import numpy as np  # noqa: E402
import pytest  # noqa: E402

import crypto_utils  # noqa: E402
import recording_pipeline as rp  # noqa: E402
from recording_pipeline import SessionFaceMemory  # noqa: E402

CAM = "44444444-4444-4444-8444-444444444444"
REC = "55555555-5555-4555-8555-555555555555"


def emb(seed: int) -> np.ndarray:
    """Unit-norm 512-dim vector; different seeds are near-orthogonal."""
    rng = np.random.default_rng(seed)
    v = rng.normal(size=512).astype(np.float32)
    return v / np.linalg.norm(v)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


# ── SessionFaceMemory ────────────────────────────────────────────────────
def memory(face_window=300, recheck=60, max_entries=512) -> SessionFaceMemory:
    return SessionFaceMemory(
        cosine, face_window_sec=face_window, recheck_sec=recheck, max_entries=max_entries
    )


def test_same_person_inside_the_window_is_not_recorded_again():
    m = memory()
    person = emb(1)
    assert m.lookup(person, 1000.0) is None
    m.remember(person, 1000.0, "face-1", "cam/1.jpg")
    entry = m.lookup(person, 1200.0)
    assert entry is not None and entry.face_id == "face-1"


def test_same_person_after_the_window_is_recorded_again():
    m = memory(face_window=300)
    person = emb(1)
    m.remember(person, 1000.0, "face-1", "cam/1.jpg")
    assert m.lookup(person, 1000.0 + 301) is None  # audit 4.7
    assert len(m) == 0  # expired entry pruned, memory does not grow forever


def test_hits_inside_the_window_do_not_extend_it():
    """A person permanently in frame must still re-enter every window —
    a sliding window would reproduce the original bug."""
    m = memory(face_window=300)
    person = emb(1)
    m.remember(person, 1000.0, "face-1", None)
    for t in (1100.0, 1200.0, 1290.0):
        assert m.lookup(person, t) is not None
    assert m.lookup(person, 1301.0) is None


def test_a_different_person_is_never_deduped():
    m = memory()
    m.remember(emb(1), 1000.0, "face-1", None)
    assert m.lookup(emb(2), 1000.0) is None


def test_recheck_cadence_is_independent_of_the_face_window():
    m = memory(face_window=300, recheck=60)
    entry = m.remember(emb(1), 1000.0, "face-1", None)
    assert m.needs_recheck(entry, 1030.0) is False
    assert m.needs_recheck(entry, 1060.0) is True
    m.mark_checked(entry, 1060.0)
    assert m.needs_recheck(entry, 1090.0) is False


def test_recheck_is_clamped_to_the_face_window():
    """A recheck longer than the window is meaningless — expiry already
    re-runs everything."""
    assert memory(face_window=120, recheck=600).recheck_sec == 120


def test_memory_is_capped():
    m = memory(max_entries=4)
    for i in range(10):
        m.remember(emb(i), 1000.0 + i, f"face-{i}", None)
    assert len(m) == 4
    # the newest survivors are kept
    assert m.lookup(emb(9), 1010.0) is not None
    assert m.lookup(emb(0), 1010.0) is None


def test_env_overrides_are_read(monkeypatch):
    monkeypatch.setenv("SESSION_FACE_WINDOW_SEC", "45")
    assert rp._env_int("SESSION_FACE_WINDOW_SEC", 300, minimum=5) == 45
    monkeypatch.setenv("SESSION_FACE_WINDOW_SEC", "nonsense")
    assert rp._env_int("SESSION_FACE_WINDOW_SEC", 300, minimum=5) == 300
    monkeypatch.setenv("SESSION_FACE_WINDOW_SEC", "1")
    assert rp._env_int("SESSION_FACE_WINDOW_SEC", 300, minimum=5) == 5


# ── _process_arcface end to end (no network, no models) ──────────────────
class FakeFace:
    def __init__(self, embedding: np.ndarray):
        self.embedding = embedding
        self.bbox = (10.0, 10.0, 90.0, 90.0)


class FakeEngine:
    def __init__(self, faces):
        self.faces = faces

    def detect_all(self, _image_bytes):
        return list(self.faces)

    @staticmethod
    def cosine(a, b):
        return cosine(a, b)


class FakeStorage:
    """Records what the pipeline actually wrote."""

    def __init__(self, matches=None, upload_error=None):
        self.client = object()
        self.faces: list[dict] = []
        self.alerts: list[dict] = []
        self.uploads: list[str] = []
        self.matches = matches or []
        self.upload_error = upload_error

    def upload_bytes(self, bucket, path, data, content_type):
        if self.upload_error:
            raise self.upload_error
        self.uploads.append(path)
        return path

    async def insert_face(self, **kw):
        self.faces.append(kw)
        return f"face-{len(self.faces)}"

    async def match_suspects(self, _embedding, threshold=0.45, limit=1):
        return list(self.matches)

    async def insert_alert(self, **kw):
        self.alerts.append(kw)
        return "inserted"


def make_session(storage, engine, monkeypatch, face_window=300, recheck=60):
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"k" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    s = rp.RecordingSession.__new__(rp.RecordingSession)
    s.engine = engine
    s.storage = storage
    s.face_memory = SessionFaceMemory(
        engine.cosine, face_window_sec=face_window, recheck_sec=recheck
    )
    s._arcface_lock = asyncio.Lock()
    s._face_chain_index = 0
    s.last_alert_at = {}
    s.recording_id = REC
    s._row_inserted = True
    s.camera_id = CAM
    s.db_camera_id = CAM
    s.camera_name = "Dahua Live"
    return s


def run_pass(session, clock_value, monkeypatch):
    monkeypatch.setattr(rp.time, "time", lambda: clock_value)
    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    asyncio.run(session._process_arcface(frame))


MATCH = [{"id": "suspect-1", "name": "Watchlisted person", "similarity": 0.82}]


def test_repeat_sighting_after_the_window_alerts_again(monkeypatch):
    """The audit's exact scenario: 09:05 alerts, 14:00 must alert too."""
    face = FakeFace(emb(1))
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([face]), monkeypatch, face_window=300)

    run_pass(s, 1000.0, monkeypatch)
    assert len(st.faces) == 1 and len(st.alerts) == 1

    # Same person, hours later: new faces row AND a new trip to insert_alert
    # (whether the operator sees one alert or two is now decided by the alert
    # layer's own dedup window, not silently here).
    run_pass(s, 1000.0 + 18_000, monkeypatch)
    assert len(st.faces) == 2
    assert len(st.alerts) == 2


def test_inside_the_window_no_duplicate_face_row(monkeypatch):
    face = FakeFace(emb(1))
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([face]), monkeypatch, face_window=300, recheck=60)

    run_pass(s, 1000.0, monkeypatch)
    run_pass(s, 1001.0, monkeypatch)  # one second later
    assert len(st.faces) == 1
    assert len(st.alerts) == 1  # ML cooldown + recheck cadence both hold


def test_recheck_reconsults_the_alert_layer_without_a_new_face_row(monkeypatch):
    face = FakeFace(emb(1))
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([face]), monkeypatch, face_window=300, recheck=60)

    run_pass(s, 1000.0, monkeypatch)
    run_pass(s, 1061.0, monkeypatch)  # inside the face window, past the recheck
    assert len(st.faces) == 1          # evidence not duplicated
    assert len(st.alerts) == 2         # alert_rules gets to decide again
    assert st.alerts[1]["face_id"] == "face-1"  # the stored crop stays the evidence


def test_alert_cooldown_still_caps_the_rate(monkeypatch):
    face = FakeFace(emb(1))
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([face]), monkeypatch, face_window=300, recheck=5)

    run_pass(s, 1000.0, monkeypatch)
    run_pass(s, 1006.0, monkeypatch)  # recheck due, but inside ALERT_COOLDOWN_SEC
    assert len(st.alerts) == 1
    run_pass(s, 1016.0, monkeypatch)
    assert len(st.alerts) == 2


def test_crop_upload_failure_still_raises_the_alert(monkeypatch):
    """A Storage blip must not silently hide a watch-listed person."""
    face = FakeFace(emb(1))
    st = FakeStorage(matches=MATCH, upload_error=ConnectionError("storage down"))
    s = make_session(st, FakeEngine([face]), monkeypatch)

    run_pass(s, 1000.0, monkeypatch)
    assert st.faces == []              # no plaintext fallback was written
    assert len(st.alerts) == 1
    assert st.alerts[0]["face_id"] is None
    assert st.alerts[0]["screenshot_path"] is None


def test_failed_evidence_is_retried_on_the_recheck_cadence(monkeypatch):
    """A Storage outage must not cost 5 minutes of evidence, and must not
    turn into a per-second retry loop either."""
    face = FakeFace(emb(1))
    st = FakeStorage(matches=MATCH, upload_error=ConnectionError("storage down"))
    s = make_session(st, FakeEngine([face]), monkeypatch, face_window=300, recheck=60)

    run_pass(s, 1000.0, monkeypatch)
    run_pass(s, 1030.0, monkeypatch)       # inside the short TTL — no retry
    assert st.uploads == [] and st.faces == []
    st.upload_error = None
    run_pass(s, 1061.0, monkeypatch)       # TTL expired → evidence written
    assert len(st.faces) == 1


def test_alert_insert_failure_does_not_kill_the_remaining_faces(monkeypatch):
    class _Failing(FakeStorage):
        async def match_suspects(self, _embedding, threshold=0.45, limit=1):
            # distinct suspects so the per-suspect cooldown doesn't mask the
            # second attempt
            n = len(self.alerts) + 1
            return [{"id": f"suspect-{n}", "name": f"Person {n}", "similarity": 0.8}]

        async def insert_alert(self, **kw):
            self.alerts.append(kw)
            raise RuntimeError("alerts insert failed")

    faces = [FakeFace(emb(1)), FakeFace(emb(2))]
    st = _Failing(matches=MATCH)
    s = make_session(st, FakeEngine(faces), monkeypatch)

    run_pass(s, 1000.0, monkeypatch)
    assert len(st.faces) == 2   # the second face was still persisted
    assert len(st.alerts) == 2  # and its alert was still attempted


def test_two_people_in_frame_are_both_recorded(monkeypatch):
    faces = [FakeFace(emb(1)), FakeFace(emb(2))]
    st = FakeStorage()
    s = make_session(st, FakeEngine(faces), monkeypatch)
    run_pass(s, 1000.0, monkeypatch)
    assert len(st.faces) == 2
    assert {f["chain_index"] for f in st.faces} == {0, 1}


def test_non_finite_similarity_never_alerts(monkeypatch):
    st = FakeStorage(matches=[{"id": "s", "name": "x", "similarity": "nan"}])
    s = make_session(st, FakeEngine([FakeFace(emb(1))]), monkeypatch)
    run_pass(s, 1000.0, monkeypatch)
    assert st.alerts == []


def test_detection_failure_is_visible_in_the_logs(monkeypatch, caplog):
    """A broken engine blinds the whole alert path; it used to be log.debug
    (invisible at production log level)."""
    class _BrokenEngine(FakeEngine):
        def detect_all(self, _image_bytes):
            raise RuntimeError("engine unloaded")

    st = FakeStorage(matches=MATCH)
    s = make_session(st, _BrokenEngine([]), monkeypatch)
    with caplog.at_level("WARNING", logger="mongolz-ml.recording"):
        run_pass(s, 1000.0, monkeypatch)
        run_pass(s, 1001.0, monkeypatch)
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1  # first failure warns, the rest are rate-limited
    assert "engine unloaded" in warnings[0].getMessage()
    assert st.faces == [] and st.alerts == []
    assert s._detect_failures == 2


def test_detection_recovery_is_reported(monkeypatch, caplog):
    class _Flaky(FakeEngine):
        def __init__(self, faces):
            super().__init__(faces)
            self.fail = True

        def detect_all(self, _image_bytes):
            if self.fail:
                raise RuntimeError("transient")
            return list(self.faces)

    engine = _Flaky([FakeFace(emb(1))])
    st = FakeStorage()
    s = make_session(st, engine, monkeypatch)
    run_pass(s, 1000.0, monkeypatch)
    engine.fail = False
    with caplog.at_level("INFO", logger="mongolz-ml.recording"):
        run_pass(s, 1001.0, monkeypatch)
    assert s._detect_failures == 0
    assert any("сэргэлээ" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("outcome", ["merged", "quiet_hours", "burst_pending", "no_client"])
def test_non_insert_outcomes_are_tolerated(monkeypatch, outcome):
    class _Outcome(FakeStorage):
        async def insert_alert(self, **kw):
            self.alerts.append(kw)
            return outcome

    st = _Outcome(matches=MATCH)
    s = make_session(st, FakeEngine([FakeFace(emb(1))]), monkeypatch)
    run_pass(s, 1000.0, monkeypatch)
    assert len(st.alerts) == 1
