/**
 * Pawtropolis Tech — src/db/ensure.ts
 * WHAT: On-start schema self-heal for the avatar_scan table and its index.
 * WHY: We want to run on existing data without migrations tooling; additive ALTERs keep it resilient.
 * FLOWS:
 *  - Check existence → create table/index → else PRAGMA table_info → ALTER missing columns → ensure unique index
 * DOCS:
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *
 * NOTE: Small, synchronous queries only. No awaits; better‑sqlite3 is sync.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { db } from "./db.js";
import { logger } from "../lib/logger.js";

// schema self-heal: run once on startup
export function ensureAvatarScanSchema() {
  try {
    // check if table exists
    // SQLite master catalog lookup; safe in better-sqlite3 (sync)
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='avatar_scan'`)
      .get();

    if (!tableExists) {
      logger.info("[ensure] avatar_scan table does not exist, creating");
      // Create table with the current column names (application_id is the primary business key)
      db.prepare(
        `
        CREATE TABLE avatar_scan (
          application_id TEXT PRIMARY KEY,
          avatar_url TEXT,
          nsfw_score REAL DEFAULT NULL,
          edge_score REAL DEFAULT 0,
          final_pct INTEGER DEFAULT 0,
          furry_score REAL DEFAULT 0,
          scalie_score REAL DEFAULT 0,
          reason TEXT,
          evidence_hard TEXT,
          evidence_soft TEXT,
          evidence_safe TEXT,
          scanned_at TEXT,
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `
      ).run();
      // Unique index used by upserts elsewhere (ON CONFLICT DO UPDATE hits this constraint)
      // UPSERT docs: https://sqlite.org/lang_UPSERT.html
      db.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS ux_avatar_scan_application ON avatar_scan(application_id)`
      ).run();
      logger.info("[ensure] avatar_scan table created");
      return;
    }

    // get current columns
    // PRAGMA table_info introspects column names; no schema change here
    // Docs: https://sqlite.org/pragma.html#pragma_table_info
    const cols = db.prepare(`PRAGMA table_info(avatar_scan)`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    // if legacy app_id exists and application_id does not, rename
    if (colNames.includes("app_id") && !colNames.includes("application_id")) {
      logger.info("[ensure] renaming app_id to application_id");
      // NOTE: Potential migration footgun — RENAME COLUMN requires SQLite 3.25+.
      // We assume modern SQLite. If this fails in the field, prefer fresh table + copy in a migration.
      db.exec(`ALTER TABLE avatar_scan RENAME COLUMN app_id TO application_id`);
      colNames.push("application_id");
      const idx = colNames.indexOf("app_id");
      if (idx >= 0) colNames.splice(idx, 1);
    }

    // add missing columns
    if (!colNames.includes("application_id")) {
      logger.info("[ensure] adding application_id column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN application_id TEXT`).run();
    }
    if (!colNames.includes("nsfw_score")) {
      logger.info("[ensure] adding nsfw_score column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN nsfw_score REAL DEFAULT NULL`).run();
    }
    if (!colNames.includes("edge_score")) {
      logger.info("[ensure] adding edge_score column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN edge_score REAL DEFAULT 0`).run();
    }
    if (!colNames.includes("final_pct")) {
      logger.info("[ensure] adding final_pct column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN final_pct INTEGER DEFAULT 0`).run();
    }
    if (!colNames.includes("furry_score")) {
      logger.info("[ensure] adding furry_score column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN furry_score REAL DEFAULT 0`).run();
    }
    if (!colNames.includes("scalie_score")) {
      logger.info("[ensure] adding scalie_score column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN scalie_score REAL DEFAULT 0`).run();
    }
    if (!colNames.includes("avatar_url")) {
      logger.info("[ensure] adding avatar_url column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN avatar_url TEXT`).run();
    }
    if (!colNames.includes("reason")) {
      logger.info("[ensure] adding reason column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN reason TEXT DEFAULT 'none'`).run();
    }
    if (!colNames.includes("evidence_hard")) {
      logger.info("[ensure] adding evidence_hard column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN evidence_hard TEXT`).run();
    }
    if (!colNames.includes("evidence_soft")) {
      logger.info("[ensure] adding evidence_soft column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN evidence_soft TEXT`).run();
    }
    if (!colNames.includes("evidence_safe")) {
      logger.info("[ensure] adding evidence_safe column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN evidence_safe TEXT`).run();
    }
    if (!colNames.includes("scanned_at")) {
      logger.info("[ensure] adding scanned_at column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN scanned_at TEXT`).run();
    }
    if (!colNames.includes("updated_at")) {
      logger.info("[ensure] adding updated_at column");
      db.prepare(`ALTER TABLE avatar_scan ADD COLUMN updated_at INTEGER`).run();
    }

    // ensure unique index (idempotent)
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_avatar_scan_application ON avatar_scan(application_id)`
    ).run();
    logger.info("[ensure] avatar_scan schema ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure avatar_scan schema");
    throw err;
  }
}

/**
 * ensureApplicationPermaRejectColumn
 * WHAT: Adds permanently_rejected and permanent_reject_at columns to application table if missing.
 * WHY: Supports permanent rejection flow that blocks re-applications.
 * DOCS:
 *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 */
