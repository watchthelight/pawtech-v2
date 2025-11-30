# Issue #39: Simplify Migration Flags with Set-Based Tracking

**Status:** Planned
**Priority:** Low
**Estimated Effort:** 30-45 minutes
**Created:** 2025-11-30

## Summary

The `src/lib/config.ts` file uses multiple independent boolean flags to track schema migrations. This pattern doesn't scale well and creates maintenance overhead. Each new migration requires adding a new module-level variable, which clutters the code and makes it difficult to track which migrations have been applied.

## Current State

### Problem

**Location:** `src/lib/config.ts:73-77`

The file currently uses five separate boolean flags to track schema migrations:

```typescript
let welcomeTemplateEnsured = false;
let welcomeChannelsEnsured = false;
let unverifiedChannelEnsured = false;
let modRolesColumnsEnsured = false;
let dadmodeColumnsEnsured = false;
```

Additionally, there's a sixth flag defined later in the file:

```typescript
let listopenPublicOutputEnsured = false; // Line 219
```

**Issues:**

1. **Poor scalability:** Each new migration requires a new variable declaration
2. **Code clutter:** Module-level state pollutes the namespace
3. **Difficult to audit:** No centralized view of which migrations exist
4. **Inconsistent naming:** Flag variable names follow different patterns
5. **Fragile pattern:** Easy to forget to add new flags when creating migrations
6. **No introspection:** Can't easily log or debug which migrations have run

### Current Migration Functions

The pattern is repeated across six ensure functions:
- `ensureUnverifiedChannelColumn()` (lines 79-100)
- `ensureWelcomeTemplateColumn()` (lines 102-124)
- `ensureWelcomeChannelsColumns()` (lines 126-147)
- `ensureModRolesColumns()` (lines 149-183)
- `ensureDadModeColumns()` (lines 185-217)
- `ensureListopenPublicOutputColumn()` (lines 221-250)

Each function:
1. Checks its corresponding boolean flag
2. Returns early if flag is true
3. Performs PRAGMA table introspection
4. Runs ALTER TABLE if columns are missing
5. Sets flag to true on success

### Why This Matters

While the current implementation works, it demonstrates a code quality anti-pattern. As the schema evolves and more migrations are added, this approach becomes increasingly unwieldy. This is a low-risk refactoring that improves code maintainability without changing behavior.

## Proposed Changes

### Replace Boolean Flags with Set-Based Tracking

**Goal:** Use a single `Set<string>` to track which migrations have been applied.

**Implementation:**

```typescript
// Replace lines 73-77 and line 219 with:
const ensuredMigrations = new Set<string>();

/**
 * Track which schema migrations have been applied during this runtime.
 *
 * This Set prevents re-running migrations on every config access. Each ensure
 * function adds its migration name after successful completion. Memory footprint
 * is minimal (~6 strings × 30 bytes = ~180 bytes vs ~6 bytes for booleans).
 *
 * Migration names follow pattern: table_column or table_featurename
 * Examples: "guild_config_welcome_template", "guild_config_mod_roles"
 */
```

### Update Each Ensure Function

**Pattern (example for `ensureWelcomeTemplateColumn()`):**

```typescript
function ensureWelcomeTemplateColumn() {
  // Replace this:
  if (welcomeTemplateEnsured) return;

  // With this:
  if (ensuredMigrations.has("guild_config_welcome_template")) return;

  try {
    // ... existing logic ...

    // Replace this:
    welcomeTemplateEnsured = true;

    // With this:
    ensuredMigrations.add("guild_config_welcome_template");
  } catch (err) {
    // ... existing error handling ...
  }
}
```

### Migration Names

Use consistent naming convention for all migrations:

| Old Flag Variable | New Migration Name |
|-------------------|-------------------|
| `welcomeTemplateEnsured` | `guild_config_welcome_template` |
| `welcomeChannelsEnsured` | `guild_config_welcome_channels` |
| `unverifiedChannelEnsured` | `guild_config_unverified_channel` |
| `modRolesColumnsEnsured` | `guild_config_mod_roles` |
| `dadmodeColumnsEnsured` | `guild_config_dadmode` |
| `listopenPublicOutputEnsured` | `guild_config_listopen_public_output` |

### Benefits

1. **Scalability:** Adding new migrations requires no new variables
2. **Introspection:** Can easily log `ensuredMigrations` for debugging
3. **Consistency:** Standardized naming convention
4. **Type safety:** Set operations prevent typos (vs boolean variable names)
5. **Future-ready:** Easy to extend (e.g., export for monitoring/metrics)

## Implementation Plan

### Step 1: Replace Module-Level Flags
**Time:** 5 minutes

