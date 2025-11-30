# Roadmap: Fix Gate Full Table Scan (Issue #17)

**Status:** Proposed
**Priority:** High
**Type:** Performance / Bug Fix
**Estimated Effort:** 1-2 hours

## Summary

The `getOrCreateDraft` function in `src/features/gate.ts` performs an unfiltered full table scan when checking for shortCode collisions. It loads ALL resolved applications across ALL guilds into memory just to check if a 6-character shortCode collides with any historical application.

**Performance Impact:**
- For 100k applications: Loads 100k UUIDs into JavaScript memory
- O(n) through entire application history on every gate entry
- Query ignores existing `idx_app_guild_status` index
- No guild_id filter = combines data from all guilds unnecessarily

**Current Query (lines 207-209):**
```sql
SELECT id FROM application
WHERE status IN ('approved', 'rejected', 'kicked', 'perm_rejected')
```

This is a hot path - runs on every user clicking the "Verify" button.

## Current State

### Problem Code
**File:** `/Users/bash/Documents/pawtropolis-tech/src/features/gate.ts`
**Lines:** 207-209

```typescript
const resolvedApps = db.prepare(
  `SELECT id FROM application WHERE status IN ('approved', 'rejected', 'kicked', 'perm_rejected')`
).all() as Array<{ id: string }>;
```

### Why This Exists
The code attempts to delete old resolved applications that have the same shortCode as a newly generated draft. This prevents shortCode collisions, allowing shortCodes to be reused after applications are resolved.

**Design Intent:** Collision prevention is good, but the implementation is inefficient.

### Current Index Coverage
The table has these indexes (from `migrations/001_indices.sql` and `migrations/002_review_cards.sql`):
- `idx_app_guild_status ON application(guild_id, status)` - optimal for our fix
- `idx_application_guild_user ON application(guild_id, user_id)` - not relevant here

## Proposed Changes

### Step 1: Add guild_id Filter
Update the query to scope by guild, allowing the database to use the existing composite index.

**Before:**
```typescript
const resolvedApps = db.prepare(
  `SELECT id FROM application WHERE status IN ('approved', 'rejected', 'kicked', 'perm_rejected')`
).all() as Array<{ id: string }>;
```

**After:**
```typescript
const resolvedApps = db.prepare(
  `SELECT id FROM application
   WHERE guild_id = ?
   AND status IN ('approved', 'rejected', 'kicked', 'perm_rejected')`
).all(guildId) as Array<{ id: string }>;
```

**Performance Improvement:**
- **Before:** Full table scan (100k rows → 100k UUIDs in memory)
- **After:** Index seek + filter (guild with 5k apps → 3k resolved → 3k UUIDs in memory)
- **Reduction:** ~97% fewer rows for a typical multi-guild deployment

### Step 2: Update Function Call Sites
The `guildId` parameter is already available in scope at line 177:
```typescript
function getOrCreateDraft(db: BetterSqliteDatabase, guildId: string, userId: string)
```

No additional context passing is needed - just use the existing parameter.

## Files Affected

1. **`/Users/bash/Documents/pawtropolis-tech/src/features/gate.ts`**
   - Line 207-209: Update query to add `guild_id = ?` filter
   - Line 209: Change `.all()` to `.all(guildId)`

## Testing Strategy

### Unit Tests
1. **Test collision detection still works:**
   ```typescript
   // Create app with known UUID
   // Generate new draft with colliding shortCode
   // Verify old app is deleted
   ```

2. **Test guild isolation:**
   ```typescript
   // Create resolved apps in guild A and B with same shortCode
   // Create new draft in guild A
   // Verify only guild A's old app is deleted, not guild B's
   ```

3. **Test multi-guild collision safety:**
   ```typescript
   // Guild A: resolved app with shortCode "abc123"
   // Guild B: create new draft that would generate "abc123"
   // Verify guild B's app is NOT deleted (different guild)
   ```

### Manual Verification
1. Enable query logging in dev environment
2. Click "Verify" button in gate channel
3. Confirm `EXPLAIN QUERY PLAN` shows index usage:
   ```
   SEARCH application USING INDEX idx_app_guild_status (guild_id=? AND status=?)
   ```
4. Verify no full table scans in query plan

### Performance Testing
1. **Benchmark with sample data:**
   - Insert 50k resolved applications across 5 guilds
   - Measure query time before/after change
   - Expected: <1ms query time after fix (vs 50-100ms before)

2. **Memory profiling:**
   - Monitor heap usage during gate entry flow
   - Expected: 60-90% reduction in temporary allocations

## Rollback Plan

### If Issues Detected
1. **Immediate:** Revert single-line change in `gate.ts:207-209`
2. **Restore original query:**
   ```typescript
   const resolvedApps = db.prepare(
     `SELECT id FROM application WHERE status IN ('approved', 'rejected', 'kicked', 'perm_rejected')`
   ).all() as Array<{ id: string }>;
   ```
3. **Verify:** Query returns to working state (albeit slow)

### Rollback Safety
- **No schema changes:** Migration-free fix
- **No data changes:** Logic remains identical, only scoped differently
- **No API changes:** Function signature unchanged
- **Zero downtime:** Single-file edit, hot-reloadable

### Monitoring After Deployment
1. Watch error logs for unexpected shortCode collision failures
2. Monitor gate entry latency (should drop significantly)
3. Check for any guild-specific application issues

## Implementation Checklist

- [ ] Update query in `gate.ts:207-209`
- [ ] Add unit test for guild isolation
- [ ] Add unit test verifying collision detection still works
- [ ] Run existing gate tests to ensure no regressions
- [ ] Manual test in dev environment
- [ ] Verify query plan uses index
- [ ] Deploy to staging
- [ ] Monitor gate entry metrics for 24 hours
- [ ] Deploy to production

## Notes

- This fix leverages the existing `idx_app_guild_status` index - no migration needed
- ShortCode collision probability is already extremely low (62^6 = 56 billion combinations)
- The current cross-guild collision check is technically unnecessary but kept for safety
- Future optimization: Could remove collision check entirely if shortCode space is proven sufficient
- Related: Issue #13 adds additional composite index for other queries

## References

- **Codebase Audit:** `docs/CODEBASE_AUDIT_2025-11-30.md` (Issue #17)
- **Related Index Work:** `docs/roadmap/013-add-application-index.md`
- **ShortCode Implementation:** `src/lib/ids.ts`
- **Existing Index:** `migrations/001_indices.sql:3` and `migrations/002_review_cards.sql:224`
