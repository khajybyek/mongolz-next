# 0012 — Privacy schedules can only tighten protection

* **Status:** Accepted
* **Date:** 2026-09-28
* **Relates to:** [0003](0003-four-eyes-reveal-approval.md) (4-eyes reveal stays
  the only way to un-mask), [0006](0006-step-up-totp-reauth.md) (TOTP step-up
  is required to loosen a schedule), [0010](0010-on-demand-blurred-view.md)
  (the masked view is unchanged), [0011](0011-mfa-at-the-data-tier.md) (the
  second-factor policy on `masking_schedules` stays)
* **Fixes:** §6.4 of `docs/audits/2026-09-08-full-audit.mn.md`. The masking
  schedule and `cameras.mask_default` existed only in the UI

## Context

Migration `20260516064305` added per-camera time windows:
`public.masking_schedules`, `cameras.mask_default` and
`public.effective_mask_mode()`. They used two words, `masked` and `revealed`,
and the admin page `/cameras/[id]/schedule` let you set them. **Nothing in the
ML service ever read them.** The page carried a "policy preview, no effect"
banner, and every audit since 2026-09-08 has listed the feature as UI-only. A
control that looks active and does nothing is worse than no control. An
operator who sets "masked 09:00–18:00" believes something changed.

Two ways to make the old words real were both wrong:

* **A `revealed` window means raw video on a timer.** That creates a second
  way to un-mask, and it skips everything ADR 0003 requires: a second admin, a
  step-up, an audit row per reveal, and a scope limited to target faces. One
  admin editing one schedule would un-mask every face on a camera for hours.
* **A `masked` window adds masking.** Masking is already always on. Live HLS
  has been masked since `1ff609b` (2026-09-20), the playback view is rendered
  masked on demand (ADR 0010), and legacy baked MP4s were masked when written.
  There is nothing left to add.

Some processing today is not needed around the clock. That is **biometric
identification**. Once per second of video, the recording pipeline computes an
ArcFace embedding, stores a sealed face crop and a `faces` row, matches the
face against suspects and raises `alerts`. The edge endpoint runs the same
kind of inference. Reveal can later decrypt the original footage. This is the
processing GDPR Art. 9 is about, and here a time window is useful.

Two bugs in the old `effective_mask_mode()` would have carried over:

* An overnight window was checked against the bit of the *current* weekday, not
  the day it started. "Fri 22:00–06:00" therefore matched Friday 02:00 and
  missed Saturday 02:00.
* Overlapping windows were resolved by `LIMIT 1`, so the winner was arbitrary.

Production on 2026-09-28: `masking_schedules` had 0 rows, and the only camera
had `mask_default = 'masked'`. `authenticated` and `anon` still held INSERT,
UPDATE, DELETE and TRUNCATE on `masking_schedules`. Only the admin RLS policy
limited writes, with no step-up and no audit row on the PostgREST path.

## Decision

**A schedule, default or window can only make protection stronger.** No
setting ever un-masks video. The old meaning of `revealed` is removed on
purpose, and un-masking remains only the 4-eyes reveal job.

Two modes replace `masked` and `revealed`:

| Mode | Video | Biometric processing | Reveal of footage captured in this mode |
|---|---|---|---|
| `standard` (default) | masked, as today | **on**, as today | allowed through the 4-eyes reveal, as today |
| `private` | masked, as today | **off**: the recognition step does not run. No stored embedding, no `faces` row or sealed crop, no suspect matching for alerts, no alerts, no inference on edge frames. The masker places masks with the detector alone; see below | **never**. The reveal job keeps those frames masked and does not run matching on them |

The shared `FaceMasker` runs in both modes, because it is what keeps faces
hidden. In `private` mode (`FaceMasker.embeddings_allowed = False`, set on every
recognition tick) it switches its identification part off without weakening the
mask:

* Its periodic InsightFace pass uses the detection model alone
  (`FaceEngine.detect_boxes`: RetinaFace boxes, no landmark or ArcFace model),
  so no embedding is computed. It never falls back to the full pass: when the
  detector-only call is unavailable the frame is left to Haar and the
  persistence cache, and the gap is logged once as an error. Haar detection is
  unchanged.
* The recording pipeline's suspect-tier lookup, which in `standard` mode picks
  a stronger mask for VIP-tier suspects, is skipped. Every face (Haar and
  InsightFace boxes) gets the strongest (VIP) mask instead, so no suspect is
  masked more weakly than identification would have allowed.
* The reveal job, the on-demand playback view and the evidence clip / frame
  renderers mask protected frames the same way (detector only, VIP mask).

