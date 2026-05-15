-- ════════════════════════════════════════════════════════════════
--  Security Advisor fixes (Supabase database linter дагуу)
--   • CRITICAL: 4 view-ийг SECURITY INVOKER болгох (RLS bypass-аас сэргийлнэ)
--   • WARN: function search_path хатуу болгох (schema poisoning attack)
--   • WARN: SECURITY DEFINER functions-аас anon/authenticated EXECUTE-ыг revoke
-- ════════════════════════════════════════════════════════════════

-- ── 1. Views: SECURITY DEFINER → INVOKER ─────────────────────
-- Postgres 15+ дээр `with (security_invoker = true)` ашиглавал view-ыг
-- querying user-ийн privileges-ээр уншуулна → RLS зөв applied.
drop view if exists public.faces_by_hour;
create view public.faces_by_hour
  with (security_invoker = true) as
  select extract(hour from detected_at)::int as h, count(*)::int as c
  from public.faces
  group by h
  order by h;

drop view if exists public.faces_by_date;
create view public.faces_by_date
  with (security_invoker = true) as
  select date(detected_at) as d, count(*)::int as c
  from public.faces
  group by d
  order by d;

drop view if exists public.alerts_by_date;
create view public.alerts_by_date
  with (security_invoker = true) as
  select date(created_at) as d, count(*)::int as c
  from public.alerts
  group by d
  order by d;

drop view if exists public.top_suspects;
create view public.top_suspects
  with (security_invoker = true) as
  select suspect_name, count(*)::int as c
  from public.alerts
  group by suspect_name
  order by c desc
  limit 10;

-- ── 2. Functions: search_path хатуу болгох ──────────────────
-- Хадгалсан search_path нь schema poisoning attack-аас сэргийлнэ.
alter function public.is_admin()                         set search_path = public, pg_catalog;
alter function public.current_user_role()                set search_path = public, pg_catalog;
alter function public.handle_new_user()                  set search_path = public, pg_catalog;
alter function public.match_faces(vector, float, int)    set search_path = public, extensions, pg_catalog;
alter function public.match_suspects(vector, float, int) set search_path = public, extensions, pg_catalog;
alter function public.faces_in_recording(uuid)           set search_path = public, extensions, pg_catalog;
alter function public.audit_log_hash_trigger()           set search_path = public, extensions, pg_catalog;
alter function public.audit_log_immutable()              set search_path = public, pg_catalog;
alter function public.verify_audit_chain()               set search_path = public, extensions, pg_catalog;

-- ── 3. SECURITY DEFINER функцийг public-аас revoke ──────────
-- Тэдгээр функцууд нь зөвхөн trigger-аар эсвэл server-side-аас дуудагдах
-- ёстой. RPC route-аар client-аас дуудуулсан байх ёсгүй.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.audit_log_hash_trigger() from anon, authenticated, public;
revoke execute on function public.current_user_role() from anon, authenticated, public;
revoke execute on function public.audit_log_immutable() from anon, authenticated, public;

-- Auth-д хамаарах: Supabase Dashboard-аас "Leaked Password Protection"-ыг
-- идэвхжүүлэх ёстой (HaveIBeenPwned check). SQL-аар тохируулагдахгүй.
--   Settings → Auth → Password Policy → "Check passwords against HaveIBeenPwned"
