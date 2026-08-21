#!/usr/bin/env bash
# Nightly on-box backup: Postgres dump + the uploads (storage volume).
#
# Run from the repo directory on the server (where docker-compose.prod.yml and
# .env live). Wire it to cron, e.g.:
#   0 2 * * *  cd /opt/construction-erp && ./scripts/backup.sh >> /var/log/erp-backup.log 2>&1
#
# Keeps the last RETENTION_DAYS (default 14) days of backups under ./backups.
#
# ⚠️  These backups sit on the SAME server. For real durability also enable your
#     provider's weekly VM snapshots and/or copy ./backups off-box (see DEPLOY.md).
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TS="$(date +%Y%m%d-%H%M%S)"

# Load DB credentials from .env.
set -a; . ./.env; set +a
POSTGRES_USER="${POSTGRES_USER:-erp}"
POSTGRES_DB="${POSTGRES_DB:-construction_erp}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Backing up database -> $BACKUP_DIR/db-$TS.sql.gz"
$COMPOSE exec -T --env PGPASSWORD="${POSTGRES_PASSWORD:-}" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/db-$TS.sql.gz"

echo "[$(date)] Backing up uploads -> $BACKUP_DIR/storage-$TS.tar.gz"
$COMPOSE exec -T web tar czf - -C /app/storage . \
  > "$BACKUP_DIR/storage-$TS.tar.gz"

echo "[$(date)] Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'db-*.sql.gz'      -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[$(date)] Backup complete:"
ls -lh "$BACKUP_DIR"/db-"$TS".sql.gz "$BACKUP_DIR"/storage-"$TS".tar.gz
