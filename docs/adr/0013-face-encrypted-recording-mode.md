# 0013 — Optional face-encrypted recording mode (per-face encryption at capture)

> **Withdrawn — 2026-10-01, owner decision. Never deployed to a camera.**
> The owner rejected the result: the keyed cipher pattern over faces looked
> wrong in playback, and the mode depended entirely on the face detector (a
> missed face stayed visible, with no original to re-mask later). The code was
> removed (ML, web, docs) and
> `supabase/migrations/20261001100000_remove_face_encrypted_mode.sql` drops
> `cameras.recording_mode` and `recordings.face_envelope_path` and restores
> `recordings.blur_strategy` to `baked | on_demand`. Production held no
> `face_encrypted` recording and its only camera was `standard`, so nothing
> stored depended on it. Recording works exactly as ADR 0002 and ADR 0010
> describe. Kept from this work: no user-token INSERT on `recordings` (the
> `authenticated` INSERT grant and the unused "recordings: admin insert"
> policy stay removed). The text below is the original decision, kept as a
> record; it no longer describes the system.

* **Status:** Withdrawn (2026-10-01, owner decision — never deployed to a
  camera). Was: Accepted (2026-09-30), opt-in per camera
* **Date:** 2026-09-30
* **Relates to:** [0002](0002-per-recording-hkdf-aes-gcm.md) (the per-recording
  key still encrypts the stored video), [0003](0003-four-eyes-reveal-approval.md)
  (4-eyes stays the only way to restore a face),
  [0006](0006-step-up-totp-reauth.md) (TOTP step-up to switch back to
  `standard`), [0009](0009-hierarchical-per-face-keys.md) (each face track is
  sealed with the hash-chain key `K_i`), [0010](0010-on-demand-blurred-view.md)
  (unchanged for `standard` cameras), [0012](0012-privacy-schedules-tightening-only.md)
  (frames captured in `private` mode get no envelope at all)
* **Supersedes:** nothing. `standard` mode stays exactly as ADR 0002 and ADR 0010
  describe it

## Context

The capstone's title is «다중 권한 마스킹 및 복원이 가능한 지능형 네트워크
카메라 및 통합관제 서버»: an intelligent network camera and control server
that can mask faces and restore them under multiple levels of authority.

Before this ADR every new recording was stored the same way (ADR 0002,
ADR 0010; legacy `baked` rows aside):

* one **encrypted raw original** (`*_original.mp4.enc`, AES-256-GCM under the
  per-recording HKDF key), and
* a masked view rendered from it **on demand** (Haar + InsightFace + cubist
  mosaic), cached on the ML container's disk.

A reveal (ADR 0003) decrypts that whole original, runs detection and ArcFace
on every frame, keeps the target's face and masks everyone else again. Two
properties follow, and both are weak points for a system whose claim is
"restoration per person":

1. **A reveal decrypts every face in the clip.** The whole frame, bystanders
   included, is plaintext inside the ML process while the job runs. Whether a
   bystander stays hidden in the output depends on the reveal job's own
   detector finding them again. A face that detector misses is written
   unmasked into the reveal output.
2. **Graded authority is applied to crops, not to video.** ADR 0009's hash
   chain seals each identified face's crop and embedding with `K_i`, and
   `reveal_level` gates which of those a caller may open. The raw video is
   still one ciphertext under one key, so every reveal decrypts every face in
   it; `reveal_level` only decides which faces the job *keeps* in its output,
   not which faces it decrypts.

On 2026-09-30 the owner asked to keep everything as it is and **add** a
storage mode: while recording, each face is not only masked but encrypted, so
that it can later be restored one person at a time, under the existing
authority levels.

**Face swapping was considered and rejected.** Replacing each face with a
generated one needs a GAN or diffusion model that the Railway CPU cannot run
at capture frame rates, and a swap on its own is not reversible: something
still has to keep the real face. The mode below keeps the real face, sealed,
and puts an unmistakable "encrypted" pattern in the video instead.

## Decision

**A per-camera recording mode, `cameras.recording_mode`, with two values.**

