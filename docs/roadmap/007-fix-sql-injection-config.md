# Issue #7: SQL Injection Risk - String Interpolation in ALTER TABLE

**Status:** Planned
**Priority:** High (Security Hardening)
**Estimated Effort:** 1-2 hours
**Created:** 2025-11-30

## Summary

Column names in `src/lib/config.ts` are interpolated directly into ALTER TABLE statements without explicit validation, creating a potential SQL injection vector. While the current risk is low (column names come from hardcoded arrays), explicit validation guards are missing, violating defense-in-depth security principles.

This fix adds identifier allowlists before column name interpolation, following the existing pattern used in `src/features/metricsEpoch.ts` and `src/lib/config.ts:317-336`.

---

## Current State (What's Wrong)

### Vulnerable Code Locations

**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`

**Line 141** (ensureWelcomeChannelsColumns):
```typescript
const missing = ["info_channel_id", "rules_channel_id", "welcome_ping_role_id"].filter(
  (col) => !cols.some((c) => c.name === col)
);
for (const col of missing) {
  logger.info({ table: "guild_config", column: col }, "[ensure] adding welcome channel column");
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
}
```

**Line 177** (ensureModRolesColumns):
```typescript
const missing = [
  "mod_role_ids",
  "gatekeeper_role_id",
  "modmail_log_channel_id",
  "modmail_delete_on_close",
].filter((col) => !cols.some((c) => c.name === col));
for (const col of missing) {
  logger.info({ table: "guild_config", column: col }, "[ensure] adding mod roles column");
  const colType = col === "modmail_delete_on_close" ? "INTEGER DEFAULT 1" : "TEXT";
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colType}`).run();
}
```

