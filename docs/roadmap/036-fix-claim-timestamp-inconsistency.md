# Issue #36: Timestamp Inconsistency in Claim Transactions

**Status:** Planned
**Priority:** Medium
**Estimated Effort:** 1-2 hours
**Created:** 2025-11-30

## Summary

The `claimTx()` function in `reviewActions.ts` uses inconsistent timestamp formats when recording a single claim transaction. The `review_claim` table receives an ISO string via `nowUtc()`, while the `review_action` audit log receives Unix epoch seconds via `Math.floor(Date.now() / 1000)`. This creates potential timing discrepancies and confusion about when claims actually occurred.

## Current State

### Problem

**Location:** `src/features/reviewActions.ts:115-123`

```typescript
// Claim the application
// Using nowUtc() for consistency - returns ISO string compatible with SQLite datetime.
const claimedAt = nowUtc();
db.prepare(
  "INSERT INTO review_claim (app_id, reviewer_id, claimed_at) VALUES (?, ?, ?)"
).run(appId, moderatorId, claimedAt);

// Insert into review_action for audit trail (inside same transaction for atomicity)
// Uses epoch seconds for the action log - different from claimed_at which is ISO string.
// This inconsistency is legacy; new code should standardize on one format.
const createdAtEpoch = Math.floor(Date.now() / 1000);
db.prepare(
  "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'claim', ?)"
).run(appId, moderatorId, createdAtEpoch);
```

**Issues:**

1. **Two timestamp captures:** `nowUtc()` is called first, then `Date.now()` is called separately milliseconds later
2. **Timing skew:** The timestamps represent slightly different moments in time (milliseconds apart)
3. **Format mismatch:** `review_claim.claimed_at` receives Unix epoch seconds, `review_action.created_at` also receives Unix epoch seconds, but they're captured at different times
4. **Misleading comment:** Line 114 says "returns ISO string compatible with SQLite datetime" but `nowUtc()` actually returns Unix epoch INTEGER (not ISO string)
5. **Code confusion:** The comment acknowledges the inconsistency as "legacy" but the actual issue is the double timestamp capture
6. **Same issue in `unclaimTx()`:** Lines 192-195 have the same pattern for unclaim actions

### Why This Happened

1. **Comment confusion:** The comment at line 114 is incorrect - `nowUtc()` returns `number` (Unix epoch seconds), not ISO string
2. **Historical evolution:** The code was likely written at different times without coordinating timestamp strategy
3. **Copy-paste pattern:** The same pattern appears in both `claimTx()` and `unclaimTx()`
4. **Lack of awareness:** The comment at line 122 acknowledges inconsistency but misidentifies it as a format issue rather than a timing issue

### Actual Behavior of `nowUtc()`

From `src/lib/time.ts:28`:
```typescript
export const nowUtc = (): number => Math.floor(Date.now() / 1000);
```

**Returns:** Unix epoch seconds as INTEGER (e.g., `1729468800`)
**NOT:** ISO string (like `"2024-10-20T20:00:00.000Z"`)

### Database Schema

Both tables use INTEGER for timestamps:
- `review_claim.claimed_at`: INTEGER (Unix epoch seconds)
- `review_action.created_at`: INTEGER (Unix epoch seconds)

**Reference:** `ReviewClaimRow` type at line 30 shows `claimed_at: number; // Unix epoch seconds`

## Proposed Changes

### Strategy: Capture timestamp once, use consistently

**Rationale:**
- Single timestamp ensures both tables record the exact same moment
- Eliminates timing skew between claim record and audit log
- Simplifies code and removes redundant `Date.now()` call
- Makes transaction truly atomic (same timestamp across all writes)

### Step-by-Step Fix

#### Change 1: Fix `claimTx()` timestamp handling

