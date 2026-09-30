"""
face_envelope — per-face sealed crops of a ``face_encrypted`` recording.

Recording mode ``face_encrypted`` (``cameras.recording_mode``, ADR 0013)
stores NO raw original. The stored video is the masked video (every face box
painted with the keyed cipher pattern of ``cipher_mask``), and every face box
of every frame captured in ``standard`` privacy mode is kept separately in
this envelope: the crop pixels, JPEG-encoded and sealed with AES-256-GCM
under the per-face hash-chain key ``K_chain_index`` of ADR 0009
(``hierarchical_keys.key_at_index(recording_id, chain_index, master)``).

Restoring person X decrypts ONLY the blobs of X's tracks — every other face
stays ciphertext, inside the ML process too. The reader never reads, let
alone decrypts, the ciphertext of a track that was not requested.

File layout (version 1, little-endian)
--------------------------------------
::

    header   "MFE1" | version u8 (=1) | flags u8 (=0) | header_len u16
             | header JSON (utf-8; metadata only, no secrets)
    record*  type u8
             0x01 blob:  frame_index u32 | t_offset f32 | track_id u32
                         | chain_index u32 | x u16 | y u16 | w u16 | h u16
                         | ml u8 | mt u8 | mr u8 | mb u8
                         | nonce 12B | ct_len u32 | ct (ciphertext ‖ 16B tag)
             0x02 index: sealed_len u32 | sealed (crypto_utils.encrypt_bytes)
             0x03 painted: frame_index u32 | track_id u32 | x u16 | y u16
                         | w u16 | h u16   (a painted rectangle with NO blob)

* ``(x, y, w, h)`` is the CROP rectangle in frame pixels. The inner rectangle
  ``(x+ml, y+mt, w-ml-mr, h-mt-mb)`` is the one painted with the cipher
  pattern in the stored video; the margins are real (unmasked) pixels there
  and exist so a restoration can feather its edge over identical pixels.
  Pixels inside ANOTHER track's inner rectangle of the same frame are zeroed
  before sealing: decrypting X's blob never yields a pixel of anyone else's
  face box.
* AEAD per blob: ``AESGCM(K_chain_index)``, random 96-bit nonce, AAD =
  ``b"mongolz-face-envelope-v1\\0" ‖ recording_id ‖ b"\\0" ‖`` the 28 header
  bytes from ``frame_index`` to ``mb`` — a blob cannot be moved to another
  recording, frame, track, key or position without failing authentication.
* A painted record names a rectangle that is painted with the cipher pattern
  in that frame but has no blob: a stale persistence box of a track whose
  face was detected elsewhere in the frame (its old position), a stale box
  after the track stopped being detected, or a box no live track owns. It
  carries no pixels; a restoration only uses it to keep that rectangle's
  cipher pattern (``rects_by_frame``) — blobs have those pixels zeroed.
* The final index record (written once at finalize) is JSON sealed with the
  per-recording key family (``crypto_utils.encrypt_bytes`` with context
  ``face-envelope-index:<recording_id>``), so the track → face_id links and
  the identity samples are not plaintext metadata::

      {"version": 1, "recording_id": …, "frames": N, "fps": …, "width": …,
       "height": …, "blob_count": …, "withheld_blobs": …, "painted": …,
       "tracks": [{"track_id", "chain_index", "face_id" | null,
                   "first_frame", "last_frame", "blobs",
                   "samples": [{"frame": f, "sealed": base64}],
                   "runs": [[start, end], …]}]}

  ``samples`` are the ArcFace embeddings the capture-time recognition tick
  took of that track (one per tick at most), each sealed with AES-256-GCM
  under the track's own ``K_chain_index`` (AAD = recording, track, chain
  index, frame): a reveal compares its target with them, so a track is
  selected by its own face, never by a weaker capture-time match, and
  ``reveal_level`` applies to them exactly as to the blobs. ``runs`` are the
  track's detection runs: the stretches of consecutive frames on which the
  tracker associated a FRESH detection with the track (``note_detections``,
  recorded in every privacy mode). The tracker is geometric, so a miss is
  where one person can hand the track to another (someone leaves, someone
  else steps into the same place within ``TRACK_MAX_GAP`` frames); a reveal
  confirms a blob before a track's first or after its last sample only
  inside that sample's run. The index also
  authenticates ``fps`` / ``width`` / ``height``; a plaintext file header
  that disagrees with it makes the envelope unusable.

* Append-only while capturing. A truncated or garbled tail (crash, full
  disk) is ignored on read: every complete record before it stays readable;
  without the index the reader rebuilds the track table from the record
  headers (``face_id`` unknown → ``None``) and reports ``complete=False``.

At rest the delivered object is additionally wrapped with the per-recording
key like every capture artifact (``<…>_faces.mfe.enc`` =
``crypto_utils.encrypt_bytes(file, recording_id)``); ``EnvelopeReader.
from_stored`` removes that layer.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import os
import secrets
import stat
import struct
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable, Iterable, Iterator, Sequence

import cv2
import numpy as np
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import crypto_utils
from hierarchical_keys import key_at_index, next_key

log = logging.getLogger("mongolz-ml.face-envelope")

MAGIC = b"MFE1"
VERSION = 1
REC_BLOB = 0x01
REC_INDEX = 0x02
REC_PAINTED = 0x03
AAD_PREFIX = b"mongolz-face-envelope-v1\x00"
SAMPLE_AAD_PREFIX = b"mongolz-face-envelope-sample-v1\x00"
INDEX_CONTEXT_PREFIX = "face-envelope-index:"

_FILE_HEADER = struct.Struct("<4sBBH")        # magic, version, flags, header_len
_FIELDS = struct.Struct("<IfIIHHHHBBBB")       # authenticated blob header (28 bytes)
_NONCE_SIZE = 12
_TAG_SIZE = 16
_BLOB_TAIL = struct.Struct("<12sI")            # nonce, ct_len
_U32 = struct.Struct("<I")
_PAINTED = struct.Struct("<IIHHHH")           # frame_index, track_id, x, y, w, h
_SAMPLE_FIELDS = struct.Struct("<III")        # track_id, chain_index, frame_index
BLOB_HEADER_SIZE = _FIELDS.size + _BLOB_TAIL.size  # 44 bytes after the type byte

MAX_CT_LEN = 4 * 1024 * 1024
MAX_INDEX_LEN = 64 * 1024 * 1024
# One identity sample per recognition tick (1 s) of a segment of at most
# 300 s; a bound, not a budget.
MAX_SAMPLES_PER_TRACK = 300
_U16_MAX = 0xFFFF
_U32_MAX = 0xFFFFFFFF


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


DEFAULT_JPEG_QUALITY = _env_int("FACE_ENVELOPE_JPEG_QUALITY", 90, 50, 100)
DEFAULT_MAX_SIDE = _env_int("FACE_ENVELOPE_MAX_SIDE", 192, 32, 1024)
DEFAULT_MARGIN_PX = _env_int("FACE_ENVELOPE_MARGIN_PX", 6, 0, 64)
# A face envelope is delivered as ONE Storage object: the capture pipeline
# rotates the segment once its envelope reaches this size, so a busy scene can
# never produce an object Storage refuses (Supabase's default global upload
# limit is 50 MB). 40 MiB leaves room for the at-rest wrapping.
DEFAULT_MAX_ENVELOPE_BYTES = _env_int(
    "FACE_ENVELOPE_MAX_BYTES", 40 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024
)

Rect = tuple[int, int, int, int]  # (x1, y1, x2, y2), exclusive right/bottom


class EnvelopeError(RuntimeError):
    """The envelope is unusable (bad magic/version, wrong recording)."""


class EnvelopeIntegrityError(EnvelopeError):
    """A requested blob failed authentication (tampered, swapped or a wrong
    key). Never silently skipped."""


def canonical_recording_id(recording_id: str) -> str:
    return str(uuid.UUID(str(recording_id)))


def index_context(recording_id: str) -> str:
    """crypto_utils key context of the sealed index."""
    return f"{INDEX_CONTEXT_PREFIX}{canonical_recording_id(recording_id)}"


def _aad(recording_id: str, fields: bytes) -> bytes:
    return AAD_PREFIX + recording_id.encode("utf-8") + b"\x00" + fields


def _sample_aad(recording_id: str, track_id: int, chain_index: int, frame_index: int) -> bytes:
    return (SAMPLE_AAD_PREFIX + recording_id.encode("utf-8") + b"\x00"
            + _SAMPLE_FIELDS.pack(int(track_id), int(chain_index), int(frame_index)))


def _pack_fields(frame_index, t_offset, track_id, chain_index, rect, margins) -> bytes:
    x, y, w, h = (int(v) for v in rect)
    ml, mt, mr, mb = (int(v) for v in margins)
    for name, value, top in (
        ("frame_index", frame_index, _U32_MAX), ("track_id", track_id, _U32_MAX),
        ("chain_index", chain_index, _U32_MAX), ("x", x, _U16_MAX), ("y", y, _U16_MAX),
        ("w", w, _U16_MAX), ("h", h, _U16_MAX),
    ):
        if not 0 <= int(value) <= top:
            raise ValueError(f"{name} out of range: {value!r}")
    if w < 1 or h < 1:
        raise ValueError("empty crop rectangle")
    if any(not 0 <= m <= 255 for m in (ml, mt, mr, mb)) or ml + mr >= w or mt + mb >= h:
        raise ValueError("invalid margins")
    t = float(t_offset)
    if not math.isfinite(t) or t < 0:
        raise ValueError(f"t_offset out of range: {t_offset!r}")
    return _FIELDS.pack(int(frame_index), t, int(track_id), int(chain_index), x, y, w, h, ml, mt, mr, mb)


def encode_crop(crop: np.ndarray, *, quality: int = DEFAULT_JPEG_QUALITY, max_side: int = DEFAULT_MAX_SIDE) -> bytes:
    """BGR crop → JPEG bytes, downscaled so its longer side is ≤ ``max_side``."""
    if crop is None or crop.size == 0:
        raise ValueError("empty crop")
    h, w = crop.shape[:2]
    if max(h, w) > max_side:
        scale = max_side / float(max(h, w))
        crop = cv2.resize(
            crop, (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            interpolation=cv2.INTER_AREA,
        )
    ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        raise ValueError("crop JPEG encode failed")
    return buf.tobytes()


def crop_rect(inner: Rect, frame_w: int, frame_h: int, margin: int = DEFAULT_MARGIN_PX) -> tuple[Rect, tuple[int, int, int, int]]:
    """Grow the painted (inner) rectangle by ``margin`` px, clipped to the
    frame. Returns ``((x1, y1, x2, y2), (ml, mt, mr, mb))``."""
    x1, y1, x2, y2 = (int(v) for v in inner)
    margin = max(0, min(255, int(margin)))
    cx1, cy1 = max(0, x1 - margin), max(0, y1 - margin)
    cx2, cy2 = min(frame_w, x2 + margin), min(frame_h, y2 + margin)
    return (cx1, cy1, cx2, cy2), (x1 - cx1, y1 - cy1, cx2 - x2, cy2 - y2)


def _intersect(a: Rect, b: Rect) -> Rect | None:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    return (x1, y1, x2, y2) if x1 < x2 and y1 < y2 else None


@dataclass(frozen=True)
class SealedBlob:
    """One sealed record, not yet written (the capture pipeline holds them
    for one privacy tick before committing — see recording_pipeline)."""

    frame_index: int
    track_id: int
    chain_index: int
    record: bytes           # full record bytes, type byte included


@dataclass(frozen=True)
class PaintedRect:
    """A painted rectangle without a blob, not yet written."""

    frame_index: int
    track_id: int
    record: bytes           # full record bytes, type byte included


@dataclass(frozen=True)
class BlobMaterial:
    """What ``seal`` sealed, kept by the capture pipeline for one frame so a
    held (repeated) frame can be sealed again under its own frame index
    without a second JPEG encode."""

    track_id: int
    chain_index: int
    rect: Rect
    margins: tuple[int, int, int, int]
    jpeg: bytes


@dataclass(frozen=True)
class BlobHeader:
    """Plaintext header of one blob record (no decryption involved)."""

    frame_index: int
    t_offset: float
    track_id: int
    chain_index: int
    x: int
    y: int
    w: int
    h: int
    margins: tuple[int, int, int, int]   # (ml, mt, mr, mb)
    nonce: bytes
    ct_offset: int
    ct_len: int
    fields: bytes                        # the 28 authenticated bytes (AAD)

    @property
    def rect(self) -> Rect:
        """Crop rectangle ``(x1, y1, x2, y2)`` in frame pixels."""
        return (self.x, self.y, self.x + self.w, self.y + self.h)

    @property
    def inner_rect(self) -> Rect:
        """The rectangle painted with the cipher pattern in the stored video."""
        ml, mt, mr, mb = self.margins
        return (self.x + ml, self.y + mt, self.x + self.w - mr, self.y + self.h - mb)


@dataclass(frozen=True)
class FaceBlob:
    """A decrypted face crop (JPEG) and where it belongs."""

    frame_index: int
    t_offset: float
    track_id: int
    chain_index: int
    rect: Rect                               # crop rectangle (x1, y1, x2, y2)
    inner_rect: Rect                         # painted rectangle (x1, y1, x2, y2)
    jpeg: bytes

    def decode(self) -> np.ndarray:
        """BGR pixels resized to the crop rectangle's size."""
        img = cv2.imdecode(np.frombuffer(self.jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise EnvelopeIntegrityError("face blob is not a decodable image")
        w, h = self.rect[2] - self.rect[0], self.rect[3] - self.rect[1]
        if img.shape[1] != w or img.shape[0] != h:
            interp = cv2.INTER_CUBIC if img.shape[1] < w else cv2.INTER_AREA
            img = cv2.resize(img, (w, h), interpolation=interp)
        return img


@dataclass(frozen=True)
class TrackSample:
    """A sealed identity sample (ArcFace embedding) of a track."""

    frame_index: int
    sealed: bytes            # nonce ‖ ciphertext ‖ tag


@dataclass(frozen=True)
class TrackInfo:
    track_id: int
    chain_index: int
    face_id: str | None
    first_frame: int
    last_frame: int
    blobs: int
    samples: tuple[TrackSample, ...] = ()
    # Detection runs ``((start, end), …)``: sorted, disjoint, inclusive.
    # None = not recorded (an index without runs, or one rebuilt from the
    # record headers): nothing can be confirmed beyond a sample's own frame.
    runs: tuple[tuple[int, int], ...] | None = None


# ─────────────────────────────────────────────────────────────
# Writer
# ─────────────────────────────────────────────────────────────
class EnvelopeWriter:
    """Append-only envelope of one recording segment. Thread-safe: ``seal``
    runs in the capture pipeline's render thread, ``link`` on the event loop.
    """

    def __init__(
        self,
        path: str | os.PathLike,
        recording_id: str,
        *,
        width: int,
        height: int,
        fps: float,
        master: bytes | None = None,
        jpeg_quality: int = DEFAULT_JPEG_QUALITY,
        max_side: int = DEFAULT_MAX_SIDE,
        margin: int = DEFAULT_MARGIN_PX,
    ):
        self.path = str(path)
        self.recording_id = canonical_recording_id(recording_id)
        self.width, self.height, self.fps = int(width), int(height), float(fps)
        self.jpeg_quality, self.max_side = int(jpeg_quality), int(max_side)
        self.margin = max(0, min(255, int(margin)))
        self._master = master if master is not None else crypto_utils.master_key()
        self._keys: dict[int, bytes] = {}
        self._lock = threading.Lock()
        self._tracks: dict[int, dict] = {}
        self._links: dict[int, str] = {}
        self._samples: dict[int, list[tuple[int, int, str]]] = {}  # track → [(chain, frame, b64)]
        self._runs: dict[int, list[list[int]]] = {}  # track → [[start, end], …] (fresh detections)
        self.blob_count = 0
        self.painted_count = 0
        self.bytes_written = 0
        self.finalized = False
        self.closed = False
        # Owner-only; O_EXCL — a segment never appends to a foreign file.
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
        self._fh: BinaryIO | None = os.fdopen(fd, "wb")
        header = json.dumps({
            "format": "mongolz-face-envelope",
            "version": VERSION,
            "recording_id": self.recording_id,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "crop": {"codec": "jpeg", "quality": self.jpeg_quality, "max_side": self.max_side,
                     "margin_px": self.margin},
            "keys": "per-face hash chain (ADR 0009)",
        }, separators=(",", ":")).encode("utf-8")
        self._write(_FILE_HEADER.pack(MAGIC, VERSION, 0, len(header)) + header)

    # ── keys ───────────────────────────────────────────────────
    def key_for(self, chain_index: int) -> bytes:
        """K_chain_index, derived forward from the nearest cached lower key."""
        chain_index = int(chain_index)
        if chain_index < 0:
            raise ValueError("chain_index must be >= 0")
        with self._lock:
            key = self._keys.get(chain_index)
            if key is not None:
                return key
            lower = [i for i in self._keys if i < chain_index]
            if lower:
                start = max(lower)
                key = self._keys[start]
                for _ in range(chain_index - start):
                    key = next_key(key)
            else:
                key = key_at_index(self.recording_id, chain_index, self._master)
            self._keys[chain_index] = key
            return key

    # ── sealing ────────────────────────────────────────────────
    def seal(
        self,
        *,
        frame_index: int,
        t_offset: float,
        track_id: int,
        chain_index: int,
        rect: Rect,
        margins: tuple[int, int, int, int],
        crop: np.ndarray,
    ) -> SealedBlob:
        """JPEG-encode + seal one crop (``rect`` = crop rectangle
        ``(x1, y1, x2, y2)``; ``crop`` = its BGR pixels). Nothing is written."""
        jpeg = encode_crop(crop, quality=self.jpeg_quality, max_side=self.max_side)
        return self.seal_jpeg(frame_index=frame_index, t_offset=t_offset, track_id=track_id,
                              chain_index=chain_index, rect=rect, margins=margins, jpeg=jpeg)

    def seal_jpeg(
        self,
        *,
        frame_index: int,
        t_offset: float,
        track_id: int,
        chain_index: int,
        rect: Rect,
        margins: tuple[int, int, int, int],
        jpeg: bytes,
    ) -> SealedBlob:
        """Seal an already encoded crop (a held frame repeats the previous
        frame's crops under its own frame index: new nonce, new AAD)."""
        x1, y1, x2, y2 = (int(v) for v in rect)
        fields = _pack_fields(frame_index, t_offset, track_id, chain_index, (x1, y1, x2 - x1, y2 - y1), margins)
        nonce = secrets.token_bytes(_NONCE_SIZE)
        ct = AESGCM(self.key_for(chain_index)).encrypt(nonce, bytes(jpeg), _aad(self.recording_id, fields))
        record = bytes((REC_BLOB,)) + fields + _BLOB_TAIL.pack(nonce, len(ct)) + ct
        return SealedBlob(int(frame_index), int(track_id), int(chain_index), record)

    def painted(self, *, frame_index: int, track_id: int, rect: Rect) -> PaintedRect:
        """Record of a rectangle painted in this frame that has no blob
        (``rect`` = the painted rectangle ``(x1, y1, x2, y2)``; ``track_id``
        0 = owned by no live track). Nothing is written."""
        x1, y1, x2, y2 = (int(v) for v in rect)
        w, h = x2 - x1, y2 - y1
        for name, value, top in (
            ("frame_index", frame_index, _U32_MAX), ("track_id", track_id, _U32_MAX),
            ("x", x1, _U16_MAX), ("y", y1, _U16_MAX), ("w", w, _U16_MAX), ("h", h, _U16_MAX),
        ):
            if not 0 <= int(value) <= top:
                raise ValueError(f"{name} out of range: {value!r}")
        if w < 1 or h < 1:
            raise ValueError("empty painted rectangle")
        record = bytes((REC_PAINTED,)) + _PAINTED.pack(int(frame_index), int(track_id), x1, y1, w, h)
        return PaintedRect(int(frame_index), int(track_id), record)

    def append(self, blobs: Iterable[SealedBlob]) -> int:
        """Write sealed records in order. Returns how many were written."""
        count = 0
        with self._lock:
            if self.closed:
                raise EnvelopeError("envelope already closed")
            for blob in blobs:
                self._write_locked(blob.record)
                if isinstance(blob, PaintedRect):
                    self.painted_count += 1
                    continue
                stats = self._tracks.get(blob.track_id)
                if stats is None:
                    self._tracks[blob.track_id] = {
                        "chain_index": blob.chain_index, "first_frame": blob.frame_index,
                        "last_frame": blob.frame_index, "blobs": 1,
                    }
                else:
                    stats["first_frame"] = min(stats["first_frame"], blob.frame_index)
                    stats["last_frame"] = max(stats["last_frame"], blob.frame_index)
                    stats["blobs"] += 1
                self.blob_count += 1
                count += 1
        return count

    def add_face(self, **kwargs) -> SealedBlob:
        """``seal`` + ``append`` (tests and simple callers)."""
        blob = self.seal(**kwargs)
        self.append([blob])
        return blob

    def link(self, track_id: int, face_id: str) -> bool:
        """Link a track to a ``faces`` row. The first link of a track wins;
        returns True when this call created the link."""
        if not face_id:
            return False
        with self._lock:
            if self.finalized or int(track_id) in self._links:
                return False
            self._links[int(track_id)] = str(face_id)
            return True

    def links(self) -> dict[int, str]:
        with self._lock:
            return dict(self._links)

    def add_sample(self, track_id: int, chain_index: int, frame_index: int, embedding) -> bool:
        """Seal one identity sample (the ArcFace embedding the recognition
        tick computed for this track's box at ``frame_index``) under the
        track's ``K_chain_index``. Kept in memory and written into the sealed
        index at finalize; a sample whose chain index does not match the
        track's blobs is dropped there. Returns True when it was kept."""
        emb = np.asarray(embedding, dtype=np.float32).reshape(-1)
        if emb.size == 0 or not np.all(np.isfinite(emb)):
            return False
        track_id, chain_index, frame_index = int(track_id), int(chain_index), int(frame_index)
        for name, value in (("track_id", track_id), ("chain_index", chain_index), ("frame_index", frame_index)):
            if not 0 <= value <= _U32_MAX:
                raise ValueError(f"{name} out of range: {value!r}")
        nonce = secrets.token_bytes(_NONCE_SIZE)
        ct = AESGCM(self.key_for(chain_index)).encrypt(
            nonce, emb.tobytes(), _sample_aad(self.recording_id, track_id, chain_index, frame_index)
        )
        sealed = base64.b64encode(nonce + ct).decode("ascii")
        with self._lock:
            if self.finalized:
                return False
            samples = self._samples.setdefault(track_id, [])
            if len(samples) >= MAX_SAMPLES_PER_TRACK:
                return False
            samples.append((chain_index, frame_index, sealed))
            return True

    def note_detections(self, frame_index: int, track_ids: Iterable[int]) -> None:
        """Record that the tracker associated a FRESH detection with each of
        ``track_ids`` on ``frame_index``. Called once per processed frame in
        every privacy mode (a frame whose blobs are withheld still extends or
        breaks a run). A detection on the frame after a track's last one
        extends its current run; any other frame starts a new run. A frame at
        or before a track's last noted frame (never sent by the pipeline,
        which notes frames in order) is ignored: that can only leave runs
        shorter, so it never lets a reveal confirm more."""
        frame_index = int(frame_index)
        if not 0 <= frame_index <= _U32_MAX:
            raise ValueError(f"frame_index out of range: {frame_index!r}")
        with self._lock:
            if self.finalized:
                return
            for track_id in {int(t) for t in track_ids}:
                runs = self._runs.setdefault(track_id, [])
                if runs and frame_index <= runs[-1][1]:
                    continue
                if runs and frame_index == runs[-1][1] + 1:
                    runs[-1][1] = frame_index
                else:
                    runs.append([frame_index, frame_index])

    # ── lifecycle ──────────────────────────────────────────────
    def index(self, *, frames: int, withheld_blobs: int = 0) -> dict:
        with self._lock:
            return self._index_locked(frames, withheld_blobs)

    def _index_locked(self, frames: int, withheld_blobs: int) -> dict:
        tracks = [
            {
                "track_id": tid,
                "chain_index": s["chain_index"],
                "face_id": self._links.get(tid),
                "first_frame": s["first_frame"],
                "last_frame": s["last_frame"],
                "blobs": s["blobs"],
                "samples": [
                    {"frame": frame, "sealed": sealed}
                    for chain, frame, sealed in sorted(self._samples.get(tid, ()), key=lambda x: x[1])
                    if chain == s["chain_index"]
                ],
                "runs": [list(run) for run in self._runs.get(tid, ())],
            }
            for tid, s in sorted(self._tracks.items())
        ]
        return {
            "version": VERSION,
            "recording_id": self.recording_id,
            "frames": int(frames),
            "fps": self.fps,
            "width": self.width,
            "height": self.height,
            "blob_count": self.blob_count,
            "withheld_blobs": int(withheld_blobs),
            "painted": self.painted_count,
            "tracks": tracks,
        }

    def finalize(self, *, frames: int, withheld_blobs: int = 0) -> dict:
        """Write the sealed index, fsync and close. Idempotent. Links made
        after this are refused (the index is immutable once written)."""
        with self._lock:
            index = self._index_locked(frames, withheld_blobs)
            if self.finalized:
                return index
            if self.closed:
                raise EnvelopeError("envelope already closed")
            sealed = crypto_utils.encrypt_bytes(
                json.dumps(index, separators=(",", ":")).encode("utf-8"), index_context(self.recording_id)
            )
            self._write_locked(bytes((REC_INDEX,)) + _U32.pack(len(sealed)) + sealed)
            assert self._fh is not None
            self._fh.flush()
            os.fsync(self._fh.fileno())
            self._fh.close()
            self._fh = None
            self.closed = self.finalized = True
        return index

    def abort(self) -> None:
        """Close without an index (the segment is being discarded)."""
        with self._lock:
            if self._fh is not None:
                try:
                    self._fh.close()
                except OSError:
                    pass
                self._fh = None
            self.closed = True

    def _write(self, data: bytes) -> None:
        with self._lock:
            self._write_locked(data)

    def _write_locked(self, data: bytes) -> None:
        if self._fh is None:
            raise EnvelopeError("envelope already closed")
        self._fh.write(data)
        self.bytes_written += len(data)


def blank_foreign_regions(crop: np.ndarray, rect: Rect, others: Sequence[Rect]) -> np.ndarray:
    """Zero the pixels of ``crop`` (taken at ``rect``) that lie inside any of
    ``others`` (the painted rectangles of the other tracks in that frame).
    Returns a copy; the input frame is never modified."""
    out = crop.copy()
    for other in others:
        hit = _intersect(rect, other)
        if hit is None:
            continue
        out[hit[1] - rect[1]:hit[3] - rect[1], hit[0] - rect[0]:hit[2] - rect[0]] = 0
    return out


# ─────────────────────────────────────────────────────────────
# Reader
# ─────────────────────────────────────────────────────────────
def _parse_runs(raw) -> tuple[tuple[int, int], ...] | None:
    """A track's detection runs from the sealed index (None when the index
    has none). Runs must be inclusive, sorted and disjoint; anything else is
    a writer bug (the index is authentic) and raises ``ValueError``."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError("runs must be a list")
    out: list[tuple[int, int]] = []
    for item in raw:
        if not isinstance(item, list) or len(item) != 2 \
                or not all(isinstance(v, int) and not isinstance(v, bool) for v in item):
            raise ValueError("run must be [start, end]")
        start, end = item
        if not 0 <= start <= end <= _U32_MAX or (out and start <= out[-1][1]):
            raise ValueError("runs must be sorted, disjoint and inclusive")
        out.append((start, end))
    return tuple(out)


def _open_blob(key: bytes, header: BlobHeader, ct: bytes, aad: bytes) -> bytes:
    """The single place a blob is decrypted (tests spy on it)."""
    return AESGCM(key).decrypt(header.nonce, ct, aad)


def _open_sample(key: bytes, nonce: bytes, ct: bytes, aad: bytes) -> bytes:
    """The single place an identity sample is decrypted (never a face pixel)."""
    return AESGCM(key).decrypt(nonce, ct, aad)


class EnvelopeReader:
    """Streaming reader. Construction scans the record headers once (seeking
    past every ciphertext); ``iter_blobs`` then reads and decrypts only the
    requested tracks' records.

    Attributes after construction:
      * ``header``      — the plaintext header JSON;
      * ``complete``    — the sealed index is present and authentic;
      * ``truncated``   — an incomplete / unreadable tail was ignored;
      * ``index_error`` — why the index is unusable (``None`` when complete);
      * ``frames``      — frame count from the index (``None`` if incomplete);
      * ``tracks``      — ``{track_id: TrackInfo}`` from the index, or rebuilt
        from the headers (``face_id=None``, no samples) when incomplete;
      * ``frame_width`` / ``frame_height`` / ``fps`` — from the sealed index
        when complete (the plaintext file header must agree with it, or the
        constructor raises ``EnvelopeError``), else from the file header.
    """

    def __init__(self, source: bytes | bytearray | memoryview | str | os.PathLike | BinaryIO, recording_id: str):
        self.recording_id = canonical_recording_id(recording_id)
        self._owns = False
        if isinstance(source, (bytes, bytearray, memoryview)):
            self._fh: BinaryIO = io.BytesIO(bytes(source))
        elif isinstance(source, (str, os.PathLike)):
            self._fh = open(source, "rb")  # noqa: SIM115 — closed by close()
            self._owns = True
        else:
            self._fh = source
        self.header: dict = {}
        self.complete = False
        self.truncated = False
        self.index_error: str | None = "missing"
        self.frames: int | None = None
        self.withheld_blobs: int | None = None
        self.tracks: dict[int, TrackInfo] = {}
        self.skipped_level = 0
        self._headers: list[BlobHeader] = []
        self._painted: list[tuple[int, int, Rect]] = []
        self._index: dict | None = None
        self._keys: dict[int, bytes] = {}
        try:
            self._scan()
        except BaseException:
            self.close()
            raise

    @classmethod
    def from_stored(cls, data: bytes, recording_id: str, path: str | None = None) -> "EnvelopeReader":
        """Reader over a delivered object. ``*.enc`` objects (every capture
        artifact) are unwrapped with the per-recording key first."""
        if path is None or str(path).endswith(".enc"):
            data = crypto_utils.decrypt_bytes(data, canonical_recording_id(recording_id))
        return cls(data, recording_id)

    def close(self) -> None:
        if self._owns:
            try:
                self._fh.close()
            except OSError:
                pass

    def __enter__(self) -> "EnvelopeReader":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # ── scanning ───────────────────────────────────────────────
    def _read_exact(self, n: int) -> bytes | None:
        data = self._fh.read(n)
        return data if data is not None and len(data) == n else None

    def _scan(self) -> None:
        fh = self._fh
        fh.seek(0, io.SEEK_END)
        size = fh.tell()
        fh.seek(0)
        head = self._read_exact(_FILE_HEADER.size)
        if head is None:
            raise EnvelopeError("not a face envelope (too short)")
        magic, version, _flags, header_len = _FILE_HEADER.unpack(head)
        if magic != MAGIC:
            raise EnvelopeError("not a face envelope (bad magic)")
        if version != VERSION:
            raise EnvelopeError(f"unsupported face envelope version {version}")
        raw = self._read_exact(header_len)
        if raw is None:
            raise EnvelopeError("face envelope header truncated")
        try:
            self.header = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise EnvelopeError("face envelope header unreadable") from exc
        if str(self.header.get("recording_id")) != self.recording_id:
            raise EnvelopeError("face envelope belongs to another recording")

        index: dict | None = None
        while True:
            kind = fh.read(1)
            if not kind:
                break  # clean end
            if kind[0] == REC_BLOB:
                raw_header = self._read_exact(BLOB_HEADER_SIZE)
                if raw_header is None:
                    self.truncated = True
                    break
                fields = raw_header[:_FIELDS.size]
                (frame_index, t_offset, track_id, chain_index, x, y, w, h,
                 ml, mt, mr, mb) = _FIELDS.unpack(fields)
                nonce, ct_len = _BLOB_TAIL.unpack(raw_header[_FIELDS.size:])
                ct_offset = fh.tell()
                if (
                    ct_len < _TAG_SIZE or ct_len > MAX_CT_LEN or ct_offset + ct_len > size
                    or w == 0 or h == 0 or ml + mr >= w or mt + mb >= h
                ):
                    self.truncated = True  # partial last record or a garbled tail
                    break
                fh.seek(ct_len, io.SEEK_CUR)
                self._headers.append(BlobHeader(
                    frame_index, float(t_offset), track_id, chain_index, x, y, w, h,
                    (ml, mt, mr, mb), nonce, ct_offset, ct_len, fields,
                ))
            elif kind[0] == REC_PAINTED:
                raw = self._read_exact(_PAINTED.size)
                if raw is None:
                    self.truncated = True
                    break
                frame_index, track_id, x, y, w, h = _PAINTED.unpack(raw)
                if w == 0 or h == 0:
                    self.truncated = True
                    break
                self._painted.append((frame_index, track_id, (x, y, x + w, y + h)))
            elif kind[0] == REC_INDEX:
                raw_len = self._read_exact(_U32.size)
                sealed_len = _U32.unpack(raw_len)[0] if raw_len else 0
                sealed = self._read_exact(sealed_len) if raw_len and 0 < sealed_len <= MAX_INDEX_LEN else None
                if sealed is None:
                    self.truncated = True
                    self.index_error = "truncated"
                    break
                index = self._open_index(sealed)
                if fh.read(1):
                    log.warning("face envelope %s: bytes after the index ignored", self.recording_id[:8])
                break
            else:
                self.truncated = True  # unknown record type: garbled tail
                break

        if index is not None:
            self._check_header_against(index)
            self._index = index
            self.complete = True
            self.index_error = None
            self.frames = int(index.get("frames") or 0)
            self.withheld_blobs = int(index.get("withheld_blobs") or 0)
            try:
                for t in index.get("tracks") or []:
                    samples = tuple(
                        TrackSample(int(x["frame"]), base64.b64decode(str(x["sealed"]), validate=True))
                        for x in (t.get("samples") or [])
                    )
                    info = TrackInfo(
                        int(t["track_id"]), int(t["chain_index"]),
                        str(t["face_id"]) if t.get("face_id") else None,
                        int(t["first_frame"]), int(t["last_frame"]), int(t["blobs"]),
                        samples, _parse_runs(t.get("runs")),
                    )
                    self.tracks[info.track_id] = info
            except (KeyError, TypeError, ValueError) as exc:
                # The index is authentic, so this is a writer bug, never data.
                raise EnvelopeError("face envelope index malformed") from exc
        else:
            rebuilt: dict[int, list[int]] = {}
            chains: dict[int, int] = {}
            for h in self._headers:
                rebuilt.setdefault(h.track_id, []).append(h.frame_index)
                chains.setdefault(h.track_id, h.chain_index)
            self.tracks = {
                tid: TrackInfo(tid, chains[tid], None, min(frames), max(frames), len(frames))
                for tid, frames in sorted(rebuilt.items())
            }
        if self.truncated:
            log.warning(
                "face envelope %s: incomplete tail ignored (%d readable blob(s), index %s)",
                self.recording_id[:8], len(self._headers), "ok" if self.complete else self.index_error,
            )

    def _check_header_against(self, index: dict) -> None:
        """The plaintext file header is not authenticated; the sealed index
        is. Every reader decision that uses frame geometry or timing
        (protected spans, windows, never_reveal zones) must use values an
        attacker holding only the per-recording key cannot change, so a
        header that disagrees with the index is refused outright."""
        try:
            pairs = (
                (int(self.header.get("width")), int(index.get("width"))),
                (int(self.header.get("height")), int(index.get("height"))),
            )
            fps_h, fps_i = float(self.header.get("fps")), float(index.get("fps"))
        except (TypeError, ValueError) as exc:
            raise EnvelopeError("face envelope geometry unreadable") from exc
        if any(a != b for a, b in pairs) or not (
            math.isfinite(fps_h) and math.isfinite(fps_i) and abs(fps_h - fps_i) <= 1e-9 * max(1.0, abs(fps_i))
        ):
            raise EnvelopeError("face envelope header does not match its sealed index")

    @property
    def frame_width(self) -> int:
        return int((self._index or self.header).get("width") or 0)

    @property
    def frame_height(self) -> int:
        return int((self._index or self.header).get("height") or 0)

    @property
    def fps(self) -> float:
        try:
            value = float((self._index or self.header).get("fps") or 0.0)
        except (TypeError, ValueError):
            return 0.0
        return value if math.isfinite(value) else 0.0

    def _open_index(self, sealed: bytes) -> dict | None:
        try:
            index = json.loads(crypto_utils.decrypt_bytes(sealed, index_context(self.recording_id)).decode("utf-8"))
        except (InvalidTag, ValueError, UnicodeDecodeError):
            self.index_error = "invalid"
            return None
        if not isinstance(index, dict) or index.get("version") != VERSION \
                or str(index.get("recording_id")) != self.recording_id:
            self.index_error = "invalid"
            return None
        return index

    # ── queries (headers only — nothing is decrypted) ─────────
    @property
    def blob_count(self) -> int:
        return len(self._headers)

    def headers(self, track_ids: Iterable[int] | None = None) -> list[BlobHeader]:
        if track_ids is None:
            return list(self._headers)
        wanted = {int(t) for t in track_ids}
        return [h for h in self._headers if h.track_id in wanted]

    def tracks_for_faces(self, face_ids: Iterable[str]) -> set[int]:
        """Track ids linked to any of ``face_ids`` (needs a complete index)."""
        wanted = {str(f) for f in face_ids if f}
        return {t.track_id for t in self.tracks.values() if t.face_id in wanted}

    def rects_by_frame(self) -> dict[int, list[tuple[int, Rect]]]:
        """``{frame_index: [(track_id, painted_rect), …]}`` for every blob and
        every painted-only rectangle (track 0 = owned by no live track)."""
        out: dict[int, list[tuple[int, Rect]]] = {}
        for h in self._headers:
            out.setdefault(h.frame_index, []).append((h.track_id, h.inner_rect))
        for frame_index, track_id, rect in self._painted:
            out.setdefault(frame_index, []).append((track_id, rect))
        return out

    @property
    def painted_count(self) -> int:
        return len(self._painted)

    # ── decryption ─────────────────────────────────────────────
    def _open_chained(
        self, chain_index: int, level: int, masters: Sequence[bytes],
        opener: Callable[[bytes], bytes], what: str,
    ) -> tuple[bytes, bytes]:
        cached = self._keys.get(chain_index)
        if cached is not None:
            try:
                return cached, opener(cached)
            except InvalidTag as exc:
                raise EnvelopeIntegrityError(f"{what} failed authentication") from exc
        # The real authority: K_level from the master, then walked FORWARD
        # to K_chain_index (never backwards — ADR 0009). Each master in turn
        # so a rotated ML_ENCRYPTION_KEY does not orphan older recordings.
        for master in masters:
            key = key_at_index(self.recording_id, level, master)
            for _ in range(chain_index - level):
                key = next_key(key)
            try:
                plaintext = opener(key)
            except InvalidTag:
                continue
            self._keys[chain_index] = key
            return key, plaintext
        raise EnvelopeIntegrityError(f"{what} failed authentication")

    def _key(self, header: BlobHeader, ct: bytes, aad: bytes, level: int, masters: Sequence[bytes]) -> tuple[bytes, bytes]:
        return self._open_chained(
            header.chain_index, level, masters, lambda key: _open_blob(key, header, ct, aad),
            f"face blob (track {header.track_id}, frame {header.frame_index})",
        )

    def open_samples(
        self,
        track_ids: Iterable[int] | None = None,
        *,
        level: int = 0,
        masters: Sequence[bytes] | None = None,
    ) -> dict[int, list[tuple[int, np.ndarray]]]:
        """``{track_id: [(frame_index, embedding), …]}`` — the identity
        samples of the requested tracks (all when None) that the caller's
        ``reveal_level`` reaches (``chain_index >= level``; a track below it
        is left out, its samples never decrypted). Face pixels are never
        touched. A sample that fails authentication raises
        ``EnvelopeIntegrityError``."""
        level = max(0, int(level))
        masters = list(masters) if masters is not None else crypto_utils.master_key_candidates()
        wanted = None if track_ids is None else {int(t) for t in track_ids}
        out: dict[int, list[tuple[int, np.ndarray]]] = {}
        for tid, info in sorted(self.tracks.items()):
            if wanted is not None and tid not in wanted:
                continue
            if info.chain_index < level or not info.samples:
                continue
            opened: list[tuple[int, np.ndarray]] = []
            for sample in info.samples:
                if len(sample.sealed) < _NONCE_SIZE + _TAG_SIZE:
                    raise EnvelopeIntegrityError(f"identity sample (track {tid}) truncated")
                nonce, ct = sample.sealed[:_NONCE_SIZE], sample.sealed[_NONCE_SIZE:]
                aad = _sample_aad(self.recording_id, tid, info.chain_index, sample.frame_index)
                _key, raw = self._open_chained(
                    info.chain_index, level, masters, lambda key: _open_sample(key, nonce, ct, aad),
                    f"identity sample (track {tid}, frame {sample.frame_index})",
                )
                emb = np.frombuffer(raw, dtype=np.float32)
                if emb.size == 0:
                    raise EnvelopeIntegrityError(f"identity sample (track {tid}) empty")
                opened.append((sample.frame_index, emb))
            out[tid] = opened
        return out

    def iter_blobs(
        self,
        track_ids: Iterable[int] | None = None,
        *,
        level: int = 0,
        masters: Sequence[bytes] | None = None,
        frame_range: tuple[int, int] | None = None,
        accept: Callable[[BlobHeader], bool] | None = None,
    ) -> Iterator[FaceBlob]:
        """Decrypt and yield the blobs of ``track_ids`` (all tracks when
        None), in file (= frame) order.

        * A record whose track is not requested is never read nor decrypted.
        * ``level`` (the reveal_level, ADR 0009): records with
          ``chain_index < level`` are skipped — never decrypted — and counted
          in ``skipped_level``; keys are derived from ``K_level`` forward.
        * ``frame_range``: ``(start, end)`` frame indices, end exclusive.
        * ``accept``: an optional header predicate (plaintext header only);
          a record it rejects is neither read nor decrypted — the reveal job
          uses it to leave ``never_reveal`` zones, protected (private)
          stretches and frames outside the requested window sealed.
        * ``masters``: default ``crypto_utils.master_key_candidates()``.
        * A requested blob that fails authentication raises
          ``EnvelopeIntegrityError``.
        """
        level = max(0, int(level))
        wanted = None if track_ids is None else {int(t) for t in track_ids}
        masters = list(masters) if masters is not None else crypto_utils.master_key_candidates()
        for header in self._headers:
            if wanted is not None and header.track_id not in wanted:
                continue
            if frame_range is not None and not (frame_range[0] <= header.frame_index < frame_range[1]):
                continue
            if header.chain_index < level:
                self.skipped_level += 1
                continue
            if accept is not None and not accept(header):
                continue
            self._fh.seek(header.ct_offset)
            ct = self._read_exact(header.ct_len)
            if ct is None:
                raise EnvelopeIntegrityError("face blob truncated")
            _key, jpeg = self._key(header, ct, _aad(self.recording_id, header.fields), level, masters)
            yield FaceBlob(
                header.frame_index, header.t_offset, header.track_id, header.chain_index,
                header.rect, header.inner_rect, jpeg,
            )


# ─────────────────────────────────────────────────────────────
# Restoration helper
# ─────────────────────────────────────────────────────────────
def composite(
    frame: np.ndarray,
    blob: FaceBlob,
    image: np.ndarray | None = None,
    *,
    exclude: Iterable[Rect] = (),
) -> np.ndarray:
    """Paste a restored crop onto ``frame`` in place and return it.

    Fully opaque over the painted (inner) rectangle, feathered linearly to 0
    across the margins (real pixels in both images, so the seam blends).
    ``exclude`` — the painted rectangles of the OTHER tracks visible in that
    frame — keeps their cipher pattern: those pixels were zeroed in this blob
    at capture and must never be pasted.
    """
    img = blob.decode() if image is None else image
    x1, y1, x2, y2 = blob.rect
    ix1, iy1, ix2, iy2 = blob.inner_rect
    fh, fw = frame.shape[:2]
    if x1 < 0 or y1 < 0 or x2 > fw or y2 > fh:
        raise EnvelopeError("face blob lies outside the frame")
    h, w = y2 - y1, x2 - x1

    def ramp(n: int, lo: int, hi: int) -> np.ndarray:
        # 1 inside [lo, hi), linear falloff to the edges of [0, n).
        pos = np.arange(n, dtype=np.float32)
        a = np.ones(n, dtype=np.float32)
        if lo > 0:
            a = np.minimum(a, (pos + 1) / (lo + 1))
        if hi < n:
            a = np.minimum(a, (n - pos) / (n - hi + 1))
        return np.clip(a, 0.0, 1.0)

    alpha = np.outer(ramp(h, iy1 - y1, iy2 - y1), ramp(w, ix1 - x1, ix2 - x1))
    for other in exclude:
        hit = _intersect(blob.rect, tuple(int(v) for v in other))
        if hit is not None:
            alpha[hit[1] - y1:hit[3] - y1, hit[0] - x1:hit[2] - x1] = 0.0
    region = frame[y1:y2, x1:x2].astype(np.float32)
    a = alpha[..., None]
    frame[y1:y2, x1:x2] = np.clip(img.astype(np.float32) * a + region * (1.0 - a), 0, 255).astype(np.uint8)
    return frame
