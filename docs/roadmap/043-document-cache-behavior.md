# Issue #43: Config Cache Invalidation Gap

**Status:** Completed
**Priority:** Low
**Estimated Effort:** 30 minutes (documentation) OR 2 hours (versioning implementation)
**Created:** 2025-11-30

## Summary

The `config.ts` module uses TTL-based caching with a 5-minute expiration window. During concurrent config updates, a thread could read stale data from cache while another thread is updating the database. This is inherent to TTL-based caching and may be acceptable for guild configuration, or may require versioning/optimistic locking.

## Current State

### Problem

**Location:** `src/lib/config.ts:252-254, 348, 366`

The config cache uses a simple TTL-based invalidation strategy:

```typescript
// Line 66-67: Cache definition
const configCache = new Map<string, { config: GuildConfig; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Line 252-254: Cache invalidation
function invalidateCache(guildId: string) {
  configCache.delete(guildId);
}

// Line 348: Invalidation after update
export function upsertConfig(guildId: string, partial: Partial<Omit<GuildConfig, "guild_id">>) {
  // ... database writes at lines 274-346 ...
  invalidateCache(guildId);
  touchSyncMarker("config_upsert");
}

// Line 366: TTL-based cache read
export function getConfig(guildId: string): GuildConfig | undefined {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.config;
  }
  // ... read from database and repopulate cache ...
}
```

**Race Condition Scenario:**

```
Time  Thread A (Writer)              Thread B (Reader)
----  --------------------------     ---------------------------
T0    upsertConfig() called
T1    DB write starts
T2                                   getConfig() called
T3                                   Cache hit! Returns OLD data
T4    DB write completes
T5    invalidateCache() called
T6                                   (B is already using stale data)
```

**Issues:**

1. **Concurrent read gap:** Between when `upsertConfig()` writes to DB (line 346) and calls `invalidateCache()` (line 348), another thread can call `getConfig()` and get a cache hit with stale data
2. **TTL expiration window:** Even after invalidation, if `getConfig()` repopulates the cache just before an update, stale data can be served for up to 5 minutes
3. **No write coordination:** Multiple concurrent `upsertConfig()` calls have no synchronization mechanism
4. **Cache-DB consistency gap:** The cache doesn't track database version/timestamp, so there's no way to detect stale entries

### Current Behavior

**Cache invalidation is CORRECT** - it happens AFTER successful database writes (line 348), which means:
- Failed writes don't invalidate the cache (good)
- Successful writes always invalidate the cache (good)
- Pattern matches `flaggerStore.ts` and `loggingStore.ts` after Issue #14 fix (good)

**The problem is TTL-based caching itself**, not the invalidation order.

### Risk Assessment

**Severity:** Low-Medium
- Guild configuration changes are infrequent (typically one-time setup)
- Stale data window is bounded by 5-minute TTL
- Most config changes are non-critical (channel IDs, role IDs)
- Critical fields (like mod_role_ids) rarely change after initial setup

**Impact:**
- Commands might use outdated channel/role IDs for up to 5 minutes
- Concurrent config changes could result in "last write wins" behavior
- No data corruption risk (SQLite handles concurrent writes)
- User confusion if config changes don't take effect immediately

**Likelihood:** Very Low
- Guild config is typically set once during bot setup
- Concurrent updates require multiple admins changing config simultaneously
- 5-minute cache window means most reads happen well after writes complete
- Single-threaded Node.js reduces actual concurrency

## Proposed Changes

### Option A: Document Current Behavior (Recommended)

**Goal:** Acknowledge that the current TTL-based cache is acceptable for guild configuration use case

**Rationale:**
1. **Low update frequency:** Guild config changes are rare (typically during initial setup)
2. **Non-critical data:** Most config fields are convenience settings, not security-critical
3. **Bounded staleness:** 5-minute TTL limits how long stale data can exist
4. **Implementation complexity:** Versioning or locking adds significant complexity for minimal benefit
5. **Single-node deployment:** Bot runs as single Node.js process, reducing actual concurrency

