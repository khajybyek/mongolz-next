-- Keep the ML-owned desired state aligned with the operator's camera toggle.
-- The web action also asks ML to stop immediately; this trigger covers the
-- deployment/network gap so a restart cannot auto-resume a disabled camera.

create or replace function private.disable_camera_session_on_disable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and old.enabled is distinct from new.enabled and not new.enabled then
    update public.camera_sessions
       set auto_resume = false,
           updated_at = now(),
           last_error = coalesce(last_error, 'Camera disabled by operator')
     where camera_id = new.id;
  end if;
  return new;
end;
$$;

update public.camera_sessions cs
   set auto_resume = false,
       updated_at = now(),
       last_error = coalesce(cs.last_error, 'Camera disabled by operator')
  from public.cameras c
 where c.id = cs.camera_id and not c.enabled and cs.auto_resume;

drop trigger if exists cameras_disable_camera_session on public.cameras;
create trigger cameras_disable_camera_session
  after update of enabled on public.cameras
  for each row execute function private.disable_camera_session_on_disable();
