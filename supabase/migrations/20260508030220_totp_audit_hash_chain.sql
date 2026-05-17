-- TOTP 2FA + Audit log hash chain
alter table public.profiles
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false;

alter table public.audit_log
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

create index if not exists audit_log_row_hash_idx on public.audit_log(row_hash);

create or replace function public.audit_log_hash_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  last_hash text;
  payload   text;
begin
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

drop trigger if exists audit_log_hash_chain on public.audit_log;
create trigger audit_log_hash_chain
  before insert on public.audit_log
  for each row execute procedure public.audit_log_hash_trigger();

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log immutable - cannot modify or delete';
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
$$;;
