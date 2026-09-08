"""Chunked browser uploads: parts are assembled in index order and processed
once, abandoned sessions are swept, and the HTTP contract distinguishes
`chunk_received` from `processing`."""

from __future__ import annotations

import os
import time

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")

import pytest
from httpx import ASGITransport, AsyncClient

import main

HEADERS = {"Authorization": "Bearer test-token"}
SESSION = "11111111-2222-4333-8444-555555555555"


def test_missing_parts_and_assembly(tmp_path):
    d = tmp_path / "sess"
    d.mkdir()
    for i, payload in enumerate([b"aaa", b"bb", b"c"]):
        (d / f"{i:05d}.part").write_bytes(payload)
    assert main._missing_parts(str(d), 3) == []
    assert main._missing_parts(str(d), 5) == [3, 4]

    out = main._assemble_session(str(d), 3, ".mp4")
    try:
        assert open(out, "rb").read() == b"aaabbc"
        assert out.endswith(".mp4")
    finally:
        os.unlink(out)


def test_sweep_removes_only_stale_sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "_UPLOAD_DIR", str(tmp_path))
    stale = tmp_path / "stale"
    fresh = tmp_path / "fresh"
    stale.mkdir()
    fresh.mkdir()
    old = time.time() - main._UPLOAD_SESSION_TTL_SEC - 60
    os.utime(stale, (old, old))
    assert main._sweep_abandoned_uploads() == 1
    assert not stale.exists()
    assert fresh.exists()


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test")


@pytest.fixture
def ready(monkeypatch, tmp_path):
    """Pretend the engine/storage are loaded and capture what gets processed."""
    monkeypatch.setattr(main, "face_engine", object())
    monkeypatch.setattr(main, "storage", object())
    monkeypatch.setattr(main, "_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(main, "_completed_uploads", {})
    monkeypatch.setattr(main, "_UPLOAD_ASSEMBLY_WAIT_SEC", 0)
    processed: list[tuple[bytes, str]] = []

    def fake_start(tmp_file: str, camera_name: str) -> dict:
        with open(tmp_file, "rb") as f:
            processed.append((f.read(), camera_name))
        os.unlink(tmp_file)
        return {"ok": True, "status": "processing", "recording_id": "rec-1", "camera_id": "upload_x", "size_mb": 0.0}

    monkeypatch.setattr(main, "_start_upload_processing", fake_start)
    return processed


@pytest.mark.asyncio
async def test_chunks_assembled_in_order_and_processed_once(client, ready):
    async def send(idx: int, data: bytes, final: bool):
        return await client.post(
            "/process-upload",
            headers=HEADERS,
            files={"file": (f"chunk-{idx}.webm", data, "video/webm")},
            data={"session_id": SESSION, "chunk_index": str(idx), "is_final": str(final).lower(), "camera_name": "Cam A"},
        )

    r0 = await send(0, b"first-", False)
    assert r0.status_code == 200 and r0.json()["status"] == "chunk_received"
    r1 = await send(1, b"second-", False)
    assert r1.json()["status"] == "chunk_received"
    r2 = await send(2, b"third", True)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "processing"
    assert ready == [(b"first-second-third", "Cam A")]


@pytest.mark.asyncio
async def test_empty_final_marker_closes_the_session(client, ready):
    r0 = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("chunk-0.webm", b"only", "video/webm")},
        data={"session_id": SESSION, "chunk_index": "0", "is_final": "false"},
    )
    assert r0.json()["status"] == "chunk_received"
    # Recorder stopped after the last buffer was already flushed → empty marker
    r1 = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("chunk-1.webm", b"", "video/webm")},
        data={"session_id": SESSION, "chunk_index": "1", "is_final": "true"},
    )
    assert r1.status_code == 200, r1.text
    assert ready == [(b"only", "Browser camera")]


@pytest.mark.asyncio
async def test_missing_chunk_is_rejected(client, ready):
    r = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("chunk-2.webm", b"x", "video/webm")},
        data={"session_id": SESSION, "chunk_index": "2", "is_final": "true"},
    )
    assert r.status_code == 400
    assert "missing chunks" in r.json()["detail"]
    assert ready == []


@pytest.mark.asyncio
async def test_bad_session_id_rejected(client, ready):
    r = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("c.webm", b"x", "video/webm")},
        data={"session_id": "../../etc", "chunk_index": "0", "is_final": "true"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_legacy_single_shot_still_works(client, ready):
    r = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("clip.mp4", b"whole-file", "video/mp4")},
        data={"camera_name": "Legacy"},
    )
    assert r.status_code == 200 and r.json()["status"] == "processing"
    assert ready == [(b"whole-file", "Legacy")]


@pytest.mark.asyncio
async def test_lost_final_ack_reuses_receipt_without_processing_twice(client, ready):
    async def send_final():
        return await client.post(
            "/process-upload", headers=HEADERS,
            files={"file": ("clip.webm", b"complete", "video/webm")},
            data={"session_id": SESSION, "chunk_index": "0", "is_final": "true"},
        )
    import asyncio
    first, retry = await asyncio.gather(send_final(), send_final())
    assert first.status_code == retry.status_code == 200
    assert first.json() == retry.json()
    assert len(ready) == 1


@pytest.mark.asyncio
async def test_missing_parts_survive_and_can_be_retried(client, ready):
    async def send(idx, data, final):
        return await client.post(
            "/process-upload", headers=HEADERS,
            files={"file": ("clip.webm", data, "video/webm")},
            data={"session_id": SESSION, "chunk_index": str(idx), "is_final": str(final).lower()},
        )
    assert (await send(0, b"first-", False)).status_code == 200
    assert (await send(2, b"last", True)).status_code == 400
    assert (await send(1, b"middle-", False)).status_code == 200
    assert (await send(2, b"last", True)).status_code == 200
    assert ready == [(b"first-middle-last", "Browser camera")]


@pytest.mark.asyncio
async def test_retry_cannot_replace_an_acknowledged_chunk(client, ready):
    async def send(data):
        return await client.post(
            "/process-upload", headers=HEADERS,
            files={"file": ("clip.webm", data, "video/webm")},
            data={"session_id": SESSION, "chunk_index": "0", "is_final": "false"},
        )
    assert (await send(b"original")).status_code == 200
    assert (await send(b"replacement")).status_code == 409
    assert ready == []
