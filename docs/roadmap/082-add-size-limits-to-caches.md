# Issue #82: Add Size Limits to Unbounded Cache Maps

**Status:** Completed
**Priority:** High
**Type:** Memory Leak Prevention
**Estimated Effort:** 1 hour

---

## Summary

Five cache Maps have TTL-based expiration but no size limits, allowing unbounded memory growth proportional to guild count.

## Affected Caches

1. **configCache** - `src/lib/config.ts:77-78`
2. **loggingChannelCache** - `src/config/loggingStore.ts:28`
3. **flaggerConfigCache** - `src/config/flaggerStore.ts:35`
4. **draftsCache** - `src/commands/listopen.ts:55-56`
5. **_metricsCache** - `src/features/modPerformance.ts:71-73`

## Current State

```typescript
// Example from config.ts
const configCache = new Map<string, { config: GuildConfig; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// NO size limit, NO active eviction - only lazy eviction on access
```

## Impact

- Memory grows proportionally to number of guilds ever accessed
- Old entries only removed when accessed (lazy eviction)
- In multi-thousand guild deployment, could consume significant memory

## Proposed Changes

1. Create a reusable LRU cache utility:

```typescript
// src/lib/lruCache.ts
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

2. Replace existing caches:

```typescript
// config.ts
const configCache = new LRUCache<string, GuildConfig>(1000, 5 * 60 * 1000);

// loggingStore.ts
const loggingChannelCache = new LRUCache<string, string | null>(1000, 5 * 60 * 1000);

// etc.
```

## Files Affected

- `src/lib/lruCache.ts` (new)
- `src/lib/config.ts`
- `src/config/loggingStore.ts`
- `src/config/flaggerStore.ts`
- `src/commands/listopen.ts`
- `src/features/modPerformance.ts`

## Testing Strategy

1. Unit test LRUCache class
2. Test cache eviction when at capacity
3. Test TTL expiration still works
4. Monitor memory usage before/after
