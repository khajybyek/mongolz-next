-- Per-face crop pixel encryption (PoC, extends ADR 0009 hash-chain keys).
-- When true, an encrypted copy of the face crop exists at `<image_path>.enc`,
-- sealed with the face's hash-chain key K_index. The plain crop at image_path
-- is kept for backward compatibility with existing gallery display sites.
ALTER TABLE public.faces
  ADD COLUMN IF NOT EXISTS crop_sealed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.faces.crop_sealed IS
  'When true, an AES-256-GCM copy of the crop sealed with the per-face hash-chain key K_index exists at image_path||''.enc''. Decrypt via ML /face/{id}/secure-crop with sufficient reveal_level.';
