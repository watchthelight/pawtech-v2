# Issue #32: Fix Memory Leak in Rate Limiter Maps

**Status:** Planned
**Priority:** Medium-High
**Estimated Effort:** 1-2 hours
**Created:** 2025-11-30

## Summary

Two rate limiter implementations use unbounded in-memory Maps that never clear old entries. Over time, these Maps accumulate entries from every user who has ever triggered the rate limit, potentially growing to thousands of entries and causing memory leaks. Unlike time-based tracking (like modmail forwarding), these Maps persist user cooldowns indefinitely.

## Current State

### Problem

**Locations:**
1. `src/commands/flag.ts:26` - `flagCooldowns` Map
2. `src/commands/modstats.ts:559` - `resetRateLimiter` Map

Both implementations follow the same problematic pattern:

#### Flag Command Rate Limiter
```typescript
const FLAG_RATE_LIMIT_MS = 2000;
const flagCooldowns = new Map<string, number>();

// In execute function:
const cooldownKey = `${guildId}:${moderatorId}`;
const lastFlagTime = flagCooldowns.get(cooldownKey);

if (lastFlagTime && now - lastFlagTime < FLAG_RATE_LIMIT_MS) {
  // Rate limit active
  return;
}

// Later, after successful flag:
flagCooldowns.set(cooldownKey, Date.now());
```

#### Modstats Reset Rate Limiter
```typescript
const resetRateLimiter = new Map<string, number>();
const RESET_RATE_LIMIT_MS = 30000; // 30 seconds

// In handleReset function:
const lastAttempt = resetRateLimiter.get(userId);
if (lastAttempt && now - lastAttempt < RESET_RATE_LIMIT_MS) {
  // Rate limit active
  return;
}

// Record failed attempt:
resetRateLimiter.set(userId, now);
```

**Issues:**
1. **No cleanup mechanism:** Entries are added but never removed
2. **Unbounded growth:** Map size grows indefinitely with unique users
3. **Persistent keys:** Format `guildId:userId` means unique entry per user per guild
4. **Long-term accumulation:** Unlike modmail's 5-minute tracking, these persist forever
5. **Memory overhead:** Each entry ~120 bytes (composite key + timestamp + Map overhead)

### Impact Assessment

**Flag Rate Limiter:**
- Scope: Every moderator who uses `/flag` command
- Growth rate: New entry per moderator per guild
- Typical usage: Active servers might have 10-50 moderators flagging users
- Projected growth: ~50-500 entries over months of operation
- Memory impact: ~6-60 KB (relatively small but growing)

**Modstats Reset Rate Limiter:**
- Scope: Admin-only command with password protection
- Growth rate: Very low (only admins attempt resets)
- Typical usage: 1-5 admins, rarely used command
- Projected growth: ~5-50 entries over months
- Memory impact: <10 KB (minimal but still a leak)

### Risk Assessment

**Severity:** Medium-High
- Won't cause immediate crashes like high-volume leaks
- Gradually accumulates over weeks/months
- Each bot restart clears the Maps (memory-only)
- Demonstrates poor resource management pattern

**Impact:**
- Worst case: Thousands of stale cooldown entries over long uptime
- Best case: A few hundred entries causing minor memory waste
- Hidden cost: Sets bad precedent for future rate limiters

**Likelihood:** Medium
- Guaranteed to accumulate entries over time
- Mitigated by bot restarts clearing memory
- Becomes problematic with multi-guild deployments or high moderator turnover

## Proposed Changes

### Option A: Time-Based Cleanup (Recommended)

**Goal:** Add periodic cleanup to remove expired cooldown entries

**Implementation:**
```typescript
// Flag command (flag.ts)
const FLAG_RATE_LIMIT_MS = 2000;
const FLAG_COOLDOWN_TTL_MS = 60 * 60 * 1000; // 1 hour - entries expire after this
const flagCooldowns = new Map<string, number>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, timestamp] of flagCooldowns) {
    if (now - timestamp > FLAG_COOLDOWN_TTL_MS) {
      flagCooldowns.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(
      { cleaned, remaining: flagCooldowns.size },
      "[flag] cooldown cleanup"
    );
  }
}, 5 * 60 * 1000);

// Modstats reset (modstats.ts)
const RESET_RATE_LIMIT_MS = 30000; // 30 seconds
const RESET_COOLDOWN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const resetRateLimiter = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of resetRateLimiter) {
    if (now - timestamp > RESET_COOLDOWN_TTL_MS) {
      resetRateLimiter.delete(userId);
    }
  }
}, 60 * 60 * 1000); // Cleanup every hour
```

**Pros:**
- Simple to implement (add cleanup interval)
- No external dependencies
- Maintains existing API (no breaking changes)
- Provides deterministic memory bounds

**Cons:**
- Requires cleanup interval timers
- Cleanup still iterates entire Map (O(n) operation)
- Adds minimal overhead for timer management