**Implementation:**

Add documentation to `src/lib/config.ts` explaining the cache behavior:

```typescript
// Simple in-memory cache with TTL. Map is fine here - we're not dealing with
// thousands of guilds, and the cache naturally clears on bot restart.
// If memory becomes an issue, switch to LRU with bounded size.
//
// CACHE CONSISTENCY NOTES:
// - TTL-based invalidation means stale data can be served during concurrent updates
// - Maximum staleness window: CACHE_TTL_MS (5 minutes)
// - This is ACCEPTABLE for guild config because:
//   * Updates are infrequent (typically one-time setup)
//   * Config fields are non-critical convenience settings
//   * SQLite handles concurrent writes (no data corruption)
//   * Single-node deployment reduces actual concurrency
// - If you need stronger consistency, see Option B in docs/roadmap/043-document-cache-behavior.md
const configCache = new Map<string, { config: GuildConfig; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - short enough to pick up config changes reasonably fast
```

**Files affected:**
- `src/lib/config.ts` - Add cache consistency documentation (lines 63-68)
- `docs/roadmap/043-document-cache-behavior.md` - This document

**Effort:** 15 minutes

### Option B: Implement Version-Based Cache Invalidation

**Goal:** Add optimistic locking to detect and prevent stale cache reads

**Rationale:**
- Provides stronger consistency guarantees
- Detects concurrent updates and forces cache refresh
- Aligns with best practices for cached data stores

**Implementation:**

1. **Add version column to guild_config table**
   ```sql
   ALTER TABLE guild_config ADD COLUMN config_version INTEGER DEFAULT 1;
   ```

2. **Update cache structure to include version**
   ```typescript
   const configCache = new Map<string, {
     config: GuildConfig;
     timestamp: number;
     version: number; // Track database version
   }>();
   ```

3. **Modify upsertConfig to increment version**
   ```typescript
   export function upsertConfig(guildId: string, partial: Partial<Omit<GuildConfig, "guild_id">>) {
     // ... existing code ...

     if (!existing) {
       db.prepare(`INSERT INTO guild_config (..., config_version) VALUES (..., 1)`).run(...);
     } else {
       // Increment version on every update
       db.prepare(`UPDATE guild_config SET ${sets}, config_version = config_version + 1 WHERE guild_id = ?`)
         .run(...vals, guildId);
     }

     invalidateCache(guildId);
   }
   ```

4. **Modify getConfig to validate version**
   ```typescript
   export function getConfig(guildId: string): GuildConfig | undefined {
     const cached = configCache.get(guildId);

     if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
       // Verify cache version matches database version
       const currentVersion = db.prepare(
         "SELECT config_version FROM guild_config WHERE guild_id = ?"
       ).get(guildId) as { config_version: number } | undefined;

       if (currentVersion && currentVersion.config_version === cached.version) {
         return cached.config; // Cache is fresh
       }
       // Version mismatch - cache is stale, fall through to refresh
     }

     const config = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
     if (config) {
       const fullConfig = buildFullConfig(config);
       configCache.set(guildId, {
         config: fullConfig,
         timestamp: Date.now(),
         version: config.config_version || 1
       });
       return fullConfig;
     }
     return undefined;
   }
   ```

**Files affected:**
- `src/db/migrations/XXX-add-config-version.sql` - Add version column migration
- `src/lib/config.ts` - Update cache structure and read/write logic
- `tests/lib/config.test.ts` - Add version-based cache tests

**Effort:** 2 hours

**Tradeoffs:**
- Adds database query on every cache hit (version check)
- Increases database schema complexity
- Overkill for infrequent config updates
- Better suited for high-frequency cached data

### Recommendation

**Use Option A (Documentation)** unless guild config updates become frequent or cache consistency issues are observed in production.

