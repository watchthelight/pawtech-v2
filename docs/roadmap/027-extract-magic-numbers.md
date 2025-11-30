# Issue #27: Extract Magic Numbers to Named Constants

## Summary

The codebase contains magic numbers scattered throughout various files without named constants, reducing code readability and maintainability. While many files already use named constants (PAGE_SIZE, CACHE_TTL_MS, BULK_DELETE_LIMIT), some timeout values, delays, and Discord API limits remain hardcoded inline.

**Priority:** Medium (Code Quality)
**Type:** Refactoring
**Affected Area:** Multiple files (commands, events, lib utilities)

## Current State

### Problem Examples

**Timeout/Delay Values:**
- `src/commands/sync.ts:64` - `setTimeout(resolve, 650)` - Rate limit buffer for Discord command sync
- `src/lib/commandSync.ts:147` - `setTimeout(resolve, 650)` - Same delay, duplicated
- `src/events/forumPostNotify.ts:47` - `setTimeout(resolve, 2000)` - Retry delay for missing starter message
- `src/commands/health.ts:89` - `setTimeout(..., 5000)` - Health check timeout
- `src/commands/purge.ts:213` - `setTimeout(resolve, 1500)` - Individual delete batch delay
- `src/commands/purge.ts:225` - `setTimeout(resolve, 1000)` - Bulk delete iteration delay
- `src/index.ts:69` - `setTimeout(..., 1000)` - Uncaught exception exit delay
- `src/ops/dbRecoverCli.ts:243` - `setTimeout(resolve, 5000)` - Recovery operation delay

**Discord API Limits:**
- `src/listeners/messageDadMode.ts:66` - `Math.max(2, Math.min(100000, ...))` - Odds range bounds
- `src/store/flagsStore.ts:102` - `.slice(0, 512)` - Reason field truncation
- `src/lib/eventWrap.ts:124` - `if (durationMs > 5000)` - Slow event threshold
- `src/commands/purge.ts:159` - `Date.now() - 14 * 24 * 60 * 60 * 1000` - Discord 14-day bulk delete limit

**Time Conversions:**
- `src/lib/time.ts:28` - `Date.now() / 1000` - Unix timestamp conversions (multiple occurrences)
- `src/lib/time.ts:40` - `* 1000` - Millisecond conversions
- `src/lib/leaderboardImage.ts:192-195` - Time unit conversions (60, 3600)

### What's Already Good

The codebase demonstrates good practices in many places:
- `src/config/loggingStore.ts:28` - `CACHE_TTL_MS = 60 * 1000`
- `src/commands/purge.ts:33` - `BULK_DELETE_LIMIT = 100`
- `src/lib/eventWrap.ts:28` - `DEFAULT_EVENT_TIMEOUT_MS`
- `src/commands/flag.ts:25` - `FLAG_RATE_LIMIT_MS = 2000`
- `src/features/bannerSync.ts:33` - `MIN_UPDATE_INTERVAL_MS = 10 * 60 * 1000`

## Proposed Changes

### Step 1: Create Constants Module (New File)

Create `/Users/bash/Documents/pawtropolis-tech/src/lib/constants.ts`:

```typescript
/**
 * Pawtropolis Tech — src/lib/constants.ts
 * WHAT: Centralized application constants for timeouts, delays, and limits
 * WHY: Single source of truth for magic numbers, improves maintainability
 */

// ===== Discord API Rate Limits & Constraints =====

/** Discord bulk delete only works for messages < 14 days old */
export const DISCORD_BULK_DELETE_AGE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

/** Discord command sync rate limit buffer (keeps us under 2 req/sec) */
export const DISCORD_COMMAND_SYNC_DELAY_MS = 650;

/** Maximum reason length for flag entries */
export const FLAG_REASON_MAX_LENGTH = 512;

/** Dadmode odds range bounds (min, max) */
export const DADMODE_ODDS_MIN = 2;
export const DADMODE_ODDS_MAX = 100000;

// ===== Timeouts & Delays =====

/** Health check timeout before aborting */
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Retry delay when Discord API returns "Unknown Message" (10008) */
export const DISCORD_RETRY_DELAY_MS = 2000;

/** Delay between individual message deletes to avoid rate limits */
export const MESSAGE_DELETE_BATCH_DELAY_MS = 1500;

/** Delay between bulk delete iterations */
export const BULK_DELETE_ITERATION_DELAY_MS = 1000;

/** Grace period before exit on uncaught exception (for Sentry flush) */
export const UNCAUGHT_EXCEPTION_EXIT_DELAY_MS = 1000;

/** Database recovery operation delay */
export const DB_RECOVERY_OPERATION_DELAY_MS = 5000;

/** Slow event warning threshold */
export const SLOW_EVENT_THRESHOLD_MS = 5000;

// ===== Time Unit Conversions =====

/** Milliseconds per second */
export const MS_PER_SECOND = 1000;

/** Seconds per minute */
export const SECONDS_PER_MINUTE = 60;

/** Seconds per hour */
export const SECONDS_PER_HOUR = 3600;
```

