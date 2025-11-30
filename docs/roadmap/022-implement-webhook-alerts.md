# Issue #22: Implement Webhook Integration for Health Alerts

**Status:** Planned
**Priority:** Low
**Estimated Effort:** 2-3 hours
**Created:** 2025-11-30

## Summary

The operations health monitoring system (`opsHealth.ts`) has a partially implemented webhook notification feature. The `HEALTH_ALERT_WEBHOOK` environment variable is defined and validated, but when alerts are triggered, the webhook POST is skipped with a TODO comment. This creates a confusing user experience: operators who configure the webhook URL expect external alerts (PagerDuty, Slack, etc.) but get nothing.

**Decision Required:** Either implement the webhook feature or remove the dead code path entirely.

## Current State

### Problem

**Location:** `src/features/opsHealth.ts:596-597`

The `notifyAlert()` function checks for a webhook URL but never sends the notification:

```typescript
// Webhook support for external alerting (PagerDuty, Slack, etc.)
const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK;
if (webhookUrl) {
  // TODO: POST to webhook with alert payload. For now, Discord is enough.
  logger.debug({ alertId: alert.id }, "[opshealth] webhook notification skipped (not implemented)");
}
```

**Environment Variable Configuration:**

**File:** `src/lib/env.ts:67, 132`

```typescript
// Raw extraction (line 67)
HEALTH_ALERT_WEBHOOK: process.env.HEALTH_ALERT_WEBHOOK?.trim(),

// Validation schema (line 132)
HEALTH_ALERT_WEBHOOK: z.string().optional(),
```

The environment variable is:
- Defined in the environment schema
- Validated at startup
- Documented as optional
- **Never actually used**

### Why This Is Problematic

1. **Silent Failure:** Operators who configure `HEALTH_ALERT_WEBHOOK` expect external alerts but get none. No error is thrown, just a debug log that may not be visible in production.

2. **Wasted Configuration:** The environment variable, documentation, and validation code exist but serve no purpose.

3. **Code Maintenance Burden:** Future developers may waste time trying to configure a feature that doesn't work.

4. **Incomplete Feature:** The Discord notification works (via `logActionPretty`), but the webhook integration was clearly planned and never finished.

### Current Alert Flow

When a health check triggers an alert:

1. Alert is created in database (`upsertAlert()`)
2. `notifyAlert()` is called
3. Discord notification is sent via `logActionPretty()` (lines 583-591)
4. Webhook URL is checked but POST is skipped (lines 594-598)
5. Debug log emitted (invisible in production)

### Alert Types That Need Webhooks

From `runCheck()` function (lines 340-488):
- **queue_backlog** - Application queue exceeds threshold
- **p95_response_high** - P95 response time exceeds SLO
- **ws_ping_high** - WebSocket ping indicates degraded Discord connection
- **pm2_<process>_down** - PM2 process crashed or stopped
- **db_integrity_fail** - Database corruption detected
- **modmail_orphaned_tickets** - Modmail tickets lost their thread mapping

All of these are critical operational issues that warrant external alerting.

## Proposed Changes

### Option A: Implement Webhook Notifications (Recommended)

**Goal:** Complete the webhook integration so external alerting actually works.

**Why This Option:**
- Feature was clearly intended (environment variable exists)
- External alerting is a best practice for production systems
- Discord notifications alone are insufficient for 24/7 operations
- PagerDuty/Slack integration is standard for production bots

**Implementation:**

Add webhook POST logic to `notifyAlert()`:

```typescript
// Webhook support for external alerting (PagerDuty, Slack, etc.)
const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK;
if (webhookUrl) {
  try {
    const payload = {
      alert_id: alert.id,
      alert_type: alert.alert_type,
      severity: alert.severity,
      triggered_at: alert.triggered_at,
      message: formatAlertMessage(alert),
      meta: alert.meta,
      timestamp: new Date(alert.triggered_at * 1000).toISOString(),
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Pawtropolis-Tech-Bot/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      logger.error(
        {
          alertId: alert.id,
          status: response.status,
          statusText: response.statusText
        },
        "[opshealth] webhook notification failed"
      );
    } else {
      logger.info(
        { alertId: alert.id, webhookUrl: webhookUrl.substring(0, 30) + '...' },
        "[opshealth] webhook notification sent"
      );
    }
  } catch (err: any) {
    logger.error(
      { err: err.message, alertId: alert.id },
      "[opshealth] webhook notification error"
    );
  }
}
```

