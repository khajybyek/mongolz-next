"""HTTP durable upload contract: ordered encrypted chunks, safe acceptance,
ownership enforcement, and explicit retry/cancel outcomes."""

from __future__ import annotations

import os
import time
import asyncio

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("ML_SERVICE_TOKEN", "test-token")
os.environ.setdefault("HLS_DIR", "/tmp/mongolz-hls-test")

import pytest
from httpx import ASGITransport, AsyncClient

import main

HEADERS = {"Authorization": "Bearer test-token"}
OWNER = "11111111-1111-4111-8111-111111111111"
SESSION = "11111111-2222-4333-8444-555555555555"


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test")


@pytest.fixture
def ready(monkeypatch, tmp_path):
    from durable_jobs import UploadStore
    from tests.test_durable_jobs import JobDB
    monkeypatch.setattr(main, "face_engine", object())
    db = JobDB()
    store = UploadStore(tmp_path / "durable")
    monkeypatch.setattr(main, "storage", db)
    monkeypatch.setattr(main, "upload_store", store)
    return store, db


def assembled(ready, tmp_path):
    store, _db = ready
    out = tmp_path / "assembled.webm"
    store.assemble(SESSION, out)
    return out.read_bytes()


@pytest.mark.asyncio
async def test_chunks_assembled_in_order_and_processed_once(client, ready, tmp_path):
    async def send(idx: int, data: bytes, final: bool):
        return await client.post(
            "/process-upload",
            headers=HEADERS,
            files={"file": (f"chunk-{idx}.webm", data, "video/webm")},
            data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": str(idx), "is_final": str(final).lower(), "camera_name": "Cam A"},
        )

    r0 = await send(0, b"first-", False)
    assert r0.status_code == 200 and r0.json()["status"] == "chunk_received"
    r1 = await send(1, b"second-", False)
    assert r1.json()["status"] == "chunk_received"
    r2 = await send(2, b"third", True)
    assert r2.status_code == 202, r2.text
    assert r2.json()["status"] == "queued"
    assert assembled(ready, tmp_path) == b"first-second-third"
    assert ready[1].jobs[SESSION]["camera_name"] == "Cam A"


@pytest.mark.asyncio
async def test_empty_final_marker_closes_the_session(client, ready, tmp_path):
    r0 = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("chunk-0.webm", b"only", "video/webm")},
        data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": "0", "is_final": "false"},
    )
    assert r0.json()["status"] == "chunk_received"
    # Recorder stopped after the last buffer was already flushed → empty marker
    r1 = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("chunk-1.webm", b"", "video/webm")},
        data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": "1", "is_final": "true"},
    )
    assert r1.status_code == 202, r1.text
    assert assembled(ready, tmp_path) == b"only"
    assert ready[1].jobs[SESSION]["camera_name"] == "Browser camera"


@pytest.mark.asyncio
async def test_missing_chunk_is_rejected(client, ready):
    r = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("chunk-2.webm", b"x", "video/webm")},
        data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": "2", "is_final": "true"},
    )
    assert r.status_code == 400
    assert "missing chunks" in r.json()["detail"]
    assert ready[1].jobs == {}


