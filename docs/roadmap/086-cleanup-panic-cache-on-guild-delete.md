# Issue #86: Cleanup panicCache on Guild Delete

**Status:** Completed
**Priority:** Medium
**Type:** Memory Leak Prevention
**Estimated Effort:** 15 minutes

---

## Summary

`panicCache` in `src/features/panicStore.ts` stores panic mode flags for guilds but never removes entries when guilds are deleted (bot kicked).

## Current State

```typescript
// src/features/panicStore.ts
const panicCache = new Map<string, boolean>();

export function setPanicMode(guildId: string, enabled: boolean): void {
  panicCache.set(guildId, enabled);
  // ...
}

// NO cleanup when guilds are removed
```

## Impact

- Memory leak proportional to guild churn rate
- Entries accumulate for guilds that no longer exist
- Over time with many guild joins/leaves, cache grows unbounded

## Proposed Changes

1. Add cleanup function to panicStore:

```typescript
// src/features/panicStore.ts
export function clearPanicCache(guildId: string): void {
  panicCache.delete(guildId);
  logger.debug({ guildId }, "[panic] Cleared cache entry for departed guild");
}
```

2. Call cleanup in guildDelete event:

```typescript
// src/index.ts - in guildDelete handler
import { clearPanicCache } from "./features/panicStore.js";

client.on("guildDelete", wrapEvent("guildDelete", async (guild) => {
  // ... existing logging ...

  // Cleanup caches for departed guild
  clearPanicCache(guild.id);
  // Also clear other guild-specific caches:
  // clearConfigCache(guild.id);
  // clearLoggingCache(guild.id);
  // etc.
}));
```

3. Consider adding cleanup to other caches:
- configCache
- loggingChannelCache
- flaggerConfigCache

## Files Affected

- `src/features/panicStore.ts`
- `src/index.ts` (guildDelete handler)
- `src/lib/config.ts` (add clearCache function)
- `src/config/loggingStore.ts` (add clearCache function)
- `src/config/flaggerStore.ts` (add clearCache function)

## Testing Strategy

1. Simulate bot being removed from guild
2. Verify cache entry is deleted
3. Monitor memory usage with guild churn
