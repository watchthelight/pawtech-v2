#!/bin/bash
# ============================================================================
# Pawtropolis Tech - Remote Switch Script
# ============================================================================
# Usage:
#   ./switch.sh          Intelligent switch: detect running bot, sync DB, switch location
#   ./switch.sh --help   Show this help message
#
# This script is the remote counterpart to start.cmd --switch
# It runs on the server and handles switching the bot back to local.
# ============================================================================
# SPDX-License-Identifier: LicenseRef-ANW-1.0

set -e

# === CONFIGURATION ===
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_NAME="pawtropolis"
DB_REMOTE="$REMOTE_PATH/data/data.db"
BACKUP_DIR="$REMOTE_PATH/data/backups"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=== INTELLIGENT SWITCH (Remote) ==="
echo "[switch] Detecting current state..."

# Ensure we're in the right directory
cd "$REMOTE_PATH" 2>/dev/null || { echo "[ERROR] Cannot access $REMOTE_PATH"; exit 1; }

# === Step 1: Check if remote bot is running ===
REMOTE_RUNNING=0
if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_NAME\""; then
    REMOTE_RUNNING=1
fi
echo "[switch] Remote (this server) running: $REMOTE_RUNNING"

# === Step 2: Get sync marker from local database ===
echo "[switch] Reading sync marker..."

L_MARKER_TIME=0
L_MARKER_BY="unknown"
L_MARKER_COUNT=0

if [ -f "$DB_REMOTE" ]; then
    MARKER_DATA=$(sqlite3 "$DB_REMOTE" "SELECT last_modified_at, last_modified_by, action_count FROM sync_marker WHERE id=1;" 2>/dev/null || echo "0|unknown|0")
    L_MARKER_TIME=$(echo "$MARKER_DATA" | cut -d'|' -f1)
    L_MARKER_BY=$(echo "$MARKER_DATA" | cut -d'|' -f2)
    L_MARKER_COUNT=$(echo "$MARKER_DATA" | cut -d'|' -f3)
fi
echo "[switch] Marker: time=$L_MARKER_TIME by=$L_MARKER_BY count=$L_MARKER_COUNT"

# === Step 3: Decision logic ===
if [ "$REMOTE_RUNNING" -eq 0 ]; then
    echo ""
    echo -e "${YELLOW}[switch] Remote bot is NOT running.${NC}"
    echo "[switch] Nothing to switch. To start the bot, use: pm2 start"
    exit 0
fi

# Remote is running, offer to stop for local takeover
echo ""
echo "========================================================="
echo "  REMOTE BOT IS RUNNING"
echo "  Sync Marker: count=$L_MARKER_COUNT modified_by=$L_MARKER_BY"
echo "========================================================="
echo ""
echo "This will:"
echo "  1. Create a backup of the database"
echo "  2. Stop the remote PM2 process"
echo "  3. The local machine can then pull the DB and start"
echo ""
read -p "Stop remote bot for local takeover? (y/N): " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "[switch] Cancelled."
    exit 0
fi

# === Step 4: Create backup ===
echo ""
echo "[switch] Creating backup..."
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/data-$TIMESTAMP.remote.db"

# Checkpoint WAL before backup
echo "[switch] Checkpointing WAL..."
sqlite3 "$DB_REMOTE" "PRAGMA wal_checkpoint(PASSIVE);" 2>/dev/null || true

# Copy database and WAL files
cp "$DB_REMOTE" "$BACKUP_FILE"
[ -f "${DB_REMOTE}-wal" ] && cp "${DB_REMOTE}-wal" "${BACKUP_FILE}-wal"
[ -f "${DB_REMOTE}-shm" ] && cp "${DB_REMOTE}-shm" "${BACKUP_FILE}-shm"
echo -e "[switch] ${GREEN}Backup created: $BACKUP_FILE${NC}"

# === Step 5: Stop PM2 ===
echo ""
echo "[switch] Stopping PM2 process: $PM2_NAME..."
pm2 stop "$PM2_NAME"
pm2 save 2>/dev/null || true
echo -e "[switch] ${GREEN}Remote bot stopped${NC}"

# === Step 6: Final instructions ===
echo ""
echo "========================================================="
echo -e "  ${GREEN}SWITCH COMPLETE${NC}"
echo "========================================================="
echo ""
echo "Remote bot has been stopped. To continue on local:"
echo ""
echo "  1. On your local machine, run:"
echo "     start.cmd --local"
echo ""
echo "  2. This will pull the remote database and start locally."
echo ""
echo "To restart the remote bot instead:"
echo "  pm2 restart $PM2_NAME"
echo ""
