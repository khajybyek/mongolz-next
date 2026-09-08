"""Demo camera sources (demo://<name>), the camera_sessions auto-resume
registry, the crash supervisor and optional Sentry init."""

from __future__ import annotations

import numpy as np
import asyncio
import base64
import os
import secrets
import shutil
import subprocess
import sys
import types
from datetime import datetime, timezone

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")
os.environ.setdefault(
    "ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
)

import cv2  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import camera_worker  # noqa: E402
import demo_source  # noqa: E402
import main  # noqa: E402
import storage as storage_mod  # noqa: E402
from camera_worker import CameraManager, CameraSupervision, backoff_delay  # noqa: E402
from storage import SupabaseStorage, seal_camera_url, unseal_camera_url  # noqa: E402

HEADERS = {"Authorization": "Bearer test-token"}
CAM_UUID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7"
_FFMPEG = shutil.which("ffmpeg") is not None
needs_ffmpeg = pytest.mark.skipif(not _FFMPEG, reason="ffmpeg binary not on PATH")


# ── demo:// URL validation ───────────────────────────────────────────────
@pytest.mark.parametrize("url", ["demo://lobby", "demo://gate", "demo://parking", "demo://cam_01-x"])
def test_camera_start_accepts_demo_urls(url):
    assert main.CameraStartReq(camera_id="cam-1", url=url).url == url


@pytest.mark.parametrize(
    "url",
    ["demo://", "demo://Lobby", "demo://lob by", "demo://a/b", "demo://" + "x" * 33, "demo:lobby", "file:///tmp/x"],
)
def test_camera_start_rejects_malformed_demo_urls(url):
    with pytest.raises(ValidationError):
        main.CameraStartReq(camera_id="cam-1", url=url)


_HAVE_SAMPLES = all(
    os.path.isfile(os.path.join(os.path.dirname(__file__), "..", "samples", f))
    for f in ("00.jpg", "01.jpg", "02.jpg")
)
needs_samples = pytest.mark.skipif(not _HAVE_SAMPLES, reason="ml-service/samples/*.jpg missing (gitignored)")


def test_camera_start_still_accepts_network_sources():
    assert main.CameraStartReq(camera_id="cam-1", url="rtsp://u:p@h:554/s").fps == 15
    assert main.CameraStartReq(camera_id="cam-1", url="0").url == "0"


# ── demo source resolution ───────────────────────────────────────────────
def test_is_demo_url_and_name():
    assert demo_source.is_demo_url("demo://lobby")
    assert demo_source.is_demo_url("demo://unknown-name")  # shape only
    assert not demo_source.is_demo_url("rtsp://h/s")
    assert not demo_source.is_demo_url(0)
    assert demo_source.demo_name("demo://gate") == "gate"
    assert demo_source.demo_name("demo://unknown-name") is None
    assert demo_source.DEMO_SOURCES == {"lobby", "gate", "parking"}


def test_resolve_unknown_demo_source_raises_without_ffmpeg(monkeypatch, tmp_path):
    monkeypatch.setattr(demo_source, "DEMO_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="unknown demo source"):
        demo_source.resolve_demo_source("demo://nope")
    with pytest.raises(ValueError):
        demo_source.resolve_demo_source("rtsp://h/s")
    assert not list(tmp_path.iterdir())


def test_build_ffmpeg_cmd_differs_per_name():
    cmds = {n: " ".join(demo_source.build_ffmpeg_cmd(n, "/x.mp4")) for n in demo_source.DEMO_SOURCES}
    assert len(set(cmds.values())) == 3
    for cmd in cmds.values():
        assert "zoompan" in cmd and "concat=n=3" in cmd and f"s={demo_source.DEMO_WIDTH}x{demo_source.DEMO_HEIGHT}" in cmd


@needs_ffmpeg
@needs_samples
def test_generated_demo_video_opens_and_loops_worth_of_frames(monkeypatch, tmp_path):
    monkeypatch.setattr(demo_source, "DEMO_DIR", str(tmp_path))
    path = demo_source.resolve_demo_source("demo://lobby")
    assert path == str(tmp_path / "lobby.mp4") and os.path.getsize(path) > 0

    cap = cv2.VideoCapture(path)
    try:
        assert cap.isOpened()
        assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) >= 100
        assert int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) == demo_source.DEMO_WIDTH
        assert int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) == demo_source.DEMO_HEIGHT
        assert round(cap.get(cv2.CAP_PROP_FPS)) == demo_source.DEMO_FPS
        ok, frame = cap.read()
        assert ok and frame is not None
    finally:
        cap.release()

    # Cached: a second resolve must not regenerate (mtime unchanged) and an
    # empty cache file must be regenerated.
    mtime = os.path.getmtime(path)
    assert demo_source.resolve_demo_source("demo://lobby") == path
    assert os.path.getmtime(path) == mtime
    open(path, "wb").close()
    assert os.path.getsize(demo_source.resolve_demo_source("demo://lobby")) > 0


