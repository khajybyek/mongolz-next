-- user_can_see_camera: public RPC wrapper (fixes HLS per-camera authorization).
--
-- The gate itself lives in private.user_can_see_camera() (SECURITY DEFINER; it
-- was moved out of the API surface to satisfy the advisor). PostgREST only
-- exposes the `public` schema, so /api/ml/stream/[cameraId]/[segment] calling
-- rpc("user_can_see_camera") received PGRST202 "function not found" → permErr
-- → 403 for every caller, admins included. Live HLS streaming had therefore
-- been failing closed since the per-camera gate (T1.4) shipped.
--
-- This SECURITY INVOKER wrapper delegates to the private definer. It is
-- callable by authenticated users only (anon/PUBLIC revoked). `authenticated`
-- already holds USAGE on schema private and EXECUTE on the private function.
create or replace function public.user_can_see_camera(p_camera_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select private.user_can_see_camera(p_camera_id);
$$;

revoke execute on function public.user_can_see_camera(uuid) from public, anon;
grant execute on function public.user_can_see_camera(uuid) to authenticated, service_role;

comment on function public.user_can_see_camera(uuid) is
  'RPC wrapper around private.user_can_see_camera (per-camera stream authorization). SECURITY INVOKER; anon revoked.';
