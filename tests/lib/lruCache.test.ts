/**
 * Pawtropolis Tech -- tests/lib/lruCache.test.ts
 * WHAT: Unit tests for the LRU cache utility.
 * WHY: Ensures bounded cache behavior, TTL expiration, and LRU eviction work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LRUCache } from "../../src/lib/lruCache.js";

describe("LRUCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("throws if maxSize is zero", () => {
      expect(() => new LRUCache<string, string>(0, 1000)).toThrow(
        "LRUCache maxSize must be a positive number"
      );
    });

    it("throws if maxSize is negative", () => {
      expect(() => new LRUCache<string, string>(-1, 1000)).toThrow(
        "LRUCache maxSize must be a positive number"
      );
    });

    it("throws if ttlMs is zero", () => {
      expect(() => new LRUCache<string, string>(10, 0)).toThrow(
        "LRUCache ttlMs must be a positive number"
      );
    });

    it("throws if ttlMs is negative", () => {
      expect(() => new LRUCache<string, string>(10, -1000)).toThrow(
        "LRUCache ttlMs must be a positive number"
      );
    });

    it("creates cache with valid parameters", () => {
      const cache = new LRUCache<string, string>(100, 60000);
      expect(cache.maxEntries).toBe(100);
      expect(cache.ttl).toBe(60000);
      expect(cache.size).toBe(0);
    });
  });

  describe("basic operations", () => {
    it("stores and retrieves values", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      cache.set("key1", 100);
      cache.set("key2", 200);

      expect(cache.get("key1")).toBe(100);
      expect(cache.get("key2")).toBe(200);
    });

    it("returns undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("overwrites existing values", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      cache.set("key", 100);
      cache.set("key", 200);

      expect(cache.get("key")).toBe(200);
      expect(cache.size).toBe(1);
    });

    it("deletes values", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      cache.set("key", 100);

      expect(cache.delete("key")).toBe(true);
      expect(cache.get("key")).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it("returns false when deleting nonexistent key", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      expect(cache.delete("nonexistent")).toBe(false);
    });

    it("clears all values", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      cache.set("key1", 100);
      cache.set("key2", 200);
      cache.set("key3", 300);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBeUndefined();
    });
  });

  describe("has()", () => {
    it("returns true for existing, non-expired keys", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      cache.set("key", 100);

      expect(cache.has("key")).toBe(true);
    });

    it("returns false for non-existing keys", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("returns false and cleans up expired keys", () => {
      const cache = new LRUCache<string, number>(10, 1000); // 1 second TTL
      cache.set("key", 100);

      vi.advanceTimersByTime(1001);

      expect(cache.has("key")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("does not update LRU order", () => {
      const cache = new LRUCache<string, number>(2, 60000);
      cache.set("key1", 100);
      cache.set("key2", 200);

      // has() should not move key1 to MRU
      cache.has("key1");

      // Add key3, which should evict key1 (oldest) not key2
      cache.set("key3", 300);

      expect(cache.get("key1")).toBeUndefined(); // evicted
      expect(cache.get("key2")).toBe(200);
      expect(cache.get("key3")).toBe(300);
    });
  });

  describe("TTL expiration", () => {
    it("returns undefined for expired entries", () => {
      const cache = new LRUCache<string, number>(10, 1000); // 1 second TTL
      cache.set("key", 100);

      expect(cache.get("key")).toBe(100);

      vi.advanceTimersByTime(1001);

      expect(cache.get("key")).toBeUndefined();
    });

    it("cleans up expired entries on access", () => {
      const cache = new LRUCache<string, number>(10, 1000);
      cache.set("key", 100);

      vi.advanceTimersByTime(1001);

      cache.get("key"); // Should delete expired entry
      // Size may still show 0 after cleanup on get
      expect(cache.get("key")).toBeUndefined();
    });

    it("entries at exactly TTL boundary are expired", () => {
      const cache = new LRUCache<string, number>(10, 1000);
      cache.set("key", 100);

      // Advance exactly to TTL - should still be valid at 999ms
      vi.advanceTimersByTime(999);
      expect(cache.get("key")).toBe(100);

      // Advance one more ms - now expired
      vi.advanceTimersByTime(2);
      expect(cache.get("key")).toBeUndefined();
    });

    it("each entry has independent expiration time", () => {
      const cache = new LRUCache<string, number>(10, 1000);

      cache.set("key1", 100);
      vi.advanceTimersByTime(500);
      cache.set("key2", 200);

      // key1 should expire after 500ms more
      vi.advanceTimersByTime(501);

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe(200);
    });
  });

  describe("LRU eviction", () => {
    it("evicts least recently used entry when at capacity", () => {
      const cache = new LRUCache<string, number>(3, 60000);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Cache is full, add new entry
      cache.set("d", 4);

      // "a" should be evicted as it was oldest
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.size).toBe(3);
    });

    it("accessing an entry moves it to MRU position", () => {
      const cache = new LRUCache<string, number>(3, 60000);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Access "a" - moves it to MRU
      cache.get("a");

      // Add new entry - should evict "b" (now oldest)
      cache.set("d", 4);

      expect(cache.get("a")).toBe(1); // still present
      expect(cache.get("b")).toBeUndefined(); // evicted
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("updating an entry moves it to MRU position", () => {
      const cache = new LRUCache<string, number>(3, 60000);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Update "a" - moves it to MRU
      cache.set("a", 10);

      // Add new entry - should evict "b" (now oldest)
      cache.set("d", 4);

      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("handles repeated evictions correctly", () => {
      const cache = new LRUCache<string, number>(2, 60000);

      // Fill and then continuously add
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i);
      }

      // Only last 2 should remain
      expect(cache.size).toBe(2);
      expect(cache.get("key8")).toBe(8);
      expect(cache.get("key9")).toBe(9);
    });

    it("evicts correctly with maxSize of 1", () => {
      const cache = new LRUCache<string, number>(1, 60000);

      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.size).toBe(1);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
    });
  });

  describe("property accessors", () => {
    it("size reflects current entry count", () => {
      const cache = new LRUCache<string, number>(10, 60000);

      expect(cache.size).toBe(0);

      cache.set("a", 1);
      expect(cache.size).toBe(1);

      cache.set("b", 2);
      expect(cache.size).toBe(2);

      cache.delete("a");
      expect(cache.size).toBe(1);
    });

    it("maxEntries returns configured max size", () => {
      const cache = new LRUCache<string, number>(42, 60000);
      expect(cache.maxEntries).toBe(42);
    });

    it("ttl returns configured TTL", () => {
      const cache = new LRUCache<string, number>(10, 12345);
      expect(cache.ttl).toBe(12345);
    });
  });

  describe("type support", () => {
    it("works with object values", () => {
      interface Config {
        name: string;
        value: number;
      }

      const cache = new LRUCache<string, Config>(10, 60000);
      cache.set("config1", { name: "test", value: 42 });

      const result = cache.get("config1");
      expect(result).toEqual({ name: "test", value: 42 });
    });

    it("works with array values", () => {
      const cache = new LRUCache<string, number[]>(10, 60000);
      cache.set("arr", [1, 2, 3]);

      expect(cache.get("arr")).toEqual([1, 2, 3]);
    });

    it("works with null values", () => {
      const cache = new LRUCache<string, string | null>(10, 60000);
      cache.set("nullable", null);

      // Note: null is a valid cached value, distinct from undefined (not found)
      expect(cache.get("nullable")).toBeNull();
      expect(cache.has("nullable")).toBe(true);
    });

    it("works with numeric keys", () => {
      const cache = new LRUCache<number, string>(10, 60000);
      cache.set(123, "value");

      expect(cache.get(123)).toBe("value");
    });
  });

  describe("edge cases", () => {
    it("handles empty string keys", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      cache.set("", 100);

      expect(cache.get("")).toBe(100);
    });

    it("handles very long keys", () => {
      const cache = new LRUCache<string, number>(10, 60000);
      const longKey = "a".repeat(10000);
      cache.set(longKey, 100);

      expect(cache.get(longKey)).toBe(100);
    });

    it("handles setting same key multiple times rapidly", () => {
      const cache = new LRUCache<string, number>(10, 60000);

      for (let i = 0; i < 100; i++) {
        cache.set("key", i);
      }

      expect(cache.get("key")).toBe(99);
      expect(cache.size).toBe(1);
    });
  });
});
