#!/usr/bin/env bash
# ============================================================================
# Pawtropolis Tech - Unified Start/Stop Script with DB Sync (Unix/macOS)
# ============================================================================
# Usage:
#   ./start.sh --local              Start bot locally (pulls remote DB first)
#   ./start.sh --local --fresh      Clean install + rebuild + start
#   ./start.sh --remote             Restart bot on remote server (pulls remote DB first)
#   ./start.sh --remote --fresh     Full deploy: build + upload + restart
#   ./start.sh --switch             Intelligent switch: detect running bot, sync DB, switch location
#   ./start.sh --stop               Stop all local and remote processes
#   ./start.sh --push-remote        Push local DB to remote (explicit only)
#   ./start.sh --recover-remote-db  Download all remote DB candidates to _recovery/remote/
#
# DB Sync Behavior:
#   - Default: Always pulls remote DB → local (if remote exists)
#   - Creates timestamped backups before any changes
#   - Never pushes to remote unless --push-remote is explicitly provided
#   - Writes manifest to data/.db-manifest.json after sync
#
# Recovery:
#   - --recover-remote-db: Scans remote for all DB files/archives
#   - Copies them to _recovery/remote/ without overwriting
# ============================================================================

set -euo pipefail

# === CONFIGURATION (Edit these for your environment) ===
REMOTE_ALIAS="pawtech"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_NAME="pawtropolis"
LOCAL_PORT=3000
DB_LOCAL="./data/data.db"
DB_REMOTE="${REMOTE_PATH}/data/data.db"
MANIFEST_FILE="data/.db-manifest.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# === Parse command line arguments ===
ARG_LOCAL=0
ARG_REMOTE=0
ARG_FRESH=0
ARG_STOP=0
ARG_PUSH_REMOTE=0
ARG_RECOVER_DB=0
ARG_RECOVER=0
ARG_SKIP_SYNC=0
ARG_SWITCH=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)
            ARG_LOCAL=1
            shift
            ;;
        --remote)
            ARG_REMOTE=1
            shift
            ;;
        --fresh)
            ARG_FRESH=1
            shift
            ;;
        --stop)
            ARG_STOP=1
            shift
            ;;
        --push-remote)
            ARG_PUSH_REMOTE=1
            shift
            ;;
        --recover-remote-db)
            ARG_RECOVER_DB=1
            shift
            ;;
        --recover)
            ARG_RECOVER=1
            shift
            ;;
        --skip-sync)
            ARG_SKIP_SYNC=1
            shift
            ;;
        --switch)
            ARG_SWITCH=1
            shift
            ;;
        *)
            echo -e "${RED}[ERROR] Unknown argument: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# === Helper Functions ===
usage() {
    echo ""
    echo "Usage: ./start.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --local              Start bot locally using npm run dev"
    echo "  --local --fresh      Clean install, rebuild, and start locally"
    echo "  --remote             Restart bot on remote server (PM2)"
    echo "  --remote --fresh     Full deploy: build + upload + restart"
    echo "  --switch             Intelligent switch: detects running bot, syncs DB, switches location"
    echo "  --stop               Stop all local and remote processes"
    echo "  --push-remote        Push local database to remote (explicit only)"
    echo "  --recover            Interactive DB recovery (evaluate and restore from any backup)"
    echo "  --recover-remote-db  Download all remote DB candidates for recovery"
    echo "  --skip-sync          Skip database sync (use existing local DB)"
    echo ""
    echo "Examples:"
    echo "  ./start.sh --local                  # Dev mode with hot reload (pulls remote DB)"
    echo "  ./start.sh --local --fresh          # Full rebuild and start"
    echo "  ./start.sh --remote                 # Quick restart on server"
    echo "  ./start.sh --remote --fresh         # Deploy latest code to server"
    echo "  ./start.sh --switch                 # Auto-detect and switch between local/remote"
    echo "  ./start.sh --stop                   # Stop everything"
    echo "  ./start.sh --push-remote            # Push local DB to remote (after backups)"
    echo "  ./start.sh --recover                # Interactive DB recovery with integrity checks"
    echo "  ./start.sh --recover-remote-db      # Recover old databases from remote"
    echo ""
    echo "Configuration (edit at top of script):"
    echo "  REMOTE_ALIAS=${REMOTE_ALIAS}"
    echo "  REMOTE_PATH=${REMOTE_PATH}"
    echo "  PM2_NAME=${PM2_NAME}"
    echo ""
    echo "Database Sync:"
    echo "  Default behavior: Pulls remote DB → local (never pushes unless --push-remote)"
    echo "  Backups: data/backups/data-TIMESTAMP.local.db"
    echo "  Manifest: ${MANIFEST_FILE}"
    echo ""
}

# Get file hash (cross-platform)
get_sha256() {
    local file="$1"
    if command -v sha256sum &> /dev/null; then
        sha256sum "$file" | cut -d' ' -f1
    elif command -v shasum &> /dev/null; then
        shasum -a 256 "$file" | cut -d' ' -f1
    else
        echo "NOHASH"
    fi
}

# Get file modification time as Unix timestamp
get_mtime() {
    local file="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        stat -f %m "$file" 2>/dev/null || echo "0"
    else
        stat -c %Y "$file" 2>/dev/null || echo "0"
    fi
}

