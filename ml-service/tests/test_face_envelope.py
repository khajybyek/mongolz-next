"""Face envelope (ADR 0013): per-blob AEAD under the hash-chain key K_i.

* write → read round trip; the sealed index carries the track → face_id links
  and is not plaintext;
* AAD binds recording, frame, track, key position and geometry: any header
  change, a blob moved to another recording or a flipped ciphertext bit is
  rejected;
* a truncated / garbled tail is ignored — every complete record before it
  stays readable;
* the reader never reads nor decrypts the blobs of tracks it was not asked
  for, and reveal_level L never decrypts chain_index < L (ADR 0009);
* a blob never contains pixels of another track's face box;
* restoring composites opaquely over the painted rectangle and feathers into
  the (real-pixel) margin.
"""
from __future__ import annotations

import json
import os
import secrets
import struct
from pathlib import Path

import cv2
import numpy as np
import pytest

import crypto_utils
import face_envelope as fe
from hierarchical_keys import key_at_index

REC = "5f1e2d3c-4b5a-4968-8778-695a4b3c2d1e"
OTHER_REC = "0a1b2c3d-4e5f-4061-8272-839405162738"
SAMPLES = Path(__file__).resolve().parent.parent / "samples"


@pytest.fixture(autouse=True)
def master(monkeypatch):
    key = secrets.token_bytes(32)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", key)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", None)
    return key


def _face(seed: int, h: int = 96, w: int = 80) -> np.ndarray:
    rng = np.random.RandomState(seed)
    base = cv2.resize(rng.randint(0, 255, (6, 5, 3), dtype=np.uint8), (w, h), interpolation=cv2.INTER_CUBIC)
    return base


def _write(tmp_path, master, tracks=((1, 0), (2, 3)), frames=5, name="env.mfe", finalize=True, links=None):
    """tracks: (track_id, chain_index); one blob per track per frame."""
    path = tmp_path / name
    writer = fe.EnvelopeWriter(path, REC, width=640, height=480, fps=15, master=master)
    crops = {}
    for frame in range(frames):
        for tid, chain in tracks:
            inner = (100 * tid, 50, 100 * tid + 60, 120)
            rect, margins = fe.crop_rect(inner, 640, 480, writer.margin)
            crop = _face(tid * 100 + frame, rect[3] - rect[1], rect[2] - rect[0])
            crops[(tid, frame)] = crop
            writer.add_face(frame_index=frame, t_offset=frame / 15, track_id=tid, chain_index=chain,
                            rect=rect, margins=margins, crop=crop)
        writer.note_detections(frame, [tid for tid, _chain in tracks])
    for tid, fid in (links or {}).items():
        writer.link(tid, fid)
    if finalize:
        writer.finalize(frames=frames)
    else:
        writer.abort()
    return path, crops


def test_round_trip_and_sealed_index(tmp_path, master):
    path, crops = _write(tmp_path, master, links={2: "face-row-2"})
    reader = fe.EnvelopeReader(path, REC)
    assert reader.complete and not reader.truncated and reader.index_error is None
    assert reader.frames == 5 and reader.blob_count == 10
    assert reader.tracks[1] == fe.TrackInfo(1, 0, None, 0, 4, 5, runs=((0, 4),))
    assert reader.tracks[2] == fe.TrackInfo(2, 3, "face-row-2", 0, 4, 5, runs=((0, 4),))
    assert reader.tracks_for_faces(["face-row-2"]) == {2}
    blobs = list(reader.iter_blobs())
    assert [(b.frame_index, b.track_id) for b in blobs] == [(f, t) for f in range(5) for t in (1, 2)]
    for blob in blobs:
        img = blob.decode()
        original = crops[(blob.track_id, blob.frame_index)]
        assert img.shape == original.shape
        assert np.mean(np.abs(img.astype(int) - original.astype(int))) < 6  # JPEG q90
        assert blob.inner_rect == (100 * blob.track_id, 50, 100 * blob.track_id + 60, 120)
    raw = path.read_bytes()
    # The link and the per-track table are never plaintext in the file.
    assert b"face-row-2" not in raw and b"chain_index" not in raw
    assert raw[:4] == b"MFE1" and raw[4] == 1