export function ensureApplicationPermaRejectColumn() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='application'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] application table does not exist, skipping permanent reject columns");
      return;
    }

    const cols = db.prepare(`PRAGMA table_info(application)`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    if (!colNames.includes("permanently_rejected")) {
      logger.info("[ensure] adding permanently_rejected column to application table");
      // INTEGER 0/1 for boolean; NOT NULL with default 0 (not permanently rejected by default)
      // WHY: Allows permanent rejection to block re-applications for serious violations
      db.prepare(
        `ALTER TABLE application ADD COLUMN permanently_rejected INTEGER NOT NULL DEFAULT 0`
      ).run();
    }

    if (!colNames.includes("permanent_reject_at")) {
      logger.info("[ensure] adding permanent_reject_at column to application table");
      // TEXT for ISO8601 timestamp; nullable (only set when permanently_rejected = 1)
      db.prepare(`ALTER TABLE application ADD COLUMN permanent_reject_at TEXT`).run();
    }

    // Ensure index exists for efficient permanent rejection lookups
    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_applicants_guild_user_permrej
        ON application(guild_id, user_id, permanently_rejected)
    `
    ).run();

    logger.info("[ensure] application permanent reject columns and index ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure permanent reject columns");
    throw err;
  }
}

/**
 * ensureOpenModmailTable
 * WHAT: Creates open_modmail table for race-safe modmail thread tracking.
 * WHY: Prevents duplicate modmail threads when multiple mods click simultaneously.
 * DOCS:
 *  - SQLite PRIMARY KEY: https://sqlite.org/lang_createtable.html#primkeyconst
 *  - CREATE TABLE IF NOT EXISTS: https://sqlite.org/lang_createtable.html
 */
export function ensureOpenModmailTable() {
  try {
    // Create table with PRIMARY KEY on (guild_id, applicant_id) for race-safe guard
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS open_modmail (
        guild_id     TEXT NOT NULL,
        applicant_id TEXT NOT NULL,
        thread_id    TEXT NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (guild_id, applicant_id)
      )
    `
    ).run();

    // Index for fast lookups by thread_id (used during thread deletion cleanup)
    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_open_modmail_thread
        ON open_modmail(thread_id)
    `
    ).run();

    logger.info("[ensure] open_modmail table and index ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure open_modmail table");
    throw err;
  }
}

/**
 * ensureApplicationStatusIndex
 * WHAT: Creates index on application(status, created_at) for queue analytics.
 * WHY: Enables fast queries for pending applications by age (getOpenQueueAge).
 * DOCS:
 *  - CREATE INDEX: https://sqlite.org/lang_createindex.html
 */
export function ensureApplicationStatusIndex() {
  try {
    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_application_status_created
      ON application(status, created_at)
    `
    ).run();

    logger.info("[ensure] application status index ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure application status index");
    throw err;
  }
}

/**
 * runReviewActionMigration
 * WHAT: Performs backup/drop/recreate migration to remove CHECK constraint and convert created_at to INTEGER.
 * WHY: Avoids ALTER TABLE RENAME which triggers legacy SQL guard; uses backup table pattern instead.
 * HOW: Backup existing data → drop old table → create final schema → restore data → drop backup.
 */