# ── /camera/test for demo names ──────────────────────────────────────────
def test_camera_test_demo_names_do_not_probe(monkeypatch):
    def boom(_url):  # a demo URL must never reach cv2
        raise AssertionError("probe called")

    monkeypatch.setattr(main, "_probe_camera_sync", boom)
    client = TestClient(main.app)
    ok = client.post("/camera/test", json={"url": "demo://lobby", "cam_type": "demo"}, headers=HEADERS)
    assert ok.status_code == 200
    assert ok.json() == {"ok": True, "info": {"width": 640, "height": 360, "fps": 15}}

    bad = client.post("/camera/test", json={"url": "demo://nope", "cam_type": "rtsp"}, headers=HEADERS)
    assert bad.status_code == 200
    assert bad.json()["ok"] is False and "lobby" in bad.json()["error"]


def test_camera_start_rejects_unknown_demo_name(monkeypatch):
    class _Mgr:
        async def start(self, *a, **k):
            raise AssertionError("must not start")

    monkeypatch.setattr(main, "camera_manager", _Mgr())
    res = TestClient(main.app).post(
        "/camera/start", json={"camera_id": "cam-1", "url": "demo://nope"}, headers=HEADERS
    )
    assert res.status_code == 400
    assert "unknown demo source" in res.text


# ── backoff schedule ─────────────────────────────────────────────────────
def test_backoff_schedule():
    assert [backoff_delay(n) for n in range(8)] == [5, 10, 20, 40, 80, 160, 300, 300]
    assert backoff_delay(-1) == 5
    assert backoff_delay(50) == 300


# ── sealing round trip through the storage helpers ───────────────────────
class _Query:
    """Minimal supabase-py table() stand-in recording upserts/updates and
    answering selects from the recorded rows."""

    def __init__(self, store: dict, calls: list):
        self.store, self.calls = store, calls
        self._op = None
        self._payload = None
        self._filters: list[tuple[str, object]] = []

    def upsert(self, row, on_conflict=None):
        self._op, self._payload = "upsert", (row, on_conflict)
        return self

    def update(self, fields):
        self._op, self._payload = "update", fields
        return self

    def select(self, _cols):
        self._op = "select"
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def execute(self):
        self.calls.append((self._op, self._payload, list(self._filters)))
        if self._op == "upsert":
            row, on_conflict = self._payload
            assert on_conflict == "camera_id"
            self.store[row["camera_id"]] = dict(row)
            return types.SimpleNamespace(data=[row])
        if self._op == "update":
            for cid, row in self.store.items():
                if all(row.get(c) == v for c, v in self._filters):
                    row.update(self._payload)
            return types.SimpleNamespace(data=[])
        rows = [r for r in self.store.values() if all(r.get(c) == v for c, v in self._filters)]
        return types.SimpleNamespace(data=rows)


class _FakeClient:
    def __init__(self):
        self.store: dict = {}
        self.calls: list = []

    def table(self, name):
        assert name == "camera_sessions"
        return _Query(self.store, self.calls)


def _storage_with_fake_client() -> tuple[SupabaseStorage, _FakeClient]:
    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = _FakeClient()
    return st, st.client


def test_seal_round_trip_via_storage_helpers():
    st, fake = _storage_with_fake_client()
    url = "rtsp://admin:s3cret@192.168.0.15:554/h264"
    sealed = seal_camera_url(CAM_UUID, url)
    assert "s3cret" not in sealed and "192.168" not in sealed
    assert st.upsert_camera_session(CAM_UUID, sealed, "Gate A", 12) is True

    rows = st.list_resumable_sessions()
    assert [r["camera_id"] for r in rows] == [CAM_UUID]
    assert rows[0]["auto_resume"] is True and rows[0]["fps"] == 12 and rows[0]["last_error"] is None
    assert unseal_camera_url(CAM_UUID, rows[0]["sealed_url"]) == url
    # Context is per camera — another camera's id cannot unseal it.
    with pytest.raises(Exception):
        unseal_camera_url("00000000-0000-4000-8000-000000000000", rows[0]["sealed_url"])

    assert st.set_camera_session_resume(CAM_UUID, False) is True
    assert st.list_resumable_sessions() == []
    assert st.record_camera_session_error(CAM_UUID, "x" * 900) is True
    assert len(fake.store[CAM_UUID]["last_error"]) == 500


