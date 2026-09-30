"""
cipher_mask — the "encrypted face" visual of a ``face_encrypted`` recording.

In the stored masked video every face box is filled with coarse keyed
"cipher noise": flat 8–12 px cells whose colours come from an AES-256-CTR
keystream keyed per (recording, track). The pixels are a function of the key,
the track id and the cell position ONLY — nothing of the face underneath
enters them — so the pattern leaks nothing about the face (the face itself is
kept, sealed, in the face envelope — see ``face_envelope``). A thin 1 px
outline shows viewers that a face was there.

Flat cells are compression-friendly (x264 codes them as a few flat blocks,
not per-pixel noise), and a track keeps its colour table for its lifetime:
the grid is anchored at the box's top-left corner and each cell reads the
table at ``(row mod 64, col mod 64)``, so the pattern moves with the face
instead of flickering.

The visual key is its own HKDF derivation of the master key (salt
``mongolz-face-cipher-visual-v1``) — never a face key: the pattern is
visible to every viewer, the face keys are not.
"""

from __future__ import annotations

import struct
from collections import OrderedDict

import cv2
import numpy as np
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

Rect = tuple[int, int, int, int]  # (x1, y1, x2, y2), exclusive right/bottom

TABLE_CELLS = 64
MIN_CELL_PX = 8
MAX_CELL_PX = 12
OUTLINE_BGR = (200, 200, 200)
_VISUAL_SALT = b"mongolz-face-cipher-visual-v1"
_MAX_CACHED_TABLES = 256


def visual_key(recording_id: str, master: bytes) -> bytes:
    """Per-recording key of the cipher visual (separate from every face key)."""
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_VISUAL_SALT,
        info=f"{recording_id}:cipher-visual".encode("utf-8"),
    ).derive(master)


def cell_size(width: int, height: int) -> int:
    return max(MIN_CELL_PX, min(MAX_CELL_PX, min(int(width), int(height)) // 10))


class CipherPalette:
    """Colour tables of one recording's tracks (bounded LRU). Not
    thread-safe; the capture pipeline uses one per segment from one render
    thread at a time."""

    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("cipher visual key must be 32 bytes")
        self._key = key
        self._tables: OrderedDict[int, np.ndarray] = OrderedDict()

    def table(self, track_id: int) -> np.ndarray:
        track_id = int(track_id)
        table = self._tables.get(track_id)
        if table is not None:
            self._tables.move_to_end(track_id)
            return table
        # Counter block: track id in the high 32 bits, block counter below.
        nonce = struct.pack(">I", track_id & 0xFFFFFFFF) + bytes(12)
        encryptor = Cipher(algorithms.AES(self._key), modes.CTR(nonce)).encryptor()
        stream = encryptor.update(bytes(TABLE_CELLS * TABLE_CELLS * 3)) + encryptor.finalize()
        table = np.frombuffer(stream, dtype=np.uint8).reshape(TABLE_CELLS, TABLE_CELLS, 3).copy()
        self._tables[track_id] = table
        if len(self._tables) > _MAX_CACHED_TABLES:
            self._tables.popitem(last=False)
        return table


def cipher_block(palette: CipherPalette, track_id: int, width: int, height: int) -> np.ndarray:
    """The ``height × width`` BGR cipher pattern of a track."""
    cell = cell_size(width, height)
    rows = -(-int(height) // cell)
    cols = -(-int(width) // cell)
    table = palette.table(track_id)
    colours = table[np.arange(rows)[:, None] % TABLE_CELLS, np.arange(cols)[None, :] % TABLE_CELLS]
    block = np.repeat(np.repeat(colours, cell, axis=0), cell, axis=1)
    return block[:height, :width]


def paint_cipher(frame: np.ndarray, rect: Rect, palette: CipherPalette, track_id: int) -> None:
    """Fill ``rect`` of ``frame`` (in place) with the track's cipher pattern
    and draw a 1 px outline along its border."""
    x1, y1, x2, y2 = (int(v) for v in rect)
    fh, fw = frame.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(fw, x2), min(fh, y2)
    if x2 <= x1 or y2 <= y1:
        return
    frame[y1:y2, x1:x2] = cipher_block(palette, track_id, x2 - x1, y2 - y1)
    cv2.rectangle(frame, (x1, y1), (x2 - 1, y2 - 1), OUTLINE_BGR, 1)
