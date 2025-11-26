/**
 * Pawtropolis Tech — src/features/metricsEpoch.ts
 * WHAT: Metrics epoch service for data reset without deleting historical logs.
 * WHY: Allows admins to reset metrics from a specific point in time forward.
 * HOW: Store per-guild epoch timestamp; filter all metric queries by epoch.
 *
 * USAGE:
 *   const epoch = getMetricsEpoch(guildId);
 *   if (epoch) {
 *     // Filter queries: WHERE created_at_s >= epoch_timestamp
 *   }
 *
 *   setMetricsEpoch(guildId, new Date()); // Reset metrics from now
 *
 * SAFETY:
 *  - Upserts are atomic (REPLACE INTO)
 *  - Epoch is nullable (NULL = no filtering)
 *  - Historical action_log data is never deleted
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

/**
 * WHAT: Get the metrics epoch for a guild.
 * WHY: Determine if metrics should be filtered by a start time.
 * HOW: Query metrics_epoch table; return Date or null if no epoch set.
 *
 * @param guildId - Discord guild ID
 * @returns Date object representing epoch start time, or null if no epoch set
 */
export function getMetricsEpoch(guildId: string): Date | null {
  try {
    const row = db.prepare(`SELECT start_at FROM metrics_epoch WHERE guild_id = ?`).get(guildId) as
      | { start_at: string }
      | undefined;

    if (!row) {
      return null;
    }

    // ISO string from DB gets parsed here. If someone stores a garbage date,
    // Date() will happily return "Invalid Date" rather than throwing.
    // Callers should handle NaN timestamps gracefully.
    return new Date(row.start_at);
  } catch (err) {
    // Swallow errors and return null - this is intentional. Missing/corrupt
    // epoch should never block metric queries, just show unfiltered data.
    logger.error({ err, guildId }, "[metricsEpoch] failed to get epoch");
    return null;
  }
}

/**
 * WHAT: Set the metrics epoch for a guild.
 * WHY: Reset metrics from a specific point in time without deleting historical data.
 * HOW: Upsert epoch timestamp into metrics_epoch table.
 *
 * @param guildId - Discord guild ID
 * @param startAt - Date representing the new epoch start time
 */
export function setMetricsEpoch(guildId: string, startAt: Date): void {
  try {
    // Using ON CONFLICT for atomic upsert. This avoids race conditions if two
    // admins hit reset at the same time - last write wins, no partial states.
    // Note: better-sqlite3 is synchronous, so no await needed here.
    db.prepare(
      `
      INSERT INTO metrics_epoch (guild_id, start_at)
      VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET start_at = excluded.start_at
    `
    ).run(guildId, startAt.toISOString());

    logger.info({ guildId, epoch: startAt.toISOString() }, "[metricsEpoch] epoch set");
  } catch (err) {
    // Unlike getMetricsEpoch, we DO throw here. A failed epoch set is a real
    // problem - admin expects metrics to reset but they won't.
    logger.error({ err, guildId, startAt }, "[metricsEpoch] failed to set epoch");
    throw err;
  }
}

/**
 * WHAT: Get SQL predicate and parameters for filtering by epoch.
 * WHY: DRY helper for consistent epoch filtering across all metric queries.
 * HOW: Returns { sql, params } to append to WHERE clause.
 *
 * @param guildId - Discord guild ID
 * @param timeColumnName - Name of the timestamp column (e.g., 'created_at_s')
 * @returns Object with SQL fragment and parameters
 *
 * @example
 *   const { sql, params } = getEpochPredicate(guildId, 'created_at_s');
 *   const query = `SELECT * FROM action_log WHERE guild_id = ? ${sql}`;
 *   const rows = db.prepare(query).all(guildId, ...params);
 */
export function getEpochPredicate(
  guildId: string,
  timeColumnName: string = "created_at_s"
): { sql: string; params: any[] } {
  const epoch = getMetricsEpoch(guildId);

  if (!epoch) {
    // No epoch = no filtering. Returns empty string so callers can blindly
    // append without checking: `SELECT ... WHERE guild_id = ? ${sql}`
    return { sql: "", params: [] };
  }

  // Convert Date to Unix timestamp (seconds). Important: action_log stores
  // timestamps as integer seconds, not milliseconds. Don't forget the /1000.
  const epochSec = Math.floor(epoch.getTime() / 1000);

  // WARNING: timeColumnName is interpolated directly into SQL. This is safe
  // only because callers control the column name. Never pass user input here.
  return {
    sql: `AND ${timeColumnName} >= ?`,
    params: [epochSec],
  };
}

/**
 * WHAT: Clear the metrics epoch for a guild.
 * WHY: Remove epoch filter to show all historical metrics again.
 * HOW: Delete row from metrics_epoch table.
 *
 * @param guildId - Discord guild ID
 */
export function clearMetricsEpoch(guildId: string): void {
  try {
    db.prepare(`DELETE FROM metrics_epoch WHERE guild_id = ?`).run(guildId);
    logger.info({ guildId }, "[metricsEpoch] epoch cleared");
  } catch (err) {
    logger.error({ err, guildId }, "[metricsEpoch] failed to clear epoch");
    throw err;
  }
}
