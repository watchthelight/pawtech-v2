# Issue #87: Use Promise.allSettled for Analytics Queries

**Status:** Completed
**Priority:** Medium
**Type:** Reliability / UX
**Estimated Effort:** 30 minutes

---

## Summary

Analytics command uses `Promise.all` for 5 independent queries - if one fails, the entire analytics request fails instead of showing partial results.

## Current State

```typescript
// src/features/analytics/command.ts:176
const [actionCounts, topReasons, volumeSeries, leadTimeStats, queueAge] = await Promise.all([
  Promise.resolve(getActionCountsByMod({ guildId: scope, from: window.from, to: window.to })),
  Promise.resolve(getTopRejectionReasons({ guildId: scope, from: window.from, to: window.to, limit: 5 })),
  Promise.resolve(getVolumeTimeSeries({ guildId: scope, from: window.from, to: window.to, buckets: 7 })),
  Promise.resolve(getLeadTimeStats({ guildId: scope, from: window.from, to: window.to })),
  Promise.resolve(getCurrentQueueAge(scope)),
]);
```

## Impact

- One failed query prevents all results from being displayed
- These are independent readonly queries - partial results would be valuable
- User gets no data instead of degraded experience

## Proposed Changes

1. Switch to Promise.allSettled:

```typescript
const results = await Promise.allSettled([
  getActionCountsByMod({ guildId: scope, from: window.from, to: window.to }),
  getTopRejectionReasons({ guildId: scope, from: window.from, to: window.to, limit: 5 }),
  getVolumeTimeSeries({ guildId: scope, from: window.from, to: window.to, buckets: 7 }),
  getLeadTimeStats({ guildId: scope, from: window.from, to: window.to }),
  getCurrentQueueAge(scope),
]);

// Extract results, using null/defaults for failures
const actionCounts = results[0].status === 'fulfilled' ? results[0].value : null;
const topReasons = results[1].status === 'fulfilled' ? results[1].value : [];
const volumeSeries = results[2].status === 'fulfilled' ? results[2].value : [];
const leadTimeStats = results[3].status === 'fulfilled' ? results[3].value : null;
const queueAge = results[4].status === 'fulfilled' ? results[4].value : null;

// Log any failures
const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  logger.warn({
    guildId: scope,
    failedQueries: failures.length,
  }, "[analytics] Some queries failed - showing partial results");
}
```

2. Update embed generation to handle null values:

```typescript
// Show warning in embed if partial results
if (failures.length > 0) {
  embed.addFields({
    name: "⚠️ Partial Results",
    value: `${failures.length} of 5 data sources unavailable`,
    inline: false,
  });
}

// Handle null values in each section
if (actionCounts) {
  // Add action counts section
} else {
  embed.addFields({
    name: "Action Counts",
    value: "Data unavailable",
    inline: true,
  });
}
```

## Files Affected

- `src/features/analytics/command.ts`

## Testing Strategy

1. Mock one query to throw
2. Verify other data still displays
3. Verify warning message appears
4. Test with all queries failing (should show error)
5. Test with all queries succeeding (no warning)
