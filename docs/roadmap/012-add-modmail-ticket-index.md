# Issue #12: Missing Database Index on modmail_ticket Table

**Status:** Planned
**Priority:** Medium (Performance)
**Estimated Effort:** 30 minutes
**Created:** 2025-11-30

## Summary

Multiple queries filter the `modmail_ticket` table by `guild_id AND status` but no covering index exists, causing slow queries when listing open tickets for a guild. This impacts both operational health checks and user-facing modmail functionality.

## Current State

### Problem

**Locations:**
- `src/features/opsHealth.ts:447` - Orphaned ticket detection
- `src/features/modmail/tickets.ts:59` - User open ticket lookup

Both queries filter by `guild_id` and `status = 'open'` without an index:

```sql
-- opsHealth.ts:447
SELECT t.id, t.user_id, t.app_code, t.thread_id, t.created_at
FROM modmail_ticket t
WHERE t.guild_id = ? AND t.status = 'open'
  AND NOT EXISTS (...)

-- tickets.ts:59
SELECT id, guild_id, user_id, app_code, review_message_id,
       thread_id, thread_channel_id, status, created_at, closed_at
FROM modmail_ticket
WHERE guild_id = ? AND user_id = ? AND status = 'open'
ORDER BY created_at DESC
LIMIT 1
```

### Performance Impact

Without the index, SQLite must perform a full table scan filtering by both columns. As the number of tickets grows (especially closed tickets), query performance degrades linearly. This affects:
- Health monitoring operations that run periodically
- User experience when opening new modmail threads

## Proposed Changes

### Step 1: Create Migration File

Create `migrations/011_modmail_ticket_index.sql`:

```sql
BEGIN;

-- Add composite index for guild_id + status queries
-- Covers queries in opsHealth.ts and tickets.ts that filter by both columns
CREATE INDEX IF NOT EXISTS idx_modmail_ticket_guild_status
ON modmail_ticket(guild_id, status);

COMMIT;
```

### Step 2: Apply Migration

Run the migration using the existing migration system:
```bash
npm run migrate
```

### Step 3: Verify Index Creation

Confirm index exists:
```sql
PRAGMA index_list(modmail_ticket);
PRAGMA index_info(idx_modmail_ticket_guild_status);
```

## Files Affected

### Modified
- None (queries already written correctly, just missing index)

### Created
- `migrations/011_modmail_ticket_index.sql` - New migration file

### Performance Benefit
- `src/features/opsHealth.ts:447` - Orphaned ticket query
- `src/features/modmail/tickets.ts:59` - Open ticket lookup

## Testing Strategy

### Pre-Migration Baseline
1. Measure query performance before migration:
   ```sql
   EXPLAIN QUERY PLAN SELECT * FROM modmail_ticket
   WHERE guild_id = ? AND status = 'open';
   ```
   - Should show "SCAN TABLE modmail_ticket"

### Post-Migration Verification
1. Run migration and verify index creation
2. Re-run EXPLAIN QUERY PLAN - should show "SEARCH TABLE modmail_ticket USING INDEX idx_modmail_ticket_guild_status"
3. Measure query performance improvement (especially on databases with many closed tickets)

### Functional Testing
1. Test orphaned ticket detection in opsHealth
2. Test opening new modmail thread (calls `getOpenTicketByUser`)
3. Verify no functional changes, only performance improvement

### Load Testing (Optional)
For databases with significant ticket history:
1. Compare query execution time before/after
2. Monitor query performance in production logs

## Rollback Plan

### If Migration Fails
- Migration wrapped in `BEGIN`/`COMMIT` transaction
- Automatic rollback on any error
- No partial state possible

### If Index Causes Issues
Remove the index with a new migration:

```sql
BEGIN;
DROP INDEX IF EXISTS idx_modmail_ticket_guild_status;
COMMIT;
```

### Risk Assessment
- **Risk Level:** Very Low
- **Rationale:**
  - Index creation is non-destructive
  - Uses `IF NOT EXISTS` to avoid conflicts
  - Does not modify data or schema
  - Can be safely dropped if issues arise
  - SQLite indexes are lightweight and well-tested

## Notes

- This follows the pattern established in `migrations/001_indices.sql` for similar composite indexes
- The index benefits both queries without requiring any code changes
- Index column order (`guild_id, status`) matches query filter order for optimal performance
- Consider adding similar indexes for other status-based queries if they emerge as bottlenecks
