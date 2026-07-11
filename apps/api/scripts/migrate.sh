#!/bin/sh
# Runs node-pg-migrate as the table-owner role.
# Usage: ./scripts/migrate.sh up | down | create <name>
# Override the target DB with MIGRATION_DATABASE_URL (e.g. for the test DB).
set -e
cd "$(dirname "$0")/.."
OVERRIDE_URL="$MIGRATION_DATABASE_URL"
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
if [ -n "$OVERRIDE_URL" ]; then
  MIGRATION_DATABASE_URL="$OVERRIDE_URL"
fi
DATABASE_URL="$MIGRATION_DATABASE_URL" \
  ./node_modules/.bin/node-pg-migrate -m migrations --migration-file-language sql "$@"
