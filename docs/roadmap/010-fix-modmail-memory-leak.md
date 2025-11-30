# Issue #10: Fix Memory Leak Risk in Modmail Message Tracking

**Status:** Planned
**Priority:** High
**Estimated Effort:** 2-4 hours
**Created:** 2025-11-30

## Summary

The modmail routing system uses an unbounded Map to track forwarded messages and prevent echo loops. Under high message volume, this Map can accumulate thousands of entries between cleanup intervals (60 seconds), potentially leading to memory exhaustion on busy servers.

## Current State

### Problem

**Location:** `src/features/modmail/routing.ts:100-145`

The `forwardedMessages` Map tracks message IDs to prevent infinite routing loops when messages are forwarded between DM and thread channels. Current implementation has memory leak risk:

```typescript
const forwardedMessages = new Map<string, number>(); // messageId -> timestamp
const FORWARDED_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const FORWARDED_CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute
```

**Issues:**
1. **Time-based cleanup only:** Cleanup runs every 60 seconds regardless of Map size
2. **No size limits:** Map can grow unbounded between cleanup cycles
3. **High-volume vulnerability:** Busy servers with 100+ messages/minute could accumulate 6,000+ entries before cleanup
4. **Memory growth:** Each entry is ~100 bytes (24-char message ID + 8-byte timestamp + Map overhead), so 10,000 entries = ~1MB
5. **GC pressure:** Large Map causes longer cleanup iterations and increased garbage collection pauses

### Current Implementation

The Map tracks forwarded messages to prevent this scenario:
1. Staff sends "Hello" in modmail thread
2. Bot forwards to user's DM
3. Bot sees its own DM message
4. Without tracking, bot would forward bot's message back to thread (infinite loop)

**Functions:**
- `markForwarded(messageId)` - Add message ID with current timestamp
- `isForwarded(messageId)` - Check if message was already forwarded (also does lazy expiration check)
- Interval cleanup - Runs every 60s to remove expired entries

### Risk Assessment

**Severity:** High
- Memory leaks can cause bot crashes on high-volume servers
- Discord bots handle 10,000+ messages/day on active servers
- Current 60-second cleanup window is too large

**Impact:**
- Worst case: Bot crashes due to memory exhaustion
- Best case: Increased memory usage and GC pauses cause latency

**Likelihood:** Medium-High
- Pawtropolis Tech is growing rapidly
- Modmail is critical infrastructure for all applications
- Issue will manifest as server grows

## Proposed Changes

### Option A: Add Size-Based Eviction (Recommended)

**Goal:** Implement hybrid time + size-based eviction for safety bounds

**Implementation:**
```typescript
const forwardedMessages = new Map<string, number>();
const FORWARDED_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FORWARDED_MAX_SIZE = 10000; // Hard limit
const FORWARDED_EVICTION_SIZE = 5000; // Start evicting at this size
const FORWARDED_CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

function markForwarded(messageId: string) {
  forwardedMessages.set(messageId, Date.now());

  // Size-based eviction if Map grows too large
  if (forwardedMessages.size > FORWARDED_EVICTION_SIZE) {
    evictOldestEntries(FORWARDED_EVICTION_SIZE / 2);
  }
}

function evictOldestEntries(targetSize: number) {
  // Sort entries by timestamp and remove oldest
  const entries = Array.from(forwardedMessages.entries())
    .sort((a, b) => a[1] - b[1]);

  const toRemove = entries.slice(0, entries.length - targetSize);
  for (const [msgId] of toRemove) {
    forwardedMessages.delete(msgId);
  }

  logger.debug(
    { removed: toRemove.length, remaining: forwardedMessages.size },
    "[modmail] size-based eviction"
  );
}
```

**Pros:**
- Simple to implement (minimal code change)
- Provides hard upper bound on memory usage
- Maintains existing time-based cleanup
- No external dependencies

**Cons:**
- Eviction requires sorting (O(n log n)), but only when threshold exceeded
- Still requires periodic cleanup interval

### Option B: Use LRU Cache (Alternative)

**Goal:** Replace Map with proper LRU cache with built-in eviction

**Implementation:**
```typescript
import { LRUCache } from "lru-cache";

const forwardedMessages = new LRUCache<string, number>({
  max: 5000, // Maximum entries
  ttl: 5 * 60 * 1000, // 5 minutes TTL
  updateAgeOnGet: false, // Don't reset TTL on reads
  updateAgeOnHas: false,
});

function markForwarded(messageId: string) {
  forwardedMessages.set(messageId, Date.now());
}

function isForwarded(messageId: string): boolean {
  return forwardedMessages.has(messageId);
}

// No cleanup interval needed - LRU handles it
```