### Step 2: Update Command Sync Files

**Files:** `src/commands/sync.ts`, `src/lib/commandSync.ts`

```typescript
// Add import
import { DISCORD_COMMAND_SYNC_DELAY_MS } from "../lib/constants.js";

// Replace:
await new Promise((resolve) => setTimeout(resolve, 650));

// With:
await new Promise((resolve) => setTimeout(resolve, DISCORD_COMMAND_SYNC_DELAY_MS));
```

### Step 3: Update Event Handlers

**File:** `src/events/forumPostNotify.ts`

```typescript
import { DISCORD_RETRY_DELAY_MS } from "../lib/constants.js";

// Replace line 47:
await new Promise((resolve) => setTimeout(resolve, DISCORD_RETRY_DELAY_MS));
```

### Step 4: Update Health Check

**File:** `src/commands/health.ts`

```typescript
import { HEALTH_CHECK_TIMEOUT_MS } from "../lib/constants.js";

// Replace line 89:
setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS);
```

### Step 5: Update Purge Command

**File:** `src/commands/purge.ts`

```typescript
import {
  DISCORD_BULK_DELETE_AGE_LIMIT_MS,
  MESSAGE_DELETE_BATCH_DELAY_MS,
  BULK_DELETE_ITERATION_DELAY_MS
} from "../lib/constants.js";

// Replace line 159:
const twoWeeksAgo = Date.now() - DISCORD_BULK_DELETE_AGE_LIMIT_MS;

// Replace line 213:
await new Promise((resolve) => setTimeout(resolve, MESSAGE_DELETE_BATCH_DELAY_MS));

// Replace line 225:
await new Promise((resolve) => setTimeout(resolve, BULK_DELETE_ITERATION_DELAY_MS));
```

### Step 6: Update Index (Main Entry)

**File:** `src/index.ts`

```typescript
import { UNCAUGHT_EXCEPTION_EXIT_DELAY_MS } from "./lib/constants.js";

// Replace line 69:
setTimeout(() => process.exit(1), UNCAUGHT_EXCEPTION_EXIT_DELAY_MS);
```

### Step 7: Update Event Wrapper

**File:** `src/lib/eventWrap.ts`

```typescript
import { SLOW_EVENT_THRESHOLD_MS } from "./constants.js";

// Replace line 124:
if (durationMs > SLOW_EVENT_THRESHOLD_MS) {
```

### Step 8: Update Dad Mode Listener

**File:** `src/listeners/messageDadMode.ts`

```typescript
import { DADMODE_ODDS_MIN, DADMODE_ODDS_MAX } from "../lib/constants.js";

// Replace line 66:
const odds = Math.max(DADMODE_ODDS_MIN, Math.min(DADMODE_ODDS_MAX, Number(cfg.dadmode_odds || 1000)));
```

### Step 9: Update Flags Store

**File:** `src/store/flagsStore.ts`

```typescript
import { FLAG_REASON_MAX_LENGTH } from "../lib/constants.js";

// Replace line 102:
const sanitizedReason = reason.trim().slice(0, FLAG_REASON_MAX_LENGTH);
```

### Step 10: Update Time Utilities (Optional - Low Priority)

**File:** `src/lib/time.ts`