| Mode | What is stored | Masked playback view | Restoration (reveal) |
|---|---|---|---|
| `standard` (default, unchanged) | the encrypted raw original (`*_original.mp4.enc`, ADR 0002); legacy `baked` rows keep their stored masked MP4 | rendered on demand from the original (ADR 0010) | decrypts the original, masks non-targets with the detector (today's job) |
| `face_encrypted` (new, opt-in) | **no raw original at all.** An encrypted **masked** video in which every detected face region is replaced by a keyed cipher pattern, plus a per-segment **face envelope**: every face region of every frame, sealed on its own | the stored masked video, decrypted and streamed; no re-render, no detector, no embedding | decrypts **only** the selected person's face blobs and composites them onto the masked video; everyone else stays cipher |

Everything else is unchanged in both modes: the live HLS feed is masked as
today (cubist mosaic), recognition runs as today (once-per-second ArcFace,
sealed face crop and `faces` row, suspect matching, alerts), and privacy
schedules (ADR 0012), privacy zones, 4-eyes reveal (ADR 0003) and the audit
log behave as today.

```
                 capture (face_encrypted camera)
                 ───────────────────────────────
   frame ──▶ FaceMasker boxes (Haar + RetinaFace + 15-frame persistence;
               │            each box fresh = detected now, or stale = kept alive)
               │
               ├─▶ tracker ──▶ track_id, chain_index (born from the segment's
               │               _face_chain_index counter; fresh detections
               │               only; a stale box stays with the track that
               │               detected it)
               │
               ├─▶ one region per track ──▶ JPEG q≈90, max side ≈192 px
               │                   ──▶ AES-256-GCM under K_{chain_index}
               │                       AAD = recording_id ‖ track_id ‖ frame_index ‖ …
               │                   ──▶ face envelope (append-only, per segment)
               │
               ├─▶ once per second (recognition tick): ArcFace embedding of
               │   each track with a fresh box ──▶ identity sample sealed
               │   under that track's K_{chain_index} (sealed index)
               │
               └─▶ every masked box replaced by keyed cipher cells + 1 px outline
                                   ──▶ masked video ──▶ AES-256-GCM under the
                                                        per-recording key (ADR 0002)

   recordings row: blur_strategy = 'face_encrypted'
                   storage_path        → encrypted masked video
                   face_envelope_path  → sealed envelope     (both in `recordings`)
                   original_path       = NULL
```

### Tracks and keys

* The `FaceMasker` produces the boxes that get masked on each frame. A box is
  **fresh** when a detector found it on this frame and **stale** when the
  masker keeps an earlier detection alive for up to `BLUR_PERSIST_FRAMES` (15)
  frames after a miss (the cache keeps that detection's exact geometry). The
  tracker (`face_tracker.py`) gives every box a **track**:
  * only **fresh** detections are associated: a fresh box continues a track
    whose own last fresh detection is at most `TRACK_MAX_GAP` (5) frames old —
    RetinaFace runs every 5th frame, so a profile face Haar misses keeps its
    track — when it overlaps that track's last box (IoU ≥ 0.3) or its centre
    lies within one box side of where the track's velocity predicts it (a face
    walking across the view moves 0.6–1.0 face widths per frame at 15 fps, far
    beyond any IoU threshold), and its size is within 1.6×; candidates are
    assigned greedily, best prediction first; any other fresh box starts a new
    track;
  * a **stale** box belongs to the track that detected it, never adopts a new
    detection and never moves a track. What stands at a stale box's position
    now may be someone else, so a stale box is sealed only as its track's last
    detected position, only while that track has no fresh box in the frame,
    and only for `TRACK_MAX_GAP` frames after its last detection (the frames
    the detector missed a face that is still there). Every other stale box —
    the old positions a moving face leaves behind, a stale box of a track that
    stopped being detected, a box no live track owns — is painted with the
    cipher pattern and recorded as a pixel-free **painted rectangle**, but not
    sealed. So each track seals at most one region per frame.
* A new track takes a **chain index at birth** from the segment's existing
  `_face_chain_index` counter, the same counter `faces` rows use, so chain
  indices stay unique within a recording. Every blob of that track is sealed
  with `K_{track.chain_index}` =
  `hierarchical_keys.key_at_index(recording_id, chain_index, master)`.
* ADR 0009 semantics hold per **track**: a reveal at `reveal_level` L may
  unseal only tracks with `chain_index ≥ L`. As in ADR 0009, "higher rank"
  means "detected earlier in the recording". A track is born when its face is
  first boxed, before the recognition tick persists that person's `faces`
  row, so a person's first track has a lower index than their `faces` row and
  a later track of the same person (after a break in detection) a higher one
  (see Limits).
* **Identity samples.** On the once-per-second recognition tick the ArcFace
  pass (`detect_all`) runs on the tick frame. Every track with a **fresh** box
  on that frame that overlaps a detection (IoU ≥ 0.3) gets that detection's
  embedding as an **identity sample**, sealed with AES-256-GCM under the
  track's own `K_{chain_index}` (AAD = recording, track, chain index, frame)
  and stored in the sealed index. The sample is written whether or not the
  detection's `faces` row could be persisted (a DB or Storage outage loses the
  row, not the identity). The tick frame always gets a RetinaFace pass, so a
  profile face can be sampled too. A track never sampled is **unidentified**:
  it is sealed like every other track, but no reveal method can select it
  (see Limits).
* **`face_id` link.** The same tick links a sampled track to the detection's
  `face_id` when recognition persisted that row from this detection or
  matched an earlier face-memory entry at the alert threshold (0.45). A weaker
  face-memory match (the 0.35 dedup threshold) makes no link: a bystander who
  merely resembles someone seen earlier is not recorded under that person's
  `face_id`. The link is kept in the sealed index as metadata; a reveal selects
  tracks by their samples, never by the link.

### Face envelope (`ml-service/face_envelope.py`)

A pure, unit-tested module with its own binary format:

* **Append-only**, written during capture and finalised at segment end. A
  truncated or garbled tail is ignored on read; every complete record before
  it stays readable (the reveal job still refuses an envelope whose index is
  missing, see Limits).
* Magic `MFE1` and a version byte, then one record per sealed face region per
  frame: `frame_index`, `t_offset`, `track_id`, `chain_index`, the crop box
  (`x, y, w, h`), four feather margins (the crop is the painted box grown by
  6 px, so a restoration can blend its edge over identical pixels), a 12-byte
  nonce, the ciphertext length and the ciphertext. Pixels inside the painted
  box of any OTHER track (or of a box no live track owns) in the same frame are
  zeroed before sealing, so unsealing X's blob never yields a pixel of anyone
  else's face box; the painted boxes of X's own old positions are X's trail and
  are not zeroed.