1. Remove lines 73-77:
   ```typescript
   let welcomeTemplateEnsured = false;
   let welcomeChannelsEnsured = false;
   let unverifiedChannelEnsured = false;
   let modRolesColumnsEnsured = false;
   let dadmodeColumnsEnsured = false;
   ```

2. Remove line 219:
   ```typescript
   let listopenPublicOutputEnsured = false;
   ```

3. Add single Set declaration at line 73:
   ```typescript
   const ensuredMigrations = new Set<string>();
   ```

4. Add documentation comment explaining the Set and naming convention

### Step 2: Update ensureUnverifiedChannelColumn()
**Time:** 3 minutes

Replace:
```typescript
if (unverifiedChannelEnsured) return;
// ...
unverifiedChannelEnsured = true;
```

With:
```typescript
if (ensuredMigrations.has("guild_config_unverified_channel")) return;
// ...
ensuredMigrations.add("guild_config_unverified_channel");
```

### Step 3: Update ensureWelcomeTemplateColumn()
**Time:** 3 minutes

Replace:
```typescript
if (welcomeTemplateEnsured) return;
// ...
welcomeTemplateEnsured = true;
```

With:
```typescript
if (ensuredMigrations.has("guild_config_welcome_template")) return;
// ...
ensuredMigrations.add("guild_config_welcome_template");
```

### Step 4: Update ensureWelcomeChannelsColumns()
**Time:** 3 minutes

Replace:
```typescript
if (welcomeChannelsEnsured) return;
// ...
welcomeChannelsEnsured = true;
```

With:
```typescript
if (ensuredMigrations.has("guild_config_welcome_channels")) return;
// ...
ensuredMigrations.add("guild_config_welcome_channels");
```

### Step 5: Update ensureModRolesColumns()
**Time:** 3 minutes

Replace:
```typescript
if (modRolesColumnsEnsured) return;
// ...
modRolesColumnsEnsured = true;
```

With:
```typescript
if (ensuredMigrations.has("guild_config_mod_roles")) return;
// ...
ensuredMigrations.add("guild_config_mod_roles");
```

### Step 6: Update ensureDadModeColumns()
**Time:** 3 minutes

Replace:
```typescript
if (dadmodeColumnsEnsured) return;
// ...
dadmodeColumnsEnsured = true;
```

With:
```typescript
if (ensuredMigrations.has("guild_config_dadmode")) return;
// ...
ensuredMigrations.add("guild_config_dadmode");
```

### Step 7: Update ensureListopenPublicOutputColumn()
**Time:** 3 minutes

Replace:
```typescript
if (listopenPublicOutputEnsured) return;
// ...
listopenPublicOutputEnsured = true;
```

With:
```typescript
if (ensuredMigrations.has("guild_config_listopen_public_output")) return;
// ...
ensuredMigrations.add("guild_config_listopen_public_output");
```

### Step 8: Add Debug Logging (Optional)
**Time:** 5 minutes

Add helper function to log applied migrations:

```typescript
/**
 * Log which migrations have been applied (useful for debugging startup issues)
 */
function logEnsuredMigrations() {
  if (ensuredMigrations.size > 0) {
    logger.debug(
      { migrations: Array.from(ensuredMigrations) },
      "[config] schema migrations applied"
    );
  }
}
```

Call after first config access or at end of `upsertConfig()`.

### Step 9: Verify and Test
**Time:** 10 minutes

1. Run TypeScript compilation:
   ```bash
   npm run build
   ```

2. Search for any remaining references to old flag names:
   ```bash
   grep -n "welcomeTemplateEnsured\|welcomeChannelsEnsured\|unverifiedChannelEnsured\|modRolesColumnsEnsured\|dadmodeColumnsEnsured\|listopenPublicOutputEnsured" src/lib/config.ts
   ```

3. Verify all six ensure functions updated correctly

4. Manual test: Start bot and verify migrations still run

## Files Affected

### Modified
- `src/lib/config.ts` - Replace 6 boolean flags with single Set, update 6 ensure functions

### No Changes Required
- Migration logic remains identical
- No database schema changes
- No API surface changes (all functions remain private)
- No behavior changes for consumers

## Testing Strategy

### Type Checking
```bash
npm run build
```

Expected: No TypeScript errors. All `ensuredMigrations.has()` and `.add()` calls should compile.

### Unit Tests (Manual Verification)

Since migrations run on first access, testing involves:

1. **Clean database test:**
   - Delete or rename local SQLite database
   - Start bot
   - Check logs for migration messages like:
     ```
     [ensure] adding unverified_channel_id column
     [ensure] adding welcome_template column
     [ensure] adding welcome channel column
     # etc.
     ```