def test_storage_helpers_swallow_client_errors():
    st = SupabaseStorage.__new__(SupabaseStorage)

    class _Broken:
        def table(self, _n):
            raise RuntimeError("db down")

    st.client = _Broken()
    assert st.upsert_camera_session(CAM_UUID, "sealed", None, 15) is False
    assert st.set_camera_session_resume(CAM_UUID, False) is False
    assert st.record_camera_session_error(CAM_UUID, "e") is False
    assert st.list_resumable_sessions() == []

    st.client = None
    assert st.upsert_camera_session(CAM_UUID, "sealed", None, 15) is False
    assert st.list_resumable_sessions() == []


# ── /camera/active exposes supervisor state ──────────────────────────────
class _LiveTask:
    def done(self):
        return False


class _DoneTask:
    def __init__(self, exc=None):
        self._exc = exc

    def done(self):
        return True

    def exception(self):
        return self._exc


class _FakeSession:
    def __init__(self, task, name="Gate A", fps=15, exit_reason=None):
        self.task = task
        self.camera_name = name
        self.fps = fps
        self.source_url = "rtsp://admin:secret@10.0.0.5/stream"
        self.started_at = datetime(2026, 9, 7, 1, 2, 3, tzinfo=timezone.utc)
        self.stopped_by_user = False
        self.exit_reason = exit_reason
        self.db_camera_id = CAM_UUID
        self.stops = 0

    async def start(self):
        pass

    async def stop(self):
        self.stops += 1


def test_camera_active_reports_restart_count_and_last_error(monkeypatch):
    class _Manager:
        def __init__(self):
            self.sessions = {"cam-live": _FakeSession(_LiveTask()), "cam-done": _FakeSession(_DoneTask())}
            self.supervision = {
                "cam-live": CameraSupervision(
                    url="rtsp://admin:secret@10.0.0.5/stream", fps=15, camera_name="Gate A",
                    restart_count=3, last_error="source dropped (no frames)",
                )
            }

        def active_count(self):
            return 1

    mgr = _Manager()
    mgr.active_sessions = CameraManager.active_sessions.__get__(mgr)
    monkeypatch.setattr(main, "camera_manager", mgr)

    res = TestClient(main.app).get("/camera/active", headers=HEADERS)
    assert res.status_code == 200
    cams = res.json()["cameras"]
    assert len(cams) == 1 and cams[0]["camera_id"] == "cam-live"
    assert cams[0]["restart_count"] == 3
    assert cams[0]["last_error"] == "source dropped (no frames)"
    assert "secret" not in res.text and "rtsp" not in res.text and "10.0.0.5" not in res.text


# ── supervisor + registry behaviour (no real sessions) ───────────────────
class _RecordingStorage:
    """Records registry calls; never talks to a DB."""

    def __init__(self, rows=None):
        self.client = None
        self.rows = rows or []
        self.upserts: list = []
        self.flags: list = []
        self.errors: list = []

    def upsert_camera_session(self, camera_id, sealed_url, camera_name, fps):
        self.upserts.append((camera_id, sealed_url, camera_name, fps))
        return True

    def set_camera_session_resume(self, camera_id, auto_resume):
        self.flags.append((camera_id, auto_resume))
        return True

    def record_camera_session_error(self, camera_id, message):
        self.errors.append((camera_id, message))
        return True

    def list_resumable_sessions(self):
        return list(self.rows)


def _manager(tmp_path, storage=None) -> tuple[CameraManager, _RecordingStorage]:
    st = storage or _RecordingStorage()
    mgr = CameraManager.__new__(CameraManager)
    mgr.engine = None
    mgr.storage = st
    mgr.hls_dir = str(tmp_path)
    mgr.sessions = {}
    mgr.supervision = {}
    mgr._supervisor_task = None
    return mgr, st


