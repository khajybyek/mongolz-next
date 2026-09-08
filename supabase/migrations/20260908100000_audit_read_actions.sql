-- Read-access ledger support (2026-09-08 audit, finding 1 / 6.2).
--
-- The app now writes a row when someone *reads* personal data, not only when
-- they change it: FACE_CROP_VIEWED, RECORDING_VIEWED, STREAM_VIEWED,
-- STREAM_DENIED, FACE_SEARCH, REID_TRAIL, ALERTS_EXPORTED,
-- REVEAL_OUTPUT_DOWNLOADED (lib/audit.ts is the single source of truth for
-- the names). No schema change is needed for that — `audit_log.action` is
-- free text and the /audit filter list is fed by the `audit_actions` view.
--
-- What this migration adds is the index those routes lean on. Object-scoped
-- reads collapse to one row per user per object per 5 minutes, and the hot
-- path (an HLS player re-fetching index.m3u8 every few seconds) checks the
-- ledger itself before inserting:
--
--   select id from public.audit_log
--    where action = $1 and user_id = $2 and detail = $3
--      and created_at >= now() - interval '5 minutes';
--
-- The pre-existing single-column indexes (user_id, action, created_at) made
-- that a filter over every row a user has ever produced — fine at 555 rows,
-- but read events are the highest-volume rows in the table, so the ledger
-- would end up throttling itself as it grows. This composite index answers
-- the probe directly, and also serves the /audit page's common
-- "this operator, this action, most recent first" query.
--
-- Additive and idempotent: no data is rewritten, nothing is dropped, and the
-- table is small enough that a plain (non-concurrent) build is a no-op
-- lock-wise. Supabase runs migrations inside a transaction, where
-- CREATE INDEX CONCURRENTLY is not permitted.

create index if not exists audit_log_user_action_time_idx
  on public.audit_log (user_id, action, created_at desc);

comment on index public.audit_log_user_action_time_idx is
  'Serves the read-access throttle probe in lib/audit.ts (one row per user per object per window) and per-user action history on /audit.';
