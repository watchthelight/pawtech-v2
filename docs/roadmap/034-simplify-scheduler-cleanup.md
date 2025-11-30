# 034: Simplify Scheduler Cleanup Logic

**Issue Type:** Code Quality / Technical Debt
**Priority:** Medium
**Estimated Effort:** 2-4 hours
**Risk Level:** Low

## Issue Summary

All three scheduler modules (`modMetricsScheduler.ts`, `opsHealthScheduler.ts`, `staleApplicationCheck.ts`) contain redundant cleanup logic in their `stop*Scheduler()` functions. Each function clears both the passed-in interval parameter AND the module-level `_activeInterval` variable, indicating unclear ownership semantics and unnecessary defensive coding.

**Current Pattern (all three schedulers):**
```typescript
let _activeInterval: NodeJS.Timeout | null = null;

export function start*Scheduler(client: Client): NodeJS.Timeout | null {
  const interval = setInterval(/* ... */);
  _activeInterval = interval;
  return interval;  // Returns the interval to caller
}

export function stop*Scheduler(interval: NodeJS.Timeout | null): void {
  if (interval) {
    clearInterval(interval);  // Clears passed-in interval
    logger.info("[*] scheduler stopped");
  }
  if (_activeInterval) {
    clearInterval(_activeInterval);  // Also clears module-level interval
    _activeInterval = null;
  }
}
```

## Current State

### Affected Files
- `/Users/bash/Documents/pawtropolis-tech/src/scheduler/modMetricsScheduler.ts` (lines 19, 71-120)
- `/Users/bash/Documents/pawtropolis-tech/src/scheduler/opsHealthScheduler.ts` (lines 20, 84-136)
- `/Users/bash/Documents/pawtropolis-tech/src/scheduler/staleApplicationCheck.ts` (lines 24, 305-353)

### Problems

1. **Unclear Ownership**: The module stores `_activeInterval` but also returns it, suggesting both the module AND the caller own the interval reference.

2. **Redundant Cleanup**: The `stop*Scheduler()` function clears the same interval twice (once via parameter, once via `_activeInterval`), which is unnecessary since they reference the same object.

3. **Misleading API**: The function signature `stop*Scheduler(interval: NodeJS.Timeout | null)` implies the caller must track and pass back the interval, but the module already has it.

