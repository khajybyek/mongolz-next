"""
SupabaseStorage — Supabase PostgreSQL (pgvector) + Storage wrapper.
Service-role key ашиглана (RLS bypass) — зөвхөн backend service-аас дуудна.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import time as _time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from supabase import Client, create_client

from crypto_utils import decrypt_bytes, encrypt_bytes
from privacy_schedule import CameraSchedule, PrivacySpanNotFound, schedule_from_rows

log = logging.getLogger("mongolz-ml.storage")

# camera_sessions.last_error column limit (DB CHECK) — truncate, never fail.
_CAMERA_SESSION_ERROR_MAX = 500


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    """Env-ээс int уншина. Буруу утга бол default-руу буцаж, ЧИМЭЭГҮЙ биш —
    log.warning бичнэ (алдаатай тохиргоо нь alert-ын зан төлөвийг өөрчилдөг)."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        log.warning("%s=%r нь бүхэл тоо биш — default %d ашиглав", name, raw, default)
        return default
    if value < minimum:
        log.warning("%s=%d нь доод хязгаар %d-аас бага — %d ашиглав", name, value, minimum, minimum)
        return minimum
    return value


def _coerce_int(value: Any, default: int) -> int:
    """PostgREST numeric багана str/None-ээр ирж болно (numeric(4,3) → '0.650')."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _coerce_float(value: Any, default: float) -> float:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return result if result == result else default  # NaN → default


# Alert dedup: alert_rules-д тохирох дүрэм ОЛДООГҮЙ үед хэрэглэх цонх.
# Өмнө нь дүрэмгүй үед dedup огт хийгддэггүй байсан (window = 0) — session-ийн
# турш үргэлжлэх face dedup нь давталтыг бүгдийг нь дардаг байсан тул энэ нь
# анзаарагддаггүй байв. Session dedup-д цаг хугацааны цонх орсны дараа (audit
# 4.7) давтан ирэлт alert path-руу хүрдэг болсон тул энэ default цонх нь
# «нэг хүн = нэг явдал» гэдгийг барих давхарга болно.
# 300 сек = alert_rules.dedup_window_sec-ийн DB default-той ижил.
DEFAULT_DEDUP_WINDOW_SEC = _env_int("ALERT_DEDUP_WINDOW_SEC", 300, minimum=0)

# Нэг dedup_key дээр цонхны дотор шалгах хамгийн олон мөр. Хамгийн сүүлийн
# нээлттэй alert-ыг олоход хангалттай (хаагдсан alert-уудыг алгасах зай).
_DEDUP_CANDIDATE_LIMIT = 5

# insert_alert-ийн үр дүн — дуудагч нь ЮУ болсныг логт үнэн зөв бичих
# боломжтой болно ("🚨 ALERT" гэж бичээд бодитоор юу ч болоогүй байх нь
# энэ codebase-ийн давтагдах алдааны төрөл).
AlertOutcome = Literal["inserted", "merged", "quiet_hours", "burst_pending", "no_client"]


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


@dataclass(frozen=True)
class CameraDesiredState:
    """What the DATABASE says should be running for one camera.

    The operator's toggle lives in ``cameras.enabled`` and the ML-owned
    resume flag in ``camera_sessions.auto_resume``. Both are re-read before
    a (re)start so a camera the operator disabled while this container was
    unreachable does not come back (audit 4.5).

    ``known`` is False when the registry could not be read at all (no
    Supabase client, or the query failed). Callers MUST fail open in that
    case: a DB blip must never tear down a healthy capture loop.
    """

    known: bool = False
    camera_exists: bool = False
    enabled: bool | None = None
    session_exists: bool = False
    auto_resume: bool | None = None

    def start_refusal(self) -> str | None:
        """Why this camera must not be started at all, or None when it may."""
        if not self.known:
            return None
        if not self.camera_exists:
            return "camera row missing (deleted)"
        if self.enabled is False:
            return "camera disabled by operator"
        return None

    def resume_refusal(self) -> str | None:
        """As start_refusal, plus the operator's auto_resume flag.

        A MISSING camera_sessions row is deliberately not a refusal: the row
        is written best-effort on start, so a registry write that failed once
        must not silently end a running capture. Only an explicit
        ``auto_resume = false`` (an operator stop, or the disable trigger)
        stops a supervised restart.
        """
        refusal = self.start_refusal()
        if refusal:
            return refusal
        if self.session_exists and self.auto_resume is False:
            return "auto_resume cleared (stopped by operator)"
        return None


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


async def _run_query(query):
    """Run a blocking PostgREST call off the event loop.

    supabase-py is synchronous: every `.execute()` inside an `async def` here
    parked the whole ML event loop — the capture tasks, the HLS writers and
    every HTTP handler — for the round trip. With the alert path now running
    per person per minute rather than once per session, that stall is on the
    hot path.
    """
    return await asyncio.to_thread(query.execute)


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
        # Fail-open (alert гарна), гэхдээ чимээгүй биш: буруу бичсэн quiet
        # hours нь «чимээгүй цаг ажиллахгүй байна» гэдгийг оператор мэдэх ёстой.
        log.warning("quiet hours буруу форматтай (%r–%r) — үл тоов", quiet_from, quiet_to)
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

    # ── Edge agents ───────────────────────────────────────────
    def upsert_edge_agent(
        self,
        *,
        agent_id: str,
        name: str,
        camera_id: str,
        version: str,
        state: str,
        queue_depth: int,
        oldest_queued_at: str | None,
        sent_total: int,
        failed_total: int,
        last_error: str | None,
    ) -> bool:
        """Publish sanitized device health. Camera URLs and spool keys never
        enter the cloud status row or application logs."""
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        camera = (
            self.client.table("cameras")
            .select("enabled")
            .eq("id", camera_id)
            .maybe_single()
            .execute()
        )
        if not camera or not camera.data:
            raise RuntimeError("Camera is not registered")
        capture_enabled = bool(camera.data.get("enabled"))
        row = {
            "id": agent_id,
            "name": name[:120],
            "camera_id": camera_id,
            "capture_enabled": capture_enabled,
            "version": version[:40],
            "state": state if state in {"online", "degraded"} else "degraded",
            "queue_depth": max(0, int(queue_depth)),
            "oldest_queued_at": oldest_queued_at,
            "sent_total": max(0, int(sent_total)),
            "failed_total": max(0, int(failed_total)),
            "last_error": (last_error or "")[:500] or None,
            "last_seen_at": _iso_now(),
            "updated_at": _iso_now(),
        }
        result = self.client.table("edge_agents").upsert(row, on_conflict="id").execute()
        if not result.data:
            raise RuntimeError("Database did not acknowledge edge heartbeat")
        return capture_enabled

    def get_edge_event(self, event_id: str) -> dict[str, Any] | None:
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        result = (
            self.client.table("edge_ingest_events")
            .select("id,agent_id,camera_id,payload_sha256,face_count,received_at")
            .eq("id", event_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None

    def insert_edge_event(
        self,
        *,
        event_id: str,
        agent_id: str,
        camera_id: str,
        captured_at: str,
        payload_sha256: str,
        face_count: int,
    ) -> dict[str, Any]:
        """Record the durable acknowledgement for one selected frame.

        The event id is supplied by the encrypted edge outbox and is the
        primary key, so a lost HTTP acknowledgement can be retried without
        creating another event.
        """
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        row = {
            "id": event_id,
            "agent_id": agent_id,
            "camera_id": camera_id,
            "captured_at": captured_at,
            "payload_sha256": payload_sha256,
            "face_count": max(0, int(face_count)),
        }
        result = self.client.table("edge_ingest_events").insert(row).execute()
        if not result.data:
            raise RuntimeError("Database did not acknowledge edge event")
        return result.data[0]

    # ── Suspects ──────────────────────────────────────────────
    async def match_suspects(
        self, embedding: list[float], threshold: float = 0.45, limit: int = 5
    ) -> list[dict[str, Any]]:
        if not self.client:
            return []
        res = await _run_query(self.client.rpc(
            "match_suspects",
            {"query_embedding": embedding, "match_threshold": threshold, "match_limit": limit},
        ))
        return res.data or []

    async def match_faces(
        self, embedding: list[float], threshold: float = 0.5, limit: int = 50
    ) -> list[dict[str, Any]]:
        if not self.client:
            return []
        res = await _run_query(self.client.rpc(
            "match_faces",
            {"query_embedding": embedding, "match_threshold": threshold, "match_limit": limit},
        ))
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
        detection_confidence: float | None = None,
        source_offset_sec: float | None = None,
        detected_at: str | None = None,
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
        if source_offset_sec is not None:
            row["source_offset_sec"] = source_offset_sec
        if detection_confidence is not None:
            row["detection_confidence"] = max(0.0, min(1.0, float(detection_confidence)))
        if detected_at is not None:
            row["detected_at"] = detected_at
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
        res = await _run_query(self.client.table("faces").insert(row))
        if not res.data:
            # Хариу хоосон ирэх нь мөр бичигдээгүй байж болно — дараагийн
            # alert нотлох баримтгүй үлдэнэ. Чимээгүй None биш, warning.
            log.warning("faces insert хариу хоосон (%s) — face_id алга", image_path)
            return None
        return res.data[0]["id"]

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
    ) -> AlertOutcome:
        """Insert alert with rule-based filtering + dedup.

        ``screenshot_path`` is a path in the `alert-screenshots` bucket (that
        is how the backup manifest reads it) and the recording pipeline has
        nothing to put there: since Tier 2 the only image written for a
        detection is the SEALED crop `<faces.image_path>.enc` in the `faces`
        bucket. The pipeline therefore passes None and the evidence pointer is
        ``face_id``; readers resolve the picture through
        /api/faces/[id]/secure-crop. The parameter survives for anything that
        genuinely uploads an alert screenshot — pass a path only if the object
        exists in `alert-screenshots`.

        Behaviour:
        1. The most specific enabled rule for this (suspect, camera,
           similarity) is applied. With no matching rule the DEFAULT dedup
           window (``ALERT_DEDUP_WINDOW_SEC``, 300 s) still applies — «no
           rule» must not mean «no dedup», otherwise a person standing in
           front of a camera writes one alert row per sighting.
        2. Dedup is time-INDEPENDENT: the key is ``suspect:camera`` and the
           window is measured from the open alert's ``last_seen_at``. The old
           key embedded ``floor(now / window)``, so two sightings seconds
           apart raised TWO alerts whenever they straddled a bucket boundary,
           and two sightings a whole window apart could still merge.
        3. An alert the operator has CLOSED is never merged into — the closed
           incident stays closed and a NEW alert is raised, so the re-appearance
           is actually visible in the queue (a closed row silently growing
           match_count is invisible to the operator).
        4. Burst smoothing: if `burst_count > 1`, only insert when N matches
           have been recorded in `burst_window_sec` (uses a lightweight
           in-memory pending bucket).
        5. Quiet hours: skip alerting entirely while within window.

        Returns what actually happened so the caller can log the truth. Raises
        if the terminal INSERT fails — a lost alert must never look like a
        delivered one.
        """
        if not self.client:
            log.warning("Alert (%s) бичигдсэнгүй — Supabase client тохируулагдаагүй", suspect_name)
            return "no_client"

        rule = await self._select_alert_rule(suspect_id, camera_id, similarity)

        if rule and rule.get("quiet_from") and rule.get("quiet_to"):
            if _within_quiet_hours(rule["quiet_from"], rule["quiet_to"]):
                log.info(
                    "Alert suppressed (quiet hours %s–%s, rule %s): %s",
                    rule["quiet_from"], rule["quiet_to"], rule.get("name"), suspect_name,
                )
                return "quiet_hours"

        if rule and _coerce_int(rule.get("burst_count"), 1) > 1:
            if not _check_burst(
                rule["id"],
                suspect_id,
                camera_id,
                _coerce_int(rule.get("burst_count"), 1),
                _coerce_int(rule.get("burst_window_sec"), 60),
            ):
                log.info(
                    "Alert held by burst smoothing (rule %s, %s матч/%s сек шаардлагатай): %s",
                    rule.get("name"), rule.get("burst_count"), rule.get("burst_window_sec"),
                    suspect_name,
                )
                return "burst_pending"

        dedup_key = None
        dedup_window = self._dedup_window_for(rule)
        if dedup_window > 0:
            # Цаг хугацаанаас ХАМААРАЛГҮЙ түлхүүр: цонхыг last_seen_at-аас
            # хэмжинэ (bucket биш). Ингэснээр цонхны дотор орсон 2 харагдалт
            # ҮРГЭЛЖ нэгдэж, гадна орсон 2 харагдалт ҮРГЭЛЖ тусдаа alert болно.
            dedup_key = f"{suspect_id}:{camera_id or 'none'}"
            # Both helpers are synchronous PostgREST calls; run them off the
            # event loop so a merge check cannot stall capture.
            open_alert = await asyncio.to_thread(
                self._find_mergeable_alert, dedup_key, dedup_window
            )
            if open_alert and await asyncio.to_thread(
                self._merge_into_alert, open_alert, similarity
            ):
                return "merged"
            # merge оролдлого амжилтгүй (мөр яг тэр хооронд хаагдсан / DB
            # алдаа) → доорх INSERT-руу унана: харагдалтыг чимээгүй хаяхгүй.

        await _run_query(
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
            )
        )
        return "inserted"

    @staticmethod
    def _dedup_window_for(rule: dict | None) -> int:
        """Effective dedup window in seconds.

        A rule's own value wins — including an explicit 0, which means «энэ
        дүрэмд dedup хэрэггүй» and must be honoured. Only the no-rule case
        falls back to DEFAULT_DEDUP_WINDOW_SEC.
        """
        if not rule:
            return DEFAULT_DEDUP_WINDOW_SEC
        raw = rule.get("dedup_window_sec")
        if raw is None:
            return DEFAULT_DEDUP_WINDOW_SEC
        return max(0, _coerce_int(raw, DEFAULT_DEDUP_WINDOW_SEC))

    def _find_mergeable_alert(self, dedup_key: str, window_sec: int) -> dict | None:
        """Newest OPEN (new/acknowledged) alert for this key inside the window.

        Closed rows are skipped, not merged into: the operator closed that
        incident, so a fresh sighting deserves a fresh alert. A read failure
        returns None → the caller raises a new alert (over-alert rather than
        silently drop).
        """
        if not self.client:
            return None
        cutoff = _iso_minutes_ago(seconds=window_sec)
        try:
            res = (
                self.client.table("alerts")
                .select("id, match_count, similarity, state, last_seen_at")
                .eq("dedup_key", dedup_key)
                .gte("last_seen_at", cutoff)
                .order("last_seen_at", desc=True)
                .limit(_DEDUP_CANDIDATE_LIMIT)
                .execute()
            )
        except Exception as e:  # noqa: BLE001 — dedup нь alert-аас чухал биш
            log.warning("Alert dedup lookup failed (%s) — шинэ alert үүсгэнэ", type(e).__name__)
            return None

        for row in res.data or []:
            if (row.get("state") or "new") == "closed":
                log.info(
                    "Alert %s хаагдсан — merge хийхгүй, дахин харагдсаныг шинэ alert болгоно",
                    row.get("id"),
                )
                continue
            return row
        return None

    def _merge_into_alert(self, row: dict, similarity: float) -> bool:
        """Fold a repeat sighting into an open alert. False = merge did not
        happen (row closed in the meantime, or the UPDATE failed) → caller
        inserts a new alert instead."""
        if not self.client:
            return False
        try:
            res = (
                self.client.table("alerts")
                .update(
                    {
                        "match_count": _coerce_int(row.get("match_count"), 1) + 1,
                        "last_seen_at": _iso_now(),
                        "similarity": max(similarity, _coerce_float(row.get("similarity"), 0.0)),
                    }
                )
                .eq("id", row["id"])
                # CAS: хэрэв уншсанаас хойш оператор хаасан бол шинэчлэхгүй —
                # хаагдсан alert-ыг чимээгүй өсгөх боломжгүй.
                .neq("state", "closed")
                .execute()
            )
        except Exception as e:  # noqa: BLE001
            log.warning("Alert %s merge failed (%s) — шинэ alert үүсгэнэ", row.get("id"), type(e).__name__)
            return False
        if not res.data:
            log.info("Alert %s merge-д хамрагдсангүй (хаагдсан/устсан) — шинэ alert үүснэ", row.get("id"))
            return False
        return True

    async def _select_alert_rule(
        self,
        suspect_id: str,
        camera_id: str | None,
        similarity: float,
    ) -> dict | None:
        """Pick the most specific enabled rule matching this event.

        ``min_similarity`` selects WHICH rule applies; it does not gate the
        alert itself (see the audit 4.8 discussion in
        ``app/api/alerts/apply-threshold/route.ts``). A match under every
        rule's floor is still alerted, now with the DEFAULT dedup window
        instead of no dedup at all.
        """
        if not self.client:
            return None
        # Order: suspect+camera specific > suspect-only > camera-only > global
        try:
            # Off the event loop, like every other PostgREST call on the alert
            # path: this runs first in every insert_alert.
            res = await _run_query(
                self.client.table("alert_rules")
                .select(
                    "id, name, suspect_id, camera_id, min_similarity, "
                    "dedup_window_sec, burst_count, burst_window_sec, "
                    "quiet_from, quiet_to"
                )
                .eq("enabled", True)
                .lte("min_similarity", similarity)
            )
        except Exception as e:  # noqa: BLE001
            # Дүрэм уншиж чадаагүй бол quiet hours / burst / дүрмийн dedup цонх
            # бүгд ХЭРЭГЛЭГДЭХГҮЙ. Энэ нь оператор юу харахыг өөрчилдөг тул
            # чимээгүй өнгөрөх ёсгүй.
            log.warning(
                "alert_rules уншиж чадсангүй (%s) — дүрэмгүй горимд (default dedup %d сек) шилжив",
                type(e).__name__, DEFAULT_DEDUP_WINDOW_SEC,
            )
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
        # Тэнцүү тодорхойлолттой хоёр дүрэм байвал ялагчийг DB-ийн эрэмбэ
        # шийддэг байсан — өөр dedup цонх, өөр чимээгүй цаг санамсаргүй
        # хэрэглэгдэнэ гэсэн үг. Тогтмол дараалал: тодорхой байдал ↓, дараа нь
        # min_similarity ↓ (энэ тааралтад хамгийн ойр зорьсон дүрэм), эцэст нь
        # id ↑ (тогтвортой байхын тулд).
        candidates.sort(
            key=lambda x: (
                -x[0],
                -_coerce_float(x[1].get("min_similarity"), 0.0),
                str(x[1].get("id") or ""),
            )
        )
        return candidates[0][1]

    # ── Recording: ID-тай буцаах (faces-руу back-link хийхэд) ──
    async def insert_recording_returning_id(
        self,
        filename: str,
        storage_path: str,
        duration_sec: float | None,
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
        capture_status: str | None = None,
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
        if capture_status is not None:
            row["capture_status"] = capture_status
        if recording_id:
            row["id"] = recording_id
            # Idempotent: a retry after a lost response (or the capture
            # pipeline re-opening the row before a face is persisted) must
            # neither fail on the primary key nor overwrite a row a delivery
            # already completed — ON CONFLICT DO NOTHING. An empty answer
            # then means "the row already exists".
            res = await _run_query(
                self.client.table("recordings").upsert(row, on_conflict="id", ignore_duplicates=True)
            )
            return res.data[0]["id"] if res.data else recording_id
        # Off the event loop: a slow PostgREST round trip used to stall every
        # capture task, HLS writer and HTTP handler.
        res = await _run_query(self.client.table("recordings").insert(row))
        return res.data[0]["id"] if res.data else None

    async def update_recording(self, recording_id: str, fields: dict) -> None:
        """Patch a recording row (used by _finalize to fill duration/size/…)."""
        if not self.client:
            raise RuntimeError("Recording storage is not configured")
        await _run_query(self.client.table("recordings").update(fields).eq("id", recording_id))

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
        await _run_query(self.client.table("recordings").delete().eq("id", recording_id))

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

    def touch_camera_session(
        self, camera_id: str, sealed_url: str, camera_name: str | None, fps: int
    ) -> bool:
        """Refresh the columns that DESCRIBE the running session, and nothing
        else — used by supervised (crash) restarts.

        Deliberately does not touch ``auto_resume``: a restart is this
        service's own decision, not the operator's, so it must never re-arm a
        camera the operator disabled (that was audit 4.5 — the disable trigger
        cleared the flag and the next supervised restart set it back).
        ``last_error`` is left in place too, so the reason the previous loop
        died stays visible in the UI after the restart.

        No row → nothing is updated (and no row is created): the operator's
        ``/camera/start`` upsert owns row creation.
        """
        if not self.client:
            return False
        try:
            self.client.table("camera_sessions").update(
                {
                    "sealed_url": sealed_url,
                    "camera_name": camera_name,
                    "fps": int(fps),
                    "started_at": _iso_now(),
                    "updated_at": _iso_now(),
                }
            ).eq("camera_id", camera_id).execute()
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("camera_sessions touch failed for %s: %s", camera_id, type(e).__name__)
            return False

    def heartbeat_camera_session(
        self, camera_id: str, frames_total: int | None = None
    ) -> bool:
        """Stamp «frames are arriving» on the session row.

        Written by the capture loop every ``CAMERA_HEARTBEAT_SEC`` of
        successful reads. ``camera_health()`` derives the operator-facing
        status dots from this column, so it is the ONLY statement in this file
        that may claim a camera is live — a face detection says what was seen,
        not whether the camera is up (a working camera watching an empty
        corridor used to read as «offline»).

        Only ``last_heartbeat_at`` is touched: ``updated_at`` keeps meaning
        «the session description changed» and ``last_error`` keeps the reason
        the previous loop died visible until the operator acts on it.

        No row → nothing is written (an ad-hoc / test camera has no session).
        Never raises: a missed beat ages into `stale`, it does not stop
        capture. ``frames_total`` is accepted for log context only.
        """
        if not self.client:
            return False
        try:
            res = (
                self.client.table("camera_sessions")
                .update({"last_heartbeat_at": _iso_now()})
                .eq("camera_id", camera_id)
                .execute()
            )
            if not (res.data or []):
                log.debug(
                    "camera %s: heartbeat found no session row (frames=%s)",
                    camera_id, frames_total,
                )
                return False
            return True
        except Exception as e:  # noqa: BLE001
            log.warning(
                "camera_sessions heartbeat failed for %s: %s", camera_id, type(e).__name__
            )
            return False

    def camera_desired_state(self, camera_id: str) -> CameraDesiredState:
        """Read ``cameras.enabled`` + ``camera_sessions.auto_resume`` fresh.

        Returns an "unknown" state (``known=False``) when the answer cannot be
        established — no client, or either query raised. Callers treat unknown
        as "may run": the ML service must not stop capturing because Supabase
        blipped.
        """
        if not self.client:
            return CameraDesiredState()
        try:
            cam = (
                self.client.table("cameras")
                .select("id, enabled")
                .eq("id", camera_id)
                .limit(1)
                .execute()
            )
            ses = (
                self.client.table("camera_sessions")
                .select("camera_id, auto_resume")
                .eq("camera_id", camera_id)
                .limit(1)
                .execute()
            )
        except Exception as e:  # noqa: BLE001
            log.warning("camera %s: desired-state read failed: %s", camera_id, type(e).__name__)
            return CameraDesiredState()

        cam_rows = list(cam.data or [])
        ses_rows = list(ses.data or [])
        enabled_raw = cam_rows[0].get("enabled") if cam_rows else None
        resume_raw = ses_rows[0].get("auto_resume") if ses_rows else None
        return CameraDesiredState(
            known=True,
            camera_exists=bool(cam_rows),
            enabled=None if enabled_raw is None else bool(enabled_raw),
            session_exists=bool(ses_rows),
            auto_resume=None if resume_raw is None else bool(resume_raw),
        )

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

    _RESUMABLE_COLUMNS = "camera_id, sealed_url, camera_name, fps, auto_resume, last_error"

    def list_resumable_sessions(self) -> list[dict]:
        """Rows with auto_resume=true, each carrying the operator's toggle as
        an embedded ``cameras(enabled)`` object so boot can skip a camera that
        was disabled while this service was down.

        If PostgREST cannot resolve the embed (schema cache lag right after a
        migration), fall back to the plain select and say so — the caller then
        re-reads ``enabled`` per camera instead of resuming blind.
        """
        if not self.client:
            return []
        try:
            res = (
                self.client.table("camera_sessions")
                .select(f"{self._RESUMABLE_COLUMNS}, cameras(enabled)")
                .eq("auto_resume", True)
                .execute()
            )
            return list(res.data or [])
        except Exception as e:  # noqa: BLE001
            log.warning(
                "camera_sessions list with cameras(enabled) failed (%s) — retrying without the embed",
                type(e).__name__,
            )
        try:
            res = (
                self.client.table("camera_sessions")
                .select(self._RESUMABLE_COLUMNS)
                .eq("auto_resume", True)
                .execute()
            )
            return list(res.data or [])
        except Exception as e:  # noqa: BLE001
            log.warning("camera_sessions list failed: %s", type(e).__name__)
            return []

    # ── Privacy schedules (ADR 0012) ──────────────────────────
    # Every helper RAISES on failure: callers fail closed (the cache answers
    # "private", the reveal job refuses) or keep a span in memory and retry.
    # They are synchronous — callers run them via asyncio.to_thread.
    def load_privacy_schedule(self, camera_id: str) -> CameraSchedule | None:
        """``cameras.privacy_default`` + the camera's ``masking_schedules``
        windows, or None when the camera has no ``cameras`` row (→ standard).

        A value the DB constraints would not allow (e.g. a pre-migration
        ``masked`` mode) raises ValueError — never a half-applied schedule.
        """
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        camera = (
            self.client.table("cameras")
            .select("id, privacy_default, privacy_loosened_at")
            .eq("id", camera_id)
            .limit(1)
            .execute()
        )
        rows = self._privacy_rows(camera, "cameras")
        if not rows:
            return None
        windows = (
            self.client.table("masking_schedules")
            .select("window_mode, starts_at, ends_at, weekdays")
            .eq("camera_id", camera_id)
            .execute()
        )
        return schedule_from_rows(
            rows[0].get("privacy_default"),
            self._privacy_rows(windows, "masking_schedules"),
            rows[0].get("privacy_loosened_at"),
        )

    def open_privacy_span(
        self,
        recording_id: str,
        start_offset_sec: float,
        source: str,
        client_span_id: str | None = None,
    ) -> int:
        """Insert an open capture-time privacy span; returns its id.

        With ``client_span_id`` (a UUID the pipeline generates once per span)
        the write is an upsert on that key, so a retry after a lost response
        finds the row the first attempt committed instead of leaving it open
        forever beside a second one. The payload never carries
        ``end_offset_sec``, so a retry cannot clear a close.

        Fails (FK violation) while the recording row does not exist yet —
        the pipeline keeps the span in memory and retries."""
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        if source not in ("schedule", "fail_closed"):
            raise ValueError(f"invalid privacy span source {source!r}")
        row = {
            "recording_id": recording_id,
            "start_offset_sec": max(0.0, float(start_offset_sec)),
            "source": source,
        }
        table = self.client.table("recording_privacy_spans")
        if client_span_id:
            row["client_span_id"] = str(client_span_id)
            result = table.upsert(row, on_conflict="client_span_id").execute()
        else:
            result = table.insert(row).execute()
        if not result.data:
            raise RuntimeError("Database did not acknowledge privacy span")
        return int(result.data[0]["id"])

    def upsert_privacy_spans(self, recording_id: str, spans: list[dict]) -> None:
        """Deliver a segment's spans with its recording (spool / recovery).

        Each span is ``{client_span_id, start_offset_sec, end_offset_sec,
        source}``; upserted on ``client_span_id`` so rows the live pipeline
        already wrote are completed, never duplicated. An open span (end None)
        is written without ``end_offset_sec`` so it cannot clear a close.
        Raises on any failure — the spool keeps the delivery pending."""
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        for span in spans:
            source = span.get("source")
            if source not in ("schedule", "fail_closed"):
                raise ValueError(f"invalid privacy span source {source!r}")
            row = {
                "recording_id": recording_id,
                "client_span_id": str(span["client_span_id"]),
                "start_offset_sec": max(0.0, float(span["start_offset_sec"])),
                "source": source,
            }
            if span.get("end_offset_sec") is not None:
                row["end_offset_sec"] = float(span["end_offset_sec"])
            result = (
                self.client.table("recording_privacy_spans")
                .upsert(row, on_conflict="client_span_id")
                .execute()
            )
            if not result.data:
                raise RuntimeError("Database did not acknowledge privacy span")

    def ensure_recording_placeholder(self, recording_id: str, fields: dict) -> None:
        """Make sure a recordings row exists WITHOUT marking it ready, so a
        delivery can attach its privacy spans before the row becomes
        playable/revealable. An existing row (placeholder or already
        delivered) is left untouched (ON CONFLICT DO NOTHING)."""
        if not self.client:
            raise RuntimeError("Recording storage is not configured")
        row = {
            **fields,
            "id": recording_id,
            "capture_status": "capturing",
            "has_original": False,
            "original_path": None,
        }
        self.client.table("recordings").upsert(
            row, on_conflict="id", ignore_duplicates=True
        ).execute()

    def close_privacy_span(self, span_id: int, end_offset_sec: float) -> None:
        """Set ``end_offset_sec``. Idempotent (a retry after a lost response
        writes the same value). Raises ``PrivacySpanNotFound`` (a LookupError)
        when the span no longer exists (its recording was deleted) so the
        caller can drop it."""
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        result = (
            self.client.table("recording_privacy_spans")
            .update({"end_offset_sec": float(end_offset_sec)})
            .eq("id", int(span_id))
            .execute()
        )
        if not result.data:
            raise PrivacySpanNotFound(f"privacy span {span_id} not found")

    def list_privacy_spans(self, recording_id: str) -> list[dict]:
        """Spans of one recording, oldest offset first. ``end_offset_sec``
        None = never closed → readers treat it as "until the end"."""
        if not self.client:
            raise RuntimeError("Supabase client is not configured")
        result = (
            self.client.table("recording_privacy_spans")
            .select("id, recording_id, start_offset_sec, end_offset_sec, source, created_at")
            .eq("recording_id", recording_id)
            .order("start_offset_sec")
            .execute()
        )
        return self._privacy_rows(result, "recording_privacy_spans")

    @staticmethod
    def _privacy_rows(result, table: str) -> list[dict]:
        """A select's rows. A response without a row list is an error, never
        "no rows": for these tables "no rows" means standard / nothing
        protected, so a malformed answer must not be read as one."""
        data = getattr(result, "data", None)
        if not isinstance(data, list):
            raise RuntimeError(f"invalid {table} response")
        return list(data)

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

    # ── Durable processing jobs (raise on dependency errors) ──────────
    def upload_job(self, job_id: str) -> dict | None:
        if not self.client:
            raise RuntimeError("Job database unavailable")
        res = self.client.table("upload_jobs").select("*").eq("id", job_id).maybe_single().execute()
        return res.data if res else None

    def ensure_upload_job(self, row: dict) -> dict:
        if not self.client:
            raise RuntimeError("Job database unavailable")
        self.client.table("upload_jobs").upsert(row, on_conflict="id", ignore_duplicates=True).execute()
        stored = self.upload_job(row["id"])
        if not stored or stored["requested_by"] != row["requested_by"]:
            raise RuntimeError("Upload ownership mismatch")
        return stored

    def update_upload_job(self, job_id: str, statuses: tuple[str, ...], **fields) -> dict | None:
        if not self.client:
            raise RuntimeError("Job database unavailable")
        fields["updated_at"] = _iso_now()
        result = self.client.table("upload_jobs").update(fields).eq("id", job_id).in_("status", list(statuses)).execute()
        return result.data[0] if result.data else None

    def upload_recording_ready(self, recording_id: str) -> bool:
        result = self.client.table("recordings").select("id,has_original,ended_at,capture_status").eq("id", recording_id).maybe_single().execute()
        row = result.data if result else None
        return bool(row and row.get("has_original") and row.get("ended_at") and row.get("capture_status") == "ready")

    def reset_uncommitted_upload(self, recording_id: str) -> None:
        # Called only under the durable input's process lock, after checking
        # both the delivery spool and the committed recording. Retry keeps the
        # UUID, and drops provisional detections from the failed attempt.
        if self.upload_recording_ready(recording_id):
            raise RuntimeError("Recording already committed")
        self.client.table("faces").delete().eq("recording_id", recording_id).execute()
        self.client.table("recordings").delete().eq("id", recording_id).execute()

    def runnable_reveal_jobs(self) -> list[str]:
        if not self.client:
            raise RuntimeError("Job database unavailable")
        now = _iso_now()
        # Bounded retries stop a poison job. Only an expired lease can be
        # retired; a worker still renewing its lease is never interrupted.
        self.client.table("reveal_jobs").update({
            "status": "failed", "error_message": "Worker interrupted repeatedly; submit a new approved request",
            "completed_at": now, "worker_lease_token": None,
        }).eq("status", "processing").gte("worker_attempts", 5).lt("worker_lease_until", now).execute()
        result = self.client.table("reveal_jobs").select("id").or_(
            f"status.eq.queued,and(status.eq.processing,or(worker_lease_until.is.null,worker_lease_until.lt.{now}))"
        ).lt("worker_attempts", 5).order("created_at").limit(20).execute()
        return [row["id"] for row in result.data or []]

    # ── Storage upload ────────────────────────────────────────
    def upload_bytes(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        if not self.client:
            return ""
        self.client.storage.from_(bucket).upload(
            path, data, {"content-type": content_type, "upsert": "true"}
        )
        return path
