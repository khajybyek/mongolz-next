-- SCH Esports: registrations imported from the Google Form response sheet.
--
-- The organiser kept the original Google Form open in parallel with /sch, so
-- part of the field registered there. /sch/admin can now import the response
-- sheet (CSV / TSV / XLSX). Imported rows differ from web rows in two ways:
--   * they did not come through the public form  → `source = 'import'`
--   * their payment receipt lives in the form owner's Google Drive, not in the
--     private `sch-receipts` bucket                → `receipt_url` (https link)
-- Both columns are additive with defaults, so the running app is unaffected.
-- RLS is unchanged (organiser/admin only, anon has no policy).

alter table public.sch_registrations
  add column if not exists source text not null default 'web'
    check (source in ('web', 'import')),
  add column if not exists receipt_url text
    check (receipt_url is null or (char_length(receipt_url) <= 500 and receipt_url ~ '^https://')),
  add column if not exists submitted_at timestamptz;

comment on column public.sch_registrations.source is
  'web = public /sch form; import = Google Form response sheet imported in /sch/admin';
comment on column public.sch_registrations.receipt_url is
  'External (Google Drive) receipt link of an imported row; web rows use receipt_path';
comment on column public.sch_registrations.submitted_at is
  'Timestamp column of the imported sheet row (when the player answered the Google Form)';

create index if not exists sch_registrations_source_idx
  on public.sch_registrations (source) where source <> 'web';
