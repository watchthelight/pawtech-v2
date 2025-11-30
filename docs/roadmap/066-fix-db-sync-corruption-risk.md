# Issue #66: Fix Database Sync Corruption Risk

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix / Data Integrity
**Estimated Effort:** 45 minutes

---

## Summary

`scripts/start.sh` has race conditions and error handling issues that could lead to database corruption.

## Issues Found

### Issue 1: PM2 Stop Race Condition (Lines 336-344)

```bash
if [[ "$PM2_RUNNING" -gt 0 ]]; then
    echo "[sync] Remote PM2 process is running - stopping to prevent corruption..."
    ssh "$REMOTE_ALIAS" "bash -lc 'pm2 stop ${PM2_NAME}'" &>/dev/null || true
    echo "[sync] Remote process stopped"
fi
# Immediately proceeds to copy database
```

**Problem**: Script proceeds immediately after PM2 stop without verifying it actually stopped or waiting for writes to flush.

### Issue 2: Silent Verification Failure (Lines 273-279)

```bash
if ssh -o ConnectTimeout=5 -o BatchMode=yes "$REMOTE_ALIAS" "cd ${REMOTE_PATH} 2>/dev/null && timeout 10 node scripts/verify-db-integrity.js ${DB_REMOTE} 2>/dev/null" &>/dev/null; then
    echo -e "${GREEN}[sync] ✓ Remote database passed integrity check${NC}"
else
    echo "[sync] Remote verification unavailable or failed - will verify after download"
fi
```

**Problem**: Doesn't distinguish between "unavailable" and "failed". If verification actively fails due to corruption, script continues and may overwrite good local database.

### Issue 3: Temp File Not Cleaned on Error (Line 286)

```bash
TEMP_DB="${DB_LOCAL}.temp"
scp "${REMOTE_ALIAS}:${DB_REMOTE}" "$TEMP_DB" || {
    echo -e "${RED}[ERROR] Failed to pull remote database${NC}"
    exit 1  # Exits without removing TEMP_DB
}
```

## Proposed Changes

### Fix 1: Add PM2 Stop Verification

```bash
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
fi
```

### Fix 2: Distinguish Verification Results

```bash
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
```

### Fix 3: Add Cleanup Trap

```bash
# At top of function
TEMP_DB=""
cleanup() {
    [[ -n "$TEMP_DB" && -f "$TEMP_DB" ]] && rm -f "$TEMP_DB"
}
trap cleanup EXIT

# Then use TEMP_DB as before
TEMP_DB="${DB_LOCAL}.temp"
```

## Files Affected

- `scripts/start.sh:273-279,286,336-344`

## Testing Strategy

1. Test sync when PM2 is running
2. Test sync when PM2 fails to stop
3. Test sync with corrupted remote database
4. Test cleanup of temp files on error