# Get file size
get_size() {
    local file="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        stat -f %z "$file" 2>/dev/null || echo "0"
    else
        stat -c %s "$file" 2>/dev/null || echo "0"
    fi
}

# ============================================================================
# DB SYNC (REMOTE-PREFERRED)
# ============================================================================
sync_db_remote_preferred() {
    # Cleanup trap for temp files on error
    TEMP_DB=""
    cleanup() {
        [[ -n "$TEMP_DB" && -f "$TEMP_DB" ]] && rm -f "$TEMP_DB"
    }
    trap cleanup EXIT

    echo ""
    echo -e "${BLUE}=== DB SYNC (REMOTE-PREFERRED) ===${NC}"
    echo "[sync] Pulling remote database to local (default behavior)..."

    # Ensure local data directory exists
    mkdir -p "./data"
    mkdir -p "./data/backups"

    # Ensure remote data/backups directory exists
    ssh "$REMOTE_ALIAS" "mkdir -p ${REMOTE_PATH}/data/backups"

    # --- Collect local metadata ---
    L_EXISTS=0
    L_MTIME=0
    L_SIZE=0
    L_SHA256=""

    if [[ -f "$DB_LOCAL" ]]; then
        L_EXISTS=1
        L_SIZE=$(get_size "$DB_LOCAL")
        L_MTIME=$(get_mtime "$DB_LOCAL")
        L_SHA256=$(get_sha256 "$DB_LOCAL")
        echo "[sync] local:  exists=${L_EXISTS} mtime=${L_MTIME} size=${L_SIZE} sha256=${L_SHA256}"
    else
        echo "[sync] local:  not found"
    fi

    # --- Collect remote metadata ---
    R_EXISTS=0
    R_MTIME=0
    R_SIZE=0
    R_SHA256=""

    REMOTE_META=$(ssh "$REMOTE_ALIAS" "bash -c 'if [ -f ${DB_REMOTE} ]; then echo \$(stat -c %Y ${DB_REMOTE}) \$(stat -c %s ${DB_REMOTE}) \$(sha256sum ${DB_REMOTE} | cut -d\" \" -f1); else echo 0 0 MISSING; fi'" 2>/dev/null || echo "0 0 MISSING")

    read -r R_MTIME R_SIZE R_SHA256 <<< "$REMOTE_META"

    if [[ "$R_SHA256" != "MISSING" ]]; then
        R_EXISTS=1
        echo "[sync] remote: exists=${R_EXISTS} mtime=${R_MTIME} size=${R_SIZE} sha256=${R_SHA256}"
    else
        echo "[sync] remote: not found"
    fi

    # --- Decide action: smart sync ---
    if [[ $R_EXISTS -eq 0 ]]; then
        echo ""
        echo -e "${YELLOW}[WARN] Remote database does not exist!${NC}"
        echo -e "${YELLOW}[WARN] Local DB will NOT be pushed automatically.${NC}"
        echo -e "${YELLOW}[WARN] If you want to seed the remote, run:${NC}"
        echo -e "${YELLOW}[WARN]   ./start.sh --push-remote${NC}"
        echo ""
        write_manifest "no-sync"
        return
    fi

    # Check if hashes match (already in sync)
    if [[ "$L_SHA256" == "$R_SHA256" ]]; then
        echo ""
        echo -e "${GREEN}[sync] ✓ Databases already in sync (same hash)${NC}"
        write_manifest "already-synced"
        return
    fi

    # Check if local is newer than remote
    if [[ $L_EXISTS -eq 1 ]] && [[ $L_MTIME -gt $R_MTIME ]]; then
        echo ""
        echo -e "${GREEN}[sync] ✓ Local database is newer than remote - skipping pull${NC}"
        echo "[sync] Local mtime:  ${L_MTIME}"
        echo "[sync] Remote mtime: ${R_MTIME}"
        echo -e "${YELLOW}[INFO] To push local to remote, run: pawtech --push-remote${NC}"
        write_manifest "local-newer"
        return
    fi

    # Remote is newer or local doesn't exist, pull it
    echo ""
    echo "[sync] Remote database is newer - pulling to local..."

    # Create local backup if local exists
    if [[ $L_EXISTS -eq 1 ]]; then
        TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
        LOCAL_BACKUP="data/backups/data-${TIMESTAMP}.local.db"
        echo "[sync] Backing up local → ${LOCAL_BACKUP}"
        cp "$DB_LOCAL" "$LOCAL_BACKUP"
    fi

    # Create remote backup (include WAL/SHM files)
    R_TIMESTAMP=$(ssh "$REMOTE_ALIAS" "date +%Y%m%d-%H%M%S")
    REMOTE_BACKUP="${REMOTE_PATH}/data/backups/data-${R_TIMESTAMP}.remote.db"
    echo "[sync] Backing up remote → ${REMOTE_BACKUP}"
    ssh "$REMOTE_ALIAS" "timeout 5 sqlite3 ${DB_REMOTE} 'PRAGMA wal_checkpoint(PASSIVE);' 2>/dev/null || true; cp ${DB_REMOTE} ${REMOTE_BACKUP}; [ -f ${DB_REMOTE}-wal ] && cp ${DB_REMOTE}-wal ${REMOTE_BACKUP}-wal || true; [ -f ${DB_REMOTE}-shm ] && cp ${DB_REMOTE}-shm ${REMOTE_BACKUP}-shm || true"

    # Pull remote → local
    echo "[sync] Pulling remote database to local..."

    # Step 0: Verify remote database integrity BEFORE pulling
    echo "[sync] Verifying remote database integrity..."
    VERIFY_RESULT=$(ssh -o ConnectTimeout=5 -o BatchMode=yes "$REMOTE_ALIAS" "cd ${REMOTE_PATH} 2>/dev/null && timeout 10 node scripts/verify-db-integrity.js ${DB_REMOTE} 2>&1" 2>&1)
    VERIFY_EXIT=$?

    if [[ $VERIFY_EXIT -eq 255 ]]; then
        echo "[sync] Remote verification unavailable (SSH issue) - will verify after download"
    elif [[ $VERIFY_EXIT -eq 0 ]]; then
        echo -e "${GREEN}[sync] ✓ Remote database passed integrity check${NC}"
    else
        echo -e "${RED}[ERROR] Remote database failed integrity check:${NC}"
        echo "$VERIFY_RESULT"
        echo -e "${RED}Aborting sync to prevent overwriting local database with corrupted remote.${NC}"
        exit 1
    fi

    # Step 1: Checkpoint the WAL on remote
    echo "[sync] Checkpointing WAL on remote (passive mode, non-blocking)..."
    ssh "$REMOTE_ALIAS" "timeout 5 sqlite3 ${DB_REMOTE} 'PRAGMA wal_checkpoint(PASSIVE);' 2>/dev/null || echo '[INFO] WAL checkpoint timed out (bot may be running)'"

    # Step 2: Copy main database file to temporary location first
    TEMP_DB="${DB_LOCAL}.temp"
    scp "${REMOTE_ALIAS}:${DB_REMOTE}" "$TEMP_DB" || {
        echo -e "${RED}[ERROR] Failed to pull remote database${NC}"
        exit 1
    }

    # Step 2.5: Verify the downloaded database before replacing local
    echo "[sync] Verifying downloaded database..."
    if node scripts/verify-db-integrity.js "$TEMP_DB" &>/dev/null; then
        echo -e "${GREEN}[sync] ✓ Downloaded database verified${NC}"
    else
        echo ""
        echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║  ERROR: DOWNLOADED DATABASE IS CORRUPTED                      ║${NC}"
        echo -e "${RED}║  The remote database copy failed integrity check.             ║${NC}"
        echo -e "${RED}║  Your local database has NOT been overwritten.                ║${NC}"
        echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        rm -f "$TEMP_DB"
        exit 1
    fi

    # Step 2.6: Replace local database with verified copy
    mv "$TEMP_DB" "$DB_LOCAL"
    echo -e "${GREEN}[sync] ✓ Local database replaced${NC}"

    # Step 3: Copy WAL file if it exists
    if scp "${REMOTE_ALIAS}:${DB_REMOTE}-wal" "${DB_LOCAL}-wal" 2>/dev/null; then
        echo "[sync] WAL file copied"
    fi

    # Step 4: Copy SHM file if it exists
    if scp "${REMOTE_ALIAS}:${DB_REMOTE}-shm" "${DB_LOCAL}-shm" 2>/dev/null; then
        echo "[sync] SHM file copied"
    fi

    echo -e "${GREEN}[sync] ✓ Remote database pulled successfully${NC}"
    write_manifest "pull-remote"
}

