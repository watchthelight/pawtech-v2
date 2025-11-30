# Issue #15: Fix Race Condition in Artist Rotation Queue

**Status:** Planned
**Priority:** High (Concurrency Bug)
**Estimated Effort:** 2-3 hours
**Created:** 2025-11-30

## Summary

Queue position updates in the artist rotation system are not atomic. When an artist is assigned to a ticket, two separate database operations occur (`moveToEnd()` and `incrementAssignments()`), which can result in incorrect queue positions if multiple assignments happen simultaneously. This race condition violates data integrity guarantees.

## Current State

### Problem

**Location:** `src/features/artistRotation/handlers.ts:154-168`

When confirming an art reward assignment, the code executes two separate database operations:

```typescript
// Step 3: Update queue (if not override, move artist to end)
let newPosition: number | null = null;
const artistInfo = getArtist(guild.id, data.artistId);
const oldPosition = artistInfo?.position ?? null;

if (!data.isOverride && oldPosition !== null) {
  newPosition = moveToEnd(guild.id, data.artistId);     // Operation 1: Multiple UPDATE statements
  incrementAssignments(guild.id, data.artistId);       // Operation 2: Separate UPDATE statement

  const queueSize = getAllArtists(guild.id).length;
  results.push(`Artist moved from #${oldPosition} to #${queueSize} in queue`);
} else if (data.isOverride) {
  // Still increment assignments for override artist
  incrementAssignments(guild.id, data.artistId);
  results.push(`*Override - queue position unchanged*`);
}
```

### Implementation Details

**`moveToEnd()` function** (`src/features/artistRotation/queue.ts:161-197`):
1. Reads artist's current position
2. Gets max position in queue
3. Updates all artists after current position (decrement by 1)
4. Updates artist to max position

**`incrementAssignments()` function** (`src/features/artistRotation/queue.ts:290-297`):
1. Increments assignment count
2. Updates last_assigned_at timestamp

### Race Condition Scenarios

**Scenario 1: Concurrent Assignments to Same Artist**
- Thread A: Reads artist position = 3, max = 10
- Thread B: Reads artist position = 3, max = 10
- Thread A: Moves others up (positions 4-10 become 3-9)
- Thread B: Moves others up (positions 4-10 become 3-9) - **INCORRECT, artist already moved**
- Thread A: Sets artist position = 10
- Thread B: Sets artist position = 10 - **DUPLICATE POSITION**

**Scenario 2: Assignment During Position Update**
- Thread A: Starts moving artist A from position 3 to end (max = 10)
- Thread B: Starts incrementing assignments for artist A
- Thread A: Updates positions 4-10 to 3-9
- Thread B: Increments assignments (position still 3)
- Thread A: Sets artist A position = 10
- Result: Assignment count updated but position briefly inconsistent

**Scenario 3: Multiple Concurrent Assignments**
- Multiple staff members click confirm simultaneously for different artists
- Queue position calculations race
- Final queue state depends on execution order
- Position gaps or duplicates possible

### Risk Assessment

- **Attack Vector:** Multiple staff confirming rewards simultaneously (common in busy servers)
- **Impact:**
  - Queue position corruption (duplicates, gaps, wrong order)
  - Artists getting unfair number of assignments
  - Assignment count mismatches with actual assignments
  - Potential audit trail inconsistencies
- **Likelihood:** Medium-High (multi-staff servers with active art commission system)
- **Severity:** HIGH - corrupts core rotation fairness mechanism
- **Current Mitigation:** None - relies on sequential button clicks (unrealistic)

### Database Schema

**`artist_queue` table** (`src/db/db.ts:293-308`):
```sql
CREATE TABLE IF NOT EXISTS artist_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  assignments_count INTEGER DEFAULT 0,
  last_assigned_at TEXT,
  skipped INTEGER DEFAULT 0,
  skip_reason TEXT,
  UNIQUE(guild_id, user_id)
)
```

**Index:** `idx_artist_queue_guild_position` on `(guild_id, position)`

## Proposed Changes

### Step 1: Create Atomic Assignment Transaction

**Goal:** Wrap both queue update and assignment increment in a single database transaction

**Location:** `src/features/artistRotation/queue.ts`

Add new function after `incrementAssignments()` (around line 298):

```typescript
/**
 * processAssignment
 * WHAT: Atomically move artist to end of queue and increment assignment count.
 * WHY: Prevents race conditions when multiple assignments happen simultaneously.
 * SECURITY: Uses transaction to ensure queue position and assignment count are updated atomically.
 *
 * @param guildId - Guild ID
 * @param userId - Artist user ID
 * @returns Object with old position, new position, and new assignment count
 */