function runReviewActionMigration(db: any) {
  const migrate = db.transaction(() => {
    // Check if review_action exists before attempting backup
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='review_action'`)
      .get();

    let countBefore = 0;

    if (tableExists) {
      countBefore = (
        db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
          count: number;
        }
      ).count;
      logger.info(`[migrate] review_action row count before: ${countBefore}`);

      // 1) Create backup snapshot
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_action_bak AS
          SELECT * FROM review_action
      `);
      logger.info(`[migrate] created review_action_bak with ${countBefore} rows`);

      // 2) Drop existing indexes and table
      db.exec(`DROP INDEX IF EXISTS idx_review_action_app_time`);
      db.exec(`DROP INDEX IF EXISTS idx_review_app`);
      db.exec(`DROP INDEX IF EXISTS idx_review_moderator`);
      db.exec(`DROP TABLE review_action`);
    }

    // 3) Create FINAL schema with no CHECK constraint and INTEGER created_at
    db.exec(`
      CREATE TABLE review_action (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id        TEXT NOT NULL,
        moderator_id  TEXT NOT NULL,
        action        TEXT NOT NULL,
        reason        TEXT,
        message_link  TEXT,
        meta          TEXT,
        created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
      )
    `);
    logger.info(`[migrate] created final review_action table`);

    // 4) Restore data from backup (if backup exists)
    const backupExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='review_action_bak'`)
      .get();

    if (backupExists) {
      db.prepare(
        `
        INSERT INTO review_action (id, app_id, moderator_id, action, reason, message_link, meta, created_at)
        SELECT
          id,
          app_id,
          moderator_id,
          action,
          reason,
          message_link,
          meta,
          COALESCE(
            CASE
              WHEN created_at IS NOT NULL AND created_at != ''
              THEN CAST(strftime('%s', created_at) AS INTEGER)
              ELSE NULL
            END,
            CAST(strftime('%s', 'now') AS INTEGER)
          ) as created_at
        FROM review_action_bak
      `
      ).run();

      const countAfter = (
        db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
          count: number;
        }
      ).count;
      logger.info(`[migrate] restored ${countAfter} rows to review_action`);

      if (countBefore !== countAfter) {
        throw new Error(`[migrate] row count mismatch: before=${countBefore}, after=${countAfter}`);
      }

      // 5) Drop backup
      db.exec(`DROP TABLE review_action_bak`);
    }

    // 6) Recreate indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_review_action_app_time
      ON review_action(app_id, created_at DESC)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_review_moderator
      ON review_action(moderator_id, created_at DESC)
    `);

    logger.info(
      `[migrate] review_action migration completed successfully (${countBefore} rows preserved)`
    );
  });

  migrate(); // Execute transaction
}

/**
 * ensureReviewActionFreeText
 * WHAT: Removes CHECK constraint on review_action.action and converts created_at to INTEGER.
 * WHY: Unblocks new/future actions without schema edits; ensures uniform audit with Unix epoch timestamps.
 * HOW: Runs inline migration if needed; idempotent.
 * DOCS:
 *  - SQLite table recreation: https://sqlite.org/lang_altertable.html
 *  - Migration logic: see runReviewActionMigration above
 */