def test_blobs_are_sealed_with_the_hash_chain_key_of_their_track(tmp_path, master):
    path, _ = _write(tmp_path, master, tracks=((3, 4),), frames=1)
    reader = fe.EnvelopeReader(path, REC)
    header = reader.headers()[0]
    raw = path.read_bytes()
    ct = raw[header.ct_offset:header.ct_offset + header.ct_len]
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    aad = fe.AAD_PREFIX + REC.encode() + b"\x00" + header.fields
    jpeg = AESGCM(key_at_index(REC, 4, master)).decrypt(header.nonce, ct, aad)
    assert jpeg[:2] == b"\xff\xd8"
    with pytest.raises(Exception):
        AESGCM(key_at_index(REC, 3, master)).decrypt(header.nonce, ct, aad)


@pytest.mark.parametrize("field_offset", [1, 5, 9, 13, 17, 25, 28])
def test_header_tamper_is_rejected(tmp_path, master, field_offset):
    """frame_index, t_offset, track_id, chain_index, x, w/h, margins — every
    header byte is bound by the AAD."""
    path, _ = _write(tmp_path, master, tracks=((1, 0),), frames=1)
    data = bytearray(path.read_bytes())
    reader = fe.EnvelopeReader(path, REC)
    record_start = reader.headers()[0].ct_offset - fe.BLOB_HEADER_SIZE - 1
    data[record_start + field_offset] ^= 0x01
    tampered = fe.EnvelopeReader(bytes(data), REC)
    assert tampered.blob_count == 1  # still structurally valid …
    with pytest.raises(fe.EnvelopeIntegrityError):  # … but not authentic
        list(tampered.iter_blobs(level=0))


def test_ciphertext_tamper_and_cross_recording_swap_are_rejected(tmp_path, master):
    path, _ = _write(tmp_path, master, tracks=((1, 0),), frames=1)
    data = bytearray(path.read_bytes())
    header = fe.EnvelopeReader(path, REC).headers()[0]
    data[header.ct_offset + 3] ^= 0x80
    with pytest.raises(fe.EnvelopeIntegrityError):
        list(fe.EnvelopeReader(bytes(data), REC).iter_blobs())
    # Transplant the (valid) blob record of REC into an envelope of another
    # recording: the AAD names the recording, so it cannot be opened there.
    good = path.read_bytes()
    record = good[header.ct_offset - fe.BLOB_HEADER_SIZE - 1:header.ct_offset + header.ct_len]
    other = fe.EnvelopeWriter(tmp_path / "other.mfe", OTHER_REC, width=640, height=480, fps=15, master=master)
    other._write(record)
    other.finalize(frames=1)
    with pytest.raises(fe.EnvelopeIntegrityError):
        list(fe.EnvelopeReader(tmp_path / "other.mfe", OTHER_REC).iter_blobs())
    with pytest.raises(fe.EnvelopeError):
        fe.EnvelopeReader(path, OTHER_REC)  # header names another recording


def test_blob_swap_between_frames_is_rejected(tmp_path, master):
    path, _ = _write(tmp_path, master, tracks=((1, 0),), frames=2)
    data = bytearray(path.read_bytes())
    h0, h1 = fe.EnvelopeReader(path, REC).headers()
    # Move frame 1's nonce+ciphertext under frame 0's header (same key).
    n0 = h0.ct_offset - fe._BLOB_TAIL.size
    rec1 = bytes(data[h1.ct_offset - fe._BLOB_TAIL.size:h1.ct_offset + h1.ct_len])
    swapped = bytes(data[:n0]) + rec1 + bytes(data[h0.ct_offset + h0.ct_len:])
    reader = fe.EnvelopeReader(swapped, REC)
    with pytest.raises(fe.EnvelopeIntegrityError):
        list(reader.iter_blobs(frame_range=(0, 1)))