# ============================================================================
# PUSH DB TO REMOTE (EXPLICIT ONLY)
# ============================================================================
push_db_to_remote() {
    echo ""
    echo -e "${BLUE}=== DB SYNC (PUSH TO REMOTE) ===${NC}"
    echo "[sync] Pushing local database to remote (EXPLICIT MODE)..."

    # IMPORTANT: Stop remote PM2 process to prevent database corruption during push
    echo "[sync] Checking remote PM2 status..."
    PM2_RUNNING=$(ssh "$REMOTE_ALIAS" "bash -lc 'pm2 jlist 2>/dev/null | grep -c \"\\\"name\\\":\\\"${PM2_NAME}\\\"\" || echo 0'" 2>/dev/null || echo "0")

    if [[ "$PM2_RUNNING" -gt 0 ]]; then
        echo "[sync] Remote PM2 process is running - stopping to prevent corruption..."
        ssh "$REMOTE_ALIAS" "bash -lc 'pm2 stop ${PM2_NAME}'" &>/dev/null || true

        # Wait and verify process stopped
        sleep 2
        STILL_RUNNING=$(ssh -o ConnectTimeout=5 "$REMOTE_ALIAS" "bash -lc 'pm2 jlist 2>/dev/null | grep -c \"\\\"status\\\":\\\"online\\\"\" || echo 0'" 2>/dev/null || echo "0")
        if [[ "$STILL_RUNNING" -gt 0 ]]; then
            echo -e "${RED}[ERROR] PM2 process didn't stop cleanly. Aborting to prevent corruption.${NC}"
            exit 1
        fi
        echo "[sync] Remote process stopped and verified"
    else
        echo "[sync] Remote PM2 process not running (safe to push)"
    fi

    # Ensure directories exist
    mkdir -p "./data"
    mkdir -p "./data/backups"
    ssh "$REMOTE_ALIAS" "mkdir -p ${REMOTE_PATH}/data/backups"

    # Check local exists
    if [[ ! -f "$DB_LOCAL" ]]; then
        echo -e "${RED}[ERROR] Local database does not exist: ${DB_LOCAL}${NC}"
        exit 1
    fi

    # Collect local metadata
    L_SIZE=$(get_size "$DB_LOCAL")
    L_MTIME=$(get_mtime "$DB_LOCAL")
    L_SHA256=$(get_sha256 "$DB_LOCAL")
    echo "[sync] local:  mtime=${L_MTIME} size=${L_SIZE} sha256=${L_SHA256}"

    # Checkpoint local WAL before push
    echo "[sync] Checkpointing local WAL..."
    if command -v sqlite3 &> /dev/null; then
        sqlite3 "$DB_LOCAL" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
    fi

    # Create local backup (including WAL/SHM files)
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
    LOCAL_BACKUP="data/backups/data-${TIMESTAMP}.local.db"
    echo "[sync] Backing up local → ${LOCAL_BACKUP}"
    cp "$DB_LOCAL" "$LOCAL_BACKUP"
    [[ -f "${DB_LOCAL}-wal" ]] && cp "${DB_LOCAL}-wal" "${LOCAL_BACKUP}-wal" && echo "[sync] Backed up local WAL file"
    [[ -f "${DB_LOCAL}-shm" ]] && cp "${DB_LOCAL}-shm" "${LOCAL_BACKUP}-shm" && echo "[sync] Backed up local SHM file"

    # Check if remote exists and back it up
    R_EXISTS=$(ssh "$REMOTE_ALIAS" "bash -c 'if [ -f ${DB_REMOTE} ]; then echo 1; else echo 0; fi'" 2>/dev/null || echo "0")
    if [[ "$R_EXISTS" -eq 1 ]]; then
        R_TIMESTAMP=$(ssh "$REMOTE_ALIAS" "date +%Y%m%d-%H%M%S")
        REMOTE_BACKUP="${REMOTE_PATH}/data/backups/data-${R_TIMESTAMP}.remote.db"
        echo "[sync] Backing up remote → ${REMOTE_BACKUP}"
        ssh "$REMOTE_ALIAS" "sqlite3 ${DB_REMOTE} 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null; cp ${DB_REMOTE} ${REMOTE_BACKUP}; [ -f ${DB_REMOTE}-wal ] && cp ${DB_REMOTE}-wal ${REMOTE_BACKUP}-wal || true; [ -f ${DB_REMOTE}-shm ] && cp ${DB_REMOTE}-shm ${REMOTE_BACKUP}-shm || true"
    fi

    # Push local → remote
    echo ""
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  PUSHING LOCAL DATABASE TO REMOTE                         ║${NC}"
    echo -e "${YELLOW}║  This will overwrite the remote database!                 ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Step 1: Push main database file
    scp "$DB_LOCAL" "${REMOTE_ALIAS}:${DB_REMOTE}" || {
        echo -e "${RED}[ERROR] Failed to push database to remote${NC}"
        exit 1
    }

    # Step 2: Push WAL file if it exists
    if [[ -f "${DB_LOCAL}-wal" ]]; then
        if scp "${DB_LOCAL}-wal" "${REMOTE_ALIAS}:${DB_REMOTE}-wal"; then
            echo "[sync] WAL file pushed"
        fi
    fi

    # Step 3: Push SHM file if it exists
    if [[ -f "${DB_LOCAL}-shm" ]]; then
        if scp "${DB_LOCAL}-shm" "${REMOTE_ALIAS}:${DB_REMOTE}-shm"; then
            echo "[sync] SHM file pushed"
        fi
    fi

    echo ""
    echo -e "${GREEN}[sync] ✓ Local database pushed to remote successfully${NC}"
    echo ""
    echo -e "${YELLOW}[IMPORTANT] Remote PM2 process was stopped to prevent corruption.${NC}"
    echo -e "${YELLOW}[IMPORTANT] To restart the remote bot, run:${NC}"
    echo -e "${YELLOW}[IMPORTANT]   ./start.sh --remote${NC}"
    echo ""

    # Update metadata for manifest
    REMOTE_META=$(ssh "$REMOTE_ALIAS" "bash -c 'echo \$(stat -c %Y ${DB_REMOTE}) \$(stat -c %s ${DB_REMOTE}) \$(sha256sum ${DB_REMOTE} | cut -d\" \" -f1)'" 2>/dev/null || echo "0 0 NOHASH")
    read -r R_MTIME R_SIZE R_SHA256 <<< "$REMOTE_META"

    L_EXISTS=1
    R_EXISTS=1
    write_manifest "push-remote"
}

