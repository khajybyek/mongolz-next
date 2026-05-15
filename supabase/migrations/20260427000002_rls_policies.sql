-- ════════════════════════════════════════════════════════════════
--  Row Level Security — admin / viewer тусдаа хандалт
-- ════════════════════════════════════════════════════════════════

-- HELPER: Тухайн user-ийн role-г уншиx
create or replace function public.current_user_role()
returns user_role
language sql stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select public.current_user_role() = 'admin'
$$;

-- ── profiles ────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles: admin reads all" on public.profiles
  for select using (public.is_admin());

create policy "profiles: admin updates all" on public.profiles
  for update using (public.is_admin());

-- ── cameras ─────────────────────────────────────────
alter table public.cameras enable row level security;

create policy "cameras: auth read" on public.cameras
  for select using (auth.uid() is not null);

create policy "cameras: admin write" on public.cameras
  for all using (public.is_admin()) with check (public.is_admin());

-- ── suspects ────────────────────────────────────────
alter table public.suspects enable row level security;

create policy "suspects: admin read" on public.suspects
  for select using (public.is_admin());

create policy "suspects: admin write" on public.suspects
  for all using (public.is_admin()) with check (public.is_admin());

-- ── faces ───────────────────────────────────────────
alter table public.faces enable row level security;

create policy "faces: admin read" on public.faces
  for select using (public.is_admin());

create policy "faces: admin write" on public.faces
  for all using (public.is_admin()) with check (public.is_admin());

-- ── alerts ──────────────────────────────────────────
alter table public.alerts enable row level security;

create policy "alerts: admin read" on public.alerts
  for select using (public.is_admin());

create policy "alerts: admin write" on public.alerts
  for all using (public.is_admin()) with check (public.is_admin());

-- ── recordings ──────────────────────────────────────
alter table public.recordings enable row level security;

create policy "recordings: auth read" on public.recordings
  for select using (auth.uid() is not null);

create policy "recordings: admin write" on public.recordings
  for all using (public.is_admin()) with check (public.is_admin());

-- ── audit_log ───────────────────────────────────────
alter table public.audit_log enable row level security;

create policy "audit_log: admin read" on public.audit_log
  for select using (public.is_admin());

-- Бичих эрхийг service_role-д л үлдээнэ (Python ML service + Next.js server actions)
-- (RLS-аас алгасч service_role bypass хийгдэнэ)

-- ── clusters ────────────────────────────────────────
alter table public.clusters enable row level security;

create policy "clusters: admin read" on public.clusters
  for select using (public.is_admin());

create policy "clusters: admin write" on public.clusters
  for all using (public.is_admin()) with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════
-- STORAGE buckets — suspect зураг, нүүр, бичлэг, screenshot
-- ════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values
  ('suspects', 'suspects', false),
  ('faces', 'faces', false),
  ('recordings', 'recordings', false),
  ('alert-screenshots', 'alert-screenshots', false)
on conflict (id) do nothing;

-- Storage policies — admin бүгдийг, viewer зөвхөн faces+recordings унших
create policy "storage: admin all-buckets all" on storage.objects
  for all using (public.is_admin()) with check (public.is_admin());

create policy "storage: viewer read recordings" on storage.objects
  for select using (
    auth.uid() is not null
    and bucket_id in ('recordings')
  );