**Helper Function:**

Add `formatAlertMessage()` to generate human-readable messages:

```typescript
/**
 * Format alert as human-readable message for external systems
 */
function formatAlertMessage(alert: HealthAlert): string {
  const severity = alert.severity === 'critical' ? '🚨 CRITICAL' : '⚠️  WARNING';

  switch (alert.alert_type) {
    case 'queue_backlog':
      return `${severity}: Queue backlog at ${alert.meta?.actual || 'unknown'} (threshold: ${alert.meta?.threshold || 'unknown'})`;
    case 'p95_response_high':
      return `${severity}: P95 response time ${alert.meta?.actual || 'unknown'}ms (threshold: ${alert.meta?.threshold || 'unknown'}ms)`;
    case 'ws_ping_high':
      return `${severity}: WebSocket ping ${alert.meta?.actual || 'unknown'}ms (threshold: ${alert.meta?.threshold || 'unknown'}ms)`;
    case 'db_integrity_fail':
      return `${severity}: Database integrity check failed - ${alert.meta?.message || 'unknown error'}`;
    case 'modmail_orphaned_tickets':
      return `${severity}: ${alert.meta?.count || 'unknown'} orphaned modmail tickets detected`;
    default:
      if (alert.alert_type.startsWith('pm2_')) {
        return `${severity}: PM2 process ${alert.meta?.process || 'unknown'} is ${alert.meta?.status || 'down'}`;
      }
      return `${severity}: ${alert.alert_type} - ${JSON.stringify(alert.meta)}`;
  }
}
```

**Pros:**
- Completes an intended feature
- Enables 24/7 operational monitoring
- Supports standard alerting platforms (PagerDuty, Slack, webhooks)
- Minimal code change (~50 lines)
- No new dependencies (uses built-in `fetch`)

**Cons:**
- Adds network I/O to alert path (mitigated by timeout + error handling)
- Requires testing with actual webhook endpoints
- Need to document webhook payload format

### Option B: Remove Dead Code Path

**Goal:** Remove the environment variable and skip logic entirely.

**Why This Option:**
- If external alerting isn't actually needed
- Simpler codebase (less to maintain)
- Discord notifications may be sufficient for current scale
- Can always add webhooks later if needed

**Implementation:**

1. **Remove environment variable** (`src/lib/env.ts`):
   - Delete line 67 (raw extraction)
   - Delete line 132 (schema validation)

2. **Remove webhook check** (`src/features/opsHealth.ts:594-598`):
   - Delete the entire `if (webhookUrl)` block
   - Remove the TODO comment

3. **Update documentation** (if any exists):
   - Remove references to `HEALTH_ALERT_WEBHOOK`
   - Document that Discord is the sole notification channel

**Pros:**
- Removes confusing dead code
- Reduces maintenance burden
- Simpler system (fewer failure modes)
- No network dependencies

**Cons:**
- Loses potential feature for production operations
- May need to re-add later as bot scales
- Discord-only alerts don't work for 24/7 on-call

### Recommended Approach: Option A (Implement Webhooks)

**Rationale:**
1. The TODO suggests this was always intended
2. Production bots should have external alerting
3. Minimal implementation effort (~50 lines)
4. Enables professional operations practices
5. No dependencies needed (built-in `fetch`)

## Implementation Plan

### Step 1: Add Webhook POST Logic
**Time:** 45 minutes

1. Add `formatAlertMessage()` helper function to `opsHealth.ts`
2. Replace TODO block with actual `fetch()` call
3. Add proper error handling with timeout
4. Add structured logging for success/failure cases

### Step 2: Add Webhook Payload Documentation
**Time:** 15 minutes

Add JSDoc comment documenting expected webhook payload:

```typescript
/**
 * Webhook Payload Format
 *
 * POST to HEALTH_ALERT_WEBHOOK with JSON body:
 * {
 *   "alert_id": 123,
 *   "alert_type": "queue_backlog",
 *   "severity": "warn" | "critical",
 *   "triggered_at": 1732960000,
 *   "message": "⚠️  WARNING: Queue backlog at 250 (threshold: 200)",
 *   "meta": { "threshold": 200, "actual": 250 },
 *   "timestamp": "2025-11-30T12:00:00.000Z"
 * }
 *
 * Compatible with:
 * - Slack incoming webhooks (use "message" as "text" field)
 * - Discord webhooks (use "message" as "content" field)
 * - PagerDuty Events API v2 (map to "summary" field)
 * - Generic webhook receivers (parse "message" or "meta")
 */
```

