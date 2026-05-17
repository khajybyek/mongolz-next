CREATE TABLE IF NOT EXISTS public.webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('slack', 'discord', 'generic')),
  url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- HMAC secret for `kind='generic'`. Slack/Discord trust the URL signature.
  signing_secret text,
  -- Events: subset of {alert_created, reveal_completed, system_health, audit_critical}
  events text[] NOT NULL DEFAULT '{}'::text[],
  last_fired_at timestamptz,
  last_status int,
  fail_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks: admin only" ON public.webhooks
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

COMMENT ON TABLE public.webhooks IS
  'Outgoing webhook destinations. Triggered server-side from alerts/reveal flows.';;
