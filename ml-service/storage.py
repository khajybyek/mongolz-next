"""
SupabaseStorage — Supabase PostgreSQL (pgvector) + Storage wrapper.
Service-role key ашиглана (RLS bypass) — зөвхөн backend service-аас дуудна.
"""

from __future__ import annotations

import logging
import os
import time as _time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from supabase import Client, create_client

log = logging.getLogger("mongolz-ml.storage")

# In-memory burst trackers (per ML worker). For a single Railway dyno this is
# sufficient; with horizontal scaling we'd need Redis. Capstone deployment is
# single-replica so this is fine.
_BURST_WINDOWS: dict[str, deque[float]] = {}
_KST = ZoneInfo("Asia/Seoul")


def _unix_now() -> float:
    return _time.time()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_minutes_ago(seconds: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def _check_burst(rule_id: str, suspect_id: str, camera_id: str | None,
                 burst_count: int, burst_window_sec: int) -> bool:
    """Returns True when N events have been seen within the window for this key."""
    key = f"{rule_id}:{suspect_id}:{camera_id or 'none'}"
    now = _unix_now()
    q = _BURST_WINDOWS.setdefault(key, deque())
    cutoff = now - burst_window_sec
    while q and q[0] < cutoff:
        q.popleft()
    q.append(now)
    return len(q) >= burst_count


def _within_quiet_hours(quiet_from: str, quiet_to: str) -> bool:
    """quiet_from / quiet_to are 'HH:MM' in KST. Handles wrap-around (23:00–07:00)."""
    try:
        fh, fm = map(int, quiet_from.split(":"))
        th, tm = map(int, quiet_to.split(":"))
    except Exception:
        return False
    now = datetime.now(_KST)
    now_minutes = now.hour * 60 + now.minute
    from_minutes = fh * 60 + fm
    to_minutes = th * 60 + tm
    if from_minutes == to_minutes:
        return False
    if from_minutes < to_minutes:
        return from_minutes <= now_minutes < to_minutes
    # Wrap-around window (e.g. 23:00 → 07:00)
    return now_minutes >= from_minutes or now_minutes < to_minutes


class SupabaseStorage:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            log.warning("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY байхгүй — DB ажиллахгүй")
            self.client: Client | None = None
        else:
            self.client = create_client(url, key)
            log.info("Supabase client ready")

    # ── Suspects ──────────────────────────────────────────────
    async def match_suspects(
        self, embedding: list[float], threshold: float = 0.45, limit: int = 5
    ) -> list[dict[str, Any]]:
        if not self.client:
            return []
        res = self.client.rpc(
            "match_suspects",
            {"query_embedding": embedding, "match_threshold": threshold, "match_limit": limit},
        ).execute()
        return res.data or []

    async def match_faces(
        self, embedding: list[float], threshold: float = 0.5, limit: int = 50
    ) -> list[dict[str, Any]]:
        if not self.client:
            return []
        res = self.client.rpc(
            "match_faces",
            {"query_embedding": embedding, "match_threshold": threshold, "match_limit": limit},
        ).execute()
        return res.data or []

    # ── Faces (детект болсон нүүр бүрийг бичих) ───────────────
    async def insert_face(
        self,
        filename: str,
        image_path: str,
        embedding: list[float],
        camera_id: str | None,
        recording_id: str | None = None,
        bbox: dict | None = None,
        chain_index: int | None = None,
        embedding_sealed: str | None = None,
        crop_sealed: bool = False,
    ) -> str | None:
        if not self.client:
            return None
        row = {
            "filename": filename,
            "image_path": image_path,
            "embedding": embedding,
            "camera_id": camera_id,
            "recording_id": recording_id,
            "bbox": bbox,
        }
        # Hierarchical key fields (ADR 0009) — only set when provided so the
        # insert stays backward-compatible with pre-migration deployments.
        if chain_index is not None:
            row["chain_index"] = chain_index
        if embedding_sealed is not None:
            row["embedding_sealed"] = embedding_sealed
        # When true, the ONLY crop on storage is the encrypted blob at
        # image_path + ".enc" — sealed with the chain key K_index. No
        # plaintext crop exists for new faces (ADR 0009 / Tier 2 T2.4).
        # Legacy rows (chain_index NULL) still have plaintext crops at
        # image_path and are served as-is by the unified secure-crop
        # endpoint.
        if crop_sealed:
            row["crop_sealed"] = True
        res = self.client.table("faces").insert(row).execute()
        return res.data[0]["id"] if res.data else None

    # ── Alert (rule-aware) ────────────────────────────────────
    async def insert_alert(
        self,
        suspect_id: str,
        suspect_name: str,
        face_id: str | None,
        similarity: float,
        screenshot_path: str | None,
        camera_id: str | None,
        camera_name: str | None,
    ):
        """Insert alert with rule-based filtering + dedup.

        Behaviour:
        1. If no enabled rules match this (suspect_id, camera_id, similarity)
           pair → fall back to legacy behaviour (always insert).
        2. If a rule matches, honour its dedup_window_sec: increment
           match_count on an existing alert in-window instead of inserting.
        3. Burst smoothing: if `burst_count > 1`, only insert when N matches
           have been recorded in `burst_window_sec` (uses a lightweight
           in-memory pending bucket).
        4. Quiet hours: skip alerting entirely while within window.
        """
        if not self.client:
            return

        rule = await self._select_alert_rule(suspect_id, camera_id, similarity)

        if rule and rule.get("quiet_from") and rule.get("quiet_to"):
            if _within_quiet_hours(rule["quiet_from"], rule["quiet_to"]):
                return

        if rule and rule.get("burst_count", 1) > 1:
            if not _check_burst(
                rule["id"],
                suspect_id,
                camera_id,
                int(rule["burst_count"]),
                int(rule["burst_window_sec"]),
            ):
                return

        dedup_key = None
        dedup_window = int(rule["dedup_window_sec"]) if rule else 0
        if dedup_window > 0:
            bucket = int(_unix_now() // dedup_window)
            dedup_key = f"{suspect_id}:{camera_id or 'none'}:{bucket}"
            cutoff = _iso_minutes_ago(seconds=dedup_window)
            existing = (
                self.client.table("alerts")
                .select("id, match_count")
                .eq("dedup_key", dedup_key)
                .gte("created_at", cutoff)
                .limit(1)
                .execute()
            )
            if existing.data:
                row = existing.data[0]
                self.client.table("alerts").update(
                    {
                        "match_count": int(row.get("match_count") or 1) + 1,
                        "last_seen_at": _iso_now(),
                        "similarity": max(similarity, float(row.get("similarity") or 0)),
                    }
                ).eq("id", row["id"]).execute()
                return

        self.client.table("alerts").insert(
            {
                "suspect_id": suspect_id,
                "suspect_name": suspect_name,
                "face_id": face_id,
                "similarity": similarity,
                "screenshot_path": screenshot_path,
                "camera_id": camera_id,
                "camera_name": camera_name or "Unknown",
                "rule_id": rule["id"] if rule else None,
                "dedup_key": dedup_key,
                "match_count": 1,
                "last_seen_at": _iso_now(),
            }
        ).execute()

    async def _select_alert_rule(
        self,
        suspect_id: str,
        camera_id: str | None,
        similarity: float,
    ) -> dict | None:
        """Pick the most specific enabled rule matching this event."""
        if not self.client:
            return None
        # Order: suspect+camera specific > suspect-only > camera-only > global
        try:
            res = (
                self.client.table("alert_rules")
                .select(
                    "id, name, suspect_id, camera_id, min_similarity, "
                    "dedup_window_sec, burst_count, burst_window_sec, "
                    "quiet_from, quiet_to"
                )
                .eq("enabled", True)
                .lte("min_similarity", similarity)
                .execute()
            )
        except Exception:
            return None

        candidates = []
        for r in res.data or []:
            sm = r.get("suspect_id")
            cm = r.get("camera_id")
            if sm and sm != suspect_id:
                continue
            if cm and cm != camera_id:
                continue
            specificity = (1 if sm else 0) + (1 if cm else 0)
            candidates.append((specificity, r))
        if not candidates:
            return None
        candidates.sort(key=lambda x: -x[0])
        return candidates[0][1]

    # ── Recording: ID-тай буцаах (faces-руу back-link хийхэд) ──
    async def insert_recording_returning_id(
        self,
        filename: str,
        storage_path: str,
        duration_sec: int | None,
        size_bytes: int | None,
        encrypted: bool,
        has_original: bool,
        camera_id: str | None,
        camera_name: str | None,
        started_at: str,
        ended_at: str | None,
        original_path: str | None = None,
        recording_id: str | None = None,
        blur_strategy: str = "baked",
    ) -> str | None:
        """Recording insert. `recording_id` өгсөн бол түүгээр хадгална
        (encryption-д key derivation-аас өмнө ID-г мэдэх шаардлагатай).

        ``blur_strategy``:
          * ``"baked"`` (legacy) — separate blurred MP4 persisted at
            ``storage_path``; reveal flow + playback both use this artifact.
          * ``"on_demand"`` (#3) — no blurred MP4; playback view is derived
            from the encrypted original at request time via the ML
            ``/recording/{id}/view`` endpoint.
        """
        if not self.client:
            return None
        row: dict = {
            "filename": filename,
            "storage_path": storage_path,
            "duration_sec": duration_sec,
            "size_bytes": size_bytes,
            "encrypted": encrypted,
            "has_original": has_original,
            "original_path": original_path,
            "camera_id": camera_id,
            "camera_name": camera_name,
            "started_at": started_at,
            "ended_at": ended_at,
            "blur_strategy": blur_strategy,
        }
        if recording_id:
            row["id"] = recording_id
        res = self.client.table("recordings").insert(row).execute()
        return res.data[0]["id"] if res.data else None

    # ── Recording (хуучин wrapper, ID буцахгүй) ────────────
    async def insert_recording(
        self,
        filename: str,
        storage_path: str,
        duration_sec: int | None,
        size_bytes: int | None,
        encrypted: bool,
        has_original: bool,
        camera_id: str | None,
        camera_name: str | None,
        started_at: str,
        ended_at: str | None,
        original_path: str | None = None,
    ):
        if not self.client:
            return
        self.client.table("recordings").insert(
            {
                "filename": filename,
                "storage_path": storage_path,
                "duration_sec": duration_sec,
                "size_bytes": size_bytes,
                "encrypted": encrypted,
                "has_original": has_original,
                "original_path": original_path,
                "camera_id": camera_id,
                "camera_name": camera_name,
                "started_at": started_at,
                "ended_at": ended_at,
            }
        ).execute()

    # ── Storage upload ────────────────────────────────────────
    def upload_bytes(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        if not self.client:
            return ""
        self.client.storage.from_(bucket).upload(
            path, data, {"content-type": content_type, "upsert": "true"}
        )
        return path