**Before (lines 114-126):**
```typescript
// Using nowUtc() for consistency - returns ISO string compatible with SQLite datetime.
const claimedAt = nowUtc();
db.prepare(
  "INSERT INTO review_claim (app_id, reviewer_id, claimed_at) VALUES (?, ?, ?)"
).run(appId, moderatorId, claimedAt);

// Insert into review_action for audit trail (inside same transaction for atomicity)
// Uses epoch seconds for the action log - different from claimed_at which is ISO string.
// This inconsistency is legacy; new code should standardize on one format.
const createdAtEpoch = Math.floor(Date.now() / 1000);
db.prepare(
  "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'claim', ?)"
).run(appId, moderatorId, createdAtEpoch);
```

**After:**
```typescript
// Capture timestamp once for both claim record and audit log
// nowUtc() returns Unix epoch seconds (INTEGER), matching both table schemas
const timestamp = nowUtc();

db.prepare(
  "INSERT INTO review_claim (app_id, reviewer_id, claimed_at) VALUES (?, ?, ?)"
).run(appId, moderatorId, timestamp);

// Insert into review_action for audit trail (inside same transaction for atomicity)
db.prepare(
  "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'claim', ?)"
).run(appId, moderatorId, timestamp);
```

#### Change 2: Fix `unclaimTx()` timestamp handling

**Before (lines 189-195):**
```typescript
// Remove claim
db.prepare("DELETE FROM review_claim WHERE app_id = ?").run(appId);

// Insert into review_action for audit trail (inside same transaction for atomicity)
const createdAtEpoch = Math.floor(Date.now() / 1000);
db.prepare(
  "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'unclaim', ?)"
).run(appId, moderatorId, createdAtEpoch);
```

**After:**
```typescript
// Capture timestamp before deleting claim (for audit log)
const timestamp = nowUtc();

// Remove claim
db.prepare("DELETE FROM review_claim WHERE app_id = ?").run(appId);

// Insert into review_action for audit trail (inside same transaction for atomicity)
db.prepare(
  "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'unclaim', ?)"
).run(appId, moderatorId, timestamp);
```

#### Change 3: Update logging statement

**Before (line 129):**
```typescript
logger.info(
  { appId, moderatorId, guildId, claimedAt },
  "[reviewActions] claimTx: application claimed successfully"
);
```

**After:**
```typescript
logger.info(
  { appId, moderatorId, guildId, timestamp },
  "[reviewActions] claimTx: application claimed successfully"
);
```

## Files Affected

### Modified
- `src/features/reviewActions.ts`
  - Lines 114-126: Fix `claimTx()` timestamp handling
  - Line 129: Update logging to use `timestamp` instead of `claimedAt`
  - Lines 189-195: Fix `unclaimTx()` timestamp handling

### Reviewed (no changes needed)
- `src/lib/time.ts` - Already correct, `nowUtc()` returns Unix epoch seconds
- `src/features/review/flows/approve.ts` - Uses `nowUtc()` correctly (single call)
- `src/features/review/flows/reject.ts` - Uses `nowUtc()` correctly (single call)
- `src/features/review/flows/kick.ts` - Uses `nowUtc()` correctly (single call)

## Testing Strategy

### Pre-Deployment Testing

1. **Unit Tests:**
   - Test `claimTx()` writes same timestamp to both tables
   - Test `unclaimTx()` uses consistent timestamp in audit log
   - Verify timestamps are Unix epoch seconds (INTEGER)
   - Check that both inserts happen atomically in transaction

2. **Manual Testing:**
   ```bash
   # Start bot in development mode
   npm run dev

   # In Discord:
   # 1. Navigate to review channel
   # 2. Click "Claim Application" button
   # 3. Check database for timestamp consistency

   # Query database:
   sqlite3 pawtropolis.db "
     SELECT
       rc.app_id,
       rc.claimed_at as claim_timestamp,
       ra.created_at as audit_timestamp,
       (rc.claimed_at - ra.created_at) as diff_seconds
     FROM review_claim rc
     JOIN review_action ra ON rc.app_id = ra.app_id
     WHERE ra.action = 'claim'
     ORDER BY rc.claimed_at DESC
     LIMIT 10;
   "
   # diff_seconds should be 0 for all rows after fix
   ```