def test_index_tamper_invalidates_only_the_index(tmp_path, master):
    path, _ = _write(tmp_path, master, links={1: "face-1"})
    data = bytearray(path.read_bytes())
    data[-5] ^= 0x10  # inside the sealed index
    reader = fe.EnvelopeReader(bytes(data), REC)
    assert not reader.complete and reader.index_error == "invalid"
    assert reader.blob_count == 10
    # Links are unknown without the authentic index; blobs still readable.
    assert all(t.face_id is None for t in reader.tracks.values())
    assert len(list(reader.iter_blobs())) == 10


@pytest.mark.parametrize("cut", [1, 7, 30, 200])
def test_truncated_tail_is_ignored(tmp_path, master, cut):
    path, _ = _write(tmp_path, master, finalize=False)
    data = path.read_bytes()
    reader = fe.EnvelopeReader(data[:-cut], REC)
    assert reader.truncated and not reader.complete
    assert reader.blob_count == 9  # the partially written last record is dropped
    assert reader.tracks[1].blobs == 5 and reader.tracks[2].blobs == 4
    assert reader.tracks[1].face_id is None
    assert len(list(reader.iter_blobs())) == 9


def test_crash_without_finalize_keeps_every_complete_record(tmp_path, master):
    path, _ = _write(tmp_path, master, finalize=False)
    reader = fe.EnvelopeReader(path, REC)
    assert not reader.truncated and not reader.complete and reader.index_error == "missing"
    assert reader.blob_count == 10


def test_garbage_tail_is_ignored(tmp_path, master):
    path, _ = _write(tmp_path, master, finalize=False)
    reader = fe.EnvelopeReader(path.read_bytes() + b"\x7f" + os.urandom(64), REC)
    assert reader.truncated and reader.blob_count == 10


def test_reader_never_decrypts_unrequested_tracks(tmp_path, master, monkeypatch):
    path, _ = _write(tmp_path, master, tracks=((1, 0), (2, 1), (3, 2)))
    opened: list[int] = []
    real = fe._open_blob

    def spy(key, header, ct, aad):
        opened.append(header.track_id)
        return real(key, header, ct, aad)

    monkeypatch.setattr(fe, "_open_blob", spy)
    reader = fe.EnvelopeReader(path, REC)
    reads: list[tuple[int, int]] = []
    real_read = reader._read_exact

    def read_spy(n):
        reads.append((reader._fh.tell(), n))
        return real_read(n)

    reader._read_exact = read_spy
    blobs = list(reader.iter_blobs([2]))
    assert {b.track_id for b in blobs} == {2} and len(blobs) == 5
    assert set(opened) == {2}
    # Not even the ciphertext of tracks 1 and 3 was read.
    others = {(h.ct_offset, h.ct_len) for h in reader.headers([1, 3])}
    assert not others & set(reads)


def test_reveal_level_never_opens_a_higher_face(tmp_path, master, monkeypatch):
    path, _ = _write(tmp_path, master, tracks=((1, 0), (2, 3), (3, 5)))
    opened: list[int] = []
    real = fe._open_blob
    monkeypatch.setattr(fe, "_open_blob", lambda k, h, c, a: (opened.append(h.chain_index), real(k, h, c, a))[1])
    reader = fe.EnvelopeReader(path, REC)
    blobs = list(reader.iter_blobs(level=3))
    assert {b.track_id for b in blobs} == {2, 3}
    assert set(opened) == {3, 5}
    assert reader.skipped_level == 5
    # Asking for track 1 explicitly at level 3 still decrypts nothing.
    reader.skipped_level = 0
    assert list(reader.iter_blobs([1], level=3)) == [] and reader.skipped_level == 5


