# Issue #6: Fix SQL Injection Risk in Migration Helpers

**Status:** Planned
**Priority:** High (Security)
**Estimated Effort:** 1-2 hours
**Created:** 2025-11-30

## Summary

Table names are interpolated directly into SQL queries in migration helper functions without validation, creating SQL injection vulnerability. While the main database module (`src/db/db.ts`) properly validates identifiers using `SQL_IDENTIFIER_RE` before interpolation, the migration helpers (`migrations/lib/helpers.ts`) lack this protection.

## Current State

### Problem

**Location:** `migrations/lib/helpers.ts:95` and `migrations/lib/helpers.ts:199`

Two functions directly interpolate unvalidated table names into SQL:

1. **`getTableColumns()` (line 95)**
   ```typescript
   return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{...}>;
   ```
   - Direct string interpolation into PRAGMA query
   - No validation of `tableName` parameter
   - Could execute arbitrary SQL if attacker-controlled

2. **`getRowCount()` (line 199)**
   ```typescript
   const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
   ```
   - Direct string interpolation into SELECT query
   - No validation of `tableName` parameter
   - Could execute arbitrary SQL if attacker-controlled

### Contrast with Secure Implementation

**`src/db/db.ts:202-226`** demonstrates the correct approach:

```typescript
const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const addColumnIfMissing = (table: string, column: string, definition: string) => {
  // Validate identifiers to prevent SQL injection
  if (!SQL_IDENTIFIER_RE.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  if (!SQL_IDENTIFIER_RE.test(column)) {
    throw new Error(`Invalid column name: ${column}`);
  }
  // Block dangerous patterns in definition
  if (definition.includes(";") || definition.includes("--") || definition.includes("/*")) {
    throw new Error(`Invalid column definition: ${definition}`);
  }

  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  // ... safe to interpolate after validation
}
```

### Risk Assessment

- **Attack Vector:** Migration scripts that accept external input (config files, CLI args)
- **Impact:** Arbitrary SQL execution, data exfiltration, database corruption
- **Likelihood:** Low (migrations run in controlled environment) but **unacceptable for security-critical code**
- **Severity:** HIGH - principle of defense in depth applies even to internal tools
- **Current Mitigation:** None - relies solely on caller to pass safe values

### Current Usage

```bash
# Used by migrations:
migrations/005_add_note_column.ts
migrations/011_add_review_action_table.ts
migrations/013_add_action_log_table.ts
# (Potentially other migration files)
```

Currently called with hardcoded table names, but nothing prevents future misuse.

## Proposed Changes

### Step 1: Add Validation Regex to helpers.ts

**Goal:** Establish shared validation pattern

Add to top of `migrations/lib/helpers.ts` (after imports, around line 21):

```typescript
/**
 * SQL identifier validation regex
 * SECURITY: Prevents SQL injection by ensuring identifiers contain only safe characters
 * Pattern: Must start with letter/underscore, followed by letters/numbers/underscores
 * Same regex used in src/db/db.ts for consistency
 */
const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
```

### Step 2: Add Validation Helper Function

**Goal:** Create reusable validation with clear error messages

Add after `SQL_IDENTIFIER_RE` definition:

```typescript
/**
 * Validate SQL identifier to prevent injection attacks
 * @param identifier - Table or column name to validate
 * @param type - Type of identifier for error message (e.g., "table", "column")
 * @throws Error if identifier contains invalid characters
 */
function validateIdentifier(identifier: string, type: string): void {
  if (!SQL_IDENTIFIER_RE.test(identifier)) {
    throw new Error(
      `Invalid ${type} name: "${identifier}". ` +
      `SQL identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    );
  }
}
```

### Step 3: Secure getTableColumns()

**Goal:** Validate tableName before interpolation

Update `getTableColumns()` function (line 91-102):

```typescript
export function getTableColumns(
  db: Database,
  tableName: string
): Array<{ name: string; type: string; notnull: number; dflt_value: any; pk: number }> {
  // SECURITY: Validate table name before interpolation to prevent SQL injection
  validateIdentifier(tableName, "table");

  return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
  }>;
}
```

### Step 4: Secure getRowCount()

**Goal:** Validate tableName before interpolation

Update `getRowCount()` function (line 198-203):

```typescript
export function getRowCount(db: Database, tableName: string): number {
  // SECURITY: Validate table name before interpolation to prevent SQL injection
  validateIdentifier(tableName, "table");

  const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as {
    count: number;
  };
  return result.count;
}
```

### Step 5: Add Security Comment to File Header

**Goal:** Document security-critical nature of this module

Add to file header documentation (line 7-8):

```typescript
 * DOCS:
 *  - SQLite PRAGMA: https://sqlite.org/pragma.html
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQL Injection Prevention: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
 *
 * SECURITY:
 *  - All table/column names are validated against SQL_IDENTIFIER_RE before interpolation
 *  - Functions throw early if invalid identifiers are detected
