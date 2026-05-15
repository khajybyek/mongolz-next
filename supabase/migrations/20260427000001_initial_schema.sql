-- ════════════════════════════════════════════════════════════════
--  MONGOLZ Security — Initial Schema
--  PostgreSQL 15 + pgvector (512-dim ArcFace embeddings)
-- ════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════
-- 1. profiles  — Supabase Auth user-тэй холбогдсон role
-- ════════════════════════════════════════════════════════════════
create type user_role as enum ('admin', 'viewer');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        user_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

-- Auth signup trigger — auth.users → public.profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ════════════════════════════════════════════════════════════════
-- 2. cameras  — IP CCTV-нүүд
-- ════════════════════════════════════════════════════════════════
create table public.cameras (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  url         text not null,
  cam_type    text not null default 'rtsp' check (cam_type in ('rtsp', 'http', 'usb', 'webcam')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

create index cameras_enabled_idx on public.cameras(enabled);

-- ════════════════════════════════════════════════════════════════
-- 3. suspects  — Сэжигтэн (зураг + ArcFace embedding)
-- ════════════════════════════════════════════════════════════════
create table public.suspects (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  image_path  text not null,           -- supabase storage path: suspects/<id>.jpg
  embedding   vector(512) not null,    -- pgvector — Python ML service-ээс ирнэ
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

create index suspects_embedding_idx on public.suspects
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ════════════════════════════════════════════════════════════════
-- 4. faces  — Илрүүлсэн нүүрнүүд
-- ════════════════════════════════════════════════════════════════
create table public.faces (
  id          uuid primary key default uuid_generate_v4(),
  filename    text not null unique,
  image_path  text not null,           -- supabase storage path: faces/<filename>
  embedding   vector(512) not null,
  camera_id   uuid references public.cameras(id) on delete set null,
  detected_at timestamptz not null default now()
);

create index faces_embedding_idx on public.faces
  using ivfflat (embedding vector_cosine_ops) with (lists = 200);
create index faces_detected_at_idx on public.faces(detected_at desc);
create index faces_camera_id_idx on public.faces(camera_id);

-- ════════════════════════════════════════════════════════════════
-- 5. alerts  — Сэжигтэн тааралт ирвэл
-- ════════════════════════════════════════════════════════════════
create table public.alerts (
  id              uuid primary key default uuid_generate_v4(),
  suspect_id      uuid not null references public.suspects(id) on delete cascade,
  suspect_name    text not null,
  face_id         uuid references public.faces(id) on delete set null,
  similarity      real not null check (similarity >= 0 and similarity <= 1),
  screenshot_path text,
  camera_id       uuid references public.cameras(id) on delete set null,
  camera_name     text default 'Unknown',
  created_at      timestamptz not null default now()
);

create index alerts_created_at_idx on public.alerts(created_at desc);
create index alerts_suspect_id_idx on public.alerts(suspect_id);

-- ════════════════════════════════════════════════════════════════
-- 6. recordings  — Бичлэгүүд
-- ════════════════════════════════════════════════════════════════
create table public.recordings (
  id            uuid primary key default uuid_generate_v4(),
  filename      text not null unique,
  storage_path  text not null,         -- supabase storage path: recordings/<filename>
  duration_sec  integer,
  size_bytes    bigint,
  encrypted     boolean not null default false,
  has_original  boolean not null default false,  -- _src.mp4 байгаа эсэх (Reveal-д)
  camera_id     uuid references public.cameras(id) on delete set null,
  camera_name   text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index recordings_started_at_idx on public.recordings(started_at desc);
create index recordings_camera_id_idx on public.recordings(camera_id);

-- ════════════════════════════════════════════════════════════════
-- 7. audit_log  — Бүх чухал үйлдэл бүртгэгдэнэ
-- ════════════════════════════════════════════════════════════════
create table public.audit_log (
  id          bigserial primary key,
  action      text not null,
  detail      text,
  user_id     uuid references public.profiles(id) on delete set null,
  user_email  text,
  ip          inet,
  created_at  timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log(created_at desc);
create index audit_log_action_idx on public.audit_log(action);
create index audit_log_user_id_idx on public.audit_log(user_id);

-- ════════════════════════════════════════════════════════════════
-- 8. clusters  — Нүүрний бүлгийн үр дүн
-- ════════════════════════════════════════════════════════════════
create table public.clusters (
  id          bigserial primary key,
  cluster_id  integer not null,
  face_id     uuid not null references public.faces(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

create index clusters_cluster_id_idx on public.clusters(cluster_id);

-- ════════════════════════════════════════════════════════════════
-- HELPER: Сэжигтэн хайх — pgvector cosine similarity
-- ════════════════════════════════════════════════════════════════
create or replace function public.match_suspects(
  query_embedding vector(512),
  match_threshold float default 0.45,
  match_limit int default 5
)
returns table (
  id uuid,
  name text,
  image_path text,
  similarity float
)
language sql stable
as $$
  select
    s.id,
    s.name,
    s.image_path,
    1 - (s.embedding <=> query_embedding) as similarity
  from public.suspects s
  where 1 - (s.embedding <=> query_embedding) > match_threshold
  order by s.embedding <=> query_embedding
  limit match_limit;
$$;

create or replace function public.match_faces(
  query_embedding vector(512),
  match_threshold float default 0.50,
  match_limit int default 50
)
returns table (
  id uuid,
  filename text,
  image_path text,
  detected_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    f.id,
    f.filename,
    f.image_path,
    f.detected_at,
    1 - (f.embedding <=> query_embedding) as similarity
  from public.faces f
  where 1 - (f.embedding <=> query_embedding) > match_threshold
  order by f.embedding <=> query_embedding
  limit match_limit;
$$;

-- ════════════════════════════════════════════════════════════════
-- ANALYTICS views
-- ════════════════════════════════════════════════════════════════
create or replace view public.faces_by_hour as
  select extract(hour from detected_at)::int as h, count(*)::int as c
  from public.faces
  group by h
  order by h;

create or replace view public.faces_by_date as
  select date(detected_at) as d, count(*)::int as c
  from public.faces
  group by d
  order by d;

create or replace view public.alerts_by_date as
  select date(created_at) as d, count(*)::int as c
  from public.alerts
  group by d
  order by d;

create or replace view public.top_suspects as
  select suspect_name, count(*)::int as c
  from public.alerts
  group by suspect_name
  order by c desc
  limit 10;
