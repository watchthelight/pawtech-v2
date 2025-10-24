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

    return new Date(row.start_at);
  } catch (err) {
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
    db.prepare(
      `
      INSERT INTO metrics_epoch (guild_id, start_at)
      VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET start_at = excluded.start_at
    `
    ).run(guildId, startAt.toISOString());

    logger.info({ guildId, epoch: startAt.toISOString() }, "[metricsEpoch] epoch set");
  } catch (err) {
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
    return { sql: "", params: [] };
  }

  // Convert Date to Unix timestamp (seconds)
  const epochSec = Math.floor(epoch.getTime() / 1000);

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