"Identification off" in this ADR means no ArcFace embedding — stored or
transient — in the capture pipeline, the edge endpoint, the reveal job or the
masked renderers for frames captured in `private` mode, and nothing stored or
triggered. The one exception (a sub-second lag of the capture masker after a
boundary) is listed under Limits.

A typical use: **business hours 09:00–18:00 `private`**, so staff and
customers are not put through recognition (no face records, matches or
alerts), and **after hours `standard`**, so recognition and alerts cover
intruders. This limits purpose and minimises data by time
(GDPR Art. 5(1)(b)(c), Art. 25).

### Evaluation rules

SQL and Python use the same rules:

* Times are in Asia/Seoul. `starts_at` and `ends_at` are `HH:MM`. `ends_at` may
  be `24:00` (end of day); `starts_at` may not. `starts_at <> ends_at`; use
  `00:00–24:00` for a whole day.
* `weekdays` is a bitmask: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64.
  The bit index is the ISO day of week modulo 7.
* **A window belongs to the weekday it starts on.** A same-day window
  (`starts_at < ends_at`, including `ends_at = '24:00'`) is active on day D when
  D's bit is set and `starts_at <= local time < ends_at`. An overnight window
  (`starts_at > ends_at`) is active when D's bit is set and
  `local time >= starts_at`, or when the previous day's bit is set and
  `local time < ends_at`. So "Fri 22:00–06:00" covers Saturday 02:00, not
  Friday 02:00.
* **Precedence:** if any active window is `private`, the mode is `private`.
  Otherwise, if any active window is `standard`, the mode is `standard`.
  Otherwise the camera's `privacy_default` applies. A camera id with no
  `cameras` row gets `standard`.
* The mode applies at the **capture** time of a frame, not at viewing time.

SQL implements this in `public.effective_privacy_mode(p_camera_id, p_at)` and
Python in `privacy_schedule.mode_at()`. One list of test vectors is kept word
for word in `supabase/tests/privacy_schedule.test.sql` and
`ml-service/tests/test_privacy_schedule.py`, so the two implementations cannot
drift apart without a test failing.

### Where the mode takes effect

1. **Recording pipeline.** The pipeline already has a recognition tick once per
   second of video. On that tick it asks the schedule cache for the mode of the
   frame. In `private` mode it does not start the ArcFace task: no stored
   embedding, no face row or crop, no alert. In `standard` mode nothing
   changes. Tasks started before a switch to `private` may finish, because
   their frames were captured in `standard` mode. HLS and baked output stay
   masked in both modes; in `private` mode the masker places the masks with the
   detector alone and skips the suspect-tier lookup (see above).

   **The capture instant is a bound, not a point.** A live frame's time comes
   from the camera's source (PTS) clock, anchored to the wall clock. That
   anchor used to be taken in the session constructor, before the suspect-cache
   load, the schedule warm-up and the source open, so every frame was stamped a
   few seconds early and a slow or nominal-fps camera clock drifted further for
   as long as the session ran — the first seconds of every private window were
   identified, and the reveal job, which rebuilds the same timeline, agreed.
   Now:
   * the anchor is re-taken when the source opens and at every segment
     rotation. At a rotation it is the rotation frame's arrival instant minus
     the backlog measured then (monotonic arrival against source time), both
     read *before* the old segment is finalized: the finalize (ArcFace drain,
     full-decode validation, encryption) can block the loop for seconds while
     the source buffers frames, and an anchor taken after it stamped the whole
     next segment late. So a fast source clock never carries its drift beyond
     one segment, and `recordings.started_at` is the wall-clock estimate of the
     segment's frame 0. The backlog is measured for every live source,
     including baked mode and demo sources, which never hold frames. There a
     backlog cannot be told apart from a slow source clock, so both count as
     backlog and the estimate errs early, the side the bound tolerates. In
     `on_demand` mode holding tells them apart: a backlog drains while held
     frames are cheap, and drift does not;
   * each live tick is judged over `[min(estimate, now) − PRIVACY_CLOCK_MARGIN_SEC,
     now]` (margin 5 s): `now`, the wall clock when the frame is processed, can
     never be earlier than the capture, and the margin covers frames the source
     buffered before the loop saw them. The tick is `private` if **any** instant
     of that range is (`PrivacyScheduleCache.mode_during`). The start of a
     private window is therefore never identified; the price is that
     recognition resumes a few seconds after a private window ends;
   * the widest bound seen is kept on the session, and a bound wider than the
     reveal/view schedule pad (below) is logged as a warning.

   Browser uploads (file mode) have only the source clock; their bound
   collapses to the estimate.