export function processAssignment(
  guildId: string,
  userId: string
): { oldPosition: number; newPosition: number; assignmentsCount: number } | null {
  return db.transaction(() => {
    // 1. Get current artist state
    const artist = db
      .prepare(`SELECT position, assignments_count FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) as { position: number; assignments_count: number } | undefined;

    if (!artist) {
      logger.warn({ guildId, userId }, "[artistQueue] Cannot process assignment - artist not in queue");
      return null;
    }

    const currentPosition = artist.position;
    const maxPosition = getMaxPosition(guildId);

    // 2. Move artist to end (only if not already there)
    if (currentPosition !== maxPosition) {
      // Move everyone after this artist up by 1
      db.prepare(
        `UPDATE artist_queue SET position = position - 1 WHERE guild_id = ? AND position > ?`
      ).run(guildId, currentPosition);

      // Move this artist to the end
      db.prepare(
        `UPDATE artist_queue SET position = ? WHERE guild_id = ? AND user_id = ?`
      ).run(maxPosition, guildId, userId);
    }

    // 3. Increment assignments and update timestamp
    const newAssignmentsCount = artist.assignments_count + 1;
    db.prepare(
      `UPDATE artist_queue
       SET assignments_count = ?,
           last_assigned_at = datetime('now')
       WHERE guild_id = ? AND user_id = ?`
    ).run(newAssignmentsCount, guildId, userId);

    logger.info(
      {
        guildId,
        userId,
        oldPosition: currentPosition,
        newPosition: maxPosition,
        assignmentsCount: newAssignmentsCount,
      },
      "[artistQueue] Assignment processed atomically"
    );

    return {
      oldPosition: currentPosition,
      newPosition: maxPosition,
      assignmentsCount: newAssignmentsCount,
    };
  })();
}
```

### Step 2: Update Handler to Use Atomic Function

**Goal:** Replace separate operations with single atomic transaction

**Location:** `src/features/artistRotation/handlers.ts:153-168`

Replace the non-atomic operations:

```typescript
// Step 3: Update queue (if not override, move artist to end)
const artistInfo = getArtist(guild.id, data.artistId);
const oldPosition = artistInfo?.position ?? null;

if (!data.isOverride && oldPosition !== null) {
  const result = processAssignment(guild.id, data.artistId);

  if (result) {
    const queueSize = getAllArtists(guild.id).length;
    results.push(`Artist moved from #${result.oldPosition} to #${result.newPosition} in queue (${result.assignmentsCount} total assignments)`);
  } else {
    results.push(`*Failed to update queue - artist not found*`);
    success = false;
  }
} else if (data.isOverride) {
  // Still increment assignments for override artist
  incrementAssignments(guild.id, data.artistId);
  results.push(`*Override - queue position unchanged*`);
}
```

### Step 3: Export New Function from index.ts

**Goal:** Make new function available to handlers

**Location:** `src/features/artistRotation/index.ts`

The file already exports all from queue.ts, so `processAssignment` will be automatically available. No changes needed.

### Step 4: Add Transaction Documentation

**Goal:** Document transaction usage for future maintainers

**Location:** `src/features/artistRotation/queue.ts:1-11`

Update file header:

```typescript
/**
 * Pawtropolis Tech — src/features/artistRotation/queue.ts
 * WHAT: Queue CRUD operations for Server Artist rotation.
 * WHY: Manage artist queue positions, assignments, and sync with role holders.
 * FLOWS:
 *  - addArtist: Add new artist to end of queue
 *  - removeArtist: Remove artist and reorder positions
 *  - getNextArtist: Get next non-skipped artist in rotation
 *  - processAssignment: ATOMIC move artist to end + increment assignments (transaction)
 *  - moveToEnd: Legacy function - prefer processAssignment for assignment flow
 *  - syncWithRole: Sync queue with current Server Artist role holders
 *
 * CONCURRENCY:
 *  - processAssignment uses db.transaction() for atomic queue updates
 *  - Prevents race conditions during simultaneous assignments
 *  - better-sqlite3 transactions are synchronous and ACID-compliant
 */
```

### Step 5: Deprecate Separate Operations Pattern

**Goal:** Prevent future code from using non-atomic pattern

Add JSDoc warning to `moveToEnd()`:

```typescript
/**
 * moveToEnd
 * WHAT: Move an artist to the end of the queue after assignment.
 * WHY: Rotate artists fairly - after handling a request, go to back of line.
 *
 * @deprecated Use processAssignment() instead when incrementing assignments.
 *             This function should only be used for manual queue reordering.
 *             Calling moveToEnd() + incrementAssignments() separately creates race conditions.
 */
export function moveToEnd(guildId: string, userId: string): number {
  // ... existing implementation
}
```

## Files Affected

### Modified
- `src/features/artistRotation/queue.ts`
  - Add `processAssignment()` function (~line 298)
  - Update file header documentation (~line 1-11)
  - Add deprecation warning to `moveToEnd()` (~line 157)

- `src/features/artistRotation/handlers.ts`
  - Update `handleConfirm()` to use `processAssignment()` (~line 158-161)
  - Update import to include `processAssignment` (~line 14-24)

### Unchanged (reference only)
- `src/features/artistRotation/index.ts` - Already exports all from queue.ts
- `src/db/db.ts` - Transaction method already available from better-sqlite3
- `src/features/artistRotation/types.ts` - No new types needed

## Testing Strategy

### Pre-Change Testing

1. **Verify current behavior**
   ```bash
   # Start bot in test environment
   NODE_ENV=test npm run dev

   # Test assignment flow manually:
   # 1. Create test artist queue with /artistqueue commands
   # 2. Use /redeemreward to assign art to next artist
   # 3. Verify artist moves to end and assignment increments
   ```

2. **Document baseline queue state**
   ```sql
   -- Query current queue state
   SELECT guild_id, user_id, position, assignments_count
   FROM artist_queue
   ORDER BY guild_id, position;
   ```

### Concurrency Testing

1. **Race Condition Simulation**

   Create test script `scripts/test-artist-race-condition.ts`:
   ```typescript
   import { db } from "../src/db/db.js";
   import { processAssignment, addArtist, getAllArtists } from "../src/features/artistRotation/index.js";

   // Setup test guild with 5 artists
   const GUILD_ID = "test-guild-123";
   const ARTISTS = ["artist1", "artist2", "artist3", "artist4", "artist5"];

   // Clear and setup queue
   db.prepare("DELETE FROM artist_queue WHERE guild_id = ?").run(GUILD_ID);
   ARTISTS.forEach(id => addArtist(GUILD_ID, id));

   console.log("Initial queue:", getAllArtists(GUILD_ID));

   // Simulate 100 concurrent assignments to artist1
   const results = [];
   for (let i = 0; i < 100; i++) {
     const result = processAssignment(GUILD_ID, "artist1");
     results.push(result);
   }

   // Verify consistency
   const finalQueue = getAllArtists(GUILD_ID);
   const artist1 = finalQueue.find(a => a.user_id === "artist1");

   console.log("Final queue:", finalQueue);
   console.log("Artist1 final state:", artist1);
   console.log("✓ Assignment count:", artist1?.assignments_count === 100);
   console.log("✓ Position is last:", artist1?.position === ARTISTS.length);
   console.log("✓ No position gaps:", finalQueue.every((a, i) => a.position === i + 1));
   ```

   Run test:
   ```bash
   npm run build
   node dist/scripts/test-artist-race-condition.js
   ```

2. **Multi-Artist Concurrent Test**
   ```typescript
   // Test simultaneous assignments to different artists
   // Verify queue positions remain consistent
   // No duplicates, no gaps, all artists at correct positions
   ```

### Integration Testing

1. **Manual testing in Discord**
   ```
   1. Setup test server with Server Artist role
   2. Add 3-5 test artists to queue
   3. Have 2-3 staff members confirm rewards simultaneously
   4. Check queue state with /artistqueue
   5. Verify positions are correct and no duplicates
   ```

2. **Database integrity checks**
   ```sql
   -- Check for duplicate positions
   SELECT guild_id, position, COUNT(*) as count
   FROM artist_queue
   GROUP BY guild_id, position
   HAVING count > 1;

   -- Check for position gaps
   WITH RECURSIVE expected_positions(pos) AS (
     SELECT 1
     UNION ALL
     SELECT pos + 1 FROM expected_positions
     WHERE pos < (SELECT MAX(position) FROM artist_queue WHERE guild_id = ?)
   )
   SELECT pos FROM expected_positions
   WHERE pos NOT IN (
     SELECT position FROM artist_queue WHERE guild_id = ?
   );
   ```

### Regression Testing

1. **Verify existing functionality**
   - `/redeemreward` command still works
   - `/artistqueue` displays correct queue
   - Override assignments work correctly
   - Assignment logging still functions
   - Manual queue reordering still works

2. **TypeScript compilation**
   ```bash
   npm run build
   # Should complete without errors
   ```

3. **Linting**
   ```bash
   npm run lint
   # No new warnings
   ```

## Rollback Plan

### If Transaction Causes Deadlocks

**Scenario:** better-sqlite3 synchronous transactions block longer than expected

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   npm run build
   pm2 restart pawtropolis-tech
   ```

2. **Investigation**
   - Check DB_TRACE logs for slow queries
   - Verify WAL mode is enabled (should be, it's in db.ts)
   - Look for long-running transactions elsewhere

3. **Resolution**
   - Optimize transaction scope (already minimal)
   - Or: Add retry logic with exponential backoff
   - Or: Use `db.pragma('busy_timeout')` (already set to 5000ms)

### If Assignment Count Incorrect

**Scenario:** Assignment count doesn't match actual assignments after migration

1. **Verification Query**
   ```sql
   SELECT
     aq.guild_id,
     aq.user_id,
     aq.assignments_count as queue_count,
     COUNT(aal.id) as log_count
   FROM artist_queue aq
   LEFT JOIN artist_assignment_log aal
     ON aq.guild_id = aal.guild_id
     AND aq.user_id = aal.artist_id
   GROUP BY aq.guild_id, aq.user_id
   HAVING queue_count != log_count;
   ```

2. **Data Repair Script**
   ```typescript
   // Sync assignment counts from log
   const artists = db.prepare("SELECT guild_id, user_id FROM artist_queue").all();
   for (const { guild_id, user_id } of artists) {
     const count = db.prepare(
       "SELECT COUNT(*) as c FROM artist_assignment_log WHERE guild_id = ? AND artist_id = ?"
     ).get(guild_id, user_id).c;

     db.prepare(
       "UPDATE artist_queue SET assignments_count = ? WHERE guild_id = ? AND user_id = ?"
     ).run(count, guild_id, user_id);
   }
   ```

3. **Keep Fix in Place**
   - Transaction is still correct solution
   - Data repair is one-time operation

### If Queue Positions Corrupted

**Scenario:** Migration applied but some positions still duplicated/gapped from pre-fix state

1. **Position Repair Script**
   ```typescript
   // Rebuild queue positions for all guilds
   const guilds = db.prepare("SELECT DISTINCT guild_id FROM artist_queue").all();

   for (const { guild_id } of guilds) {
     const artists = db.prepare(
       "SELECT id FROM artist_queue WHERE guild_id = ? ORDER BY position, id"
     ).all(guild_id);

     artists.forEach((artist, index) => {
       db.prepare("UPDATE artist_queue SET position = ? WHERE id = ?")
         .run(index + 1, artist.id);
     });
   }
   ```

2. **Verify repair worked**
   ```sql
   -- Should return no rows
   SELECT guild_id, position, COUNT(*)
   FROM artist_queue
   GROUP BY guild_id, position
   HAVING COUNT(*) > 1;
   ```

### Emergency Rollback Procedure

If deployed and causing immediate production issues:

```bash
# 1. Hotfix: Revert to previous version
git revert <commit-hash>
git push origin main

# 2. Deploy immediately
npm run build
pm2 restart pawtropolis-tech

# 3. Notify team
# Post in staff channel about rollback and investigating

# 4. Debug offline
git checkout -b debug/artist-queue-transaction
# Reproduce issue in test environment
# Fix with additional logging/validation

# 5. Re-deploy with proper testing
# Run full concurrency test suite
# Manual verification in staging
# Deploy to production
```

## Success Criteria

- [ ] `processAssignment()` function created with transaction wrapper
- [ ] Handler updated to use atomic function
- [ ] Deprecation warning added to `moveToEnd()`
- [ ] File header documentation updated
- [ ] Concurrency race test passes 100 iterations without corruption
- [ ] Multi-artist concurrent test shows no position conflicts
- [ ] Manual Discord testing shows correct queue behavior
- [ ] Database integrity checks pass (no duplicate positions, no gaps)
- [ ] Assignment counts match assignment log
- [ ] TypeScript compilation succeeds
- [ ] All existing artist rotation commands still work
- [ ] Performance is not noticeably degraded

## Timeline

1. **Hour 1: Implementation** - 45 minutes
   - Create `processAssignment()` transaction function
   - Update handler to use new function
   - Add deprecation warnings
   - Update documentation

2. **Hour 1-2: Testing** - 45 minutes
   - Write concurrency test script
   - Run race condition simulations
   - Verify database integrity
   - Manual testing in Discord

3. **Hour 2-3: Validation & Review** - 30 minutes
   - Run full regression test suite
   - Code review focusing on transaction correctness
   - Verify all edge cases handled
   - Performance testing

4. **Hour 3: Documentation & Deployment** - 30 minutes
   - Update any related documentation
   - Prepare deployment checklist
   - Create rollback procedure documentation
   - Deploy to staging for final verification

**Total estimated time:** 2.5-3 hours

## References

- **better-sqlite3 Transactions:** https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function
- **SQLite Transaction Isolation:** https://www.sqlite.org/isolation.html
- **WAL Mode Concurrency:** https://www.sqlite.org/wal.html
- **Race Condition Prevention:** https://en.wikipedia.org/wiki/Race_condition#Computing
- **Existing transaction pattern:** `src/features/review/flows/approve.ts:54-87` (approveTx example)
- **Database schema:** `src/db/db.ts:293-308` (artist_queue table)
- **Issue location:** `src/features/artistRotation/handlers.ts:154-168`
