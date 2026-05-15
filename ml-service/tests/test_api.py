"""Tests for FastAPI endpoints that don't require model loading."""

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")

import pytest
from httpx import AsyncClient, ASGITransport

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
