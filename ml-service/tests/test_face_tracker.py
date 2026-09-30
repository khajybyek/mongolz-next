"""Face tracker (fresh-detection association, stale ownership) + identity
matching + cipher visual (ADR 0013)."""
from __future__ import annotations

import secrets
from pathlib import Path

import cv2
import numpy as np
import pytest

from cipher_mask import CipherPalette, cell_size, cipher_block, paint_cipher, visual_key
from face_masker import FaceMasker
from face_tracker import IoUTracker, link_tracks, match_detections
from hierarchical_keys import key_at_index

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
REC = "5f1e2d3c-4b5a-4968-8778-695a4b3c2d1e"


class Counter:
    """Stands in for RecordingSession._face_chain_index (shared with faces rows)."""

    def __init__(self):
        self.value = 0

    def __call__(self):
        index, self.value = self.value, self.value + 1
        return index


class ScriptedMasker(FaceMasker):
    """The real persistence cache + merge rules of the capture pipeline, with
    scripted detections instead of Haar / RetinaFace."""

    def __init__(self, script):
        super().__init__(None, persist_frames=15, pad_ratio=0.30)
        self.script = script

    def _detect_haar(self, frame):
        return [(tuple(b), "standard") for b in self.script(self.frame_idx - 1)]

    def _detect_insight(self, frame):
        return []


def _run(script, frames):
    """Drive masker + tracker like _emit_face_encrypted; returns per frame the
    placements."""
    masker, tracker = ScriptedMasker(script), IoUTracker(Counter())
    out = []
    for f in range(frames):
        cached = masker.step(None)
        out.append(tracker.update(f, [b for b, _t, _r in cached], [t >= 15 for _b, t, _r in cached]))
    return tracker, out


def _box(x, y=100, side=60):
    return (int(x), int(y), int(x) + side, int(y) + side)


def test_boxes_follow_their_tracks_and_new_faces_get_new_chain_indices():
    chain = Counter()
    tracker = IoUTracker(chain)
    a = tracker.update(0, [(10, 10, 60, 60), (200, 10, 250, 60)])
    assert [(p.track.track_id, p.track.chain_index) for p in a] == [(1, 0), (2, 1)]
    assert all(p.fresh and p.seal for p in a)
    # Both moved a little; order swapped in the input.
    b = tracker.update(1, [(205, 12, 255, 62), (14, 11, 64, 61)])
    assert [p.track_id for p in b] == [2, 1]
    # A faces row persisted meanwhile consumes the shared counter …
    assert chain() == 2
    # … so a newcomer never reuses an index.
    c = tracker.update(2, [(14, 11, 64, 61), (205, 12, 255, 62), (400, 300, 460, 360)])
    assert [(p.track.track_id, p.track.chain_index) for p in c] == [(1, 0), (2, 1), (3, 3)]
    assert tracker.tracks[1].first_frame == 0 and tracker.tracks[1].last_frame == 2


def test_greedy_assignment_prefers_the_best_prediction():
    tracker = IoUTracker(Counter())
    tracker.update(0, [(0, 0, 100, 100), (60, 0, 160, 100)])
    out = tracker.update(1, [(58, 0, 158, 100)])
    assert out[0].track_id == 2  # 2 px from track 2, 58 px from track 1


def test_a_track_is_not_continued_after_the_gap():
    chain = Counter()
    tracker = IoUTracker(chain, max_gap=5)
    tracker.update(0, [(0, 0, 50, 50)])
    (p,) = tracker.update(5, [(0, 0, 50, 50)])     # 5 frames later: same track
    assert p.track_id == 1
    (p,) = tracker.update(11, [(0, 0, 50, 50)])    # 6 frames later: a new track, a new key
    assert p.track_id == 2 and p.track.chain_index == 1


def test_a_walking_face_keeps_one_track():
    # 0.6 and 1.0 face widths per frame (a lateral walk at 15 fps): no IoU
    # threshold follows that, the velocity prediction does.
    for step in (36, 60):
        tracker, frames = _run(lambda f, step=step: [_box(10 + step * f)], 12 if step == 60 else 20)
        assert tracker.born == 1, step
        for placements in frames:
            sealed = [p for p in placements if p.seal]
            assert len(sealed) == 1 and sealed[0].fresh and sealed[0].track_id == 1, step
            # The old positions (stale cache boxes) are painted, not sealed.
            assert all(p.track_id == 1 and not p.seal for p in placements if not p.fresh), step