**Line 211** (ensureDadModeColumns):
```typescript
const missing = ["dadmode_enabled", "dadmode_odds"].filter(
  (col) => !cols.some((c) => c.name === col)
);
for (const col of missing) {
  logger.info({ table: "guild_config", column: col }, "[ensure] adding dadmode column");
  const colDef =
    col === "dadmode_enabled" ? "INTEGER DEFAULT 0" : "INTEGER DEFAULT 1000";
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colDef}`).run();
}
```

**Line 244** (ensureListopenPublicOutputColumn):
```typescript
if (!cols.some((col) => col.name === "listopen_public_output")) {
  logger.info(
    { table: "guild_config", column: "listopen_public_output" },
    "[ensure] adding listopen_public_output column (default 1 = public)"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN listopen_public_output INTEGER DEFAULT 1`).run();
}
```

### Similar Patterns in Other Files

The following files also use string interpolation for ALTER TABLE but are outside the scope of this issue:

- `src/db/db.ts:220` - Uses `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
- `src/db/ensure.ts` - Multiple instances (lines 78, 82, 86, 90, 94, 98, 102, 106, 110, 114, 118, 122, 126, 167, 174, 510, 517, 598, 806, 812, 818, 824, 861, 868)
- `src/features/suggestions/store.ts:134, 140`

**Note:** This roadmap focuses only on `src/lib/config.ts`. Other files should be addressed in separate issues.

### Why This is a Problem

1. **No Explicit Validation**: Column names are interpolated directly from array literals without allowlist checks
2. **Defense in Depth Violation**: Even if source data is currently safe, there's no guard against future refactoring introducing dynamic column names
3. **Inconsistent Security Posture**: The same file already uses allowlist validation for UPDATE operations (lines 317-336) but not for ALTER TABLE
4. **Type System Bypass**: TypeScript can't protect against SQL injection in string templates

### Current Risk Level

**Low to Medium:**
- **Mitigating factors:** Column names come from hardcoded array literals in the same function scope
- **Risk factors:** No validation means a future developer could accidentally introduce dynamic column names
- **Attack vector:** Currently requires code modification, not runtime exploitation

---

## Proposed Changes

### Step 1: Create Migration Column Allowlist

Add an allowlist constant at the top of the file (after imports, before the ensure flags).

**File:** `src/lib/config.ts` (around line 68)

**Add:**
```typescript
// Allowlist of valid column names for ALTER TABLE migration operations.
// This prevents SQL injection if column name sources ever become dynamic.
// Pattern follows metricsEpoch.ts:101 and config.ts:317 validation approach.
const ALLOWED_MIGRATION_COLUMNS = new Set([
  // Welcome channel columns
  "info_channel_id",
  "rules_channel_id",
  "welcome_ping_role_id",
  "welcome_template",
  "unverified_channel_id",

  // Mod roles and modmail columns
  "mod_role_ids",
  "gatekeeper_role_id",
  "modmail_log_channel_id",
  "modmail_delete_on_close",

  // Feature toggle columns
  "dadmode_enabled",
  "dadmode_odds",
  "listopen_public_output",
]);
```

### Step 2: Add Validation Helper Function

Add a reusable validation function after the allowlist constant.

**File:** `src/lib/config.ts` (after allowlist)

**Add:**
```typescript
/**
 * validateMigrationColumnName
 * WHAT: Validates column name against allowlist before SQL interpolation
 * WHY: Prevents SQL injection if column names ever become dynamic
 * THROWS: Error with sanitized message if column name is rejected
 */
function validateMigrationColumnName(columnName: string): void {
  if (!ALLOWED_MIGRATION_COLUMNS.has(columnName)) {
    logger.error(
      { columnName, table: "guild_config" },
      "[config] Invalid migration column name rejected - potential SQL injection attempt"
    );
    throw new Error(`Invalid column name for migration: ${columnName}`);
  }
}
```

### Step 3: Add Validation to ensureWelcomeChannelsColumns

**File:** `src/lib/config.ts:136-142`

**Replace:**
```typescript
const missing = ["info_channel_id", "rules_channel_id", "welcome_ping_role_id"].filter(
  (col) => !cols.some((c) => c.name === col)
);
for (const col of missing) {
  logger.info({ table: "guild_config", column: col }, "[ensure] adding welcome channel column");
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
}
```

**With:**
```typescript
const missing = ["info_channel_id", "rules_channel_id", "welcome_ping_role_id"].filter(
  (col) => !cols.some((c) => c.name === col)
);
for (const col of missing) {
  validateMigrationColumnName(col); // Validate before interpolation
  logger.info({ table: "guild_config", column: col }, "[ensure] adding welcome channel column");
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
}
```

### Step 4: Add Validation to ensureModRolesColumns

**File:** `src/lib/config.ts:167-178`

**Replace:**
```typescript
const missing = [
  "mod_role_ids",
  "gatekeeper_role_id",
  "modmail_log_channel_id",
  "modmail_delete_on_close",
].filter((col) => !cols.some((c) => c.name === col));
for (const col of missing) {
  logger.info({ table: "guild_config", column: col }, "[ensure] adding mod roles column");
  const colType = col === "modmail_delete_on_close" ? "INTEGER DEFAULT 1" : "TEXT";
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colType}`).run();
}
```

**With:**
```typescript
const missing = [
  "mod_role_ids",
  "gatekeeper_role_id",
  "modmail_log_channel_id",
  "modmail_delete_on_close",
].filter((col) => !cols.some((c) => c.name === col));
for (const col of missing) {
  validateMigrationColumnName(col); // Validate before interpolation
  logger.info({ table: "guild_config", column: col }, "[ensure] adding mod roles column");
  const colType = col === "modmail_delete_on_close" ? "INTEGER DEFAULT 1" : "TEXT";
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colType}`).run();
}
```

### Step 5: Add Validation to ensureDadModeColumns

**File:** `src/lib/config.ts:203-212`

**Replace:**
```typescript
const missing = ["dadmode_enabled", "dadmode_odds"].filter(
  (col) => !cols.some((c) => c.name === col)
);
for (const col of missing) {
  logger.info({ table: "guild_config", column: col }, "[ensure] adding dadmode column");
  const colDef =
    col === "dadmode_enabled" ? "INTEGER DEFAULT 0" : "INTEGER DEFAULT 1000";
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colDef}`).run();
}
```

