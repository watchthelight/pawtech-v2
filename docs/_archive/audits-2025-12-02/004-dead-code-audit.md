# Dead Code & Unused Dependencies Audit Plan

**Audit Date:** 2025-12-02
**Priority:** Medium
**Estimated Scope:** ~30 files modified, 4 tables dropped

---

## Executive Summary

The codebase is relatively clean with zero unused npm dependencies. However, there are 60+ unused exports (many intentional API surfaces), 4 empty database tables, deprecated functions still exported, and directory structure inconsistencies.

---

## Database Cleanup

### 1. Drop Unused Tables

**Tables to drop (all have 0 rows and no code references):**

| Table | Purpose | Status |
|-------|---------|--------|
| `ping_log` | Legacy ping tracking | UNUSED |
| `dm_bridge` | Old DM bridging | Superseded by `modmail_bridge` |
| `suggestion` | Suggestion system | Never implemented |
| `suggestion_vote` | Suggestion voting | Never implemented |

**Create migration `migrations/XXX_drop_unused_tables.ts`:**
```typescript
import { db } from "../src/db/db.js";

export function migrate() {
  // Verify tables are empty before dropping
  const tables = ['ping_log', 'dm_bridge', 'suggestion', 'suggestion_vote'];

  for (const table of tables) {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    if (count.count > 0) {
      throw new Error(`Table ${table} has ${count.count} rows - aborting drop`);
    }
  }

  db.prepare('DROP TABLE IF EXISTS ping_log').run();
  db.prepare('DROP TABLE IF EXISTS dm_bridge').run();
  db.prepare('DROP TABLE IF EXISTS suggestion_vote').run();  // FK child first
  db.prepare('DROP TABLE IF EXISTS suggestion').run();
}
```

**Files to create:**
- `migrations/XXX_drop_unused_tables.ts`

---

### 2. Investigate Corrupted Table

**Issue:** `lost_and_found` table appears corrupted (shows btree internal pages).

**Actions:**
1. Run database integrity check:
   ```sql
   PRAGMA integrity_check;
   ```

2. If errors found, consider:
   - Restoring from backup
   - Rebuilding table if data exists
   - Dropping if empty/unused

**Files to check:**
- Grep codebase for `lost_and_found` references

---

## Deprecated Function Removal

### 3. Remove Deprecated Artist Rotation Functions

**File:** `src/features/artistRotation/constants.ts`

**Line 63 - Remove:**
```typescript
// @deprecated - Use getIgnoredArtistUsers(guildId) instead
export const IGNORED_ARTIST_USER_IDS: string[] = [];
```

**File:** `src/features/artistRotation/queue.ts`

**Lines 171-207 - Remove:**
```typescript
/**
 * @deprecated Use processAssignment() instead
 */
export function moveToEnd(guildId: string, userId: string): void {
  // ... implementation
}
```

**Actions:**
1. Verify no code references these deprecated exports
2. Remove the exports
3. Run tests

**Files to modify:**
- `src/features/artistRotation/constants.ts`
- `src/features/artistRotation/queue.ts`

---

## Unused Export Cleanup

### 4. Remove Genuinely Unused Functions

**These functions are exported but never imported anywhere:**

#### `src/lib/commandSync.ts:92`
```typescript
// DELETE: Only referenced in comments
export function syncGuildCommandsInProcess() { ... }
```

#### `src/lib/errors.ts:302, 309, 333`
```typescript
// DELETE: Helper functions that are never used
export function isInteractionExpired(error: unknown): boolean { ... }
export function isAlreadyAcknowledged(error: unknown): boolean { ... }
export function isDatabaseCorrupt(error: unknown): boolean { ... }
```

#### `src/lib/timefmt.ts:20, 49, 89`
```typescript
// DELETE: Unused time formatters
export function formatAbsolute(date: Date): string { ... }
export function formatAbsoluteUtc(date: Date): string { ... }
export function toIso(date: Date): string { ... }
```

#### `src/lib/percentiles.ts:17`
```typescript
// DELETE: Singular version unused (plural version IS used)
export function computePercentile(values: number[], percentile: number): number { ... }
```

