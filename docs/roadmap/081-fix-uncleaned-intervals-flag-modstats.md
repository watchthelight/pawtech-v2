# Issue #81: Fix Uncleaned setInterval in flag.ts and modstats.ts

**Status:** Completed
**Priority:** Critical
**Type:** Memory Leak / Shutdown Issue
**Estimated Effort:** 20 minutes

---

## Summary

`src/commands/flag.ts` and `src/commands/modstats.ts` both have setInterval calls without `.unref()` and no cleanup mechanism, preventing graceful shutdown.

## Current State

### flag.ts (lines 39-56)
```typescript
// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of flagCooldowns) {
    if (now - timestamp > FLAG_COOLDOWN_TTL_MS) {
      flagCooldowns.delete(key);
    }
  }
}, 5 * 60 * 1000);
// MISSING: .unref() and no way to clear on shutdown
```

### modstats.ts (lines 569-576)
```typescript
// Cleanup expired entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of resetRateLimiter) {
    if (now - timestamp > RESET_COOLDOWN_TTL_MS) {
      resetRateLimiter.delete(userId);
    }
  }
}, 60 * 60 * 1000);
// MISSING: .unref() and no way to clear on shutdown
```

## Impact

- Bot cannot exit cleanly while these intervals are active
- Intervals keep the process alive, preventing graceful shutdown
- No cleanup during testing or hot reload

## Proposed Changes

### Fix flag.ts

```typescript
let flagCooldownInterval: NodeJS.Timeout | null = null;

// Start cleanup interval
flagCooldownInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of flagCooldowns) {
    if (now - timestamp > FLAG_COOLDOWN_TTL_MS) {
      flagCooldowns.delete(key);
    }
  }
}, 5 * 60 * 1000);
flagCooldownInterval.unref();

// Export cleanup function
export function cleanupFlagCooldowns(): void {
  if (flagCooldownInterval) {
    clearInterval(flagCooldownInterval);
    flagCooldownInterval = null;
  }
  flagCooldowns.clear();
}
```

### Fix modstats.ts

```typescript
let resetRateLimiterInterval: NodeJS.Timeout | null = null;

resetRateLimiterInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of resetRateLimiter) {
    if (now - timestamp > RESET_COOLDOWN_TTL_MS) {
      resetRateLimiter.delete(userId);
    }
  }
}, 60 * 60 * 1000);
resetRateLimiterInterval.unref();

export function cleanupModstatsRateLimiter(): void {
  if (resetRateLimiterInterval) {
    clearInterval(resetRateLimiterInterval);
    resetRateLimiterInterval = null;
  }
  resetRateLimiter.clear();
}
```

### Add to shutdown handler in index.ts

```typescript
// In shutdown handler
cleanupFlagCooldowns();
cleanupModstatsRateLimiter();
```

## Files Affected

- `src/commands/flag.ts:39-56`
- `src/commands/modstats.ts:569-576`
- `src/index.ts` (shutdown handler)

## Testing Strategy

1. Start bot, then gracefully shutdown (Ctrl+C)
2. Verify process exits within reasonable time
3. Run tests that start/stop bot multiple times