* A second, pixel-free record type names a **painted rectangle without a
  blob** (`frame_index`, `track_id` or 0, box): a restoration keeps the cipher
  pattern there unless the rectangle is the restored track's own.
* **Per-blob AEAD.** Each crop is sealed with AES-256-GCM under its track's
  `K_i`. The associated data binds `recording_id` and every header field
  (`frame_index`, `t_offset`, `track_id`, `chain_index`, box, margins), so a
  blob moved to another recording, track, frame, key or position fails
  authentication.
* **Sealed index.** At finalize a JSON index (track → `chain_index`, `face_id`
  or null, first and last frame, identity samples, detection runs) is
  appended, sealed with
  the index key of the per-recording key family (`crypto_utils`, context
  `face-envelope-index:<recording_id>`), so the links and samples are not
  plaintext metadata. The index also carries the frame size and fps; the
  reader refuses an envelope whose plaintext file header disagrees with them,
  so every decision a reveal takes from geometry or time (window, protected
  stretch, `never_reveal` zone) uses authenticated values.
* **Streaming reader.** `EnvelopeReader.iter_blobs(tracks, level=…,
  masters=…, accept=…)` walks the file record by record and **never decrypts a
  blob of a track that was not requested**, nor a blob below the caller's
  `reveal_level` or one the `accept` header predicate rejects (outside the
  window, in a protected span or a `never_reveal` zone); the tests spy on the
  decryptor to prove it. Without the sealed index (the object was cut short)
  the reader rebuilds the track table from the record headers with no
  `face_id` links and no samples, and reports the envelope as incomplete.
* **Size cap.** An envelope is delivered as one Storage object, so the capture
  loop starts a new segment once the envelope reaches
  `FACE_ENVELOPE_MAX_BYTES` (40 MiB by default; Supabase's default global
  upload limit is 50 MB).

### The cipher pattern in the stored video

Each masked face box is filled with coarse cells of 8–12 px whose colours come
from a SHAKE-256 keyed PRF (not an encryption mode) keyed per recording and track. The colours
do not depend on the face pixels, so the pattern carries no information about
the face (a test checks that its correlation with the original crop is about
zero). Flat cells compress well, unlike per-pixel noise. A 1 px outline shows
the viewer that a face was there. The same `FaceMasker` detections decide where
the pattern goes, with the same persistence as the cubist mask.

The live HLS feed keeps the cubist mosaic; only the stored video carries the
cipher pattern.

### Privacy schedules (ADR 0012)

In `private` time faces are masked with the same cipher pattern, but **no
envelope blob is written** for frames captured in `private` mode. Those faces
cannot be restored by anyone, by design. `fail_closed` behaves as in ADR 0012:
it counts as `private`. The capture-time spans are recorded and delivered as
today.

A privacy tick judges the frames since the previous tick (the span ledger
opens a private span at the previous tick), so the blobs of those frames are
held until the next tick and written only when it is standard. At the end of a
segment (rotation or stop) the frames after the last tick get one **closing
check** over every instant they can have been captured at: standard → written;
private → dropped, and a span covers the segment's tail.

### Delivery, crash safety, retention

* The encrypted masked video and the envelope are the segment's two artifacts.
  They go through the existing capture journal, spool and delivery exactly
  like the original does in `standard` mode, in the same `recordings` bucket.
  The row becomes `ready` only after **both** are uploaded. Spool manifests
  written before this ADR (no envelope) still deliver. Privacy spans still
  travel with the segment.
* Capture validation (`validate_capture`) validates the masked video, which
  is the only video of the segment.
* **Behind real time** (a live network source the CPU cannot keep up with),
  the capture loop repeats the previous stored — masked — frame for that slot
  instead of detecting on a new one, exactly as the live stream does in
  `standard` mode, and seals the previous frame's crops again under the held
  frame's index. No unmasked pixel is ever written; the footage of the held
  slots is lost (there is no original to fall back on). `live_lag_sec` and
  `held_frames` are reported per camera by `GET /camera/active`.
* Retention, legal hold, GDPR deletion and the backup manifest handle the
  `face_envelope_path` object wherever they handle `original_path` today.

### Restoration (`reveal_job.py`) for `face_encrypted` recordings

* Unchanged: 4-eyes gating, the lease, status checks, privacy zones, the
  protected timeline (spans ∪ current schedule, 60 s pad; ADR 0012).
* **Target selection needs no new detection and no `faces` row.** The
  existing methods (uploaded photo, suspect, detected faces) give the target
  embeddings with the existing sealed/plain handling and `reveal_level`
  rules. The job then unseals the **identity samples** of every track the
  requester's level reaches (embeddings, never face pixels — the standard path
  likewise compares every face of the clip) and selects the tracks with a
  sample that matches a target at the job threshold (default 0.45), the same
  decision the standard path takes per frame. A track's blob at frame `f` is
  restored only when the samples of that track nearest before and after `f`
  both match: a track that sampled two people is restored only between
  samples of the target. Before a track's first or after its last sample, the
  one sample on that side vouches for `f` only when the tracker detected the
  track on every frame between them — one unbroken **detection run**, recorded
  at capture in every privacy mode and kept in the sealed index. A missed
  detection is where the geometric tracker can hand a track from one person
  to another (one leaves, another steps into the same place within
  `TRACK_MAX_GAP` frames), and nothing across it was compared with the target,
  so no sample confirms a frame on the other side of a miss.
