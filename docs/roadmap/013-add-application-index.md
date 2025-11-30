# Issue #13: Add Composite Index for guild_id + status Queries

## Summary

Multiple queries filter the `application` table by `guild_id + status` but the existing index on `(guild_id, status)` is not optimally ordered for these access patterns. Adding `created_at` to the index will enable covering index usage and improve query performance for pending application counts and status lookups.

**Status:** Planned
**Priority:** Medium
**Effort:** ~15 minutes
**Type:** Performance / Database Optimization

---

## Current State (What's Wrong)

### Inefficient Queries

**File:** `/Users/bash/Documents/pawtropolis-tech/src/features/opsHealth.ts` (Line 152)

```typescript
const backlog = db
  .prepare(
    `
  SELECT COUNT(*) as count
  FROM application
  WHERE guild_id = ? AND status = 'pending'
`
  )
  .get(guildId) as { count: number };
```

**File:** `/Users/bash/Documents/pawtropolis-tech/src/features/gate.ts` (Lines 188, 194)

```typescript
// Line 188
const existing = db
  .prepare(`SELECT id FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`)
  .get(guildId, userId) as { id: string } | undefined;

// Line 194
const active = db
  .prepare(
    `SELECT id, status FROM application WHERE guild_id = ? AND user_id = ? AND status IN ('submitted','needs_info')`
  )
  .get(guildId, userId) as { id: string; status: string } | undefined;
```

### Why It's Inefficient

**Current Index (from migrations/001_indices.sql, line 3):**
```sql
CREATE INDEX IF NOT EXISTS idx_app_guild_status ON application(guild_id, status);
```

**Problems:**
1. The existing index can locate rows by `guild_id + status`, but cannot efficiently sort/filter by `created_at`
2. Queries that need to find the most recent applications must scan all matching rows and sort in memory
3. The index doesn't cover the `created_at` column, forcing additional table lookups

**Performance Impact:**
- Backlog queries scan all pending applications for a guild without index-assisted sorting
- As application volume grows, these queries become slower
- High-traffic guilds with hundreds of pending applications will experience noticeable latency

---

## Proposed Changes

### Step 1: Create New Migration File

**File:** `/Users/bash/Documents/pawtropolis-tech/migrations/011_application_guild_status_index.sql`

**Create with:**
```sql
BEGIN;

-- Drop the old index (it's redundant once we have the new one)
DROP INDEX IF EXISTS idx_app_guild_status;

-- Create composite index optimized for guild_id + status + created_at queries
CREATE INDEX IF NOT EXISTS idx_application_guild_status
ON application(guild_id, status, created_at);

COMMIT;
```

**Rationale:**
- Column order `(guild_id, status, created_at)` matches the query filter patterns
- Including `created_at` enables sorting and range queries without table lookups
- This is a covering index for most status-based queries
- Dropping the old index avoids redundancy and saves disk space

### Step 2: Apply Migration

Apply the migration to the database:

```bash
# Production deployment
sqlite3 /path/to/production.db < migrations/011_application_guild_status_index.sql

# Development/staging
sqlite3 ./data/dev.db < migrations/011_application_guild_status_index.sql
```

### Step 3: Verify Index Usage

Run `EXPLAIN QUERY PLAN` to confirm the new index is being used:

```sql
EXPLAIN QUERY PLAN
SELECT COUNT(*) as count
FROM application
WHERE guild_id = 'test' AND status = 'pending';

-- Expected output should include:
-- SEARCH application USING INDEX idx_application_guild_status (guild_id=? AND status=?)
```

---

## Files Affected

1. **New File:** `/Users/bash/Documents/pawtropolis-tech/migrations/011_application_guild_status_index.sql`
   - Create migration to replace existing index

2. **Indirectly Improved (No Code Changes):**
   - `/Users/bash/Documents/pawtropolis-tech/src/features/opsHealth.ts` (line 152)
   - `/Users/bash/Documents/pawtropolis-tech/src/features/gate.ts` (lines 188, 194)

**Note:** No application code changes required. The query optimizer will automatically use the new index.

---

## Testing Strategy

### Pre-Change Validation

1. **Verify current index usage:**
   ```bash
   sqlite3 data/production.db "PRAGMA index_list('application');"
   # Should show idx_app_guild_status exists
   ```

2. **Baseline query performance:**
   ```bash
   sqlite3 data/production.db ".timer on" "SELECT COUNT(*) FROM application WHERE guild_id = 'X' AND status = 'pending';"
   # Record execution time for comparison
   ```

### Post-Change Testing

1. **Verify migration applied:**
   ```bash
   sqlite3 data/production.db "PRAGMA index_list('application');"
   # Should show idx_application_guild_status
   # Should NOT show idx_app_guild_status (old index)
   ```