2. **Capture-time record: `public.recording_privacy_spans`.** For each recording
   segment the pipeline writes the intervals it captured in `private` mode, as
   offsets on the stored video's own timeline (the same timeline as
   `faces.time_in_video_sec` and the reveal job's frame times).
   * A span opens at the offset of the *previous* tick, so it also covers the
     part of a second before the switch was seen.
   * It closes at the tick where `standard` resumes, or at the end of the
     segment. If the camera is still `private`, the next segment opens a new
     span at 0.
   * An open span (`end_offset_sec is null`, for example after a crash) counts
     as running to the end of the recording.
   * `source = 'fail_closed'` means the schedule could not be read, and the
     footage was protected anyway.
   * Every span carries a pipeline-generated `client_span_id`; every write of it
     is an upsert on that key, so a retry after a response lost *after* the
     commit finds the row instead of leaving an orphaned open row (which would
     read as "private until the end").
   * Live writes happen off the event loop and are retried after a database
     error; while the segment's recordings row does not exist, the span flush
     also retries that insert (in `private` mode no ArcFace task would). A
     failed span write never stops a recording.
   * **Spans travel with their segment.** At finalize the segment's spans go
     into the validated capture journal and the spool manifest. The spool
     delivery (and journal recovery) upserts them *before* the row becomes
     ready (`has_original`, `capture_status = 'ready'`; a placeholder row is
     created first when none exists), and keeps the delivery pending when they
     cannot be written. A session that ends during a database outage therefore
     loses no span: the footage and its spans arrive together. The spans are
     written before the artifact uploads, so a span write that keeps failing
     (for example ML deployed before this ADR's migration) costs one database
     call per retry rather than a re-upload of the segment, and the ML log says
     why the delivery is held.
3. **Live status.** Entries from `GET /camera/active` carry
   `privacy_mode: "standard" | "private"` (`null` until the first tick, and for
   a camera in reconnect backoff) and `privacy_source` (`schedule` | `none` |
   `fail_closed`). The `/grid` tiles, the `/live` CCTV list and the `/wall` live
   tiles show a "Privacy mode" lock badge while a camera is `private` — or, in
   the warning colour, "Recognition paused" when the source is `fail_closed`
   (the schedule could not be read: an outage, not a window; the schedule page
   may say "Standard" meanwhile). The badge is focusable and opts back into
   pointer events inside the tile overlays; `/grid` and `/wall` also print a
   one-line legend under the tiles, so the meaning is reachable on touch
   screens.
4. **Edge frames (`POST /edge/detect`).** In `private` mode the frame is
   received and its delivery is recorded with `face_count = 0`, but no detector
   runs on it. The response carries `privacy_mode`. A retried delivery gets the
   original answer and is not evaluated again. `captured_at` comes from the
   device clock (no RTC, not yet NTP-synced, running fast, or an old outbox
   entry). A frame cannot have been captured after the server received it, so
   `PrivacyScheduleCache.edge_mode` takes `latest = min(captured_at, receipt)`
   and `earliest = latest − 5 s` (a device clock running a little fast;
   `EDGE_CLOCK_MARGIN_SEC`) and treats the frame as private when the camera is
   private anywhere in `[earliest, receipt]` (when receipt is at most 1 h after
   `latest`; beyond that, anywhere in `[earliest, latest]` or at receipt), or
   when the schedule was loosened after `earliest`
   (`cameras.privacy_loosened_at`, stamped by the schedule actions around every
   loosening that takes private time away — the current schedule no longer
   shows the private time that covered such a frame).
5. **Reveal job.** Protected intervals are the union of the recording's
   `recording_privacy_spans` and the private intervals of the camera's
   schedule, read fresh, over the recording's time range and **widened by
   `PRIVACY_SCHEDULE_PAD_SEC` (60 s) on both sides**, because
   `started_at + offset` is the pipeline's estimate of a frame's capture
   instant, not the instant itself. Spans are never padded: they record what
   the pipeline actually decided. A recording with no camera (browser uploads,
   or a camera deleted since — `camera_id` becomes NULL) uses its spans only.
   The shared loader is `privacy_protection.load_protected_timeline`.
   * Frames in a protected interval skip target matching entirely, and their
     masking pass uses the detector alone. They are written with every face
     masked, the same as a frame with no match. The job logs how many seconds
     it withheld.
   * If the protected intervals cover the whole recording, or the whole
     requested `target_start_sec`–`target_end_sec` range, the job fails
     *before decrypting anything*. The message says **why**: the spans alone
     cover it (`[privacy_whole_recording]` / `[privacy_whole_range]` —
     captured in privacy mode, final) or only the camera's current schedule
     does (`[privacy_schedule_whole_recording]` /
     `[privacy_schedule_whole_range]` — withheld while that window exists;
     loosening it releases the footage). The bracketed code is stable: the
     web maps it to mn/en/kr copy (`lib/reveal-errors.ts`) and shows the
     Mongolian + English text only as a fallback. The length comes from
     `recordings.duration_sec`; when it is unknown, a render in which every
     in-scope frame was withheld is refused afterwards and nothing is uploaded.
   * If the spans or the schedule cannot be read, the job fails closed
     (`[privacy_unavailable]`). Privacy zones already work this way
     (`[privacy_rules_unavailable]`).
6. **On-demand view and evidence renderers.** `GET /recording/{id}/view`, the
   evidence clip and the evidence frame load the same protected timeline and
   mask frames inside it with the detector alone (no embedding computed, not
   even transiently) and the VIP mask, exactly as the capture masker does in
   `private` mode. If the spans or the schedule cannot be read, the **whole
   recording** is treated as protected — the masked view is still served,
   never refused.
7. **Playback.** `/playback/[id]` lists the recording's spans as `mm:ss–mm:ss`
   ("captured in privacy mode: faces were not identified and cannot be
   revealed"; an open span reads "until the end") and, separately, the
   stretches the camera's *current* schedule withholds (same rules and 60 s
   margin as the job, evaluated in `lib/privacy-schedule.ts`). The reveal modal
   gets both: it warns when part of the selected range stays masked and does
   not send a request the job would refuse after a second admin approved it.
   "Window off" now reads "the whole recording is in scope; protected
   stretches stay masked".
8. **Is it actually enforced?** `GET /` on the ML service reports
   `privacy_schedules: 1`. The web auto-deploys on push while the ML service is
   deployed by hand, so the schedule page and `/health` probe it and warn when
   the running ML build does not report the capability (older build, failed
   deploy, rollback: schedules saved but ignored) or is unreachable.

### The ML schedule cache

`privacy_schedule.PrivacyScheduleCache` sits between the capture loop and the
database:

* A schedule is re-read when it is older than **30 s** (stale-while-revalidate:
  the tick that notices uses the old value while the refresh runs, so an edit
  usually lands within about 30 s plus one tick). The read runs in a worker
  thread and never blocks the event loop. Concurrent callers for the same
  camera share one refresh.
* `mode_at(camera, t)` answers for an instant, `mode_during(camera, a, b)` for
  a capture instant known only to lie in `[a, b]` (private if any instant is),
  and `edge_mode(camera, captured_at, received_at)` applies the edge rules
  above.
* A failed refresh keeps the last good schedule and logs at most one warning
  per camera per minute.
* If the schedule was never read, or the last good read is more than
  **10 minutes** old, the mode is **`private` with source `fail_closed`**. A
  database outage must not quietly turn identification back on in a window
  someone marked private.
* No camera id, a camera id that is not a UUID, or a camera with no `cameras`
  row gives `standard` with source `none`.
* The reveal job does not use the cached value. It reads the schedule fresh and
  raises on any read error.

### Who can change a schedule, and how

Every change is either **loosening** (it allows more identification) or
**tightening**:

| Change | Class |
|---|---|
| add a `standard` window · delete a `private` window · default `private` → `standard` | **loosen** |
| add a `private` window · delete a `standard` window · default `standard` → `private` | **tighten** |
| set the default to its current value | no-op |

* **Loosening requires a fresh TOTP step-up** (ADR 0006). A password step-up is
  not accepted. Loosening also notifies the other admins by push and Telegram
  (`security_event`). **Tightening is one click.**
* A delete is classified from the row stored in the database, never from what
  the form sent.
* A loosening that actually takes private time away — the camera's schedule
  before and after the change, compared over a week (`removesPrivateTime` in
  `lib/privacy-schedule.ts`) — stamps `cameras.privacy_loosened_at` before the
  write (default changes stamp it in the same compare-and-set write; a
  loosening that cannot be stamped is refused) and again after it, so the
  stamp is never earlier than the change (a failed second stamp is noted in the
  audit row). Edge frames captured before that instant stay private. A change
  that is loosening by kind but removes nothing (a `standard` window on a
  camera whose default is `standard`) still needs the step-up but writes no
  stamp.
* **Adding a camera needs the TOTP step-up too** and notifies the other admins
  (`CAMERA_ADD`). A new cameras row starts `enabled` and `standard` with no
  windows, and the source URL of an existing camera is visible on `/cameras`,
  so without the step-up a stolen session could register a second row for a
  `private` feed and get recognition on it — defeating the step-up above.
* Each change writes an audit row: `PRIVACY_SCHEDULE_ADD`,
  `PRIVACY_SCHEDULE_DELETE` or `PRIVACY_DEFAULT_CHANGE`, with the mode and times
  in the detail.
* **Only the service role can write** `masking_schedules`. `authenticated` loses
  INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER, and `anon` loses
  everything. A stolen admin token therefore cannot loosen a schedule through
  PostgREST and skip the step-up. The admin write policies are dropped. The
  operator read policy and the restrictive second-factor policy (migration
  `20260908110000`, ADR 0011) stay.

### Migration `20260928100000_privacy_schedules_enforced.sql`

* `cameras.privacy_default text not null default 'standard'`, limited to
  `standard` or `private`. Every existing row becomes `standard`, and
  `mask_default` is dropped. Neither old value ever changed behaviour, and
  `masked` described today's behaviour, which is `standard`. Mapping the old
  default to `private` would have switched recognition off on every camera
  without anyone choosing that.
* `masking_schedules.window_mode` values are mapped `masked` → `private` and
  `revealed` → `standard`. A `masked` window was an explicit choice to protect a
  time range, and `private` is the nearest meaning that still only tightens. A
  `revealed` window never took effect. Production had 0 rows, so this mapping
  is only a precaution. New CHECKs: mode in (`standard`, `private`),
  `starts_at <> ends_at` and `starts_at <> '24:00'`. The `20260923180000`
  time-format CHECKs stay. The table keeps its historical name.
* `effective_mask_mode(uuid, timestamptz)` is dropped and replaced by
  `effective_privacy_mode(uuid, timestamptz)`. The new function is
  `security invoker`. Execute is granted to `authenticated` and `service_role`
  and revoked from `public` and `anon`.
* New table `recording_privacy_spans`:
  * rows are deleted with their recording (ON DELETE CASCADE), and an index
    covers `recording_id`;
  * `end_offset_sec` is either null or greater than `start_offset_sec`;
  * RLS lets an operator read a span only when they can already see its
    recording, and the restrictive `private.mfa_ok()` policy applies;
  * only the service role can write.

  * `client_span_id uuid not null unique default gen_random_uuid()` — the
    idempotency key every write upserts on (live retries, spool delivery,
    journal recovery, backup restore).

  These facts live in their own table, not on `recordings`: a stolen admin
  token must not be able to erase the record that footage was captured in
  `private` mode.
* `cameras.privacy_loosened_at timestamptz` (NULL = never), written only by the
  service role from the schedule actions.
* `authenticated` loses UPDATE on `recordings` and the unused
  `"recordings: admin update"` policy is dropped. No web or user-token path
  updates recordings; the grant only let a stolen admin token move
  `started_at` / `camera_id` — the anchors that place the schedule on a
  recording's timeline — with no step-up and no audit row.

## Alternatives considered

**Implement `revealed` literally (raw video during a window).** Rejected. It
would un-mask video outside the 4-eyes workflow, and the only protection would
be one admin's schedule edit.

**Delete the schedule feature.** Honest, but it throws away a real
data-minimisation tool. Limiting identification to the hours that justify it is
a stronger answer to GDPR Art. 5(1)(c) than any mask.

**Evaluate the mode at viewing time.** Rejected. Identification happens at
capture: embeddings and alerts are made then or never. A mode that changes
whenever someone watches cannot undo that. A viewing-time rule that loosens
would also be a reveal bypass.

**Store privacy facts on `recordings`.** Rejected. `authenticated` held UPDATE
on that table (revoked here, but the facts belong where only the service role
has ever written).

**Re-anchor the capture clock and call the reveal "exact".** Rejected. A
re-anchor stamps buffered frames late and still drifts between anchors; the
honest statement is a bound, judged conservatively in the pipeline and padded
in the reveal.

**Stop recording entirely in `private` mode.** This would minimise more data,
but it removes the masked, encrypted footage that shows *what* happened without
showing *who*. An `off` mode can be a later ADR. This one only removes
identification.

## Consequences

### Gains

* The page now does what it says. The "preview, no effect" banner is gone.
* Identification can be limited in time. Frames captured in `private` mode
  produce no stored embeddings, crops, face rows or alerts.
* Reveal cannot reach footage captured in `private` mode. It still cannot after
  a later loosening, because the capture-time spans are kept — delivered with
  the footage itself — and the reveal job reads them.
* Loosening is a deliberate act: TOTP step-up, notification to the other admins
  and an audit row. The database refuses direct writes.
* The overnight-weekday bug and the arbitrary `LIMIT 1` precedence are gone.

### Limits

* **The capture masker lags a boundary by up to one tick.** The mode reaches
  the capture masker on the once-per-second recognition tick, so up to 1 s of
  frames after a switch into `private` can still get the standard-mode masking
  pass (a transient embedding, discarded, and the suspect-tier lookup that
  picks the mask strength). Nothing is stored or matched for alerts. Every
  other path — the reveal job, the on-demand view, the evidence clip / frame —
  judges each frame by the protected timeline and computes no embedding for a
  protected frame.
* **Without a working detector-only call, private frames get a weaker mask.**
  `FaceMasker` never falls back to the full pass in `private` mode; if
  `detect_boxes` is missing or fails, those frames are masked by Haar and the
  persistence cache only, and an error is logged once per masker.
* **`private` mode is visible in the mask.** Every face gets the VIP mask
  (50–90 polygons and a heavier blur; audit §6.12), so a viewer of the live feed
  can tell the camera is in `private` mode, which the "Privacy mode" badge shows
  anyway. The viewer can no longer tell which suspect tier a face matched.
* **Boundaries are bounds, not instants.**
  - Pipeline: each live tick is private if any instant of
    `[min(estimate, now) − 5 s, now]` is, re-anchored at the source open and at
    every rotation (from the rotation frame's arrival and measured backlog).
    The start of a private window is never identified; recognition resumes
    about 5 s (plus live lag) after a private window ends. If a source clock
    runs fast by more than the margin within one segment, or the `on_demand`
    lag guard mistakes a backlog for drift (one that does not drain even while
    frames are held), the bound can still miss at the END of a window — the
    widest bound is logged, and a bound wider than the reveal pad is a
    warning. A slow source clock in baked mode or on a demo source is never
    corrected; its estimates only err early and the bound grows.
  - Reveal / view: the schedule part is widened by 60 s on each side
    (`PRIVACY_SCHEDULE_PAD_SEC`), so up to a minute after a private window
    ends is withheld from reveal too. The spans are exact records of the
    pipeline's decisions and are not padded. "Reveal protection is exact" was
    never true and is no longer claimed.
* **A change usually takes about 30 s to reach running cameras** (cache TTL,
  plus one tick). If the ML service cannot read the database, it keeps the last
  good schedule for up to **10 minutes** — a tightening made during such an
  outage is not applied until the read succeeds or the 10 minutes pass (then
  every camera fails closed). The reveal job reads the schedule fresh. The
  schedule page's "Current state" is the SQL evaluation of the saved schedule;
  the `/grid` badge shows what the ML service actually applies.
* **Fail-closed stops recognition — and locks that footage for good.** After
  10 minutes without a readable schedule, or when the schedule was never read
  since the ML process started, every camera is treated as `private`.
  Recognition and alerts stop until the database is readable again. The spans
  of that time have `source = 'fail_closed'` and, like every span, are
  protected permanently: **footage captured while failing closed can never be
  revealed, even on a camera whose schedule says `standard`**, short of
  deleting its spans by hand with the service role (`docs/RUNBOOK.md`; a
  manual procedure — nothing enforces the second person or the audit row). The
  same happens to everything captured if the ML service is ever deployed
  before the migration — and until the migration lands those segments are not
  delivered at all: their spans cannot be written, so they wait encrypted in
  the spool (the recordings stay `capturing`, not playable), and capture stops
  once the spool reaches `RECORDING_MAX_PENDING_BYTES` (2 GiB by default). You can see the state three ways: the "Recognition paused" badge
  (`privacy_source: "fail_closed"` on `/camera/active`), spans with
  `source = 'fail_closed'` on the playback page, and one ML log line per mode
  switch.
* **Tightening is retroactive for reveal; loosening releases that part.**
  Adding a `private` window (or switching the default to `private`) does not
  delete faces, crops or alerts already made in `standard` mode, but it does
  withhold that time range from future reveals — the current schedule is part
  of the protected set. The refusal says so (`[privacy_schedule_…]`), the
  playback page lists those stretches separately, and loosening the window
  later (TOTP step-up) makes them revealable again. Footage covered by spans
  is never released by a loosening.
* **Deleting a camera drops the schedule backstop.** `recordings.camera_id`
  becomes NULL (`ON DELETE SET NULL`), so its recordings are judged by their
  spans alone from then on. Footage captured in `private` mode keeps its
  spans; footage withheld only by the schedule becomes revealable. Deleting a
  camera needs the TOTP step-up.
* **`private` footage is still recorded.** It is encrypted, kept under the
  retention policy and viewable masked. The reveal job refuses it, but the key
  is not destroyed, so whoever holds the ML master key or the service role can
  still decrypt the original outside the product. This is the same boundary as
  ADR 0009's honest threat model.
* **Enforcement depends on the deployed ML build.** An ML build without the
  `privacy_schedules` capability ignores schedules entirely; the web warns on
  the schedule page and `/health`, but it cannot enforce anything itself.
* **What the schedule does not cover.**
  * Browser uploads with no camera id are always `standard`.
  * The `/live` device and phone tabs are local previews and are not affected.
  * No edge agent is deployed today. The `/edge/detect` gate applies when one
    is; an agent holds the master ML token and is trusted to report
    `captured_at`, which is why receipt time and the loosening stamp are
    checked too. An agent whose clock is far behind (1970 after booting
    without an RTC, a stale fake-hwclock) has every frame treated as private
    for good once the schedule has been loosened: sync its clock (NTP) before
    it sends.
  * The schedule decides whether faces are identified, not who may watch.
    Access to the masked footage is still RLS plus `camera_permissions`.

## Verification

Tests cover:

* `supabase/tests/privacy_schedule.test.sql`:
  * the shared vectors against `effective_privacy_mode()`;
  * the CHECK constraints (`24:00` start, equal start and end, unknown mode,
    span end after start);
  * `authenticated` cannot write `masking_schedules` or
    `recording_privacy_spans`, nor UPDATE `recordings` (a verified admin token
    cannot move `camera_id` / `started_at`);
  * `anon` has no rights at all;
  * `client_span_id` is generated, unique, and an upsert on it completes a
    single row; `cameras.privacy_loosened_at` is a nullable timestamptz.
* `ml-service/tests/test_privacy_schedule.py`:
  * the same vectors for `mode_at()`;
  * `private_intervals()` (clipping, merging, overnight windows, a `private`
    default minus `standard` windows);
  * the cache: TTL refresh, stale and never-loaded reads failing closed,
    non-UUID ids and missing cameras, a failed refresh keeping the last good
    schedule, and the refresh running off the event loop;
  * `mode_during` (any private instant of a range) and `edge_mode` (device
    clock behind, a window between capture and receipt, a loosening after
    capture).
* Pipeline, edge and reveal tests:
  * a `private` tick starts no ArcFace task, and the masker then uses
    `detect_boxes` (no embedding, no tier lookup, VIP mask) —
    `test_privacy_masking.py`;
  * spans open, close, rotate with segments, close at finalize, are flushed
    after the row exists, and are retried after a database error; the flush
    retries a failed row insert; a lost open response leaves no orphaned row
    (`test_privacy_pipeline.py`);
  * live ticks are judged over the source-clock-to-wall-clock bound, a stale
    anchor cannot hide the start of a private window, the anchor is re-taken
    at open and rotation, and a rotation whose finalize blocks longer than the
    margin, or a 90 s backlog in baked mode or on a demo source, still stamps
    the next segment at its real capture instant (`test_privacy_pipeline.py`,
    `test_live_mask_lag_guard.py`);
  * spans travel with the segment: journal + spool manifest, written before
    the row is ready and before the uploads (a span write that keeps failing
    never re-uploads the segment), delivery kept pending when they cannot be
    written, and a session whose live span writes never succeed still ends
    with every span in the database (`test_privacy_span_delivery.py`);
  * a `private` edge frame runs no inference, including the receipt-time,
    between-capture-and-receipt, device-clock-ahead and loosening cases
    (`test_edge_api.py`, `test_privacy_schedule.py`);
  * protected frames skip matching and stay masked; the schedule part is
    padded; refusals name spans vs schedule with stable codes;
  * a fully protected recording fails before decryption;
  * a read error fails closed;
  * the on-demand view and evidence renderers use `detect_boxes` and the VIP
    mask for protected frames and treat an unreadable timeline as all
    protected, still serving the view (`test_view_privacy.py`);
  * `GET /` reports `privacy_schedules: 1`.
* Jest:
  * the loosen/tighten classifier (`lib/privacy-schedule.ts`);
  * the schedule actions: a loosening change without a step-up returns
    `REAUTH_REQUIRED` and writes nothing, and a tightening change writes and
    audits without a step-up;
  * a delete is classified from the database row;
  * a loosening that takes private time away stamps
    `cameras.privacy_loosened_at` before and after the write, one that removes
    nothing does not stamp (`removesPrivateTime`);
  * adding a camera needs a TOTP step-up and notifies the other admins;
  * the TypeScript copy of the evaluation rules passes the shared vectors, and
    the reveal-modal verdict / error-code mapping / capability check behave
    like the ML side, and the modal's Continue stays off for a refused range
    whatever the reveal method (`__tests__/privacy-schedule.test.ts`).

## Deployment

Order: **apply the migration, then deploy the ML service
(`cd ml-service && railway up --detach`), and push the web app right away.**

* Before the ML redeploy, the old ML service ignores schedules, so nothing
  changes.
* A new ML service running *before* the migration cannot read
  `privacy_default` and fails closed, which turns recognition off on every
  camera. It also cannot write the spans every segment then carries, so no
  recording is delivered until the migration lands (they wait in the spool and
  capture stops when it is full), and that footage stays unrevealable
  afterwards. Never deploy ML first.
* Between the migration and the web deploy, old web code that names
  `mask_default` or `effective_mask_mode` fails: the schedule page and the
  admin backup export. Both are admin-only, and the gap is minutes.
* After applying the migration, run `npm run gen:types`.
* After the ML deploy, confirm `curl -s $ML/ | jq .privacy_schedules` is `1`;
  the schedule page and `/health` warn until it is.

There is no environment flag to switch enforcement off. To bring recognition
back on a camera, loosen its schedule on the page: TOTP step-up, audited, and
the other admins are notified.

## Implementation

| File | Purpose |
|---|---|
| `supabase/migrations/20260928100000_privacy_schedules_enforced.sql` | `privacy_default`, mode mapping and CHECKs, service-role-only writes, `effective_privacy_mode()`, `recording_privacy_spans` |
| `supabase/tests/privacy_schedule.test.sql` | shared vectors, constraints, grants |
| `ml-service/privacy_schedule.py` | `mode_at`, `private_intervals`, `PrivacyScheduleCache`, `get_privacy_schedule_cache()` |
| `ml-service/storage.py` | `load_privacy_schedule`, `open_privacy_span`, `close_privacy_span`, `list_privacy_spans` |
| `ml-service/recording_pipeline.py` | mode check on the recognition tick, span tracking, `privacy_mode` on the session, masker switched to detector-only in `private` mode |
| `ml-service/face_engine.py`, `ml-service/face_masker.py` | `detect_boxes` (RetinaFace boxes, no embedding); `embeddings_allowed` switch and VIP mask for every face in `private` mode |
| `ml-service/main.py`, `ml-service/camera_worker.py` | cache wiring at startup, `/edge/detect` gate, `privacy_mode` on `/camera/active` |
| `ml-service/privacy_protection.py` | shared protected timeline: spans ∪ padded schedule, `fail_closed_timeline()` |
| `ml-service/reveal_job.py` | protected intervals (spans and schedule), withheld frames, fail-closed reads, coded refusals |
| `ml-service/view_renderer.py` | on-demand view + evidence clip / frame: detector-only VIP mask for protected frames |
| `ml-service/recording_spool.py`, `ml-service/capture_journal.py` | spans carried with each segment, written before the row is ready |
| `ml-service/tests/test_privacy_schedule.py` | shared vectors, intervals, cache |
| `lib/privacy-schedule.ts` | `classifyScheduleChange` (loosen / tighten / no-op); `removesPrivateTime` (whether a loosening is stamped); display copy of the evaluation rules; reveal-modal verdict and `revealCanContinue` |
| `lib/reveal-errors.ts` | ML refusal codes → mn/en/kr messages (reveal modal, `/jobs`) |
| `lib/health-probes.ts`, `components/privacy-enforcement-notice.tsx` | ML `privacy_schedules` capability check (schedule page, `/health`) |
| `app/(app)/cameras/actions.ts`, `components/camera-edit-dialog.tsx` | TOTP step-up + admin notice for adding a camera |
| `app/(app)/cameras/[id]/schedule/actions.ts` | step-up for loosening, `privacy_loosened_at` before and after a loosening that removes private time, audit rows, notification to admins |
| `app/(app)/cameras/[id]/schedule/page.tsx` | plain-language explanation, current mode from `effective_privacy_mode()` |
| `app/(app)/playback/[id]/page.tsx`, `reveal-modal.tsx` | spans notice, current-schedule notice, reveal verdict |
| `lib/ml-client.ts`, `components/privacy-mode-badge.tsx`, `/grid`, `/live`, `/wall` | `privacy_mode` and the lock badge |