**With:**
```typescript
const missing = ["dadmode_enabled", "dadmode_odds"].filter(
  (col) => !cols.some((c) => c.name === col)
);
for (const col of missing) {
  validateMigrationColumnName(col); // Validate before interpolation
  logger.info({ table: "guild_config", column: col }, "[ensure] adding dadmode column");
  const colDef =
    col === "dadmode_enabled" ? "INTEGER DEFAULT 0" : "INTEGER DEFAULT 1000";
  db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colDef}`).run();
}
```

### Step 6: Add Validation to ensureUnverifiedChannelColumn

**File:** `src/lib/config.ts:89-95`

**Replace:**
```typescript
const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
if (!cols.some((col) => col.name === "unverified_channel_id")) {
  logger.info(
    { table: "guild_config", column: "unverified_channel_id" },
    "[ensure] adding unverified_channel_id column"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN unverified_channel_id TEXT`).run();
}
```

**With:**
```typescript
const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
if (!cols.some((col) => col.name === "unverified_channel_id")) {
  validateMigrationColumnName("unverified_channel_id"); // Validate before interpolation
  logger.info(
    { table: "guild_config", column: "unverified_channel_id" },
    "[ensure] adding unverified_channel_id column"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN unverified_channel_id TEXT`).run();
}
```

### Step 7: Add Validation to ensureWelcomeTemplateColumn

**File:** `src/lib/config.ts:112-119`

**Replace:**
```typescript
const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
if (!cols.some((col) => col.name === "welcome_template")) {
  logger.info(
    { table: "guild_config", column: "welcome_template" },
    "[ensure] adding welcome_template column"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN welcome_template TEXT`).run();
}
```

**With:**
```typescript
const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
if (!cols.some((col) => col.name === "welcome_template")) {
  validateMigrationColumnName("welcome_template"); // Validate before interpolation
  logger.info(
    { table: "guild_config", column: "welcome_template" },
    "[ensure] adding welcome_template column"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN welcome_template TEXT`).run();
}
```

### Step 8: Add Validation to ensureListopenPublicOutputColumn

**File:** `src/lib/config.ts:238-245`

**Replace:**
```typescript
const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
if (!cols.some((col) => col.name === "listopen_public_output")) {
  logger.info(
    { table: "guild_config", column: "listopen_public_output" },
    "[ensure] adding listopen_public_output column (default 1 = public)"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN listopen_public_output INTEGER DEFAULT 1`).run();
}
```

**With:**
```typescript
const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
if (!cols.some((col) => col.name === "listopen_public_output")) {
  validateMigrationColumnName("listopen_public_output"); // Validate before interpolation
  logger.info(
    { table: "guild_config", column: "listopen_public_output" },
    "[ensure] adding listopen_public_output column (default 1 = public)"
  );
  db.prepare(`ALTER TABLE guild_config ADD COLUMN listopen_public_output INTEGER DEFAULT 1`).run();
}
```

---

## Files Affected

1. **`/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`**
   - Add `ALLOWED_MIGRATION_COLUMNS` allowlist (line ~68)
   - Add `validateMigrationColumnName()` helper function (line ~85)
   - Update `ensureUnverifiedChannelColumn()` (line ~94)
   - Update `ensureWelcomeTemplateColumn()` (line ~118)
   - Update `ensureWelcomeChannelsColumns()` (line ~141)
   - Update `ensureModRolesColumns()` (line ~177)
   - Update `ensureDadModeColumns()` (line ~211)
   - Update `ensureListopenPublicOutputColumn()` (line ~244)

---

## Testing Strategy

### Pre-Change Validation

1. **Verify current behavior works:**
   ```bash
   # Start bot in dev mode
   npm run dev

   # Trigger all ensure functions by accessing config
   # Should see log messages for any missing columns being added
   ```

2. **Document current table schema:**
   ```bash
   sqlite3 data/data.db "PRAGMA table_info(guild_config);"
   # Save output for comparison
   ```

### Post-Change Testing

1. **Build verification:**
   ```bash
   npm run build
   # Should compile without TypeScript errors
   ```

2. **Fresh database test:**
   ```bash
   # Backup production DB
   cp data/data.db data/data.db.backup

   # Delete guild_config table
   sqlite3 data/data.db "DROP TABLE IF EXISTS guild_config;"

   # Restart bot to trigger migrations
   npm run dev

   # Verify all columns are created with validation
   sqlite3 data/data.db "PRAGMA table_info(guild_config);"
   ```

3. **Runtime validation test:**
   - Start bot normally
   - Execute commands that call `getConfig()` or `upsertConfig()`
   - Verify no validation errors in logs
   - Verify bot functionality unchanged

4. **Security validation test:**
   ```bash
   # Temporarily modify hardcoded array to include invalid column
   # Add to ensureWelcomeChannelsColumns: "'; DROP TABLE guild_config; --"
   # Should throw error and log rejection message
   # Remove test code before commit
   ```

### Regression Risk

**Very Low** - Changes are purely additive (defense in depth):
- Column names are still from hardcoded arrays
- Validation adds safety guard but doesn't change behavior
- Error logs provide visibility if validation ever triggers
- Existing ensure functions remain functionally identical

---

## Rollback Plan

### Git Rollback

```bash
git log --oneline -n 5  # Find commit hash
git revert <commit-hash>
npm run build
pm2 restart pawtropolis-bot
```

### Manual Rollback

If validation causes unexpected issues:

1. **Remove validation calls:**
   - Delete `validateMigrationColumnName(col);` from each ensure function
   - Keep allowlist and helper function (harmless)

2. **Rebuild and restart:**
   ```bash
   npm run build
   pm2 restart pawtropolis-bot
   ```

### Recovery Time

- Git revert: ~1 minute
- Manual rollback: ~3 minutes
- Total downtime: <1 minute (hot reload)

---

## Additional Notes

### Why Not Use Parameterized Queries?

SQLite doesn't support parameterized identifiers (table/column names), only values. From SQLite docs:

> "Parameters can only be used where a literal value is expected. They cannot be used for identifiers such as table names or column names."

This is why allowlist validation is the standard defense for dynamic identifiers.

### Future Work

After this fix is deployed, consider:

1. **Audit similar patterns:**
   - `src/db/db.ts:220` - Generic column addition helper
   - `src/db/ensure.ts` - 20+ instances of ALTER TABLE interpolation
   - `src/features/suggestions/store.ts` - Feature-specific migrations

2. **Create shared validation:**
   - Extract to `src/db/validateIdentifier.ts` for reuse
   - Add table name validation for `ALTER TABLE ${table}`

3. **Add linter rule:**
   - ESLint rule to flag unvalidated SQL template literals
   - Require validation comment if intentionally bypassed

### Related Security Issues

This fix addresses Issue #7 from the codebase audit. Related security findings:

- **Issue #8:** Duplicate auth logic in review commands
- **Issue #9:** Unsafe type casting with `as any`
- **Issue #10:** Hardcoded credentials check

### Pattern Precedent

This implementation follows existing validation patterns in the codebase:

1. **`src/features/metricsEpoch.ts:101-121`** - Time column allowlist
2. **`src/lib/config.ts:317-336`** - Config column allowlist for UPDATE
3. **`src/features/review.ts:24`** - Review action allowlist

All use the same pattern: `Set` for O(1) lookup + error logging + throw on rejection.

---

## Acceptance Criteria

- [ ] `ALLOWED_MIGRATION_COLUMNS` allowlist defined with all current migration columns
- [ ] `validateMigrationColumnName()` helper function implemented
- [ ] All 6 ensure functions call validation before ALTER TABLE
- [ ] Code compiles without errors (`npm run build`)
- [ ] Bot starts successfully with fresh database (triggers all migrations)
- [ ] All existing columns are created correctly
- [ ] No validation errors in production logs
- [ ] Manual security test rejects invalid column name
- [ ] Git commit message references Issue #7
- [ ] Documentation comment explains defense-in-depth rationale
