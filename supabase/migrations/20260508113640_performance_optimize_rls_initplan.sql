
DROP POLICY IF EXISTS "profiles: read own" ON public.profiles;
CREATE POLICY "profiles: read own"
ON public.profiles FOR SELECT
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "cameras: auth read" ON public.cameras;
CREATE POLICY "cameras: auth read"
ON public.cameras FOR SELECT
USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "recordings: auth read" ON public.recordings;
CREATE POLICY "recordings: auth read"
ON public.recordings FOR SELECT
USING ((SELECT auth.uid()) IS NOT NULL);
;