export function ensureReviewActionFreeText() {
  try {
    // Check if the table exists
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='review_action'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] review_action table does not exist, skipping free-text migration");
      return;
    }

    // Schema inspections (no probe inserts that trigger FK errors)
    const needsMigration = (() => {
      // 1. Check DDL for CHECK constraint
      const ddlRow = db
        .prepare(`SELECT sql FROM sqlite_schema WHERE type='table' AND name='review_action'`)
        .get() as { sql: string } | undefined;

      const hasCheck = ddlRow?.sql && /CHECK\s*\(/i.test(ddlRow.sql);

      // 2. Check created_at column type via PRAGMA
      const cols = db.prepare(`PRAGMA table_info(review_action)`).all() as Array<{
        name: string;
        type: string;
      }>;
      const createdAtCol = cols.find((c) => c.name === "created_at");
      const createdAtIsInteger = createdAtCol?.type.toUpperCase() === "INTEGER";

      // 3. Check foreign key ON DELETE action via PRAGMA
      const fks = db.prepare(`PRAGMA foreign_key_list(review_action)`).all() as Array<{
        from: string;
        on_delete: string;
      }>;
      const appIdFk = fks.find((fk) => fk.from === "app_id");
      const hasCorrectFK = appIdFk?.on_delete === "CASCADE";

      // 4. Check for time indexes
      const indexes = db.prepare(`PRAGMA index_list(review_action)`).all() as Array<{
        name: string;
      }>;
      const hasTimeIndex = indexes.some((idx) => idx.name === "idx_review_action_app_time");
      const hasModeratorIndex = indexes.some((idx) => idx.name === "idx_review_moderator");

      // 5. Check if moderator index includes created_at (requires PRAGMA index_info)
      let moderatorIndexHasTime = false;
      if (hasModeratorIndex) {
        const modIdxCols = db.prepare(`PRAGMA index_info(idx_review_moderator)`).all() as Array<{
          name: string;
        }>;
        moderatorIndexHasTime = modIdxCols.some((col) => col.name === "created_at");
      }

      return (
        hasCheck || !createdAtIsInteger || !hasCorrectFK || !hasTimeIndex || !moderatorIndexHasTime
      );
    })();

    if (!needsMigration) {
      logger.info("[ensure] review_action OK (free-text actions + created_at)");
      return;
    }

    logger.info("[ensure] running review_action free-text migration");

    // Run migration inline (avoids module resolution issues)
    runReviewActionMigration(db);

    logger.info("[ensure] review_action upgraded (free-text actions + created_at)");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to upgrade review_action table");
    throw err;
  }
}

/**
 * WHAT: Check if a table has a specific column.
 * WHY: Enables safe, idempotent schema migrations.
 * SECURITY: table/column names validated to prevent SQL injection
 *
 * @param table - Table name (validated as SQL identifier)
 * @param column - Column name to check (validated as SQL identifier)
 * @returns true if column exists, false otherwise
 * @throws Error if table or column name is invalid
 */
const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function hasColumn(table: string, column: string): boolean {
  // Validate identifiers to prevent SQL injection via PRAGMA
  if (!SQL_IDENTIFIER_RE.test(table)) {
    throw new Error(`Invalid table name for schema check: ${table}`);
  }
  if (!SQL_IDENTIFIER_RE.test(column)) {
    throw new Error(`Invalid column name for schema check: ${column}`);
  }

  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

/**
 * ensureActionLogSchema
 * WHAT: Creates action_log and guild_config tables for analytics and logging.
 * WHY: Enables /modstats command and pretty action logging to configured channels.
 * FLOWS:
 *  - Check table existence → create tables + indexes if missing
 *  - Migrate existing guild_config to add logging_channel_id if needed
 */
/**
 * ensureManualFlagColumns
 * WHAT: Adds flagged_reason and manual_flag columns to user_activity table if missing.
 * WHY: Supports manual flagging of users by moderators with custom reasons.
 * DOCS:
 *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 */
export function ensureManualFlagColumns() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_activity'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] user_activity table does not exist, skipping manual flag columns");
      return;
    }

    const cols = db.prepare(`PRAGMA table_info(user_activity)`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    if (!colNames.includes("flagged_reason")) {
      logger.info("[ensure] adding flagged_reason column to user_activity table");
      db.prepare(`ALTER TABLE user_activity ADD COLUMN flagged_reason TEXT`).run();
    }

    if (!colNames.includes("manual_flag")) {
      logger.info("[ensure] adding manual_flag column to user_activity table");
      // INTEGER 0/1 for boolean; NOT NULL with default 0 (automatic flag by default)
      db.prepare(
        `ALTER TABLE user_activity ADD COLUMN manual_flag INTEGER NOT NULL DEFAULT 0`
      ).run();
    }

    logger.info("[ensure] user_activity manual flag columns ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure manual flag columns");
    throw err;
  }
}

