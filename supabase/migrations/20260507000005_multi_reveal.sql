-- ════════════════════════════════════════════════════════════════
--  Multi-face Reveal — нэг бичлэгээс олон сонгосон нүүрийг зэрэг
--  unblur хийх дэмжлэг.
--
--  Үндэс:
--   • Хэрэглэгч playback дээр илэрсэн нүүр бүрд sequential дугаар
--     (#1, #2, ..., #N) харна
--   • Multi-select mode-оор олон дугаар сонгоод "Reveal" дарна
--   • API энэ jobs-д face_ids[] + query_embeddings(jsonb)-ыг хадгална
--   • Python worker frame face бүрд бүх target-той харьцуулж max
--     similarity-ыг авна → threshold-оос дээш бол unblur
-- ════════════════════════════════════════════════════════════════

alter table public.reveal_jobs
  -- Олон сонгосон нүүрний UUID-ууд (method='detected_face'-д хэрэглэнэ)
  add column if not exists face_ids uuid[],
  -- Бүх target embedding-уудын JSON массив. pgvector vector(N)-ыг
  -- массивт хийх боломжгүй тул jsonb [[float×512], ...] хэлбэрээр
  add column if not exists query_embeddings jsonb;

create index if not exists reveal_jobs_face_ids_idx
  on public.reveal_jobs using gin (face_ids);

comment on column public.reveal_jobs.face_ids is
  'Multi-face reveal-д сонгосон faces.id массив. Хоосон бол singular face_id ашиглана.';

comment on column public.reveal_jobs.query_embeddings is
  'Олон target embedding (jsonb массив). 1+ урттай бол multi-target reveal.';