def test_supervisor_restarts_dead_session_with_backoff(tmp_path):
    mgr, st = _manager(tmp_path)
    dead = _FakeSession(_DoneTask(), exit_reason="source dropped (no frames)")
    mgr.sessions[CAM_UUID] = dead
    mgr.supervision[CAM_UUID] = CameraSupervision(url="rtsp://u:p@h/s", fps=15, camera_name="Gate A")
    starts: list = []

    async def fake_start(camera_id, url, fps=15, camera_name=None, *, supervised=False):
        starts.append((camera_id, url, fps, camera_name, supervised))
        mgr.sessions[camera_id] = _FakeSession(_LiveTask())
        mgr.supervision[camera_id].next_retry_at = None
        mgr.supervision[camera_id].running_since = 1000.0

    mgr.start = fake_start

    async def run():
        # tick 1: drop detected → error recorded, retry scheduled 5 s out
        await mgr.supervise_once(now=1000.0)
        sup = mgr.supervision[CAM_UUID]
        assert sup.last_error == "source dropped (no frames)" and sup.failures == 1
        assert sup.next_retry_at == 1005.0 and starts == []
        assert st.errors == [(CAM_UUID, "source dropped (no frames)")]
        # tick 2: too early
        await mgr.supervise_once(now=1003.0)
        assert starts == []
        # tick 3: due → restarted with the same config, supervised
        await mgr.supervise_once(now=1006.0)
        assert starts == [(CAM_UUID, "rtsp://u:p@h/s", 15, "Gate A", True)]
        assert sup.restart_count == 1
        # second drop → 10 s (exponent grows while unhealthy)
        mgr.sessions[CAM_UUID] = _FakeSession(_DoneTask(RuntimeError("cv2: rtsp://u:p@h/s")))
        await mgr.supervise_once(now=1010.0)
        assert sup.next_retry_at == 1020.0 and sup.failures == 2
        assert sup.last_error == "capture task failed: RuntimeError"  # type only, no URL
        assert "u:p@h" not in sup.last_error
        # healthy for 10 min → exponent resets
        await mgr.supervise_once(now=1020.5)
        assert starts[-1][4] is True and sup.restart_count == 2
        await mgr.supervise_once(now=1020.5 + 600.0)
        assert sup.failures == 0

    asyncio.run(run())


def test_supervisor_ignores_user_stopped_sessions(tmp_path):
    mgr, st = _manager(tmp_path)
    dead = _FakeSession(_DoneTask())
    dead.stopped_by_user = True
    mgr.sessions[CAM_UUID] = dead
    mgr.supervision[CAM_UUID] = CameraSupervision(url="rtsp://h/s", fps=15, camera_name=None)

    async def fake_start(*a, **k):
        raise AssertionError("must not restart")

    mgr.start = fake_start
    asyncio.run(mgr.supervise_once(now=5.0))
    assert st.errors == [] and mgr.supervision[CAM_UUID].next_retry_at is None


def test_stop_by_user_flags_session_and_clears_auto_resume(tmp_path):
    mgr, st = _manager(tmp_path)
    live = _FakeSession(_LiveTask())
    mgr.sessions[CAM_UUID] = live
    mgr.supervision[CAM_UUID] = CameraSupervision(url="rtsp://h/s", fps=15, camera_name=None)

    asyncio.run(mgr.stop(CAM_UUID))
    assert live.stopped_by_user is True and live.stops == 1
    assert CAM_UUID not in mgr.sessions and CAM_UUID not in mgr.supervision
    assert st.flags == [(CAM_UUID, False)]

    # Stop for a camera not running here still clears the persisted flag
    # (the resume may have failed while the row kept auto_resume=true).
    asyncio.run(mgr.stop(CAM_UUID))
    assert st.flags == [(CAM_UUID, False), (CAM_UUID, False)]


def test_stop_failure_keeps_session_for_finalize_retry(tmp_path):
    mgr, st = _manager(tmp_path)

    class _FailingSession(_FakeSession):
        async def stop(self):
            self.stops += 1
            raise OSError("spool unavailable")

    failed = _FailingSession(_LiveTask())
    mgr.sessions[CAM_UUID] = failed
    mgr.supervision[CAM_UUID] = CameraSupervision(url="rtsp://h/s", fps=15, camera_name=None)

    with pytest.raises(OSError, match="spool unavailable"):
        asyncio.run(mgr.stop(CAM_UUID))
    assert mgr.sessions[CAM_UUID] is failed
    assert CAM_UUID not in mgr.supervision
    assert st.flags == [(CAM_UUID, False)]