2. **Existing database test:**
   - Use database with all columns present
   - Start bot
   - Verify no ALTER TABLE statements run (all migrations skipped)
   - Verify no errors or warnings

3. **Idempotency test:**
   - Call `getConfig()` multiple times
   - Verify migrations only run once
   - Check `ensuredMigrations.size === 6` after first call

### Behavioral Validation

**Before refactor:**
- Migrations run exactly once per bot lifetime
- Each ensure function checks boolean flag
- Flags set to `true` after success

**After refactor:**
- Migrations run exactly once per bot lifetime (no change)
- Each ensure function checks Set membership
- Set contains migration name after success

**Equivalence:** Boolean flag check is functionally equivalent to Set membership check for this use case.

### Integration Test

Deploy to test environment and verify:
- Bot starts successfully
- `/setup` command works (uses `upsertConfig()`)
- `/config` command works (uses `getConfig()`)
- Guild configs load without errors
- No schema-related errors in logs

## Rollback Plan

### If Issues Arise

**Symptom:** Migrations not running, or running repeatedly

**Action:**
```bash
# Immediate rollback
git revert HEAD
npm run build
pm2 restart pawtropolis-bot
```

### Rollback Verification

After rollback:
1. Check logs for successful migration messages
2. Verify `getConfig()` returns valid data
3. Test `/setup` and `/config` commands
4. Confirm no runtime errors

### Root Cause Analysis

If rollback needed, investigate:

1. **Migration names mismatch:**
   - Check Set string values match exactly
   - Case sensitivity (`guild_config_*` not `Guild_Config_*`)

2. **Logic errors in Set operations:**
   - Verify `.has()` checks before `.add()`
   - Ensure `.add()` called after successful migration

3. **TypeScript compilation issues:**
   - Review build output for type errors
   - Check Set generic type `Set<string>` correct

### Emergency Patch

If critical and can't rollback immediately:

```typescript
// Temporarily force migration re-run
ensuredMigrations.clear(); // Clear set to allow re-checks
```

This is safe because migrations are idempotent (check column exists before ALTER TABLE).

## Success Criteria

- [ ] All 6 boolean flags removed from codebase
- [ ] Single `ensuredMigrations` Set added
- [ ] All 6 ensure functions updated to use Set
- [ ] TypeScript compiles without errors
- [ ] Bot starts successfully with clean database
- [ ] Bot starts successfully with existing database
- [ ] All migrations run exactly once per session
- [ ] `getConfig()` returns valid configuration data
- [ ] No schema-related errors in logs
- [ ] Code search finds no references to old flag variable names

## Timeline

**Total time:** 30-45 minutes

1. **Step 1:** Replace flags (5 min)
2. **Steps 2-7:** Update ensure functions (18 min)
3. **Step 8:** Add logging (5 min)
4. **Step 9:** Verify and test (10 min)
5. **Code review:** 15 min (optional)

This is a single-session refactor with immediate completion possible.

## Future Improvements

This refactor sets foundation for potential enhancements:

1. **Migration registry export:**
   ```typescript
   export function getAppliedMigrations(): readonly string[] {
     return Array.from(ensuredMigrations);
   }
   ```

2. **Startup validation logging:**
   ```typescript
   logger.info(
     { count: ensuredMigrations.size, migrations: Array.from(ensuredMigrations) },
     "[config] schema migrations complete"
   );
   ```

3. **Health check endpoint:**
   - Expose migration status via admin API
   - Useful for monitoring which migrations have run

4. **Formalized migration system:**
   - Eventually replace with proper migration runner
   - Track migrations in database table
   - Support rollbacks and version control
   - See: [Flyway](https://flywaydb.org/) or similar tools

## Notes

**Why not use a proper migration system?**

The comment in lines 69-72 already acknowledges this limitation:

> "These flags implement a poor man's migration system. Each ensure*Column function runs ALTER TABLE on first call, then sets its flag to skip subsequent calls. This approach is fragile (restart = re-check) but works for additive migrations. A proper migration runner would be cleaner but this is fine for small schema drift."

This refactor improves the existing pattern without the overhead of introducing a full migration framework. For a small bot with additive-only schema changes, this is sufficient. If the schema evolution becomes more complex (requiring data migrations, rollbacks, etc.), revisit migration tooling at that point.

**Memory overhead:**

The Set approach uses slightly more memory than boolean flags:
- 6 booleans: ~6 bytes
- Set<string> with 6 entries: ~180 bytes (30 bytes per string × 6)

This 174-byte increase is negligible in a Node.js application and worth the improved maintainability.

**Performance:**

Set membership checks (`has()`) are O(1) average case, identical to boolean checks. No performance difference in practice.
