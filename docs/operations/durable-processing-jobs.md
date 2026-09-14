# Durable upload and reveal processing

Apply `20260911110000_durable_processing_jobs.sql` before the ML and Next.js changes. The database is the source of upload/reveal status. A successful HTTP upload response means the input was accepted durably, not that the recording is ready.

## Deployment prerequisites

- Mount one persistent Railway volume. Railway supplies `RAILWAY_VOLUME_MOUNT_PATH`; the service verifies it is an actual mount. Keep the upload worker on the single service instance attached to this volume.
- Set `UPLOAD_JOB_DIR` inside that mount, for example `/data/upload-jobs`. It defaults to `upload-jobs` beneath `RECORDING_SPOOL_DIR` or the mount. Capture and delivery directories also belong inside the volume; see [capture recovery](capture-recovery.md).
- Retain `ML_ENCRYPTION_KEY` and previous rotation keys alongside durable inputs until those jobs finish. Input encryption uses a per-job/per-part context, so another upload's ciphertext cannot be substituted.
- With missing/unmounted upload storage, `/process-upload` returns 503 before accepting bytes. There is no fallback to container `/tmp`. Health exposes `durable_uploads_ready` without paths or credentials. Capture may separately require the volume during service startup.
- `UPLOAD_MAX_PENDING_BYTES` defaults to 2 GiB; `UPLOAD_MIN_FREE_BYTES` reserves 256 MiB. Capacity pressure refuses additional chunks instead of silently dropping accepted work. Increase these limits with actual volume capacity and retention needs.

## Upload lifecycle and recovery

The trusted Next proxy supplies `requested_by` from the authenticated user and a stable `session_id`. Parts are sealed, fsynced and registered in an immutable input manifest before final acceptance. The final request returns HTTP 202 with `job_id`, stable `recording_id`, `status` and `progress`. Chunk requests return `chunk_received`. Reusing a session with a different owner, filename format, camera label or acknowledged chunk content returns a conflict.

States: `queued → processing → delivering → ready`; processing can fail or be cancelled. The worker scans accepted manifests every five seconds, including manifests committed just before a database failure. Per-job OS locks prevent overlapping processors on the shared volume. Replaying a completed final request returns the saved job receipt even after input cleanup.

An interrupted processing attempt reconstructs the same encrypted input and retains the recording UUID. Its provisional recording/detection rows are cleared before retry. The capture pipeline must reach complete EOF and validate the encoded video; a timeout never publishes partial success. Processing has a one-hour bound and five interrupted attempts, with explicit operator retry after terminal failure.

`delivering` is a short, non-cancellable commit state: encrypted delivery manifests are retried until Storage and the validated recording row both acknowledge the result. If encryption itself was interrupted, its remaining source artifacts stay in the volume's restricted job work directory. Delivery recovery does not decode or render the input again. Only `ready` or explicit cancellation retires encrypted source parts. Failed accepted inputs remain available for retry; unaccepted abandoned chunks expire after 24 hours.

`GET /upload-jobs/{id}` and retry/cancel actions require the ML service token and a trusted requester identity. The Next proxy additionally enforces MFA and the owner/admin boundary. Browser roles can read authorized metadata through RLS but cannot mutate job state directly. Cancellation is allowed only in queued/processing/failed; retry only in failed with retained input. The UI must poll or refresh until a terminal status and link to playback only when ready.

## Reveal leases

A periodic worker scans queued jobs and processing jobs with expired leases every ten seconds. Both direct trigger and reconciler call the same `claim_reveal_job` transaction. It checks second-person approval, issues a fresh UUID token and leases the attempt for 90 seconds. The worker renews every 20 seconds, and all progress, failure and completion writes require the current unexpired token. Failed claims or unavailable database connections leave the persisted job discoverable.

Output objects are named `<job_id>/<attempt_token>.mp4`. An old worker therefore cannot overwrite a newer attempt's bytes. Expired ownership interrupts rendering and cannot commit an output path. Failed or ambiguous final acknowledgements preserve an artifact if deleting it could break a successfully committed output. Five interrupted attempts become an explicit failure requiring a new approved request; a healthy renewing lease is never retired by the reconciler.

## Verification and remaining operational checks

Automated tests cover encrypted input reconstruction across worker/store recreation, lost final responses, a database outage during acceptance, missing chunks, ownership, cancellation versus commit, timeout/non-EOF failure, delivery retry without rerender, lease expiry/reclaim and stale-worker fencing. `supabase/tests/durable_processing_jobs.test.sql` executes the actual lease RPCs with rollback in an isolated database.

Before production sign-off, perform a staging restart during upload processing and during an approved reveal, verify one stable recording/result, and confirm mount persistence across a replacement container. Exercise a temporary Storage outage and let the delivery queue drain. These changes do not claim that such production/staging crash tests have already been run.
