
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

DROP POLICY IF EXISTS "branding_public_read" ON storage.objects;
CREATE POLICY "branding_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "branding_admin_write" ON storage.objects;
CREATE POLICY "branding_admin_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'branding'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "branding_admin_update" ON storage.objects;
CREATE POLICY "branding_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'branding'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "branding_admin_delete" ON storage.objects;
CREATE POLICY "branding_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'branding'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
);
;
