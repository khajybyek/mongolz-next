-- ═══════════════════════════════════════════════════════════════════════
-- Auth hardening — findings from the 2026-09-06 full audit.
-- safety: ok — the only DROP CONSTRAINT here removes an FK (no data change);
-- see section 5 for the rationale.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. handle_new_user: no caller-controlled role, no self-service signup ──
-- The trigger used to take `role` from raw_user_meta_data, i.e. from whatever
-- the signup caller sent in `options.data`. With signups enabled on the
-- project, anyone holding the public anon key could register as admin.
-- Accounts are provisioned by an administrator (auth.admin.createUser with
-- email_confirm=true), which arrive already confirmed; a GoTrue self-signup
-- arrives unconfirmed → refuse, which aborts the signup transaction.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.email_confirmed_at is null and new.phone_confirmed_at is null then
    raise exception 'self-service signup is disabled — accounts are provisioned by an administrator'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'viewer'   -- never from user metadata; /users assigns the real role afterwards
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 2. protect_super_admin: make the guard actually run ───────────────────
-- Inside a SECURITY DEFINER function `current_user` is the owner (postgres),
-- so `is_privileged` was always true and every guard was skipped. Decide
-- from the PostgREST JWT role claim instead (NULL = direct SQL / Studio =
-- trusted) and run as invoker.
create or replace function public.protect_super_admin()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  jwt_claims text := current_setting('request.jwt.claims', true);
  caller text;
  is_privileged boolean;
begin
  caller := coalesce(nullif(jwt_claims, '')::jsonb->>'role', current_user);
  is_privileged := caller in ('postgres', 'supabase_admin', 'service_role',
                              'supabase_storage_admin', 'supabase_auth_admin');

  if tg_op = 'DELETE' then
    if old.is_super_admin and not is_privileged then
      raise exception 'super admin cannot be deleted via app — use Supabase Studio (caller=%)', caller
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.is_super_admin and not is_privileged then
      raise exception 'super admin flag can only be set via Supabase Studio'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if old.is_super_admin then
    if not is_privileged then
      if new.is_super_admin = false then
        raise exception 'cannot revoke super admin via app — use Supabase Studio'
          using errcode = 'insufficient_privilege';
      end if;
      if new.role is distinct from old.role then
        raise exception 'cannot change role of super admin via app'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  elsif new.is_super_admin and not is_privileged then
    raise exception 'super admin flag can only be granted via Supabase Studio'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ── 3. profiles: secrets are never readable/writable with a user JWT ──────
-- `authenticated` held table-level SELECT/UPDATE (Supabase defaults) plus the
-- "admin updates all" policy, so a stolen session could read its own
-- totp_secret / recovery hashes, an admin JWT could read every user's, and
-- any admin could rewrite role / reveal_level / is_super_admin over REST,
-- bypassing step-up, audit and last-admin protection. All app writes to
-- these columns already go through the service role.
revoke all on public.profiles from anon, authenticated;
grant select (id, email, full_name, role, totp_enabled, is_super_admin,
              reveal_level, username, created_at, updated_at)
  on public.profiles to authenticated;
drop policy if exists "profiles: admin updates all" on public.profiles;

-- ── 4. webauthn_credentials: reads + self-delete only ─────────────────────
-- The self policy was FOR ALL, so a user JWT could plant an attacker key or
-- reset the clone-detection counter over REST. Inserts/updates are done by
-- the service role after the WebAuthn ceremony.
drop policy if exists "webauthn_credentials: self" on public.webauthn_credentials;
create policy "webauthn_credentials: self read" on public.webauthn_credentials
  for select using (user_id = (select auth.uid()));
create policy "webauthn_credentials: self delete" on public.webauthn_credentials
  for delete using (user_id = (select auth.uid()));
revoke insert, update on public.webauthn_credentials from anon, authenticated;

-- ── 5. audit_log.user_id FK blocked every user deletion ───────────────────
-- ON DELETE SET NULL is executed as an UPDATE on audit_log, which the
-- immutability trigger refuses, so GDPR erasure and /users delete could
-- never complete for anyone with an audit row. The ledger keeps the uuid
-- verbatim (it is part of the row hash) and simply dangles after erasure.
alter table public.audit_log drop constraint if exists audit_log_user_id_fkey;

-- ── 6. Audit hash chain: serialise + timezone-independent payload ─────────
-- Two concurrent inserts could read the same `last_hash` (fork race) and
-- produce a false "tamper" alarm; `created_at::text` depended on the
-- session TimeZone. Take an advisory lock and pin UTC (all existing rows
-- were hashed under UTC sessions — the chain verifies clean, 0 broken).
create or replace function public.audit_log_hash_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
set "TimeZone" = 'UTC'
as $$
declare
  last_hash text;
  payload   text;
begin
  perform pg_advisory_xact_lock(hashtext('public.audit_log.chain'));

  select row_hash into last_hash
  from public.audit_log
  order by id desc
  limit 1;

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
returns table(id bigint, expected_hash text, actual_hash text, action text, created_at timestamptz)
language plpgsql
stable
set search_path = public, extensions, pg_catalog
set "TimeZone" = 'UTC'
as $$
declare
  last_hash text := repeat('0', 64);
  rec record;
  expected text;
  payload text;
begin
  for rec in select * from public.audit_log order by id asc loop
    payload := concat_ws(
      '|',
      last_hash,
      rec.action,
      coalesce(rec.detail, ''),
      coalesce(rec.user_id::text, ''),
      coalesce(rec.user_email, ''),
      rec.created_at::text
    );
    expected := encode(digest(payload, 'sha256'), 'hex');
    if expected != coalesce(rec.row_hash, '') then
      id := rec.id;
      expected_hash := expected;
      actual_hash := rec.row_hash;
      action := rec.action;
      created_at := rec.created_at;
      return next;
    end if;
    last_hash := rec.row_hash;
  end loop;
end;
$$;

-- ── 7. RPCs: close the implicit PUBLIC grant ──────────────────────────────
-- `REVOKE … FROM anon` is a no-op while PUBLIC still holds EXECUTE.
revoke execute on function public.match_faces(extensions.vector, double precision, integer) from public, anon;
revoke execute on function public.match_suspects(extensions.vector, double precision, integer) from public, anon;
revoke execute on function public.verify_audit_chain() from public, anon;
alter default privileges in schema public revoke execute on functions from public;
