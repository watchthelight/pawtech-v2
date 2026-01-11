/**
 * Pawtropolis Tech — src/lib/traceStore.ts
 * WHAT: In-memory trace storage with LRU eviction and TTL expiration
 * WHY: Enable /developer trace command to look up recent traces by ID
 * FLOWS:
 *  - storeTrace(event) → add to cache, prune if needed
 *  - getTrace(traceId) → lookup from cache, return if not expired
 *  - pruneExpired() → remove stale entries (called automatically)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { WideEvent } from "./wideEvent.js";

// ===== Configuration =====

/** Maximum number of traces to keep in memory */
const MAX_TRACES = 500;

/** Time-to-live for traces in milliseconds (30 minutes) */
const TTL_MS = 30 * 60_000;

/** How often to run automatic pruning (5 minutes) */
const PRUNE_INTERVAL_MS = 5 * 60_000;

// ===== Storage =====

interface StoredTrace {
  event: WideEvent;
  storedAt: number;
}

const cache = new Map<string, StoredTrace>();

// ===== Public API =====

/**
 * Store a trace for later retrieval.
 * Automatically prunes expired entries and enforces max size.
 */
export function storeTrace(event: WideEvent): void {
  const now = Date.now();

  // Store the trace
  cache.set(event.traceId, {
    event,
    storedAt: now,
  });

  // Enforce max size by removing oldest entries
  if (cache.size > MAX_TRACES) {
    // Map maintains insertion order, so first entries are oldest
    const keysToDelete: string[] = [];
    let count = 0;
    const excess = cache.size - MAX_TRACES;

    for (const key of cache.keys()) {
      if (count >= excess) break;
      keysToDelete.push(key);
      count++;
    }

    for (const key of keysToDelete) {
      cache.delete(key);
    }
  }
}

/**
 * Retrieve a trace by ID.
 * Returns null if not found or expired.
 */
export function getTrace(traceId: string): WideEvent | null {
  const stored = cache.get(traceId);
  if (!stored) return null;

  // Check if expired
  const now = Date.now();
  if (now - stored.storedAt > TTL_MS) {
    cache.delete(traceId);
    return null;
  }

  return stored.event;
}

/**
 * Remove all expired traces from the cache.
 */
export function pruneExpired(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];

  for (const [key, stored] of cache.entries()) {
    if (now - stored.storedAt > TTL_MS) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    cache.delete(key);
  }
}

/**
 * Get cache statistics for diagnostics.
 */
export function getTraceStats(): { size: number; maxSize: number; ttlMinutes: number } {
  return {
    size: cache.size,
    maxSize: MAX_TRACES,
    ttlMinutes: TTL_MS / 60_000,
  };
}

/**
 * Clear all traces (for testing).
 */
export function clearTraces(): void {
  cache.clear();
}

// ===== Automatic Pruning =====

// Run pruning periodically to clean up expired entries
// This prevents memory growth from long-lived bot instances
let pruneInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoPrune(): void {
  if (pruneInterval) return; // Already running
  pruneInterval = setInterval(pruneExpired, PRUNE_INTERVAL_MS);
  // Don't prevent Node from exiting
  pruneInterval.unref();
}

export function stopAutoPrune(): void {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

// Start auto-pruning on module load
startAutoPrune();