def test_accept_predicate_leaves_rejected_records_unread(tmp_path, master, monkeypatch):
    """The reveal job's zone / privacy / window filter: a record the header
    predicate rejects is neither read nor decrypted."""
    path, _ = _write(tmp_path, master, tracks=((1, 0),), frames=6)
    opened: list[int] = []
    real = fe._open_blob
    monkeypatch.setattr(fe, "_open_blob", lambda k, h, c, a: (opened.append(h.frame_index), real(k, h, c, a))[1])
    reader = fe.EnvelopeReader(path, REC)
    reads: list[tuple[int, int]] = []
    real_read = reader._read_exact

    def read_spy(n):
        reads.append((reader._fh.tell(), n))
        return real_read(n)

    reader._read_exact = read_spy
    blobs = list(reader.iter_blobs([1], accept=lambda h: h.frame_index % 2 == 0))
    assert [b.frame_index for b in blobs] == [0, 2, 4] and opened == [0, 2, 4]
    rejected = {(h.ct_offset, h.ct_len) for h in reader.headers([1]) if h.frame_index % 2}
    assert not rejected & set(reads)
    assert reader.skipped_level == 0


def test_rotated_master_still_opens_older_envelopes(tmp_path, master, monkeypatch):
    path, _ = _write(tmp_path, master, tracks=((1, 2),), frames=2)
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY", secrets.token_bytes(32))
    monkeypatch.setattr(crypto_utils, "_MASTER_KEY_PREV", master)
    reader = fe.EnvelopeReader(path, REC)
    assert reader.complete  # index: crypto_utils dual-key
    assert len(list(reader.iter_blobs())) == 2  # blobs: master_key_candidates()


def test_from_stored_unwraps_the_at_rest_layer(tmp_path, master):
    path, _ = _write(tmp_path, master, links={1: "f1"})
    stored = crypto_utils.encrypt_bytes(path.read_bytes(), REC)
    reader = fe.EnvelopeReader.from_stored(stored, REC, "cam/x_faces.mfe.enc")
    assert reader.complete and reader.tracks[1].face_id == "f1"
    assert fe.EnvelopeReader.from_stored(path.read_bytes(), REC, "plain.mfe").complete


def test_foreign_face_pixels_are_never_sealed(tmp_path, master):
    frame = np.full((200, 300, 3), 50, np.uint8)
    frame[40:120, 150:230] = 222  # "face" of track B
    a_inner, b_inner = (60, 40, 170, 120), (150, 40, 230, 120)
    rect, margins = fe.crop_rect(a_inner, 300, 200, 6)
    crop = fe.blank_foreign_regions(frame[rect[1]:rect[3], rect[0]:rect[2]], rect, [b_inner])
    assert frame[40:120, 150:230].min() == 222  # the frame itself is untouched
    writer = fe.EnvelopeWriter(tmp_path / "e.mfe", REC, width=300, height=200, fps=15, master=master)
    writer.add_face(frame_index=0, t_offset=0, track_id=1, chain_index=0, rect=rect, margins=margins, crop=crop)
    writer.finalize(frames=1)
    blob = next(fe.EnvelopeReader(tmp_path / "e.mfe", REC).iter_blobs())
    img = blob.decode()
    overlap = img[40 - rect[1]:120 - rect[1], 150 - rect[0]:rect[2] - rect[0]]
    assert overlap.max() < 40  # zeroed (JPEG noise only), never B's 222


def test_composite_is_opaque_inside_and_feathered_in_the_margin(tmp_path, master):
    masked = np.zeros((100, 100, 3), np.uint8)
    face = np.full((40, 40, 3), 200, np.uint8)
    blob = fe.FaceBlob(0, 0.0, 1, 0, (20, 20, 60, 60), (26, 26, 54, 54), b"")
    out = fe.composite(masked.copy(), blob, face, exclude=[(50, 50, 70, 70)])
    assert (out[26:50, 26:50] == 200).all()          # painted rect: fully restored
    assert (out[50:54, 50:54] == 0).all()            # another track's box: untouched
    assert 0 < out[20, 40, 0] < 200                  # margin: blended
    assert (out[:20] == 0).all() and (out[60:] == 0).all()  # outside the crop


