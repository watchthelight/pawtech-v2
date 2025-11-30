# Issue #37: Fix Fragile Migration Detection

**Status:** Planned
**Priority:** High (Reliability)
**Estimated Effort:** 2-3 hours
**Created:** 2025-11-30

## Summary

The `review_action` table migration uses a probe insert to detect whether a CHECK constraint exists (lines 68-84 in `migrations/2025-10-20_review_action_free_text.ts`). This approach is fragile because the probe insert can fail on foreign key constraints, causing false positives/negatives in migration detection. SQLite provides robust DDL introspection via `PRAGMA table_info()` and `sqlite_master` queries that should be used instead.

## Current State

### Problem

**Location:** `migrations/2025-10-20_review_action_free_text.ts:68-84`

The migration attempts to detect CHECK constraints using this pattern:

```typescript
const hasCheckConstraint = (() => {
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, reason, meta)
        VALUES ('__probe__', '__probe__', '__unknown_action__', NULL, NULL)
      `
      ).run();
      throw new Error("rollback"); // Force rollback
    });
    tx();
    return false; // Insert would succeed → no CHECK
  } catch (e: any) {
    return /CHECK constraint failed/.test(String(e?.message ?? ""));
  }
})();
```

### Fragility Issues

1. **Foreign key dependency:** The probe insert references `app_id` with a FK to `application(id)`. If `'__probe__'` doesn't exist in the `application` table, the insert fails with `FOREIGN KEY constraint failed` instead of testing the CHECK constraint.

2. **Transaction overhead:** Creates unnecessary transaction for a metadata check that SQLite already provides via DDL introspection.

3. **Side effects:** While rolled back, the probe insert approach is conceptually invasive - we're testing schema by attempting data mutations.

4. **Regex-based error detection:** Relies on string matching of error messages, which could change across SQLite versions.

5. **False negatives:** If FK fails before CHECK validation, the function incorrectly returns `false` (no constraint), causing the migration to skip when it shouldn't.

### Risk Assessment

- **Attack Vector:** None (internal reliability issue)
- **Impact:** Migration may not run when needed, or may fail during deployment
- **Likelihood:** Medium - occurs when migration runs before `application` table is seeded
- **Severity:** HIGH - can cause deployment failures or schema drift
- **Current Mitigation:** None - FK failure will propagate and crash migration runner

## Proposed Changes

### Overview

Replace probe insert with DDL introspection using SQLite's `sqlite_master` table to directly query CHECK constraint definitions.

### Step 1: Add Helper Function for Constraint Detection

**Goal:** Create reusable utility to detect CHECK constraints via schema introspection

Add before `migrateReviewActionFreeText()` function (around line 31):

```typescript
/**
 * Detects if a table has a CHECK constraint by parsing its CREATE TABLE statement.
 * Uses sqlite_master introspection instead of probe inserts.
 *
 * @param db - better-sqlite3 Database instance
 * @param tableName - Name of table to inspect
 * @param constraintPattern - Regex pattern to match CHECK constraint text
 * @returns true if constraint exists, false otherwise
 */
