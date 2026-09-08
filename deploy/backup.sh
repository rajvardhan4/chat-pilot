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
# The database itself is MongoDB Atlas, which backs itself up (continuous
# backups on the paid tiers, manual export on M0) - this script is not what
# makes the database durable. What it backs up, together:
#
#   .env                     the keys that decrypt what is inside the database
#   data/uploads             locally-stored knowledge file uploads
#   a mongodump snapshot      only if the `mongodump` tool is installed - a
#                             convenience local copy, not the primary backup
#
# .env matters even without a local database copy: it holds ENCRYPTION_KEY,
# which decrypts every customer's stored AI provider key inside Atlas. Losing
# it makes every provider key permanently unreadable even though the data is
# still safe in the cluster.
set -euo pipefail

APP_DIR="${CHAT_PILOT_DIR:-/var/www/chat-pilot/saas}"
DEST="${CHAT_PILOT_BACKUP_DIR:-/var/backups/chat-pilot}"
KEEP_DAYS="${CHAT_PILOT_BACKUP_KEEP:-30}"

ENV_FILE="$APP_DIR/.env"
STAMP="$(date +%Y-%m-%d_%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST"

if [ ! -f "$ENV_FILE" ]; then
  echo "chat-pilot-backup: no .env at $ENV_FILE" >&2
  exit 1
fi

cp "$ENV_FILE" "$WORK/env"

# Uploaded knowledge documents, if any.
if [ -d "$APP_DIR/data/uploads" ]; then
  cp -r "$APP_DIR/data/uploads" "$WORK/uploads"
fi

# Optional local database snapshot, in addition to Atlas's own backups.
# Requires the MongoDB Database Tools (mongodump) and MONGODB_URI in .env.
if command -v mongodump >/dev/null 2>&1; then
  MONGO_URI="$(grep -E '^MONGODB_URI=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  if [ -n "$MONGO_URI" ]; then
    mongodump --uri="$MONGO_URI" --gzip --archive="$WORK/mongodump.archive.gz" || \
      echo "chat-pilot-backup: mongodump failed, continuing with .env/uploads only" >&2
  fi
fi

tar -czf "$DEST/chat-pilot-$STAMP.tar.gz" -C "$WORK" .
chmod 600 "$DEST/chat-pilot-$STAMP.tar.gz"

# The archive contains ENCRYPTION_KEY (and, if mongodump ran, a full database
# copy) in clear. Keep the directory locked down and, ideally, copy these off
# the machine as well - a backup that only lives on the server it backs up is
# not a backup.
chmod 700 "$DEST"

find "$DEST" -name 'chat-pilot-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "chat-pilot-backup: wrote $DEST/chat-pilot-$STAMP.tar.gz"
