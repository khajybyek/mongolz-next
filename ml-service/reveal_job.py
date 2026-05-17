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
  4. Шинэ MP4 → Storage `revealed/<job_id>.mp4`
  5. reveal_jobs.status='completed', output_path=...
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import cv2
import numpy as np

from crypto_utils import decrypt_bytes
# Recording pipeline-тэй ижил cubist algorithm import — нэг эх сурвалжаас
from recording_pipeline import _cubist_anonymize, _mosaic_anonymize

if TYPE_CHECKING:
    from face_engine import FaceEngine
    from storage import SupabaseStorage

log = logging.getLogger("mongolz-ml.reveal")


class RevealProcessor:
    def __init__(self, engine: "FaceEngine", storage: "SupabaseStorage"):
        self.engine = engine
        self.storage = storage

    async def run(self, job_id: str):
        """Reveal job-ыг ажиллуулна. Алдаа гарвал DB-д бичигдэнэ."""
        if not self.storage.client:
            log.error("Storage хэрэгсэлгүй — reveal алгасъя")
            return

        # 1. Job-ийг авах — олдоогүй тохиолдолд PostgREST 406 алдаа гаргахгүй
        # маяг try-catch + .maybe_single()-аар бэлэн.
        try:
            job_res = (
                self.storage.client.table("reveal_jobs")
                .select("*, recordings(filename, storage_path, camera_id)")
                .eq("id", job_id)
                .maybe_single()
                .execute()
            )
        except Exception as e:
            log.error("Job %s olj авах үед алдаа: %s", job_id, e)
            return

        job = job_res.data if job_res else None
        if not job:
            log.warning("Reveal job %s олдсонгүй — алгасъя", job_id)
            return

        recording = job.get("recordings")
        if not recording:
            await self._fail(job_id, "Recording холбоо тасарсан")
            return

        # Recording UUID-ыг JOB-аас шууд авна (FK column).
        # Хуучин код `recording["id"]` ашигладаг байсан боловч PostgREST
        # embedded select-д PK заавал багтахгүй (зөвхөн заагдсан column-ууд
        # буцдаг) — KeyError-аас сэргийлж top-level field ашиглана.
        rec_uuid = job.get("recording_id") or recording.get("id")
        if not rec_uuid:
            await self._fail(job_id, "recording_id олдсонгүй (job-д ч, recordings JOIN-д ч)")
            return

        # Original (un-blurred) бичлэг шаардана
        original_path = await self._lookup_original(rec_uuid)
        if not original_path:
            await self._fail(job_id, "Original бичлэг алга — reveal боломжгүй")
            return

        # 1а. Target embedding-уудыг бүрдүүлнэ — олон бол multi, нэг бол single
        target_embeddings = self._collect_targets(job)
        if not target_embeddings:
            await self._fail(job_id, "Target embedding байхгүй")
            return

        threshold = float(job.get("threshold", 0.45))

        log.info(
            "Reveal job %s — %d target(s), threshold=%.2f",
            job_id, len(target_embeddings), threshold,
        )

        await self._update(job_id, status="processing", started_at=self._now(), progress=5)

        # 2. Original MP4-ыг татаж local-руу
        with tempfile.TemporaryDirectory() as tmp:
            input_mp4 = os.path.join(tmp, "input.mp4")
            output_mp4 = os.path.join(tmp, "output.mp4")

            try:
                blob = self.storage.client.storage.from_("recordings").download(original_path)
                # `.enc` суффикстэй файлууд AES-256-GCM-аар encrypted.
                # Хуучин plaintext .mp4 файлуудтай backward-compatible байна.
                if isinstance(original_path, str) and original_path.endswith(".enc"):
                    # rec_uuid аль хэдийн дээр assigned байна
                    try:
                        blob = decrypt_bytes(blob, recording_id=rec_uuid)
                    except Exception as e:
                        await self._fail(job_id, f"Decrypt алдаа (auth tag invalid?): {e}")
                        return
                with open(input_mp4, "wb") as f:
                    f.write(blob)
            except Exception as e:
                await self._fail(job_id, f"Татаж чадаагүй: {e}")
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

            try:
                duration = self._process_video(
                    input_mp4=input_mp4,
                    output_mp4=output_mp4,
                    target_embeddings=target_embeddings,
                    threshold=threshold,
                    job_id=job_id,
                    watermark_email=requester_email,
                    watermark_at=watermark_at,
                    target_start_sec=target_start_sec,
                    target_end_sec=target_end_sec,
                )
            except Exception as e:
                await self._fail(job_id, f"Боловсруулах алдаа: {e}")
                return

            # 4. Result-г Storage-руу upload
            output_path = f"{job_id}.mp4"
            try:
                with open(output_mp4, "rb") as f:
                    self.storage.upload_bytes(
                        "revealed", output_path, f.read(), "video/mp4"
                    )
            except Exception as e:
                await self._fail(job_id, f"Upload алдаа: {e}")
                return

            # 5. Done
            await self._update(
                job_id,
                status="completed",
                progress=100,
                output_path=output_path,
                output_duration_sec=duration,
                completed_at=self._now(),
            )
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
                log.warning("face_ids-аас embedding авч чадсангүй: %s", e)

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
    ) -> int:
        """Process video frame-by-frame, selectively un-masking target faces.

        If `target_start_sec`/`target_end_sec` are both set, frames whose
        timestamp falls OUTSIDE that range are emitted with every face masked
        (no reveal) regardless of similarity. Inside the range the existing
        selective-blur logic runs. Default (both None) keeps the legacy
        whole-recording behaviour.
        """
        cap = cv2.VideoCapture(input_mp4)
        if not cap.isOpened():
            raise RuntimeError("Input MP4 нээгдсэнгүй")

        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 15
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        time_bounded = target_start_sec is not None and target_end_sec is not None
        if time_bounded:
            log.info(
                "Reveal job %s — time-bounded scope [%.2fs, %.2fs]",
                job_id, target_start_sec, target_end_sec,
            )

        # FFmpeg encoder pipe (BGR raw → MP4 H.264)
        encoder = subprocess.Popen(
            [
                "ffmpeg", "-y",
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

        # 10 frame тутамд detect (хурдасгана — Railway CPU дээр)
        frame_idx = 0
        detect_every = 10
        last_match_boxes: list[tuple[int, int, int, int]] = []
        progress_step = max(1, total_frames // 20)  # 20 удаа progress update
        last_progress_update = 0

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

                if frame_idx % detect_every == 0:
                    if in_scope:
                        # Re-compute матч хэсгүүд — олон target-аас аль нэг нь тохирвол keep
                        last_match_boxes = self._find_target_boxes(
                            frame, target_embeddings, threshold
                        )
                    else:
                        # Scope-аас гадуур: бүх face-ыг блюртэй үлдээх → match-гүй
                        last_match_boxes = []

                # Бүх нүүрийг blur, сонгосон бүс л original үлдэх (Haar only — fast)
                # Scope-аас гадуур үед last_match_boxes хоосон тул бүгд masked.
                output = self._selective_blur(
                    frame, last_match_boxes if in_scope else []
                )

                # Watermark — accountability layer (admin email + timestamp)
                if watermark_email:
                    output = self._draw_watermark(output, watermark_email, watermark_at)

                try:
                    encoder.stdin.write(output.tobytes())
                except (BrokenPipeError, OSError):
                    break

                frame_idx += 1
                # Progress update (DB)
                if total_frames and frame_idx - last_progress_update >= progress_step:
                    pct = min(95, int(5 + 90 * frame_idx / total_frames))
                    try:
                        self.storage.client.table("reveal_jobs").update(
                            {"progress": pct}
                        ).eq("id", job_id).execute()
                    except Exception:
                        pass
                    last_progress_update = frame_idx
        finally:
            cap.release()
            if encoder.stdin:
                encoder.stdin.close()
            encoder.wait(timeout=10)

        return int(frame_idx / fps) if fps else 0

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
        self, frame: np.ndarray, keep_boxes: list[tuple[int, int, int, int]]
    ) -> np.ndarray:
        """Бүх нүүрийг blur, гэхдээ keep_boxes-д орсон бүс л original үлдэнэ.

        Haar cascade (every frame) + InsightFace (every Nth) хослуулж олж
        мэдсэн бүх нүүрийг blur хийнэ. 35% padding нь motion-р нүүр box-аас
        гарахыг сэргийлнэ.
        """
        out = frame.copy()
        h, w = frame.shape[:2]

        if not hasattr(self, "_haar"):
            haar_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            self._haar = cv2.CascadeClassifier(haar_path)
            self._blur_frame_idx = 0

        self._blur_frame_idx += 1
        all_faces: list[tuple[int, int, int, int]] = []

        # Haar only (cheap) — every frame
        # InsightFace-г хасав — _find_target_boxes-д аль хэдийн ашигласан учраас
        # давхар detection нь CPU-г 5x удаашруулна (Railway free tier).
        if not self._haar.empty():
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self._haar.detectMultiScale(
                gray, scaleFactor=1.05, minNeighbors=3, minSize=(20, 20)
            )
            for (x, y, fw, fh) in faces:
                all_faces.append((int(x), int(y), int(x + fw), int(y + fh)))

        if not all_faces:
            return out

        pad_ratio = 0.35
        for (x1, y1, x2, y2) in all_faces:
            if x2 - x1 < 10 or y2 - y1 < 10:
                continue

            # Энэ box-нь target(-уудын) аль нэгтэй тааралцах уу? IoU > 0.3 → keep
            keep = any(
                self._iou((x1, y1, x2, y2), kb) > 0.3 for kb in keep_boxes
            )
            if keep:
                continue

            # Padding-тэй blur — motion-д нүүр гарахаас сэргийлнэ
            bw, bh = x2 - x1, y2 - y1
            pad_x = int(bw * pad_ratio)
            pad_y = int(bh * pad_ratio)
            x1p = max(0, x1 - pad_x)
            y1p = max(0, y1 - pad_y)
            x2p = min(w, x2 + pad_x)
            y2p = min(h, y2 + pad_y)
            roi = out[y1p:y2p, x1p:x2p]
            if roi.size > 0:
                # Cubist polygon mosaic — recording_pipeline-тай ижил алгоритм
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                seed = (cx >> 5) * 7919 + (cy >> 5) * 31
                out[y1p:y2p, x1p:x2p] = _cubist_anonymize(roi, seed=seed)

        return out

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
        """recordings.original_path → Storage path"""
        res = (
            self.storage.client.table("recordings")
            .select("original_path, has_original")
            .eq("id", recording_id)
            .single()
            .execute()
        )
        if res.data and res.data.get("has_original"):
            return res.data.get("original_path")
        return None

    async def _update(self, job_id: str, **fields):
        try:
            self.storage.client.table("reveal_jobs").update(fields).eq(
                "id", job_id
            ).execute()
        except Exception as e:
            log.error("Job update failed: %s", e)

    async def _fail(self, job_id: str, msg: str):
        log.error("Job %s failed: %s", job_id, msg)
        await self._update(
            job_id,
            status="failed",
            error_message=msg,
            completed_at=self._now(),
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
