"""A disabled camera stays disabled, and the tunnel state is visible.

Two regressions live here (audit 4.5 + the tailnet gap):

1. The operator disables a camera. The web action's stop call cannot reach
   the ML container (redeploy / network), so the supervisor restarts the
   session 30 s later and the restart used to re-arm
   ``camera_sessions.auto_resume`` — undoing the DB-side trigger, so the
   camera came back after every redeploy and kept recording faces.
2. ``tailscale up`` fails at boot and the only registered camera (reachable
   only over the tailnet) can never deliver a frame — while ``GET /``
   answered ``{"ok": true}`` with nothing to say about it.
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets
import types
from datetime import datetime, timezone

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")
os.environ.setdefault(
    "ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import camera_worker  # noqa: E402
import main  # noqa: E402
import tcp_forward  # noqa: E402
from camera_worker import CameraManager, CameraSupervision  # noqa: E402
from storage import CameraDesiredState, unseal_camera_url  # noqa: E402

HEADERS = {"Authorization": "Bearer test-token"}
CAM_UUID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7"
RTSP = "rtsp://admin:s3cret@192.168.0.15:554/h264"

ENABLED = CameraDesiredState(known=True, camera_exists=True, enabled=True,
                             session_exists=True, auto_resume=True)
DISABLED = CameraDesiredState(known=True, camera_exists=True, enabled=False,
                              session_exists=True, auto_resume=False)
STOPPED = CameraDesiredState(known=True, camera_exists=True, enabled=True,
                             session_exists=True, auto_resume=False)
DELETED = CameraDesiredState(known=True, camera_exists=False)
UNKNOWN = CameraDesiredState()  # registry unreadable → fail open


# ── fakes ────────────────────────────────────────────────────────────────
class _LiveTask:
    def done(self):
        return False


class _DoneTask:
    def done(self):
        return True

    def exception(self):
        return None


class _FakeSession:
    def __init__(self, task=None, name="Gate A", fps=15, camera_id=CAM_UUID, **kw):
        self.task = task if task is not None else _LiveTask()
        self.camera_id = kw.get("camera_id", camera_id)
        self.camera_name = kw.get("camera_name", name)
        self.fps = kw.get("fps", fps)
        self.source_url = kw.get("source_url", RTSP)
        self.started_at = datetime(2026, 9, 8, 1, 2, 3, tzinfo=timezone.utc)
        self.stopped_by_user = False
        self.exit_reason = kw.get("exit_reason")
        import recording_pipeline as rp

        self.db_camera_id = rp.RecordingSession._validate_uuid(self.camera_id)
        self.stops = 0

    async def start(self):
        pass

    async def stop(self):
        self.stops += 1


class _Storage:
    """Registry stand-in: records every write, answers desired-state reads."""

    def __init__(self, rows=None, desired: CameraDesiredState = UNKNOWN):
        self.client = None
        self.rows = rows or []
        self.desired = desired
        self.upserts: list = []
        self.touches: list = []
        self.flags: list = []
        self.errors: list = []
        self.desired_reads: list = []

    def upsert_camera_session(self, camera_id, sealed_url, camera_name, fps):
        self.upserts.append((camera_id, sealed_url, camera_name, fps))
        return True

    def touch_camera_session(self, camera_id, sealed_url, camera_name, fps):
        self.touches.append((camera_id, sealed_url, camera_name, fps))
        return True

    def set_camera_session_resume(self, camera_id, auto_resume):
        self.flags.append((camera_id, auto_resume))
        return True

    def record_camera_session_error(self, camera_id, message):
        self.errors.append((camera_id, message))
        return True

    def list_resumable_sessions(self):
        return list(self.rows)

    def camera_desired_state(self, camera_id):
        self.desired_reads.append(camera_id)
        return self.desired


def _manager(tmp_path, storage: _Storage) -> CameraManager:
    mgr = CameraManager.__new__(CameraManager)
    mgr.engine = None
    mgr.storage = storage
    mgr.hls_dir = str(tmp_path)
    mgr.sessions = {}
    mgr.supervision = {}
    mgr._supervisor_task = None
    return mgr


# ── 1. a supervised restart must not re-arm auto_resume ──────────────────
def test_supervised_restart_refreshes_session_without_touching_auto_resume(tmp_path, monkeypatch):
    monkeypatch.setattr(camera_worker, "RecordingSession", _FakeSession)
    st = _Storage()
    mgr = _manager(tmp_path, st)

    asyncio.run(mgr.start(CAM_UUID, RTSP, fps=12, camera_name="Gate A"))
    # Operator start → upsert (arms auto_resume), no touch.
    assert len(st.upserts) == 1 and st.touches == []

    mgr.sessions[CAM_UUID].task = _DoneTask()
    asyncio.run(mgr.start(CAM_UUID, RTSP, fps=12, camera_name="Gate A", supervised=True))
    # Supervised restart → touch only: auto_resume stays as the operator left
    # it (this is the audit 4.5 regression — the upsert set it back to true).
    assert len(st.upserts) == 1, "supervised restart re-armed auto_resume"
    assert len(st.touches) == 1
    cid, sealed, name, fps = st.touches[0]
    assert (cid, name, fps) == (CAM_UUID, "Gate A", 12)
    assert "s3cret" not in sealed and unseal_camera_url(CAM_UUID, sealed) == RTSP


def test_touch_camera_session_updates_only_session_columns():
    from storage import SupabaseStorage

    captured: list = []

    class _Table:
        def update(self, fields):
            captured.append(fields)
            return self

        def eq(self, col, val):
            captured.append((col, val))
            return self

        def execute(self):
            return types.SimpleNamespace(data=[])

    class _Client:
        def table(self, name):
            assert name == "camera_sessions"
            return _Table()

    st = SupabaseStorage.__new__(SupabaseStorage)
    st.client = _Client()
    assert st.touch_camera_session(CAM_UUID, "sealed", "Gate A", 15) is True
    fields = captured[0]
    assert "auto_resume" not in fields, "supervised restart must not write auto_resume"
    assert "last_error" not in fields, "the drop reason must stay visible"
    assert fields["sealed_url"] == "sealed" and fields["fps"] == 15
    assert captured[1] == ("camera_id", CAM_UUID)


# ── 2. desired state wins: no restart / no resume for a disabled camera ──
@pytest.mark.parametrize(
    ("desired", "expected"),
    [
        (DISABLED, "camera disabled by operator"),
        (STOPPED, "auto_resume cleared (stopped by operator)"),
        (DELETED, "camera row missing (deleted)"),
    ],
)
def test_supervisor_drops_instead_of_restarting(tmp_path, desired, expected):
    st = _Storage(desired=desired)
    mgr = _manager(tmp_path, st)
    dead = _FakeSession(_DoneTask(), exit_reason="source dropped (no frames)")
    mgr.sessions[CAM_UUID] = dead
    mgr.supervision[CAM_UUID] = CameraSupervision(url=RTSP, fps=15, camera_name="Gate A")

    async def must_not_start(*a, **k):
        raise AssertionError("disabled camera restarted")

    async def run():
        # tick 1: drop noticed, retry scheduled
        await mgr.supervise_once(now=1000.0)
        assert mgr.supervision[CAM_UUID].next_retry_at == 1005.0
        mgr.start = must_not_start
        # tick 2: retry due → desired state re-read → dropped, not restarted
        await mgr.supervise_once(now=1006.0)

    asyncio.run(run())
    assert CAM_UUID not in mgr.sessions and CAM_UUID not in mgr.supervision
    assert dead.stops == 1  # closed (recording finalised), not leaked
    assert st.desired_reads == [CAM_UUID]
    assert st.errors[-1] == (CAM_UUID, f"stopped: {expected}")
    # A drop is not an operator stop: auto_resume is already false / gone.
    assert st.flags == []


def test_supervisor_stops_a_live_session_when_camera_is_disabled(tmp_path):
    """The web action's stop call can be lost (redeploy, network). The next
    supervisor tick reconciles: the loop is still healthy, but the DB says the
    camera is off."""
    st = _Storage(desired=DISABLED)
    mgr = _manager(tmp_path, st)
    live = _FakeSession(_LiveTask())
    mgr.sessions[CAM_UUID] = live
    mgr.supervision[CAM_UUID] = CameraSupervision(url=RTSP, fps=15, camera_name="Gate A")

    asyncio.run(mgr.supervise_once(now=1000.0))
    assert live.stops == 1
    assert CAM_UUID not in mgr.sessions and CAM_UUID not in mgr.supervision
    assert st.errors[-1] == (CAM_UUID, "stopped: camera disabled by operator")


def test_live_session_survives_a_stale_auto_resume_flag(tmp_path):
    """auto_resume governs RESTARTS. A live loop is only torn down by the
    operator's toggle (or a deleted camera) — a stale false, e.g. a registry
    write that failed on the very start now running, must not kill it."""
    st = _Storage(desired=STOPPED)  # enabled, but auto_resume=false
    mgr = _manager(tmp_path, st)
    live = _FakeSession(_LiveTask())
    mgr.sessions[CAM_UUID] = live
    mgr.supervision[CAM_UUID] = CameraSupervision(url=RTSP, fps=15, camera_name="Gate A")

    asyncio.run(mgr.supervise_once(now=1000.0))
    assert live.stops == 0 and CAM_UUID in mgr.sessions and st.errors == []


def test_unreadable_registry_never_stops_a_camera(tmp_path):
    """Fail open: a Supabase blip must not tear down a healthy capture."""

    class _Broken(_Storage):
        def camera_desired_state(self, camera_id):
            self.desired_reads.append(camera_id)
            raise RuntimeError("db down")

    st = _Broken()
    mgr = _manager(tmp_path, st)
    live = _FakeSession(_LiveTask())
    mgr.sessions[CAM_UUID] = live
    mgr.supervision[CAM_UUID] = CameraSupervision(url=RTSP, fps=15, camera_name="Gate A")

    asyncio.run(mgr.supervise_once(now=1000.0))
    assert live.stops == 0 and CAM_UUID in mgr.sessions

    # …and the restart path stays alive too.
    dead = _FakeSession(_DoneTask())
    mgr.sessions[CAM_UUID] = dead
    starts: list = []

    async def fake_start(camera_id, url, fps=15, camera_name=None, *, supervised=False):
        starts.append((camera_id, supervised))

    mgr.start = fake_start

    async def run():
        await mgr.supervise_once(now=1000.0)
        await mgr.supervise_once(now=1006.0)

    asyncio.run(run())
    assert starts == [(CAM_UUID, True)]


def test_ad_hoc_camera_ids_are_never_looked_up(tmp_path):
    """Demo / test sources have no cameras row — they must keep working."""
    st = _Storage(desired=DISABLED)
    mgr = _manager(tmp_path, st)
    assert asyncio.run(mgr.start_refusal("cam-adhoc")) is None
    assert st.desired_reads == []


# ── resume at boot ───────────────────────────────────────────────────────
def _resumable_row(enabled=None):
    from storage import seal_camera_url

    row = {
        "camera_id": CAM_UUID,
        "sealed_url": seal_camera_url(CAM_UUID, RTSP),
        "camera_name": "Gate A",
        "fps": 12,
        "auto_resume": True,
    }
    if enabled is not None:
        row["cameras"] = {"enabled": enabled}
    return row


def test_resume_skips_a_camera_disabled_while_the_service_was_down(tmp_path):
    st = _Storage(rows=[_resumable_row(enabled=False)])
    mgr = _manager(tmp_path, st)

    async def must_not_start(*a, **k):
        raise AssertionError("disabled camera resumed")

    mgr.start = must_not_start
    assert asyncio.run(mgr.resume_persisted()) == 0
    # The embed answered — no per-camera round trip needed.
    assert st.desired_reads == []
    assert st.errors == [(CAM_UUID, "auto-resume skipped: camera disabled by operator")]


def test_resume_falls_back_to_a_per_camera_read_without_the_embed(tmp_path):
    st = _Storage(rows=[_resumable_row()], desired=DISABLED)
    mgr = _manager(tmp_path, st)

    async def must_not_start(*a, **k):
        raise AssertionError("disabled camera resumed")

    mgr.start = must_not_start
    assert asyncio.run(mgr.resume_persisted()) == 0
    assert st.desired_reads == [CAM_UUID]
    assert st.errors == [(CAM_UUID, "auto-resume skipped: camera disabled by operator")]


def test_resume_starts_an_enabled_camera(tmp_path):
    st = _Storage(rows=[_resumable_row(enabled=True)])
    mgr = _manager(tmp_path, st)
    starts: list = []

    async def fake_start(camera_id, url, fps=15, camera_name=None, *, supervised=False):
        starts.append((camera_id, url, fps, camera_name, supervised))

    mgr.start = fake_start
    assert asyncio.run(mgr.resume_persisted()) == 1
    assert starts == [(CAM_UUID, RTSP, 12, "Gate A", False)]
    assert st.errors == []


# ── 3. /camera/start refuses a disabled camera ───────────────────────────
def _client_with_manager(monkeypatch, tmp_path, desired: CameraDesiredState):
    st = _Storage(desired=desired)
    mgr = _manager(tmp_path, st)
    started: list = []

    async def fake_start(camera_id, url, fps=15, camera_name=None, *, supervised=False):
        started.append(camera_id)

    mgr.start = fake_start
    monkeypatch.setattr(main, "camera_manager", mgr)
    return TestClient(main.app), st, started


def test_camera_start_refuses_a_disabled_camera(monkeypatch, tmp_path):
    client, st, started = _client_with_manager(monkeypatch, tmp_path, DISABLED)
    res = client.post(
        "/camera/start", json={"camera_id": CAM_UUID, "url": RTSP}, headers=HEADERS
    )
    assert res.status_code == 409
    assert res.json()["detail"] == "camera disabled by operator"
    assert started == [] and st.desired_reads == [CAM_UUID]
    assert "s3cret" not in res.text


def test_camera_start_refuses_a_deleted_camera(monkeypatch, tmp_path):
    client, _st, started = _client_with_manager(monkeypatch, tmp_path, DELETED)
    res = client.post(
        "/camera/start", json={"camera_id": CAM_UUID, "url": RTSP}, headers=HEADERS
    )
    assert res.status_code == 409 and started == []


def test_camera_start_allows_enabled_and_unknown(monkeypatch, tmp_path):
    for desired in (ENABLED, STOPPED, UNKNOWN):
        # STOPPED: an explicit start IS the operator re-arming the camera.
        client, _st, started = _client_with_manager(monkeypatch, tmp_path, desired)
        res = client.post(
            "/camera/start", json={"camera_id": CAM_UUID, "url": RTSP}, headers=HEADERS
        )
        assert res.status_code == 200, (desired, res.text)
        assert started == [CAM_UUID]


# ── 4. tunnel readiness in GET / ─────────────────────────────────────────
TUNNEL_KEYS = {
    "requested", "state", "backend_ok", "backend_state",
    "forwarder_ok", "target_ok", "reason", "boot", "checked_at",
}
FWD = "5554:192.168.0.15:554"


@pytest.fixture(autouse=True)
def _clear_tunnel_cache(monkeypatch):
    monkeypatch.setattr(tcp_forward, "_tunnel_cache", None, raising=False)
    monkeypatch.setattr(tcp_forward, "_tunnel_cache_at", 0.0, raising=False)
    monkeypatch.setattr(tcp_forward, "BOOT_STATUS_FILE", "/nonexistent/mongolz.status")
    yield
    tcp_forward._tunnel_cache = None
    tcp_forward._tunnel_cache_at = 0.0


def test_tunnel_disabled_when_no_auth_key_and_never_probes(monkeypatch):
    monkeypatch.delenv("TAILSCALE_AUTHKEY", raising=False)
    monkeypatch.setattr(
        tcp_forward, "probe_backend", lambda *a, **k: pytest.fail("probed without a key")
    )
    tun = tcp_forward.tunnel_status(force=True)
    assert set(tun) == TUNNEL_KEYS
    assert tun["requested"] is False and tun["state"] == "disabled"
    assert tun["backend_ok"] is None and tun["target_ok"] is None
    assert tun["reason"] == "tailnet disabled (no auth key)"
    assert tun["checked_at"].endswith("+00:00")


def test_tunnel_down_reports_backend_and_boot_reason(monkeypatch, tmp_path):
    status_file = tmp_path / "tailnet.status"
    status_file.write_text("state=up-failed\nreason=tailscale up exited 1\nat=2026-09-08T00:00:00Z\n")
    monkeypatch.setattr(tcp_forward, "BOOT_STATUS_FILE", str(status_file))
    monkeypatch.setenv("TAILSCALE_AUTHKEY", "tskey-auth-SECRET")
    monkeypatch.setenv("CAMERA_TAILNET_FWD", FWD)
    monkeypatch.setattr(tcp_forward, "probe_backend", lambda *a, **k: (False, "Stopped", "tailnet backend Stopped"))
    monkeypatch.setattr(tcp_forward, "probe_listener", lambda *a, **k: True)
    monkeypatch.setattr(
        tcp_forward, "probe_socks_target", lambda *a, **k: pytest.fail("probed through a dead backend")
    )

    tun = tcp_forward.tunnel_status(force=True)
    assert set(tun) == TUNNEL_KEYS
    assert tun["requested"] is True and tun["state"] == "down"
    assert tun["backend_ok"] is False and tun["backend_state"] == "Stopped"
    # The local listener accepts even with the tailnet down — that is exactly
    # the false "healthy" signal the operator used to see.
    assert tun["forwarder_ok"] is True and tun["target_ok"] is None
    assert tun["reason"] == "tailnet backend Stopped (tailscale up exited 1)"
    assert tun["boot"] == "tailscale up exited 1"
    # Never a key, host, port or URL.
    blob = repr(tun)
    assert "tskey" not in blob and "SECRET" not in blob
    assert "192.168" not in blob and "5554" not in blob


def test_tunnel_degraded_when_the_camera_port_is_refused(monkeypatch):
    monkeypatch.setenv("TAILSCALE_AUTHKEY", "tskey-auth-SECRET")
    monkeypatch.setenv("CAMERA_TAILNET_FWD", FWD)
    monkeypatch.setattr(tcp_forward, "probe_backend", lambda *a, **k: (True, "Running", "tailnet up"))
    monkeypatch.setattr(tcp_forward, "probe_listener", lambda *a, **k: True)
    monkeypatch.setattr(
        tcp_forward, "probe_socks_target", lambda *a, **k: (False, "socks5 connect failed: ConnectionRefusedError")
    )
    tun = tcp_forward.tunnel_status(force=True)
    assert tun["state"] == "degraded"
    assert tun["backend_ok"] is True and tun["target_ok"] is False
    assert tun["reason"] == "socks5 connect failed: ConnectionRefusedError"
    assert "192.168" not in repr(tun)


def test_tunnel_ok_when_the_camera_port_answers(monkeypatch):
    monkeypatch.setenv("TAILSCALE_AUTHKEY", "tskey-auth-SECRET")
    monkeypatch.setenv("CAMERA_TAILNET_FWD", FWD)
    monkeypatch.setattr(tcp_forward, "probe_backend", lambda *a, **k: (True, "Running", "tailnet up"))
    monkeypatch.setattr(tcp_forward, "probe_listener", lambda *a, **k: True)
    monkeypatch.setattr(tcp_forward, "probe_socks_target", lambda *a, **k: (True, "camera port reachable via tailnet"))
    tun = tcp_forward.tunnel_status(force=True)
    assert tun["state"] == "ok" and tun["target_ok"] is True and tun["forwarder_ok"] is True


def test_tunnel_degraded_when_the_forwarder_listener_is_dead(monkeypatch):
    monkeypatch.setenv("TAILSCALE_AUTHKEY", "tskey-auth-SECRET")
    monkeypatch.setenv("CAMERA_TAILNET_FWD", FWD)
    monkeypatch.setattr(tcp_forward, "probe_backend", lambda *a, **k: (True, "Running", "tailnet up"))
    monkeypatch.setattr(tcp_forward, "probe_listener", lambda *a, **k: False)
    monkeypatch.setattr(
        tcp_forward, "probe_socks_target", lambda *a, **k: pytest.fail("probed a dead listener")
    )
    tun = tcp_forward.tunnel_status(force=True)
    assert tun["state"] == "degraded" and tun["forwarder_ok"] is False and tun["target_ok"] is None
    assert tun["reason"] == "forwarder listener not accepting"


def test_tunnel_probe_failure_is_reported_not_raised(monkeypatch):
    monkeypatch.setenv("TAILSCALE_AUTHKEY", "tskey-auth-SECRET")

    def boom(*_a, **_k):
        raise RuntimeError("probe exploded")

    monkeypatch.setattr(tcp_forward, "probe_backend", boom)
    tun = tcp_forward.tunnel_status(force=True)
    assert set(tun) == TUNNEL_KEYS
    assert tun["state"] == "unknown" and tun["reason"] == "probe error: RuntimeError"


def test_tunnel_status_is_cached(monkeypatch):
    monkeypatch.delenv("TAILSCALE_AUTHKEY", raising=False)
    calls: list = []
    monkeypatch.setattr(tcp_forward, "read_boot_status", lambda *a, **k: calls.append(1) or {})
    monkeypatch.setattr(tcp_forward, "_schedule_refresh", lambda: pytest.fail("refreshed a fresh value"))
    first = tcp_forward.tunnel_status(force=True)
    second = tcp_forward.tunnel_status()
    assert second is first and len(calls) == 1
    tcp_forward.tunnel_status(force=True)
    assert len(calls) == 2


def test_boot_status_file_is_sanitised(tmp_path):
    path = tmp_path / "tailnet.status"
    path.write_text("state=up-failed\nreason=exit 1\x07 \x00weird\nnot a key=x\nat=now\n")
    parsed = tcp_forward.read_boot_status(str(path))
    assert parsed["state"] == "up-failed"
    assert parsed["reason"] == "exit 1   weird"  # control chars → spaces
    assert "not a key" not in parsed
    assert tcp_forward.read_boot_status(str(tmp_path / "missing")) == {}


def test_real_probes_fail_closed_and_stay_quiet_about_hosts():
    """The probe helpers themselves (no mocks): every failure path returns a
    short, printable reason and never leaks the target."""
    ok, state, reason = tcp_forward.probe_backend(timeout=2.0)
    assert isinstance(ok, bool) and (state is None or state.isalpha())
    assert reason and reason.isprintable() and len(reason) <= 200

    # Bind-based liveness: a listening socket is seen, a free port is not —
    # and probing never makes the forwarder dial the camera.
    import socket as _socket

    listener = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    try:
        assert tcp_forward.probe_listener(port) is True
    finally:
        listener.close()
    assert tcp_forward.probe_listener(port) is False

    fwd = tcp_forward.Forward(5554, "192.168.0.15", 554)
    target_ok, target_reason = tcp_forward.probe_socks_target(fwd, timeout=0.5)
    assert target_ok is False
    assert "192.168" not in target_reason and "554" not in target_reason
    assert target_reason.isprintable()


def test_entrypoint_status_note_round_trips_into_read_boot_status(tmp_path):
    """The shell writer and the Python reader must agree on the format."""
    import pathlib
    import re as _re
    import subprocess

    script = pathlib.Path(__file__).resolve().parents[1] / "docker-entrypoint.sh"
    body = script.read_text(encoding="utf-8")
    func = _re.search(r"^ts_status\(\) \{.*?^\}", body, _re.S | _re.M)
    assert func, "ts_status() helper missing from docker-entrypoint.sh"

    target = tmp_path / "tailnet.status"
    subprocess.run(
        ["bash", "-c", f'TS_STATUS_FILE="{target}"\n{func.group(0)}\n'
                       'ts_status up-failed "tailscale up exited 1"'],
        check=True, timeout=30,
    )
    parsed = tcp_forward.read_boot_status(str(target))
    assert parsed["state"] == "up-failed"
    assert parsed["reason"] == "tailscale up exited 1"
    assert parsed["at"].endswith("Z")


def test_health_never_waits_for_the_probe(monkeypatch):
    """Docker's HEALTHCHECK allows 5 s per poll and the probe opens real TCP
    connections — a blocking probe would restart the container it diagnoses."""
    scheduled: list = []
    monkeypatch.delenv("TAILSCALE_AUTHKEY", raising=False)
    monkeypatch.setattr(tcp_forward, "_schedule_refresh", lambda: scheduled.append(1))
    monkeypatch.setattr(
        tcp_forward, "_probe_tunnel", lambda: pytest.fail("probed on the request path")
    )
    monkeypatch.setattr(main, "camera_manager", None)
    monkeypatch.setattr(main, "face_engine", None)

    body = TestClient(main.app).get("/").json()
    assert body["ok"] is True
    assert body["tunnel"]["state"] == "unknown" and body["tunnel"]["reason"] == "measuring"
    assert scheduled == [1]


def test_health_reports_the_tunnel_without_flipping_ok(monkeypatch):
    monkeypatch.setenv("TAILSCALE_AUTHKEY", "tskey-auth-SECRET")
    monkeypatch.setenv("CAMERA_TAILNET_FWD", FWD)
    monkeypatch.setattr(tcp_forward, "probe_backend", lambda *a, **k: (False, "NoState", "tailscale status timed out"))
    monkeypatch.setattr(tcp_forward, "probe_listener", lambda *a, **k: True)
    monkeypatch.setattr(main, "camera_manager", None)
    monkeypatch.setattr(main, "face_engine", None)
    tcp_forward.tunnel_status(force=True)  # steady state: the cache is warm

    body = TestClient(main.app).get("/").json()
    # `ok` still means "the API is up" — /api/uptime must not flap when the
    # tailnet drops; the tunnel state sits alongside it.
    assert body["ok"] is True
    assert set(body["tunnel"]) == TUNNEL_KEYS
    assert body["tunnel"]["state"] == "down"
    assert "tskey" not in repr(body) and "192.168" not in repr(body)