* Selected tracks allowed by `reveal_level` → decrypt only their confirmed
  blobs → decode → resize to the recorded box → composite onto the decrypted
  masked video with a feathered edge (the painted boxes of other tracks keep
  their cipher pattern) → encode → the existing reveal-output path: a
  **plaintext** MP4 in the private `revealed` bucket, served only through the
  audited download gateway and removed by the retention sweep, as in
  `standard` mode.
* Blobs outside the requested time window, inside a `never_reveal` privacy
  zone or in a protected (private) stretch are skipped before decryption. If
  no allowed blob remains the job fails with the stable code
  `[face_envelope_empty]` (same style as the `[privacy_*]` codes). Two more
  stable codes cover the envelope itself: `[face_envelope_unavailable]` (the
  envelope or the masked video could not be downloaded; a retry may succeed)
  and `[face_envelope_invalid]` (the stored object fails its at-rest
  authentication — it is one AES-GCM ciphertext, so any changed or missing
  byte, or a master key that is no longer configured — or the plaintext header
  disagrees with the sealed index, the index is missing, a blob or identity
  sample fails authentication, or the geometry does not match the video;
  nothing is published). The web maps all three to mn/en/kr copy; none of
  them is a privacy-policy withholding.
* The job log records how many tracks had samples within the level, how many
  matched, how many sampled tracks lay beyond the level, how many blobs it
  unsealed, and how many were withheld as unconfirmed, by window, privacy mode
  and zone.

### Playback view (`GET /recording/{id}/view`)

For a `face_encrypted` recording the endpoint decrypts the stored masked video
and streams it under the existing cache rules. It runs no detector and computes
no embedding.

### Camera setting (web)

* The `/cameras` edit dialog has a **Recording mode** choice (Standard /
  Face-encrypted) with a short mn/en/kr explanation of the trade-off; the
  camera list shows a badge for face-encrypted cameras.
* **`standard` → `face_encrypted` is tightening** (less is stored: no raw
  original): one click, audited.
* **`face_encrypted` → `standard` is loosening** (raw originals are stored
  again): fresh TOTP step-up (ADR 0006), an audit row, and a security
  notification to the other admins. Writes go through the service role;
  `authenticated` cannot write `cameras` directly.
* The mode applies to **new segments**. The ML service reads it through a
  cached camera read (`recording_mode.RecordingModeCache`, a sibling of the
  privacy-schedule cache with its own query, 30 s TTL), warmed while the
  source opens. The capture loop peeks at it once per second and a changed
  mode rotates the running segment, so a change reaches running cameras within
  about 30 s; an unreadable read keeps the last known mode; a camera whose mode
  has **never** been read (the read failed, or was still pending when a
  segment started — typically right after an ML restart with a slow or
  unreachable database) records `face_encrypted`, the stricter mode, and
  rotates to `standard` once a read says so (fail closed, like ADR 0012): the
  capture loop notices a successful read within about a second, and a failed
  read is retried every 5 s, so one failed read costs at least about 5 s of
  face-encrypted footage. A database without the column (ML deployed before
  the migration) means `standard` — once that answer arrives (see
  Deployment).
  Audit actions: `CAMERA_RECORDING_MODE_CHANGE` (every applied change, with
  `[tighten|loosen]` in the detail) and `CAMERA_RECORDING_MODE_STEP_UP_REQUIRED`
  (a loosening refused for lack of a fresh TOTP step-up).
