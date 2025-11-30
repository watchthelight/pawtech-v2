# Issue #24: Deduplicate sync_marker Schema

## Summary
The `sync_marker` table schema is defined in two locations, violating the single source of truth principle. This creates a maintenance burden where schema changes must be synchronized across both locations.

## Current State

### Problem
The `sync_marker` table is created in two places:

1. **Database initialization** (`src/db/db.ts:269-289`)
   - Creates table during initial database setup
   - Inserts default singleton row
   - Executed every time the database is initialized

2. **Migration 026** (`migrations/026_sync_marker.ts`)
   - Creates the same table via migration system
   - Inserts the same default singleton row
   - Part of the formal migration sequence

### Risk
- Schema drift if one location is updated but not the other
- Confusion about which definition is authoritative
- Duplicate code maintenance burden
- Potential for inconsistent behavior between fresh databases and migrated databases

## Proposed Changes

### Approach
Remove table creation from `db.ts` and rely exclusively on the migration system as the single source of truth.

### Implementation Steps

1. **Remove duplicate schema from db.ts**
   - Delete lines 268-289 in `src/db/db.ts`
   - Remove the `CREATE TABLE IF NOT EXISTS sync_marker` statement
   - Remove the `INSERT OR IGNORE` initialization statement
   - Add a comment noting the table is created by migration 026

2. **Verify migration 026 is comprehensive**
   - Confirm `migrations/026_sync_marker.ts` handles all initialization
   - Ensure it creates both the table and the singleton row
   - Validate the schema matches what was in `db.ts`

3. **Update database initialization logic**
   - Ensure migration 026 runs before any code tries to access `sync_marker`
   - Verify the migration system is always executed on database initialization

## Files Affected

- `/Users/bash/Documents/pawtropolis-tech/src/db/db.ts` (lines 268-289 removed)
- `/Users/bash/Documents/pawtropolis-tech/migrations/026_sync_marker.ts` (verification only)

## Testing Strategy

### Pre-deployment Tests

1. **Fresh database test**
   - Delete local database file
   - Start application
   - Verify `sync_marker` table exists
   - Verify singleton row is created with id=1
   - Run basic sync operations

2. **Existing database test**
   - Use existing database with `sync_marker` table
   - Start application
   - Verify table still functions correctly
   - Verify no duplicate rows created

3. **Migration sequence test**
   - Create database from scratch
   - Run all migrations in sequence
   - Verify `sync_marker` is created at the correct point
   - Verify subsequent migrations can access the table

4. **Schema validation**
   - Compare the schema before and after changes
   - Ensure column definitions match exactly
   - Verify constraints (PRIMARY KEY, CHECK) are identical

### Validation Checks

```sql
-- Verify table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='sync_marker';

-- Verify singleton row exists
SELECT * FROM sync_marker WHERE id = 1;

-- Verify schema matches expected structure
PRAGMA table_info(sync_marker);
```

## Rollback Plan

### If Issues Arise

1. **Immediate rollback**
   - Revert the commit removing the duplicate schema
   - Redeploy previous version
   - Existing databases will continue to function

2. **Low risk factors**
   - Changes are additive removals (no data modification)
   - `CREATE TABLE IF NOT EXISTS` prevents conflicts
   - Migration system already handles table creation
   - No schema changes, only location changes

### Recovery Steps

If the table is somehow missing after deployment:
1. Manually run migration 026 on affected databases
2. Or restore the initialization code temporarily
3. Investigate why migrations didn't run properly

## Timeline

- **Implementation:** 30 minutes
- **Testing:** 1 hour
- **Review:** 30 minutes
- **Total:** 2 hours

## Success Criteria

- [ ] `sync_marker` table creation removed from `db.ts`
- [ ] Fresh database initialization creates `sync_marker` via migration
- [ ] Existing databases continue to function without issues
- [ ] No duplicate code for table schema
- [ ] All tests pass
- [ ] Documentation updated (if applicable)
