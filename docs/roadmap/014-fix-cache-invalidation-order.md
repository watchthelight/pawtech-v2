# Issue #14: Fix Cache Invalidation Race Condition in Logging Store

**Status:** Planned
**Priority:** High
**Estimated Effort:** 30 minutes
**Created:** 2025-11-30

## Summary

The `loggingStore.ts` module invalidates its cache BEFORE writing to the database, creating a race condition where failed database writes can lead to stale cache data being served. This is inconsistent with the correct pattern used in `flaggerStore.ts`, which invalidates cache AFTER successful writes.

## Current State

### Problem

**Location:** `src/config/loggingStore.ts:118-120`

The `setLoggingChannelId()` function invalidates the cache before the database write:

```typescript
export function setLoggingChannelId(guildId: string, channelId: string): void {
  // Invalidate cache BEFORE write to ensure stale reads are impossible
  // If DB write fails, cache will repopulate on next read
  invalidateCache(guildId);

  const now = new Date().toISOString();

  try {
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, logging_channel_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        logging_channel_id = excluded.logging_channel_id,
        updated_at = excluded.updated_at
    `
    ).run(guildId, channelId, now);

    logger.info({ guildId, channelId }, "[config] logging_channel_id updated");
  } catch (err: unknown) {
    // Error handling...
    throw err;
  }
}
```

**Issues:**

1. **Cache invalidated too early:** Cache is cleared at line 120, before the DB write at line 130-138
2. **Race condition window:** Between cache invalidation and DB write, concurrent reads will hit the database
3. **Failed write impact:** If the DB write fails (lines 141-156), the cache is already invalidated
4. **Stale data risk:** Subsequent reads after a failed write will re-populate the cache with old data from the database
5. **Inconsistent pattern:** Contradicts the correct implementation in `flaggerStore.ts:175` and `flaggerStore.ts:226`

### Correct Pattern (from flaggerStore.ts)

The `flaggerStore.ts` module demonstrates the correct pattern:

```typescript
export function setFlagsChannelId(guildId: string, channelId: string): void {
  const now = new Date().toISOString();

  try {
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, flags_channel_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        flags_channel_id = excluded.flags_channel_id,
        updated_at = excluded.updated_at
    `
    ).run(guildId, channelId, now);

    // Invalidate cache AFTER successful write to prevent serving stale data
    // This ensures any subsequent reads get the fresh value from DB
    invalidateCache(guildId);

    logger.info({ guildId, channelId }, "[flagger] flags_channel_id updated");
  } catch (err: unknown) {
    // Error handling...
    throw err;
  }
}
```

**Why this is correct:**
- Cache is only invalidated AFTER the database write succeeds (line 175)
- If the write fails, the cache remains valid with the old data
- No race condition window between invalidation and write
- Subsequent reads always get consistent data

### Risk Assessment

**Severity:** Medium-High
- Cache inconsistency can cause incorrect logging channel configuration
- Failed writes leave system in inconsistent state
- Affects core logging infrastructure used by all features

**Impact:**
- Logs may be sent to wrong channel after failed configuration updates
- Administrators may believe config was updated when it wasn't
- Silent failures hard to diagnose

**Likelihood:** Low-Medium
- Database writes rarely fail in SQLite
- Most common failure is schema migration issues (already handled)
- Risk increases under disk I/O errors or file system issues

## Proposed Changes

### Step-by-Step Fix

**Goal:** Move cache invalidation to AFTER successful database write, matching the pattern in `flaggerStore.ts`

**Implementation:**

1. **Move `invalidateCache()` call** from line 120 to after the `db.prepare().run()` succeeds
2. **Update comment** to reflect the correct invalidation strategy
3. **Maintain error handling** - cache should NOT be invalidated if write fails

**Modified code:**

```typescript
export function setLoggingChannelId(guildId: string, channelId: string): void {
  // Use ISO8601 timestamp to match guild_config.updated_at column (TEXT type)
  // Note: guild_config uses updated_at (TEXT), not updated_at_s (INTEGER) like action_log
  const now = new Date().toISOString();

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    // ON CONFLICT ensures idempotent updates (safe to call multiple times)
    // This is called by /config set logging command (ManageGuild permission required)
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, logging_channel_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        logging_channel_id = excluded.logging_channel_id,
        updated_at = excluded.updated_at
    `
    ).run(guildId, channelId, now);

    // Invalidate cache AFTER successful write to prevent serving stale data
    // This ensures any subsequent reads get the fresh value from DB
    invalidateCache(guildId);

    logger.info({ guildId, channelId }, "[config] logging_channel_id updated");
  } catch (err: unknown) {
    // If the column doesn't exist, this means the migration hasn't run yet
    // Provide a helpful error message
    const error = err as Error;
    if (error?.message?.includes("has no column named logging_channel_id")) {
      logger.error(
        { err, guildId, channelId },
        "[config] guild_config table missing logging_channel_id column - database migration may not have run. Restart the bot to apply migrations."
      );
      throw new Error(
        "Database schema is outdated. Please restart the bot to apply pending migrations, then try again."
      );
    }
    // Re-throw other errors
    throw err;
  }
}
```

**Changes:**
- Line 120: Remove `invalidateCache(guildId)` and its comment
- Line 122-123: Remove now-unused comment about ISO8601 timestamp
- After `.run()` (new line after 138): Add `invalidateCache(guildId)` with correct comment
- Lines 118-119: Remove incorrect comment about invalidating before write

## Files Affected

### Modified
- `src/config/loggingStore.ts` - Move `invalidateCache()` call from before to after database write (lines 118-120 → after line 138)

### Reviewed (no changes needed)
- `src/config/flaggerStore.ts` - Already uses correct pattern (reference implementation)
- `src/features/modmail/routing.ts` - No cache invalidation pattern (different use case)
- `src/db/db.ts` - Database connection layer (not affected)

## Testing Strategy

### Manual Testing

1. **Successful write scenario**
   ```bash
   # Start bot in development mode
   npm run dev

   # In Discord, run:
   /config set logging channel:#test-logs

   # Verify:
   # - Command succeeds
   # - Cache is invalidated
   # - Subsequent /config get logging returns new channel
   # - Logs appear in new channel
   ```

2. **Failed write scenario (simulate schema error)**
   ```typescript
   // Temporarily modify loggingStore.ts to use wrong column name
   // This simulates a failed DB write

   // In Discord, run:
   /config set logging channel:#test-logs

   // Verify:
   // - Command fails with schema error
   // - Cache was NOT invalidated (old config still cached)
   // - Subsequent /config get logging returns OLD channel
   // - System remains in consistent state
   ```

### Unit Tests

Create `tests/config/loggingStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setLoggingChannelId, getLoggingChannelId } from "../../src/config/loggingStore.js";
import { db } from "../../src/db/db.js";

