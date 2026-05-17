CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Wrapper RPC for admin dashboard to fetch top-N slow queries.
CREATE OR REPLACE FUNCTION public.top_slow_queries(p_limit integer DEFAULT 20)
RETURNS TABLE(
  query        text,
  calls        bigint,
  total_ms     double precision,
  mean_ms      double precision,
  rows_avg     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
  SELECT
    left(query, 240) AS query,
    calls,
    total_exec_time AS total_ms,
    mean_exec_time  AS mean_ms,
    (rows::numeric / NULLIF(calls, 0))::numeric(12,2) AS rows_avg
  FROM extensions.pg_stat_statements
  WHERE query NOT ILIKE '%pg_stat_statements%'
    AND query NOT ILIKE '%information_schema%'
  ORDER BY mean_exec_time DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.top_slow_queries(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.top_slow_queries(integer) TO service_role;

COMMENT ON FUNCTION public.top_slow_queries(integer) IS
  'Top-N slow queries by mean execution time. Admin-only via API gating.';;
