# Issue #11: Schema Inconsistency - Mixed Timestamp Formats

## Summary

The `guild_config` table currently has BOTH `updated_at` (TEXT/ISO8601) and `updated_at_s` (INTEGER/Unix epoch) timestamp columns. Different stores use different columns inconsistently, causing confusion, potential bugs, and wasted storage.

**Priority:** Medium
**Type:** Schema Standardization
**Complexity:** Medium (requires careful data migration)

## Current State

### Problem

The `guild_config` table has dual timestamp columns with inconsistent usage:

1. **Column Definitions:**
   - `updated_at` (TEXT, ISO8601 format) - Column 12 in current schema
   - `updated_at_s` (INTEGER, Unix epoch) - Column 43 in current schema

2. **Inconsistent Usage:**
   - `src/config/loggingStore.ts:122-124` - Uses `updated_at` (TEXT) with `new Date().toISOString()`
   - `src/config/flaggerStore.ts:157,211` - Uses `updated_at` (TEXT) with `new Date().toISOString()`
   - `src/features/panicStore.ts:93,106` - Uses `updated_at_s` (INTEGER) with `Math.floor(Date.now() / 1000)`
   - `src/db/ensure.ts:587` - Creates `updated_at_s` column as part of schema

3. **Consequences:**
   - **Wasted Storage:** Two timestamp columns storing the same information
   - **Confusion:** Developers must decide which column to use
   - **Bugs:** Queries might use wrong column, leading to stale or incorrect data
   - **Cache Invalidation Issues:** Cache invalidation logic may only update one column
   - **Inconsistent Patterns:** Different from `action_log` table which uses `created_at_s` INTEGER

### Why This Happened

Historical evolution of the schema:
1. Original schema used TEXT timestamps (`updated_at`, `created_at`)
2. Later added INTEGER timestamps (`updated_at_s`) for better performance and alignment with `action_log` table
3. Migration didn't remove old column, and different stores adopted different conventions

## Proposed Changes

### Strategy: Standardize on INTEGER (Unix Epoch)

**Rationale:**
- Consistent with `action_log.created_at_s` pattern already used in codebase
- Better performance for time-based queries (no parsing required)
- Smaller storage footprint (INTEGER vs TEXT)
- Already supported by newer stores (`panicStore`)

### Step-by-Step Migration

#### Phase 1: Backfill and Validate
1. Ensure `updated_at_s` column exists on all rows
2. Backfill `updated_at_s` from `updated_at` where `updated_at_s` is NULL:
   ```sql
   UPDATE guild_config
   SET updated_at_s = CAST(strftime('%s', updated_at) AS INTEGER)
   WHERE updated_at_s IS NULL AND updated_at IS NOT NULL;
   ```
3. Set default value for rows with neither timestamp:
   ```sql
   UPDATE guild_config
   SET updated_at_s = CAST(strftime('%s', 'now') AS INTEGER)
   WHERE updated_at_s IS NULL;
   ```

#### Phase 2: Update Application Code
1. **Update `loggingStore.ts`:**
   - Change `setLoggingChannelId()` to use `updated_at_s` instead of `updated_at`
   - Replace `new Date().toISOString()` with `Math.floor(Date.now() / 1000)`
   - Update UPSERT query to reference `updated_at_s`

2. **Update `flaggerStore.ts`:**
   - Change `setFlagsChannelId()` to use `updated_at_s` instead of `updated_at`
   - Change `setSilentFirstMsgDays()` to use `updated_at_s` instead of `updated_at`
   - Replace `new Date().toISOString()` with `Math.floor(Date.now() / 1000)`
   - Update UPSERT queries to reference `updated_at_s`

3. **Verify `panicStore.ts`:**
   - Already uses `updated_at_s` correctly - no changes needed

4. **Search for other usages:**
   - Grep for `updated_at` references in guild_config queries
   - Update any remaining TEXT timestamp usage

#### Phase 3: Schema Cleanup (After Code Deployment)
1. Wait for new code to deploy and run for at least 24 hours
2. Verify no errors in logs related to `updated_at_s`
3. Drop `updated_at` column:
   ```sql
   -- SQLite requires table recreation to drop columns
   -- This will be done via backup-swap migration pattern
   ```

#### Phase 4: Add Constraints (Optional)
1. Make `updated_at_s` NOT NULL after backfill:
   ```sql
   -- Requires table recreation in SQLite
   ALTER TABLE guild_config ADD COLUMN updated_at_s INTEGER NOT NULL;
   ```

## Files Affected

### Code Files (Phase 2)
- `/Users/bash/Documents/pawtropolis-tech/src/config/loggingStore.ts`
  - Line 122-124: Update timestamp generation
  - Line 132: Change column name in UPSERT
  - Line 136: Change column name in UPSERT

- `/Users/bash/Documents/pawtropolis-tech/src/config/flaggerStore.ts`
  - Line 157: Update timestamp generation in `setFlagsChannelId`
  - Line 165-169: Update UPSERT query
  - Line 211: Update timestamp generation in `setSilentFirstMsgDays`
  - Line 217-222: Update UPSERT query

