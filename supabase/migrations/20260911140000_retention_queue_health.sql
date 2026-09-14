create function public.retention_queue_health()
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'pending', count(*),
    'failed', count(*) filter (where last_error is not null),
    'oldest_created_at', min(created_at)
  ) from public.retention_deletion_queue;
$$;
revoke all on function public.retention_queue_health() from public, anon, authenticated;
grant execute on function public.retention_queue_health() to service_role;