### Step 3: Add Unit Tests
**Time:** 30 minutes

Create `tests/features/opsHealth.test.ts`:

```typescript
describe("webhook notifications", () => {
  it("should POST to webhook when alert triggered", async () => {
    // Mock fetch and verify correct payload
  });

  it("should handle webhook timeout gracefully", async () => {
    // Test AbortSignal timeout
  });

  it("should log error on webhook failure but not throw", async () => {
    // Verify alert processing continues even if webhook fails
  });

  it("should format alert messages correctly", () => {
    // Test formatAlertMessage() for all alert types
  });
});
```

### Step 4: Integration Testing
**Time:** 30 minutes

1. **Test with Discord webhook:**
   - Create test Discord webhook URL
   - Set `HEALTH_ALERT_WEBHOOK` in `.env`
   - Trigger health check failures
   - Verify messages appear in Discord channel

2. **Test with Slack webhook:**
   - Create test Slack incoming webhook
   - Verify payload format is compatible
   - Confirm messages are readable

3. **Test with webhook.site:**
   - Use webhook.site for payload inspection
   - Verify JSON structure matches documentation
   - Confirm timeout behavior

### Step 5: Documentation Updates
**Time:** 15 minutes

Update operational documentation:

**File:** `docs/operations/deployment-config.md` (if exists)

Add section:
```markdown
## Health Alert Webhooks

Configure external alerting for operational health issues:

HEALTH_ALERT_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

Supports:
- Slack incoming webhooks
- Discord webhooks
- PagerDuty Events API v2
- Any service accepting JSON POST

Payload format: See src/features/opsHealth.ts:formatAlertMessage()
```

## Files Affected

### Modified
- **`src/features/opsHealth.ts`**
  - Lines 594-598: Replace TODO with actual webhook implementation
  - Add `formatAlertMessage()` helper function (~40 lines)

### Created
- **`tests/features/opsHealth.test.ts`** (new file)
  - Unit tests for webhook logic
  - Mock fetch tests
  - Message formatting tests

### Reviewed (no changes if implementing)
- **`src/lib/env.ts`** - Environment variable already defined correctly
- **`docs/operations/deployment-config.md`** - Add webhook documentation

### Removed (only if choosing Option B)
- **`src/lib/env.ts:67, 132`** - Remove HEALTH_ALERT_WEBHOOK
- **`src/features/opsHealth.ts:594-598`** - Remove webhook check block

## Testing Strategy

### Unit Tests

1. **Webhook payload structure**
   - Verify all required fields present
   - Test JSON serialization
   - Validate timestamp format (ISO 8601)

2. **Message formatting**
   - Test `formatAlertMessage()` for each alert type
   - Verify severity indicators (🚨, ⚠️)
   - Confirm meta fields are included

3. **Error handling**
   - Mock network failures
   - Test timeout behavior (5 second limit)
   - Verify non-blocking error handling

4. **Edge cases**
   - Empty webhook URL (should skip)
   - Invalid URL format (should log error)
   - Non-200 response codes (should log but not throw)

### Integration Tests

1. **Discord webhook compatibility**
   ```bash
   # Set test webhook
   HEALTH_ALERT_WEBHOOK=https://discord.com/api/webhooks/TEST

   # Trigger test alert
   # (manually trigger health check failure)

   # Verify message appears in Discord
   ```

2. **Slack webhook compatibility**
   ```bash
   # Set test webhook
   HEALTH_ALERT_WEBHOOK=https://hooks.slack.com/services/TEST

   # Trigger test alert
   # Verify message appears in Slack channel
   ```

3. **Webhook.site inspection**
   - Create temporary webhook at webhook.site
   - Trigger various alert types
   - Inspect payload structure
   - Verify all alert types format correctly

### Load Testing

1. **Rapid alert bursts**
   - Trigger 10+ alerts simultaneously
   - Verify all webhooks fire
   - Check for rate limiting issues
   - Monitor memory/CPU usage