**Pros:**
- Industry-standard solution (lru-cache npm package)
- Automatic eviction on size and TTL
- No manual cleanup needed
- Better performance for large datasets

**Cons:**
- Adds external dependency
- Slightly more complex (but well-tested library)
- Package size: ~10KB

### Recommended Approach: Option A (Size-Based Eviction)

**Rationale:**
1. No new dependencies
2. Minimal code change
3. Provides immediate safety bounds
4. Can upgrade to LRU later if needed

## Implementation Plan

### Step 1: Add Size-Based Eviction
**Time:** 30 minutes

1. Add constants for size limits:
   ```typescript
   const FORWARDED_MAX_SIZE = 10000;
   const FORWARDED_EVICTION_SIZE = 5000;
   ```

2. Implement `evictOldestEntries()` helper function

3. Add size check to `markForwarded()`:
   ```typescript
   if (forwardedMessages.size > FORWARDED_EVICTION_SIZE) {
     evictOldestEntries(FORWARDED_EVICTION_SIZE / 2);
   }
   ```

4. Add debug logging for eviction events

### Step 2: Add Monitoring Metrics
**Time:** 15 minutes

Add size tracking to existing cleanup interval:

```typescript
const forwardedCleanupInterval = setInterval(() => {
  const now = Date.now();
  const sizeBefore = forwardedMessages.size;
  let cleaned = 0;

  for (const [msgId, timestamp] of forwardedMessages) {
    if (now - timestamp > FORWARDED_TTL_MS) {
      forwardedMessages.delete(msgId);
      cleaned++;
    }
  }

  if (cleaned > 0 || sizeBefore > 1000) {
    logger.debug(
      { cleaned, sizeBefore, sizeAfter: forwardedMessages.size },
      "[modmail] forwardedMessages cleanup"
    );
  }
}, FORWARDED_CLEANUP_INTERVAL_MS);
```

### Step 3: Add Unit Tests
**Time:** 45 minutes

Create `tests/features/modmail/routing.test.ts`:

```typescript
describe("forwardedMessages size-based eviction", () => {
  it("should evict oldest entries when size exceeds threshold", () => {
    // Test that Map doesn't grow beyond limit
  });

  it("should maintain newest entries during eviction", () => {
    // Test that recent entries are preserved
  });

  it("should handle rapid message bursts", () => {
    // Test 1000+ messages added quickly
  });
});
```

### Step 4: Performance Testing
**Time:** 30 minutes

Benchmark eviction performance:

```typescript
// Add to tests
describe("forwardedMessages performance", () => {
  it("should handle 10,000 entries without degradation", () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      markForwarded(`msg-${i}`);
    }
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Should take <1s
  });
});
```

### Step 5: Documentation Updates
**Time:** 15 minutes

Update code comments in `routing.ts`:

```typescript
/**
 * In-memory map to prevent echo loops in message routing.
 *
 * Problem: [existing comment...]
 *
 * Solution: Hybrid time + size-based eviction
 * - Time-based: Entries expire after 5 minutes TTL
 * - Size-based: Eviction triggers at 5,000 entries (prevents unbounded growth)
 * - Cleanup: Runs every 60 seconds to remove expired entries
 *
 * Memory: Max ~500KB (5,000 entries × 100 bytes/entry)
 */
```

## Files Affected

### Modified
- `src/features/modmail/routing.ts` - Add size-based eviction to forwardedMessages Map

### Created
- `tests/features/modmail/routing.test.ts` - Unit tests for eviction behavior

### Reviewed (no changes needed)
- `src/features/modmail/tickets.ts` - Uses routing functions but doesn't manage Map
- `src/features/modmail/transcript.ts` - Independent of message tracking

## Testing Strategy

### Unit Tests
1. **Size limit enforcement**
   - Add 6,000 entries rapidly
   - Verify Map size stays below 5,000
   - Confirm oldest entries are evicted first

2. **Time-based expiration still works**
   - Add entries with mocked timestamps
   - Verify cleanup interval removes expired entries
   - Confirm unexpired entries are retained

3. **Edge cases**
   - Empty Map eviction (no-op)
   - Single entry Map
   - Exactly at threshold (no eviction)

### Integration Tests
1. **High-volume simulation**
   - Send 100 modmail messages in rapid succession
   - Verify no echo loops occur
   - Confirm Map size remains bounded

2. **Memory profiling**
   ```bash
   node --expose-gc --max-old-space-size=512 dist/index.js
   ```
   - Monitor heap usage during high message volume
   - Verify no memory leaks over 1-hour test period

