"""
SupabaseStorage — Supabase PostgreSQL (pgvector) + Storage wrapper.
Service-role key ашиглана (RLS bypass) — зөвхөн backend service-аас дуудна.
"""

from __future__ import annotations

import base64
import logging
import os
import time as _time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from supabase import Client, create_client

from crypto_utils import decrypt_bytes, encrypt_bytes

log = logging.getLogger("mongolz-ml.storage")

# camera_sessions.last_error column limit (DB CHECK) — truncate, never fail.
_CAMERA_SESSION_ERROR_MAX = 500


def _camera_seal_context(camera_id: str) -> str:
    # Namespaced so a per-camera HKDF key can never collide with a
    # recording key (recording ids are bare UUIDs).
    return f"camera:{camera_id}"


def seal_camera_url(camera_id: str, url: str) -> str:
    """Plaintext source URL (may embed RTSP credentials) → base64 AES-GCM blob."""
    return base64.b64encode(encrypt_bytes(url.encode("utf-8"), _camera_seal_context(camera_id))).decode("ascii")


def unseal_camera_url(camera_id: str, sealed: str) -> str:
    """Inverse of seal_camera_url; ML_ENCRYPTION_KEY_PREV fallback is inherited
    from decrypt_bytes so a key rotation does not orphan persisted sessions."""
    return decrypt_bytes(base64.b64decode(sealed), _camera_seal_context(camera_id)).decode("utf-8")

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
                .select("id, match_count, similarity")
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

    async def update_recording(self, recording_id: str, fields: dict) -> None:
        """Patch a recording row (used by _finalize to fill duration/size/…)."""
        if not self.client:
            return
        self.client.table("recordings").update(fields).eq("id", recording_id).execute()

    def commit_recording_delivery(self, recording_id: str, fields: dict) -> None:
        """Idempotent durable-delivery acknowledgement (called off the loop).

        An existing capture placeholder and a retry after a lost DB response
        both use the same primary key. Never acknowledge an unconfigured
        client or an empty response: the encrypted spool must survive those.
        """
        if not self.client:
            raise RuntimeError("Recording storage is not configured")
        row = {**fields, "id": recording_id}
        result = self.client.table("recordings").upsert(row, on_conflict="id").execute()
        if not result.data or not any(item.get("id") == recording_id for item in result.data):
            raise RuntimeError("Database did not acknowledge recording delivery")

    async def delete_recording(self, recording_id: str) -> None:
        """Remove a placeholder row for a session that produced no artifact."""
        if not self.client:
            return
        self.client.table("recordings").delete().eq("id", recording_id).execute()

    def fail_stale_reveal_jobs(self, older_than_minutes: int = 30) -> int:
        """Startup sweep: a container restart mid-reveal left jobs stuck in
        'processing' forever (no retry, no error). Mark them failed so the UI
        stops polling and the requester can resubmit."""
        if not self.client:
            return 0
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)).isoformat()
        try:
            res = (
                self.client.table("reveal_jobs")
                .update({
                    "status": "failed",
                    "error_message": "ML service restarted while the job was processing — please resubmit",
                    "completed_at": _iso_now(),
                })
                .eq("status", "processing")
                .lt("started_at", cutoff)
                .execute()
            )
            n = len(res.data or [])
            if n:
                log.warning("Marked %d stale reveal job(s) as failed", n)
            return n
        except Exception as e:  # noqa: BLE001 — startup must not fail on this
            log.warning("stale reveal sweep failed: %s", e)
            return 0

    # ── camera_sessions — auto-resume registry ────────────────
    # Every helper swallows Supabase errors: the registry is an optimisation
    # (cameras come back after a redeploy); it must never take the capture
    # loop or startup down with it. Only the sealed URL is ever stored or
    # logged — never the plaintext source.
    def upsert_camera_session(
        self, camera_id: str, sealed_url: str, camera_name: str | None, fps: int
    ) -> bool:
        if not self.client:
            return False
        now = _iso_now()
        try:
            self.client.table("camera_sessions").upsert(
                {
                    "camera_id": camera_id,
                    "sealed_url": sealed_url,
                    "camera_name": camera_name,
                    "fps": int(fps),
                    "auto_resume": True,
                    "last_error": None,
                    "started_at": now,
                    "updated_at": now,
                },
                on_conflict="camera_id",
            ).execute()
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("camera_sessions upsert failed for %s: %s", camera_id, type(e).__name__)
            return False

    def set_camera_session_resume(self, camera_id: str, auto_resume: bool) -> bool:
        if not self.client:
            return False
        try:
            self.client.table("camera_sessions").update(
                {"auto_resume": bool(auto_resume), "updated_at": _iso_now()}
            ).eq("camera_id", camera_id).execute()
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("camera_sessions resume flag failed for %s: %s", camera_id, type(e).__name__)
            return False

    def record_camera_session_error(self, camera_id: str, message: str) -> bool:
        if not self.client:
            return False
        try:
            self.client.table("camera_sessions").update(
                {
                    "last_error": (message or "")[:_CAMERA_SESSION_ERROR_MAX],
                    "updated_at": _iso_now(),
                }
            ).eq("camera_id", camera_id).execute()
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("camera_sessions error record failed for %s: %s", camera_id, type(e).__name__)
            return False

    def list_resumable_sessions(self) -> list[dict]:
        """Rows with auto_resume=true; disabled rows are reconciled in SQL."""
        if not self.client:
            return []
        try:
            res = (
                self.client.table("camera_sessions")
                .select("camera_id, sealed_url, camera_name, fps, auto_resume, last_error")
                .eq("auto_resume", True)
                .execute()
            )
            return list(res.data or [])
        except Exception as e:  # noqa: BLE001
            log.warning("camera_sessions list failed: %s", type(e).__name__)
            return []

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
