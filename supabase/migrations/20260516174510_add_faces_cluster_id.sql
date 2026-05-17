-- Add cluster_id column directly on faces (the ML /cluster endpoint already
-- expects this column). The separate `clusters` mapping table stays for
-- historic batch runs.
ALTER TABLE public.faces
  ADD COLUMN IF NOT EXISTS cluster_id integer;

CREATE INDEX IF NOT EXISTS idx_faces_cluster_id ON public.faces(cluster_id)
  WHERE cluster_id IS NOT NULL;

-- Allow authenticated users (including viewer) to read cluster_id — no PII
-- exposure since cluster IDs are opaque integers.
-- (faces RLS is admin-only currently; cluster_id read happens via service role
--  in our existing /api/cluster path.)
COMMENT ON COLUMN public.faces.cluster_id IS
  'DBSCAN cluster id from /cluster endpoint. NULL = noise / not clustered yet.';;
