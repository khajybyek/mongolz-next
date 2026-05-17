
-- Fix #3: Hide SECURITY DEFINER functions from PostgREST exposure
REVOKE EXECUTE ON FUNCTION public.notify_telegram_on_alert() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;

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
