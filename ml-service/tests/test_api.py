"""Tests for FastAPI endpoints that don't require model loading."""

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")

import pytest
from httpx import AsyncClient, ASGITransport

import main
from main import app

HEADERS = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_health_endpoint(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True


@pytest.mark.asyncio
async def test_embed_requires_auth(client):
    resp = await client.post("/embed", files={"file": ("test.jpg", b"\xff\xd8", "image/jpeg")})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_detect_requires_auth(client):
    resp = await client.post("/detect", files={"file": ("test.jpg", b"\xff\xd8", "image/jpeg")})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_policy_refresh_requires_auth_and_invalidates_before_read(client, monkeypatch):
    calls = []

    class Cache:
        def invalidate(self, camera_id):
            calls.append(("invalidate", camera_id))

        async def mode_at(self, camera_id, _at):
            calls.append(("mode_at", camera_id))
            return "private", "consent"

        def release_hold_if_consented(self, camera_id):
            calls.append(("release", camera_id))
            return True

    monkeypatch.setattr(main, "get_privacy_schedule_cache", lambda: Cache())
    camera_id = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
    path = "/camera/privacy/refresh"
    assert (await client.post(path, json={"camera_id": camera_id})).status_code in (401, 403)
    resp = await client.post(path, json={"camera_id": camera_id}, headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "privacy_mode": "private", "privacy_source": "consent", "consent_confirmed": True}
    assert calls == [("invalidate", camera_id), ("mode_at", camera_id), ("release", camera_id)]


@pytest.mark.asyncio
async def test_privacy_hold_drains_capture_before_ack(client, monkeypatch):
    calls = []

    class Cache:
        def hold_private(self, camera_id):
            calls.append(("hold", camera_id))

    class Manager:
        async def stop(self, camera_id, *, by_user):
            calls.append(("stop", camera_id, by_user))

    monkeypatch.setattr(main, "get_privacy_schedule_cache", lambda: Cache())
    monkeypatch.setattr(main, "camera_manager", Manager())
    camera_id = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
    path = "/camera/privacy/hold"
    assert (await client.post(path, json={"camera_id": camera_id})).status_code in (401, 403)
    resp = await client.post(path, json={"camera_id": camera_id}, headers=HEADERS)
    assert resp.status_code == 200 and resp.json()["privacy_mode"] == "private"
    assert calls == [("hold", camera_id), ("stop", camera_id, False)]


@pytest.mark.asyncio
async def test_privacy_hold_does_not_ack_a_failed_drain(client, monkeypatch):
    class Cache:
        def hold_private(self, _camera_id):
            pass

    class Manager:
        async def stop(self, _camera_id, *, by_user):
            assert by_user is False
            raise RuntimeError("drain failed")

    monkeypatch.setattr(main, "get_privacy_schedule_cache", lambda: Cache())
    monkeypatch.setattr(main, "camera_manager", Manager())
    camera_id = "7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f701"
    resp = await client.post("/camera/privacy/hold", json={"camera_id": camera_id}, headers=HEADERS)
    assert resp.status_code == 503
