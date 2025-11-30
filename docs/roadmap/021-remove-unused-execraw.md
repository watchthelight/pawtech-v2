# Issue #21: Remove Unused `execRaw` Function

**Type:** Dead Code Cleanup + Security Risk Reduction
**Priority:** Medium
**Effort:** Low (1-2 hours)
**Risk:** Low

## Summary

The `execRaw()` function in `src/db/db.ts` (lines 42-50) is exported but never used anywhere in the codebase. This function wraps `db.exec()` to allow raw multi-statement DDL execution, which poses a security risk if accidentally used with unsanitized input. Despite the JSDoc comment claiming "Only for migrations in ensure.ts", the actual migration code in `ensure.ts` calls `db.exec()` directly instead of using `execRaw()`.

## Current State

### What's Wrong

1. **Dead Code**: The `execRaw()` function is exported but has zero call sites across the entire codebase
2. **Security Risk**: The function enables dangerous multi-statement SQL execution without safeguards
3. **Misleading Documentation**: JSDoc claims it's used by `ensure.ts`, but that file uses `db.exec()` directly
4. **False Dependency**: The function's existence suggests it's needed, when it's actually redundant

### Evidence

```bash
# No imports found
$ grep -r "import.*execRaw" src/
(no results)

# Only references are the definition, docs, and audit
$ grep -r "execRaw" src/
src/db/db.ts:42: * execRaw
src/db/db.ts:48:export function execRaw(sql: string): void {
src/db/README.md:27:- Provides `execRaw()` for multi-statement DDL (migrations only)
```

### Current Implementation

```typescript
/**
 * execRaw
 * WHAT: Execute raw SQL via better-sqlite3's exec() method, bypassing tracedPrepare.
 * WHY: Schema migrations need multi-statement DDL that the prepare() guard blocks.
 * USAGE: Only for migrations in ensure.ts; all normal queries use prepare().
 * DOCS: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#execstring---this
 */
export function execRaw(sql: string): void {
  db.exec(sql);
}
```

**Reality**: `ensure.ts` uses `db.exec()` directly in 20+ places, never calling `execRaw()`.

## Proposed Changes

### Step-by-Step Plan

1. **Remove the function** (lines 41-50 in `src/db/db.ts`)
   - Delete the entire `execRaw()` function and its JSDoc comment
   - This is safe because it has zero call sites

2. **Update documentation** (`src/db/README.md`)
   - Remove references to `execRaw()` from the exports table
   - Remove the migration-only usage claim
   - Document that migrations use `db.exec()` directly when needed

3. **Verify no runtime impact**
   - Run existing tests to confirm nothing breaks
   - Search for any dynamic string imports (e.g., `db["execRaw"]`) that might bypass static analysis

### Code Changes

**File: `/Users/bash/Documents/pawtropolis-tech/src/db/db.ts`**
```diff
-/**
- * execRaw
- * WHAT: Execute raw SQL via better-sqlite3's exec() method, bypassing tracedPrepare.
- * WHY: Schema migrations need multi-statement DDL that the prepare() guard blocks.
- * USAGE: Only for migrations in ensure.ts; all normal queries use prepare().
- * DOCS: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#execstring---this
- */
-export function execRaw(sql: string): void {
-  db.exec(sql);
-}
-
 const legacyRe = /__old|ALTER\s+TABLE\s+.+\s+RENAME/i;
```

**File: `/Users/bash/Documents/pawtropolis-tech/src/db/README.md`**
```diff
-| `execRaw(sql)` | `function` | Execute raw multi-statement SQL (migrations only) |
```

## Files Affected

- `/Users/bash/Documents/pawtropolis-tech/src/db/db.ts` - Remove function (lines 41-50)
- `/Users/bash/Documents/pawtropolis-tech/src/db/README.md` - Update documentation

## Testing Strategy

### Pre-Deployment Verification

1. **Static Analysis**
   ```bash
   # Verify no imports exist
   grep -r "execRaw" src/ test/

   # Verify no dynamic string access
   grep -r 'db\["execRaw"\]' src/
   grep -r "db\['execRaw'\]" src/
   ```

2. **Type Checking**
   ```bash
   npm run typecheck
   ```

3. **Unit Tests**
   ```bash
   npm test
   ```

4. **Integration Tests**
   - Run bot in development environment
   - Verify database initialization succeeds
   - Verify migrations in `ensure.ts` still work correctly

### Expected Behavior

- All tests pass (no new failures)
- TypeScript compilation succeeds with no new errors
- Database initialization and migrations work unchanged
- No runtime errors related to missing `execRaw` function

### Risk Assessment

**Risk Level: LOW**
- Zero call sites found via static analysis
- Function is pure dead code
- Migrations already use `db.exec()` directly
- No breaking changes to public API (this is an internal module)

## Rollback Plan

### If Issues Arise

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   ```

2. **Restore Function**
   - Re-add the 9-line function to `src/db/db.ts`
   - Restore documentation in `src/db/README.md`
   - Deploy hotfix

### Rollback Risk

**Very Low** - The function is trivial to restore if needed. It's a simple wrapper around `db.exec()` with no complex logic or state.

## Benefits

1. **Reduced Attack Surface**: Remove potentially dangerous SQL execution path
2. **Cleaner Codebase**: Eliminate confusing dead code
3. **Accurate Documentation**: Align docs with actual implementation
4. **Maintainability**: One less function to reason about during security audits

## Notes

- This function may have been created with good intentions but never actually used
- The real migration code in `ensure.ts` directly calls `db.exec()`, making this wrapper redundant
- If multi-statement DDL execution is needed in the future, callers can use `db.exec()` directly