**Switch to Option B** if:
- Multiple admins frequently update config concurrently
- Cache staleness causes user-visible issues
- Config fields become security-critical (e.g., permission checks)

## Files Affected

### Option A (Documentation)
- `src/lib/config.ts` - Add cache behavior documentation (lines 63-68)

### Option B (Versioning)
- `src/db/migrations/XXX-add-config-version.sql` - New migration
- `src/lib/config.ts` - Update cache structure and logic (lines 66-67, 252-254, 348, 366-387)
- `tests/lib/config.test.ts` - Add version validation tests

## Testing Strategy

### Option A Testing (Documentation Only)

No code changes, so no testing required. Documentation review only.

**Review checklist:**
- [ ] Cache behavior is accurately documented
- [ ] Tradeoffs are clearly explained
- [ ] Migration path to Option B is documented if needed

### Option B Testing (Versioning Implementation)

#### Unit Tests

Create `tests/lib/config.version.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { upsertConfig, getConfig } from "../../src/lib/config.js";
import { db } from "../../src/db/db.js";

describe("config cache version tracking", () => {
  const testGuildId = "test-guild-123";

  beforeEach(() => {
    db.prepare("DELETE FROM guild_config WHERE guild_id = ?").run(testGuildId);
  });

  it("should increment version on each update", () => {
    upsertConfig(testGuildId, { gate_channel_id: "channel-1" });
    const v1 = db.prepare("SELECT config_version FROM guild_config WHERE guild_id = ?")
      .get(testGuildId) as { config_version: number };
    expect(v1.config_version).toBe(1);

    upsertConfig(testGuildId, { gate_channel_id: "channel-2" });
    const v2 = db.prepare("SELECT config_version FROM guild_config WHERE guild_id = ?")
      .get(testGuildId) as { config_version: number };
    expect(v2.config_version).toBe(2);
  });

  it("should invalidate cache when version changes", () => {
    // Initial write
    upsertConfig(testGuildId, { gate_channel_id: "channel-1" });
    const config1 = getConfig(testGuildId); // Populates cache
    expect(config1?.gate_channel_id).toBe("channel-1");

    // Concurrent update (simulated by direct DB write)
    db.prepare(`UPDATE guild_config SET gate_channel_id = ?, config_version = config_version + 1 WHERE guild_id = ?`)
      .run("channel-2", testGuildId);

    // Cache read should detect version mismatch and refresh
    const config2 = getConfig(testGuildId);
    expect(config2?.gate_channel_id).toBe("channel-2"); // Fresh data, not cached
  });

  it("should serve cached data when version matches", () => {
    upsertConfig(testGuildId, { gate_channel_id: "channel-1" });
    const config1 = getConfig(testGuildId); // Populates cache

    // Second read should use cache (no DB query)
    const config2 = getConfig(testGuildId);
    expect(config2).toBe(config1); // Same object reference (cached)
  });
});
```

#### Integration Testing

1. **Concurrent update scenario**
   ```typescript
   // Simulate concurrent admins updating different config fields
   await Promise.all([
     upsertConfig(guildId, { gate_channel_id: "channel-1" }),
     upsertConfig(guildId, { review_channel_id: "channel-2" })
   ]);

   // Verify final state is consistent (last write wins)
   const config = getConfig(guildId);
   expect(config.config_version).toBeGreaterThanOrEqual(2);
   ```

2. **Cache invalidation timing**
   ```typescript
   // Write to DB
   upsertConfig(guildId, { gate_channel_id: "channel-1" });

   // Immediately read - should get fresh data
   const config = getConfig(guildId);
   expect(config.gate_channel_id).toBe("channel-1");

   // Verify version was set correctly
   const dbConfig = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
   expect(dbConfig.config_version).toBe(1);
   ```

#### Manual Testing