* The playback page shows a notice on face-encrypted recordings ("each face is
  stored encrypted and only the selected person is decrypted on an approved
  reveal"). The reveal modal is unchanged apart from that notice.

### Database (`supabase/migrations/20260930100000_face_encrypted_recordings.sql`)

* `cameras.recording_mode text not null default 'standard'`, limited to
  `standard` or `face_encrypted`. Every existing camera becomes `standard`.
* `recordings.blur_strategy` accepts `face_encrypted` next to `baked` and
  `on_demand`.
* `recordings.face_envelope_path text`: NULL unless the row is
  `face_encrypted`; a `ready` face-encrypted row must name its envelope, never
  names an `original_path`, and its envelope is never its `storage_path`.
  `has_original` is `true` on a delivered face-encrypted row (it means "a
  restorable encrypted source exists"; the source is the masked video plus
  the envelope, not a raw original).
* The retention trigger (`enqueue_retention_storage_deletion`) queues the
  envelope object with the row's other objects; legal holds block it like
  the rest. An object that another `recordings` row still names is not
  queued, so deleting one row can never delete a surviving (for example held)
  row's objects. That lookup probes `storage_path`, `original_path` and
  `face_envelope_path` of every other row for each deleted row, so the three
  columns are indexed (`recordings_*_path_idx`, partial on the two nullable
  ones): without them one day's sweep over a month of 120 s segments on four
  cameras (2 880 of 89 280 rows) took 44–79 s instead of about 0.12 s in two
  local benchmarks, against the retention cron's 60 s budget.
* Writes stay service-role only (`cameras` already is; `authenticated` has
  had no UPDATE on `recordings` since `20260928100000`). The migration also
  revokes `authenticated`'s leftover INSERT on `recordings` and drops the unused
  "recordings: admin insert" policy: a stolen verified admin session could
  otherwise insert a decoy row naming a held recording's envelope and let
  retention delete it (a gap that predates this ADR and already reached
  `storage_path` and `original_path`).
* Deploy order in the header: migration → ML → web.

## Consequences

### Gains

* **No raw original exists for a face-encrypted camera.** A leaked storage
  object, a leaked per-recording key, or the playback path yields at most the
  masked video and the envelope's record headers, never a face: the blobs and
  identity samples are sealed under the hash-chain keys, which are derived from
  the master key with their own salt (ADR 0009), not from the per-recording
  key, and the index is sealed under its own key. Unmasked face pixels exist
  only inside per-track sealed blobs, in the sealed crop of each identified
  face (as in every mode) and, after an approved reveal, in that reveal's
  output: a plaintext restored MP4 in the private `revealed` bucket until the
  retention sweep removes it (as in `standard` mode).
* **Restoration decrypts only the selected person.** The reveal job unseals
  the blobs of the tracks whose own identity samples match the target, and no
  others (it reads every track's samples within the level to find them —
  embeddings, not pixels). Bystanders stay cipher in the output because the
  base video never contained their faces, not because a second detector pass
  found them again. The reveal-time detector miss described in the Context
  cannot happen in this mode; the tracker's own limits (Limits, "Tracking is
  geometric") remain.
* **Graded authority reaches the video.** `reveal_level` now bounds which
  face tracks' frames a reveal can decrypt at all, not only which crops it can
  open. It is applied per track (a track's rank is when it was first boxed),
  not per person — see Limits.
* **Cheaper playback.** The view is a decrypt-and-stream; nothing is rendered
  on a cold cache.

### Costs

* **Storage grows with face-seconds.** Every visible face adds one sealed blob
  per frame. The sealed crop is the rectangle the pipeline paints — the
  detector box padded by 30 % on each side (`BLUR_PAD_RATIO`) — plus 6 px
  feather margins, so its side is about 1.6 × the detector box + 12 px, capped
  at 192 px. Re-measured on 2026-09-30 with the defaults (JPEG quality 90,
  OpenCV 4.13) on the three bundled sample faces
  (`ml-service/samples/0{0,1,2}.jpg`) resized to each box size, 15 shifted
  frames each, sealed with the real `EnvelopeWriter` (61 B of record overhead
  per blob: 1 B record type, 28 B authenticated header, 12 B nonce, 4 B length,
  16 B GCM tag). The padding holds background, so the cost depends on it: the
  low figure is a flat background, the high figure a busy one (the sample's
  own texture mirrored outwards):

  | Detector box | Sealed crop | Bytes per blob (flat – busy) | Per face-second at 15 fps | at 25 fps |
  |---|---|---|---|---|
  | 64 px | 114 px | ≈ 2 500–7 200 | ≈ 44–91 KiB | ≈ 73–152 KiB |
  | 96 px | 164 px | ≈ 4 100–12 500 | ≈ 72–152 KiB | ≈ 120–254 KiB |
  | 128 px | 216 → 192 px | ≈ 5 000–13 800 | ≈ 84–169 KiB | ≈ 140–282 KiB |
  | ≥ 192 px | capped at 192 px | ≈ 5 200–15 000 | ≈ 90–182 KiB | ≈ 149–303 KiB |

  On top of that: one identity sample per sampled track per recognition tick
  (≈ 2.7 KiB per face-second, in the sealed index) and 21 B per painted
  rectangle without a blob (a walking face leaves up to ~15 old positions per
  frame, ≈ 5 KiB per face-second). The masked video replaces the original at
  the same resolution (the flat cipher cells should compress at least as well
  as the faces they cover; that part is not measured), so the envelope is the
  extra. Ten 128 px faces on screen add about 0.8–1.7 MiB per second at
  15 fps; the 40 MiB envelope cap then rotates the segment after roughly 25–50 s
  instead of the configured segment length. n = 3 sample faces is a small
  sample; real footage (motion blur, lighting) will move these numbers, not
  their order of magnitude.
* **More capture-time CPU.** Every frame is masked twice (the cubist pass for
  the live feed and the cipher pass for the stored video), plus one JPEG encode
  and one AES-GCM seal per track per frame, the tracker, and one extra
  RetinaFace pass per second on the tick frame. Measured single-threaded on a
  laptop CPU (2026-09-30 review): about 108 ms per 720p frame and about 213 ms
  per 1080p frame against a 67 ms budget at 15 fps, before RetinaFace, ArcFace,
  the encoders and decoding; multi-threaded OpenCV brought 720p under budget and
  left 1080p above it. The stored video encoder writes the masked frames
  instead of the raw ones, so there is still one stored-video encode per frame;
  the live HLS feed keeps its own cubist-masked encode as today.
* **Footage is dropped when the CPU cannot keep up.** A live network camera
  whose frames cost more than the frame period falls behind real time; beyond
  `LIVE_MASK_LAG_SEC` (0.5 s) the stored video repeats the previous masked
  frame instead of processing new ones (see Delivery). In `standard` mode the
  encrypted original still receives every frame; here nothing does. Expect
  repeated frames on 1080p cameras on a shared vCPU.

### Limits

These are stated with the control in `docs/COMPLIANCE.md`, `docs/DPIA.md` and
`docs/THREAT_MODEL.md`; do not claim more.

* **A face the detector misses is not encrypted.** It stays visible in the
  stored masked video, and there is no original to render again later with a
  better detector. In `standard` mode the original keeps that option: the
  on-demand view is rendered from the original with the current masker
  whenever its cache is cold, and the reveal job masks bystanders again. In
  this mode the capture-time detection is final, for playback and for reveal
  output alike.
* **Unidentified tracks cannot be restored.** A track the once-per-second
  recognition tick never sampled (a face seen for less than a second, one
  whose box was not freshly detected on any tick frame, one ArcFace did not
  detect there, or one captured only while ticks were private) stays sealed,
  and none of the reveal methods (photo, suspect, detected face) can select
  it: all three match against samples.
* **Restoration follows the samples, by the second.** A blob is restored only
  when the samples of its track nearest before and after it both match the
  target at the job threshold. A sample taken in a poor pose (a profile below
  the threshold) leaves the frames around it — up to about two seconds —
  masked, much as the standard path leaves a non-matching frame masked. A
  track's frames before its first or after its last sample are confirmed by
  that one sample only across its unbroken detection run: past the first
  frame the detector missed (or the capture loop repeated behind real time),
  they stay masked. Faces the detector loses often — a profile RetinaFace
  alone finds on every 5th frame — therefore lose up to about a second at each
  end of a track. In a synthetic simulation (300 scenes of four random walkers
  with 0–40 % detector misses; `ml-service/tests/test_face_encrypted_handover.py`
  holds the deterministic cases) this rule restored 84.7 % of the frames of
  each sampled person's own tracks, against 99.6 % when a lone sample vouched
  for a track's whole head and tail, and cut the frames restored for the
  wrong person from 190 to 10 of about 177 000 sealed regions (review of
  2026-09-30).
* **Tracking is geometric.** Tracks follow fresh detections by overlap and a
  velocity prediction, with no appearance model. When two faces cross, or one
  face disappears and another appears at the same place within
  `TRACK_MAX_GAP` frames (a third of a second), the tracker can hand a track
  from one person to the other. The samples and the detection runs limit the
  damage: a track that sampled both people is restored only between samples
  of the target, and a sample never vouches for frames across a missed
  detection, so a person who steps into a place someone else just left (which
  takes at least one frame without a detection) is not restored with that
  someone's samples, nor they with theirs. What remains: a swap with no missed
  frame at all (two faces crossing) can bring the other person's frames up to
  the target's nearest sample — at most about one second — into a
  restoration, so can a double swap (target, other, target) between two
  samples of the target, and a swap that no tick samples goes unnoticed. A
  face moving so fast that consecutive detections are more than
  one box side from the prediction — for example a face RetinaFace alone
  detects (every 5th frame) crossing the view — splits into several tracks,
  each restorable only if it was sampled. Where two tracks' painted boxes
  overlap, each blob has the other's box zeroed, so the overlap stays cipher
  even when both are restored.
* **`reveal_level` gates tracks, not people.** A track's rank is when it was
  first boxed; the recognition tick persists that person's `faces` row (and
  its sealed crop) later, with a higher index, and a person who is lost and
  re-detected gets a new track with a higher index again. So a requester whose
  level reaches a person's crop may still be refused that person's first track,
  and restore only their later ones.
* **Restored faces are lossy and capped at about 120 px.** They are JPEG crops
  (quality ≈ 90) of the padded box, at most 192 px on the long side. The
  padded crop is about 1.6 × the detector box + 12 px, so any detector box
  larger than about 113 px is stored downscaled, and the face itself is kept
  at about 120 px at most: a close-up with a 300 px box comes back upscaled
  about 2.6× and visibly softer than the surrounding video. The composite is
  re-encoded.
* **Server-side encryption, not end-to-end.** The ML service still holds the
  master key (`ML_ENCRYPTION_KEY`, with `_PREV` during rotation) and can
  derive every `K_i` and the per-recording key. What changes is that a
  restoration *decrypts only the selected person's blobs*; that is a property
  of the code path run by the trusted ML service, not a cryptographic barrier
  against it or against a holder of `ML_SERVICE_TOKEN` (ADR 0009, "Honest
  threat model").
* **Storage cost per face-second** is the table under Costs.
* **Private-mode faces are gone for good.** Frames captured in `private` mode
  (or while failing closed) have no envelope blobs — including the frames
  after a segment's last tick, which the closing check drops when their
  capture time may be private. No loosening, no span release and no key can
  bring them back.
* **The reveal reads everyone's identity samples within its level.** Finding
  the target means comparing it with every track's samples, so the job
  decrypts the ArcFace embeddings of every track the requester's level
  reaches — never their face pixels. The standard path compares every face of
  the clip in the same way.
* **An envelope is the only copy.** If a face-encrypted recording's envelope
  object is lost or damaged, its faces cannot be restored from anywhere; the
  masked video still plays. The stored object is ONE AES-GCM ciphertext under
  the per-recording key (the at-rest layer every capture artifact gets), so any
  changed or missing byte — a truncated upload, a flipped bit, tampering —
  fails that layer and the reveal job refuses **every** reveal of the
  recording with `[face_envelope_invalid]`; the same holds for the masked
  video. The per-record tolerance described above (a truncated tail, a changed
  record failing only the reveals that select it) applies to the plaintext
  envelope file on the ML container's disk during capture, not to the
  delivered object. A segment interrupted before finalize (service restart
  mid-segment) is dropped as `partial` like any interrupted segment — masked
  video and envelope alike, as a `standard` segment loses its original. Losing
  the master key (and its `_PREV`) makes both the masked video and the
  envelope unreadable (also reported as `[face_envelope_invalid]`). Recovery is
  the backup bundle (`docs/RUNBOOK.md`, "Face-encrypted recording mode").
* **Envelope record headers are authenticated, not encrypted.** Someone who
  holds the envelope object learns how many face regions there were, where
  and in which frames (what the outline in the masked view shows anyway), but
  no pixels and no identity; the `face_id` links are in the sealed index.
* **Faces only.** Clothing, body, gait and background are in the masked video
  in both modes.
* **The mode is not retroactive.** Switching to `face_encrypted` does not
  convert existing `standard` recordings (their raw originals stay until
  retention removes them). Switching back to `standard` does not recover
  originals for face-encrypted recordings; none exist.
* **Levels are not assigned yet.** `reveal_level` gates tracks as described,
  but as of the last check (2026-09-23, ADR 0009 "Deployment status") every
  profile is level 0, so every approved reveal may unseal every matching track.
* **Enforcement depends on the deployed ML build.** An ML build without this
  ADR ignores `recording_mode` and keeps storing raw originals. The row's
  `blur_strategy` is the record of how each segment was actually stored.
* **An unreadable setting stores less, not more.** While the ML service has
  never read a camera's mode (right after a restart, with the database slow or
  unreachable), that camera records face-encrypted segments — a `standard`
  camera then has no raw original for those segments, and the recording is
  restorable only through its envelope. It rotates to `standard` about a
  second after a read succeeds (a failed read is retried every 5 s). The only
  way a `face_encrypted` camera stores a raw
  original is the web action that switches it back (TOTP step-up, audited).

### What it doesn't change

* `standard` cameras: ADR 0002 and ADR 0010 exactly as written, including
  legacy `baked` rows and the `BLUR_STRATEGY` rollback flag.
* The live HLS feed, recognition, alerts, the sealed per-face crop and
  embedding of each identified face (ADR 0009), privacy schedules and spans
  (ADR 0012), privacy zones, 4-eyes approval (ADR 0003) and the audit log.
* The hash chain itself: `K_0 = HKDF(master, …)`, `K_{i+1} = SHA256(K_i)`.

## Alternatives considered

**Face swap.** Rejected (see Context): needs generative models the Railway CPU
cannot run in real time, and a swap alone cannot be undone.

**Keep the raw original and add envelopes.** It would give per-person
restoration without the missed-detection limit, but the raw original would
still hold every face under one key. The point of the mode is that no raw
original exists. `standard` remains available for cameras where re-rendering
with a better detector matters more.

**Reversible scrambling inside the video** (keyed pixel permutation or XOR of
the face region in the stream). Rejected: H.264 is lossy, so a scrambled
region does not survive encoding in a form that can be unscrambled, and
per-pixel noise compresses badly.

**One sealed crop per identity instead of per frame.** Too little to restore
video: it would paste a still image over a moving face. Per-frame blobs are
what make the restored clip follow the person.

**Per-person keys** (`HKDF(master, face_id)`). Rejected for the reason ADR 0009
gives: most faces have no identity at capture time, and it gives no hierarchy.

## Verification

* `ml-service` (pytest): envelope write/read round trip; AAD tamper rejected;
  truncated tail tolerated; the reader never decrypts unrequested tracks (spy
  on the decryptor); identity samples sealed per track, gated by level and
  bound to their track; painted rectangles; a header that disagrees with the
  sealed index is refused; the tracker keeps a walking face (0.6 and 1.0
  widths per frame) and a RetinaFace-only face in one track, never lets a
  second person on the same path join the first person's track, starts a new
  track on a handover after the gap, and seals stale boxes only as the last
  position; a track handed from one person to another through a missed
  detection is never restored across the miss, for the newcomer (head) or for
  the person who left (tail), through the real pipeline and the real reveal
  job; detection runs are recorded in `private` frames too; chain index uniqueness; frames captured in `private` mode —
  including a segment tail the closing check judges private — produce no
  blobs; a walking face is one track restored on ≥ 95 % of its frames with
  < 5 % of its face box zeroed; tracks are sampled when the `faces` row cannot
  be written; a weak dedup match links nothing; a full envelope rotates the
  segment; behind real time the stored video repeats the masked frame; the
  cipher pattern contains no face pixels (correlation with the original crop
  ≈ 0); the pipeline end to end in file mode with synthetic frames (and with
  `ml-service/samples/*.jpg` when present — skipped without them); delivery of
  both artifacts through the spool; old manifests still deliver; the view
  endpoint streams the decrypted masked video; a reveal composites only the
  selected identity (other faces keep the cipher pattern), selects by samples
  (not by a `face_id` link, and without any `faces` row), restores a mixed
  track only between samples of the target; `reveal_level` gating (blobs and
  samples); `never_reveal` zones; a damaged stored object is
  `[face_envelope_invalid]`, a failed download `[face_envelope_unavailable]`;
  a never-read mode fails closed, a missing column means `standard`.
* Jest: the camera mode action (loosening without a step-up →
  `REAUTH_REQUIRED` and nothing written; tightening in one click; audit rows),
  and mn/en/kr parity of the new strings.
* SQL (`supabase/tests/face_encrypted.test.sql`): the CHECK constraints, the
  `standard` default, the grants (no user-token INSERT / UPDATE / DELETE on
  `recordings`, a verified admin cannot insert a decoy row), retention
  never queuing an object another row still names, and the three path indexes
  that lookup needs.

## Deployment

Order: **apply the migration, deploy the ML service
(`cd ml-service && railway up --detach`), then push the web app.**

* **Migration before ML.** The ML build reads `recording_mode` in its own
  query (`storage.load_recording_mode` through `RecordingModeCache`), not in
  the privacy-schedule query, so privacy schedules keep working whatever that
  read does. Without the column the read fails with `42703`, which means
  `standard`. But right after an ML deploy no camera's mode has been read,
  and a camera whose mode was never read records `face_encrypted` (fail
  closed): a `42703` that arrives after the 2 s wait, or any other failed
  first read, starts a face-encrypted segment (it rotates to `standard` about
  a second after the answer). The old schema refuses that segment's rows (the
  `blur_strategy` CHECK, the missing `face_envelope_path` column), so it waits
  in the ML spool, without `faces` rows, until the migration is applied.
  Check the ML `GET /` probe for `"face_encrypted": 1` before switching a
  camera.
