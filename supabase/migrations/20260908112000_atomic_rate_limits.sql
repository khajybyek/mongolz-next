-- ═══════════════════════════════════════════════════════════════════════
-- Atomic, fail-closed credential throttling (2026-09-08 audit, 5.9 + 5.10)
--
-- WHAT WAS WRONG
--   Every throttle in lib/rate-limit.ts was a read-then-write counter over
--   `audit_log`: the request counted the rows an *earlier* attempt had left
--   behind, decided, and only later wrote its own row. Two consequences:
--     • Concurrency slips straight through. N requests fired together all read
--       the same pre-attempt count, all see "under the limit", and all proceed
--       — the 5-per-15-minutes login lock never sees the 6th attempt because
--       there is no 6th round.
--     • The count query failing was read as "0 attempts so far", i.e. the
--       protection disappeared during exactly the database stress an attacker
--       can induce (and audit_log inserts serialise behind a global advisory
--       lock in the hash-chain trigger, so inducing it is cheap).
--
-- WHAT THIS ADDS
--   `private.rate_limits` — one row per bucket (key), holding the current
--   window and its hit count — plus two SECURITY DEFINER entry points:
--     • public.rate_limit_hit(key, window_sec, max, cost)
--         INSERT … ON CONFLICT DO UPDATE … RETURNING, so the increment and the
--         read of the post-increment value are ONE statement. Row-level locking
--         serialises concurrent callers: they get 1, 2, 3 … N, never the same
--         number twice, so exactly `max` of them can be under the limit.
--     • public.rate_limit_release(key, window_sec, cost)
--         Gives a unit back when the credential turned out to be CORRECT, so
--         the buckets count failures, not honest use. Without it a legitimate
--         operator would lock themselves out by signing in five times.
--
-- WHY A TABLE AND NOT REDIS/UPSTASH
--   The project has exactly one shared, transactional store: Postgres. A
--   process-local counter is useless on Vercel (every lambda gets its own),
--   and audit_log is an append-only hash chain — the wrong shape for a
--   mutable counter. This table is deliberately boring: primary key, an int,
--   two timestamps, no RLS surface, no PostgREST exposure.
--
-- BLAST RADIUS
--   • New table in `private` (never exposed by PostgREST — schema is not in
--     PGRST_DB_SCHEMAS) and two new functions in `public` that only
--     service_role may EXECUTE. No existing table, policy, function, grant or
--     row is touched. Nothing reads this table except the two functions.
--   • Storage growth is bounded: rows carry `expires_at`, every call has a 2%
--     chance of sweeping up to 500 dead rows, and a pg_cron job sweeps every
--     15 minutes. Steady state at five operator accounts is single digits of
--     rows.
--   • Deploy order is safe in BOTH directions. If this migration lands before
--     the code: nothing calls the functions, no behaviour changes. If the code
--     lands before this migration: lib/rate-limit.ts recognises the "function
--     does not exist" error (SQLSTATE 42883 / PostgREST PGRST202) as
--     "not deployed yet" and falls back to the previous audit-log counter
--     instead of locking every operator out of their own console. Only the
--     not-deployed case fails open; a counter that exists and then errors
--     fails CLOSED.
--   • KILL SWITCH (app side, no DB change, no redeploy of this file):
--       RATE_LIMIT_MODE=legacy → ignore these functions, use the old audit-log
--                                counter (documented in lib/rate-limit.ts)
--       RATE_LIMIT_MODE=off    → throttling disabled entirely; use only to
--                                recover from an operator lockout, and put it
--                                back to `enforce` afterwards.
--
-- ROLLBACK (paste as the postgres role; the app keeps working — it falls back
-- to the legacy audit-log counter the moment the functions are gone):
--   select cron.unschedule('mongolz-rate-limit-sweep');
--   drop function if exists public.rate_limit_hit(text, integer, integer, integer);
--   drop function if exists public.rate_limit_release(text, integer, integer);
--   drop function if exists private.rate_limits_sweep();
--   drop table if exists private.rate_limits;
--
-- Verified before hand-off on a throwaway postgres:17 container: applies
-- clean, re-applies idempotently (rows preserved), the rollback block above
-- runs as written, and 300 increments from 12 concurrent sessions produced
-- 300 DISTINCT counts 1..300 — no two callers ever saw the same number,
-- which is the property finding 5.10 says the old counter did not have.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. The counter table ────────────────────────────────────────────────
create table if not exists private.rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0,
  expires_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table private.rate_limits is
  'Atomic credential/usage throttle buckets. One row per key (e.g. reauth:<uuid>, login_email:<email>). Written only by public.rate_limit_hit / rate_limit_release; never exposed over PostgREST.';

-- Defence in depth: the schema is unreachable over REST, but keep the table
-- itself unreadable to the API roles even if that ever changed.
alter table private.rate_limits enable row level security;
revoke all on table private.rate_limits from public, anon, authenticated;

create index if not exists rate_limits_expires_at_idx
  on private.rate_limits (expires_at);

