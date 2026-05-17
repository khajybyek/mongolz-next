CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  ua text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_enabled_idx ON public.push_subscriptions (enabled) WHERE enabled = true;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_self_select ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY push_subscriptions_self_insert ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_subscriptions_self_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_subscriptions_self_delete ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.push_subscriptions IS
  'Web Push subscriptions (VAPID). One row per browser/device endpoint. RLS restricts each user to their own rows.';
