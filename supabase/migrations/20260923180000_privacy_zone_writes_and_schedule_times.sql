-- Privacy-zone writes and schedule times (2026-09-23 debugging pass).
--
-- 1. privacy_zones: service-role writes only.
--    never_reveal zones are a live reveal control (reveal_job.py drops
--    matches inside them). /api/privacy-zones now requires a TOTP step-up to
--    delete, disable or loosen a zone and writes through the service role,
--    but `authenticated` still held INSERT/UPDATE/DELETE/TRUNCATE, so a
--    stolen admin token could `DELETE /rest/v1/privacy_zones` directly —
--    no step-up, no audit row. Same pattern as cameras / retention_policies
--    / camera_permissions in 20260917150000_admin_privilege_hardening.sql.
--    SELECT stays (the admin page lists zones through RLS). `anon` had the
--    full default grant too; RLS already refused it, the grant goes as well.
--
--    The app works before this migration is applied: the route already
--    writes with createServiceClient().
revoke insert, update, delete, truncate, references, trigger
  on public.privacy_zones from authenticated;
revoke all on public.privacy_zones from anon;

-- 2. masking_schedules: reject hours 24-29.
--    The original CHECK '^[0-2][0-9]:[0-5][0-9]$' accepted '29:00';
--    effective_mask_mode() then raised 22008 on the ::time cast and the page
--    fell back to "masked" for that camera. 00:00-23:59 plus '24:00' (valid
--    end-of-day in Postgres). The table is empty in production (checked
--    2026-09-23), so the new constraints validate immediately.
-- safety: ok — only replaces two CHECK constraints with stricter ones on an
-- empty table; the web action enforces the same regex, so no running code
-- writes a value the new constraint rejects.
alter table public.masking_schedules
  drop constraint if exists masking_schedules_starts_at_check,
  drop constraint if exists masking_schedules_ends_at_check;

alter table public.masking_schedules
  add constraint masking_schedules_starts_at_check
    check (starts_at ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  add constraint masking_schedules_ends_at_check
    check (ends_at ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$');
