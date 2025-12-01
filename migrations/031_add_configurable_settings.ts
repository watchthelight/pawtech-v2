/**
 * Pawtropolis Tech — migrations/031_add_configurable_settings.ts
 * WHAT: Add configurable settings columns to guild_config table
 * WHY: Allows per-guild configuration of previously hardcoded values
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks column existence)
 *  - Additive only: no data loss, no table recreation
 *  - Uses helper functions for consistency
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * New columns to add to guild_config table
 */
const NEW_COLUMNS: Array<{ name: string; type: string; default?: string }> = [
  // Previously hardcoded IDs
  { name: "artist_ignored_users_json", type: "TEXT" },
  { name: "backfill_notification_channel_id", type: "TEXT" },
  { name: "bot_dev_role_id", type: "TEXT" },

  // Configurable limits
  { name: "gate_answer_max_length", type: "INTEGER" },
  { name: "banner_sync_interval_minutes", type: "INTEGER" },
  { name: "modmail_forward_max_size", type: "INTEGER" },

  // Retry settings
  { name: "retry_max_attempts", type: "INTEGER" },
  { name: "retry_initial_delay_ms", type: "INTEGER" },
  { name: "retry_max_delay_ms", type: "INTEGER" },

  // Circuit breaker settings
  { name: "circuit_breaker_threshold", type: "INTEGER" },
  { name: "circuit_breaker_reset_ms", type: "INTEGER" },

  // Avatar scan thresholds
  { name: "avatar_scan_hard_threshold", type: "REAL" },
  { name: "avatar_scan_soft_threshold", type: "REAL" },
  { name: "avatar_scan_racy_threshold", type: "REAL" },

  // Flag rate limiting
  { name: "flag_rate_limit_ms", type: "INTEGER" },
  { name: "flag_cooldown_ttl_ms", type: "INTEGER" },

  // Feature toggles
  { name: "banner_sync_enabled", type: "INTEGER", default: "1" },
];

/**
 * Migration: Add configurable settings columns to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate031AddConfigurableSettings(db: Database): void {
  logger.info("[migration 031] Starting: add configurable settings to guild_config");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Check if guild_config table exists
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 031] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );
    recordMigration(db, "031", "add_configurable_settings");
    return;
  }

  // Add each column if it doesn't exist
  let added = 0;
  for (const col of NEW_COLUMNS) {
    if (!columnExists(db, "guild_config", col.name)) {
      const defaultClause = col.default ? ` DEFAULT ${col.default}` : "";
      logger.info(`[migration 031] Adding ${col.name} column`);
      db.exec(`ALTER TABLE guild_config ADD COLUMN ${col.name} ${col.type}${defaultClause}`);
      added++;
    } else {
      logger.debug(`[migration 031] ${col.name} already exists, skipping`);
    }
  }

  logger.info(`[migration 031] Added ${added} new columns`);

  // Record migration
  recordMigration(db, "031", "add_configurable_settings");

  logger.info("[migration 031] Complete");
}
