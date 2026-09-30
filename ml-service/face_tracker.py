"""
face_tracker — face tracks for ``face_encrypted`` recordings (ADR 0013).

The FaceMasker yields the boxes it masks on each frame: its persistence
cache. A box is FRESH when a detector produced it on this frame, STALE when
the cache keeps an earlier detection alive for up to BLUR_PERSIST_FRAMES
after a miss. The tracker gives every box a track so every sealed crop of one
person is sealed with ONE hash-chain key: a track receives a ``chain_index``
at birth from the segment's ``_face_chain_index`` counter — the counter
``faces`` rows use — so chain indices stay unique per recording (ADR 0009).

Association uses FRESH detections only (a stale box is an old position, and
what stands there now may be someone else):

  * a fresh box continues a track whose own last fresh detection is at most
    ``TRACK_MAX_GAP`` frames old (RetinaFace runs every 5th frame, so a
    profile face that Haar misses still keeps its track), when the box
    overlaps the track's last box (IoU ≥ ``TRACK_IOU``) or its centre lies
    within ``TRACK_GATE`` box sides of where the track's velocity predicts
    it (a walking face moves 0.6–1.0 face widths per frame at 15 fps, which
    no IoU threshold can follow), and its size is within ``TRACK_SIZE_RATIO``;
  * candidates are assigned greedily, smallest prediction error first;
  * any other fresh box starts a new track.

A stale box belongs to the track whose fresh detection it is (the cache keeps
a detection's exact geometry); it never adopts a new detection and never
moves a track. Only one box per track and frame is sealed:

  * the track's fresh box, when it has one;
  * otherwise its last fresh position (the stale box the detector missed on
    this frame), for at most ``TRACK_MAX_GAP`` frames;
  * every other stale box — the old positions a moving face leaves behind,
    a stale box of a track that stopped being detected, a box no live track
    owns — is painted but not sealed.

Identity: once per second the pipeline's ArcFace tick detects faces with
embeddings on the tick frame. ``match_detections`` maps every track that has
a FRESH box on that frame to the detection it overlaps most
(IoU ≥ ``LINK_IOU``): that detection's embedding becomes a sealed identity
sample of the track, and its face_id (when recognition persisted or matched
one) the track's link. Tracks never sampled are "unidentified": still sealed,
not restorable by the identity-based reveal methods.

Tracking is geometry only — no embedding is computed here, so it runs in
``private`` privacy mode too (ADR 0012).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

from face_masker import iou

Box = tuple[int, int, int, int]

TRACK_IOU = 0.3
LINK_IOU = 0.3
TRACK_MAX_GAP = 5
TRACK_GATE = 1.0
TRACK_SIZE_RATIO = 1.6
# How long the tracker remembers which track produced a box: the masker keeps
# a detection for BLUR_PERSIST_FRAMES (15) frames.
STALE_HORIZON = 16


@dataclass
class Track:
    track_id: int
    chain_index: int
    box: Box                       # last FRESH box
    first_frame: int
    last_frame: int                # last frame the track sealed a box
    last_fresh_frame: int
    velocity: tuple[float, float] | None = None   # px per frame (centre)


@dataclass(frozen=True)
class Placement:
    """One masked box of a frame: its track (None = no live track owns it),
    whether a detector produced it on this frame, and whether its crop is
    sealed into the envelope (else it is only painted)."""

    track: Track | None
    box: Box
    fresh: bool
    seal: bool

    @property
    def track_id(self) -> int:
        return self.track.track_id if self.track is not None else 0


def _centre(box: Box) -> tuple[float, float]:
    return (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0


def _size(box: Box) -> tuple[int, int]:
    return max(1, box[2] - box[0]), max(1, box[3] - box[1])


class IoUTracker:
    """Fresh-detection tracker (see the module docstring).
    ``allocate_chain_index`` is called once per new track, on the caller's
    thread (the capture pipeline calls ``update`` on the event loop — the same
    thread that persists faces rows)."""

    def __init__(
        self,
        allocate_chain_index: Callable[[], int],
        *,
        iou_threshold: float = TRACK_IOU,
        max_gap: int = TRACK_MAX_GAP,
        gate: float = TRACK_GATE,
        size_ratio: float = TRACK_SIZE_RATIO,
        stale_horizon: int = STALE_HORIZON,
    ):
        self._allocate = allocate_chain_index
        self.iou_threshold = float(iou_threshold)
        self.max_gap = max(1, int(max_gap))
        self.gate = float(gate)
        self.size_ratio = max(1.0, float(size_ratio))
        self.stale_horizon = max(self.max_gap, int(stale_horizon))
        self.tracks: dict[int, Track] = {}          # every track that may still own a cached box
        self._owner: dict[Box, tuple[int, int]] = {}  # fresh geometry → (track_id, frame)
        self._next_id = 1
        self.born = 0

    @property
    def active(self) -> dict[int, Track]:
        """Tracks a fresh detection may still continue."""
        return self.tracks

    def _cost(self, track: Track, box: Box, frame_index: int) -> float | None:
        gap = max(1, frame_index - track.last_fresh_frame)
        tw, th = _size(track.box)
        bw, bh = _size(box)
        ratio = math.sqrt((bw * bh) / float(tw * th))
        if not (1.0 / self.size_ratio <= ratio <= self.size_ratio):
            return None
        side = float(max(tw, th))
        tcx, tcy = _centre(track.box)
        if track.velocity is not None:
            tcx += track.velocity[0] * gap
            tcy += track.velocity[1] * gap
        bcx, bcy = _centre(box)
        error = math.hypot(bcx - tcx, bcy - tcy) / side
        if iou(track.box, box) >= self.iou_threshold:
            return min(error, self.gate)
        return error if error <= self.gate else None

    def update(
        self, frame_index: int, boxes: Sequence[Box], fresh: Sequence[bool] | None = None,
    ) -> list[Placement]:
        """Place this frame's boxes; returns one ``Placement`` per box, in
        the order of ``boxes``. ``fresh`` defaults to all fresh."""
        boxes = [tuple(int(v) for v in b) for b in boxes]
        flags = [True] * len(boxes) if fresh is None else [bool(f) for f in fresh]
        if len(flags) != len(boxes):
            raise ValueError("fresh flags do not match the boxes")

        # Forget tracks (and box ownership) the cache can no longer refer to.
        for tid in [t for t, tr in self.tracks.items() if frame_index - tr.last_fresh_frame > self.stale_horizon]:
            del self.tracks[tid]
        self._owner = {b: (t, f) for b, (t, f) in self._owner.items()
                       if frame_index - f <= self.stale_horizon and t in self.tracks}

        # 1. Fresh detections → tracks.
        candidates = [t for t in self.tracks.values()
                      if 0 < frame_index - t.last_fresh_frame <= self.max_gap]
        fresh_idx = [i for i, f in enumerate(flags) if f]
        pairs = []
        for track in candidates:
            for i in fresh_idx:
                cost = self._cost(track, boxes[i], frame_index)
                if cost is not None:
                    pairs.append((cost, track.track_id, i))
        pairs.sort()
        owner: dict[int, Track] = {}
        taken: set[int] = set()
        for _cost, tid, i in pairs:
            if tid in taken or i in owner:
                continue
            taken.add(tid)
            owner[i] = self.tracks[tid]
        for i in fresh_idx:
            box = boxes[i]
            track = owner.get(i)
            if track is None:
                track = Track(self._next_id, int(self._allocate()), box, frame_index, frame_index, frame_index)
                self._next_id += 1
                self.born += 1
                self.tracks[track.track_id] = track
                owner[i] = track
            else:
                gap = max(1, frame_index - track.last_fresh_frame)
                ocx, ocy = _centre(track.box)
                ncx, ncy = _centre(box)
                v = ((ncx - ocx) / gap, (ncy - ocy) / gap)
                if track.velocity is not None:
                    v = (0.5 * track.velocity[0] + 0.5 * v[0], 0.5 * track.velocity[1] + 0.5 * v[1])
                track.velocity = v
                track.box = box
                track.last_fresh_frame = frame_index
            track.last_frame = frame_index
            self._owner[box] = (track.track_id, frame_index)

        # 2. Stale boxes → the track whose detection they are (never moved).
        placements: list[Placement | None] = [None] * len(boxes)
        with_fresh = {owner[i].track_id for i in fresh_idx}
        sealed_stale: set[int] = set()
        for i, box in enumerate(boxes):
            if flags[i]:
                placements[i] = Placement(owner[i], box, True, True)
                continue
            hit = self._owner.get(box)
            track = self.tracks.get(hit[0]) if hit is not None else None
            seal = (
                track is not None
                and track.track_id not in with_fresh
                and track.track_id not in sealed_stale
                and box == track.box
                and frame_index - track.last_fresh_frame <= self.max_gap
            )
            if seal:
                sealed_stale.add(track.track_id)
                track.last_frame = frame_index
            placements[i] = Placement(track, box, False, seal)
        return [p for p in placements if p is not None]


def match_detections(
    snapshot: Iterable[tuple[int, Box]],
    detection_boxes: Sequence[Box],
    *,
    iou_threshold: float = LINK_IOU,
) -> dict[int, int]:
    """``{track_id: detection_index}`` — each track of ``snapshot`` (tracks
    with a FRESH box on the tick frame, and that box) matched to the detection
    it overlaps most (IoU ≥ threshold)."""
    dets = [tuple(int(v) for v in box) for box in detection_boxes]
    out: dict[int, int] = {}
    for tid, box in snapshot:
        box = tuple(int(v) for v in box)
        best, best_iou = None, iou_threshold
        for j, dbox in enumerate(dets):
            score = iou(box, dbox)
            if score >= best_iou:
                best, best_iou = j, score
        if best is not None:
            out[int(tid)] = best
    return out


def link_tracks(
    snapshot: Iterable[tuple[int, Box]],
    detections: Iterable[tuple[Box, str | None]],
    *,
    iou_threshold: float = LINK_IOU,
) -> dict[int, str]:
    """``{track_id: face_id}`` — each track of ``snapshot`` linked to the
    detection it overlaps most (IoU ≥ threshold) among those that carry a
    face_id."""
    dets = [(tuple(int(v) for v in box), fid) for box, fid in detections if fid]
    matched = match_detections(snapshot, [box for box, _fid in dets], iou_threshold=iou_threshold)
    return {tid: dets[j][1] for tid, j in matched.items()}