```bash
# Start bot
npm run dev

# In Discord:
# Admin A: /config set gate channel:#gate-1
# Admin B: /config set review channel:#review-1
# Admin A: /config get
# Verify: Should show latest values, not cached stale data

# Check database version:
sqlite3 pawtropolis.db "SELECT guild_id, config_version FROM guild_config;"

# Verify version increments on each update
```

## Rollback Plan

### Option A (Documentation)

No code changes, so no rollback needed. Simply update or remove documentation if inaccurate.

### Option B (Versioning)

#### If Version Checks Cause Performance Issues

**Symptom:** Increased database load, slower config reads

**Action:**
```bash
# Rollback code changes
git revert HEAD
npm run build
pm2 restart pawtropolis-bot

# Keep migration (config_version column is harmless)
# Or rollback migration if needed:
sqlite3 pawtropolis.db "ALTER TABLE guild_config DROP COLUMN config_version;"
```

**Validation:**
- Monitor `getConfig()` call latency
- Check cache hit rate (should be >90% for typical usage)
- Verify no database connection pool exhaustion

#### If Version Increment Logic Has Bugs

**Symptom:** Version numbers not incrementing, or incrementing incorrectly

**Action:**
1. Check logs for database errors:
   ```bash
   grep "config_version" logs/app.log | grep ERROR
   ```

2. Verify version column exists:
   ```bash
   sqlite3 pawtropolis.db "PRAGMA table_info(guild_config);" | grep config_version
   ```

3. Reset versions if corrupted:
   ```bash
   sqlite3 pawtropolis.db "UPDATE guild_config SET config_version = 1;"
   ```

4. If issues persist, rollback to Option A (TTL-based caching)

### Emergency Cache Clear

If cache becomes corrupted regardless of approach:

```bash
# Restart bot to clear in-memory cache
pm2 restart pawtropolis-bot

# Or add admin command to force cache clear:
# /admin cache clear config [guild_id]
```

## Success Criteria

### Option A (Documentation)
- [ ] Cache behavior is documented with examples
- [ ] Consistency tradeoffs are explained
- [ ] Migration path to Option B is clear
- [ ] Comments are accurate and helpful

### Option B (Versioning)
- [ ] `config_version` column added to `guild_config` table
- [ ] Version increments on every `upsertConfig()` call
- [ ] `getConfig()` validates cache version before serving cached data
- [ ] Stale cache entries are automatically refreshed
- [ ] All unit tests pass
- [ ] Integration tests confirm concurrent update handling
- [ ] No performance regression (cache still improves read latency)
- [ ] Manual testing confirms config updates take effect immediately

## Additional Notes

### Why TTL-Based Caching Works Here

1. **Infrequent updates:** Guild config is typically set once during bot setup, rarely changed
2. **Non-critical data:** Channel IDs and role IDs are convenience settings, not security boundaries
3. **Bounded staleness:** 5-minute TTL ensures stale data expires quickly
4. **Single-node:** Bot runs as single Node.js process, so "concurrent" reads/writes are actually interleaved, not truly parallel
5. **SQLite ACID:** Database handles concurrent writes safely, no risk of data corruption

### When to Upgrade to Option B

Consider implementing versioning if:
1. Multiple admins frequently update config concurrently (>10 updates/hour)
2. Cache staleness causes user-visible bugs in production
3. Config fields become security-critical (e.g., permission checks depend on fresh data)
4. Bot scales to multiple processes/nodes (requires shared cache coordination)

### Related Issues

- Issue #14: Fixed cache invalidation order in `loggingStore.ts`
- `flaggerStore.ts`: Uses same TTL-based pattern (also acceptable)
- Other stores: Audit for similar race conditions if high-frequency updates exist

### Future Improvements

If implementing Option B, consider adding:
1. **Cache monitoring:** Log cache hit/miss rates and version mismatches
2. **Metrics:** Track `getConfig()` latency and version check overhead
3. **Admin tooling:** Add `/admin cache stats` command to inspect cache state
4. **Optimistic locking:** Return error if concurrent update detected (instead of last-write-wins)
