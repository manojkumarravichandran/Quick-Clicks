#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres + PostGIS and run the SQL tests.
# Usage: supabase/tests/run.sh            (needs initdb/pg_ctl/psql 16+ and PostGIS)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# initdb refuses to run as root; use the postgres OS user when we are root.
RUN=()
if [ "$(id -u)" = "0" ]; then chown -R postgres "$WORK"; RUN=(runuser -u postgres --); fi

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c wal_level=logical -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -f "$f"
done

status=0
for f in "$ROOT"/supabase/tests/*_test.sql; do
  if psql -q -v ON_ERROR_STOP=1 -f "$f" >"$WORK/out" 2>&1; then
    echo "pass     $(basename "$f")"
  else
    echo "FAIL     $(basename "$f")"; cat "$WORK/out"; status=1
  fi
done
exit $status
