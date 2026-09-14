"""Continuously drain the durable deletion queue; row retirement stays on cron.

Storage removals are idempotent. A crashed worker leaves an expiring lease;
settlement is fenced by its token. Never log object paths or credentials.
"""
import asyncio
import logging
from collections import defaultdict
from time import monotonic

log = logging.getLogger(__name__)
BUCKETS = frozenset({"recordings", "faces", "revealed"})


def drain_retention_queue(storage, max_batches=20, budget_seconds=30):
    client = storage.client
    deadline = monotonic() + budget_seconds
    result = {"settled": 0, "failed": 0}
    for _ in range(max_batches):
        if monotonic() >= deadline:
            break
        rows = client.rpc("claim_retention_deletions", {"p_limit": 250}).execute().data or []
        if not rows:
            break
        groups = defaultdict(list)
        for row in rows:
            if row["bucket"] not in BUCKETS or not row.get("object_path") or not row.get("lease_token"):
                raise ValueError("Invalid retention claim")
            groups[(row["bucket"], row["lease_token"])].append(row)
        for (bucket, token), group in groups.items():
            error = None
            try:
                client.storage.from_(bucket).remove([row["object_path"] for row in group])
            except Exception:
                # Persist an actionable category, not SDK exceptions containing paths/URLs.
                error = "Storage deletion unavailable; automatic retry scheduled"
            count = client.rpc("settle_retention_deletions", {
                "p_ids": [row["id"] for row in group], "p_lease_token": token, "p_error": error,
            }).execute().data
            if count != len(group):
                raise RuntimeError("Retention settlement lost its lease")
            result["failed" if error else "settled"] += len(group)
    return result


async def run_retention_worker(storage, interval_seconds=60):
    while True:
        try:
            result = await asyncio.to_thread(drain_retention_queue, storage)
            if result["failed"]:
                log.warning("Retention storage deletion deferred: %d objects", result["failed"])
            elif result["settled"]:
                log.info("Retention queue settled: %d objects", result["settled"])
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("Retention worker unavailable; retrying on next interval")
        await asyncio.sleep(interval_seconds)