@pytest.mark.asyncio
async def test_bad_session_id_rejected(client, ready):
    r = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("c.webm", b"x", "video/webm")},
        data={"requested_by": OWNER, "session_id": "../../etc", "chunk_index": "0", "is_final": "true"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_legacy_single_shot_still_works(client, ready, tmp_path):
    r = await client.post(
        "/process-upload", headers=HEADERS,
        files={"file": ("clip.mp4", b"whole-file", "video/mp4")},
        data={"requested_by": OWNER, "camera_name": "Legacy"},
    )
    assert r.status_code == 202 and r.json()["status"] == "queued"
    out = tmp_path / "input.mp4"
    ready[0].assemble(r.json()["job_id"], out)
    assert out.read_bytes() == b"whole-file"
    assert ready[1].jobs[r.json()["job_id"]]["camera_name"] == "Legacy"


@pytest.mark.asyncio
async def test_lost_final_ack_reuses_receipt_without_processing_twice(client, ready):
    async def send_final():
        return await client.post(
            "/process-upload", headers=HEADERS,
            files={"file": ("clip.webm", b"complete", "video/webm")},
            data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": "0", "is_final": "true"},
        )
    import asyncio
    first, retry = await asyncio.gather(send_final(), send_final())
    assert first.status_code == retry.status_code == 202
    assert first.json() == retry.json()
    assert len(ready[1].jobs) == 1


@pytest.mark.asyncio
async def test_missing_parts_survive_and_can_be_retried(client, ready, tmp_path):
    async def send(idx, data, final):
        return await client.post(
            "/process-upload", headers=HEADERS,
            files={"file": ("clip.webm", data, "video/webm")},
            data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": str(idx), "is_final": str(final).lower()},
        )
    assert (await send(0, b"first-", False)).status_code == 200
    assert (await send(2, b"last", True)).status_code == 400
    assert (await send(1, b"middle-", False)).status_code == 200
    assert (await send(2, b"last", True)).status_code == 202
    assert assembled(ready, tmp_path) == b"first-middle-last"


@pytest.mark.asyncio
async def test_retry_cannot_replace_an_acknowledged_chunk(client, ready):
    async def send(data):
        return await client.post(
            "/process-upload", headers=HEADERS,
            files={"file": ("clip.webm", data, "video/webm")},
            data={"requested_by": OWNER, "session_id": SESSION, "chunk_index": "0", "is_final": "false"},
        )
    assert (await send(b"original")).status_code == 200
    assert (await send(b"replacement")).status_code == 409
    assert ready[1].jobs == {}


@pytest.mark.asyncio
async def test_missing_durable_store_refuses_before_ack(client, ready, monkeypatch):
    monkeypatch.setattr(main, "upload_store", None)
    response = await client.post("/process-upload", headers=HEADERS,
        data={"requested_by": OWNER}, files={"file": ("test.mp4", b"video", "video/mp4")})
    assert response.status_code == 503
    assert ready[1].jobs == {}


@pytest.mark.asyncio
async def test_owner_required_and_other_owner_cannot_reuse_session(client, ready):
    response = await client.post("/process-upload", headers=HEADERS,
        files={"file": ("test.mp4", b"video", "video/mp4")})
    assert response.status_code == 422
    async def send(owner):
        return await client.post("/process-upload", headers=HEADERS,
            data={"requested_by": owner, "session_id": SESSION},
            files={"file": ("test.mp4", b"video", "video/mp4")})
    assert (await send(OWNER)).status_code == 202
    assert (await send("99999999-9999-4999-8999-999999999999")).status_code == 409


@pytest.mark.asyncio
async def test_job_read_retry_and_cancel_enforce_owner_and_state(client, ready):
    await client.post("/process-upload", headers=HEADERS,
        data={"requested_by": OWNER, "session_id": SESSION},
        files={"file": ("test.mp4", b"video", "video/mp4")})
    other = "99999999-9999-4999-8999-999999999999"
    assert (await client.get(f"/upload-jobs/{SESSION}", headers=HEADERS,
        params={"requested_by": other})).status_code == 404
    assert (await client.post(f"/upload-jobs/{SESSION}/cancel", headers=HEADERS,
        json={"requested_by": other})).status_code == 404
    assert (await client.post(f"/upload-jobs/{SESSION}/retry", headers=HEADERS,
        json={"requested_by": OWNER})).status_code == 409
    ready[1].update_upload_job(SESSION, ("queued",), status="failed")
    retry = await client.post(f"/upload-jobs/{SESSION}/retry", headers=HEADERS,
        json={"requested_by": OWNER})
    assert retry.status_code == 200 and retry.json()["status"] == "queued"
    ready[1].update_upload_job(SESSION, ("queued",), status="delivering")
    assert (await client.post(f"/upload-jobs/{SESSION}/cancel", headers=HEADERS,
        json={"requested_by": OWNER})).status_code == 409
    ready[1].update_upload_job(SESSION, ("delivering",), status="failed")
    cancel = await client.post(f"/upload-jobs/{SESSION}/cancel", headers=HEADERS,
        json={"requested_by": OWNER})
    assert cancel.status_code == 200 and cancel.json()["status"] == "cancelled"
    assert "requested_by" not in cancel.json()
    assert "input_path" not in cancel.json()


@pytest.mark.asyncio
async def test_retry_rejects_corrupt_retained_input(client, ready):
    await client.post("/process-upload", headers=HEADERS,
        data={"requested_by": OWNER, "session_id": SESSION},
        files={"file": ("test.mp4", b"video", "video/mp4")})
    ready[1].update_upload_job(SESSION, ("queued",), status="failed")
    chunk = ready[0].directory(SESSION) / "0.enc"
    damaged = bytearray(chunk.read_bytes())
    damaged[-1] ^= 1
    chunk.write_bytes(damaged)
    retry = await client.post(f"/upload-jobs/{SESSION}/retry", headers=HEADERS,
        json={"requested_by": OWNER})
    assert retry.status_code == 409
    assert ready[1].jobs[SESSION]["status"] == "failed"


@pytest.mark.asyncio
async def test_shutdown_cancels_triggered_reveal_tasks():
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def active_reveal():
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    task = main._spawn(active_reveal())
    await asyncio.wait_for(started.wait(), 1)
    await asyncio.wait_for(main._stop_background_tasks(), 1)
    assert task.done()
    assert cancelled.is_set()
    assert not main._background_tasks
