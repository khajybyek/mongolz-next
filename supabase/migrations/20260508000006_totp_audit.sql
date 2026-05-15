-- ════════════════════════════════════════════════════════════════
--  Production hardening migration:
--   • TOTP 2FA support (profiles.totp_secret + totp_enabled)
--   • Audit log hash chain (immutable forensic trail)
-- ════════════════════════════════════════════════════════════════

-- ── 1. TOTP 2FA (profiles) ────────────────────────────────────
alter table public.profiles
  add column if not exists totp_secret text,        -- base32 secret (RFC 6238)
  add column if not exists totp_enabled boolean not null default false;

comment on column public.profiles.totp_secret is
  'TOTP base32 secret (RFC 6238). Setup-ийн үед үүсгэгдэх. enabled=false бол байх ёсгүй.';

-- ── 2. Audit log hash chain ─────────────────────────────────
alter table public.audit_log
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

create index if not exists audit_log_row_hash_idx on public.audit_log(row_hash);

-- Hash chain trigger — INSERT-ийн өмнө prev_hash болон row_hash тооцоолно.
-- Гарах: row_hash = sha256(prev_hash || action || detail || user_id || created_at).
-- Үүгээр audit log-ыг буцаж засварласан тохиолдолд chain эвдрэх → forensic үнэн.
create or replace function public.audit_log_hash_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  last_hash text;
  payload   text;
begin
  -- Хамгийн сүүлийн audit row-ийн hash-ыг олно
  select row_hash into last_hash
  from public.audit_log
  order by id desc
  limit 1;

  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.created_at := coalesce(new.created_at, now());

  -- Concat critical fields (chain integrity-д хамгийн чухал)
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

drop trigger if exists audit_log_hash_chain on public.audit_log;
create trigger audit_log_hash_chain
  before insert on public.audit_log
  for each row execute procedure public.audit_log_hash_trigger();

-- UPDATE/DELETE-ыг бүрмөсөн зогсоох (service_role ч өөрчилж болохгүй).
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log өөрчлөгдөшгүй (immutable). Чи яагаад үүнийг өөрчилж байгаа вэ?';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute procedure public.audit_log_immutable();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute procedure public.audit_log_immutable();

-- ── 3. Verify integrity helper RPC ─────────────────────────
-- SELECT * FROM public.verify_audit_chain() — buruu hash row-уудыг буцаана.
-- Хоосон жагсаалт = chain integrity-зөв.
create or replace function public.verify_audit_chain()
returns table (
  id bigint,
  expected_hash text,
  actual_hash text,
  action text,
  created_at timestamptz
)
language plpgsql
stable
as $$
declare
  last_hash text := repeat('0', 64);
  rec record;
  expected text;
  payload text;
begin
  for rec in
    select * from public.audit_log order by id asc
  loop
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

comment on function public.verify_audit_chain() is
  'Audit log hash chain-ийн интегрити шалгана. Хоосон result = OK. Row буцвал tampered.';
