# Roadmap: Move Schema Checks to Startup (Issue #30)

**Status:** Planning
**Priority:** Medium (Performance Optimization)
**Complexity:** Low
**Estimated Effort:** 1-2 hours

## Issue Summary

Six `ensure*Column()` functions are called on every `getConfig()` read operation in `/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`. This causes unnecessary schema checks on every config read, impacting performance.

**Current behavior:** Schema validation runs on every call to `getConfig()` and `upsertConfig()`
**Expected behavior:** Schema validation should run once at bot startup

## Current State

### Problem Code Location
**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`
**Lines:** 359-364 (in `getConfig()`) and 266-271 (in `upsertConfig()`)

```typescript
export function getConfig(guildId: string): GuildConfig | undefined {
  // These run on EVERY config read:
  ensureUnverifiedChannelColumn();
  ensureWelcomeTemplateColumn();
  ensureWelcomeChannelsColumns();
  ensureModRolesColumns();
  ensureDadModeColumns();
  ensureListopenPublicOutputColumn();
  // ...
}
```

### Why This Is A Problem

1. **Performance Impact:** Schema checks run on every config read across all commands and features
2. **Unnecessary I/O:** PRAGMA queries execute repeatedly even though schema rarely changes
3. **Code Smell:** Migration logic mixed with runtime logic
4. **Inconsistent Pattern:** Other ensure functions (e.g., `ensureAvatarScanSchema`, `ensureManualFlagColumns`) are called once at startup

### Current Ensure Functions

All six functions follow the same pattern:
- Module-level boolean flag (e.g., `welcomeTemplateEnsured = false`)
- Early return if flag is true
- Check if table exists
- Use `PRAGMA table_info(guild_config)` to check for columns
- Run `ALTER TABLE` if columns missing
- Set flag to true

## Proposed Changes

### Step 1: Export Ensure Functions

**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`

Make all six ensure functions exportable by adding `export` keyword:

```typescript
export function ensureUnverifiedChannelColumn() { /* ... */ }
export function ensureWelcomeTemplateColumn() { /* ... */ }
export function ensureWelcomeChannelsColumns() { /* ... */ }
export function ensureModRolesColumns() { /* ... */ }
export function ensureDadModeColumns() { /* ... */ }
export function ensureListopenPublicOutputColumn() { /* ... */ }
```

**Lines to modify:** 79, 102, 126, 149, 185, 221

### Step 2: Add Startup Initialization

**File:** `/Users/bash/Documents/pawtropolis-tech/src/index.ts`

Add the six ensure functions to the startup schema initialization block (after line 271):

```typescript
client.once(Events.ClientReady, async () => {
  try {
    const {
      ensureAvatarScanSchema,
      ensureApplicationPermaRejectColumn,
      // ... existing imports ...
      ensureApplicationStaleAlertColumns,
    } = await import("./db/ensure.js");
    const { ensureBotStatusSchema } = await import("./features/statusStore.js");
    const { ensureSuggestionSchema, ensureSuggestionConfigColumns } = await import("./features/suggestions/store.js");

    // ADD: Import config ensure functions
    const {
      ensureUnverifiedChannelColumn,
      ensureWelcomeTemplateColumn,
      ensureWelcomeChannelsColumns,
      ensureModRolesColumns,
      ensureDadModeColumns,
      ensureListopenPublicOutputColumn,
    } = await import("./lib/config.js");

    ensureAvatarScanSchema();
    // ... existing ensure calls ...
    ensureSuggestionConfigColumns();

    // ADD: Call config ensure functions
    ensureUnverifiedChannelColumn();
    ensureWelcomeTemplateColumn();
    ensureWelcomeChannelsColumns();
    ensureModRolesColumns();
    ensureDadModeColumns();
    ensureListopenPublicOutputColumn();
  } catch (err) {
    logger.error({ err }, "[startup] schema ensure failed");
  }
  // ...
});
```

**Lines to modify:** ~271 (add import), ~285 (add calls)

### Step 3: Remove Runtime Schema Checks

