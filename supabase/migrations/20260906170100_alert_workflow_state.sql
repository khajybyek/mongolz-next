-- Alert operator workflow: new → acknowledged → closed (+ reopen), with who /
-- when and a short note. Labels (TP/FP) stay separate — they feed the ML
-- threshold tuning, the state feeds the control-room queue.

alter table public.alerts
  add column if not exists state text not null default 'new',
  add column if not exists acknowledged_by uuid references public.profiles(id) on delete set null,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists closed_at timestamptz,
  add column if not exists note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_state_check') then
    alter table public.alerts
      add constraint alerts_state_check check (state in ('new', 'acknowledged', 'closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_note_len_check') then
    alter table public.alerts
      add constraint alerts_note_len_check check (note is null or length(note) <= 500);
  end if;
end $$;

create index if not exists alerts_state_created_idx
  on public.alerts (state, created_at desc);

comment on column public.alerts.state is 'Operator workflow state: new | acknowledged | closed';