def test_detections_every_fifth_frame_keep_one_track_and_seal_the_last_position():
    # A profile face only RetinaFace sees (every 5th frame), moving slowly.
    tracker, frames = _run(lambda f: [_box(10 + 10 * f, side=100)] if f % 5 == 0 else [], 30)
    assert tracker.born == 1
    for f, placements in enumerate(frames):
        sealed = [p for p in placements if p.seal]
        assert len(sealed) == 1 and sealed[0].track_id == 1, f
        # Between detections the last detected position is sealed (the face
        # the detector missed is still there).
        assert sealed[0].fresh is (f % 5 == 0), f


def test_a_second_person_on_the_same_path_never_joins_the_first_track():
    """FE-CAP-1: Y walks X's path 10 frames behind (single file through a
    door). Stale boxes of X lie on Y's path; they never adopt Y and no track
    ever seals a box of both people."""
    def script(f):
        boxes = [_box(10 + 36 * f)]
        if f >= 10:
            boxes.append(_box(10 + 36 * (f - 10)))
        return boxes

    tracker, frames = _run(script, 25)
    owner: dict[int, set[str]] = {}
    for f, placements in enumerate(frames):
        for p in placements:
            if not p.seal:
                continue
            x = p.box[0]
            who = "X" if x == 10 + 36 * f else ("Y" if f >= 10 and x == 10 + 36 * (f - 10) else "?")
            owner.setdefault(p.track_id, set()).add(who)
    assert all(len(people) == 1 and "?" not in people for people in owner.values()), owner
    assert {next(iter(v)) for v in owner.values()} == {"X", "Y"}


def test_a_handover_at_the_same_spot_starts_a_new_track():
    """X stands at P and turns away (no detection from frame 30); Y steps into
    P at frame 36, inside the masker's 15-frame persistence window."""
    P = _box(200, side=80)

    def script(f):
        if f < 30:
            return [P]
        if f >= 36:
            return [P]
        return []

    tracker, frames = _run(script, 50)
    x_track = frames[29][0].track_id
    y_tracks = {p.track_id for f in range(36, 50) for p in frames[f] if p.fresh}
    assert x_track not in y_tracks and len(y_tracks) == 1
    # X's last position is sealed for at most TRACK_MAX_GAP frames after its
    # last detection, never beyond — and never once Y is there.
    sealed_x = [f for f in range(30, 50) for p in frames[f] if p.seal and p.track_id == x_track]
    assert sealed_x == list(range(30, 35))


def test_stale_boxes_without_a_live_owner_are_painted_only():
    tracker = IoUTracker(Counter())
    # A stale box the tracker never saw fresh (left over from the previous
    # segment's masker cache).
    (p,) = tracker.update(0, [(10, 10, 60, 60)], [False])
    assert p.track is None and p.track_id == 0 and not p.seal and not p.fresh
    assert tracker.born == 0


def test_match_detections_and_link_tracks_use_the_best_overlap():
    snapshot = [(1, (10, 10, 60, 60)), (2, (200, 10, 250, 60)), (3, (400, 400, 420, 420))]
    assert match_detections(snapshot, [(12, 12, 58, 62), (198, 8, 248, 58), (0, 0, 30, 30)]) == {1: 0, 2: 1}
    detections = [((12, 12, 58, 62), "face-a"), ((198, 8, 248, 58), "face-b"), ((0, 0, 30, 30), None)]
    assert link_tracks(snapshot, detections) == {1: "face-a", 2: "face-b"}
    # Below the IoU threshold → unidentified.
    assert link_tracks([(1, (10, 10, 60, 60))], [((50, 50, 100, 100), "x")]) == {}