@pytest.mark.skipif(not (SAMPLES / "00.jpg").exists(), reason="sample face images not present")
def test_size_budget_per_face_second_with_real_faces(tmp_path, master):
    """Measured envelope cost of a real face at the defaults (JPEG q90,
    ≤192 px): documented in ADR 0013."""
    img = cv2.imread(str(SAMPLES / "00.jpg"))
    frame = cv2.resize(img, (1280, 1280))[280:1000, :]  # 1280×720, face ≈ 420 px
    writer = fe.EnvelopeWriter(tmp_path / "s.mfe", REC, width=1280, height=720, fps=15, master=master)
    inner = (300, 60, 980, 700)
    rect, margins = fe.crop_rect(inner, 1280, 720, writer.margin)
    for i in range(15):
        shifted = np.roll(frame, i, axis=1)
        writer.add_face(frame_index=i, t_offset=i / 15, track_id=1, chain_index=0, rect=rect,
                        margins=margins, crop=shifted[rect[1]:rect[3], rect[0]:rect[2]])
    writer.finalize(frames=15)
    per_face_second = writer.bytes_written
    assert 20_000 < per_face_second < 400_000, per_face_second
    print(f"face envelope: {per_face_second} bytes per face-second at 15 fps")


def test_invalid_geometry_is_refused(tmp_path, master):
    writer = fe.EnvelopeWriter(tmp_path / "g.mfe", REC, width=64, height=64, fps=15, master=master)
    with pytest.raises(ValueError):
        writer.seal(frame_index=0, t_offset=0, track_id=1, chain_index=0, rect=(0, 0, 70000, 10),
                    margins=(0, 0, 0, 0), crop=np.zeros((10, 10, 3), np.uint8))
    with pytest.raises(ValueError):
        writer.seal(frame_index=0, t_offset=float("nan"), track_id=1, chain_index=0, rect=(0, 0, 10, 10),
                    margins=(0, 0, 0, 0), crop=np.zeros((10, 10, 3), np.uint8))
    writer.abort()
    assert fe.EnvelopeReader(tmp_path / "g.mfe", REC).blob_count == 0


def test_header_is_metadata_only(tmp_path, master):
    path, _ = _write(tmp_path, master, frames=1)
    raw = path.read_bytes()
    (length,) = struct.unpack("<H", raw[6:8])
    header = json.loads(raw[8:8 + length])
    assert header["recording_id"] == REC and header["crop"]["max_side"] == fe.DEFAULT_MAX_SIDE
    assert "face_id" not in json.dumps(header) and "tracks" not in header


# ── identity samples, painted rectangles, header ↔ index (review repair) ──
def test_identity_samples_are_sealed_per_track_and_gated_by_level(tmp_path, master, monkeypatch):
    path = tmp_path / "samples.mfe"
    writer = fe.EnvelopeWriter(path, REC, width=640, height=480, fps=15, master=master)
    for tid, chain in ((1, 0), (2, 3)):
        inner = (100 * tid, 50, 100 * tid + 60, 120)
        rect, margins = fe.crop_rect(inner, 640, 480, writer.margin)
        writer.add_face(frame_index=0, t_offset=0, track_id=tid, chain_index=chain, rect=rect, margins=margins,
                        crop=_face(tid, rect[3] - rect[1], rect[2] - rect[0]))
    e1, e2 = np.eye(512, dtype=np.float32)[0], np.eye(512, dtype=np.float32)[1]
    assert writer.add_sample(1, 0, 0, e1) and writer.add_sample(2, 3, 0, e2)
    assert writer.add_sample(2, 3, 15, e2)
    assert writer.add_sample(1, 7, 30, e1)          # wrong chain index: dropped from the index
    index = writer.finalize(frames=1)
    assert [len(t["samples"]) for t in index["tracks"]] == [1, 2]
    raw = path.read_bytes()
    assert e1.tobytes() not in raw and b"samples" not in raw   # sealed, inside the sealed index

    reader = fe.EnvelopeReader(path, REC)
    opened = reader.open_samples()
    assert [f for f, _e in opened[2]] == [0, 15]
    assert np.array_equal(opened[1][0][1], e1) and np.array_equal(opened[2][0][1], e2)
    # Level 3 opens track 2 only — track 1's sample is never decrypted.
    calls: list = []
    real = fe._open_sample
    monkeypatch.setattr(fe, "_open_sample", lambda *a: calls.append(1) or real(*a))
    assert list(fe.EnvelopeReader(path, REC).open_samples(level=3)) == [2]
    assert len(calls) == 2
    assert fe.EnvelopeReader(path, REC).open_samples(level=4) == {}