#### `src/lib/pm2.ts:149`
```typescript
// DELETE: Never called
export function isPM2Available(): boolean { ... }
```

#### `src/lib/schedulerHealth.ts:130, 145, 155`
```typescript
// DELETE: Scheduler health monitoring not active
export function getSchedulerHealthByName(name: string): SchedulerHealth | undefined { ... }
export function resetSchedulerHealth(): void { ... }
export function _clearAllSchedulerHealth(): void { ... }
```

#### `src/lib/startupHealth.ts:176, 266, 323, 346`
```typescript
// DELETE: Health check dashboard not implemented
export function validateStartup(): StartupValidation { ... }
export function logStartupHealth(): void { ... }
export function tableExists(tableName: string): boolean { ... }
export function getSchemaInfo(): SchemaInfo { ... }
```

#### `src/lib/syncMarker.ts:57`
```typescript
// DELETE: Sync status check not used
export function getSyncMarker(guildId: string): SyncMarker | undefined { ... }
```

**Files to modify:**
- `src/lib/commandSync.ts`
- `src/lib/errors.ts`
- `src/lib/timefmt.ts`
- `src/lib/percentiles.ts`
- `src/lib/pm2.ts`
- `src/lib/schedulerHealth.ts`
- `src/lib/startupHealth.ts`
- `src/lib/syncMarker.ts`

---

### 5. Remove Unused Constants

**File:** `src/lib/constants.ts`

**Remove unused constants (lines 52-83):**
```typescript
// DELETE all of these:
export const DB_RECOVERY_OPERATION_DELAY_MS = 1000;
export const SLOW_EVENT_THRESHOLD_MS = 5000;
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const BANNER_SYNC_MIN_INTERVAL_MS = 60000;
// ... OAuth rate limit constants
```

**Verification:** Grep for each constant name to confirm no usage.

**Files to modify:**
- `src/lib/constants.ts`

---

### 6. Remove Unused Store Functions

**File:** `src/store/auditSessionStore.ts:107, 192`
```typescript
// DELETE: Never used
export function isUserScanned(sessionId: string, userId: string): boolean { ... }
export function getScannedCount(sessionId: string): number { ... }
```

**File:** `src/store/nsfwFlagsStore.ts:66, 83, 98`
```typescript
// DELETE: NSFW moderation UI not built
export function isNsfwFlagged(guildId: string, userId: string): boolean { ... }
export function getNsfwFlagCount(guildId: string): number { ... }
export function getPendingNsfwFlags(guildId: string): NsfwFlagRow[] { ... }
```

**Files to modify:**
- `src/store/auditSessionStore.ts`
- `src/store/nsfwFlagsStore.ts`

---

### 7. Remove Unused Feature Functions

**File:** `src/features/modPerformance.ts:441, 458`
```typescript
// DELETE: Replaced by cached versions
export function getModeratorMetrics(...): ModeratorMetrics { ... }
export function getTopModerators(...): TopModerator[] { ... }
```

**File:** `src/features/roleAutomation.ts:457, 474`
```typescript
// DELETE: Analytics dashboard not built
export function getAssignmentHistory(...): AssignmentHistory[] { ... }
export function getRecentAssignments(...): RecentAssignment[] { ... }
```

**File:** `src/features/notifyConfig.ts:186`
```typescript
// DELETE: Multi-guild admin feature not built
export function getConfiguredGuilds(): string[] { ... }
```

**Files to modify:**
- `src/features/modPerformance.ts`
- `src/features/roleAutomation.ts`
- `src/features/notifyConfig.ts`

---

### 8. Remove Unused Audit Helpers

**File:** `src/lib/auditHelper.ts:46, 95`
```typescript
// DELETE: Defensive wrappers never integrated
export function safeAuditLog(...): Promise<void> { ... }
export function safeAuditLogWithRetry(...): Promise<void> { ... }
```

**File:** `src/lib/modalPatterns.ts:55, 56`
```typescript
// DELETE: Audit button patterns not wired up
export const BTN_AUDIT_MEMBERS_RE = /^audit_members_/;
export const BTN_AUDIT_NSFW_RE = /^audit_nsfw_/;
```

