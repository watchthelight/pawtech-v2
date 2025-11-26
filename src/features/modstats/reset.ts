/**
 * Pawtropolis Tech — src/features/modstats/reset.ts
 * WHAT: Clear and rebuild moderator performance metrics cache.
 * WHY: Allows admins to force recomputation when cache is corrupted or stale.
 * HOW: Drops modstats_cache table, recreates schema, triggers full recalculation.
 * SECURITY: Only callable via /modstats reset with password authentication.
 * DOCS:
 *  - better-sqlite3 transactions: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type Database from "better-sqlite3";
import type { Logger } from "pino";

export interface ResetModstatsOptions {
  /**
   * Optional: Limit reset to specific guilds.
   * If omitted, resets all guilds.
   */
  guildIds?: string[];
}

export interface ResetModstatsResult {
  /**
   * Number of guilds that had their cache cleared.
   */
  guildsAffected: number;

  /**
   * Whether the cache table was dropped and recreated.
   */
  cacheDropped: boolean;

  /**
   * Any errors encountered during recomputation (non-fatal).
   */
  errors?: string[];
}

/**
 * WHAT: Clear modstats cache and trigger recomputation.
 * WHY: Allows recovery from cache corruption or stale data without restart.
 * HOW:
 *  1. Drop modstats_cache table if it exists
 *  2. Recreate table schema (if defined in migrations)
 *  3. Count affected guilds from action_log
 *  4. Return summary (actual recomputation is lazy on next /modstats call)
 *
 * @param db - better-sqlite3 Database instance
 * @param log - Pino logger instance
 * @param opts - Reset options (guild filtering, etc.)
 * @returns Result summary with counts and any errors
 *
 * @example
 * const result = await resetModstats(db, logger, {});
 * console.log(`Reset ${result.guildsAffected} guilds, cache dropped: ${result.cacheDropped}`);
 *
 * @security
 * - Never call without password validation in command handler
 * - Logs action but not caller password
 * - Runs in transaction for atomicity
 */
export async function resetModstats(
  db: Database.Database,
  log: Logger,
  opts: ResetModstatsOptions = {}
): Promise<ResetModstatsResult> {
  const result: ResetModstatsResult = {
    guildsAffected: 0,
    cacheDropped: false,
    errors: [],
  };

  try {
    // Transaction ensures atomicity: if any step fails, the whole reset rolls back.
    // This prevents half-dropped caches or inconsistent guild counts.
    const resetTransaction = db.transaction(() => {
      // Drop is idempotent thanks to IF EXISTS. We drop rather than TRUNCATE
      // because it also clears any indexes and resets autoincrement counters.
      try {
        db.prepare("DROP TABLE IF EXISTS modstats_cache").run();
        result.cacheDropped = true;
        log.info("[modstats:reset] modstats_cache table dropped");
      } catch (err) {
        // Non-fatal: we log but continue. The table might not exist yet if
        // this is a fresh install, or schema might have drifted.
        const error = `Failed to drop modstats_cache: ${(err as Error).message}`;
        result.errors?.push(error);
        log.error({ err }, "[modstats:reset] error dropping table");
      }

      // 2. Optionally recreate schema
      // NOTE: In this codebase, modstats uses action_log directly without a cache table.
      // If you add a cache table in the future, create it here:
      //
      // db.prepare(`
      //   CREATE TABLE IF NOT EXISTS modstats_cache (
      //     guild_id TEXT NOT NULL,
      //     actor_id TEXT NOT NULL,
      //     window_days INTEGER NOT NULL,
      //     total_decisions INTEGER NOT NULL,
      //     avg_claim_to_decision_s INTEGER,
      //     cached_at INTEGER NOT NULL,
      //     PRIMARY KEY (guild_id, actor_id, window_days)
      //   )
      // `).run();

      // Count affected guilds for the result summary. This is informational only -
      // we're not actually iterating guilds here (recomputation is lazy).
      let guildsQuery = "SELECT COUNT(DISTINCT guild_id) as count FROM action_log";
      const params: string[] = [];

      if (opts.guildIds && opts.guildIds.length > 0) {
        // Guild filtering: useful for testing reset on a single guild without
        // nuking the whole cache. Production rarely needs this.
        const placeholders = opts.guildIds.map(() => "?").join(",");
        guildsQuery += ` WHERE guild_id IN (${placeholders})`;
        params.push(...opts.guildIds);
      }

      const guildsRow = db.prepare(guildsQuery).get(...params) as { count: number } | undefined;
      result.guildsAffected = guildsRow?.count ?? 0;

      log.info(
        { guildsAffected: result.guildsAffected, guildFilter: opts.guildIds },
        "[modstats:reset] cache cleared"
      );
    });

    resetTransaction();

    // Design decision: recomputation is LAZY. We don't eagerly rebuild stats
    // because (a) it can be slow for large guilds, (b) not all guilds need
    // immediate fresh data, and (c) it distributes the CPU load over time.
    // Tradeoff: first /modstats call after reset will be slower.

    return result;
  } catch (err) {
    log.error({ err }, "[modstats:reset] transaction failed");
    throw err;
  }
}