* Web before ML would let an admin pick `face_encrypted` while the old ML build
  ignores it and keeps storing raw originals. Deploy the web right after ML:
  while the new ML restarts with the database slow or unreachable, the
  fail-closed rule can store a short face-encrypted segment of a `standard`
  camera, and the old web cannot play it (it signs `storage_path`, which is
  the encrypted masked video) until the new web is live.
* After applying the migration, run `npm run gen:types`.
* Rolling the ML service back to a build before this ADR leaves face-encrypted
  recordings stored and intact but not playable or restorable until the build
  is restored (the old view and reveal paths need an original), and new
  segments go back to `standard`.

To stop using the mode, switch the camera back to `standard` on `/cameras`
(TOTP step-up, audited, other admins notified). Recordings already stored in
face-encrypted mode stay face-encrypted.

## Implementation

| File | Purpose |
|---|---|
| `supabase/migrations/20260930100000_face_encrypted_recordings.sql` | `cameras.recording_mode`, `blur_strategy` CHECK gains `face_encrypted`, `recordings.face_envelope_path`, retention skips objects another row names (with indexes on the three path columns), no user-token INSERT on `recordings` |
| `supabase/tests/face_encrypted.test.sql` | CHECKs, default, grants, decoy-row retention |
| `ml-service/face_envelope.py` | envelope writer (blobs, painted rectangles, sealed identity samples, detection runs, size cap), sealed index checked against the header, streaming `EnvelopeReader.iter_blobs(tracks, level, masters, accept)`, `open_samples(tracks, level, masters)`, `composite` |
| `ml-service/face_tracker.py`, `ml-service/cipher_mask.py` | fresh-detection tracker (velocity gate, stale-box ownership, one sealed region per track and frame), `match_detections` / `link_tracks`; the keyed cipher-cell pattern |
| `ml-service/recording_pipeline.py`, `ml-service/face_masker.py` | chain index at track birth, identity samples and strong links on the ArcFace tick (RetinaFace forced on the tick frame), cipher pattern, envelope writing (none in `private` mode; closing check on the segment tail), detection runs noted on every processed frame, held masked frames behind real time, envelope cap rotates the segment, both artifacts through journal / spool / delivery, mode change rotates the segment |
| `ml-service/recording_spool.py` | the envelope as a second artifact; old manifests still deliver |
| `ml-service/recording_mode.py`, `ml-service/storage.py` | `RecordingModeCache` (sibling of the privacy-schedule cache; never read → `face_encrypted`, missing column → `standard`) over `load_recording_mode`; `blur_strategy` and `face_envelope_path` on the row |
| `ml-service/reveal_job.py` | face-encrypted restoration: targets → tracks selected by their sealed identity samples → blobs confirmed by those samples (one-sided only within a detection run) → selective unseal → composite; `[face_envelope_empty]` / `_unavailable` (download) / `_invalid` (damage, including a failed at-rest layer) |
| `ml-service/camera_worker.py` | `GET /camera/active` reports `live_lag_sec` and `held_frames` |
| `ml-service/main.py` | `GET /recording/{id}/view` streams the decrypted masked video for `face_encrypted`; evidence exports read the masked video; `GET /` reports `"face_encrypted": 1` |
| `components/camera-edit-dialog.tsx`, `app/(app)/cameras/actions.ts`, `/cameras` list | Recording mode choice and badge; tighten in one click, loosen with TOTP step-up, audit, security notification |
| `app/(app)/playback/[id]/page.tsx`, `reveal-modal.tsx` | face-encrypted notice |
| `lib/reveal-errors.ts`, `lib/i18n/translations.ts` | the three `[face_envelope_*]` codes and the new copy in mn/en/kr |
| `lib/recording-mode.ts`, `app/api/reveal/start/route.ts`, `app/api/recordings/[id]/view/route.ts` | mode direction, viewable / revealable rules; reveal start refuses a face-encrypted row without an envelope (`NO_FACE_ENVELOPE`) |
| `lib/backup-tables.ts`, `lib/recovery-bundle.ts` | the envelope in the backup manifest; recovery verifies it by checksum, not as a video |
| retention trigger / sweep, legal hold (SQL), GDPR delete | `face_envelope_path` queued for deletion with its row; GDPR delete never touches `recordings` rows |
