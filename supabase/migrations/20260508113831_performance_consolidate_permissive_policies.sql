
-- A) Admin-only tables: admin write (ALL) аль хэдийн SELECT-ийг хамардаг → admin read устгана
DROP POLICY IF EXISTS "alerts: admin read" ON public.alerts;
DROP POLICY IF EXISTS "clusters: admin read" ON public.clusters;
DROP POLICY IF EXISTS "faces: admin read" ON public.faces;
DROP POLICY IF EXISTS "reveal_jobs: admin read" ON public.reveal_jobs;
DROP POLICY IF EXISTS "suspects: admin read" ON public.suspects;

-- B) Mixed tables (cameras, recordings): admin write FOR ALL → INSERT/UPDATE/DELETE-д тусгаарлана
--    Admin-ийн SELECT нь auth read policy-аар явна (admin бол authenticated-ийн дэд олонлог)
DROP POLICY IF EXISTS "cameras: admin write" ON public.cameras;
CREATE POLICY "cameras: admin insert"
  ON public.cameras FOR INSERT
  WITH CHECK (is_admin());
CREATE POLICY "cameras: admin update"
  ON public.cameras FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "cameras: admin delete"
  ON public.cameras FOR DELETE
  USING (is_admin());

DROP POLICY IF EXISTS "recordings: admin write" ON public.recordings;
CREATE POLICY "recordings: admin insert"
  ON public.recordings FOR INSERT
  WITH CHECK (is_admin());
CREATE POLICY "recordings: admin update"
  ON public.recordings FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "recordings: admin delete"
  ON public.recordings FOR DELETE
  USING (is_admin());

-- C) profiles: 2 SELECT policy нэгтгэх
DROP POLICY IF EXISTS "profiles: read own" ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin reads all" ON public.profiles;
CREATE POLICY "profiles: read"
  ON public.profiles FOR SELECT
  USING (id = (SELECT auth.uid()) OR is_admin());
;
