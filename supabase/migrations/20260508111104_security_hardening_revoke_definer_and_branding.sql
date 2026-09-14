
-- Fix #3: Hide SECURITY DEFINER functions from PostgREST exposure
REVOKE EXECUTE ON FUNCTION public.notify_telegram_on_alert() FROM anon, authenticated, public;
-- `rls_auto_enable()` existed in an early development database but was never
-- part of the checked-in schema.  A fresh `supabase db reset` therefore has
-- nothing to revoke and used to stop here.  Keep the hardening for databases
-- that still have the legacy helper without breaking clean installations.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public';
  END IF;
END
$$;

-- Fix #4: Restrict branding bucket — only specific files publicly visible (no listing)
DROP POLICY IF EXISTS "branding_public_read" ON storage.objects;
CREATE POLICY "branding_public_read"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'branding'
  AND name = ANY(ARRAY['logo.png', 'logo-text.svg', 'favicon.png', 'apple-icon.png'])
);
;
