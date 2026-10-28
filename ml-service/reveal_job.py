"""
Reveal Job processor
====================

Blurred recording-аас тодорхой нэг (эсвэл олон) хүний нүүрийг **зөвхөн тэр
хүмүүс дээр** unblur хийж шинэ MP4 үүсгэнэ. Бусад хүмүүс blur-тэй хэвээр.

Урсгал:
  1. reveal_jobs row-аас target embedding(-үүд)-ыг авна
       • query_embeddings (jsonb массив)  → multi-target reveal
       • эсвэл query_embedding (singular) → single-target (хуучин хувилбар)
  2. Original (un-blurred) MP4-ыг Supabase Storage-аас татана
  3. Frame бүрийг уншиx
     a. InsightFace ArcFace-ээр бүх нүүрнүүдийг detect + embed
     b. Тус бүрийн cosine similarity-г target ХЭЛЭХ embedding-тэй харьцуулна
        - max(sim) >= threshold → ENERGI HARUUL (original face үлдээх)
        - max(sim) <  threshold → BLUR (Gaussian)
  4. Шинэ MP4 → Storage `revealed/<job_id>/<lease_token>.mp4`
  5. reveal_jobs.status='completed', output_path=...

Privacy schedules (ADR 0012): footage captured while its camera was in
`private` mode is NEVER revealed. Before anything is decrypted the job loads
the protected stretches of the video — the capture-time spans the pipeline
wrote (`recording_privacy_spans`) ∪ the camera's current schedule evaluated
for the capture period — and refuses outright when they cover the whole
recording (or the whole requested time range). While rendering, a protected
frame is never matched (no embedding) and every face on it stays masked.
Either read failing fails the job closed.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import subprocess
import tempfile
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import cv2
import numpy as np

from crypto_utils import decrypt_bytes, master_key_candidates
from face_masker import FaceMasker
from ffmpeg_bin import ffmpeg
from hierarchical_keys import unseal_at_index
from privacy_protection import (
    ProtectedTimeline,
    finite_float,
    load_protected_timeline,
    may_be_private,
    merge_offsets,
    parse_duration,
    parse_timestamp,
    span_offsets,
)
from privacy_schedule import (
    PrivacyScheduleCache,
    PrivacyScheduleUnavailable,
    get_privacy_schedule_cache,
)
from view_renderer import abort_encoder, finish_encoder, verify_rendered_video

# One reveal at a time: the frame loop is CPU-bound (InsightFace + cubist +
# x264) and shares the box with live recording. Everything blocking runs in
# a worker thread so HTTP handlers and camera loops stay responsive.
_REVEAL_SLOTS = asyncio.Semaphore(1)
# Context is copied into render threads. Every DB write is fenced by the
# attempt token; losing the lease also interrupts the frame loop promptly.
_LEASE: ContextVar[tuple[str, threading.Event] | None] = ContextVar("reveal_lease", default=None)
_HEARTBEAT_SECONDS = 20


class RevealLeaseLost(RuntimeError):
    pass

if TYPE_CHECKING:
    from face_engine import FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.reveal")


class RevealRenderError(RuntimeError):
    """Render failure whose message is safe to show the requesting admin.

    The reveal output is the forensic artifact the 4-eyes approval exists to
    control — a render that lost frames must NEVER be published as a
    completed job (audit 4.6). Carriers of this error set the job to
    `failed` with this exact text in `reveal_jobs.error_message`.
    """


class RevealDataError(RuntimeError):
    """A dependency (DB row, sealed embedding) could not be read.

    Distinct from "the data says no": an outage must not be reported to the
    admin as "no original recording" / "no target in your authority".
    """


def _parse_reveal_level(value: object) -> int | None:
    """Parse persisted reveal authority without defaulting to level 0."""
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 99:
        return None
    return value


# ── Privacy schedules (ADR 0012) ──────────────────────────────
# Refusal messages start with a stable code in brackets: the web maps it to a
# translated message (lib/reveal-errors.ts) and shows the text only as a
# fallback. The text says what happened in Mongolian and English.
PRIVACY_ZONES_UNAVAILABLE_MSG = (
    "[privacy_rules_unavailable] Privacy rules unavailable; retry after restoring the "
    "database connection"
)
PRIVACY_UNAVAILABLE_MSG = (
    "[privacy_unavailable] Нууцлалын хуваарь уншигдсангүй — өгөгдлийн сангийн холболт "
    "сэргэсний дараа дахин оролдоно уу / Privacy schedule unavailable; retry after "
    "restoring the database connection"
)
# Spans alone cover it: captured in privacy mode — never revealable.
PRIVACY_WHOLE_RECORDING_MSG = (
    "[privacy_whole_recording] Бичлэг бүхэлдээ нууцлалын горимд бичигдсэн — reveal хийх "
    "боломжгүй / captured entirely in privacy mode"
)
PRIVACY_WHOLE_RANGE_MSG = (
    "[privacy_whole_range] Сонгосон хугацаа бүхэлдээ нууцлалын горимд бичигдсэн — reveal "
    "хийх боломжгүй / the selected time range was captured entirely in privacy mode"
)
# Only the camera's CURRENT schedule covers it (a private window added after
# capture, or capture-time spans that never reached the database): withheld
# while that window exists — loosening it (TOTP step-up) releases the footage.
PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG = (
    "[privacy_schedule_whole_recording] Бичлэг бүхэлдээ камерын одоогийн нууцлалын "
    "хуваарьт хамрагдаж байна — reveal хийх боломжгүй / the whole recording is covered by "
    "the camera's current privacy schedule"
)
PRIVACY_SCHEDULE_WHOLE_RANGE_MSG = (
    "[privacy_schedule_whole_range] Сонгосон хугацаа бүхэлдээ камерын одоогийн нууцлалын "
    "хуваарьт хамрагдаж байна — reveal хийх боломжгүй / the selected time range is covered "
    "by the camera's current privacy schedule"
)

# Shared with the on-demand view / evidence renderers (privacy_protection).
# The underscore names are kept for callers and tests that import them here.
_parse_timestamp = parse_timestamp
_finite_float = finite_float
_parse_duration = parse_duration
_span_offsets = span_offsets
_merge_offsets = merge_offsets
_may_be_private = may_be_private


class RevealProcessor:
    def __init__(
        self,
        engine: "FaceEngine",
        storage: "SupabaseStorage",
        privacy_cache: PrivacyScheduleCache | None = None,
    ):
        self.engine = engine
        self.storage = storage
        # None = the process-wide cache (main.py lifespan, same storage).
        # Only its uncached `schedule_strict` read is used here.
        self.privacy_cache = privacy_cache

    async def run(self, job_id: str):
        if not self.storage.client:
            return
        async with _REVEAL_SLOTS:
            try:
                token = await asyncio.to_thread(self._claim, job_id)
            except Exception as exc:
                # No ownership means no failure write. The reconciler retries
                # persisted queued work after the database becomes available.
                log.warning("Reveal claim unavailable (%s)", type(exc).__name__)
                return
            if not token:
                return
            lost = threading.Event()
            context = _LEASE.set((token, lost))
            heartbeat = asyncio.create_task(self._heartbeat(job_id, lost))
            try:
                await self._run(job_id)
            except RevealLeaseLost:
                log.warning("Reveal %s lease lost; newer attempt owns the outcome", job_id)
            except Exception as exc:
                log.exception("Reveal job %s crashed", job_id)
                await self._fail(job_id, f"Дотоод алдаа: {type(exc).__name__}")
            finally:
                lost.set()
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
                _LEASE.reset(context)

    async def _heartbeat(self, job_id: str, lost: threading.Event):
        while not lost.is_set():
            await asyncio.sleep(_HEARTBEAT_SECONDS)
            if not await self._update(job_id):
                # A network outage cannot prove ownership. Stop rendering and
                # let the expiry/claim transaction decide the next attempt.
                lost.set()
                return

    async def _run(self, job_id: str):
        # 1. Job-ийг авах — олдоогүй тохиолдолд PostgREST 406 алдаа гаргахгүй
        # маяг try-catch + .maybe_single()-аар бэлэн.
        try:
            job_res = await asyncio.to_thread(lambda:
                self.storage.client.table("reveal_jobs")
                # started_at = capture time of the stored video's offset 0 and
                # duration_sec = its length (ADR 0012 schedule → offsets).
                .select("*, recordings(filename, storage_path, camera_id, started_at, duration_sec)")
                .eq("id", job_id)
                .maybe_single()
                .execute()
            )
        except Exception as e:
            # Reading the row failed — the job would otherwise sit in `queued`
            # forever with no signal to the requester. Try to record the
            # failure; if the DB is genuinely unreachable `_update` logs that
            # too and the startup sweep is the last line of defence.
            log.error("Job %s olj авах үед алдаа: %s", job_id, e)
            await self._fail(
                job_id,
                "Job-ийн мэдээллийг уншиж чадсангүй — дахин оролдоно уу",
                only_statuses=("queued", "processing"),
            )
            return

        job = job_res.data if job_res else None
        if not job:
            log.warning("Reveal job %s олдсонгүй — алгасъя", job_id)
            return

        # Defence-in-depth for the 4-eyes approval workflow (ADR 0003): the ML
        # side must never decrypt+unblur a job that hasn't been cleared to run.
        # The Next.js trigger only fires for queued jobs today, but if a job is
        # still awaiting a second admin (pending_approval) or was rejected,
        # refuse it here so a stray /reveal/run call can't bypass approval.
        status = job.get("status")
        lease = _LEASE.get()
        if not lease or status != "processing" or job.get("worker_lease_token") != lease[0]:
            # pending_approval / rejected: not cleared to run (4-eyes, ADR
            # 0003). processing: another run owns it. completed / failed:
            # terminal. A stray or duplicated /reveal/run call is a no-op.
            log.warning("Reveal job %s status=%s — not runnable, skipping", job_id, status)
            return

        recording = job.get("recordings")
        if not recording:
            await self._fail(job_id, "Recording холбоо тасарсан")
            return

        # Privacy zones — never_reveal=true бүсэд орсон face-уудыг reveal-аас
        # хасна (UI-ийн /privacy-zones хуудсаар админ тогтоосон). Pipeline-ийн
        # privacy-promise-ийг бодит болгох loop closure.
        camera_id_for_zones = recording.get("camera_id") if recording else None
        try:
            privacy_zones = await asyncio.to_thread(self._load_privacy_zones, camera_id_for_zones)
        except RuntimeError:
            await self._fail(job_id, PRIVACY_ZONES_UNAVAILABLE_MSG)
            return

        # Recording UUID-ыг JOB-аас шууд авна (FK column).
        # Хуучин код `recording["id"]` ашигладаг байсан боловч PostgREST
        # embedded select-д PK заавал багтахгүй (зөвхөн заагдсан column-ууд
        # буцдаг) — KeyError-аас сэргийлж top-level field ашиглана.
        rec_uuid = job.get("recording_id") or recording.get("id")
        if not rec_uuid:
            await self._fail(job_id, "recording_id олдсонгүй (job-д ч, recordings JOIN-д ч)")
            return

        # Optional time-window — frame-уудыг scope-аас гадуурх бол бүх face-ыг
        # mask-аар хадгална. Хоёулаа NULL бол хуучин whole-recording горим.
        target_start_sec = job.get("target_start_sec")
        target_end_sec = job.get("target_end_sec")
        try:
            target_start_sec = (
                float(target_start_sec) if target_start_sec is not None else None
            )
            target_end_sec = (
                float(target_end_sec) if target_end_sec is not None else None
            )
        except (TypeError, ValueError):
            target_start_sec = None
            target_end_sec = None

        # Privacy schedule (ADR 0012) — footage captured in `private` mode is
        # never revealed. Loaded next to the privacy zones and just as strict:
        # an unreadable span table or schedule fails the job closed, and a
        # recording protected end to end is refused before anything (sealed
        # target embeddings, the encrypted original) is opened.
        duration_sec = parse_duration(recording.get("duration_sec"))
        try:
            protection = await asyncio.to_thread(
                self._load_privacy_protection,
                rec_uuid,
                camera_id_for_zones,
                parse_timestamp(recording.get("started_at")),
                duration_sec,
            )
        except PrivacyScheduleUnavailable as exc:
            log.warning("Reveal %s: privacy schedule unavailable (%s)", job_id, exc)
            await self._fail(job_id, PRIVACY_UNAVAILABLE_MSG)
            return
        refusal = self._privacy_refusal(protection, duration_sec, target_start_sec, target_end_sec)
        if refusal:
            await self._fail(job_id, refusal)
            return

        # Original (un-blurred) бичлэг шаардана. Lookup алдаа ≠ "бичлэг алга":
        # DB outage-ыг "original байхгүй" гэж мэдэгдэх нь буруу оношилгоо.
        try:
            original_path = await self._lookup_original(rec_uuid)
        except RevealDataError:
            await self._fail(
                job_id, "Recording мэдээллийг уншиж чадсангүй — дахин оролдоно уу"
            )
            return
        if not original_path:
            await self._fail(job_id, "Original бичлэг алга — reveal боломжгүй")
            return

        # 1а. Target embedding-уудыг бүрдүүлнэ.
        # Hierarchical reveal (ADR 0009): хэрэв requester-ийн reveal_level > 0
        # бол зөвхөн chain_index >= level нүүрсийг hash-chain key-ээр unseal
        # хийж target болгоно — доод түвшний (өндөр эрхтэй) нүүрсийг
        # cryptographically нээж чадахгүй. level 0 (director) → хуучин зам,
        # бүгдийг хардаг.
        reveal_level = _parse_reveal_level(job.get("reveal_level"))
        if reveal_level is None:
            await self._fail(job_id, "Reveal authority буруу эсвэл дутуу байна")
            return

        try:
            if reveal_level > 0:
                target_embeddings = await asyncio.to_thread(self._collect_targets_sealed, job, rec_uuid, reveal_level)
                if not target_embeddings:
                    await self._fail(
                        job_id,
                        f"Reveal level {reveal_level}: эрхийн хүрээнд target нүүр алга "
                        f"(сонгосон нүүрс таны түвшнээс дээгүүр эсвэл sealed биш)",
                    )
                    return
            else:
                target_embeddings = await asyncio.to_thread(self._collect_targets, job)
        except RevealDataError:
            # DB алдааг "эрхгүй" / "target алга" гэж харуулбал админ буруу
            # дүгнэлт хийнэ — шалтгааныг нь шууд хэлнэ.
            await self._fail(
                job_id, "Target embedding-ийг уншиж чадсангүй — дахин оролдоно уу"
            )
            return
        if not target_embeddings:
            await self._fail(job_id, "Target embedding байхгүй")
            return

        threshold = float(job.get("threshold", 0.45))

        log.info(
            "Reveal job %s — %d target(s), threshold=%.2f",
            job_id, len(target_embeddings), threshold,
        )

        # 2. Original MP4-ыг татаж local-руу
        with tempfile.TemporaryDirectory() as tmp:
            input_mp4 = os.path.join(tmp, "input.mp4")
            output_mp4 = os.path.join(tmp, "output.mp4")

            try:
                def _fetch_and_decrypt() -> None:
                    blob = self.storage.client.storage.from_("recordings").download(original_path)
                    # `.enc` суффикстэй файлууд AES-256-GCM-аар encrypted.
                    # Хуучин plaintext .mp4 файлуудтай backward-compatible байна.
                    if isinstance(original_path, str) and original_path.endswith(".enc"):
                        blob = decrypt_bytes(blob, recording_id=rec_uuid)
                    with open(input_mp4, "wb") as f:
                        f.write(blob)

                await asyncio.to_thread(_fetch_and_decrypt)
            except Exception as e:
                log.warning("Reveal %s: fetch/decrypt failed: %s", job_id, e)
                await self._fail(job_id, "Original бичлэгийг татах / decrypt хийж чадсангүй")
                return

            # 3. Frame бүрийг боловсруулах (+ watermark)
            requester_email = job.get("requested_email") or "unknown"
            try:
                requested_at_iso = job.get("reauth_at") or job.get("created_at")
                watermark_at = (
                    datetime.fromisoformat(requested_at_iso.replace("Z", "+00:00"))
                    .strftime("%Y-%m-%d %H:%M UTC")
                    if requested_at_iso else None
                )
            except Exception:
                watermark_at = None

            try:
                duration = await asyncio.to_thread(
                    self._process_video,
                    input_mp4=input_mp4,
                    output_mp4=output_mp4,
                    target_embeddings=target_embeddings,
                    threshold=threshold,
                    job_id=job_id,
                    watermark_email=requester_email,
                    watermark_at=watermark_at,
                    target_start_sec=target_start_sec,
                    target_end_sec=target_end_sec,
                    privacy_zones=privacy_zones,
                    protection=protection,
                )
            except RevealLeaseLost:
                raise
            except RevealRenderError as e:
                # Encoder died / output truncated. NOTHING is uploaded and the
                # job is failed with a reason the reveal modal can render.
                log.warning("Reveal %s: render failed: %s", job_id, e)
                await self._fail(job_id, str(e))
                return
            except Exception as e:
                log.exception("Reveal %s: unexpected processing error", job_id)
                await self._fail(job_id, f"Боловсруулах алдаа: {type(e).__name__}")
                return

            # 4. Result-г Storage-руу upload. `_process_video` аль хэдийн
            # файлыг нээж, frame тоог шалгасан — өөрөөр хэлбэл энд зөвхөн
            # бүрэн бүтэн artifact ирнэ.
            lease = _LEASE.get()
            if not lease or lease[1].is_set() or not await self._update(job_id):
                raise RevealLeaseLost("Ownership expired before upload")
            output_path = f"{job_id}/{lease[0]}.mp4"
            try:
                def _upload() -> None:
                    with open(output_mp4, "rb") as f:
                        payload = f.read()
                    if not payload:
                        raise RuntimeError("rendered output is empty")
                    stored = self.storage.upload_bytes(
                        "revealed", output_path, payload, "video/mp4"
                    )
                    # upload_bytes returns "" when there is no storage client:
                    # a silent no-op must not read as a successful upload.
                    if not stored:
                        raise RuntimeError("storage rejected the reveal artifact")

                await asyncio.to_thread(_upload)
            except Exception as e:
                log.warning("Reveal %s: upload failed: %s", job_id, e)
                await self._fail(job_id, "Upload алдаа")
                return

            # 5. Done
            completed = await self._update(
                job_id,
                status="completed",
                progress=100,
                output_path=output_path,
                output_duration_sec=duration,
                completed_at=self._now(),
            )
            if not completed:
                # Remove only this attempt's unreferenced artifact. On an
                # ambiguous DB/network error retain it: the commit might have
                # succeeded, and deleting then would break an authorized URL.
                try:
                    current = await asyncio.to_thread(lambda: self.storage.client.table("reveal_jobs")
                        .select("status,output_path").eq("id", job_id).maybe_single().execute())
                    row = current.data if current else None
                    if row and row.get("output_path") != output_path:
                        await asyncio.to_thread(lambda: self.storage.client.storage.from_("revealed").remove([output_path]))
                except Exception:
                    log.warning("Reveal %s attempt cleanup deferred", job_id)
                return
            log.info("✓ Reveal job %s completed → revealed/%s (%ds)", job_id, output_path, duration)

    # ─────────────────────────────────────────────
    # Target embedding-уудыг цуглуулах
    # ─────────────────────────────────────────────
    def _collect_targets(self, job: dict) -> list[np.ndarray]:
        """job-аас target embedding-уудыг numpy массив болгож буцаана.

        Тэргүүн ээлжинд `query_embeddings` (jsonb массив)-ыг шалгана.
        Хоосон бол хуучин `query_embedding` (singular)-руу унана.
        Хоёулаа байхгүй бол `face_ids`-аар DB-ээс татна (failsafe).
        """
        targets: list[np.ndarray] = []

        multi = job.get("query_embeddings")
        if isinstance(multi, list) and len(multi) > 0:
            for e in multi:
                arr = self._to_np(e)
                if arr is not None:
                    targets.append(arr)
            if targets:
                return targets

        single = job.get("query_embedding")
        arr = self._to_np(single)
        if arr is not None:
            targets.append(arr)
            return targets

        # Failsafe: face_ids-аас DB-ээс эргэн авах
        face_ids = job.get("face_ids") or ([job.get("face_id")] if job.get("face_id") else [])
        face_ids = [fid for fid in face_ids if fid]
        if face_ids and self.storage.client:
            try:
                res = (
                    self.storage.client.table("faces")
                    .select("embedding")
                    .in_("id", face_ids)
                    .execute()
                )
                for r in res.data or []:
                    arr = self._to_np(r.get("embedding"))
                    if arr is not None:
                        targets.append(arr)
            except Exception as e:
                # An unreachable DB is not "no targets selected" — surface it
                # so the job fails with the honest reason.
                log.warning("face_ids-аас embedding авч чадсангүй: %s", e)
                raise RevealDataError("face embedding lookup failed") from e

        return targets

    def _collect_targets_sealed(
        self, job: dict, recording_id: str, reveal_level: int
    ) -> list[np.ndarray]:
        """Hierarchical target collection (ADR 0009).

        Requester holds K_level. For each requested face we fetch its
        `chain_index` + `embedding_sealed`. Faces with chain_index < level
        are off-limits — the forward hash chain cannot derive their key.
        Faces with chain_index >= level are unsealed by walking the chain
        forward from K_level, and only those embeddings become reveal
        targets. This makes the authority gate *cryptographic*, not a mere
        DB filter: a level-3 key literally cannot produce the plaintext
        embedding of a level-0/1/2 face.
        """
        face_ids = job.get("face_ids") or (
            [job.get("face_id")] if job.get("face_id") else []
        )
        face_ids = [fid for fid in face_ids if fid]
        if not face_ids or not self.storage.client:
            return []

        try:
            res = (
                self.storage.client.table("faces")
                .select("id, chain_index, embedding_sealed")
                .in_("id", face_ids)
                .execute()
            )
        except Exception as e:
            # Same rule as `_collect_targets`: a DB failure must not be
            # rendered to the admin as "your reveal level has no targets".
            log.warning("Sealed faces татахад алдаа: %s", e)
            raise RevealDataError("sealed face lookup failed") from e

        rows = res.data or []
        masters = master_key_candidates()

        targets: list[np.ndarray] = []
        blocked = 0
        for r in rows:
            ci = r.get("chain_index")
            sealed = r.get("embedding_sealed")
            if ci is None or sealed is None:
                blocked += 1  # legacy face (chain data байхгүй) → эрхгүй
                continue
            if ci < reveal_level:
                blocked += 1  # доод index = өндөр эрх → хүрэхгүй
                continue
            try:
                # K_level → forward walk to K_ci (never backwards); the
                # previous master is tried too after a key rotation.
                emb_bytes = unseal_at_index(
                    base64.b64decode(sealed), recording_id, int(ci), reveal_level, masters
                )
                arr = np.frombuffer(emb_bytes, dtype=np.float32)
                if arr.size > 0:
                    targets.append(arr)
            except Exception as e:
                log.warning("Face %s unseal алдаа (level %d): %s", r.get("id"), reveal_level, e)
                blocked += 1

        if blocked:
            log.info(
                "Reveal level %d: %d/%d face(s) эрхээс гадуур (blocked)",
                reveal_level, blocked, len(rows),
            )
        log.info("Reveal level %d: %d target unsealed", reveal_level, len(targets))
        return targets

    @staticmethod
    def _to_np(emb) -> np.ndarray | None:
        if emb is None:
            return None
        try:
            # Supabase pgvector-ийг list, эсвэл str-аар буцааж болно
            if isinstance(emb, str):
                # "[0.1,0.2,...]" хэлбэрээр ирвэл
                cleaned = emb.strip().lstrip("[").rstrip("]")
                if not cleaned:
                    return None
                arr = np.fromstring(cleaned, sep=",", dtype=np.float32)
            else:
                arr = np.asarray(emb, dtype=np.float32)
            if arr.size == 0:
                return None
            return arr
        except Exception as e:
            log.warning("embedding parse алдаа: %s", e)
            return None

    # ─────────────────────────────────────────────
    # Frame-by-frame processing
    # ─────────────────────────────────────────────
    def _process_video(
        self,
        input_mp4: str,
        output_mp4: str,
        target_embeddings: list[np.ndarray],
        threshold: float,
        job_id: str,
        watermark_email: str | None = None,
        watermark_at: str | None = None,
        target_start_sec: float | None = None,
        target_end_sec: float | None = None,
        privacy_zones: list[dict] | None = None,
        protection: ProtectedTimeline | None = None,
    ) -> int:
        """Process video frame-by-frame, selectively un-masking target faces.

        If `target_start_sec`/`target_end_sec` are both set, frames whose
        timestamp falls OUTSIDE that range are emitted with every face masked
        (no reveal) regardless of similarity. Inside the range the existing
        selective-blur logic runs. Default (both None) keeps the legacy
        whole-recording behaviour.

        `protection` (ADR 0012): a frame whose timestamp lies in a protected
        stretch is never matched — no embedding is computed for it, not even
        by the masker — and is emitted with every face masked. A render in
        which every in-scope frame was protected reveals nothing and is
        refused like a failed render.

        Failure contract (audit 4.6): every path that loses frames raises
        `RevealRenderError` and deletes the partial file. A reveal output is
        evidence — a truncated one that reads as `completed` would let an
        investigation act on footage with frames silently missing.
        """
        try:
            return self._render(
                input_mp4=input_mp4,
                output_mp4=output_mp4,
                target_embeddings=target_embeddings,
                threshold=threshold,
                job_id=job_id,
                watermark_email=watermark_email,
                watermark_at=watermark_at,
                target_start_sec=target_start_sec,
                target_end_sec=target_end_sec,
                privacy_zones=privacy_zones,
                protection=protection,
            )
        except BaseException:
            # No half-written MP4 survives a failed render: a retry that reuses
            # this path must never find (and upload) the previous truncation.
            self._discard_partial(output_mp4)
            raise

    @staticmethod
    def _discard_partial(path: str) -> None:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        except OSError as e:  # noqa: BLE001 — cleanup must not mask the render error
            log.warning("Дутуу reveal файлыг устгаж чадсангүй (%s): %s", path, e)

    def _render(
        self,
        input_mp4: str,
        output_mp4: str,
        target_embeddings: list[np.ndarray],
        threshold: float,
        job_id: str,
        watermark_email: str | None = None,
        watermark_at: str | None = None,
        target_start_sec: float | None = None,
        target_end_sec: float | None = None,
        privacy_zones: list[dict] | None = None,
        protection: ProtectedTimeline | None = None,
    ) -> int:
        cap = cv2.VideoCapture(input_mp4)
        if not cap.isOpened():
            raise RevealRenderError("Эх бичлэг нээгдсэнгүй (MP4 гэмтсэн байж болзошгүй)")

        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 15
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        if w <= 0 or h <= 0:
            cap.release()
            raise RevealRenderError(f"Эх бичлэгийн хэмжээ буруу ({w}x{h})")
        time_bounded = target_start_sec is not None and target_end_sec is not None
        if time_bounded:
            log.info(
                "Reveal job %s — time-bounded scope [%.2fs, %.2fs]",
                job_id, target_start_sec, target_end_sec,
            )

        # FFmpeg encoder pipe (BGR raw → MP4 H.264)
        encoder = subprocess.Popen(  # noqa: S603 — fixed argv, no shell
            [
                ffmpeg(), "-y",
                "-f", "rawvideo", "-vcodec", "rawvideo",
                "-pix_fmt", "bgr24",
                "-s", f"{w}x{h}",
                "-r", f"{fps:.2f}",
                "-i", "-",
                "-c:v", "libx264", "-preset", "veryfast",
                "-pix_fmt", "yuv420p",
                "-movflags", "frag_keyframe+empty_moov",
                output_mp4,
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # Fresh persistence cache per job (the masker is stateful per stream).
        if hasattr(self, "_masker"):
            del self._masker

        # 10 frame тутамд detect (хурдасгана — Railway CPU дээр)
        frame_idx = 0
        detect_every = 10
        last_match_boxes: list[tuple[int, int, int, int]] = []
        progress_step = max(1, total_frames // 20)  # 20 удаа progress update
        last_progress_update = 0
        # ADR 0012 bookkeeping: in-scope frames, and those withheld because
        # they were captured in privacy mode.
        scope_frames = 0
        withheld_frames = 0
        withheld_by_span = 0
        redetect = False

        try:
            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break

                # Frame-ийн timestamp (секундээр) — time-bounded reveal-д ашиглана.
                # CAP_PROP_POS_MSEC нь decoder-аас яаралтай зүйлийн жинхэнэ
                # presentation-timestamp буцаадаг тул variable-FPS видео болон
                # 29.97fps-ийн rounding error-аас зайлсхийнэ. Хэрэв 0 / not
                # available бол frame_idx / fps fallback.
                pos_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
                if pos_ms and pos_ms > 0:
                    frame_time_sec = pos_ms / 1000.0
                else:
                    frame_time_sec = frame_idx / fps if fps > 0 else 0.0
                in_scope = (
                    not time_bounded
                    or (
                        frame_time_sec >= (target_start_sec or 0.0)
                        and frame_time_sec <= (target_end_sec or float("inf"))
                    )
                )

                # Captured in privacy mode (ADR 0012): never matched, never
                # revealed. Checked on EVERY frame — boxes matched on an
                # earlier standard frame are not carried into it either.
                protected = protection is not None and protection.covers(frame_time_sec)
                if in_scope:
                    scope_frames += 1
                if protected:
                    if in_scope:
                        withheld_frames += 1
                        if protection.covered_by_spans(frame_time_sec):
                            withheld_by_span += 1
                    last_match_boxes = []
                    # Match again on the first frame after the stretch.
                    redetect = True
                elif frame_idx % detect_every == 0 or redetect:
                    redetect = False
                    if in_scope:
                        # Re-compute матч хэсгүүд — олон target-аас аль нэг нь тохирвол keep
                        last_match_boxes = self._find_target_boxes(
                            frame, target_embeddings, threshold
                        )
                        # Privacy zones filter — bbox center нь зон руу орсон
                        # match-ыг reveal-аас хасна. ADR-0003 + privacy_zones
                        # never_reveal=true row-уудаар.
                        if privacy_zones and last_match_boxes:
                            last_match_boxes = self._filter_by_privacy_zones(
                                last_match_boxes, privacy_zones, w, h
                            )
                    else:
                        # Scope-аас гадуур: бүх face-ыг блюртэй үлдээх → match-гүй
                        last_match_boxes = []

                # Бүх нүүрийг blur, сонгосон бүс л original үлдэх (Haar only — fast)
                # Scope-аас гадуур / privacy mode үед keep хоосон тул бүгд masked.
                output = self._selective_blur(
                    frame,
                    last_match_boxes if in_scope and not protected else [],
                    identify=not protected,
                )

                # Watermark — accountability layer (admin email + timestamp)
                if watermark_email:
                    output = self._draw_watermark(output, watermark_email, watermark_at)

                # A dead encoder (OOM kill on the shared box, disk full, x264
                # error) shows up here as a broken pipe. Breaking out would
                # publish the frames written so far as a finished reveal —
                # exactly the failure this contract exists to prevent.
                try:
                    if encoder.stdin is None:
                        raise RevealRenderError("Encoder pipe нээгдсэнгүй")
                    encoder.stdin.write(output.tobytes())
                except (BrokenPipeError, OSError) as exc:
                    raise RevealRenderError(
                        f"Encoder {frame_idx}-р frame дээр тасарсан — "
                        f"reveal дутуу тул хадгалаагүй"
                    ) from exc

                frame_idx += 1
                lease = _LEASE.get()
                if lease and lease[1].is_set():
                    raise RevealLeaseLost("Worker lease expired")
                # Progress update (DB). Cosmetic — a failed write must not
                # abort the render, but stays visible in the log.
                if total_frames and frame_idx - last_progress_update >= progress_step:
                    pct = min(95, int(5 + 90 * frame_idx / total_frames))
                    try:
                        if lease and not self._update_owned(job_id, {"progress": pct}):
                            lease[1].set()
                            raise RevealLeaseLost("Worker lease expired")
                    except RevealLeaseLost:
                        raise
                    except Exception as e:  # noqa: BLE001
                        # Heartbeat provides the authoritative bound when a
                        # cosmetic progress request experiences a transient error.
                        log.debug("Reveal %s: progress update skipped: %s", job_id, e)
                    last_progress_update = frame_idx

            if frame_idx == 0:
                raise RevealRenderError("Эх бичлэгээс нэг ч frame уншигдсангүй")
            if withheld_frames:
                log.info(
                    "Reveal job %s — %d frame(s) ≈ %.1fs withheld: captured in privacy mode (ADR 0012)",
                    job_id, withheld_frames, withheld_frames / fps if fps else 0.0,
                )
            if scope_frames and withheld_frames == scope_frames:
                # Nothing could be revealed (e.g. a row without duration_sec
                # skipped the pre-decrypt check): a fully masked "reveal" must
                # not read as a completed job.
                if withheld_by_span == withheld_frames:
                    raise RevealRenderError(
                        PRIVACY_WHOLE_RANGE_MSG if time_bounded else PRIVACY_WHOLE_RECORDING_MSG
                    )
                raise RevealRenderError(
                    PRIVACY_SCHEDULE_WHOLE_RANGE_MSG if time_bounded else PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG
                )
        except BaseException:
            # Reap ffmpeg WITHOUT masking the failure that got us here.
            abort_encoder(encoder)
            raise
        finally:
            cap.release()

        # The frame loop finishing is not proof the encoder wrote a whole
        # file: reap it, demand exit 0, then re-open the artifact and check
        # its frame count before anybody uploads it.
        try:
            finish_encoder(encoder, label="reveal", wait_timeout=30.0)
            verify_rendered_video(output_mp4, frame_idx, label="reveal")
        except RuntimeError as exc:
            raise RevealRenderError(f"Reveal бичлэг бүрэн үүсээгүй: {exc}") from exc

        log.info("Reveal job %s — %d frame бүрэн encode хийгдлээ", job_id, frame_idx)
        return int(frame_idx / fps) if fps else 0

    def _load_privacy_zones(self, camera_id: str | None) -> list[dict]:
        """Активт `never_reveal=true` зонуудыг камер бүрд татна. Reveal
        pipeline-д face filter-дэх үндэс."""
        # Uploaded footage without a camera has no camera-specific rules.
        if not camera_id:
            return []
        if not self.storage.client:
            raise RuntimeError("privacy rules unavailable")
        try:
            res = (
                self.storage.client.table("privacy_zones")
                .select("x, y, w, h, name, never_reveal")
                .eq("camera_id", camera_id)
                .eq("enabled", True)
                .eq("never_reveal", True)
                .execute()
            )
            if res is None or not isinstance(res.data, list):
                raise RuntimeError("invalid privacy rules response")
            zones = res.data
            if zones:
                log.info(
                    "Camera %s: %d privacy zone(s) active for reveal",
                    camera_id, len(zones),
                )
            return zones
        except Exception as e:
            log.warning("Privacy zone load failed for %s: %s", camera_id, e)
            raise RuntimeError("privacy rules unavailable") from e

    def _privacy_schedule_cache(self) -> PrivacyScheduleCache:
        if self.privacy_cache is not None:
            return self.privacy_cache
        return get_privacy_schedule_cache()

    def _load_privacy_protection(
        self,
        recording_id: str,
        camera_id: str | None,
        started_at: datetime | None,
        duration_sec: float | None,
    ) -> ProtectedTimeline:
        """Protected stretches of one recording (ADR 0012) — the capture-time
        spans ∪ the camera's current schedule (read fresh, widened by
        PRIVACY_SCHEDULE_PAD_SEC); see ``privacy_protection``. Raises
        ``PrivacyScheduleUnavailable`` when either cannot be read: the caller
        fails the job closed."""
        return load_protected_timeline(
            self.storage, self._privacy_schedule_cache(),
            recording_id, camera_id, started_at, duration_sec,
        )

    @staticmethod
    def _privacy_refusal(
        protection: ProtectedTimeline,
        duration_sec: float | None,
        target_start_sec: float | None,
        target_end_sec: float | None,
    ) -> str | None:
        """Refusal message when nothing the job asks for may be revealed —
        decided from the DB alone, before any decryption. The capture-time
        spans alone covering it → "captured in privacy mode" (final); only
        the current schedule covering it → "covered by the current schedule"
        (released again if that window is loosened). Without a known duration
        nothing is refused here; the render then withholds every protected
        frame and refuses an output that reveals nothing."""
        if not duration_sec:
            return None
        if protection.spans_cover_range(0.0, duration_sec):
            return PRIVACY_WHOLE_RECORDING_MSG
        if protection.covers_range(0.0, duration_sec):
            return PRIVACY_SCHEDULE_WHOLE_RECORDING_MSG
        if target_start_sec is not None and target_end_sec is not None:
            start = max(0.0, target_start_sec)
            # The render keeps frames with t <= target_end_sec in scope.
            if target_end_sec < duration_sec:
                end, inclusive = target_end_sec, True
            else:
                end, inclusive = duration_sec, False
            if protection.spans_cover_range(start, end, end_inclusive=inclusive):
                return PRIVACY_WHOLE_RANGE_MSG
            if protection.covers_range(start, end, end_inclusive=inclusive):
                return PRIVACY_SCHEDULE_WHOLE_RANGE_MSG
        return None

    @staticmethod
    def _box_center_in_zone(
        bbox: tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
        zone: dict,
    ) -> bool:
        """`bbox` (pixel coords) → normalized center → check inside `zone`
        (normalized [0,1] coords)."""
        if frame_w <= 0 or frame_h <= 0:
            return False
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2 / frame_w
        cy = (y1 + y2) / 2 / frame_h
        zx = float(zone.get("x", 0))
        zy = float(zone.get("y", 0))
        zw = float(zone.get("w", 0))
        zh = float(zone.get("h", 0))
        return zx <= cx <= (zx + zw) and zy <= cy <= (zy + zh)

    def _filter_by_privacy_zones(
        self,
        boxes: list[tuple[int, int, int, int]],
        zones: list[dict],
        frame_w: int,
        frame_h: int,
    ) -> list[tuple[int, int, int, int]]:
        """Зоны дотор bbox center-тэй match-ыг хасна — reveal-д үлдээхгүй."""
        kept: list[tuple[int, int, int, int]] = []
        for box in boxes:
            blocked = any(
                self._box_center_in_zone(box, frame_w, frame_h, z) for z in zones
            )
            if not blocked:
                kept.append(box)
        return kept

    def _find_target_boxes(
        self,
        frame: np.ndarray,
        targets: list[np.ndarray],
        threshold: float,
    ) -> list[tuple[int, int, int, int]]:
        """Frame-ээс target-уудтай тааралцах bbox-уудыг буцаана.

        Олон target-той үед: face нь target-уудаас аль нэгтэй нь >= threshold
        cosine similarity-тэй бол keep гэж тоомсорлоно.

        Optimization: 1080p frame-г 640px болгож resize хийгээд detect (4x faster
        on CPU). Coordinate-уудыг буцааж scale хийнэ.
        """
        h, w = frame.shape[:2]
        max_side = 640
        scale = 1.0
        if max(h, w) > max_side:
            scale = max_side / max(h, w)
            small = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            small = frame

        ok, encoded = cv2.imencode(".jpg", small)
        if not ok:
            return []
        faces = self.engine.detect_all(encoded.tobytes())
        matches: list[tuple[int, int, int, int]] = []
        inv_scale = 1.0 / scale
        for f in faces:
            best_sim = 0.0
            for t in targets:
                sim = self.engine.cosine(f.embedding, t)
                if sim > best_sim:
                    best_sim = sim
                if best_sim >= threshold:
                    break  # эртхэн зогсох
            if best_sim >= threshold:
                x1 = int(f.bbox[0] * inv_scale)
                y1 = int(f.bbox[1] * inv_scale)
                x2 = int(f.bbox[2] * inv_scale)
                y2 = int(f.bbox[3] * inv_scale)
                matches.append((x1, y1, x2, y2))
        return matches

    def _selective_blur(
        self,
        frame: np.ndarray,
        keep_boxes: list[tuple[int, int, int, int]],
        *,
        identify: bool = True,
    ) -> np.ndarray:
        """Mask every detected face except the reveal targets (keep_boxes).

        Uses the shared FaceMasker (Haar every frame + InsightFace every Nth
        + persistence cache), so a non-target person is protected at least as
        well as in the baked/on-demand views — previously a frontal-only Haar
        pass here rendered profile/tilted bystanders in clear.

        ``identify=False`` (a frame captured in privacy mode, ADR 0012): the
        masker places its boxes with the detector alone, so not even the
        masking pass computes an embedding for that frame. The mask itself is
        the one a frame without any match gets.
        """
        if not hasattr(self, "_masker"):
            self._masker = FaceMasker(
                self.engine,
                haar_scale=1.05,
                haar_neighbors=3,
                haar_min_size=(20, 20),
                pad_ratio=0.35,
            )
        self._masker.embeddings_allowed = identify
        return self._masker.mask(frame, keep_boxes)

    @staticmethod
    def _draw_watermark(
        frame: np.ndarray, email: str, requested_at: str | None = None
    ) -> np.ndarray:
        """Burn-in watermark: admin email + timestamp + 'MONGOLZ REVEAL'.

        Forensic accountability — leak хийгдсэн ч хэн, хэзээ reveal хийсэн
        нь видеонд тогтвортой үлдэнэ. Removed boluulmaar bol re-encode хэрэгтэй.
        """
        h, w = frame.shape[:2]
        out = frame.copy()

        # Дээд талд хагас тунгалаг хар бар (текст харагдахын тулд)
        bar_h = max(28, h // 24)
        overlay = out.copy()
        cv2.rectangle(overlay, (0, 0), (w, bar_h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, out, 0.4, 0, out)

        # Текст
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = max(0.4, h / 1080.0 * 0.7)
        thickness = max(1, int(h / 720))
        ts = requested_at or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        # Дээд зүүн: MONGOLZ REVEAL · email
        cv2.putText(
            out,
            f"MONGOLZ REVEAL  |  {email}",
            (12, int(bar_h * 0.7)),
            font,
            scale,
            (0, 212, 255),  # accent cyan
            thickness,
            cv2.LINE_AA,
        )
        # Дээд баруун: timestamp
        (tw, _th), _ = cv2.getTextSize(ts, font, scale, thickness)
        cv2.putText(
            out,
            ts,
            (w - tw - 12, int(bar_h * 0.7)),
            font,
            scale,
            (255, 255, 255),
            thickness,
            cv2.LINE_AA,
        )

        # Доор баруун: жижиг "AUTHORIZED VIEW" гэрчилгээ (ил байгааг харуулна)
        small_scale = scale * 0.7
        small_text = "AUTHORIZED VIEW - DO NOT DISTRIBUTE"
        (stw, sth), _ = cv2.getTextSize(small_text, font, small_scale, thickness)
        cv2.putText(
            out,
            small_text,
            (w - stw - 12, h - 12),
            font,
            small_scale,
            (255, 80, 80),
            thickness,
            cv2.LINE_AA,
        )
        return out

    @staticmethod
    def _iou(a: tuple, b: tuple) -> float:
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
        inter = iw * ih
        union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
        return inter / union if union > 0 else 0

    # ─────────────────────────────────────────────
    # Storage helpers
    # ─────────────────────────────────────────────
    async def _lookup_original(self, recording_id: str) -> str | None:
        """recordings.original_path → Storage path.

        None means "this recording genuinely has no original". A lookup that
        FAILS raises `RevealDataError` instead — the two must not collapse
        into the same answer, or an outage is reported to the admin as
        "original бичлэг алга" and they stop retrying.
        """
        try:
            res = await asyncio.to_thread(
                lambda: self.storage.client.table("recordings")
                .select("original_path, has_original")
                .eq("id", recording_id)
                .maybe_single()
                .execute()
            )
        except Exception as e:  # noqa: BLE001
            log.warning("recording lookup failed for %s: %s", recording_id[:8], e)
            raise RevealDataError("recording lookup failed") from e
        data = res.data if res else None
        if data and data.get("has_original"):
            return data.get("original_path")
        return None

    def _claim(self, job_id: str) -> str | None:
        response = self.storage.client.rpc("claim_reveal_job", {"p_job_id": job_id}).execute()
        return response.data or None

    def _update_owned(self, job_id: str, fields: dict) -> bool:
        lease = _LEASE.get()
        if not lease or lease[1].is_set():
            return False
        result = self.storage.client.rpc("update_reveal_job_lease", {
            "p_job_id": job_id, "p_token": lease[0], "p_fields": fields,
        }).execute()
        return result.data is True

    async def _update(self, job_id: str, **fields) -> bool:
        try:
            return await asyncio.to_thread(self._update_owned, job_id, fields)
        except Exception as exc:
            log.warning("Reveal %s update unavailable (%s)", job_id, type(exc).__name__)
            return False

    async def _fail(self, job_id: str, msg: str, only_statuses=None) -> bool:
        # Kept signature-compatible for callers; token ownership is stronger
        # than a status filter and is required for every failure write.
        log.error("Job %s failed: %s", job_id, msg)
        return await self._update(job_id, status="failed", error_message=msg)

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
