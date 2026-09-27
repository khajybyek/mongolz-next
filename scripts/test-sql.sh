#!/usr/bin/env bash
# Run every supabase/tests/*.test.sql against the LOCAL Supabase database.
#
#   npm run test:sql
#
# - Starts the local database (`supabase db start`) when it is not running.
# - Applies migrations that the local database has not seen yet
#   (`supabase migration up --local`, additive, never a reset).
# - Runs each test file with psql inside the database container,
#   ON_ERROR_STOP=1, so the first failing assertion aborts that file; the
#   script then exits non-zero naming it.
#
# Every test file wraps its fixtures in begin … rollback, so the database is
# left as it was. `*.fixture.sql` files are not tests: they are only loaded
# when a test lists them in a `-- fixture: <file>` header line (none do today;
# retention_deletion_queue.fixture.sql belongs to the PGlite runner
# scripts/test-retention-sql.mjs and must never touch a real database).
#
# This script never connects to anything but the local container: there is no
# database-URL input.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$ROOT/supabase/tests"
cd "$ROOT"

if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
else
  SUPABASE=(npx --yes supabase)
fi

PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' supabase/config.toml | head -n 1)"
if [[ -z "$PROJECT_ID" ]]; then
  echo "test-sql: could not read project_id from supabase/config.toml" >&2
  exit 1
fi
DB_CONTAINER="supabase_db_${PROJECT_ID}"

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" == "true" ]]
}

if ! container_running; then
  echo "test-sql: local database is not running — starting it"
  "${SUPABASE[@]}" db start
fi

# Wait for the server to accept connections (fresh containers need a moment).
for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" pg_isready -U postgres -q >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -U postgres -q

echo "test-sql: applying pending migrations to the local database"
"${SUPABASE[@]}" migration up --local

shopt -s nullglob
tests=("$TEST_DIR"/*.test.sql)
if (( ${#tests[@]} == 0 )); then
  echo "test-sql: no *.test.sql files in supabase/tests" >&2
  exit 1
fi

# Reads the SQL to run from stdin.
run_sql() {
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
}

passed=0
for test in "${tests[@]}"; do
  name="$(basename "$test")"
  echo "── $name"
  # Optional fixtures, one per header line: `-- fixture: some.fixture.sql`.
  fixtures=()
  while IFS= read -r fixture; do
    [[ -n "$fixture" ]] && fixtures+=("$fixture")
  done < <(sed -n 's/^--[[:space:]]*fixture:[[:space:]]*\([^[:space:]]*\).*$/\1/p' "$test")
  if (( ${#fixtures[@]} > 0 )); then
    for fixture in "${fixtures[@]}"; do
      if [[ ! -f "$TEST_DIR/$fixture" ]]; then
        echo "FAIL $name: fixture $fixture not found" >&2
        exit 1
      fi
    done
    # Fixture + test in one psql session so both share the transaction.
    if ! cat "${fixtures[@]/#/$TEST_DIR/}" "$test" | run_sql; then
      echo "FAIL $name" >&2
      exit 1
    fi
  elif ! run_sql <"$test"; then
    echo "FAIL $name" >&2
    exit 1
  fi
  passed=$((passed + 1))
done

echo "test-sql: ${passed}/${#tests[@]} SQL test files passed"
