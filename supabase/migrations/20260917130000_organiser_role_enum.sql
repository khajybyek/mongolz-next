-- Tournament organiser role (SCH Esports). Added in its own migration: a
-- new enum value cannot be used in the transaction that creates it.
alter type public.user_role add value if not exists 'organiser';