# ============================================================================
# RECOVER REMOTE DB
# ============================================================================
recover_remote_db() {
    echo ""
    echo -e "${BLUE}=== DB RECOVERY (REMOTE SEARCH) ===${NC}"
    echo "[recovery] Searching for database files on remote..."

    mkdir -p "_recovery"
    mkdir -p "_recovery/remote"

    # Create a temp file list on remote
    echo "[recovery] Scanning remote filesystem..."
    ssh "$REMOTE_ALIAS" "bash -c 'find ${REMOTE_PATH}/data -name \"*.db*\" 2>/dev/null; find ~/data -name \"*.db*\" 2>/dev/null; find ~/app -path \"*/data/*.db*\" 2>/dev/null; find ~/backups -name \"*.db*\" 2>/dev/null; find ${REMOTE_PATH}/data/backups -name \"*.tar\" -o -name \"*.gz\" -o -name \"*.zip\" 2>/dev/null'" > _recovery/remote_candidates.txt 2>/dev/null || true

    # Count candidates
    CANDIDATE_COUNT=$(wc -l < _recovery/remote_candidates.txt | tr -d ' ')
    echo "[recovery] Found ${CANDIDATE_COUNT} candidate files"

    if [[ "$CANDIDATE_COUNT" -eq 0 ]]; then
        echo "[recovery] No database files found on remote"
        return
    fi

    # Show candidates
    echo ""
    echo "[recovery] Remote database candidates:"
    echo "========================================"
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        META=$(ssh "$REMOTE_ALIAS" "bash -c 'if [ -f \"$file\" ]; then stat -c \"%Y %s\" \"$file\"; fi'" 2>/dev/null || echo "0 0")
        echo "$file (${META})"
    done < _recovery/remote_candidates.txt

    echo ""
    echo "[recovery] Copying candidates to _recovery/remote/..."

    # Copy each candidate
    COPY_COUNT=0
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        # Create local mirror path
        LOCAL_MIRROR="_recovery/remote/${file#${REMOTE_PATH}/}"
        LOCAL_MIRROR="${LOCAL_MIRROR//\//_}"

        # Check if local file exists, append number if needed
        TARGET="$LOCAL_MIRROR"
        SUFFIX=0
        while [[ -f "$TARGET" ]]; do
            ((SUFFIX++))
            TARGET="${LOCAL_MIRROR}.${SUFFIX}"
        done

        echo "[recovery] Copying $file → $TARGET"
        if scp "${REMOTE_ALIAS}:${file}" "$TARGET" &>/dev/null; then
            ((COPY_COUNT++))
        fi
    done < _recovery/remote_candidates.txt

    echo ""
    echo -e "${GREEN}[recovery] ✓ Copied ${COPY_COUNT} files to _recovery/remote/${NC}"
    echo "[recovery] Files saved to: $(pwd)/_recovery/remote/"

    # Show 5 largest files
    echo ""
    echo "[recovery] Top 5 largest candidates:"
    ls -lhS _recovery/remote/ 2>/dev/null | head -6

    rm -f _recovery/remote_candidates.txt
}