def test_cipher_pattern_depends_on_nothing_but_key_track_and_geometry():
    palette = CipherPalette(visual_key(REC, secrets.token_bytes(32)))
    face_a = np.random.RandomState(1).randint(0, 255, (120, 160, 3), dtype=np.uint8)
    face_b = np.full((120, 160, 3), 17, np.uint8)
    rect = (20, 10, 110, 100)
    paint_cipher(face_a, rect, palette, 5)
    paint_cipher(face_b, rect, palette, 5)
    assert np.array_equal(face_a[10:100, 20:110], face_b[10:100, 20:110])
    other = np.zeros_like(face_b)
    paint_cipher(other, rect, palette, 6)
    assert not np.array_equal(other[11:99, 21:109], face_b[11:99, 21:109])  # per-track keystream


def test_cipher_cells_are_flat_blocks_with_a_one_pixel_outline():
    palette = CipherPalette(bytes(32))
    frame = np.zeros((200, 200, 3), np.uint8)
    paint_cipher(frame, (40, 40, 140, 140), palette, 1)
    cell = cell_size(100, 100)
    assert 8 <= cell <= 12
    inner = frame[41:139, 41:139]
    block = cipher_block(palette, 1, 100, 100)
    assert np.array_equal(inner, block[1:99, 1:99])
    assert (frame[40, 40:140] == (200, 200, 200)).all()          # outline
    assert len(np.unique(block[:cell, :cell].reshape(-1, 3), axis=0)) == 1  # one colour per cell


def test_pattern_is_stable_while_the_box_moves_and_grows():
    palette = CipherPalette(bytes(range(32)))
    small = cipher_block(palette, 3, 90, 90)
    large = cipher_block(palette, 3, 95, 94)  # same cell size, one more partial cell
    assert np.array_equal(small[:88, :88], large[:88, :88])


def test_visual_key_is_not_a_face_key():
    master = secrets.token_bytes(32)
    vk = visual_key(REC, master)
    assert vk not in {key_at_index(REC, i, master) for i in range(8)}
    assert vk != visual_key("0a1b2c3d-4e5f-4061-8272-839405162738", master)


@pytest.mark.skipif(not (SAMPLES / "01.jpg").exists(), reason="sample face images not present")
def test_cipher_region_is_uncorrelated_with_the_real_face():
    # A fixed key keeps the test deterministic: with a random key one
    # ~600-cell pattern has |r| >= 0.1 in about 1 run of 130 (sampling noise
    # of the keystream, not information about the face).
    img = cv2.resize(cv2.imread(str(SAMPLES / "01.jpg")), (512, 512))
    rect = (70, 90, 370, 370)
    palette = CipherPalette(visual_key(REC, bytes(range(32))))
    face = cv2.cvtColor(img[rect[1] + 1:rect[3] - 1, rect[0] + 1:rect[2] - 1], cv2.COLOR_BGR2GRAY).astype(float)
    rs = []
    for track in range(1, 21):
        painted = img.copy()
        paint_cipher(painted, rect, palette, track)
        mask = cv2.cvtColor(painted[rect[1] + 1:rect[3] - 1, rect[0] + 1:rect[2] - 1], cv2.COLOR_BGR2GRAY).astype(float)
        rs.append(np.corrcoef(face.ravel(), mask.ravel())[0, 1])
    assert abs(float(np.mean(rs))) < 0.03, rs
    assert max(abs(r) for r in rs) < 0.2, rs


def test_cipher_region_is_uncorrelated_with_synthetic_faces():
    rng = np.random.RandomState(7)
    # Fixed key: with a random one the mean of 20 small patterns crosses
    # 0.05 in about 1 run of 100 (keystream sampling noise).
    palette = CipherPalette(visual_key(REC, bytes(range(32))))
    rs = []
    for track in range(1, 21):
        yy, xx = np.mgrid[0:120, 0:100]
        face = (128 + 90 * np.sin(xx / (5 + track)) * np.cos(yy / 9)).astype(np.uint8)
        face = np.dstack([face] * 3) + rng.randint(0, 20, (120, 100, 3)).astype(np.uint8)
        painted = face.copy()
        paint_cipher(painted, (0, 0, 100, 120), palette, track)
        rs.append(np.corrcoef(face[1:-1, 1:-1].mean(axis=2).ravel(), painted[1:-1, 1:-1].mean(axis=2).ravel())[0, 1])
    assert abs(float(np.mean(rs))) < 0.05
