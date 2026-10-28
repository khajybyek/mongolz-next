from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from retention_worker import drain_retention_queue


def fixture(batches, remove_error=False, lost_lease=False):
    rows = [[{"id": str(i), "bucket": "revealed", "object_path": f"{i}.mp4", "lease_token": "lease"}
             for i in range(250)] for _ in range(batches)]
    settlements = []
    def rpc(name, args):
        if name == "claim_retention_deletions":
            data = rows.pop(0) if rows else []
        else:
            settlements.append(args)
            data = 0 if lost_lease else len(args["p_ids"])
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))
    remove = Mock(side_effect=RuntimeError("offline") if remove_error else None)
    client = SimpleNamespace(rpc=rpc, storage=SimpleNamespace(from_=lambda bucket: SimpleNamespace(remove=remove)))
    return SimpleNamespace(client=client), settlements, remove


def test_drains_more_than_daily_legacy_cap():
    store, settled, _ = fixture(6)
    assert drain_retention_queue(store) == {"settled": 1500, "failed": 0}
    assert len(settled) == 6


def test_failed_storage_retains_retryable_paths():
    store, settled, _ = fixture(1, remove_error=True)
    assert drain_retention_queue(store) == {"settled": 0, "failed": 250}
    assert settled[0]["p_error"]
    assert settled[0]["p_lease_token"] == "lease"  # noqa: S105 — test fixture


def test_lost_lease_never_acknowledges_success():
    store, _, _ = fixture(1, lost_lease=True)
    with pytest.raises(RuntimeError, match="lease"):
        drain_retention_queue(store)


def test_repeated_removal_of_missing_objects_is_successful():
    store, settled, remove = fixture(1)
    remove.return_value = []
    assert drain_retention_queue(store)["settled"] == 250
    assert settled[0]["p_error"] is None