# ============================================================================
# WRITE MANIFEST
# ============================================================================
write_manifest() {
    local SYNC_MODE="${1:-pull-remote}"
    echo "[sync] Writing manifest to ${MANIFEST_FILE}..."

    # Get current UTC timestamp
    SYNCED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Write manifest JSON
    cat > "$MANIFEST_FILE" << EOF
{
  "local": {
    "exists": ${L_EXISTS:-0},
    "mtime": ${L_MTIME:-0},
    "size": ${L_SIZE:-0},
    "sha256": "${L_SHA256:-}"
  },
  "remote": {
    "exists": ${R_EXISTS:-0},
    "mtime": ${R_MTIME:-0},
    "size": ${R_SIZE:-0},
    "sha256": "${R_SHA256:-}"
  },
  "synced_at": "${SYNCED_AT}",
  "mode": "${SYNC_MODE}"
}
EOF

    echo -e "${GREEN}[sync] ✓ Manifest written${NC}"
}

# ============================================================================
# LOCAL START
# ============================================================================
local_start() {
    # Sync database before starting (remote-preferred) unless --skip-sync
    if [[ $ARG_SKIP_SYNC -eq 0 ]]; then
        sync_db_remote_preferred
    else
        echo ""
        echo -e "${YELLOW}[SKIP] Database sync skipped (--skip-sync flag)${NC}"
    fi

    if [[ $ARG_FRESH -eq 1 ]]; then
        echo ""
        echo -e "${BLUE}=== LOCAL FRESH START ===${NC}"

        echo "[1/7] Checking for npm..."
        command -v npm &> /dev/null || {
            echo -e "${RED}[ERROR] npm not found. Install Node.js from https://nodejs.org/${NC}"
            exit 1
        }

        echo "[2/7] Removing node_modules..."
        if [[ -d "node_modules" ]]; then
            rm -rf node_modules || {
                echo -e "${RED}[ERROR] Failed to remove node_modules${NC}"
                exit 1
            }
        fi

        echo "[3/7] Clean installing dependencies..."
        npm ci || {
            echo -e "${RED}[ERROR] npm ci failed${NC}"
            exit 1
        }

        echo "[4/7] Running tests..."
        npm run test || {
            echo -e "${RED}[ERROR] Tests failed; aborting start.${NC}"
            exit 1
        }

        echo "[5/7] Building project..."
        npm run build || {
            echo -e "${RED}[ERROR] Build failed${NC}"
            exit 1
        }

        echo "[6/7] Starting bot..."
        npm start
    else
        echo ""
        echo -e "${BLUE}=== LOCAL DEV START ===${NC}"

        echo "[1/4] Checking for npm..."
        command -v npm &> /dev/null || {
            echo -e "${RED}[ERROR] npm not found. Install Node.js from https://nodejs.org/${NC}"
            exit 1
        }

        echo "[2/4] Running tests..."
        npm run test || {
            echo -e "${RED}[ERROR] Tests failed; aborting start.${NC}"
            exit 1
        }

        echo "[3/4] Building project..."
        npm run build || {
            echo -e "${RED}[ERROR] Build failed${NC}"
            exit 1
        }

        echo "[4/4] Starting development server..."
        npm run dev
    fi
}

