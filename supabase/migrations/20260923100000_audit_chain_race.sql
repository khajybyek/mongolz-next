-- Audit hash chain: close the concurrent-insert race and verify by links.
--
-- What happened (production, 2026-09-23 02:29:11 UTC): two SESSION_PIN_REJECTED
-- rows were inserted 7 ms apart. `id` comes from the column default, which is
-- evaluated BEFORE the BEFORE-INSERT trigger runs, i.e. before the trigger
-- takes the chain lock. Transaction A drew id 829, transaction B drew 830, B
-- won the lock and chained to 828, then A chained to 830. The rows are intact
-- (each row_hash = sha256(its recorded prev_hash | fields)), but
-- verify_audit_chain() walked by id and reported 829 and 830 as broken, and
-- the next row (831) forked from 830 as well.
--
-- 1. Under the advisory lock the trigger re-draws the id whenever the one the
--    column default handed out is not above the committed tail. The lock is
--    held until commit, so id order = lock order = commit order and the
--    "last row by id" lookup always sees the true tail.
-- 2. verify_audit_chain() accepts a row when EITHER the classic id walk holds
--    (sha256(previous row's row_hash | fields) = row_hash) OR the row hashes
--    from the prev_hash it recorded and that predecessor still exists. An
--    edited row fails both (its successor's walk breaks and its old hash, the
--    successor's recorded link, is gone); a deleted row leaves its successor
--    failing both. A harmless interleaving passes (b). Rows 1–33 were
--    backfilled by the walk without rewriting prev_hash, so (a) keeps them
--    valid. Same signature: /api/audit/verify and /api/slo-status unchanged.
--
-- audit_log itself is not touched (it is immutable by trigger).

create or replace function public.audit_log_hash_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
set "TimeZone" = 'UTC'
as $$
declare
  last_id   bigint;
  last_hash text;
  payload   text;
begin
  perform pg_advisory_xact_lock(hashtext('public.audit_log.chain'));

  select a.id, a.row_hash into last_id, last_hash
  from public.audit_log a
  order by a.id desc
  limit 1;

  -- The id was drawn by the column default BEFORE the lock (see header). If a
  -- row committed meanwhile carries a higher id, re-draw above it so id order
  -- stays equal to chain order. Explicit ids above the tail (restore into an
  -- empty table, in id order) are kept.
  if last_id is not null and new.id <= last_id then
    perform setval('public.audit_log_id_seq'::regclass,
                   greatest(last_id, (select s.last_value from public.audit_log_id_seq s)));
    new.id := nextval('public.audit_log_id_seq'::regclass);
  end if;

  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.created_at := coalesce(new.created_at, now());

  payload := concat_ws(
    '|',
    new.prev_hash,
    new.action,
    coalesce(new.detail, ''),
    coalesce(new.user_id::text, ''),
    coalesce(new.user_email, ''),
    new.created_at::text
  );

  new.row_hash := encode(digest(payload, 'sha256'), 'hex');
  return new;
end;
$$;

create or replace function public.verify_audit_chain()
returns table(id bigint, expected_hash text, actual_hash text, action text, created_at timestamp with time zone)
language plpgsql
stable
set search_path = public, extensions, pg_catalog
set "TimeZone" = 'UTC'
as $$
declare
  genesis constant text := repeat('0', 64);
  prev_row text := repeat('0', 64);  -- row_hash of the previous row by id
  rec record;
  body text;
  by_order text;
  by_link text;
begin
  for rec in select * from public.audit_log a order by a.id asc loop
    body := concat_ws(
      '|',
      rec.action,
      coalesce(rec.detail, ''),
      coalesce(rec.user_id::text, ''),
      coalesce(rec.user_email, ''),
      rec.created_at::text
    );
    -- (a) the classic walk: chained to the row before it by id. Rows 1–33
    --     were backfilled this way and never had their prev_hash rewritten.
    by_order := encode(digest(prev_row || '|' || body, 'sha256'), 'hex');
    -- (b) the recorded link: chained to the prev_hash stored on the row, and
    --     that predecessor still exists. This is what an interleaved insert
    --     produces (see header); an edited or deleted row fails both.
    by_link := encode(digest(coalesce(rec.prev_hash, '') || '|' || body, 'sha256'), 'hex');

    if by_order is distinct from rec.row_hash
      and not (
        by_link = rec.row_hash
        and (rec.prev_hash = genesis
             or exists (select 1 from public.audit_log p
                        where p.row_hash = rec.prev_hash and p.id <> rec.id))
      ) then
      id := rec.id;
      expected_hash := by_order;
      actual_hash := rec.row_hash;
      action := rec.action;
      created_at := rec.created_at;
      return next;
    end if;
    prev_row := rec.row_hash;
  end loop;
end;
$$;

create index if not exists audit_log_row_hash_idx on public.audit_log (row_hash);

revoke all on function public.verify_audit_chain() from public, anon, authenticated;
grant execute on function public.verify_audit_chain() to service_role;
