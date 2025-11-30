/**
 * Pawtropolis Tech — src/lib/lruCache.ts
 * WHAT: Generic LRU (Least Recently Used) cache with TTL support.
 * WHY: Prevents unbounded memory growth in caches that would otherwise grow
 *      proportionally to guild count. Replaces plain Maps with size limits.
 * DOCS:
 *  - LRU algorithm: https://en.wikipedia.org/wiki/Cache_replacement_policies#LRU
 *  - Map iteration order: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
 *
 * IMPLEMENTATION NOTES:
 *  - Uses Map's insertion-order iteration for LRU ordering
 *  - Delete-then-reinsert moves entries to "most recently used" position
 *  - Evicts oldest (first) entry when at capacity
 *  - TTL check happens on get() - lazy expiration
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * LRUCache<K, V>
 * WHAT: A bounded cache with LRU eviction and TTL expiration.
 * WHY: Standard Maps grow unbounded; this provides memory safety for caches
 *      that could grow with guild count.
 *
 * @template K - Key type (typically string for guild IDs)
 * @template V - Value type (the cached data)
 *
 * @example
 * const cache = new LRUCache<string, GuildConfig>(1000, 5 * 60 * 1000);
 * cache.set('guild-123', config);
 * const config = cache.get('guild-123'); // Returns config or undefined
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>();
  private maxSize: number;
  private ttlMs: number;

  /**
   * Create a new LRU cache.
   *
   * @param maxSize - Maximum number of entries before eviction (must be > 0)
   * @param ttlMs - Time-to-live in milliseconds (must be > 0)
   * @throws Error if maxSize or ttlMs are not positive numbers
   */
  constructor(maxSize: number, ttlMs: number) {
    if (maxSize <= 0) {
      throw new Error("LRUCache maxSize must be a positive number");
    }
    if (ttlMs <= 0) {
      throw new Error("LRUCache ttlMs must be a positive number");
    }
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a value from the cache.
   *
   * BEHAVIOR:
   *  - Returns undefined if key not found
   *  - Returns undefined and deletes entry if TTL expired
   *  - Moves entry to "most recently used" position on hit
   *
   * @param key - The cache key
   * @returns The cached value or undefined
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used) by delete + re-insert
    // Map maintains insertion order, so this moves the entry to last position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  /**
   * Set a value in the cache.
   *
   * BEHAVIOR:
   *  - If key exists, updates value and moves to MRU position
   *  - If at capacity, evicts least recently used entry (first in Map)
   *  - Sets timestamp to current time
   *
   * @param key - The cache key
   * @param value - The value to cache
   */
  set(key: K, value: V): void {
    // If key exists, delete first to maintain proper LRU order on update
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Check if a key exists and is not expired.
   *
   * NOTE: Does NOT update LRU order (read-only check).
   *
   * @param key - The cache key
   * @returns true if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache.
   *
   * @param key - The cache key to delete
   * @returns true if key was found and deleted, false otherwise
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of entries in the cache.
   * NOTE: May include expired entries that haven't been lazily cleaned.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum size of the cache.
   */
  get maxEntries(): number {
    return this.maxSize;
  }

  /**
   * Get the TTL in milliseconds.
   */
  get ttl(): number {
    return this.ttlMs;
  }
}
