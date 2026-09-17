-- SCH Esports: payment receipts + published bank details.
--
-- The Google Form ended with "Хураамж төлөх": the player pays first and
-- uploads a screenshot of the transfer; the organiser confirms the payment
-- from that image. Receipts are personal documents (payer name, bank), so
-- the bucket is private and has NO storage.objects policy at all: uploads
-- happen through a signed upload URL minted by the server, and the
-- organiser views them through an admin-only, audited route that reads
-- with the service role — the same gateway pattern as the faces bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sch-receipts',
  'sch-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table public.sch_registrations
  add column receipt_path text
    check (receipt_path is null or receipt_path ~ '^submissions/[0-9a-f-]{36}/receipt\.(jpg|png|webp|heic)$'),
  add column receipt_mime text
    check (receipt_mime is null or receipt_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  add column receipt_bytes integer
    check (receipt_bytes is null or (receipt_bytes > 0 and receipt_bytes <= 10485760));

-- Bank details as published on the original form (shown before the upload
-- field, and again on the confirmation panel). Editable from /sch/admin.
update public.sch_event set
  payment_info =
    'Солонгос данс: 토스뱅크 1001-9949-6201' || chr(10) ||
    'Монгол данс: 450004000409071526 ХХБ' || chr(10) ||
    'Гүйлгээний утга дээр өөрийн бүтэн нэрээ оруулна уу.'
where id = 1 and payment_info is null;