-- ─── 2. Atomic increment ─────────────────────────────────────────────────
-- Returns the count AFTER this attempt, so `limited` is `hits > max`:
-- with max = 5 the first five attempts pass and the sixth is refused.
create or replace function public.rate_limit_hit(
  p_key        text,
  p_window_sec integer,
  p_max        integer,
  p_cost       integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = private, pg_catalog
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_window interval;
  v_hits   integer;
  v_start  timestamptz;
begin
  -- Keys come from application code, never from user input verbatim, but a
  -- bad key would silently share a bucket with someone else — so refuse it.
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    raise exception 'rate_limit_hit: key must be 1..200 chars' using errcode = '22023';
  end if;
  if p_window_sec is null or p_window_sec < 1 or p_window_sec > 604800 then
    raise exception 'rate_limit_hit: window_sec must be 1..604800' using errcode = '22023';
  end if;
  -- cost = 0 is a PEEK: it reports the bucket (rolling the window over if it
  -- has expired) without spending anything. Call sites that inspect a bucket
  -- they will not settle — e.g. the passkey login route, which must not be
  -- able to lock an account out — use it.
  if p_cost is null or p_cost < 0 or p_cost > 1000 then
    raise exception 'rate_limit_hit: cost must be 0..1000' using errcode = '22023';
  end if;

  v_window := make_interval(secs => p_window_sec);

  -- A peek must not create anything. The passkey-begin route peeks with a
  -- caller-supplied e-mail, so an INSERT here would let an unauthenticated
  -- stranger add one row per address they invent. Read the bucket instead,
  -- and report an expired window as empty.
  if p_cost = 0 then
    select rl.hits, rl.window_start into v_hits, v_start
      from private.rate_limits rl
     where rl.key = p_key;
    if not found or v_start + v_window <= v_now then
      v_hits := 0;
      v_start := v_now;
    end if;
    return jsonb_build_object(
      'count',      v_hits,
      'limited',    v_hits > p_max,
      'reset_sec',  greatest(1, ceil(extract(epoch from (v_start + v_window - v_now)))::integer),
      'window_sec', p_window_sec
    );
  end if;

  -- ONE statement: insert-or-increment and read back the new value. Two
  -- callers racing here serialise on the row lock taken by ON CONFLICT, so
  -- they cannot both observe the same count.
  insert into private.rate_limits as rl (key, window_start, hits, expires_at, updated_at)
       values (p_key, v_now, p_cost, v_now + v_window, v_now)
  on conflict (key) do update
       set hits         = case when rl.window_start + v_window <= v_now
                               then p_cost else rl.hits + p_cost end,
           window_start = case when rl.window_start + v_window <= v_now
                               then v_now else rl.window_start end,
           expires_at   = case when rl.window_start + v_window <= v_now
                               then v_now + v_window else rl.window_start + v_window end,
           updated_at   = v_now
    returning rl.hits, rl.window_start into v_hits, v_start;

  -- Opportunistic, bounded sweep (the pg_cron job below is the real one; this
  -- keeps the table tidy even if cron is unavailable). Deletes at most 500
  -- rows, only rows an hour past their window, on ~2% of calls.
  if random() < 0.02 then
    delete from private.rate_limits
     where key in (
       select key from private.rate_limits
        where expires_at < v_now - interval '1 hour'
        limit 500
     );
  end if;

  return jsonb_build_object(
    'count',     v_hits,
    'limited',   v_hits > p_max,
    'reset_sec', greatest(1, ceil(extract(epoch from (v_start + v_window - v_now)))::integer),
    'window_sec', p_window_sec
  );
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer, integer) from public, anon, authenticated;
grant  execute on function public.rate_limit_hit(text, integer, integer, integer) to service_role;
comment on function public.rate_limit_hit(text, integer, integer, integer) is
  'Atomically spends `cost` from bucket `key` and returns {count, limited, reset_sec, window_sec} for the post-increment state. cost = 0 peeks without spending. Service-role only; the sole write path for private.rate_limits.';

-- ─── 3. Refund on success ────────────────────────────────────────────────
-- Called when the credential verified: brute-force buckets must count wrong
-- answers, not honest sign-ins. Never creates a row, never goes below zero,
-- and ignores a bucket whose window has already rolled over.
create or replace function public.rate_limit_release(
  p_key        text,
  p_window_sec integer,
  p_cost       integer default 1
)
returns void
language plpgsql
security definer
set search_path = private, pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    return;
  end if;
  if p_window_sec is null or p_window_sec < 1 or p_cost is null or p_cost < 1 then
    return;
  end if;

  update private.rate_limits
     set hits = greatest(0, hits - p_cost),
         updated_at = v_now
   where key = p_key
     and window_start + make_interval(secs => p_window_sec) > v_now;
end;
$$;

revoke execute on function public.rate_limit_release(text, integer, integer) from public, anon, authenticated;
grant  execute on function public.rate_limit_release(text, integer, integer) to service_role;
comment on function public.rate_limit_release(text, integer, integer) is
  'Gives back `cost` in bucket `key` after a SUCCESSFUL credential check, so throttles count failures rather than honest use. Never creates rows, never goes negative.';

-- ─── 4. Scheduled sweep ──────────────────────────────────────────────────
-- pg_cron already runs the uptime monitor in this project, so this costs
-- nothing new operationally. Idempotent: unschedule (ignoring "not found")
-- then schedule, the same shape as 20260906170200_uptime_monitor_pg_cron.sql.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.rate_limits_sweep()
returns void
language sql
security definer
set search_path = private, pg_catalog
as $$
  delete from private.rate_limits where expires_at < now() - interval '1 hour';
$$;

revoke all on function private.rate_limits_sweep() from public, anon, authenticated;
comment on function private.rate_limits_sweep() is
  'Removes throttle buckets whose window closed over an hour ago. Scheduled as mongolz-rate-limit-sweep (every 15 minutes).';

do $$
begin
  perform cron.unschedule('mongolz-rate-limit-sweep');
exception when others then null;
end $$;

select cron.schedule('mongolz-rate-limit-sweep', '*/15 * * * *', $$select private.rate_limits_sweep()$$);
