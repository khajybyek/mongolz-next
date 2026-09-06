-- Human review queue columns on faces (backs /review).
--
-- app/(app)/review/page.tsx selected `reviewed, review_label` and the
-- reviewFaceAction updated `reviewed, review_label, reviewed_by`, but none of
-- these columns ever existed: the page query failed with "column faces.reviewed
-- does not exist" and the action silently did nothing. Typed Supabase clients
-- (lib/database.generated.ts) now catch this class of drift at compile time.
--
-- Additive + defaulted → existing rows read as unreviewed. Admin-only RLS on
-- faces already covers the new columns.
alter table public.faces
  add column if not exists reviewed     boolean     not null default false,
  add column if not exists review_label text,
  add column if not exists reviewed_by  uuid        references public.profiles(id) on delete set null,
  add column if not exists reviewed_at  timestamptz;

alter table public.faces drop constraint if exists faces_review_label_check;
-- safety: ok — CHECK on a column added in this same migration; no existing data
alter table public.faces
  add constraint faces_review_label_check
  check (review_label is null or review_label in ('confirmed', 'rejected', 'uncertain'));

-- The queue lists unreviewed faces newest-first; keep that cheap.
create index if not exists faces_unreviewed_detected_idx
  on public.faces (detected_at desc)
  where reviewed = false;

comment on column public.faces.reviewed     is 'Human review done (/review queue).';
comment on column public.faces.review_label is 'confirmed | rejected | uncertain — reviewer verdict on the detection.';
comment on column public.faces.reviewed_by  is 'Reviewer profile id.';
comment on column public.faces.reviewed_at  is 'When the verdict was recorded.';
