# Capture integrity and recovery

Implemented for audit findings C1–C4, September 2026. This document describes code behavior and test evidence; it is not a claim that a production camera soak or live kill test has passed.

## Storage and deployment

Apply `20260911100000_capture_integrity_source_timeline.sql` before starting this ML build. It adds `recordings.capture_status/capture_error`, fractional durations, and `faces.source_offset_sec`. Existing rows retain the legacy face timestamp fallback.

Railway capture data must be on its actual mounted persistent volume. `RECORDINGS_DIR` defaults to `$RAILWAY_VOLUME_MOUNT_PATH/mongolz-recordings`; an explicit directory outside that mount causes startup to fail. Keep `RECORDING_SPOOL_DIR` on the same persistent volume. The startup check validates the mounted filesystem path, not merely the presence of an environment variable. Local development defaults to `/tmp/mongolz-recordings` and does not promise reboot persistence.

A live camera commits an encrypted segment every `RECORDING_SEGMENT_SECONDS` (default 120 seconds, clamped to 1–300). Earlier segments can be delivered and played while capture continues. `RECORDING_MAX_PENDING_BYTES` (default 2 GiB) bounds combined capture/spool data, and `RECORDING_MIN_FREE_BYTES` (default 256 MiB) reserves free space. Capacity is checked every five seconds. Disk exhaustion stops capture and surfaces a supervisor error; it never silently overwrites footage. Choose the volume size and thresholds for the intended camera count and delivery outage budget.

## Commit and restart behavior

1. An active journal and provisional `capturing` row identify the current segment. Originals in the active segment are plaintext on the restricted volume; this window is bounded by the configured segment duration.
2. FFmpeg must exit successfully. Every output frame is decoded and checked against the expected count and output rate. Corrupt/truncated output is never advertised as `ready`.
3. A validated journal commits the metadata needed to replay the capture-to-spool window. The encrypted spool fsyncs its manifest and ciphertext before deleting source files. Storage and DB acknowledgement are both required before retiring encrypted delivery data.
4. Startup recovers validated journals idempotently, including a crash after delivery but before journal cleanup. An interrupted active segment is marked `partial`, its unfinished plaintext removed, and its error metadata retried if the DB is unavailable. Metadata can be recreated even if the original DB insert failed.
5. A hard kill can lose the **current uncommitted segment**. It does not provide zero-loss capture or rescue an invalid active MP4. Completed segments already on the mounted volume survive. Loss of the volume itself remains a separate disaster-recovery concern.

## Source clock

Upload decoding samples presentation timestamps onto the output frame rate (up to 15 fps) instead of using a rounded frame-skip ratio. Constant-rate input at 24, 25, 29.97, 30, and 60 fps retains its duration within one output frame. Variable timestamp intervals use sample-and-hold; where file PTS is absent, the reported source frame rate supplies the fallback. The final frame duration uses that rate, so a container with unknown final-frame duration is only approximate to that extent.

Live sources without advancing PTS use elapsed monotonic time. A timestamp jump greater than ten seconds fails the session for supervised reconnection instead of allocating an unbounded duplicate-frame queue. Face detections carry their recording offset and capture timestamp into async inference/storage, so processing latency no longer changes timeline placement. The saved duration and `ended_at` use encoded presentation time, not inference runtime. Source capture timestamps for uploaded files are relative to ingestion start; this does not recover a historical wall-clock time absent from the source metadata.

`RecordingSession(recording_id=...)` accepts a stable UUID for durable uploads. `input_complete` means the file reached EOF. `processing_complete` becomes true only after EOF, encoder validation and durable spool acceptance; Storage delivery may still be pending. `stop(finalize=False)` discards uncommitted work while preserving any source still owned by a preparing spool manifest.

## Regression evidence and remaining acceptance

`tests/test_capture_integrity.py` uses actual OpenCV/FFmpeg media to cover fractional source rates, source-timed detection calls, invalid and short outputs, encoder failures/timeouts, rolling-segment recovery after an encoder kill, validated-journal replay, database outage recovery, and mounted-volume/capacity guards. Existing delivery outage tests now use decodable videos and real encryption rather than arbitrary byte strings.

Still required in the deployment environment: verify the volume configuration; connect an authorized camera; record at least 30 minutes; test disconnect/reconnect; kill/restart the ML worker during a segment and confirm earlier segments remain playable; then run a 24-hour soak while watching disk, capture errors and spool delivery. Those exercises require a reachable real camera and are not replaced by local media regressions.
