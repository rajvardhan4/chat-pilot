#!/usr/bin/env bash
#
# Chat Pilot Cloud - nightly backup.
#
# Install:
#   sudo cp deploy/backup.sh /usr/local/bin/chat-pilot-backup
#   sudo chmod +x /usr/local/bin/chat-pilot-backup
#   sudo crontab -e
#     15 3 * * *  /usr/local/bin/chat-pilot-backup
#
# Backs up the two files that matter, together:
#
#   data/chat-pilot.sqlite   every account, website, key, conversation
#   .env                     the keys that decrypt what is inside it
#
# They are worthless apart. The database holds every customer's AI provider key
# encrypted with ENCRYPTION_KEY from .env, so a database backup without the .env
# restores to a system that cannot talk to a single provider.
set -euo pipefail

APP_DIR="${CHAT_PILOT_DIR:-/var/www/chat-pilot/saas}"
DEST="${CHAT_PILOT_BACKUP_DIR:-/var/backups/chat-pilot}"
KEEP_DAYS="${CHAT_PILOT_BACKUP_KEEP:-30}"

DB="$APP_DIR/data/chat-pilot.sqlite"
ENV_FILE="$APP_DIR/.env"
STAMP="$(date +%Y-%m-%d_%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST"

if [ ! -f "$DB" ]; then
  echo "chat-pilot-backup: no database at $DB" >&2
  exit 1
fi

# `.backup` rather than `cp`: SQLite runs in WAL mode, so a plain copy taken
# mid-write can capture a torn file. This takes a consistent snapshot while the
# service keeps serving, with no downtime and no stopping the unit.
sqlite3 "$DB" ".backup '$WORK/chat-pilot.sqlite'"

cp "$ENV_FILE" "$WORK/env"

# Uploaded knowledge documents, if any.
if [ -d "$APP_DIR/data/uploads" ]; then
  cp -r "$APP_DIR/data/uploads" "$WORK/uploads"
fi

tar -czf "$DEST/chat-pilot-$STAMP.tar.gz" -C "$WORK" .
chmod 600 "$DEST/chat-pilot-$STAMP.tar.gz"

# The archive contains ENCRYPTION_KEY in clear. Keep the directory locked down
# and, ideally, copy these off the machine as well - a backup that only lives on
# the server it backs up is not a backup.
chmod 700 "$DEST"

find "$DEST" -name 'chat-pilot-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "chat-pilot-backup: wrote $DEST/chat-pilot-$STAMP.tar.gz"
