"""An alert must not point at an object that does not exist.

The defect, measured on production (2026-09-09) before the fix:

    alerts                                          13 rows
    …with screenshot_path                            1 row  ('test/trigger.jpg')
    …whose path resolves to an object in ANY bucket   0
    storage.objects in bucket `alert-screenshots`     0  — never written to
    storage.objects in bucket `faces`                48  (47 legacy plaintext
                                                     crops + 1 sealed `.enc`)

Since the Tier-2 encrypt-only change the pipeline uploads ONLY
``<faces.image_path>.enc`` (into the `faces` bucket) — and then wrote the
plain ``<faces.image_path>`` onto the alert row, where the rest of the system
reads it as an `alert-screenshots` path (that is how api/admin/backup maps the
column). So the value was wrong twice over: wrong bucket, and an object that
is never written at all. Every alert screenshot in the UI was a dead link.

The contract pinned here: the alert's evidence is the FACE ROW. The pipeline
writes ``screenshot_path=None`` and ``face_id=<the row it just inserted>``, so
readers resolve the picture through /api/faces/[id]/secure-crop, which
decrypts the sealed crop under the caller's reveal_level.
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

import crypto_utils  # noqa: E402
import recording_pipeline as rp  # noqa: E402
from recording_pipeline import SessionFaceMemory  # noqa: E402

CAM = "44444444-4444-4444-8444-444444444444"
REC = "55555555-5555-4555-8555-555555555555"
MATCH = [{"id": "suspect-1", "name": "Watchlisted person", "similarity": 0.82}]


def emb(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.normal(size=512).astype(np.float32)
    return v / np.linalg.norm(v)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


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
    """Records exactly which objects were uploaded and what was written."""

    def __init__(self, matches=None):
        self.client = object()
        self.faces: list[dict] = []
        self.alerts: list[dict] = []
        self.uploads: list[tuple[str, str]] = []   # (bucket, path)
        self.matches = matches or []

    def upload_bytes(self, bucket, path, data, content_type):
        self.uploads.append((bucket, path))
        return path

    async def insert_face(self, **kw):
        self.faces.append(kw)
        return f"face-{len(self.faces)}"

    async def match_suspects(self, _embedding, threshold=0.45, limit=1):
        return list(self.matches)

    async def insert_alert(self, **kw):
        self.alerts.append(kw)
        return "inserted"


def make_session(storage, engine, monkeypatch):
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"k" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    s = rp.RecordingSession.__new__(rp.RecordingSession)
    s.engine = engine
    s.storage = storage
    s.face_memory = SessionFaceMemory(engine.cosine, face_window_sec=300, recheck_sec=60)
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


def test_alert_never_references_an_unwritten_object(monkeypatch):
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([FakeFace(emb(1))]), monkeypatch)

    run_pass(s, 1000.0, monkeypatch)

    assert len(st.alerts) == 1
    alert = st.alerts[0]
    # The regression: a path was written for an object that is never uploaded.
    assert alert["screenshot_path"] is None
    # …and the evidence that DOES exist is referenced instead.
    assert alert["face_id"] == "face-1"

    # Exactly one object was uploaded for this face, and it is the sealed
    # crop in the `faces` bucket — nothing was written to `alert-screenshots`.
    assert len(st.uploads) == 1
    bucket, path = st.uploads[0]
    assert bucket == "faces" and path.endswith(".enc")
    assert not any(b == "alert-screenshots" for b, _ in st.uploads)


def test_face_row_and_uploaded_object_agree(monkeypatch):
    """faces.image_path + '.enc' is the object; the alert points at the row."""
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([FakeFace(emb(2))]), monkeypatch)

    run_pass(s, 1000.0, monkeypatch)

    row = st.faces[0]
    _, uploaded = st.uploads[0]
    assert uploaded == f"{row['image_path']}.enc"
    assert row["crop_sealed"] is True          # the reader must decrypt it
    assert st.alerts[0]["face_id"] == "face-1"


def test_session_memory_keeps_the_object_that_exists(monkeypatch):
    """The remembered crop path is the sealed object, not the bare path.

    Handing the plain path around is what let it leak onto the alert row.
    """
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([FakeFace(emb(3))]), monkeypatch)

    run_pass(s, 1000.0, monkeypatch)

    entry = s.face_memory._entries[0]
    assert entry.crop_path is not None and entry.crop_path.endswith(".enc")
    assert entry.crop_path == f"{st.faces[0]['image_path']}.enc"
    assert not hasattr(entry, "screenshot_path")


def test_alert_on_recheck_still_carries_no_path(monkeypatch):
    """The second alert for the same person (recheck cadence) reuses the
    remembered entry — the path must not creep back in on that path either."""
    st = FakeStorage(matches=MATCH)
    s = make_session(st, FakeEngine([FakeFace(emb(4))]), monkeypatch)

    run_pass(s, 1000.0, monkeypatch)
    run_pass(s, 1061.0, monkeypatch)   # inside the face window, past the recheck

    assert len(st.faces) == 1          # evidence not duplicated
    assert len(st.alerts) == 2
    assert all(a["screenshot_path"] is None for a in st.alerts)
    assert all(a["face_id"] == "face-1" for a in st.alerts)


def test_storage_insert_alert_still_accepts_a_real_screenshot_path():
    """The column is not abolished — anything that genuinely uploads to
    `alert-screenshots` may still record the path. Only the pipeline stops
    inventing one."""
    import inspect

    from storage import SupabaseStorage

    sig = inspect.signature(SupabaseStorage.insert_alert)
    assert "screenshot_path" in sig.parameters