# ============================================================================
# REMOTE START
# ============================================================================
remote_start() {
    # Sync database before starting remote (remote-preferred) unless --skip-sync
    if [[ $ARG_SKIP_SYNC -eq 0 ]]; then
        sync_db_remote_preferred
    else
        echo ""
        echo -e "${YELLOW}[SKIP] Database sync skipped (--skip-sync flag)${NC}"
    fi

    if [[ $ARG_FRESH -eq 1 ]]; then
        echo ""
        echo -e "${BLUE}=== REMOTE FRESH DEPLOY ===${NC}"

        echo "[1/6] Checking for required tools..."
        command -v npm &> /dev/null || {
            echo -e "${RED}[ERROR] npm not found. Install Node.js from https://nodejs.org/${NC}"
            exit 1
        }
        command -v ssh &> /dev/null || {
            echo -e "${RED}[ERROR] ssh not found${NC}"
            exit 1
        }
        command -v scp &> /dev/null || {
            echo -e "${RED}[ERROR] scp not found${NC}"
            exit 1
        }

        echo "[2/6] Building project locally..."
        npm run build || {
            echo -e "${RED}[ERROR] Build failed${NC}"
            exit 1
        }

        echo "[3/6] Creating deployment tarball..."
        rm -f deploy.tar.gz
        tar -czf deploy.tar.gz dist package.json package-lock.json || {
            echo -e "${RED}[ERROR] Failed to create tarball${NC}"
            exit 1
        }

        echo "[4/6] Uploading to remote server..."
        scp deploy.tar.gz "${REMOTE_ALIAS}:${REMOTE_PATH}/" || {
            echo -e "${RED}[ERROR] Failed to upload tarball${NC}"
            exit 1
        }

        echo "[5/6] Extracting and installing on remote..."
        ssh "$REMOTE_ALIAS" "bash -lc 'cd ${REMOTE_PATH} && tar -xzf deploy.tar.gz && npm ci'" || {
            echo -e "${RED}[ERROR] Remote extraction/install failed${NC}"
            exit 1
        }

        echo "[6/6] Restarting PM2 process..."
        if ! ssh "$REMOTE_ALIAS" "bash -lc 'pm2 restart ${PM2_NAME}'"; then
            echo -e "${YELLOW}[WARN] PM2 restart failed, attempting start...${NC}"
            ssh "$REMOTE_ALIAS" "bash -lc 'pm2 start ${REMOTE_PATH}/dist/index.js --name ${PM2_NAME}'"
        fi

        echo ""
        echo -e "${GREEN}[SUCCESS] Remote fresh deploy complete${NC}"
        echo "Cleaning up local tarball..."
        rm -f deploy.tar.gz
    else
        echo ""
        echo -e "${BLUE}=== REMOTE RESTART ===${NC}"

        echo "[1/2] Checking for ssh..."
        command -v ssh &> /dev/null || {
            echo -e "${RED}[ERROR] ssh not found${NC}"
            exit 1
        }

        echo "[2/2] Restarting PM2 process on remote..."
        if ! ssh "$REMOTE_ALIAS" "bash -lc 'pm2 restart ${PM2_NAME}'"; then
            echo -e "${RED}[ERROR] Failed to restart remote process${NC}"
            echo "[INFO] Check if PM2 process exists: ssh ${REMOTE_ALIAS} \"bash -lc 'pm2 list'\""
            exit 1
        fi

        echo ""
        echo -e "${GREEN}[SUCCESS] Remote bot restarted${NC}"
    fi
}