def test_an_identity_sample_moved_to_another_track_fails_authentication(tmp_path, master):
    writer = fe.EnvelopeWriter(tmp_path / "x.mfe", REC, width=640, height=480, fps=15, master=master)
    for tid in (1, 2):
        rect, margins = fe.crop_rect((100 * tid, 50, 100 * tid + 60, 120), 640, 480, writer.margin)
        writer.add_face(frame_index=0, t_offset=0, track_id=tid, chain_index=0 if tid == 1 else 1,
                        rect=rect, margins=margins, crop=_face(tid, rect[3] - rect[1], rect[2] - rect[0]))
    writer.add_sample(1, 0, 0, np.ones(512, np.float32))
    writer.finalize(frames=1)
    reader = fe.EnvelopeReader(tmp_path / "x.mfe", REC)
    t1, t2 = reader.tracks[1], reader.tracks[2]
    # Same chain key, other track id → the AAD no longer matches.
    reader.tracks[2] = fe.TrackInfo(2, t1.chain_index, None, 0, 0, 1, t1.samples)
    with pytest.raises(fe.EnvelopeIntegrityError):
        reader.open_samples([2])
    assert t2.samples == ()


def test_painted_rectangles_carry_no_pixels_and_are_kept_by_restoration(tmp_path, master):
    path = tmp_path / "p.mfe"
    writer = fe.EnvelopeWriter(path, REC, width=320, height=240, fps=15, master=master)
    rect, margins = fe.crop_rect((40, 40, 120, 140), 320, 240, writer.margin)
    writer.append([
        writer.seal(frame_index=0, t_offset=0, track_id=1, chain_index=0, rect=rect, margins=margins,
                    crop=_face(1, rect[3] - rect[1], rect[2] - rect[0])),
        writer.painted(frame_index=0, track_id=1, rect=(100, 40, 180, 140)),   # own trail
        writer.painted(frame_index=0, track_id=0, rect=(200, 40, 260, 100)),   # owned by nobody
    ])
    index = writer.finalize(frames=1)
    assert index["blob_count"] == 1 and index["painted"] == 2
    assert index["tracks"][0]["blobs"] == 1
    reader = fe.EnvelopeReader(path, REC)
    assert reader.blob_count == 1 and reader.painted_count == 2
    assert sorted(reader.rects_by_frame()[0]) == [(0, (200, 40, 260, 100)), (1, (40, 40, 120, 140)),
                                                  (1, (100, 40, 180, 140))]


def test_seal_jpeg_is_seal_without_the_encode(tmp_path, master):
    writer = fe.EnvelopeWriter(tmp_path / "j.mfe", REC, width=320, height=240, fps=15, master=master)
    rect, margins = fe.crop_rect((40, 40, 120, 140), 320, 240, writer.margin)
    crop = _face(3, rect[3] - rect[1], rect[2] - rect[0])
    jpeg = fe.encode_crop(crop)
    writer.append([
        writer.seal(frame_index=0, t_offset=0, track_id=1, chain_index=0, rect=rect, margins=margins, crop=crop),
        writer.seal_jpeg(frame_index=1, t_offset=1 / 15, track_id=1, chain_index=0, rect=rect, margins=margins,
                         jpeg=jpeg),
    ])
    writer.finalize(frames=2)
    blobs = list(fe.EnvelopeReader(tmp_path / "j.mfe", REC).iter_blobs())
    assert [b.frame_index for b in blobs] == [0, 1] and blobs[0].jpeg == blobs[1].jpeg == jpeg