describe("loggingStore cache invalidation", () => {
  const testGuildId = "test-guild-123";
  const channel1 = "channel-1";
  const channel2 = "channel-2";

  beforeEach(() => {
    // Clear test data
    db.prepare("DELETE FROM guild_config WHERE guild_id = ?").run(testGuildId);
  });

  it("should invalidate cache after successful write", () => {
    // Set initial value
    setLoggingChannelId(testGuildId, channel1);
    expect(getLoggingChannelId(testGuildId)).toBe(channel1);

    // Update value
    setLoggingChannelId(testGuildId, channel2);

    // Cache should be invalidated, fresh read should get new value
    expect(getLoggingChannelId(testGuildId)).toBe(channel2);
  });

  it("should maintain cache consistency on write failure", () => {
    // Set initial value
    setLoggingChannelId(testGuildId, channel1);
    expect(getLoggingChannelId(testGuildId)).toBe(channel1);

    // Attempt write with invalid column (should fail)
    // Note: This test would require mocking db.prepare()
    // to simulate a failed write without breaking the schema

    // After failed write, cache should still have old value
    expect(getLoggingChannelId(testGuildId)).toBe(channel1);
  });
});
```

### Integration Testing

1. **High-concurrency scenario**
   ```typescript
   // Test multiple concurrent config updates
   const promises = [];
   for (let i = 0; i < 10; i++) {
     promises.push(setLoggingChannelId(guildId, `channel-${i}`));
   }
   await Promise.all(promises);

   // Verify final state is consistent
   const finalChannel = getLoggingChannelId(guildId);
   // Should match last successful write
   ```

2. **Cache TTL validation**
   ```typescript
   // Verify cache expires after 60 seconds (CACHE_TTL_MS)
   setLoggingChannelId(guildId, channel1);
   expect(getLoggingChannelId(guildId)).toBe(channel1); // Cached

   await sleep(61000); // Wait for cache expiration

   // Next read should hit database
   expect(getLoggingChannelId(guildId)).toBe(channel1); // Fresh from DB
   ```

### Pre-Deployment Validation

```bash
# Run full test suite
npm test