### Option B: Lazy Expiration (Alternative)

**Goal:** Check expiration on read, no background cleanup

**Implementation:**
```typescript
const FLAG_RATE_LIMIT_MS = 2000;
const FLAG_COOLDOWN_TTL_MS = 60 * 60 * 1000;
const flagCooldowns = new Map<string, number>();

function isRateLimited(key: string, rateLimitMs: number, ttlMs: number): boolean {
  const timestamp = flagCooldowns.get(key);
  if (!timestamp) {
    return false; // No cooldown active
  }

  const now = Date.now();
  const age = now - timestamp;

  // Expired - delete and allow
  if (age > ttlMs) {
    flagCooldowns.delete(key);
    return false;
  }

  // Active rate limit
  if (age < rateLimitMs) {
    return true;
  }

  // Cooldown period passed but not expired - allow and keep entry
  return false;
}

// Usage:
if (isRateLimited(cooldownKey, FLAG_RATE_LIMIT_MS, FLAG_COOLDOWN_TTL_MS)) {
  // Rate limited
  return;
}

flagCooldowns.set(cooldownKey, Date.now());
```

**Pros:**
- No background timers needed
- Simpler code (single function)
- Automatic cleanup on access
- Zero overhead when Map is empty

**Cons:**
- Entries only removed when same user returns (stale entries persist)
- Map can still grow if users don't return
- Need periodic cleanup as fallback

### Recommended Approach: Option A (Time-Based Cleanup)

**Rationale:**
1. Guarantees entries are eventually removed
2. Simple implementation with clear behavior
3. Follows same pattern as modmail routing cleanup
4. Low performance overhead (Map sizes are small)
5. Can easily add monitoring metrics

## Implementation Plan

### Step 1: Add Cleanup to Flag Rate Limiter
**Time:** 15 minutes

1. Add TTL constant:
   ```typescript
   const FLAG_COOLDOWN_TTL_MS = 60 * 60 * 1000; // 1 hour
   ```

2. Add cleanup interval after Map declaration:
   ```typescript
   setInterval(() => {
     const now = Date.now();
     let cleaned = 0;

     for (const [key, timestamp] of flagCooldowns) {
       if (now - timestamp > FLAG_COOLDOWN_TTL_MS) {
         flagCooldowns.delete(key);
         cleaned++;
       }
     }

     if (cleaned > 0) {
       logger.debug(
         { cleaned, remaining: flagCooldowns.size },
         "[flag] cooldown cleanup"
       );
     }
   }, 5 * 60 * 1000); // Every 5 minutes
   ```

3. Add comment explaining TTL strategy

### Step 2: Add Cleanup to Modstats Reset Rate Limiter
**Time:** 15 minutes

1. Add TTL constant:
   ```typescript
   const RESET_COOLDOWN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
   ```

2. Add cleanup interval:
   ```typescript
   setInterval(() => {
     const now = Date.now();
     for (const [userId, timestamp] of resetRateLimiter) {
       if (now - timestamp > RESET_COOLDOWN_TTL_MS) {
         resetRateLimiter.delete(userId);
       }
     }
   }, 60 * 60 * 1000); // Every hour
   ```

3. Note: Modstats cleanup is less critical (low volume), but consistency is valuable

### Step 3: Add Documentation Comments
**Time:** 10 minutes

Update code comments to explain memory management:

```typescript
/**
 * Rate limiter for flag command (per moderator per guild).
 *
 * - Active cooldown: 2 seconds (prevents spam)
 * - Entry TTL: 1 hour (memory cleanup)
 * - Cleanup interval: 5 minutes
 *
 * Memory: Max ~50-500 entries × 120 bytes = ~6-60 KB
 */
const flagCooldowns = new Map<string, number>();
```

### Step 4: Add Unit Tests
**Time:** 20 minutes

Create tests for cleanup behavior:

```typescript
describe("Rate limiter cleanup", () => {
  it("should remove expired flag cooldowns after TTL", () => {
    // Test that entries older than 1 hour are removed
  });

  it("should preserve active cooldowns during cleanup", () => {
    // Test that recent entries are kept
  });

  it("should handle empty Map gracefully", () => {
    // Test cleanup with no entries
  });
});
```

## Files Affected

### Modified
- `src/commands/flag.ts` - Add periodic cleanup interval for flagCooldowns Map
- `src/commands/modstats.ts` - Add periodic cleanup interval for resetRateLimiter Map

### Created
- `tests/commands/flag.test.ts` - Unit tests for cleanup (if not exists)
- `tests/commands/modstats.test.ts` - Unit tests for cleanup (if not exists)

### Reviewed (no changes needed)
- Other rate limiter implementations should be audited for similar issues

## Testing Strategy

### Unit Tests
1. **TTL expiration**
   - Add entries with mocked timestamps
   - Advance time past TTL
   - Trigger cleanup
   - Verify expired entries removed