# ============================================================================
# STOP ALL OPERATIONS
# ============================================================================
stop_all() {
    echo ""
    echo -e "${BLUE}=== STOP ALL PROCESSES ===${NC}"

    # Stop local PM2 process (if running)
    echo "[1/4] Checking for local PM2 process..."
    if command -v pm2 &> /dev/null; then
        echo "Stopping local PM2 process: ${PM2_NAME}..."
        pm2 stop "$PM2_NAME" &>/dev/null || true
        pm2 delete "$PM2_NAME" &>/dev/null || true
        echo "Local PM2 process stopped (if it was running)"
    else
        echo "PM2 not found locally, skipping local stop"
    fi

    # Kill any process using local port
    echo "[2/4] Freeing port ${LOCAL_PORT}..."
    if command -v lsof &> /dev/null; then
        PID=$(lsof -ti:${LOCAL_PORT} 2>/dev/null || true)
        if [[ -n "$PID" ]]; then
            echo "Killing process $PID on port ${LOCAL_PORT}..."
            kill -9 $PID 2>/dev/null || true
        fi
    fi
    echo "Port ${LOCAL_PORT} freed (if it was occupied)"

    # Stop Node.js dev processes
    echo "[3/4] Stopping Node.js dev processes..."
    pkill -f "node.*pawtropolis" 2>/dev/null || true
    echo "Node.js processes stopped (if any were running)"

    # Stop remote PM2 process
    echo "[4/4] Stopping remote PM2 process..."
    if command -v ssh &> /dev/null; then
        ssh "$REMOTE_ALIAS" "bash -lc 'pm2 stop ${PM2_NAME} 2>/dev/null || true; pm2 save 2>/dev/null || true'" &>/dev/null || true
        echo "Remote PM2 process stopped (if it was running)"
    else
        echo "SSH not found, skipping remote stop"
    fi

    echo ""
    echo -e "${GREEN}[SUCCESS] Stop operation complete${NC}"
}

# ============================================================================
# SWITCH OPERATION
# ============================================================================
switch_operation() {
    echo ""
    echo -e "${BLUE}=== INTELLIGENT SWITCH ===${NC}"
    echo "[switch] Detecting current state..."

    # Step 1: Check if local bot is running
    LOCAL_RUNNING=0
    if pgrep -f "node.*pawtropolis" &>/dev/null; then
        LOCAL_RUNNING=1
    fi
    # Also check local PM2
    if command -v pm2 &> /dev/null; then
        if pm2 jlist 2>/dev/null | grep -q "\"name\":\"${PM2_NAME}\""; then
            LOCAL_RUNNING=1
        fi
    fi

    # Step 2: Check if remote bot is running
    REMOTE_RUNNING=0
    REMOTE_COUNT=$(ssh "$REMOTE_ALIAS" "bash -lc 'pm2 jlist 2>/dev/null | grep -c \"\\\"name\\\":\\\"${PM2_NAME}\\\"\" || echo 0'" 2>/dev/null || echo "0")
    if [[ "$REMOTE_COUNT" -gt 0 ]]; then
        REMOTE_RUNNING=1
    fi

    echo "[switch] Local running:  ${LOCAL_RUNNING}"
    echo "[switch] Remote running: ${REMOTE_RUNNING}"

    # Step 3: Get sync markers from both databases
    echo "[switch] Reading sync markers..."

    # Local sync marker
    L_MARKER_TIME=0
    L_MARKER_BY="unknown"
    L_MARKER_COUNT=0
    if [[ -f "$DB_LOCAL" ]] && command -v sqlite3 &>/dev/null; then
        MARKER=$(sqlite3 "$DB_LOCAL" "SELECT last_modified_at, last_modified_by, action_count FROM sync_marker WHERE id=1;" 2>/dev/null || echo "")
        if [[ -n "$MARKER" ]]; then
            IFS='|' read -r L_MARKER_TIME L_MARKER_BY L_MARKER_COUNT <<< "$MARKER"
        fi
    fi
    echo "[switch] Local  marker: time=${L_MARKER_TIME} by=${L_MARKER_BY} count=${L_MARKER_COUNT}"

    # Remote sync marker
    R_MARKER_TIME=0
    R_MARKER_BY="unknown"
    R_MARKER_COUNT=0
    MARKER=$(ssh "$REMOTE_ALIAS" "sqlite3 ${DB_REMOTE} 'SELECT last_modified_at, last_modified_by, action_count FROM sync_marker WHERE id=1;' 2>/dev/null" 2>/dev/null || echo "")
    if [[ -n "$MARKER" ]]; then
        IFS='|' read -r R_MARKER_TIME R_MARKER_BY R_MARKER_COUNT <<< "$MARKER"
    fi
    echo "[switch] Remote marker: time=${R_MARKER_TIME} by=${R_MARKER_BY} count=${R_MARKER_COUNT}"

    # Step 4: Determine which database is fresher
    FRESHER="unknown"
    if [[ "$L_MARKER_COUNT" -gt "$R_MARKER_COUNT" ]]; then
        FRESHER="local"
    elif [[ "$R_MARKER_COUNT" -gt "$L_MARKER_COUNT" ]]; then
        FRESHER="remote"
    elif [[ "$L_MARKER_TIME" -gt "$R_MARKER_TIME" ]]; then
        FRESHER="local"
    elif [[ "$R_MARKER_TIME" -gt "$L_MARKER_TIME" ]]; then
        FRESHER="remote"
    else
        FRESHER="equal"
    fi
    echo "[switch] Fresher database: ${FRESHER}"

    # Step 5: Handle both running case
    if [[ $LOCAL_RUNNING -eq 1 ]] && [[ $REMOTE_RUNNING -eq 1 ]]; then
        echo ""
        echo "========================================================="
        echo "   BOTH LOCAL AND REMOTE ARE RUNNING"
        echo "   Fresher database: ${FRESHER}"
        echo "========================================================="
        echo ""
        echo "Choose direction:"
        echo "  [1] Switch to LOCAL  (sync remote->local, stop remote, start local)"
        echo "  [2] Switch to REMOTE (sync local->remote, stop local, start remote)"
        echo "  [3] Cancel"
        echo ""
        read -r -p "Enter choice (1/2/3): " CHOICE

        case "$CHOICE" in
            1) SYNC_DIRECTION="to-local" ;;
            2) SYNC_DIRECTION="to-remote" ;;
            *)
                echo "[switch] Cancelled."
                exit 0
                ;;
        esac
    elif [[ $REMOTE_RUNNING -eq 1 ]] && [[ $LOCAL_RUNNING -eq 0 ]]; then
        echo "[switch] Remote is running, will switch to LOCAL"
        SYNC_DIRECTION="to-local"
    elif [[ $LOCAL_RUNNING -eq 1 ]] && [[ $REMOTE_RUNNING -eq 0 ]]; then
        echo "[switch] Local is running, will switch to REMOTE"
        SYNC_DIRECTION="to-remote"
    else
        echo "[switch] Neither local nor remote is running."
        echo "[switch] Use --local or --remote to start the bot."
        exit 0
    fi

    # Execute switch
    echo ""
    echo "[switch] Direction: ${SYNC_DIRECTION}"
    echo "[switch] Fresher:   ${FRESHER}"
    echo ""

    if [[ "$SYNC_DIRECTION" == "to-local" ]]; then
        # Switching TO LOCAL: pull remote DB, stop remote, start local

        # Warn if local is fresher
        if [[ "$FRESHER" == "local" ]]; then
            echo "========================================================="
            echo -e "${YELLOW}   WARNING: Local database appears FRESHER than remote!${NC}"
            echo -e "${YELLOW}   Pulling remote will overwrite local changes.${NC}"
            echo "========================================================="
            read -r -p "Continue anyway? (y/N): " CONFIRM
            if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
                echo "[switch] Cancelled."
                exit 0
            fi
        fi

        # 1. Sync DB (remote -> local)
        sync_db_remote_preferred

        # 2. Stop remote
        echo "[switch] Stopping remote bot..."
        ssh "$REMOTE_ALIAS" "bash -lc 'pm2 stop ${PM2_NAME}'" || true

        # 3. Start local
        echo "[switch] Starting local bot..."
        npm run dev

    elif [[ "$SYNC_DIRECTION" == "to-remote" ]]; then
        # Switching TO REMOTE: push local DB, stop local, start remote

        # Warn if remote is fresher
        if [[ "$FRESHER" == "remote" ]]; then
            echo "========================================================="
            echo -e "${YELLOW}   WARNING: Remote database appears FRESHER than local!${NC}"
            echo -e "${YELLOW}   Pushing local will overwrite remote changes.${NC}"
            echo "========================================================="
            read -r -p "Continue anyway? (y/N): " CONFIRM
            if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
                echo "[switch] Cancelled."
                exit 0
            fi
        fi

        # 1. Stop local first (to checkpoint WAL)
        echo "[switch] Stopping local processes..."
        pkill -f "node.*pawtropolis" 2>/dev/null || true
        if command -v pm2 &>/dev/null; then
            pm2 stop "$PM2_NAME" &>/dev/null || true
        fi

        # 2. Push DB (local -> remote)
        push_db_to_remote

        # 3. Start remote
        echo "[switch] Starting remote bot..."
        ssh "$REMOTE_ALIAS" "bash -lc 'pm2 restart ${PM2_NAME}'"
    fi

    echo ""
    echo -e "${GREEN}[switch] Switch complete!${NC}"
}