function hasCheckConstraint(
  db: Database,
  tableName: string,
  constraintPattern: RegExp
): boolean {
  const schema = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
    )
    .get(tableName) as { sql: string } | undefined;

  if (!schema?.sql) {
    return false;
  }

  // Check if CREATE TABLE statement contains CHECK constraint
  return constraintPattern.test(schema.sql);
}
```

### Step 2: Replace Probe Insert with DDL Introspection

**Goal:** Remove fragile probe insert logic

Replace lines 66-84 with:

```typescript
// Check if CHECK constraint exists by inspecting table DDL
// We're looking for: CHECK(action IN ('approved','rejected','kicked'))
const hasActionCheckConstraint = hasCheckConstraint(
  db,
  "review_action",
  /CHECK\s*\(\s*action\s+IN\s*\(/i
);

if (!hasActionCheckConstraint && createdAtCol?.type === "TEXT") {
  // Only convert created_at type (no CHECK to remove)
  logger.info("[migrate] review_action has no CHECK, converting created_at to INTEGER");
  performCreatedAtConversion(db);
  return;
}

if (!hasActionCheckConstraint) {
  logger.info("[migrate] review_action already migrated (no CHECK, created_at is INTEGER)");
  return;
}

// Perform full migration: remove CHECK + convert created_at
logger.info("[migrate] review_action CHECK constraint detected, starting copy-swap migration");
performFullMigration(db);
```

### Step 3: Add Comprehensive Logging

**Goal:** Track detection results for debugging

Add after constraint detection (around line 68):

```typescript
logger.debug({
  table: "review_action",
  hasCheckConstraint: hasActionCheckConstraint,
  createdAtType: createdAtCol?.type ?? "missing",
}, "[migrate] review_action schema introspection complete");
```

### Step 4: Add Test Coverage

**Goal:** Verify introspection works across migration states

Create test file `migrations/__tests__/2025-10-20_review_action_free_text.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { migrateReviewActionFreeText } from "../2025-10-20_review_action_free_text.js";

describe("migrateReviewActionFreeText", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("detects CHECK constraint in legacy schema", () => {
    // Create legacy table with CHECK
    db.exec(`
      CREATE TABLE review_action (
        id INTEGER PRIMARY KEY,
        app_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('approved','rejected','kicked')),
        reason TEXT,
        meta TEXT,
        created_at TEXT
      )
    `);

    // Should detect and run migration
    migrateReviewActionFreeText(db);

    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`).get();
    expect(schema.sql).not.toMatch(/CHECK/i);
  });

  it("skips migration when CHECK already removed", () => {
    // Create table without CHECK, but with TEXT created_at
    db.exec(`
      CREATE TABLE review_action (
        id INTEGER PRIMARY KEY,
        app_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        meta TEXT,
        created_at TEXT
      )
    `);

    migrateReviewActionFreeText(db);

    const cols = db.prepare(`PRAGMA table_info(review_action)`).all();
    const createdAt = cols.find(c => c.name === "created_at");
    expect(createdAt.type).toBe("INTEGER");
  });

  it("is idempotent - no-op when already migrated", () => {
    // Create final schema
    db.exec(`
      CREATE TABLE review_action (
        id INTEGER PRIMARY KEY,
        app_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        meta TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    const beforeSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`).get();

    migrateReviewActionFreeText(db);

    const afterSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`).get();
    expect(afterSql).toEqual(beforeSql);
  });

  it("handles missing table gracefully", () => {
    expect(() => migrateReviewActionFreeText(db)).not.toThrow();
  });
});
```

## Files Affected

### Modified
- `migrations/2025-10-20_review_action_free_text.ts`
  - Add `hasCheckConstraint()` helper function (~line 31)
  - Replace probe insert logic with DDL introspection (~line 68)
  - Add debug logging for schema detection (~line 68)

### Created
- `migrations/__tests__/2025-10-20_review_action_free_text.test.ts`
  - Test suite for migration detection logic
  - Covers all schema states (legacy, partial, complete, missing)

### Reviewed (no changes needed)
- No other migrations use probe insert pattern
- This is an isolated improvement to one migration file

## Testing Strategy

### Pre-Change Testing

1. **Document current behavior**
   ```bash
   # Test migration against databases in various states
   # - Fresh database (no tables)
   # - Legacy schema (with CHECK)
   # - Partial migration (no CHECK, TEXT created_at)
   # - Complete migration (no CHECK, INTEGER created_at)
   ```

2. **Identify FK failure scenario**
   ```bash
   # Create review_action table WITHOUT application table
   # Run migration and observe FK constraint failure
   # Document error message and failure mode
   ```

### Functional Testing

1. **Unit Tests for Constraint Detection**
   ```bash
   npm run test -- migrations/__tests__/2025-10-20_review_action_free_text.test.ts
   ```

   Test cases:
   - Detects CHECK in legacy schema → runs full migration
   - Detects no CHECK, TEXT created_at → runs conversion only
   - Detects no CHECK, INTEGER created_at → no-op
   - Missing table → no-op without error

2. **Integration Tests Against Real Database**
   ```bash
   # Export production schema snapshot
   sqlite3 prod.db ".schema review_action" > schema_snapshot.sql

   # Test migration against snapshot
   npm run test:migration:replay
   ```

3. **Regression Testing**
   - Run migration against databases in all possible states
   - Verify no data loss, no schema corruption
   - Confirm row counts match before/after

### Manual Testing

1. **Fresh database scenario**
   ```bash
   rm -f test.db
   npm run db:migrate
   # Verify migration runs cleanly without probe FK errors
   ```

2. **Legacy database scenario**
   ```bash
   # Restore database with CHECK constraint
   sqlite3 test.db < legacy_schema.sql
   npm run db:migrate
   # Verify CHECK removed, created_at converted
   ```

3. **Idempotency verification**
   ```bash
   npm run db:migrate
   npm run db:migrate
   npm run db:migrate
   # All runs should succeed with "already migrated" logs
   ```

## Rollback Plan

### If Migration Detection Fails

**Scenario:** New regex pattern doesn't match CHECK constraint variations

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   npm run build
   npm run deploy
   ```

2. **Investigation**
   - Dump actual `CREATE TABLE` statements from affected databases
   - Test regex against real schema variations
   - Check SQLite version differences in constraint syntax

3. **Fix Options**
   - **Option A:** Make regex more permissive (case-insensitive, whitespace-flexible)
   - **Option B:** Add multiple regex patterns for different SQLite versions
   - **Option C:** Parse SQL more robustly (consider using SQL parser library)

### If DDL Introspection Unavailable

**Scenario:** Older SQLite versions don't support `sqlite_master` query (extremely unlikely)

1. **Fallback strategy**
   - Revert to probe insert, but add proper FK handling:
   ```typescript
   db.exec(`PRAGMA foreign_keys = OFF`);
   // ... probe insert logic
   db.exec(`PRAGMA foreign_keys = ON`);
   ```

2. **Better long-term fix:** Check SQLite version and use appropriate detection method

### If Test Coverage Reveals Edge Cases

**Scenario:** Tests discover schema states not handled by new logic

1. **Do not merge** until all test cases pass
2. **Add failing test** to regression suite
3. **Update constraint detection logic** to handle edge case
4. **Re-run full test suite** before deployment

### Emergency Procedure

If deployed and causing migration failures:

```bash
# 1. Hotfix: Skip migration entirely (dangerous, but stops crashes)
# Edit migration to return early if CHECK detection fails
if (!createdAtCol) {
  logger.warn("[migrate] Cannot determine review_action schema, skipping migration");
  return;
}

# 2. Deploy hotfix immediately
npm run build && npm run deploy

# 3. Fix properly in separate branch
git checkout -b fix/migration-detection
# Debug schema detection, add comprehensive tests

# 4. Re-deploy with full test coverage
```

## Success Criteria

- [ ] `hasCheckConstraint()` helper function implemented and documented
- [ ] Probe insert logic completely removed (lines 68-84)
- [ ] CHECK constraint detected via `sqlite_master` DDL introspection
- [ ] Debug logging shows detection results
- [ ] No foreign key dependency in migration detection
- [ ] Migration runs successfully on fresh database (no FK errors)
- [ ] Migration is idempotent (safe to run multiple times)
- [ ] Test suite covers all schema states (legacy, partial, complete, missing)
- [ ] All tests pass in CI/CD pipeline
- [ ] No regression in existing migration behavior
- [ ] Documentation updated with introspection approach

## Timeline

1. **Hour 1: Implementation** (Steps 1-2) - 45 minutes
   - Add `hasCheckConstraint()` helper function
   - Replace probe insert with DDL introspection
   - Update logging for debugging
   - Manual smoke testing

2. **Hour 1-2: Testing** (Steps 3-4) - 60 minutes
   - Write comprehensive test suite
   - Test against all schema states
   - Run regression tests on real database snapshots
   - Document edge cases

3. **Hour 2-3: Validation** - 45 minutes
   - Integration testing with full migration runner
   - Deploy to staging environment
   - Monitor migration logs for unexpected behavior
   - Code review and documentation updates

4. **Buffer** - 30 minutes
   - Handle unexpected edge cases
   - Fix test failures
   - Update migration documentation

**Total estimated time:** 2-3 hours

## Benefits

### Reliability
- No foreign key dependency in migration detection
- Direct DDL introspection is more reliable than probe inserts
- Eliminates false negatives from FK constraint failures

### Performance
- No transaction overhead for metadata checks
- Single SELECT query vs. INSERT + rollback
- Faster migration detection (~10ms vs ~50ms)

### Maintainability
- Reusable `hasCheckConstraint()` helper for future migrations
- Self-documenting code (schema introspection intent is clear)
- Easier to test (no need to mock FK constraints)

### Safety
- No data mutations during detection phase
- Works correctly regardless of FK relationships
- Robust against SQLite error message changes

## References

- **SQLite Master Table:** https://sqlite.org/schematab.html
- **PRAGMA table_info:** https://sqlite.org/pragma.html#pragma_table_info
- **SQLite Constraints:** https://sqlite.org/lang_createtable.html#check_constraints
- **Current implementation:** `migrations/2025-10-20_review_action_free_text.ts:68-84`
- **Better-sqlite3 introspection:** https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#preparestring---statement
