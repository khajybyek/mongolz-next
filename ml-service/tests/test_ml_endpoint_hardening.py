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


def _view_client(tmp_path, monkeypatch, row):
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.maybe_single.return_value = query
    query.execute.return_value = SimpleNamespace(data=row) if row is not None else None
    db = Mock()
    db.table.return_value = query
    monkeypatch.setattr(main, "storage", SimpleNamespace(client=db))
    monkeypatch.setattr(main, "ML_TOKEN", "test-token")
    monkeypatch.setattr(main, "_VIEW_CACHE_DIR", str(tmp_path))
    cache = tmp_path / f"{REC}.mp4"
    cache.write_bytes(b"\0" * 4096)
    return TestClient(main.app), cache


def test_cached_view_of_a_deleted_recording_is_purged_not_served(tmp_path, monkeypatch):
    client, cache = _view_client(tmp_path, monkeypatch, row=None)
    r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 404
    assert not cache.exists()


def test_cached_view_is_served_while_the_row_exists(tmp_path, monkeypatch):
    client, cache = _view_client(tmp_path, monkeypatch, row={"id": REC})
    r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 200 and len(r.content) == 4096
    assert cache.exists()


def test_cached_view_fails_closed_when_the_row_check_fails(tmp_path, monkeypatch):
    client, cache = _view_client(tmp_path, monkeypatch, row={"id": REC})
    main.storage.client.table.return_value.execute.side_effect = ConnectionError("db down")
    r = client.get(f"/recording/{REC}/view", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 503
    assert cache.exists()  # nothing deleted on an unknown answer


def test_zk_simulate_still_counts_every_trial():
    result = asyncio.run(main.zk_simulate(n_trials=20, threshold=0.45))
    assert result["total"] == 20
    assert result["success"] + result["fail_threshold"] + result["fail_proof"] == 20
