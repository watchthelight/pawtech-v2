/**
 * Pawtropolis Tech — src/db/db.ts
 * WHAT: SQLite connection bootstrap and minimal schema creation for review/gate features.
 * WHY: Centralizes better‑sqlite3 setup, PRAGMAs, and basic tables so consumers can just import `db`.
 * FLOWS:
 *  - Open DB → set PRAGMAs → wrap prepare to trace → create core tables → handle shutdown
 * DOCS:
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - SQLite UPSERT: https://sqlite.org/lang_UPSERT.html
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 *  - Node ESM modules: https://nodejs.org/api/esm.html
 *
 * NOTE: better‑sqlite3 is synchronous by design; keep statements small and quick.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const DB_BUSY_TIMEOUT_MS = 5000;
const DB_DEFAULT_PATH = "data/data.db";

const dbPath = env.DB_PATH || DB_DEFAULT_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath, { fileMustExist: false });
// PRAGMAs: see https://sqlite.org/pragma.html — tuned for bot workload
// WAL journaling improves concurrency for readers/writers
db.pragma("journal_mode = WAL");
// Reduce fsync frequency vs FULL for performance in this context
db.pragma("synchronous = NORMAL");
// Enforce referential integrity where declared
db.pragma("foreign_keys = ON");
// Busy timeout to fail-soft during brief contention rather than throwing immediately
db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
const dbTraceEnabled = process.env.DB_TRACE === "1";
logger.info({ dbPath, dbTraceEnabled }, "SQLite opened");

/**
 * execRaw
 * WHAT: Execute raw SQL via better-sqlite3's exec() method, bypassing tracedPrepare.
 * WHY: Schema migrations need multi-statement DDL that the prepare() guard blocks.
 * USAGE: Only for migrations in ensure.ts; all normal queries use prepare().
 * DOCS: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#execstring---this
 */
export function execRaw(sql: string): void {
  db.exec(sql);
}

const legacyRe = /__old|ALTER\s+TABLE\s+.+\s+RENAME/i;
const originalPrepare = db.prepare.bind(db);
(db as any).prepare = function tracedPrepare(sql: string) {
  if (legacyRe.test(sql)) {
    const err = new Error(`Legacy SQL detected in prepare(): ${sql.slice(0, 180)}`);
    logger.error(
      {
        evt: "db_legacy_sql",
        sql,
        err: { name: err.name, message: err.message, stack: err.stack },
      },
      "blocked legacy SQL"
    );
    throw err;
  }

  const statement = originalPrepare(sql);
  for (const method of ["run", "get", "all"] as const) {
    const base = (statement as any)[method];
    if (typeof base !== "function") continue;
    (statement as any)[method] = function wrappedMethod(this: unknown, ...args: any[]) {
      try {
        if (process.env.DB_TRACE === "1") {
          logger.debug({ evt: "db_call", m: method, sql }, "db call");
        }
        return base.apply(statement, args);
      } catch (err) {
        logger.error(
          {
            evt: "db_error",
            m: method,
            sql,
            err: {
              name: (err as any)?.name,
              code: (err as any)?.code,
              message: (err as any)?.message,
              stack: (err as any)?.stack,
            },
          },
          "db error"
        );
        throw err;
      }
    };
  }
  return statement;
};

// Bootstrap schema (M6-M9)
// review_card: tracks where the staff-facing review message lives
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS review_card (
    app_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`
).run();

// review_claim: prevents two reviewers from acting on the same application simultaneously
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS review_claim (
    app_id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  )
`
).run();

// dm_bridge: per-application DM channel/thread bookkeeping
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS dm_bridge (
    app_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    dm_channel_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT
  )
`
).run();

// transcript: simple audit trail for messages/actions related to an application
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    author_id TEXT NOT NULL,
    source TEXT NOT NULL,
    content TEXT NOT NULL
  )
`
).run();

// modmail_ticket: tracks modmail threads for staff-applicant communication
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS modmail_ticket (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    app_code TEXT,
    review_message_id TEXT,
    thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  )
