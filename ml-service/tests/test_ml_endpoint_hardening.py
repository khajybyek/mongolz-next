"""ML API regressions:

* A non-ASCII bearer token answered 500 (hmac.compare_digest TypeError on
  str) instead of 403.
* Admin eval endpoints ran InsightFace on the event loop: /eval/bench at 20
  iterations stalled capture, HLS and health probes for ~5.7 s.
* A cached derived playback view was served after its recording row was
  deleted (retention / GDPR run web-side and never reached the ML host).
"""

from __future__ import annotations

import asyncio
import base64
import os
import secrets
import time
from types import SimpleNamespace
from unittest.mock import Mock

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("ML_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

REC = "33333333-3333-4333-8333-333333333333"


def test_non_ascii_bearer_is_refused_with_403(monkeypatch):
    monkeypatch.setattr(main, "ML_TOKEN", "test-token")
    client = TestClient(main.app)
    r = client.get("/camera/active", headers={"Authorization": "Bearer \xe9\xe9".encode("latin-1")})
    assert r.status_code == 403
    ok = client.get("/camera/active", headers={"Authorization": "Bearer test-token"})
    assert ok.status_code == 200


class _SlowEngine:
    BLOCK = 0.15

    def detect_all(self, _b):
        time.sleep(self.BLOCK)
        return []

    def embed_single(self, _b):
        return None

    def info(self):
        return {"model": "fake"}


def test_eval_bench_does_not_block_the_event_loop(monkeypatch):
    monkeypatch.setattr(main, "face_engine", _SlowEngine())
    monkeypatch.setattr(main, "bench_frame", lambda: (b"\xff\xd8not-a-real-jpeg", "fake", False))

    async def run():
        stall = 0.0
        done = asyncio.Event()

        async def ticker():
            nonlocal stall
            last = time.perf_counter()
            while not done.is_set():
                await asyncio.sleep(0.01)
                now = time.perf_counter()
                stall = max(stall, now - last)
                last = now

        t = asyncio.create_task(ticker())
        payload = await main.eval_bench_endpoint(iterations=4)
        done.set()
        await t
        return payload, stall

    payload, stall = asyncio.run(run())
    assert payload["iterations"] == 4 and payload["faces_detected"] == 0
    # 5 detect calls × 0.15 s ran, but never on the loop.
    assert stall < _SlowEngine.BLOCK, stall


_VIEW_ROW = {
    "id": REC,
    "original_path": f"rec/{REC}_original.mp4",
    "has_original": True,
    "camera_id": "44444444-4444-4444-8444-444444444444",
    "started_at": "2026-10-12T00:00:00+00:00",
    "duration_sec": 10,
    "capture_status": "complete",
}


def _view_client(tmp_path, monkeypatch, row, protection=None):
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.maybe_single.return_value = query
    query.execute.return_value = SimpleNamespace(data=row) if row is not None else None
    db = Mock()
    db.table.return_value = query
    db.storage.from_.return_value.download.return_value = b"original-mp4"
    monkeypatch.setattr(main, "storage", SimpleNamespace(client=db))
    monkeypatch.setattr(main, "ML_TOKEN", "test-token")
    monkeypatch.setattr(main, "_VIEW_CACHE_DIR", str(tmp_path))
    timeline = protection or main.ProtectedTimeline()
    monkeypatch.setattr(main, "_view_protection", lambda _rid, _row: timeline)
    cache = tmp_path / f"{REC}.mp4"
    cache.write_bytes(b"\0" * 4096)
    return TestClient(main.app), cache


def _fingerprint(row, protection=None):
    return main._view_policy_fingerprint(row, protection or main.ProtectedTimeline())


def _sidecar(cache, fingerprint, version=None):
    import json

    (cache.parent / (cache.name + ".json")).write_text(
        json.dumps({"version": version or main._VIEW_RENDERER_VERSION, "fingerprint": fingerprint})
    )


def _fake_render(monkeypatch, payload=b"\1" * 2048):
    calls = []

    def render(_in, out, _engine, _start, _end, protection):
        calls.append(protection)
        with open(out, "wb") as handle:
            handle.write(payload)

    monkeypatch.setattr(main, "render_blurred_view", render)
    return calls


def test_cached_view_of_a_deleted_recording_is_purged_not_served(tmp_path, monkeypatch):
    client, cache = _view_client(tmp_path, monkeypatch, row=None)
    _sidecar(cache, "anything")
    r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 404
    assert not cache.exists() and not (tmp_path / f"{REC}.mp4.json").exists()


def test_cached_view_is_served_while_its_policy_is_current(tmp_path, monkeypatch):
    client, cache = _view_client(tmp_path, monkeypatch, row=dict(_VIEW_ROW))
    _sidecar(cache, _fingerprint(_VIEW_ROW))
    calls = _fake_render(monkeypatch)
    r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 200 and len(r.content) == 4096
    assert calls == []


def test_cached_view_from_an_older_policy_is_rendered_again(tmp_path, monkeypatch):
    """Privacy can tighten after the first render (a new span, a consent
    gate, a schedule edit): a cache whose sidecar no longer matches, or a
    legacy cache without one, is never served."""
    import json

    tightened = main.ProtectedTimeline(intervals=((0.0, float("inf")),))
    for stale in ("an-older-fingerprint", None):
        client, cache = _view_client(tmp_path, monkeypatch, row=dict(_VIEW_ROW), protection=tightened)
        sidecar = tmp_path / f"{REC}.mp4.json"
        if stale:
            _sidecar(cache, stale)
        else:
            sidecar.unlink(missing_ok=True)
        calls = _fake_render(monkeypatch)
        r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
        assert r.status_code == 200 and r.content == b"\1" * 2048
        assert calls == [tightened]
        published = json.loads(sidecar.read_text())
        assert published == {"version": main._VIEW_RENDERER_VERSION, "fingerprint": _fingerprint(_VIEW_ROW, tightened)}
        assert not (tmp_path / f"{REC}.mp4.part").exists()


def test_cached_view_fails_closed_when_the_row_check_fails(tmp_path, monkeypatch):
    client, cache = _view_client(tmp_path, monkeypatch, row=dict(_VIEW_ROW))
    _sidecar(cache, _fingerprint(_VIEW_ROW))
    main.storage.client.table.return_value.execute.side_effect = ConnectionError("db down")
    r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 503
    assert cache.exists()  # nothing deleted on an unknown answer


def test_zk_simulate_still_counts_every_trial():
    result = asyncio.run(main.zk_simulate(n_trials=20, threshold=0.45))
    assert result["total"] == 20
    assert result["success"] + result["fail_threshold"] + result["fail_proof"] == 20