@pytest.mark.parametrize("field_name,value", [("fps", 1e9), ("width", 1280), ("height", 1)])
def test_a_header_that_disagrees_with_the_sealed_index_is_refused(tmp_path, master, field_name, value):
    path, _ = _write(tmp_path, master, frames=2)
    raw = path.read_bytes()
    magic, version, flags, hlen = struct.unpack("<4sBBH", raw[:8])
    header = dict(json.loads(raw[8:8 + hlen]), **{field_name: value})
    body = json.dumps(header, separators=(",", ":")).encode()
    path.write_bytes(struct.pack("<4sBBH", magic, version, flags, len(body)) + body + raw[8 + hlen:])
    with pytest.raises(fe.EnvelopeError, match="does not match"):
        fe.EnvelopeReader(path, REC)


def test_geometry_comes_from_the_sealed_index(tmp_path, master):
    path, _ = _write(tmp_path, master, frames=1)
    reader = fe.EnvelopeReader(path, REC)
    assert (reader.frame_width, reader.frame_height, reader.fps) == (640, 480, 15.0)


# ── detection runs (FE-REGRESS-1) ─────────────────────────────────────
def _one_blob_writer(path, master, tid=1):
    writer = fe.EnvelopeWriter(path, REC, width=640, height=480, fps=15, master=master)
    rect, margins = fe.crop_rect((100, 50, 160, 120), 640, 480, writer.margin)
    writer.add_face(frame_index=0, t_offset=0, track_id=tid, chain_index=0, rect=rect, margins=margins,
                    crop=_face(1, rect[3] - rect[1], rect[2] - rect[0]))
    return writer


def test_detection_runs_are_sealed_in_the_index(tmp_path, master):
    """Consecutive fresh detections extend a run, a miss starts a new one, an
    out-of-order or repeated frame never merges runs, and the runs travel in
    the sealed index (not in plaintext)."""
    path = tmp_path / "runs.mfe"
    writer = _one_blob_writer(path, master)
    for frame in (0, 1, 2, 5, 6, 6, 3, 9):          # 6 repeated, 3 out of order: ignored
        writer.note_detections(frame, [1])
    writer.note_detections(7, [])                  # no fresh detection on 7 and 8
    writer.finalize(frames=10)
    writer.note_detections(10, [1])                # after finalize: ignored
    assert b"runs" not in path.read_bytes()
    reader = fe.EnvelopeReader(path, REC)
    assert reader.tracks[1].runs == ((0, 2), (5, 6), (9, 9))


def test_an_index_without_runs_or_a_rebuilt_one_confirms_nothing_beyond_a_sample(tmp_path, master):
    writer = _one_blob_writer(tmp_path / "old.mfe", master)
    writer.finalize(frames=1)
    assert fe.EnvelopeReader(tmp_path / "old.mfe", REC).tracks[1].runs == ()
    path, _ = _write(tmp_path, master, finalize=False)   # no index → rebuilt from headers
    assert all(info.runs is None for info in fe.EnvelopeReader(path, REC).tracks.values())


@pytest.mark.parametrize("runs", [[[5, 3]], [[0, 4], [4, 6]], [[3, 4], [0, 1]], [["0", 1]], [[0, 1, 2]], [[True, 1]]])
def test_malformed_runs_are_refused(tmp_path, master, runs):
    writer = _one_blob_writer(tmp_path / "bad.mfe", master)
    writer._runs[1] = runs                          # a writer bug; the index is authentic
    writer.finalize(frames=1)
    with pytest.raises(fe.EnvelopeError, match="malformed"):
        fe.EnvelopeReader(tmp_path / "bad.mfe", REC)
    with pytest.raises(ValueError):
        fe._parse_runs({"0": 1})