**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`

Remove the six ensure function calls from both `getConfig()` and `upsertConfig()`:

**From `upsertConfig()` (lines 266-271):**
```typescript
export function upsertConfig(guildId: string, partial: Partial<Omit<GuildConfig, "guild_id">>) {
  // DELETE: Remove these six lines
  // ensureUnverifiedChannelColumn();
  // ensureWelcomeTemplateColumn();
  // ensureWelcomeChannelsColumns();
  // ensureModRolesColumns();
  // ensureDadModeColumns();
  // ensureListopenPublicOutputColumn();

  const existing = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
  // ...
}
```

**From `getConfig()` (lines 359-364):**
```typescript
export function getConfig(guildId: string): GuildConfig | undefined {
  // DELETE: Remove these six lines
  // ensureUnverifiedChannelColumn();
  // ensureWelcomeTemplateColumn();
  // ensureWelcomeChannelsColumns();
  // ensureModRolesColumns();
  // ensureDadModeColumns();
  // ensureListopenPublicOutputColumn();

  const cached = configCache.get(guildId);
  // ...
}
```

## Files Affected

1. `/Users/bash/Documents/pawtropolis-tech/src/lib/config.ts`
   - Export 6 ensure functions (add `export` keyword)
   - Remove 6 function calls from `upsertConfig()` (lines 266-271)
   - Remove 6 function calls from `getConfig()` (lines 359-364)

2. `/Users/bash/Documents/pawtropolis-tech/src/index.ts`
   - Import 6 ensure functions from `./lib/config.js` (after line 271)
   - Call 6 ensure functions in startup block (after line 285)

**Total changes:** 2 files, ~12 lines removed, ~12 lines added

## Testing Strategy

### Pre-deployment Testing

1. **Fresh Database Test**
   - Delete `pawtropolis.db`
   - Start bot
   - Verify all 6 columns are created on first run
   - Check logs for `[ensure] adding *_column` messages

2. **Existing Database Test**
   - Use existing database with all columns present
   - Start bot
   - Verify no duplicate ALTER TABLE attempts
   - Verify `getConfig()` works correctly

3. **Missing Column Test**
   - Manually drop one column: `ALTER TABLE guild_config DROP COLUMN welcome_template`
   - Start bot
   - Verify column is re-added at startup
   - Verify subsequent `getConfig()` calls work

4. **Performance Test**
   - Add debug timing around `getConfig()` calls
   - Measure before/after with 100 sequential calls
   - Expected improvement: ~6 PRAGMA queries eliminated per call

### Post-deployment Monitoring

1. **Startup Logs**
   - Monitor `[startup] schema ensure failed` errors
   - Verify `[ensure] adding *_column` logs only appear on first run or after column drops

2. **Runtime Errors**
   - Monitor for `SQLITE_ERROR: no such column` errors
   - These would indicate schema checks aren't running at startup

3. **Performance Metrics**
   - Monitor bot startup time (should not increase significantly)
   - Monitor command response times (should improve slightly)

## Rollback Plan

### Immediate Rollback (if startup fails)

**Option A: Git Revert**
```bash
git revert <commit-hash>
git push
```

**Option B: Manual Revert**

1. Restore `src/lib/config.ts`:
   - Remove `export` from the 6 ensure functions
   - Re-add the 6 function calls to `upsertConfig()` at line 266
   - Re-add the 6 function calls to `getConfig()` at line 359

2. Restore `src/index.ts`:
   - Remove the import of config ensure functions
   - Remove the 6 function calls from startup block

### Partial Rollback (if runtime issues occur)

If only specific columns are problematic, temporarily re-add specific ensure calls to `getConfig()`:

```typescript
export function getConfig(guildId: string): GuildConfig | undefined {
  ensureProblematicColumn(); // Add back only the problematic one
  const cached = configCache.get(guildId);
  // ...
}
```

## Success Criteria

1. Bot starts successfully with no schema errors
2. All 6 columns are present in `guild_config` table after startup
3. `getConfig()` executes without running PRAGMA queries
4. No `SQLITE_ERROR: no such column` errors in production
5. Command response times remain stable or improve

## References

- **Related Pattern:** `/Users/bash/Documents/pawtropolis-tech/src/features/suggestions/store.ts:118` - `ensureSuggestionConfigColumns()` follows similar pattern but is still called at runtime (lines 416, 430)
- **Startup Schema Block:** `/Users/bash/Documents/pawtropolis-tech/src/index.ts:254-288`
- **Other Ensure Functions:** `/Users/bash/Documents/pawtropolis-tech/src/db/ensure.ts` - All properly called at startup only

## Notes

- This change aligns with the existing pattern used by `ensureAvatarScanSchema()`, `ensureManualFlagColumns()`, etc.
- The boolean flags (`welcomeTemplateEnsured`, etc.) remain effective since they prevent re-running even if functions are called multiple times at startup
- This is a pure performance optimization - no functional changes to behavior
- After this change, consider addressing similar pattern in suggestions store (functions at lines 416, 430 still call ensure at runtime)
