-- ═══════════════════════════════════════════════════════════════════════════
-- Two data-layer defects the green test suite never saw.
--
-- 1. alerts.screenshot_path pointed at objects that do not exist.
--    Measured on production before writing this (2026-09-09):
--      • alerts                                    13 rows
--      • …with screenshot_path                      1 row  ('test/trigger.jpg')
--      • …resolving to an object in ANY bucket      0
--      • storage.objects in bucket alert-screenshots 0 objects — the bucket
--        has never received a single write
--      • storage.objects in bucket faces           48 (47 legacy plaintext
--        crops + 1 sealed `.enc` from the Tier-2 encrypt-only pipeline)
--    The recording pipeline uploaded ONLY `<faces.image_path>.enc` and then
--    wrote the plain `<faces.image_path>` onto the alert row — a path in the
--    wrong bucket AND for an object that is never written. Every consumer
--    (the suspect page's "latest match" preview, the backup manifest, the CSV
--    export) therefore carried a dead reference.
--    Fix: the pipeline now writes NULL (ml-service/recording_pipeline.py) and
--    the evidence pointer is alerts.face_id → /api/faces/[id]/secure-crop,
--    which already serves sealed and legacy crops under the caller's
--    reveal_level. This migration documents the column and clears the
--    references that resolve to nothing.
--
-- 2. The pgvector ivfflat indexes were trained on near-empty tables.
--      faces_embedding_idx    ivfflat lists=200 over 42 rows
--      suspects_embedding_idx ivfflat lists=100 over 4 rows
--    ivfflat picks its centroids at BUILD time from the rows present, so a
--    list count larger than the row count leaves most lists empty and a
--    default `ivfflat.probes = 1` search inspects a single, essentially
--    random cell. Recall is not "degraded later" — it is broken now, and only
--    hidden because the planner still prefers a sequential scan at this size.
--    pgvector on this project is 0.8.0, so HNSW is available: it is built
--    incrementally, has no training set, needs no rebuild as the tables grow,
--    and gives ~0.95+ recall at the default ef_search=40. Same index names,
--    same vector_cosine_ops (match_faces / match_suspects use `<=>`).
--
-- Blast radius
--   • alerts UPDATE touches only rows whose screenshot_path resolves to no
--     object; the Telegram trigger is INSERT-only, so nothing is re-notified.
--     RLS does not apply to the migration role. No other column is written.
--   • Both CREATE INDEX statements take a brief ACCESS EXCLUSIVE lock on
--     faces / suspects (42 and 4 rows — milliseconds). While the migration
--     runs, similarity search falls back to an exact sequential scan, which
--     is correct, just slower. CONCURRENTLY is not used because Supabase runs
--     each migration in a transaction; on a large table build the index
--     manually with CONCURRENTLY instead and let this file no-op.
--   • Nothing here changes an API shape or a row's meaning.
--
-- Rollback (paste-able, restores the exact prior objects)
--   drop index if exists public.faces_embedding_idx;
--   drop index if exists public.suspects_embedding_idx;
--   create index faces_embedding_idx on public.faces
--     using ivfflat (embedding vector_cosine_ops) with (lists='200');
--   create index suspects_embedding_idx on public.suspects
--     using ivfflat (embedding vector_cosine_ops) with (lists='100');
--   -- (verbatim prior definitions from pg_get_indexdef; qualify the opclass
--   --  as extensions.vector_cosine_ops if your search_path lacks `extensions`)
--   comment on column public.alerts.screenshot_path is null;
--   -- The cleared screenshot_path values are NOT restorable and must not be:
--   -- they referenced objects that have never existed in any bucket. The one
--   -- affected row is the historical Telegram test alert ('test/trigger.jpg').
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Alert evidence ─────────────────────────────────────────────────────
comment on column public.alerts.screenshot_path is
  'Optional path in the `alert-screenshots` bucket (that is how api/admin/backup reads it). The recording pipeline writes NULL: since the Tier-2 encrypt-only change the only image produced for a detection is the sealed crop `<faces.image_path>.enc` in the `faces` bucket, so a path here would reference an object that does not exist. The evidence pointer is `face_id`; readers fetch the picture through /api/faces/[id]/secure-crop. Set this only when an object really was uploaded to `alert-screenshots`.';

update public.alerts a
   set screenshot_path = null
 where a.screenshot_path is not null
   and not exists (
     select 1
       from storage.objects o
      where o.bucket_id = 'alert-screenshots'
        and o.name = a.screenshot_path
   );

-- ── 2. pgvector indexes sized for the data that exists ────────────────────
-- The opclass is schema-qualified (`vector` is installed in `extensions` on
-- this project) so the statement does not depend on the applying client's
-- search_path; `hnsw` is an access method and is never schema-qualified.
drop index if exists public.faces_embedding_idx;
create index faces_embedding_idx
  on public.faces
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

drop index if exists public.suspects_embedding_idx;
create index suspects_embedding_idx
  on public.suspects
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ── 3. Prove the outcome rather than assume it ────────────────────────────
-- A silent no-op here would leave the same broken recall in place, so fail
-- the migration if the resulting objects are not what this file claims.
do $$
declare
  bad_index  text;
  dangling   bigint;
begin
  select string_agg(format('%s (%s)', c.relname, am.amname), ', ')
    into bad_index
    from pg_class c
    join pg_am am on am.oid = c.relam
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('faces_embedding_idx', 'suspects_embedding_idx')
     and am.amname <> 'hnsw';
  if bad_index is not null then
    raise exception 'vector index not rebuilt as hnsw: %', bad_index;
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('faces_embedding_idx', 'suspects_embedding_idx')) <> 2 then
    raise exception 'expected both vector indexes to exist after this migration';
  end if;

  select count(*) into dangling
    from public.alerts a
   where a.screenshot_path is not null
     and not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'alert-screenshots' and o.name = a.screenshot_path
     );
  if dangling > 0 then
    raise exception 'alerts still reference % missing alert-screenshots object(s)', dangling;
  end if;
end
$$;
