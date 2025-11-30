/**
 * Pawtropolis Tech — src/lib/notifyLimiter.ts
 * WHAT: Rate limiter for forum post notifications to prevent abuse
 * WHY: Protect against mass thread creation spam (malicious or accidental)
 * FLOWS:
 *  - canNotify() checks cooldown + hourly cap
 *  - recordNotify() increments counters
 *  - cleanup() removes old timestamps
 * MULTI-INSTANCE: In-memory implementation works for single process only.
 *   Multi-instance deployments will require a distributed solution (Redis, etc.)
 *   if notification rate limits need to be coordinated across instances.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";
import type { NotifyConfig } from "../features/notifyConfig.js";

interface RateLimitCheck {
  ok: boolean;
  reason?: string;
}

// Maximum timestamps to keep per guild (prevents memory exhaustion between cleanup cycles)
const MAX_TIMESTAMPS_PER_GUILD = 100;

interface GuildNotifyState {
  // Bounded array - limited to MAX_TIMESTAMPS_PER_GUILD entries
  // Cleanup happens both on record (immediate eviction) and periodically (every 5 min)
  timestamps: number[]; // Last N notification timestamps (epoch ms)
  lastNotifyAt: number; // Last notification timestamp (epoch ms)
}

/**
 * WHAT: Abstract interface for notify rate limiter
 * WHY: Enables testability and future extensibility
 */
export interface INotifyLimiter {
  canNotify(guildId: string, config: NotifyConfig): RateLimitCheck;
  recordNotify(guildId: string): void;
  cleanup(): void;
}

/**
 * WHAT: In-memory rate limiter for forum post notifications
 * WHY: Simple implementation for single-instance deployments
 * LIMITATIONS: Does not coordinate across multiple bot instances
 */
export class InMemoryNotifyLimiter implements INotifyLimiter {
  private state: Map<string, GuildNotifyState> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 5-minute cleanup interval chosen to balance memory efficiency vs CPU overhead.
    // At 10k guilds with 60 notifies/hour each, worst case is ~600k timestamps
    // before cleanup runs. If that's too much, tune the interval down.
    //
    // unref() allows Node.js to exit even if this interval is still pending,
    // preventing the interval from keeping the process alive during graceful shutdown.
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  /**
   * WHAT: Check if guild can send a notification now
   * WHY: Enforce cooldown and hourly cap
   *
   * @param guildId - Guild snowflake
   * @param config - Guild notification config
   * @returns {ok: true} if allowed, {ok: false, reason: string} if blocked
   */
  canNotify(guildId: string, config: NotifyConfig): RateLimitCheck {
    const now = Date.now();
    const cooldownMs = (config.notify_cooldown_seconds || 5) * 1000;
    const maxPerHour = config.notify_max_per_hour || 10;

    const guildState = this.state.get(guildId);

    // Check cooldown
    if (guildState) {
      const timeSinceLastNotify = now - guildState.lastNotifyAt;
      if (timeSinceLastNotify < cooldownMs) {
        return {
          ok: false,
          reason: `cooldown_active (${Math.ceil((cooldownMs - timeSinceLastNotify) / 1000)}s remaining)`,
        };
      }

      // Check hourly cap - O(n) filter on each check. Fine for small arrays
      // but if timestamps array grows large, consider pre-filtering in recordNotify
      // or using a sorted structure with binary search.
      const oneHourAgo = now - 60 * 60 * 1000;
      const recentNotifications = guildState.timestamps.filter((ts) => ts > oneHourAgo);

      if (recentNotifications.length >= maxPerHour) {
        return {
          ok: false,
          reason: `hourly_cap_reached (${recentNotifications.length}/${maxPerHour})`,
        };
      }
    }

    return { ok: true };
  }

  /**
   * WHAT: Record a notification sent for guild
   * WHY: Update rate limit counters
   *
   * @param guildId - Guild snowflake
   */
  recordNotify(guildId: string): void {
    const now = Date.now();
    const guildState = this.state.get(guildId) || { timestamps: [], lastNotifyAt: 0 };

    // No deduplication - callers are responsible for only calling this after
    // successful notification sends. Double-calling will mess up rate limits.
    guildState.timestamps.push(now);
    guildState.lastNotifyAt = now;

    // Immediate eviction if array grows too large (prevents runaway growth between cleanup cycles)
    if (guildState.timestamps.length > MAX_TIMESTAMPS_PER_GUILD) {
      const oneHourAgo = now - 60 * 60 * 1000;
      guildState.timestamps = guildState.timestamps.filter(ts => ts > oneHourAgo);
    }

    this.state.set(guildId, guildState);
  }

  /**
   * WHAT: Remove old timestamps to prevent memory leak
   * WHY: Keep state map bounded
   */
  cleanup(): void {
    // PERF: This is O(n*m) where n=guilds, m=timestamps per guild.
    // For most bots this is trivial. If you're at 100k+ guilds, consider
    // batching cleanup or moving to Redis with native TTLs.
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    let cleanedGuilds = 0;

    for (const [guildId, state] of this.state.entries()) {
      // Remove timestamps older than 1 hour
      const recentTimestamps = state.timestamps.filter((ts) => ts > oneHourAgo);

      if (recentTimestamps.length === 0 && now - state.lastNotifyAt > 60 * 60 * 1000) {
        // No recent activity, remove guild
        this.state.delete(guildId);
        cleanedGuilds++;
      } else {
        state.timestamps = recentTimestamps;
        this.state.set(guildId, state);
      }
    }

    if (cleanedGuilds > 0) {
      logger.debug({ cleanedGuilds }, "[notifyLimiter] cleanup completed");
    }
  }

  /**
   * WHAT: Stop cleanup interval (for tests/shutdown)
   * WHY: Prevent memory leaks
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * WHAT: Global rate limiter instance
 * WHY: Shared across all event handlers
 *
 * MULTI-INSTANCE: This in-memory implementation does not coordinate across bot instances
 */
export const notifyLimiter: INotifyLimiter = new InMemoryNotifyLimiter();

logger.info("[notifyLimiter] initialized in-memory rate limiter");