2. **Timeout behavior**
   - Point webhook at slow endpoint (mock 10s delay)
   - Verify 5 second timeout triggers
   - Confirm alert processing continues

### Pre-Deployment Validation

```bash
# Run full test suite
npm test

# Type checking
npm run build

# Lint check
npm run lint

# Manual smoke test
# 1. Set HEALTH_ALERT_WEBHOOK to test endpoint
# 2. Start bot
# 3. Manually trigger health check failure
# 4. Verify webhook POST appears in logs
# 5. Confirm external system received notification
```

## Rollback Plan

### If Webhook Integration Causes Issues

**Symptoms to watch for:**
- Increased latency in alert notifications
- Webhook timeout errors flooding logs
- Alerts not being created (if error handling is broken)
- Bot crashes due to unhandled fetch errors

**Immediate Rollback:**

```bash
# Revert the commit
git revert HEAD
git push origin main

# Or disable via environment variable
unset HEALTH_ALERT_WEBHOOK
pm2 restart pawtropolis-bot
```

**Validation After Rollback:**
- Verify alerts still log to Discord
- Check that health monitoring continues
- Confirm no webhook errors in logs

### If Webhook Endpoint Is Down

**Symptom:** Continuous webhook errors in logs

**Action:**
```bash
# Temporarily disable webhook without code change
unset HEALTH_ALERT_WEBHOOK
pm2 restart pawtropolis-bot
```

Alert system will continue working via Discord notifications.

### If Webhook Causes Performance Issues

**Symptom:** Alert notifications slow down bot

**Action:**
1. Add rate limiting to webhook calls:
   ```typescript
   // Limit webhook posts to 1 per minute per alert type
   const lastWebhookSent = new Map<string, number>();

   if (webhookUrl) {
     const now = Date.now();
     const lastSent = lastWebhookSent.get(alert.alert_type) || 0;

     if (now - lastSent < 60000) {
       logger.debug("webhook rate limit - skipping");
       return;
     }

     lastWebhookSent.set(alert.alert_type, now);
     // ... proceed with fetch
   }
   ```