# ============================================================================
# INTERACTIVE RECOVERY
# ============================================================================
interactive_recovery() {
    echo ""
    echo -e "${BLUE}=== INTERACTIVE DB RECOVERY ===${NC}"
    echo "[recovery] Launching interactive recovery tool..."
    echo ""

    # Check if the CLI recovery script exists
    if [[ -f "src/ops/dbRecoverCli.ts" ]]; then
        npm run db:recover
    else
        echo -e "${RED}[ERROR] Recovery script not found${NC}"
        exit 1
    fi
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

# Validate argument combinations
if [[ $ARG_LOCAL -eq 1 ]] && [[ $ARG_REMOTE -eq 1 ]]; then
    echo -e "${RED}[ERROR] Cannot use --local and --remote together${NC}"
    usage
    exit 1
fi

if [[ $ARG_FRESH -eq 1 ]] && [[ $ARG_LOCAL -eq 0 ]] && [[ $ARG_REMOTE -eq 0 ]]; then
    echo -e "${RED}[ERROR] --fresh requires either --local or --remote${NC}"
    usage
    exit 1
fi

# Execute appropriate operation
if [[ $ARG_SWITCH -eq 1 ]]; then
    switch_operation
elif [[ $ARG_RECOVER -eq 1 ]]; then
    interactive_recovery
elif [[ $ARG_RECOVER_DB -eq 1 ]]; then
    recover_remote_db
elif [[ $ARG_PUSH_REMOTE -eq 1 ]]; then
    push_db_to_remote
elif [[ $ARG_STOP -eq 1 ]]; then
    stop_all
elif [[ $ARG_LOCAL -eq 1 ]]; then
    local_start
elif [[ $ARG_REMOTE -eq 1 ]]; then
    remote_start
else
    # Default to --local when no operation specified
    local_start
fi