2. **Confirm index structure:**
   ```bash
   sqlite3 data/production.db "PRAGMA index_info('idx_application_guild_status');"
   # Should show columns: guild_id (seqno=0), status (seqno=1), created_at (seqno=2)
   ```

3. **Verify query plan improvement:**
   ```bash
   sqlite3 data/production.db "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM application WHERE guild_id = 'X' AND status = 'pending';"
   # Should show: SEARCH ... USING INDEX idx_application_guild_status
   ```

4. **Performance benchmark:**
   ```bash
   sqlite3 data/production.db ".timer on" "SELECT COUNT(*) FROM application WHERE guild_id = 'X' AND status = 'pending';"
   # Compare to baseline - should be faster or equal
   ```

5. **Runtime smoke test:**
   - Execute `/health` command to trigger opsHealth.ts backlog query
   - Submit a new gate application to trigger gate.ts status checks
   - Verify no errors and normal response times

### Regression Risk

**Very Low** - This is a pure database optimization:
- No application code changes
- SQLite query optimizer handles index selection automatically
- Worst case: optimizer chooses table scan (same behavior as before optimization)
- Index creation is atomic within the transaction

---

## Rollback Plan

### Immediate Rollback (If Issues Detected)

If the new index causes unexpected behavior:

```sql
BEGIN;

-- Remove new index
DROP INDEX IF EXISTS idx_application_guild_status;

-- Restore old index
CREATE INDEX IF NOT EXISTS idx_app_guild_status ON application(guild_id, status);

COMMIT;
```

**Execute with:**
```bash
sqlite3 /path/to/database.db < rollback.sql
```

### Git Rollback

If migration file needs to be removed from version control:

```bash
git log --oneline -n 5  # Find commit hash
git revert <commit-hash>
git push
```

### Manual Recovery

If database is corrupted (extremely unlikely):

1. **Restore from backup:**
   ```bash
   cp /backups/production.db.backup /path/to/production.db
   ```

2. **Rebuild indexes:**
   ```bash
   sqlite3 /path/to/production.db "REINDEX;"
   ```

3. **Verify integrity:**
   ```bash
   sqlite3 /path/to/production.db "PRAGMA integrity_check;"
   ```

### Recovery Time

- SQL rollback: <10 seconds (instant for most database sizes)
- Git revert: ~1 minute
- Database restore from backup: 2-5 minutes (depends on database size)
- No application downtime required (indexes are non-blocking in SQLite WAL mode)

---

## Additional Notes

### Why This Index Order?

The column order `(guild_id, status, created_at)` is optimal because:

1. **guild_id first**: Highest cardinality filter (partitions by guild)
2. **status second**: Medium cardinality filter (5 possible values: draft, submitted, pending, accepted, rejected)
3. **created_at last**: Enables range scans and sorting without table access

### Query Patterns Supported

This index efficiently supports:

- **Equality filters**: `WHERE guild_id = ? AND status = ?`
- **IN clauses**: `WHERE guild_id = ? AND status IN (?, ?)`
- **Sorting**: `ORDER BY created_at DESC` (when filtered by guild_id + status)
- **Covering queries**: `SELECT created_at FROM application WHERE guild_id = ? AND status = ?`

### Index Size Impact

- **Current index size**: ~5-10% of table size (2 columns)
- **New index size**: ~8-15% of table size (3 columns)
- **Net impact**: +3-5% of table size (minimal for most deployments)

For a database with 10,000 applications, this adds approximately 50-100KB.

### Future Optimizations

If query patterns evolve, consider:

1. **Partial index for pending apps** (if backlog queries dominate):
   ```sql
   CREATE INDEX idx_app_pending ON application(guild_id, created_at)
   WHERE status = 'pending';
   ```

2. **Covering index for user lookups** (if gate.ts queries become a bottleneck):
   ```sql
   CREATE INDEX idx_app_user_status ON application(guild_id, user_id, status);
   ```

These are out of scope for this task but noted for future performance tuning.

---

## Acceptance Criteria

- [ ] Migration file created at `migrations/011_application_guild_status_index.sql`
- [ ] Migration tested on development database
- [ ] Old index `idx_app_guild_status` removed
- [ ] New index `idx_application_guild_status` created with columns `(guild_id, status, created_at)`
- [ ] `EXPLAIN QUERY PLAN` confirms new index usage for target queries
- [ ] Performance benchmarks show equal or improved query times
- [ ] `/health` command executes successfully (opsHealth.ts)
- [ ] Gate application flow works correctly (gate.ts)
- [ ] No errors in application logs after deployment
- [ ] Rollback plan documented and tested