4. **Inconsistent with Test Helper**: Each module previously had a `__test__stopScheduler()` function that took NO parameters and only used `_activeInterval`, proving the parameter was unnecessary. (Note: These functions were removed in Issue #45.)

### Usage Pattern (from src/index.ts)

```typescript
// Lines 373-404 (startup)
metricsInterval = startModMetricsScheduler(client);
healthInterval = startOpsHealthScheduler(client);
staleAppInterval = startStaleApplicationScheduler(client);

// Lines 440-451 (shutdown)
stopModMetricsScheduler(metricsInterval);
stopOpsHealthScheduler(healthInterval);
stopStaleApplicationScheduler(staleAppInterval);
```

The caller stores the intervals in module-level variables (`metricsInterval`, `healthInterval`, `staleAppInterval`), creating a second layer of tracking that mirrors the scheduler modules' own `_activeInterval`.

## Proposed Changes

### Option A: Module-Owned Intervals (Recommended)

Make the scheduler modules solely responsible for tracking their intervals. Remove the return value and parameter.

**Benefits:**
- Single source of truth for interval references
- Simpler API (no parameters to track)
- Consistent with test helper pattern
- Reduces cognitive load for callers

**Changes:**

1. Update `start*Scheduler()` signature to return `void`
2. Remove `interval` parameter from `stop*Scheduler()`
3. Update `src/index.ts` to remove interval tracking variables
4. Simplify `stop*Scheduler()` logic (Note: `__test__stopScheduler()` functions were already removed in Issue #45)

### Option B: Caller-Owned Intervals

Remove `_activeInterval` module variable and rely solely on caller-provided intervals.

**Benefits:**
- Clear external ownership
- Testable without module state

**Drawbacks:**
- Caller must track intervals (more boilerplate)
- Test helper becomes impossible without module state

### Recommended Approach: Option A

Option A aligns with the existing test helper pattern and simplifies the caller's responsibilities.

## Implementation Steps

### Step 1: Update `modMetricsScheduler.ts`

```typescript
// Line 71: Remove return type
export function startModMetricsScheduler(client: Client): void {
  // ... existing logic ...
  _activeInterval = interval;
  // Remove: return interval;
}

// Line 111: Remove parameter, simplify logic
export function stopModMetricsScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[metrics] scheduler stopped");
  }
}

// Note: __test__stopScheduler() was already removed in Issue #45
```

### Step 2: Update `opsHealthScheduler.ts`

Apply same changes as Step 1:
- Line 84: `startOpsHealthScheduler(client: Client): void`
- Line 127: `stopOpsHealthScheduler(): void` (remove parameter)
- Note: `__test__stopScheduler()` was already removed in Issue #45

### Step 3: Update `staleApplicationCheck.ts`

Apply same changes as Step 1:
- Line 305: `startStaleApplicationScheduler(client: Client): void`
- Line 344: `stopStaleApplicationScheduler(): void` (remove parameter)
- Note: `__test__stopScheduler()` was already removed in Issue #45

### Step 4: Update `src/index.ts`

```typescript
// Remove module-level variables (around lines 59-61)
// DELETE: let metricsInterval: NodeJS.Timeout | null = null;
// DELETE: let healthInterval: NodeJS.Timeout | null = null;
// DELETE: let staleAppInterval: NodeJS.Timeout | null = null;

// Lines 373-404: Simplify start calls
const { startModMetricsScheduler } = await import("./scheduler/modMetricsScheduler.js");
startModMetricsScheduler(client);  // No assignment

const { startOpsHealthScheduler } = await import("./scheduler/opsHealthScheduler.js");
startOpsHealthScheduler(client);  // No assignment

const { startStaleApplicationScheduler } = await import("./scheduler/staleApplicationCheck.js");
startStaleApplicationScheduler(client);  // No assignment

// Lines 440-451: Simplify stop calls
const { stopModMetricsScheduler } = await import("./scheduler/modMetricsScheduler.js");
stopModMetricsScheduler();  // No parameter

const { stopOpsHealthScheduler } = await import("./scheduler/opsHealthScheduler.js");
stopOpsHealthScheduler();  // No parameter

const { stopStaleApplicationScheduler } = await import("./scheduler/staleApplicationCheck.js");
stopStaleApplicationScheduler();  // No parameter
```

### Step 5: Update JSDoc Examples

Each scheduler file has JSDoc examples showing the old pattern. Update them:

```typescript
/**
 * @example
 * // In src/index.ts ClientReady event:
 * import { startModMetricsScheduler } from './scheduler/modMetricsScheduler.js';
 * startModMetricsScheduler(client);
 *
 * // Graceful shutdown:
 * import { stopModMetricsScheduler } from './scheduler/modMetricsScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopModMetricsScheduler();
 * });
 */
```

Update in:
- `modMetricsScheduler.ts` lines 61-69, 105-109
- `opsHealthScheduler.ts` lines 74-82
- `staleApplicationCheck.ts` lines 295-303

## Testing Strategy

### Pre-Change Verification

1. Verify schedulers start correctly:
   ```bash
   npm run dev
   # Check logs for:
   # [metrics] scheduler starting
   # [opshealth:scheduler] starting health check scheduler
   # [stale-alert] scheduler starting
   ```

2. Verify schedulers stop correctly on SIGTERM:
   ```bash
   npm run dev
   # Press Ctrl+C
   # Check logs for:
   # [metrics] scheduler stopped
   # [opshealth:scheduler] scheduler stopped
   # [stale-alert] scheduler stopped
   ```

### Post-Change Verification

1. **Compilation**: Ensure TypeScript compiles without errors
   ```bash
   npm run build
   ```

2. **Runtime Start**: Verify all three schedulers start
   ```bash
   npm run dev
   ```

3. **Runtime Stop**: Verify graceful shutdown clears intervals
   ```bash
   npm run dev
   # Send SIGTERM (Ctrl+C)
   # Verify "scheduler stopped" logs for all three
   ```

4. **Environment Flag Opt-Out**: Verify environment-based disabling still works
   ```bash
   METRICS_SCHEDULER_DISABLED=1 OPS_HEALTH_SCHEDULER_DISABLED=1 STALE_APP_SCHEDULER_DISABLED=1 npm run dev
   # Check logs show: "scheduler disabled via env flag"
   ```

### Test Impact

**No existing tests affected**: No test files found for schedulers (verified via `**/*scheduler*.test.ts` glob).

The `__test__stopScheduler()` functions were removed in Issue #45 after verification they were unused.

## Rollback Plan

### If Issues Arise

1. **Immediate Rollback**: Revert the commit
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Specific File Rollback**: If only one scheduler is problematic
   ```bash
   git checkout HEAD~1 -- src/scheduler/modMetricsScheduler.ts
   git commit -m "Rollback: revert modMetricsScheduler changes"
   ```

### Low Risk Justification

- Pure refactoring (no logic changes)
- No external API surface changes (internal schedulers only)
- Same cleanup behavior (clearing interval + nulling reference)
- Straightforward verification (logs + manual testing)
- No production dependencies on return values

### Monitoring Post-Deploy

Watch for:
- Missing "scheduler stopped" logs on shutdown
- Schedulers not starting (missing "scheduler starting" logs)
- Memory leaks (intervals not cleared, process doesn't exit cleanly)

No special monitoring required beyond existing application logs.

## Success Criteria

- [ ] All three scheduler modules use single source of truth (`_activeInterval`)
- [ ] `src/index.ts` no longer tracks interval variables
- [ ] No duplicate `clearInterval()` calls
- [ ] JSDoc examples updated to match new API
- [ ] Bot starts and stops cleanly in development environment
- [ ] TypeScript compilation passes
- [ ] Environment opt-out flags still work

## Notes

This change is part of a broader code quality audit (Issue #34). It addresses unclear ownership semantics without changing runtime behavior. The refactoring makes the codebase more maintainable by reducing redundancy and clarifying responsibilities.

**Related Patterns**: After this change, consider applying similar cleanup to other module-level state patterns in the codebase (e.g., cache managers, connection pools).
