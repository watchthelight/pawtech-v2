/**
 * Pawtropolis Tech — src/lib/notifyLimiter.ts
 * WHAT: Rate limiter for forum post notifications to prevent abuse
 * WHY: Protect against mass thread creation spam (malicious or accidental)
 * FLOWS:
 *  - canNotify() checks cooldown + hourly cap
 *  - recordNotify() increments counters
 *  - cleanup() removes old timestamps
 * MULTI-INSTANCE: In-memory implementation works for single process only.
 *   For multi-instance deployments, implement RedisNotifyLimiter adapter.
 * DOCS:
 *  - See docs/adr/redis-notify-limiter.md for Redis migration guide
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";

interface NotifyConfig {
  notify_cooldown_seconds?: number;
  notify_max_per_hour?: number;
}

interface RateLimitCheck {
  ok: boolean;
  reason?: string;
}

interface GuildNotifyState {
  timestamps: number[]; // Last N notification timestamps (epoch ms)
  lastNotifyAt: number; // Last notification timestamp (epoch ms)
}

/**
 * WHAT: Abstract interface for notify rate limiter
 * WHY: Allow pluggable implementations (in-memory, Redis, etc.)
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
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
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

      // Check hourly cap
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

    guildState.timestamps.push(now);
    guildState.lastNotifyAt = now;

    this.state.set(guildId, guildState);
  }

  /**
   * WHAT: Remove old timestamps to prevent memory leak
   * WHY: Keep state map bounded
   */
  cleanup(): void {
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
 * WHAT: Redis-backed rate limiter adapter interface
 * WHY: Coordinate rate limits across multiple bot instances
 * IMPLEMENTATION: Left as exercise for multi-instance deployment
 * DOCS: See docs/adr/redis-notify-limiter.md
 *
 * Example Redis keys:
 *  - notify:{guildId}:last → timestamp of last notification
 *  - notify:{guildId}:hour:{YYYYMMDDHH} → sorted set of notification timestamps
 *
 * Example methods:
 *  - canNotify(): GET last timestamp, check cooldown; ZCOUNT hour key for cap
 *  - recordNotify(): SET last timestamp; ZADD to hour sorted set with TTL
 */
export class RedisNotifyLimiter implements INotifyLimiter {
  // Placeholder for Redis implementation
  // TODO: Implement using ioredis or redis client
  // See docs/adr/redis-notify-limiter.md for design

  canNotify(guildId: string, config: NotifyConfig): RateLimitCheck {
    throw new Error("RedisNotifyLimiter not implemented - use InMemoryNotifyLimiter");
  }

  recordNotify(guildId: string): void {
    throw new Error("RedisNotifyLimiter not implemented - use InMemoryNotifyLimiter");
  }

  cleanup(): void {
    // Redis handles TTL automatically
  }
}

/**
 * WHAT: Global rate limiter instance
 * WHY: Shared across all event handlers
 *
 * MULTI-INSTANCE: Replace with RedisNotifyLimiter when deploying multiple instances
 */
export const notifyLimiter: INotifyLimiter = new InMemoryNotifyLimiter();

logger.info("[notifyLimiter] initialized in-memory rate limiter");