3. **Timing Validation:**
   ```typescript
   // Add temporary debug logging during testing
   const timestamp = nowUtc();
   logger.debug({ timestamp, type: typeof timestamp }, "Claim timestamp captured");

   // Verify:
   // - timestamp is a number
   // - timestamp is ~10 digits (Unix epoch seconds, not milliseconds)
   // - Same value used for both inserts
   ```

### Post-Deployment Validation

1. **Database Consistency Check:**
   ```sql
   -- Check for timestamp mismatches in new claims
   SELECT
     rc.app_id,
     rc.claimed_at,
     ra.created_at,
     datetime(rc.claimed_at, 'unixepoch') as claim_time,
     datetime(ra.created_at, 'unixepoch') as audit_time
   FROM review_claim rc
   JOIN review_action ra ON rc.app_id = ra.app_id
   WHERE ra.action = 'claim'
     AND rc.claimed_at > (strftime('%s', 'now') - 86400)  -- Last 24 hours
     AND rc.claimed_at != ra.created_at;  -- Should return 0 rows
   ```

2. **Functional Testing:**
   - Moderators claim applications normally
   - No errors in logs
   - Timestamps display correctly in UI
   - Audit trail shows correct claim times

3. **Monitoring:**
   - Watch for SQL errors related to timestamp types
   - Monitor claim/unclaim success rates
   - Check for any timing-related issues in logs

## Rollback Plan

### If Issues Detected

**Symptom:** Timestamp errors, type mismatches, or claim failures

**Action:**
```bash
# Immediate rollback
git revert HEAD
npm run build
pm2 restart pawtropolis-bot

# Or restore specific file
git checkout HEAD~1 -- src/features/reviewActions.ts
npm run build
pm2 restart pawtropolis-bot
```

### If Data Integrity Concerns

**Symptom:** Timestamp values look incorrect in database

**Action:**
1. Check database for invalid timestamps:
   ```sql
   SELECT app_id, claimed_at, datetime(claimed_at, 'unixepoch')
   FROM review_claim
   WHERE claimed_at > (strftime('%s', 'now') + 86400)  -- Future timestamps
      OR claimed_at < 1577836800;  -- Before 2020-01-01
   ```

2. If invalid data found:
   - Rollback immediately
   - Investigate root cause
   - No data migration needed (fix is forward-compatible)

### Recovery Procedure

No special recovery needed:
- Old data remains valid (already has Unix epoch timestamps)
- New code is fully compatible with existing data
- No schema changes required
- Transaction isolation prevents partial writes

## Success Criteria

- [ ] `claimTx()` captures timestamp once and uses for both inserts
- [ ] `unclaimTx()` uses consistent timestamp in audit log
- [ ] Both tables receive identical timestamp values for same action
- [ ] Comments accurately describe timestamp format (Unix epoch seconds)
- [ ] No timing skew between claim record and audit log
- [ ] All tests pass
- [ ] Manual testing confirms correct behavior
- [ ] Database query shows 0-second difference between timestamps
- [ ] Logging uses correct variable name (`timestamp` not `claimedAt`)

## Timeline Estimate

- **Code Changes:** 30 minutes
- **Testing:** 30 minutes
- **Code Review:** 15 minutes
- **Deployment:** 15 minutes
- **Total:** ~1.5 hours

## Related Issues

- Issue #11: Broader timestamp standardization across `guild_config` table
- `review_action` table already uses Unix epoch seconds (INTEGER) consistently
- `review_claim` table already uses Unix epoch seconds (INTEGER) for `claimed_at`
- This fix aligns with existing timestamp strategy in codebase

## References

- Codebase Audit: `/Users/bash/Documents/pawtropolis-tech/docs/CODEBASE_AUDIT_2025-11-30.md`
- Time utilities: `/Users/bash/Documents/pawtropolis-tech/src/lib/time.ts`
- Review actions: `/Users/bash/Documents/pawtropolis-tech/src/features/reviewActions.ts`
- SQLite date/time docs: https://www.sqlite.org/lang_datefunc.html