```

## Files Affected

### Modified
- `migrations/lib/helpers.ts`
  - Add `SQL_IDENTIFIER_RE` constant (line ~21)
  - Add `validateIdentifier()` helper function (line ~35)
  - Update `getTableColumns()` with validation (line ~91)
  - Update `getRowCount()` with validation (line ~198)
  - Update file header with security documentation (line ~7)

### Reviewed (no changes needed)
- All migration files using `getTableColumns()` or `getRowCount()`
  - No changes needed - validation is transparent to callers
  - Existing hardcoded table names will pass validation
- `src/db/db.ts` - Reference implementation, no changes

## Testing Strategy

### Pre-Migration Testing
1. **Verify current migration suite passes**
   ```bash
   npm run migrate
   # Or however migrations are executed in this project
   ```

2. **Document baseline behavior**
   - All existing migrations should complete successfully
   - No changes to migration outputs expected

### Security Testing
1. **Unit Tests for Validation**

   Create `migrations/lib/helpers.test.ts`:
   ```typescript
   import { describe, it, expect } from "vitest"; // or jest
   import Database from "better-sqlite3";
   import { getTableColumns, getRowCount } from "./helpers.js";

   describe("SQL Injection Protection", () => {
     const db = new Database(":memory:");
     db.exec("CREATE TABLE valid_table (id INTEGER PRIMARY KEY, name TEXT)");
     db.exec("INSERT INTO valid_table (name) VALUES ('test')");

     describe("getTableColumns", () => {
       it("accepts valid table names", () => {
         expect(() => getTableColumns(db, "valid_table")).not.toThrow();
         expect(() => getTableColumns(db, "schema_migrations")).not.toThrow();
         expect(() => getTableColumns(db, "_underscore_table")).not.toThrow();
       });

       it("rejects SQL injection attempts", () => {
         expect(() => getTableColumns(db, "users; DROP TABLE users--"))
           .toThrow(/Invalid table name/);
         expect(() => getTableColumns(db, "users' OR '1'='1"))
           .toThrow(/Invalid table name/);
         expect(() => getTableColumns(db, "users/**/"))
           .toThrow(/Invalid table name/);
       });

       it("rejects invalid identifier patterns", () => {
         expect(() => getTableColumns(db, "123_starts_with_number"))
           .toThrow(/Invalid table name/);
         expect(() => getTableColumns(db, "has-dash"))
           .toThrow(/Invalid table name/);
         expect(() => getTableColumns(db, "has.dot"))
           .toThrow(/Invalid table name/);
       });
     });

     describe("getRowCount", () => {
       it("accepts valid table names", () => {
         expect(getRowCount(db, "valid_table")).toBe(1);
       });

       it("rejects SQL injection attempts", () => {
         expect(() => getRowCount(db, "users; DROP TABLE users--"))
           .toThrow(/Invalid table name/);
         expect(() => getRowCount(db, "users UNION SELECT * FROM passwords"))
           .toThrow(/Invalid table name/);
       });
     });
   });
   ```

2. **Regression Testing**
   ```bash
   # Run all existing migrations against clean database
   rm -f data/test.db
   NODE_ENV=test npm run migrate

   # Verify all migrations complete without errors
   ```

3. **Integration Testing**
   - Test migrations that use `getTableColumns()`:
     ```bash
     grep -r "getTableColumns" migrations/
     ```
   - Test migrations that use `getRowCount()`:
     ```bash
     grep -r "getRowCount" migrations/
     ```
   - Ensure all identified migrations still work correctly

### Post-Migration Validation
```bash
# Verify no regressions in migration system
npm run migrate

# Run test suite
npm test

# Check TypeScript compilation
npm run build

# Verify no lingering vulnerabilities
npm audit
```

## Rollback Plan

### If Validation Breaks Existing Migrations

**Scenario:** Existing migration uses non-standard table name (e.g., from schema with dashes/dots)

1. **Immediate Rollback**
   ```bash
   git checkout HEAD -- migrations/lib/helpers.ts
   ```

2. **Investigation**
   - Identify which table name failed validation
   - Determine if name is intentional or migration bug
   - Document findings

3. **Resolution Options**
   - **Option A:** Update migration to use valid table name (preferred)
   - **Option B:** Adjust regex if legitimate use case exists (unlikely)
   - **Option C:** Add escape hatch with explicit comment and warning

### If Tests Fail Mid-Migration

1. **Keep changes in branch**
2. **Debug specific failure:**
   ```bash
   # Run failing test in isolation
   npm test -- migrations/lib/helpers.test.ts --verbose
   ```
3. **Fix validation logic or test expectations**
4. **Re-run full test suite before merging**

### Emergency Rollback Procedure

If deployed and migration system fails in production:

```bash
# 1. Revert commit
git revert <commit-hash>

# 2. Deploy hotfix
npm run deploy

# 3. Investigate root cause offline
git checkout -b debug/sql-injection-fix
# Debug and fix properly

# 4. Re-deploy with proper testing
```

## Success Criteria

- [ ] `SQL_IDENTIFIER_RE` constant added to helpers.ts
- [ ] `validateIdentifier()` helper function implemented
- [ ] `getTableColumns()` validates input before interpolation
- [ ] `getRowCount()` validates input before interpolation
- [ ] Security documentation added to file header
- [ ] Unit tests cover valid and invalid identifier cases
- [ ] All existing migrations pass without modification
- [ ] TypeScript compilation succeeds
- [ ] No false positives (valid identifiers rejected)
- [ ] SQL injection attempts properly blocked

## Timeline

1. **Hour 1: Implementation** (Steps 1-5) - 30 minutes
   - Add validation regex and helper function
   - Update both vulnerable functions
   - Update documentation

2. **Hour 1: Testing** - 30 minutes
   - Write unit tests for validation logic
   - Test valid and invalid identifier patterns
   - Run regression tests on existing migrations

3. **Hour 2: Review and Documentation** - 30 minutes
   - Code review focusing on security
   - Verify all edge cases covered
   - Update any related documentation

4. **Buffer** - 30 minutes
   - Handle any unexpected issues
   - Additional testing if needed

**Total estimated time:** 1.5-2 hours

## References

- **OWASP SQL Injection Prevention:** https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- **SQLite Identifier Rules:** https://www.sqlite.org/lang_keywords.html
- **better-sqlite3 Security:** https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#security
- **Existing secure implementation:** `src/db/db.ts:202-226`