def test_stop_all_keeps_auto_resume_for_next_boot(tmp_path):
    mgr, st = _manager(tmp_path)
    live = _FakeSession(_LiveTask())
    mgr.sessions[CAM_UUID] = live
    mgr.supervision[CAM_UUID] = CameraSupervision(url="rtsp://h/s", fps=15, camera_name=None)
    asyncio.run(mgr.stop_all())
    assert live.stops == 1 and live.stopped_by_user is False
    assert st.flags == []


def test_resume_persisted_unseals_and_starts_each_row(tmp_path):
    url = "rtsp://admin:s3cret@192.168.0.15:554/h264"
    other = "11111111-2222-4333-8444-555555555555"
    rows = [
        {"camera_id": CAM_UUID, "sealed_url": seal_camera_url(CAM_UUID, url), "camera_name": "Gate A", "fps": 12},
        {"camera_id": other, "sealed_url": base64.b64encode(b"garbage-blob-that-is-long-enough").decode(),
         "camera_name": None, "fps": None},
    ]
    mgr, st = _manager(tmp_path, _RecordingStorage(rows))
    starts: list = []

    async def fake_start(camera_id, url, fps=15, camera_name=None, *, supervised=False):
        starts.append((camera_id, url, fps, camera_name))

    mgr.start = fake_start
    assert asyncio.run(mgr.resume_persisted()) == 1
    assert starts == [(CAM_UUID, url, 12, "Gate A")]
    assert len(st.errors) == 1 and st.errors[0][0] == other
    assert "auto-resume failed" in st.errors[0][1] and "garbage" not in st.errors[0][1]


def test_start_persists_sealed_url_only(tmp_path, monkeypatch):
    import recording_pipeline as rp

    mgr, st = _manager(tmp_path)
    url = "rtsp://admin:s3cret@192.168.0.15:554/h264"
    created = []

    class _Sess(_FakeSession):
        def __init__(self, **kw):
            super().__init__(_LiveTask(), name=kw.get("camera_name"), fps=kw.get("fps", 15))
            # Mirror the real session: only a UUID becomes the DB camera id.
            self.db_camera_id = rp.RecordingSession._validate_uuid(kw["camera_id"])
            created.append(kw)

    monkeypatch.setattr(camera_worker, "RecordingSession", _Sess)
    asyncio.run(mgr.start(CAM_UUID, url, fps=10, camera_name="Gate A"))
    assert created[0]["source_url"] == url
    assert len(st.upserts) == 1
    cid, sealed, name, fps = st.upserts[0]
    assert (cid, name, fps) == (CAM_UUID, "Gate A", 10)
    assert "s3cret" not in sealed and unseal_camera_url(CAM_UUID, sealed) == url
    assert mgr.supervision[CAM_UUID].restart_count == 0

    # Non-UUID ids (ad-hoc / test cameras) are never persisted.
    asyncio.run(mgr.start("cam-adhoc", url))
    assert len(st.upserts) == 1


# ── Sentry (optional) ────────────────────────────────────────────────────
def test_sentry_init_disabled_without_dsn(monkeypatch, caplog):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert main._init_sentry() is False


def test_sentry_init_with_dsn_never_logs_it(monkeypatch, caplog):
    dsn = "https://abc123secret@o1.ingest.sentry.io/42"
    monkeypatch.setenv("SENTRY_DSN", dsn)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    calls: list = []
    fake = types.ModuleType("sentry_sdk")
    fake.init = lambda **kw: calls.append(kw)
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake)

    with caplog.at_level("INFO"):
        assert main._init_sentry() is True
    assert len(calls) == 1
    call = calls[0]
    assert call["dsn"] == "https://abc123secret@o1.ingest.sentry.io/42"
    assert call["environment"] == "staging"
    assert call["traces_sample_rate"] == 0.0
    assert call["send_default_pii"] is False
    # Frame locals / request bodies can carry RTSP credentials.
    assert call["include_local_variables"] is False
    assert call["max_request_body_size"] == "never"
    assert call["before_send"] is main._sentry_scrub_event
    scrubbed = main._sentry_scrub_event(
        {"message": "open rtsp://admin:s3cret@10.0.0.5/live failed", "extra": {"u": ["http://u:p@h/x"]}}, None
    )
    assert "s3cret" not in str(scrubbed) and "u:p@" not in str(scrubbed)
    assert scrubbed["message"] == "open rtsp://***@10.0.0.5/live failed"
    assert "abc123secret" not in caplog.text


