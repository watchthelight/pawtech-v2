/**
 * Pawtropolis Tech — src/features/statusStore.ts
 * WHAT: Bot status persistence helpers (save/load presence across restarts)
 * WHY: Allows /statusupdate changes to survive bot restarts
 * FLOWS:
 *  - upsertStatus: Save current status to DB
 *  - getStatus: Load saved status from DB
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

export type SavedStatus = {
  scopeKey: string;
  activityType: number | null;
  activityText: string | null;
  customStatus: string | null;  // For ActivityType.Custom state
  status: "online" | "idle" | "dnd" | "invisible";
  updatedAt: number;
};

/**
 * upsertStatus
 * WHAT: Save or update the bot status in the database
 * WHY: Persist status so it can be restored on restart
 * PARAMS:
 *  - status: SavedStatus object containing all presence fields
 * RETURNS: void
 * THROWS: Propagates SQLite errors
 */
export function upsertStatus(status: SavedStatus): void {
  try {
    db.prepare(
      `INSERT INTO bot_status (scope_key, activity_type, activity_text, custom_status, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         activity_type = excluded.activity_type,
         activity_text = excluded.activity_text,
         custom_status = excluded.custom_status,
         status = excluded.status,
         updated_at = excluded.updated_at`
    ).run(
      status.scopeKey,
      status.activityType,
      status.activityText,
      status.customStatus,
      status.status,
      status.updatedAt
    );

    logger.debug(
      {
        scopeKey: status.scopeKey,
        activityType: status.activityType,
        activityText: status.activityText,
        customStatus: status.customStatus,
        status: status.status,
      },
      "[statusStore] status persisted"
    );
  } catch (err) {
    logger.error({ err, status }, "[statusStore] failed to upsert status");
    throw err;
  }
}

/**
 * getStatus
 * WHAT: Retrieve the most recently saved bot status
 * WHY: Used at startup to restore the last known presence
 * PARAMS:
 *  - scopeKey: Scope identifier ('global' or guild_id)
 * RETURNS: SavedStatus object or null if not found
 * THROWS: Never; logs and returns null on error
 */
export function getStatus(scopeKey: string): SavedStatus | null {
  try {
    const row = db
      .prepare(
        `SELECT scope_key, activity_type, activity_text, custom_status, status, updated_at
         FROM bot_status
         WHERE scope_key = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(scopeKey) as
      | {
          scope_key: string;
          activity_type: number | null;
          activity_text: string | null;
          custom_status: string | null;
          status: string;
          updated_at: number;
        }
      | undefined;

    if (!row) {
      logger.debug({ scopeKey }, "[statusStore] no saved status found");
      return null;
    }

    const saved: SavedStatus = {
      scopeKey: row.scope_key,
      activityType: row.activity_type,
      activityText: row.activity_text,
      customStatus: row.custom_status,
      status: row.status as "online" | "idle" | "dnd" | "invisible",
      updatedAt: row.updated_at,
    };

    logger.debug(
      {
        scopeKey: saved.scopeKey,
        activityType: saved.activityType,
        activityText: saved.activityText,
        customStatus: saved.customStatus,
        status: saved.status,
      },
      "[statusStore] status retrieved"
    );

    return saved;
  } catch (err) {
    logger.error({ err, scopeKey }, "[statusStore] failed to get status");
    return null;
  }
}

/**
 * ensureBotStatusSchema
 * WHAT: Creates bot_status table if it doesn't exist
 * WHY: Ensures schema is in place before first use (migration fallback)
 * RETURNS: void
 * THROWS: Never; logs and continues on error
 */
export function ensureBotStatusSchema(): void {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bot_status'`)
      .get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info("[statusStore] creating bot_status table");
      db.prepare(
        `CREATE TABLE IF NOT EXISTS bot_status (
          scope_key TEXT NOT NULL PRIMARY KEY,
          activity_type INTEGER,
          activity_text TEXT,
          custom_status TEXT,
          status TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      ).run();
      logger.info("[statusStore] bot_status table created");
    }
  } catch (err) {
    logger.error({ err }, "[statusStore] failed to ensure schema");
  }
}
