#!/usr/bin/env bash
# Restore from a backup produced by scripts/backup.sh.
#
# By DEFAULT this is a SAFE recoverability check: it restores the database dump
# into a throwaway scratch database and prints table counts, without touching
# your live data. This is what the deploy verification step runs.
#
#   ./scripts/restore.sh ./backups/db-YYYYmmdd-HHMMSS.sql.gz
#
# To actually overwrite PRODUCTION (disaster recovery), pass --into-prod. This
# DROPS and recreates the live database, then (optionally) restores uploads:
#
#   ./scripts/restore.sh --into-prod ./backups/db-*.sql.gz ./backups/storage-*.tar.gz
#
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

INTO_PROD=0
if [ "${1:-}" = "--into-prod" ]; then INTO_PROD=1; shift; fi

DB_DUMP="${1:?Usage: restore.sh [--into-prod] <db-dump.sql.gz> [storage.tar.gz]}"
STORAGE_TAR="${2:-}"

set -a; . ./.env; set +a
POSTGRES_USER="${POSTGRES_USER:-erp}"
POSTGRES_DB="${POSTGRES_DB:-construction_erp}"
PGENV=(--env PGPASSWORD="${POSTGRES_PASSWORD:-}")

psql_admin() { $COMPOSE exec -T "${PGENV[@]}" postgres psql -U "$POSTGRES_USER" -d postgres "$@"; }

if [ "$INTO_PROD" -eq 0 ]; then
  SCRATCH="${TARGET_DB:-construction_erp_restore_check}"
  echo "Safe check: restoring '$DB_DUMP' into scratch DB '$SCRATCH' (live data untouched)."
  psql_admin -c "DROP DATABASE IF EXISTS \"$SCRATCH\";"
  psql_admin -c "CREATE DATABASE \"$SCRATCH\";"
  gunzip -c "$DB_DUMP" | $COMPOSE exec -T "${PGENV[@]}" postgres psql -U "$POSTGRES_USER" -d "$SCRATCH" >/dev/null
  echo "Restored. Table counts in '$SCRATCH':"
  $COMPOSE exec -T "${PGENV[@]}" postgres psql -U "$POSTGRES_USER" -d "$SCRATCH" -c \
    "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15;"
  echo "✅ Recoverability verified. Dropping scratch DB."
  psql_admin -c "DROP DATABASE IF EXISTS \"$SCRATCH\";"
  exit 0
fi

echo "⚠️  DISASTER RECOVERY: this OVERWRITES the live database '$POSTGRES_DB'."
read -r -p "Type the database name to confirm: " CONFIRM
[ "$CONFIRM" = "$POSTGRES_DB" ] || { echo "Aborted."; exit 1; }

echo "Recreating '$POSTGRES_DB'..."
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$POSTGRES_DB' AND pid<>pg_backend_pid();" >/dev/null || true
psql_admin -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";"
psql_admin -c "CREATE DATABASE \"$POSTGRES_DB\";"
gunzip -c "$DB_DUMP" | $COMPOSE exec -T "${PGENV[@]}" postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
echo "Database restored."

if [ -n "$STORAGE_TAR" ]; then
  echo "Restoring uploads from '$STORAGE_TAR'..."
  $COMPOSE exec -T web sh -c 'cd /app/storage && tar xzf -' < "$STORAGE_TAR"
  echo "Uploads restored."
fi

echo "✅ Restore complete. Restart the app: $COMPOSE restart web worker"
