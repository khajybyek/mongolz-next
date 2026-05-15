-- ════════════════════════════════════════════════════════════════
--  Seed data — local dev-д зөвхөн ажиллана
-- ════════════════════════════════════════════════════════════════

-- Эхний admin user үүсгэх:
--   1. Supabase Studio (http://localhost:54323) → Auth → Add User
--   2. эсвэл `supabase auth signup` ашиглана
--   3. Дараа нь энэ SQL-ээр profile.role = 'admin' болгоно:
--
-- update public.profiles set role = 'admin' where email = 'admin@mongolz.local';

-- Жишээ камерууд (RTSP demo)
insert into public.cameras (name, url, cam_type, enabled) values
  ('Гол хаалга', 'rtsp://admin:pass@192.168.0.15:554/cam/realmonitor?channel=1&subtype=0', 'rtsp', true),
  ('Лобби',     'rtsp://admin:pass@192.168.0.16:554/cam/realmonitor?channel=1&subtype=0', 'rtsp', false)
on conflict do nothing;
