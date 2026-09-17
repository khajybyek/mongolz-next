-- SCH Esports (Chuseok 2026) — public registration + organiser console.
--
-- Replaces the Google Form. One submission is one person plus one row per
-- game they enter (a player may sign up for all three days), so the
-- organiser sees per-game lists and the balanced draw works per game.
-- Registrant data is personal (name, email, phone, Facebook), so the rows
-- are visible to admins only, behind the same second-factor gate as the
-- rest of the personal-data tables; the public form inserts and the public
-- teams page reads through the service role on the server. No anon policy
-- exists on purpose.

create table public.sch_event (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Chuseok 2026 SCH Esport тэмцээн'
    check (char_length(btrim(title)) between 3 and 120),
  intro text check (intro is null or char_length(intro) <= 4000),
  registration_open boolean not null default true,
  registration_deadline timestamptz,
  fee_krw integer not null default 5000 check (fee_krw >= 0),
  fee_mnt integer not null default 12000 check (fee_mnt >= 0),
  payment_info text check (payment_info is null or char_length(payment_info) <= 1000),
  contact text check (contact is null or char_length(contact) <= 300),
  game_dates jsonb not null default
    '{"mobile_legends":"2026-09-25","cs2":"2026-09-26","dota2":"2026-09-27"}'::jsonb,
  teams_published jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.sch_event (id, intro) values (1,
  'Тэмцээн 9/25 – 9/27-ний хооронд болно.'
  || chr(10) || 'Бүх оюутныг тэгш оролцоогоор хангаж, илүү сонирхолтой, нөхөрсөг өрсөлдөөнийг бүрдүүлэхийн тулд оролцогчдыг rank-д нь үндэслэн багуудын түвшинг аль болох тэнцвэртэй байхаар тооцож, багийн хуваарилалтыг random байдлаар хийнэ.'
  || chr(10) || 'Төлбөрөө төлсөн тохиолдолд л бүртгэл баталгаажна.');

create table public.sch_teams (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('mobile_legends', 'cs2', 'dota2')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  seed integer not null check (seed >= 1),
  strength integer not null default 0 check (strength >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (game, seed)
);

create table public.sch_registrations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  game text not null check (game in ('mobile_legends', 'cs2', 'dota2')),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email) <= 254),
  facebook text not null check (char_length(btrim(facebook)) between 2 and 200),
  phone text check (phone is null or char_length(phone) <= 32),
  in_game_id text check (in_game_id is null or char_length(in_game_id) <= 120),
  rank_label text check (rank_label is null or char_length(rank_label) <= 40),
  rank_score integer not null default 0 check (rank_score between 0 and 100),
  roles text[] not null default '{}',
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'waitlist', 'rejected', 'cancelled')),
  paid_at timestamptz,
  checked_in_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  team_id uuid references public.sch_teams(id) on delete set null,
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One entry per player per game; the address is matched case-insensitively.
create unique index sch_registrations_game_email_idx
  on public.sch_registrations (game, lower(email));
create index sch_registrations_game_status_idx
  on public.sch_registrations (game, status, created_at desc);
create index sch_registrations_submission_idx on public.sch_registrations (submission_id);
create index sch_registrations_team_idx on public.sch_registrations (team_id);

create function public.sch_touch_updated_at()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.sch_touch_updated_at() from public, anon;

create trigger sch_registrations_touch before update on public.sch_registrations
  for each row execute function public.sch_touch_updated_at();
create trigger sch_event_touch before update on public.sch_event
  for each row execute function public.sch_touch_updated_at();

alter table public.sch_event enable row level security;
alter table public.sch_teams enable row level security;
alter table public.sch_registrations enable row level security;

create policy "sch_event: admin" on public.sch_event
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "sch_teams: admin" on public.sch_teams
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "sch_registrations: admin" on public.sch_registrations
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "sch_registrations: second factor required" on public.sch_registrations
  as restrictive for all to authenticated
  using ((select private.mfa_ok())) with check ((select private.mfa_ok()));

revoke all on public.sch_event, public.sch_teams, public.sch_registrations from anon;
grant select, insert, update, delete
  on public.sch_event, public.sch_teams, public.sch_registrations to authenticated;
grant all on public.sch_event, public.sch_teams, public.sch_registrations to service_role;