### Load Testing
1. **Benchmark eviction performance**
   - Measure time to evict 2,500 entries from 5,000-entry Map
   - Target: <10ms for eviction operation
   - Ensure no blocking of message routing

2. **Cleanup interval performance**
   - Measure time for cleanup with 5,000 entries
   - Target: <50ms per cleanup cycle
   - Verify no impact on message latency

### Pre-Deployment Validation
```bash
# Run full test suite
npm test

# Type checking
npm run build

# Lint check
npm run lint

# Memory leak test (if available)
npm run test:memory
```

## Rollback Plan

### If Eviction Causes Issues

**Symptom:** Echo loops reappear or messages not forwarded

**Action:**
```bash
# Immediate rollback
git revert HEAD
git push origin main

# Or restore previous version
git checkout HEAD~1 -- src/features/modmail/routing.ts
npm run build
pm2 restart pawtropolis-bot
```

**Validation:**
- Check modmail routing logs for duplicate forwards
- Monitor forwardedMessages Map size
- Verify no message routing failures

### If Performance Degradation Detected

**Symptom:** Increased latency in message forwarding

**Action:**
1. Increase eviction threshold:
   ```typescript
   const FORWARDED_EVICTION_SIZE = 10000; // Double the threshold
   ```

2. Or switch to LRU cache (Option B):
   ```bash
   npm install lru-cache
   # Implement Option B from above
   ```

3. Monitor performance metrics:
   - Message routing latency
   - Cleanup interval duration
   - Heap memory usage

### If Memory Usage Still Too High

**Action:**
1. Reduce TTL from 5 minutes to 2 minutes:
   ```typescript
   const FORWARDED_TTL_MS = 2 * 60 * 1000;
   ```
   - Shorter TTL = fewer entries retained
   - Risk: Extremely slow message delivery might cause echo loops

2. Reduce eviction threshold:
   ```typescript
   const FORWARDED_EVICTION_SIZE = 2500;
   ```

3. Switch to LRU cache (Option B) for better memory efficiency

## Success Criteria

- [ ] forwardedMessages Map never exceeds 5,000 entries
- [ ] Size-based eviction triggers correctly when threshold exceeded
- [ ] Oldest entries are evicted first (FIFO eviction)
- [ ] Time-based cleanup still runs every 60 seconds
- [ ] No echo loops in message routing (existing behavior maintained)
- [ ] Eviction operation completes in <10ms
- [ ] Memory usage bounded to ~500KB for Map
- [ ] All tests pass with no regressions
- [ ] No performance degradation in message routing latency

## Monitoring & Alerts

### Recommended Metrics to Track

1. **Map size over time**
   - Metric: `modmail.forwardedMessages.size`
   - Alert if size exceeds 8,000 (indicates eviction not working)

2. **Eviction events**
   - Metric: `modmail.forwardedMessages.evictions.total`
   - Alert if evictions happen >10 times/hour (indicates need for tuning)

3. **Cleanup duration**
   - Metric: `modmail.forwardedMessages.cleanup.duration_ms`
   - Alert if cleanup takes >100ms (indicates Map too large)

4. **Echo loop detection**
   - Metric: `modmail.routing.duplicate_forward.total`
   - Alert if any duplicates detected (indicates eviction too aggressive)

### Log Analysis

Monitor these log patterns after deployment:

```bash
# Check for size-based evictions
grep "size-based eviction" logs/app.log

# Monitor Map size during cleanup
grep "forwardedMessages cleanup" logs/app.log | grep "sizeAfter"

# Watch for routing errors
grep "failed to route" logs/app.log
```

## Timeline

1. **Day 1 Morning:** Implementation (Steps 1-2) - 45 minutes
2. **Day 1 Afternoon:** Unit tests (Step 3) - 45 minutes
3. **Day 2 Morning:** Performance testing (Step 4) - 30 minutes
4. **Day 2 Afternoon:** Code review and documentation (Step 5) - 15 minutes
5. **Day 3:** Deploy to staging and monitor for 24 hours
6. **Day 4:** Deploy to production and monitor

**Total development time:** 2.25 hours
**Total time including testing/monitoring:** 4 days

## Future Improvements

If this fix proves insufficient or we want to optimize further:

1. **Upgrade to LRU cache** (Option B)
   - Better algorithmic performance
   - More predictable memory usage
   - Industry-standard solution

2. **Switch to Redis for distributed tracking**
   - Allows multiple bot instances
   - Better for horizontal scaling
   - Automatic TTL expiration

3. **Use Bloom filter for fast negative lookups**
   - Probabilistic data structure
   - Constant memory usage regardless of volume
   - Fast O(1) lookups
   - Trade-off: Small false positive rate (acceptable for this use case)