Consider adding comments rather than constants for standard conversions:

```typescript
import { MS_PER_SECOND } from "./constants.js";

// Unix timestamp: seconds since epoch
export const nowUtc = (): number => Math.floor(Date.now() / MS_PER_SECOND);
```

Note: Time unit conversions (60, 3600) in `src/lib/leaderboardImage.ts` can remain inline as they're self-documenting in context (formatAvgTime function).

## Files Affected

### Primary Changes (Must Do)
1. `src/lib/constants.ts` - **NEW FILE**
2. `src/commands/sync.ts` - Command sync delay
3. `src/lib/commandSync.ts` - Command sync delay (duplicate)
4. `src/events/forumPostNotify.ts` - Retry delay
5. `src/commands/health.ts` - Health check timeout
6. `src/commands/purge.ts` - Multiple delays + Discord 14-day limit
7. `src/index.ts` - Exit delay
8. `src/lib/eventWrap.ts` - Slow event threshold
9. `src/listeners/messageDadMode.ts` - Odds range bounds
10. `src/store/flagsStore.ts` - Reason truncation

### Optional Changes (Nice to Have)
11. `src/lib/time.ts` - Time conversions
12. `src/ops/dbRecoverCli.ts` - Recovery delay

### Files Not Changed (Rationale)
- `src/lib/leaderboardImage.ts` - Layout/design constants are self-documenting in context
- Files with existing named constants - Already following best practices

## Testing Strategy

### 1. Compile-Time Verification
```bash
npm run build
```
Ensure TypeScript compilation succeeds with no import errors.

### 2. Runtime Verification

**Test 1: Command Sync Delay**
- Restart bot and observe command sync timing in logs
- Should see identical behavior with `DISCORD_COMMAND_SYNC_DELAY_MS`

**Test 2: Health Check Timeout**
```bash
/health
```
- Verify health check completes successfully
- Manually block event loop to test timeout fires at 5s

**Test 3: Purge Command**
```bash
/purge password:[RESET_PASSWORD] count:10
```
- Verify message deletion works correctly
- Check delays between batches remain consistent

**Test 4: Forum Post Notification**
- Create forum post and verify retry logic on race condition
- Should see 2s delay if starter message missing

**Test 5: Dad Mode**
- Send "I'm tired" message in enabled guild
- Verify odds calculation still respects bounds

### 3. Regression Testing
Run full test suite to ensure no behavioral changes:
```bash
npm test
```

### 4. Code Review Checklist
- [ ] All imports use correct relative paths
- [ ] Constants follow naming convention (SCREAMING_SNAKE_CASE)
- [ ] Comments explain WHY each constant exists
- [ ] No duplicate constant definitions
- [ ] Constants grouped logically by category

## Rollback Plan

### Immediate Rollback (Git Revert)
If issues detected in production:

```bash
# Identify commit hash
git log --oneline -5

# Revert the changes
git revert <commit-hash>

# Deploy immediately
npm run build
pm2 restart pawtropolis-tech
```

### Manual Rollback (File-by-File)

1. Delete `src/lib/constants.ts`
2. Remove constant imports from affected files
3. Restore original inline values from this document
4. Rebuild: `npm run build`

### Verification After Rollback
```bash
# Check bot health
/health

# Verify command sync
# (restart bot and check logs)

# Verify purge still works
/purge password:[RESET_PASSWORD] count:5
```

## Success Criteria

- [ ] All magic numbers documented in centralized constants file
- [ ] Zero runtime behavior changes
- [ ] Build succeeds without TypeScript errors
- [ ] All tests pass
- [ ] Bot restarts successfully in production
- [ ] Command sync timing unchanged
- [ ] Health check behavior identical

## Implementation Notes

**Estimated Time:** 2-3 hours

**Dependencies:** None

**Breaking Changes:** None (refactoring only)

**Performance Impact:** None (constants are compile-time)

**Documentation Updates:**
- Add comment block to `constants.ts` explaining when to add new constants
- Update `ARCHITECTURE.md` if it references magic numbers

**Future Improvements:**
- Consider extracting Discord API limits to separate section
- Add validation functions for runtime bounds checking
- Create unit tests for constant value ranges
