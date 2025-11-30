# Issue #42: Reduce Default Event Handler Timeout

**Status:** Planned
**Priority:** Medium
**Estimated Effort:** 1-2 hours
**Created:** 2025-11-30

## Summary

The default timeout for Discord.js event handlers is currently set to 30 seconds, which is excessively long for typical bot event processing. Discord.js events should generally complete quickly (< 5 seconds), and the current timeout masks potential performance issues. Reducing the default to 10 seconds will provide better reliability monitoring while still allowing sufficient time for legitimate operations.

## Current State

### Problem

**Location:** `src/lib/eventWrap.ts:28`

The `DEFAULT_EVENT_TIMEOUT_MS` constant is set to 30 seconds:

```typescript
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "30000", 10);
```

**Issues:**
1. **Too permissive:** 30 seconds allows event handlers to stall for an unreasonably long time
2. **Masks performance problems:** Slow handlers should be flagged earlier for investigation
3. **Resource waste:** Long-running handlers block event loop and consume memory
4. **Delayed error detection:** Timeouts that occur after 30s might indicate serious issues that go unnoticed

### Current Usage

The timeout is used in three wrapper functions:
- `wrapEvent()` - Basic error protection for event handlers
- `wrapEventWithTiming()` - Error protection with performance monitoring
- `wrapEventRateLimited()` - Rate-limited wrapper (uses 1000ms hardcoded, not affected by this change)

**Active event handlers using default timeout:**
- `guildCreate` - Command sync operation
- `guildDelete` - Command cleanup
- `guildMemberAdd` - Join timestamp tracking
- `threadDelete` - Modmail cleanup
- `guildMemberUpdate` - Artist role changes
- `voiceStateUpdate` - Movie night tracking
- `threadCreate` - Forum post notifications

### Risk Assessment

**Severity:** Medium
- Not a critical bug, but impacts operational visibility
- Current timeout is too lenient for production reliability standards
- No immediate crash risk, but reduces quality of monitoring

**Impact:**
- Better early detection of slow handlers
- More accurate timeout errors in logs
- Forces attention to performance issues before they become critical

**Likelihood:** Medium
- Most handlers complete in < 1 second currently
- 10-second timeout provides 10x safety margin
- Low risk of false positive timeouts

## Proposed Changes

### Change Default Timeout from 30s to 10s

**Goal:** Reduce default event timeout to a more reasonable value while maintaining safety margin

**Implementation:**
```typescript
// Before
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "30000", 10);

// After
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "10000", 10);
```

**Rationale:**
1. **Industry standard:** Most Discord bots use 5-15 second timeouts
2. **Safety margin:** 10 seconds is still 10x longer than typical event processing (< 1s)
3. **Performance visibility:** Handlers taking > 10s need investigation regardless
4. **Progressive improvement:** Can reduce further if monitoring shows all events complete faster

### Environment Variable Override

The `EVENT_TIMEOUT_MS` environment variable remains available for runtime configuration:

```bash
# If specific deployment needs longer timeout
EVENT_TIMEOUT_MS=20000 npm start
```

This provides escape hatch for edge cases without code changes.

### Handler-Specific Timeouts

For handlers that legitimately need longer processing time, the timeout parameter can be specified explicitly:

```typescript
// Override for specific slow operation
client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
  await syncCommandsToGuild(guild.id); // May take longer on large guilds
}, 20000)); // 20-second timeout for this specific handler
```

## Implementation Plan

### Step 1: Update Default Constant
**Time:** 5 minutes

Change `DEFAULT_EVENT_TIMEOUT_MS` in `src/lib/eventWrap.ts`:

```typescript
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "10000", 10);
```

Update inline comment to reflect new timeout:

```typescript
/**
 * Default timeout for event handlers.
 *
 * Discord.js events should generally complete quickly. 10 seconds provides
 * ample safety margin while catching genuinely slow handlers that need
 * investigation.
 *
 * Override via EVENT_TIMEOUT_MS environment variable or per-handler timeout
 * parameter if specific events need more time.
 */
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "10000", 10);
```