# Type checking
npm run build

# Lint check
npm run lint

# Manual verification
npm run dev
# Test /config set logging and /config get logging commands
```

## Rollback Plan

### If Cache Inconsistency Detected

**Symptom:** Config updates don't take effect, or stale values are served

**Action:**
```bash
# Immediate rollback
git revert HEAD
npm run build
pm2 restart pawtropolis-bot

# Or restore previous version
git checkout HEAD~1 -- src/config/loggingStore.ts
npm run build
pm2 restart pawtropolis-bot
```

**Validation:**
- Test `/config set logging` command multiple times
- Verify each update takes effect immediately
- Check logs for cache invalidation timing
- Monitor `guild_config` table for correct updates

### If Unexpected Errors Occur

**Symptom:** Database write errors increase or new error patterns emerge

**Action:**
1. Review logs for error patterns:
   ```bash
   grep "logging_channel_id" logs/app.log | grep ERROR
   ```

2. Check database integrity:
   ```bash
   sqlite3 pawtropolis.db "PRAGMA integrity_check;"
   sqlite3 pawtropolis.db "SELECT * FROM guild_config WHERE logging_channel_id IS NOT NULL;"
   ```

3. If errors persist, rollback and investigate

### Emergency Cache Clear

If cache becomes corrupted and rollback isn't immediate:

```bash
# Restart bot to clear in-memory cache
pm2 restart pawtropolis-bot

# Or manually clear cache via Discord command (if implemented)
/admin cache clear logging
```

## Success Criteria

- [ ] `invalidateCache()` is called AFTER successful `db.prepare().run()`
- [ ] Cache is NOT invalidated when database write fails
- [ ] Code matches pattern used in `flaggerStore.ts` (consistency)
- [ ] Comment accurately describes invalidation strategy
- [ ] All unit tests pass
- [ ] Manual testing confirms config updates work correctly
- [ ] No race condition window between invalidation and write
- [ ] Failed writes leave system in consistent state
- [ ] No performance regression (cache still provides benefit)

## Additional Notes

### Why This Bug Wasn't Noticed Earlier

1. **Low failure rate:** SQLite writes rarely fail in normal operation
2. **Schema migration handling:** The main failure case (missing column) is already caught and reported
3. **Cache TTL:** The 60-second cache TTL means stale data is eventually corrected
4. **Low update frequency:** Logging channel config is set once and rarely changed

### Related Issues

This same pattern should be reviewed in other stores:
- `flaggerStore.ts` - Already correct (lines 175, 226)
- Other config stores - Audit for similar patterns

### Future Improvements

Consider adding:
1. **Cache versioning:** Track cache version to detect stale entries
2. **Write-through cache:** Update cache value directly on write (no invalidation needed)
3. **Transactional cache:** Invalidate only if transaction commits
4. **Monitoring:** Log cache hit/miss rates and invalidation events