- `/Users/bash/Documents/pawtropolis-tech/src/features/panicStore.ts`
  - Already correct - no changes needed

- `/Users/bash/Documents/pawtropolis-tech/src/db/ensure.ts`
  - Line 802-806: Already creates `updated_at_s` - verify logic

### Migration Files (Phase 1 & 3)
- Create new migration: `migrations/0XX_standardize_guild_config_timestamps.ts`
  - Phase 1: Backfill `updated_at_s` from `updated_at`
  - Phase 3: Drop `updated_at` column (backup-swap pattern)

### Test Files
- `/Users/bash/Documents/pawtropolis-tech/tests/config.test.ts`
  - Update test fixtures to use `updated_at_s`
- `/Users/bash/Documents/pawtropolis-tech/tests/utils/dbFixtures.ts`
  - Update guild_config fixtures

### Documentation Files
- `/Users/bash/Documents/pawtropolis-tech/docs/reference/database-schema.md`
  - Update guild_config table documentation
- `/Users/bash/Documents/pawtropolis-tech/src/config/README.md`
  - Update configuration store documentation

## Testing Strategy

### Pre-Deployment Testing

1. **Unit Tests:**
   - Test `loggingStore.setLoggingChannelId()` writes INTEGER timestamp
   - Test `flaggerStore.setFlagsChannelId()` writes INTEGER timestamp
   - Test `flaggerStore.setSilentFirstMsgDays()` writes INTEGER timestamp
   - Verify cache invalidation still works with new column

2. **Integration Tests:**
   - Test full UPSERT flow (insert new row, update existing row)
   - Verify backward compatibility (read old TEXT timestamps during migration)

3. **Migration Tests:**
   - Test backfill with various data scenarios:
     - Row with only `updated_at` (TEXT)
     - Row with only `updated_at_s` (INTEGER)
     - Row with both (should prefer `updated_at_s`)
     - Row with neither (should use current time)
   - Verify no data loss during backup-swap

### Post-Deployment Validation

1. **Monitoring:**
   - Watch error logs for SQL errors related to `updated_at_s`
   - Monitor cache hit rates for loggingStore/flaggerStore
   - Check for any "column not found" errors

2. **Database Validation:**
   - Query to verify all rows have `updated_at_s`:
     ```sql
     SELECT COUNT(*) FROM guild_config WHERE updated_at_s IS NULL;
     -- Should return 0
     ```
   - Spot-check timestamp values are reasonable:
     ```sql
     SELECT guild_id, updated_at, updated_at_s,
            datetime(updated_at_s, 'unixepoch') as converted
     FROM guild_config LIMIT 10;
     ```

3. **Functional Testing:**
   - Run `/config set logging <channel>` command
   - Run `/config set flags.channel <channel>` command
   - Run `/panic` command
   - Verify all configuration changes persist correctly

## Rollback Plan

### If Issues Found During Phase 2 (Code Changes)

1. **Immediate Rollback:**
   - Revert code changes to use `updated_at` (TEXT)
   - Redeploy previous version
   - No data loss - both columns still exist

2. **Fix Forward:**
   - If minor bug: Patch and redeploy
   - If major bug: Complete rollback

### If Issues Found During Phase 3 (Column Removal)

1. **Cannot Rollback Easily:**
   - SQLite doesn't support adding columns that were removed
   - Would need to restore from backup

2. **Prevention:**
   - DO NOT proceed to Phase 3 until Phase 2 is stable for 7+ days
   - Keep database backups before Phase 3 migration
   - Test Phase 3 migration on staging/copy of production DB first

### Recovery Procedure

If `updated_at` column is accidentally dropped too early:

1. Restore database from most recent backup (before Phase 3)
2. Re-run Phase 1 migration (backfill)
3. Re-deploy Phase 2 code
4. Wait longer before attempting Phase 3 again

## Success Criteria

- [ ] All guild_config writes use `updated_at_s` (INTEGER)
- [ ] No SQL errors in production logs for 7 days after Phase 2
- [ ] Cache invalidation works correctly for all config stores
- [ ] All tests pass with new timestamp format
- [ ] Migration successfully backfills all existing rows
- [ ] Phase 3 migration (column removal) completes without errors
- [ ] Database queries using `updated_at_s` perform as expected

## Timeline Estimate

- **Phase 1 (Migration):** 1 day development + testing
- **Phase 2 (Code Changes):** 2 days development + testing
- **Soak Time:** 7 days monitoring in production
- **Phase 3 (Cleanup):** 1 day development + testing
- **Total:** ~11 days (including soak time)

## Related Issues

- `action_log` table already uses `created_at_s` INTEGER (precedent)
- Other tables still use TEXT timestamps (future cleanup opportunity)
- Consider standardizing ALL timestamp columns to INTEGER in future audit

## References

- Codebase Audit: `/Users/bash/Documents/pawtropolis-tech/docs/CODEBASE_AUDIT_2025-11-30.md`
- Database Schema: Visible via `PRAGMA table_info(guild_config)`
- SQLite strftime docs: https://www.sqlite.org/lang_datefunc.html
- better-sqlite3 docs: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