2. Reduce timeout from 5s to 2s
3. Make webhook fire-and-forget (don't await response)

### If Payload Format Is Wrong

**Symptom:** External system rejects webhook payloads

**Action:**
1. Check external system's webhook documentation
2. Adjust `formatAlertMessage()` or payload structure
3. Add transformation layer for specific platforms:
   ```typescript
   // Example: PagerDuty Events API v2
   if (webhookUrl.includes('events.pagerduty.com')) {
     payload = {
       routing_key: process.env.PAGERDUTY_ROUTING_KEY,
       event_action: 'trigger',
       payload: {
         summary: formatAlertMessage(alert),
         severity: alert.severity === 'critical' ? 'critical' : 'warning',
         source: 'pawtropolis-tech-bot',
         custom_details: alert.meta,
       },
     };
   }
   ```

## Success Criteria

**For Option A (Implement):**
- [ ] Webhook POST fires when alert is triggered
- [ ] Payload includes all required fields (alert_id, type, severity, message, meta, timestamp)
- [ ] Error handling prevents webhook failures from breaking alert creation
- [ ] Timeout prevents slow endpoints from blocking alert processing
- [ ] Discord notifications still work (existing functionality preserved)
- [ ] Logs clearly show webhook success/failure
- [ ] Compatible with Slack, Discord, and generic webhook receivers
- [ ] Unit tests cover webhook logic (>80% coverage)
- [ ] Integration test confirms end-to-end webhook delivery
- [ ] Documentation updated with webhook configuration instructions

**For Option B (Remove):**
- [ ] `HEALTH_ALERT_WEBHOOK` environment variable removed from `env.ts`
- [ ] Webhook check block removed from `opsHealth.ts`
- [ ] No references to webhook functionality remain in codebase
- [ ] Tests still pass (no broken tests referencing webhooks)
- [ ] Documentation updated to clarify Discord-only notifications

## Monitoring & Alerts

### Recommended Metrics (Option A)

1. **Webhook success rate**
   - Metric: `opshealth.webhook.success_total` vs `opshealth.webhook.failure_total`
   - Alert if success rate <95% over 1 hour

2. **Webhook latency**
   - Metric: `opshealth.webhook.duration_ms`
   - Alert if P95 >4000ms (near timeout)

3. **Webhook errors by type**
   - Metric: `opshealth.webhook.error_total{type="timeout|network|http_error"}`
   - Alert if any error type >10/hour

4. **Alert delivery completeness**
   - Verify both Discord AND webhook fire for critical alerts
   - Alert if webhook fires but Discord doesn't (indicates regression)

### Log Patterns to Monitor

```bash
# Successful webhook deliveries
grep "webhook notification sent" logs/app.log

# Webhook failures
grep "webhook notification failed" logs/app.log

# Webhook errors (network, timeout, etc.)
grep "webhook notification error" logs/app.log

# Alert on high error rate
grep "webhook notification" logs/app.log | grep -E "failed|error" | wc -l
```

## Timeline

**Option A (Implement Webhooks):**
1. **Day 1 Morning:** Implementation (Steps 1-2) - 1 hour
2. **Day 1 Afternoon:** Unit tests (Step 3) - 30 minutes
3. **Day 2 Morning:** Integration testing (Step 4) - 30 minutes
4. **Day 2 Afternoon:** Documentation (Step 5) - 15 minutes
5. **Day 3:** Deploy to staging and test with real webhooks
6. **Day 4:** Deploy to production and monitor

**Total development time:** 2.25 hours
**Total time including testing/deployment:** 4 days

**Option B (Remove Dead Code):**
1. **Day 1:** Remove code and tests - 15 minutes
2. **Day 1:** Verify build and run smoke tests - 10 minutes
3. **Day 1:** Deploy and monitor - 5 minutes

**Total time:** 30 minutes

## Future Improvements

If webhook implementation proves successful, consider:

1. **Platform-specific payload formatting**
   - Auto-detect webhook URL (slack.com, discord.com, pagerduty.com)
   - Format payload according to platform's webhook API
   - Support multiple webhooks (array of URLs)

2. **Webhook retry logic**
   - Retry failed POSTs with exponential backoff
   - Store failed webhooks in database for manual replay
   - Alert on repeated webhook failures

3. **Webhook authentication**
   - Support HMAC signature headers (for Slack, Discord verification)
   - Support Bearer token authentication
   - Environment variable for webhook secret

4. **Batched notifications**
   - Group multiple alerts into single webhook POST
   - Reduce notification spam during incidents
   - Configurable batch window (e.g., 5 minutes)

5. **Webhook templating**
   - Allow custom message templates via config
   - Support platform-specific rich formatting (Slack blocks, Discord embeds)
   - Template variables for alert fields

## Additional Notes

### Why This Was Left Unfinished

The TODO comment suggests this was deprioritized: "For now, Discord is enough." This is reasonable for early development but becomes a limitation as the bot scales to production use. Discord notifications require:
- Someone actively monitoring Discord
- No way to page on-call engineers
- No integration with incident management tools
- No alerting during Discord outages

### Alternative: Use Discord Webhooks as Interim Solution

If implementing generic webhook POSTs is deemed too complex, the minimum viable solution is:

```typescript
// Quick fix: Discord webhook format
if (webhookUrl) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: formatAlertMessage(alert),
      embeds: [{
        title: `${alert.severity.toUpperCase()} Alert`,
        description: formatAlertMessage(alert),
        color: alert.severity === 'critical' ? 0xFF0000 : 0xFFA500,
        timestamp: new Date(alert.triggered_at * 1000).toISOString(),
      }],
    }),
  });
}
```

This works with Discord webhooks immediately and can be expanded later.

### Related Issues

- **Issue #10 (Memory Leak):** If webhook integration adds memory pressure, review in conjunction with forwardedMessages Map fix
- **Issue #11 (Timestamp Formats):** Webhook payload uses ISO 8601 timestamps - ensure consistency with timestamp standardization effort
- **Health Check Intervals:** Webhook frequency is tied to health check interval (env var `HEALTH_CHECK_INTERVAL_SECONDS`) - ensure webhook receivers can handle the load

---

## Decision

**Recommendation:** Implement Option A (Webhook Integration)

**Justification:**
1. Minimal effort (2-3 hours) for significant operational value
2. Feature was clearly intended (env var exists)
3. Production-ready operations require external alerting
4. No new dependencies (uses built-in `fetch`)
5. Can be incrementally improved (start simple, add features later)

**Next Steps:**
1. Confirm decision with project owner
2. If approved, proceed with implementation plan
3. If rejected, execute Option B (dead code removal)