export function ensureActionLogSchema() {
  try {
    // Check if action_log exists
    const actionLogExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='action_log'`)
      .get();

    if (!actionLogExists) {
      logger.info("[ensure] action_log table does not exist, creating");

      // Create action_log table
      db.exec(`
        CREATE TABLE action_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id      TEXT NOT NULL,
          app_id        TEXT,
          app_code      TEXT,
          actor_id      TEXT NOT NULL,
          subject_id    TEXT,
          action        TEXT NOT NULL CHECK (
                          action IN (
                            'app_submitted',
                            'claim',
                            'approve',
                            'reject',
                            'need_info',
                            'perm_reject',
                            'kick',
                            'modmail_open',
                            'modmail_close'
                          )
                        ),
          reason        TEXT,
          meta_json     TEXT,
          created_at_s  INTEGER NOT NULL
        );

        CREATE INDEX idx_action_log_guild_time ON action_log(guild_id, created_at_s DESC);
        CREATE INDEX idx_action_log_actor_time ON action_log(actor_id, created_at_s DESC);
        CREATE INDEX idx_action_log_app ON action_log(app_id);
      `);

      logger.info("[ensure] action_log table created");
    } else {
      logger.info("[ensure] action_log table already exists");
    }

    // Check if guild_config exists
    const guildConfigExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get();

    if (!guildConfigExists) {
      logger.info("[ensure] guild_config table does not exist, creating");

      db.exec(`
        CREATE TABLE guild_config (
          guild_id          TEXT PRIMARY KEY,
          logging_channel_id TEXT,
          updated_at_s      INTEGER NOT NULL
        );
      `);

      logger.info("[ensure] guild_config table created");
    } else {
      logger.info("[ensure] guild_config table already exists");

      // Migrate existing table: add logging_channel_id if missing
      if (!hasColumn("guild_config", "logging_channel_id")) {
        logger.info("[ensure] guild_config missing logging_channel_id, adding column");
        db.exec(`ALTER TABLE guild_config ADD COLUMN logging_channel_id TEXT`);
        logger.info("[ensure] guild_config.logging_channel_id column added");
      }
    }
  } catch (err) {
    logger.error({ err }, "[ensure] failed to create action_log schema");
    throw err;
  }
}

/**
 * ensureActionLogFreeText
 * WHAT: Removes CHECK constraint on action_log.action to allow new actions without schema edits.
 * WHY: member_join and future actions were blocked by the CHECK constraint.
 * HOW: Recreates table without CHECK constraint if it exists.
 */
/**
 * ensureSearchIndexes
 * WHAT: Creates commonly-used indexes for application search if missing.
 * WHY: Speeds up lookups by user_id and guild_id in application table.
 */
export function ensureSearchIndexes() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='application'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] application table does not exist, skipping search indexes");
      return;
    }

    // Index for user lookup
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_application_user ON application(user_id)`
    ).run();

    // Index for guild + user lookup
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_application_guild_user ON application(guild_id, user_id)`
    ).run();

    logger.info("[ensure] application search indexes ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure search indexes");
    throw err;
  }
}

export function ensureActionLogFreeText() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='action_log'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] action_log table does not exist, skipping free-text migration");
      return;
    }

    // Check if table has CHECK constraint
    const ddlRow = db
      .prepare(`SELECT sql FROM sqlite_schema WHERE type='table' AND name='action_log'`)
      .get() as { sql: string } | undefined;

    const hasCheck = ddlRow?.sql && /CHECK\s*\(/i.test(ddlRow.sql);

    if (!hasCheck) {
      logger.info("[ensure] action_log OK (no CHECK constraint)");
      return;
    }

    logger.info("[ensure] running action_log free-text migration");

    // Run migration in transaction
    const migrate = db.transaction(() => {
      const countBefore = (
        db.prepare(`SELECT COUNT(*) as count FROM action_log`).get() as {
          count: number;
        }
      ).count;
      logger.info(`[migrate] action_log row count before: ${countBefore}`);

      // 1) Create backup
      db.exec(`CREATE TABLE IF NOT EXISTS action_log_bak AS SELECT * FROM action_log`);
      logger.info(`[migrate] created action_log_bak with ${countBefore} rows`);

      // 2) Drop existing indexes and table
      db.exec(`DROP INDEX IF EXISTS idx_action_log_guild_time`);
      db.exec(`DROP INDEX IF EXISTS idx_action_log_actor_time`);
      db.exec(`DROP INDEX IF EXISTS idx_action_log_app`);
      db.exec(`DROP TABLE action_log`);

      // 3) Create FINAL schema without CHECK constraint
      db.exec(`
        CREATE TABLE action_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id      TEXT NOT NULL,
          app_id        TEXT,
          app_code      TEXT,
          actor_id      TEXT NOT NULL,
          subject_id    TEXT,
          action        TEXT NOT NULL,
          reason        TEXT,
          meta_json     TEXT,
          created_at_s  INTEGER NOT NULL
        )
      `);
      logger.info(`[migrate] created final action_log table (no CHECK constraint)`);

      // 4) Restore data from backup
      db.prepare(
        `INSERT INTO action_log (id, guild_id, app_id, app_code, actor_id, subject_id, action, reason, meta_json, created_at_s)
         SELECT id, guild_id, app_id, app_code, actor_id, subject_id, action, reason, meta_json, created_at_s
         FROM action_log_bak`
      ).run();

      const countAfter = (
        db.prepare(`SELECT COUNT(*) as count FROM action_log`).get() as {
          count: number;
        }
      ).count;
      logger.info(`[migrate] restored ${countAfter} rows to action_log`);

      if (countBefore !== countAfter) {
        throw new Error(`[migrate] row count mismatch: before=${countBefore}, after=${countAfter}`);
      }

      // 5) Drop backup
      db.exec(`DROP TABLE action_log_bak`);

      // 6) Recreate indexes
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_action_log_guild_time ON action_log(guild_id, created_at_s DESC)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_action_log_actor_time ON action_log(actor_id, created_at_s DESC)`
      );
      db.exec(`CREATE INDEX IF NOT EXISTS idx_action_log_app ON action_log(app_id)`);

      logger.info(
        `[migrate] action_log migration completed successfully (${countBefore} rows preserved)`
      );
    });

    migrate(); // Execute transaction

    logger.info("[ensure] action_log upgraded (free-text actions)");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to upgrade action_log table");
    throw err;
  }
}