### Step 2: Update Slow Event Warning Threshold
**Time:** 5 minutes

In `wrapEventWithTiming()`, consider updating the slow event warning threshold from 5 seconds to 3 seconds for consistency:

```typescript
// Before
if (durationMs > 5000) {
  logger.warn(
    { evt: "slow_event", event: eventName, durationMs },
    `[${eventName}] event handler took ${durationMs}ms`
  );
}

// After (optional)
if (durationMs > 3000) {
  logger.warn(
    { evt: "slow_event", event: eventName, durationMs },
    `[${eventName}] event handler took ${durationMs}ms`
  );
}
```

**Rationale:** With a 10s timeout, 3s warning threshold provides earlier visibility (30% of timeout vs 17% previously).

### Step 3: Review Existing Event Handlers
**Time:** 30 minutes

Audit all event handlers to identify any that might need explicit longer timeouts:

1. Check `src/index.ts` for all `client.on()` calls
2. Measure typical completion time for each handler (check logs)
3. Add explicit timeout if any handler typically takes > 5 seconds

**Expected outcome:** No handlers need longer timeout (all complete in < 2s typically)

### Step 4: Update Tests
**Time:** 15 minutes

If unit tests exist for `eventWrap.ts`, update timeout expectations:

```typescript
// Update test timeout assertions
it("should timeout after default period", async () => {
  const handler = wrapEvent("test", async () => {
    await sleep(15000); // Longer than new default
  });

  await handler();

  // Should log timeout error after 10s
  expect(mockLogger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      err: expect.objectContaining({
        message: expect.stringContaining("timeout after 10000ms")
      })
    }),
    expect.any(String)
  );
});
```

### Step 5: Update Documentation
**Time:** 10 minutes

Update JSDoc comments in `wrapEvent()` function:

```typescript
/**
 * Wrap an event handler with error protection
 *
 * @param eventName - Name of the event for logging
 * @param handler - The actual event handler function
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Wrapped handler that catches and logs errors
 *
 * @example
 * ```ts
 * // Use default 10-second timeout
 * client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => {
 *   await processNewMember(member);
 * }));
 *
 * // Override for slow operation
 * client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
 *   await syncCommandsToGuild(guild.id);
 * }, 20000)); // 20-second timeout
 * ```
 */
```

## Files Affected

### Modified
- `src/lib/eventWrap.ts` - Update `DEFAULT_EVENT_TIMEOUT_MS` from 30000 to 10000

### Reviewed (no changes needed)
- `src/index.ts` - All event handlers should work fine with 10s timeout
- Tests for `eventWrap.ts` (if they exist) - Update timeout expectations

## Testing Strategy

### Pre-Deployment Validation

1. **Type checking**
   ```bash
   npm run build
   ```
   Verify no TypeScript errors (should be none - this is a constant change)

2. **Unit tests**
   ```bash
   npm test
   ```
   Update and run tests for event wrapper timeout behavior

3. **Lint check**
   ```bash
   npm run lint
   ```

### Post-Deployment Monitoring

1. **Watch for timeout errors**
   ```bash
   grep "Event handler timeout" logs/app.log
   ```
   Monitor for 48 hours after deployment. Should see no timeouts in normal operation.

2. **Check slow event warnings**
   ```bash
   grep "slow_event" logs/app.log
   ```
   Verify no events consistently take > 3-5 seconds

3. **Monitor event performance metrics**
   - Track P95 and P99 event handler duration
   - Alert if any event exceeds 8 seconds (80% of new timeout)
   - Expected: All events complete in < 2 seconds typically

### Staging Environment Test

Before production deployment:

1. Deploy to staging with new 10s timeout
2. Run for 24 hours monitoring all event handlers
3. Simulate high-load scenarios:
   - Multiple guild joins/leaves
   - Burst of member updates
   - Forum post creation spam
4. Verify no legitimate operations timeout