def test_sentry_init_survives_missing_sdk(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1")
    monkeypatch.setitem(sys.modules, "sentry_sdk", None)  # import → ImportError
    assert main._init_sentry() is False


# ── demo RecordingSession: LIVE treatment, loop on EOF, real-time pacing ─
class _FakeEngine:
    def detect_all(self, _b):
        return []

    @staticmethod
    def cosine(a, b):
        return 0.0


class _SessionStorage(_RecordingStorage):
    async def insert_recording_returning_id(self, **kw):
        return None

    async def update_recording(self, *a, **k):
        return None

    async def delete_recording(self, *a, **k):
        return None

    def upload_bytes(self, *a, **k):
        return ""


def _short_clip(path: str, seconds: float = 1.0) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"testsrc=size=160x90:rate=15:duration={seconds}",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path],
        check=True, timeout=60,
    )


@needs_ffmpeg
@needs_samples
def test_demo_session_loops_and_paces_to_real_time(tmp_path, monkeypatch):
    import recording_pipeline as rp

    clip = str(tmp_path / "short.mp4")
    _short_clip(clip, seconds=1.0)  # 15 frames — EOF hits many times in 2.5 s
    monkeypatch.setattr(rp, "resolve_demo_source", lambda _url: clip)

    session = rp.RecordingSession(
        camera_id="demo-cam", camera_name="Demo", source_url="demo://lobby",
        engine=_FakeEngine(), storage=_SessionStorage(),
        hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"), fps=15,
    )

    async def run():
        await session.start()
        await asyncio.sleep(2.5)
        assert session.task and not session.task.done(), session.exit_reason
        assert session.hls is not None  # LIVE → HLS writer on
        frames = session.recorded_frames
        # Looped past the 15-frame clip, but paced (~15 fps), not decoded flat out.
        assert 20 <= frames <= 60, frames
        await session.stop()
        assert session.exit_reason is None
        assert session.recorded_frames >= frames

    asyncio.run(run())


# ── live source that stops delivering frames ends the loop (supervisor re-opens) ──
class _DeadAfterNCapture:
    """cv2.VideoCapture stand-in: N good frames, then read() fails forever."""

    def __init__(self, good_frames: int):
        self._left = good_frames
        self.released = False

    def isOpened(self):
        return True

    def get(self, prop):
        import cv2

        return {cv2.CAP_PROP_FRAME_WIDTH: 64, cv2.CAP_PROP_FRAME_HEIGHT: 48, cv2.CAP_PROP_FPS: 15}.get(prop, 0)

    def read(self):
        if self._left > 0:
            self._left -= 1
            return True, np.zeros((48, 64, 3), dtype=np.uint8)
        return False, None

    def release(self):
        self.released = True


def test_live_source_dropping_frames_ends_capture_with_reason(tmp_path, monkeypatch):
    import recording_pipeline as rp

    cap = _DeadAfterNCapture(good_frames=3)
    monkeypatch.setattr(rp.cv2, "VideoCapture", lambda _src: cap)
    # No ffmpeg pipes needed for this path.
    monkeypatch.setattr(rp, "_ffmpeg_hls_writer", lambda *a, **k: None)
    monkeypatch.setattr(rp, "_ffmpeg_mp4_writer", lambda *a, **k: None)
    monkeypatch.setattr(rp, "LIVE_READ_FAIL_LIMIT", 4)

    session = rp.RecordingSession(
        camera_id="rtsp-cam", camera_name="Gate", source_url="rtsp://user:pw@10.0.0.9/live",
        engine=_FakeEngine(), storage=_SessionStorage(),
        hls_dir=str(tmp_path / "hls"), recordings_dir=str(tmp_path / "rec"), fps=15,
    )

    async def run():
        await session.start()
        await asyncio.wait_for(session.task, timeout=10)
        assert session.task.done()
        assert not getattr(session, "stopped_by_user", False)
        assert session.exit_reason and "frames" in session.exit_reason.lower()
        assert "user:pw" not in (session.exit_reason or "")
        assert cap.released

    asyncio.run(run())
