-- Supabase performance advisor flagged 18 instances of "Multiple Permissive
-- Policies" across camera_permissions, masking_schedules, retention_policies.
-- Each table had a generic `FOR ALL` admin policy plus a separate SELECT
-- policy for normal users, so every SELECT had to evaluate two permissive
-- expressions instead of one.
--
-- Fix: split the FOR ALL admin policy into discrete INSERT / UPDATE / DELETE
-- policies. The existing SELECT policies already cover admin reads (via
-- is_admin() OR via "any authenticated reader"), so the FOR ALL was overkill
-- on the read path.

-- ─── camera_permissions ────────────────────────────────────────────────
-- Old:
--   FOR ALL  using is_admin()
--   FOR SELECT using user_id = auth.uid()
-- Multiple permissive policies for SELECT (admin and self-read).
-- New:
--   FOR SELECT using (is_admin() OR user_id = auth.uid())  -- single SELECT
--   FOR INSERT/UPDATE/DELETE: admin-only.
DROP POLICY IF EXISTS "camera_permissions: admin manage" ON public.camera_permissions;
DROP POLICY IF EXISTS "camera_permissions: user self read" ON public.camera_permissions;

CREATE POLICY "camera_permissions: read self or admin"
  ON public.camera_permissions FOR SELECT
  USING (private.is_admin() OR user_id = ( SELECT auth.uid() ));

CREATE POLICY "camera_permissions: admin insert"
  ON public.camera_permissions FOR INSERT
  WITH CHECK (private.is_admin());

CREATE POLICY "camera_permissions: admin update"
  ON public.camera_permissions FOR UPDATE
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY "camera_permissions: admin delete"
  ON public.camera_permissions FOR DELETE
  USING (private.is_admin());

-- ─── masking_schedules ──────────────────────────────────────────────────
-- Old:
--   FOR ALL  using is_admin()      ← matches SELECT too, hence overlap
--   FOR SELECT using auth.uid() IS NOT NULL  ← any signed-in user
-- New keeps the "any auth reader" SELECT semantics, splits writes admin-only.
DROP POLICY IF EXISTS "masking_schedules: admin write" ON public.masking_schedules;
-- "auth read" stays as-is and is now the single permissive SELECT policy.

CREATE POLICY "masking_schedules: admin insert"
  ON public.masking_schedules FOR INSERT
  WITH CHECK (private.is_admin());

CREATE POLICY "masking_schedules: admin update"
  ON public.masking_schedules FOR UPDATE
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY "masking_schedules: admin delete"
  ON public.masking_schedules FOR DELETE
  USING (private.is_admin());

-- ─── retention_policies ─────────────────────────────────────────────────
-- Same shape as masking_schedules.
DROP POLICY IF EXISTS "retention_policies: admin write" ON public.retention_policies;

CREATE POLICY "retention_policies: admin insert"
  ON public.retention_policies FOR INSERT
  WITH CHECK (private.is_admin());

CREATE POLICY "retention_policies: admin update"
  ON public.retention_policies FOR UPDATE
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY "retention_policies: admin delete"
  ON public.retention_policies FOR DELETE
  USING (private.is_admin());