## Rollback Plan

### If Timeouts Occur

**Symptom:** Event handlers timing out after 10 seconds

**Action:**
```bash
# Immediate mitigation - set environment variable
export EVENT_TIMEOUT_MS=30000
pm2 restart pawtropolis-bot

# Or code rollback
git revert HEAD
npm run build
pm2 restart pawtropolis-bot
```

**Validation:**
- Check logs for timeout errors - should stop occurring
- Monitor event completion times
- Identify which handler was timing out and investigate root cause

### If Specific Handler Needs More Time

**Symptom:** One specific event type times out (e.g., `guildCreate` on large servers)

**Action:**
Add explicit timeout to that handler only:

```typescript
// In src/index.ts
client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
  await syncCommandsToGuild(guild.id);
}, 20000)); // Increase this specific handler to 20s
```

This isolates the timeout extension to the specific slow operation without affecting all handlers.

### If Performance Issues Discovered

**Symptom:** Handlers consistently take 5-8 seconds (approaching timeout)

**Action:**
1. **Immediate:** Revert to 30s timeout for stability
2. **Investigation:** Profile slow handlers to identify bottlenecks
3. **Long-term:** Optimize slow operations (async background jobs, caching, etc.)
4. **Re-attempt:** After optimization, try 10s timeout again

## Success Criteria

- [ ] `DEFAULT_EVENT_TIMEOUT_MS` changed from 30000 to 10000
- [ ] All existing event handlers complete within 10 seconds
- [ ] No timeout errors in production logs for 48 hours post-deployment
- [ ] Slow event warnings (> 3s) remain rare (< 1% of events)
- [ ] Documentation updated with new default and override examples
- [ ] Tests updated and passing
- [ ] No performance regressions detected

## Monitoring & Alerts

### Recommended Metrics to Track

1. **Event timeout rate**
   - Metric: `events.timeout.total` (by event type)
   - Alert if any timeouts occur (should be zero)

2. **Event duration percentiles**
   - Metric: `events.duration_ms` (P50, P95, P99 by event type)
   - Alert if P99 > 8000ms (80% of timeout threshold)

3. **Slow event warnings**
   - Metric: `events.slow.total` (by event type)
   - Alert if > 10 slow events per hour (indicates need for optimization)

### Log Analysis

Monitor these patterns after deployment:

```bash
# Check for any timeouts (should be zero)
grep "Event handler timeout after 10000ms" logs/app.log

# Monitor slow events
grep "slow_event" logs/app.log | tail -20

# Check event error rate
grep "event_error" logs/app.log | wc -l
```

## Timeline

1. **Day 1 Morning:** Implementation (Steps 1-2) - 10 minutes
2. **Day 1 Morning:** Handler review (Step 3) - 30 minutes
3. **Day 1 Afternoon:** Tests and docs (Steps 4-5) - 25 minutes
4. **Day 2:** Deploy to staging, monitor for 24 hours
5. **Day 3:** Deploy to production, monitor closely for 48 hours

**Total development time:** 1 hour 5 minutes
**Total time including testing/monitoring:** 3 days

## Future Improvements

If this reduction proves successful and monitoring shows all handlers complete quickly:

1. **Further reduce default to 5 seconds**
   - More aggressive timeout for faster issue detection
   - Industry best practice for most Discord bots
   - Requires confidence that all handlers complete in < 3s typically

2. **Add per-handler timeout configuration**
   - Configuration file mapping event names to timeout values
   - Allows tuning without code changes
   - Example:
     ```json
     {
       "eventTimeouts": {
         "guildCreate": 15000,
         "default": 10000
       }
     }
     ```

3. **Implement circuit breaker pattern**
   - Automatically disable handlers that repeatedly timeout
   - Prevents cascading failures
   - Alerts team to investigate persistent issues

4. **Add timeout budget tracking**
   - Track "time debt" when handlers approach timeout
   - Proactively optimize before timeouts occur
   - Dashboard showing handlers closest to timeout threshold