`
).run();

// Ensure only one open ticket per user per guild
db.prepare(
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_modmail_open_unique
  ON modmail_ticket(guild_id, user_id, status)
  WHERE status = 'open'
`
).run();

// MODMAIL MESSAGE MAPPING TABLE
// Maps thread <-> DM message IDs to preserve "reply" threading in both directions.
// MessageReference docs: https://discord.js.org/#/docs/discord.js/main/typedef/MessageReference
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS modmail_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('to_user','to_staff')),
    thread_message_id TEXT,
    dm_message_id TEXT,
    reply_to_thread_message_id TEXT,
    reply_to_dm_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(thread_message_id),
    UNIQUE(dm_message_id)
  )
`
).run();

// Ensure guild_config has new avatar scan columns (migration helper)
// Migration helper: probe schema and add a column if absent.
// Uses PRAGMA table_info to introspect: https://sqlite.org/pragma.html#pragma_table_info
const addColumnIfMissing = (table: string, column: string, definition: string) => {
  try {
    const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      logger.info({ table, column }, "Added missing column");
    }
  } catch {
    // Table doesn't exist yet, that's ok
  }
};

addColumnIfMissing("guild_config", "avatar_scan_weight_model", "REAL NOT NULL DEFAULT 0.7");
addColumnIfMissing("guild_config", "avatar_scan_weight_edge", "REAL NOT NULL DEFAULT 0.3");
addColumnIfMissing("avatar_scan", "final_pct", "INTEGER NOT NULL DEFAULT 0");

// Guild permission system: mod roles and gatekeeper role
// mod_role_ids: CSV of role IDs that can run all commands alongside owners
// gatekeeper_role_id: role ID for gatekeepers (future use)
// modmail_log_channel_id: channel ID where modmail logs are posted (future use)
// DOCS:
//  - Discord roles: https://discord.js.org/#/docs/discord.js/main/class/GuildMember?scrollTo=roles
//  - Permissions: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
addColumnIfMissing("guild_config", "mod_role_ids", "TEXT");
addColumnIfMissing("guild_config", "gatekeeper_role_id", "TEXT");
addColumnIfMissing("guild_config", "modmail_log_channel_id", "TEXT");

// Review card display settings
// review_roles_mode: Controls how roles are displayed in review cards
//   'none' = hide roles entirely
//   'level_only' = show only highest "level" role (e.g., "Level 2", "Level 3")
//   'all' = show all roles (current behavior)
// WHY: Reduces clutter and highlights important level/verification roles
addColumnIfMissing("guild_config", "review_roles_mode", "TEXT NOT NULL DEFAULT 'level_only'");

// MODMAIL: where we persist the Discord message ID of the transcript/log message.
// Used to link from the review card after the ticket is closed.
addColumnIfMissing("modmail_ticket", "thread_channel_id", "TEXT");
addColumnIfMissing("modmail_ticket", "log_channel_id", "TEXT");
addColumnIfMissing("modmail_ticket", "log_message_id", "TEXT");

// Analytics index: optimize /modstats queries that filter by guild + action + time
// Query pattern: WHERE guild_id = ? AND action IN (...) AND created_at_s >= ?
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_action_log_guild_action_created
     ON action_log(guild_id, action, created_at_s)`
  ).run();
} catch {
  // Table may not exist yet if action_log schema hasn't been created
}

async function closeDatabase() {
  // Philosophy: never crash on shutdown; prefer logs over throws here.
  logger.info("Closing database connection...");
  try {
    db.close();
    logger.info("Database closed successfully");
  } catch (err) {
    logger.error({ err }, "Error closing database");
  }

  try {
    const { flushSentry } = await import("../lib/sentry.js");
    await flushSentry();
    logger.info("Sentry events flushed");
  } catch (err) {
    logger.warn({ err }, "Failed to flush Sentry events");
  }
}

process.on("SIGTERM", () => {
  closeDatabase().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  closeDatabase().finally(() => process.exit(0));
});