2. **Active cooldowns preserved**
   - Add recent entries
   - Run cleanup
   - Verify entries still present

3. **Edge cases**
   - Empty Map cleanup (no-op)
   - All entries expired
   - All entries active

### Integration Tests
1. **Flag rate limiter**
   - Invoke `/flag` command multiple times
   - Verify cooldown enforced for 2 seconds
   - Wait 1 hour (mocked)
   - Verify entry cleaned up

2. **Modstats reset rate limiter**
   - Attempt password reset multiple times
   - Verify 30-second rate limit
   - Wait 24 hours (mocked)
   - Verify entry cleaned up

### Memory Testing
```bash
# Monitor Map sizes in production
# Add temporary debug logging:
setInterval(() => {
  logger.debug({
    flagCooldowns: flagCooldowns.size,
    resetRateLimiter: resetRateLimiter.size
  }, "[rate-limiters] map sizes");
}, 60 * 60 * 1000); // Every hour
```

### Pre-Deployment Validation
```bash
# Run tests
npm test

# Type checking
npm run build

# Lint
npm run lint
```

## Rollback Plan

### If Cleanup Causes Issues

**Symptom:** Rate limits not working (entries removed too early)

**Action:**
```bash
# Immediate rollback
git revert HEAD
npm run build
pm2 restart pawtropolis-bot
```

**Diagnosis:**
- Check TTL values are correct
- Verify cleanup interval not too aggressive
- Review logs for unexpected deletions

### If Performance Issues

**Symptom:** Cleanup interval causing latency spikes

**Action:**
1. Increase cleanup interval:
   ```typescript
   }, 10 * 60 * 1000); // Every 10 minutes instead of 5
   ```

2. Or switch to lazy expiration (Option B):
   - Remove cleanup intervals
   - Add expiration check on read

### Emergency Disable

If cleanup causes critical issues:

```typescript
// Temporarily disable cleanup
// setInterval(() => { ... }, 5 * 60 * 1000);
```

This reverts to original behavior (leak present but functional).

## Success Criteria

- [ ] flagCooldowns Map entries expire after 1 hour
- [ ] resetRateLimiter Map entries expire after 24 hours
- [ ] Cleanup intervals run without errors
- [ ] Rate limiting still works correctly (2s for flag, 30s for reset)
- [ ] Map sizes remain bounded over 24-hour test period
- [ ] No performance degradation in command execution
- [ ] Debug logs show cleanup events occurring
- [ ] All tests pass

## Monitoring & Alerts

### Recommended Metrics

1. **Map sizes over time**
   - Metric: `rate_limiter.flag_cooldowns.size`
   - Metric: `rate_limiter.reset_limiter.size`
   - Alert if flag cooldowns exceed 1,000 entries (indicates cleanup failure)
   - Alert if reset limiter exceeds 100 entries (unusual for low-volume command)

2. **Cleanup effectiveness**
   - Metric: `rate_limiter.cleanup.entries_removed`
   - Track how many entries cleaned per cycle
   - Expect 0 for reset limiter (low volume)
   - Expect 0-50 for flag cooldowns depending on activity

3. **Cleanup duration**
   - Metric: `rate_limiter.cleanup.duration_ms`
   - Alert if cleanup takes >10ms (indicates Map too large)

### Log Analysis

Monitor these patterns after deployment:

```bash
# Check cleanup is running
grep "cooldown cleanup" logs/app.log

# Watch for rate limit enforcement
grep "Please wait.*before flagging" logs/app.log
grep "Too many attempts" logs/app.log

# Monitor Map growth
grep "rate-limiters] map sizes" logs/app.log
```

## Timeline

1. **Day 1 Morning:** Implementation (Steps 1-2) - 30 minutes
2. **Day 1 Afternoon:** Documentation and tests (Steps 3-4) - 30 minutes
3. **Day 2:** Code review and testing
4. **Day 3:** Deploy to staging and monitor for 24 hours
5. **Day 4:** Deploy to production

**Total development time:** 1 hour
**Total time including testing/monitoring:** 4 days

## Future Improvements

If this pattern is used elsewhere or we need more sophisticated rate limiting:

1. **Create reusable rate limiter utility**
   - Extract common logic to `src/lib/rateLimiter.ts`
   - Provide TTL-based Map wrapper with automatic cleanup
   - Use across all commands needing rate limiting

2. **Use LRU cache for automatic eviction**
   - Install `lru-cache` npm package
   - Built-in TTL and size limits
   - Better performance for large Maps

3. **Switch to Redis for distributed rate limiting**
   - Allows multiple bot instances
   - Automatic TTL expiration
   - Shared state across shards

4. **Add rate limiter middleware**
   - Centralized rate limiting before command execution
   - Consistent behavior across all commands
   - Easier to audit and maintain
