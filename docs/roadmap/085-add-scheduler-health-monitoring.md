# Issue #85: Add Health Monitoring for Scheduler Failures

**Status:** Completed
**Priority:** High
**Type:** Observability
**Estimated Effort:** 45 minutes

---

## Summary

Scheduler failures (modMetrics, opsHealth, staleApplicationCheck) are logged but have no recovery mechanism, health monitoring, or admin alerting.

## Current State

```typescript
// src/scheduler/modMetricsScheduler.ts:81-83
refreshAllGuildMetrics(client).catch((err) => {
  logger.error({ err }, "[metrics] initial refresh failed");
  // ⚠️ Error logged but no recovery or retry
});

const interval = setInterval(() => {
  refreshAllGuildMetrics(client).catch((err) => {
    logger.error({ err }, "[metrics] scheduled refresh failed");
    // ⚠️ Metrics will remain stale until next interval
  });
}, REFRESH_INTERVAL_MS);
```

## Impact

- Schedulers fail silently - admins won't know metrics/health checks are stale
- No circuit breaker or exponential backoff on repeated failures
- No alerting when schedulers consistently fail
- Hard to diagnose intermittent issues

## Proposed Changes

1. Create scheduler health tracking utility:

```typescript
// src/lib/schedulerHealth.ts
interface SchedulerHealth {
  name: string;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalFailures: number;
}

const schedulerHealth = new Map<string, SchedulerHealth>();

export function recordSchedulerRun(name: string, success: boolean): void {
  const health = schedulerHealth.get(name) || {
    name,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    totalFailures: 0,
  };

  health.lastRunAt = Date.now();
  health.totalRuns++;

  if (success) {
    health.lastSuccessAt = Date.now();
    health.consecutiveFailures = 0;
  } else {
    health.lastErrorAt = Date.now();
    health.consecutiveFailures++;
    health.totalFailures++;
  }

  schedulerHealth.set(name, health);

  // Alert if consecutive failures exceed threshold
  if (health.consecutiveFailures >= 3) {
    logger.error({
      scheduler: name,
      consecutiveFailures: health.consecutiveFailures,
    }, "[scheduler] Multiple consecutive failures - requires attention");
  }
}

export function getSchedulerHealth(): Map<string, SchedulerHealth> {
  return schedulerHealth;
}
```

2. Update schedulers to use health tracking:

```typescript
// src/scheduler/modMetricsScheduler.ts
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const interval = setInterval(async () => {
  try {
    await refreshAllGuildMetrics(client);
    recordSchedulerRun("modMetrics", true);
  } catch (err) {
    recordSchedulerRun("modMetrics", false);
    logger.error({ err }, "[metrics] scheduled refresh failed");
  }
}, REFRESH_INTERVAL_MS);
```

3. Add /health subcommand to show scheduler status:

```typescript
// In health command
const schedulerStatus = getSchedulerHealth();
for (const [name, health] of schedulerStatus) {
  // Show status in health embed
}
```

## Files Affected

- `src/lib/schedulerHealth.ts` (new)
- `src/scheduler/modMetricsScheduler.ts`
- `src/scheduler/opsHealthScheduler.ts`
- `src/scheduler/staleApplicationCheck.ts`
- `src/commands/health.ts`

## Testing Strategy

1. Mock scheduler failures
2. Verify consecutive failure counter works
3. Test alert logging at threshold
4. Check health command shows scheduler status