/**
 * ensureActionLogAnalyticsIndex
 * WHAT: Creates composite index for modstats queries filtering by guild + action + time.
 * WHY: /modstats queries filter by action IN (...) - without this index, full table scan occurs.
 * DOCS:
 *  - CREATE INDEX: https://sqlite.org/lang_createindex.html
 */
export function ensureActionLogAnalyticsIndex() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='action_log'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] action_log table does not exist, skipping analytics index");
      return;
    }

    // Composite index for queries like:
    // SELECT ... FROM action_log WHERE guild_id = ? AND action IN (...) AND created_at_s >= ?
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_action_log_guild_action_created
       ON action_log(guild_id, action, created_at_s)`
    ).run();

    logger.info("[ensure] action_log analytics index ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure action_log analytics index");
    throw err;
  }
}

/**
 * ensurePanicModeColumn
 * WHAT: Adds panic_mode and panic_enabled_at columns to guild_config table.
 * WHY: Persists panic mode state across bot restarts (was in-memory only before).
 * DOCS:
 *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
 */
export function ensurePanicModeColumn() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] guild_config table does not exist, skipping panic_mode column");
      return;
    }

    // Ensure updated_at_s column exists (needed for upserts)
    if (!hasColumn("guild_config", "updated_at_s")) {
      logger.info("[ensure] adding updated_at_s column to guild_config");
      // Unix timestamp for last update; nullable for backwards compat
      db.exec(`ALTER TABLE guild_config ADD COLUMN updated_at_s INTEGER`);
    }

    if (!hasColumn("guild_config", "panic_mode")) {
      logger.info("[ensure] adding panic_mode column to guild_config");
      // INTEGER 0/1 for boolean; default 0 (panic mode off)
      db.exec(`ALTER TABLE guild_config ADD COLUMN panic_mode INTEGER NOT NULL DEFAULT 0`);
    }

    if (!hasColumn("guild_config", "panic_enabled_at")) {
      logger.info("[ensure] adding panic_enabled_at column to guild_config");
      // Unix timestamp when panic mode was enabled; nullable
      db.exec(`ALTER TABLE guild_config ADD COLUMN panic_enabled_at INTEGER`);
    }

    if (!hasColumn("guild_config", "panic_enabled_by")) {
      logger.info("[ensure] adding panic_enabled_by column to guild_config");
      // User ID who enabled panic mode; nullable
      db.exec(`ALTER TABLE guild_config ADD COLUMN panic_enabled_by TEXT`);
    }

    logger.info("[ensure] guild_config panic_mode columns ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure panic_mode column");
    throw err;
  }
}

