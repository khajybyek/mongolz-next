"""
SupabaseStorage — Supabase PostgreSQL (pgvector) + Storage wrapper.
Service-role key ашиглана (RLS bypass) — зөвхөн backend service-аас дуудна.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from supabase import Client, create_client

log = logging.getLogger("mongolz-ml.storage")


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
    ) -> str | None:
        if not self.client:
            return None
        res = (
            self.client.table("faces")
            .insert(
                {
                    "filename": filename,
                    "image_path": image_path,
                    "embedding": embedding,
                    "camera_id": camera_id,
                    "recording_id": recording_id,
                    "bbox": bbox,
                }
            )
            .execute()
        )
        return res.data[0]["id"] if res.data else None

    # ── Alert ─────────────────────────────────────────────────
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
        if not self.client:
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
            }
        ).execute()

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
    ) -> str | None:
        """Recording insert. `recording_id` өгсөн бол түүгээр хадгална
        (encryption-д key derivation-аас өмнө ID-г мэдэх шаардлагатай).
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
