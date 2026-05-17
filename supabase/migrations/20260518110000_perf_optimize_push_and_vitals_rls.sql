-- Wrap auth.uid() in (SELECT auth.uid()) so Postgres caches the value
-- once per query instead of re-evaluating per row.
DROP POLICY IF EXISTS push_subscriptions_self_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_self_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_self_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_self_delete ON public.push_subscriptions;

CREATE POLICY push_subscriptions_self_select ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_self_insert ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_self_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_self_delete ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS web_vitals_insert_authenticated ON public.web_vitals;
CREATE POLICY web_vitals_insert_authenticated ON public.web_vitals
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- Cover the FK on web_vitals.user_id for cascade-delete + filter queries.
CREATE INDEX IF NOT EXISTS web_vitals_user_id_idx ON public.web_vitals (user_id) WHERE user_id IS NOT NULL;