**Files to modify:**
- `src/lib/auditHelper.ts`
- `src/lib/modalPatterns.ts`

---

## Directory Cleanup

### 9. Remove Duplicate util/ Directory

**Problem:** Both `/src/util/` and `/src/utils/` exist.

**`src/util/` contents:**
- `ensureEnv.ts` - Duplicates functionality in `src/lib/env.ts`

**Actions:**
1. Update imports in `src/index.ts`:
   ```typescript
   // FROM:
   import { ensureEnv } from "./util/ensureEnv.js";
   // TO:
   import { env } from "./lib/env.js";
   ```

2. Delete `src/util/` directory entirely

**Files to modify:**
- `src/index.ts`
- Delete `src/util/ensureEnv.ts`
- Delete `src/util/` directory

---

### 10. Remove Unused Type Exports

**File:** `src/commands/gate/shared.ts:52`
```typescript
// DELETE: Unused type alias
export type { GuildMember };
```

**File:** `src/commands/modstats/helpers.ts:22`
```typescript
// DELETE: Constant never referenced
export const DECISION_ACTIONS = ['approve', 'reject', 'perm_reject', 'kick'];
```

**File:** `src/utils/typeGuards.ts:42`
```typescript
// DELETE: Never used
export function requireGuildMember(interaction: ChatInputCommandInteraction): GuildMember | null { ... }
```

**Files to modify:**
- `src/commands/gate/shared.ts`
- `src/commands/modstats/helpers.ts`
- `src/utils/typeGuards.ts`

---

## Questionable Items (Require Clarification)

### 11. Cache Invalidation Function

**File:** `src/commands/listopen.ts:280`
```typescript
export function invalidateDraftsCache(guildId: string): void { ... }
```

**Question:** This is never called. Is this a bug (should be called when drafts change) or intentional (cache meant to be stale)?

**Action:** Ask before removing. If bug, integrate into draft modification flows.

---

### 12. Unused Metrics Functions

**File:** `src/features/metricsEpoch.ts:158`
```typescript
export function clearMetricsEpoch(): void { ... }
```

**Question:** Is this for admin/testing purposes?

**Action:** Keep if useful for manual operations, otherwise remove.

---

### 13. Leaderboard Image Generation

**File:** `src/lib/leaderboardImage.ts:428`
```typescript
export function generateStatsImage(...): Buffer { ... }
```

**Question:** Was this replaced by `generateLeaderboardImage()`?

**Action:** Verify no usage, then remove.

---

## Console.log Cleanup

### 14. Replace console.log with Logger

**Found 95 console.log/error/warn statements outside of logger.**

**Approach:**
1. Many in `lib/env.ts` are intentional (runs before logger init) - KEEP
2. Error handling in `index.ts` - Review and update
3. Debug logs in features - Replace with `logger.debug()`

**Files to audit:**
- Search: `console.log|console.error|console.warn`
- Exclude: `lib/logger.ts`, comments

---

## Verification Steps

For each removal:

1. **Grep for usage:**
   ```bash
   grep -r "functionName" src/
   ```

2. **Check for dynamic imports:**
   ```bash
   grep -r "import\(" src/
   ```

3. **Run tests:**
   ```bash
   npm run test
   ```

4. **Run type check:**
   ```bash
   npm run typecheck
   ```

5. **Build:**
   ```bash
   npm run build
   ```

---

## Estimated Impact

- **Database tables dropped:** 4
- **Functions removed:** ~40
- **Constants removed:** ~15
- **Files modified:** ~30
- **Files deleted:** 1 directory
- **Lines removed:** ~800
- **Risk level:** Low (all removals are provably unused)

---

## Recommended Order

1. **Phase 1:** Drop unused database tables (safe, high visibility)
2. **Phase 2:** Remove deprecated functions with replacements
3. **Phase 3:** Remove unused lib/ functions
4. **Phase 4:** Remove unused store/feature functions
5. **Phase 5:** Directory cleanup (util/ → utils/)
6. **Phase 6:** Console.log cleanup (lowest priority)
