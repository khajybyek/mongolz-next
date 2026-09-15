"""Durable acceptance, interrupted workers, cancellation and delivery recovery.

Inputs are actually sealed/fsynced/reconstructed on disk. The job database and
encoder are substitutes so restart, lease ownership and timeout boundaries can
be exercised deterministically without touching a user's footage.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

import crypto_utils
from durable_jobs import UploadStore, UploadWorker, UploadConflict, RevealWorker

OWNER = "11111111-1111-4111-8111-111111111111"
JOB = "22222222-2222-4222-8222-222222222222"


class JobDB:
    def __init__(self):
        self.jobs = {}
        self.ready = set()
        self.resets = []
        self.offline = False

    def ensure_upload_job(self, row):
        if self.offline:
            raise ConnectionError("offline")
        self.jobs.setdefault(row["id"], {"attempts": 0, "progress": 0, **row})
        return dict(self.jobs[row["id"]])

    def upload_job(self, key):
        return dict(self.jobs[key]) if key in self.jobs else None

    def update_upload_job(self, key, statuses, **fields):
        row = self.jobs.get(key)
        if row and row["status"] in statuses:
            row.update(fields)
            return dict(row)
        return None

    def upload_recording_ready(self, key):
        return key in self.ready

    def reset_uncommitted_upload(self, key):
        assert key not in self.ready
        self.resets.append(key)


class Spool:
    def __init__(self, db):
        self.db = db
        self.pending = set()
        self.offline = False

    def has_pending(self, key):
        return key in self.pending

    def deliver(self, _storage, key):
        if self.offline:
            return False
        if key in self.pending:
            self.pending.remove(key)
            self.db.ready.add(key)
        return True


def accept(store, db, **overrides):
    return store.accept(db, **{
        "job_id": JOB, "owner": OWNER, "camera_name": "Test camera", "suffix": ".mp4",
        "index": 0, "final": True, "data": b"synthetic source video bytes", **overrides,
    })


def factory(db, spool, seen, *, cancel=False, interrupted=False, timeout=False, incomplete=False):
    class Session:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.recording_id = kwargs["recording_id"]
            self.input_complete = False
            self.processing_complete = False
            self.task = None
            self.stops = []
            self.source_duration_sec = 4
            self.capture_time_sec = 2
            seen.append(self)

        async def start(self):
            assert Path(self.kwargs["source_url"]).read_bytes() == b"synthetic source video bytes"
            # Output survives /tmp cleanup if encryption/spooling is pending.
            assert Path(self.kwargs["recordings_dir"]).is_relative_to(store_root[0])
            async def run():
                if cancel:
                    db.update_upload_job(JOB, ("processing",), status="cancelled")
                if interrupted:
                    raise asyncio.CancelledError()
                if timeout:
                    await asyncio.sleep(60)
                self.input_complete = not incomplete
            self.task = asyncio.create_task(run())

        async def stop(self, finalize=True):
            self.stops.append(finalize)
            if self.task and not self.task.done():
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)
            if finalize:
                self.processing_complete = True
                spool.pending.add(self.recording_id)
                spool.deliver(db, self.recording_id)

    return Session


store_root = [Path("/")]


@pytest.fixture
def context(tmp_path, monkeypatch):
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", b"s" * 32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    store = UploadStore(tmp_path / "durable")
    store_root[0] = store.root
    db = JobDB()
    return store, db, Spool(db), []


def worker(context, **behavior):
    store, db, spool, seen = context
    return UploadWorker(store, db, spool, factory(db, spool, seen, **behavior), hls_dir="unused", timeout=0 if behavior.get("timeout") else 30)


def test_encrypted_input_and_receipt_survive_new_store_instance(context, tmp_path):
    store, db, _spool, _seen = context
    receipt = accept(store, db)
    assert receipt["status"] == "queued"
    encrypted = (store.directory(JOB) / "0.enc").read_bytes()
    assert b"synthetic source video bytes" not in encrypted
    restarted = UploadStore(store.root)
    assert accept(restarted, db) == receipt
    output = tmp_path / "assembled.mp4"
    restarted.assemble(JOB, output)
    assert output.read_bytes() == b"synthetic source video bytes"
    assert len(db.jobs) == 1


def test_db_outage_after_durable_manifest_is_repaired(context):
    store, db, _spool, _seen = context
    db.offline = True
    with pytest.raises(ConnectionError):
        accept(store, db)
    assert store.manifest(JOB)["accepted"] is True
    db.offline = False
    assert accept(UploadStore(store.root), db)["status"] == "queued"
    assert len(db.jobs) == 1


def test_receipt_checks_owner_and_content_even_after_acceptance(context):
    store, db, *_ = context
    accept(store, db)
    with pytest.raises(UploadConflict):
        accept(store, db, owner=str(uuid4()))
    with pytest.raises(UploadConflict):
        accept(store, db, data=b"replacement")
    with pytest.raises(UploadConflict):
        accept(store, db, camera_name="different")


def test_input_integrity_is_checked_on_reconstruction(context, tmp_path):
    store, db, *_ = context
    accept(store, db)
    path = store.directory(JOB) / "0.enc"
    data = bytearray(path.read_bytes())
    data[-1] ^= 1
    path.write_bytes(data)
    with pytest.raises(Exception):
        store.assemble(JOB, tmp_path / "output.mp4")


def test_railway_rejects_unmounted_and_outside_volume(monkeypatch, tmp_path):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "production")
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", str(tmp_path))
    monkeypatch.setenv("UPLOAD_JOB_DIR", str(tmp_path / "inputs"))
    with pytest.raises(RuntimeError, match="mounted Railway volume"):
        UploadStore.from_env()
    monkeypatch.setattr("durable_jobs.os.path.ismount", lambda p: True)
    monkeypatch.setenv("UPLOAD_JOB_DIR", str(tmp_path.parent / "outside"))
    with pytest.raises(RuntimeError):
        UploadStore.from_env()


def test_railway_default_upload_path_is_sibling_of_spool(monkeypatch, tmp_path):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "production")
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", str(tmp_path))
    monkeypatch.setenv("RECORDING_SPOOL_DIR", str(tmp_path / "recording-spool"))
    monkeypatch.delenv("UPLOAD_JOB_DIR", raising=False)
    monkeypatch.setattr("durable_jobs.os.path.ismount", lambda p: True)
    store = UploadStore.from_env()
    assert store.root == (tmp_path / "upload-jobs").resolve()


@pytest.mark.asyncio
async def test_ready_requires_eof_and_delivery_acknowledgment(context):
    store, db, spool, seen = context
    receipt = accept(store, db)
    spool.offline = True
    await worker(context).process(JOB)
    assert db.jobs[JOB]["status"] == "delivering"
    assert (store.directory(JOB) / "0.enc").exists()
    spool.offline = False
    await worker(context).process(JOB)
    assert db.jobs[JOB]["status"] == "ready"
    assert db.jobs[JOB]["recording_id"] == receipt["recording_id"]
    assert len(seen) == 1  # Delivery retry never decodes/render again.
    assert not (store.directory(JOB) / "0.enc").exists()
    assert accept(UploadStore(store.root), db)["status"] == "ready"


@pytest.mark.asyncio
async def test_restart_recovers_accepted_but_unregistered_input(context):
    store, db, _spool, seen = context
    db.offline = True
    with pytest.raises(ConnectionError):
        accept(store, db)
    db.offline = False
    await worker(context).run_once()
    assert db.jobs[JOB]["status"] == "ready"
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_cancel_wins_before_finalize(context):
    store, db, spool, seen = context
    accept(store, db)
    await worker(context, cancel=True).process(JOB)
    assert db.jobs[JOB]["status"] == "cancelled"
    assert seen[0].stops == [False]
    assert not spool.pending and not db.ready
    await worker(context).run_once()
    assert not (store.directory(JOB) / "0.enc").exists()


@pytest.mark.asyncio
async def test_interrupted_worker_resumes_same_recording_id(context):
    store, db, spool, seen = context
    receipt = accept(store, db)
    with pytest.raises(asyncio.CancelledError):
        await worker(context, interrupted=True).process(JOB)
    assert db.jobs[JOB]["status"] == "processing"
    assert (store.directory(JOB) / "0.enc").exists()
    # Recreate both the store and worker as a replacement container/process
    # would. Recovery must come only from the fsynced volume + database row,
    # never an in-memory reference retained by the interrupted worker.
    restarted_store = UploadStore(store.root)
    restarted_context = (restarted_store, db, spool, seen)
    await worker(restarted_context).run_once()
    assert db.jobs[JOB]["status"] == "ready"
    assert db.jobs[JOB]["attempts"] == 2
    assert {s.recording_id for s in seen} == {receipt["recording_id"]}
    assert not (restarted_store.directory(JOB) / "0.enc").exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("behavior", [{"timeout": True}, {"incomplete": True}])
async def test_timeout_or_non_eof_never_publishes_partial_success(context, behavior):
    store, db, spool, seen = context
    accept(store, db)
    await worker(context, **behavior).process(JOB)
    assert db.jobs[JOB]["status"] == "failed"
    assert not db.ready and not spool.pending
    assert all(flag is False for flag in seen[0].stops)
    assert (store.directory(JOB) / "0.enc").exists()
    # The explicit failed→queued action preserves the original input and UUID.
    db.update_upload_job(JOB, ("failed",), status="queued", attempts=0)
    await worker(context).process(JOB)
    assert db.jobs[JOB]["status"] == "ready"


@pytest.mark.asyncio
async def test_process_lock_prevents_duplicate_processing(context):
    store, db, _spool, seen = context
    accept(store, db)
    await asyncio.gather(worker(context).process(JOB), worker(context).process(JOB))
    assert len(seen) == 1
    assert db.jobs[JOB]["status"] == "ready"


def test_worker_lock_fences_an_independent_process(context):
    store, *_ = context
    script = (
        "from durable_jobs import UploadStore; import sys; "
        "store=UploadStore(sys.argv[1]); "
        "scope=store.lock(sys.argv[2], worker=True); "
        "owned=scope.__enter__(); print(int(owned)); scope.__exit__(None,None,None)"
    )
    with store.lock(JOB, worker=True) as owned:
        assert owned
        child = subprocess.run(
            [sys.executable, "-c", script, str(store.root), JOB],
            check=True, capture_output=True, text=True, timeout=5,
        )
    assert child.stdout.strip() == "0"


@pytest.mark.asyncio
async def test_failed_jobs_kept_and_unaccepted_chunks_expire(context):
    store, db, *_ = context
    accept(store, db, final=False)
    path = store.directory(JOB) / "input.json"
    manifest = json.loads(path.read_text())
    manifest["updated_at"] = 1
    path.write_text(json.dumps(manifest))
    await worker(context).run_once()
    assert not path.exists()
    accept(store, db)
    db.update_upload_job(JOB, ("queued",), status="failed")
    await worker(context).run_once()
    assert (store.directory(JOB) / "0.enc").exists()


@pytest.mark.asyncio
async def test_reveal_worker_shutdown_interrupts_active_reconciliation():
    started = asyncio.Event()
    interrupted = asyncio.Event()

    class Storage:
        def runnable_reveal_jobs(self):
            return [JOB]

    class Processor:
        async def run(self, _job_id):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                interrupted.set()
                raise

    reveal = RevealWorker(Storage(), Processor())
    reveal.start()
    await asyncio.wait_for(started.wait(), 1)
    await asyncio.wait_for(reveal.stop(), 1)
    assert interrupted.is_set()
    assert reveal.task is None
