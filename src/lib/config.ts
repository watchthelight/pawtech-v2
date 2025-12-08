/**
 * Pawtropolis Tech — src/lib/config.ts
 * WHAT: Guild configuration accessors and permission helpers (hasManageGuild, isReviewer, requireStaff).
 * WHY: Centralizes guild-scoped settings and staff checks used across commands and features.
 * FLOWS:
 *  - upsertConfig(): INSERT or UPDATE guild_config with defaults
 *  - getConfig(): cached read with TTL
 *  - isReviewer(): checks reviewer role or review-channel visibility
 * DOCS:
 *  - Permissions model: https://discord.com/developers/docs/topics/permissions
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { ChatInputCommandInteraction, GuildMember, APIInteractionGuildMember } from "discord.js";
import { MessageFlags } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "./logger.js";
import { env } from "./env.js";
import { isOwner } from "./owner.js";
import { touchSyncMarker } from "./syncMarker.js";
import { isGuildMember } from "./typeGuards.js";
import { LRUCache } from "./lruCache.js";
import {
  postPermissionDenied,
  type PermissionDenialOptions,
  type PermissionRequirement,
} from "./permissionCard.js";

// Re-export permission types for convenient imports
export type { PermissionDenialOptions, PermissionRequirement };
export { postPermissionDenied };

// GOTCHA: This type is essentially a SQL row disguised as TypeScript.
// Half these fields are optional-nullable because SQLite doesn't know the difference.
// If you add a column to the DB, you MUST add it here too or it vanishes into the void.
export type GuildConfig = {
  guild_id: string;
  review_channel_id?: string | null;
  gate_channel_id?: string | null;
  general_channel_id?: string | null;
  unverified_channel_id?: string | null;
  accepted_role_id?: string | null;
  reviewer_role_id?: string | null;
  welcome_template?: string | null;
  info_channel_id?: string | null;
  rules_channel_id?: string | null;
  welcome_ping_role_id?: string | null;
  mod_role_ids?: string | null;
  gatekeeper_role_id?: string | null;
  modmail_log_channel_id?: string | null;
  modmail_delete_on_close?: boolean | null;
  review_roles_mode?: string | null;
  dadmode_enabled?: boolean | null;
  dadmode_odds?: number | null;
  skullmode_enabled?: boolean | null;
  skullmode_odds?: number | null;
  listopen_public_output?: number | null; // 1=public (default), 0=ephemeral
  leadership_role_id?: string | null; // Role ID for leadership/senior mod permissions
  ping_dev_on_app?: number | null; // 1=ping dev on new apps, 0=don't ping
  // Flags feature columns (005_flags_config migration)
  flags_channel_id?: string | null;
  silent_first_msg_days?: number | null; // Default 90 days for silent-since-join detection
  // Logging channel (001_add_logging_channel_id migration)
  logging_channel_id?: string | null;
  // Forum post notification config (017_add_notify_config migration)
  forum_channel_id?: string | null;
  notify_role_id?: string | null;
  notify_mode?: string | null; // 'post' (in-thread) or 'channel' (separate channel)
  notification_channel_id?: string | null;
  notify_cooldown_seconds?: number | null; // Default 5 seconds
  notify_max_per_hour?: number | null; // Default 10
  // Support channel for level reward skipped messages (057 issue)
  support_channel_id?: string | null;
  // Poke command config (079 issue)
  poke_category_ids_json?: string | null;
  poke_excluded_channel_ids_json?: string | null;
  // Artist rotation config (Issue #78)
  artist_role_id?: string | null;
  ambassador_role_id?: string | null;
  server_artist_channel_id?: string | null;
  artist_ticket_roles_json?: string | null;
  // Configurable settings (previously hardcoded)
  artist_ignored_users_json?: string | null; // JSON array of user IDs to exclude from artist queue
  backfill_notification_channel_id?: string | null; // Channel for backfill completion notifications
  bot_dev_role_id?: string | null; // Role to ping on new applications (when ping_dev_on_app is enabled)
  gate_answer_max_length?: number | null; // Max characters for gate answers (default: 1000)
  banner_sync_interval_minutes?: number | null; // Minutes between banner syncs (default: 10)
  modmail_forward_max_size?: number | null; // Max size for modmail forward tracking (default: 10000)
  // Retry and circuit breaker settings
  retry_max_attempts?: number | null; // Max retry attempts (default: 3)
  retry_initial_delay_ms?: number | null; // Initial retry delay in ms (default: 100)
  retry_max_delay_ms?: number | null; // Max retry delay in ms (default: 5000)
  circuit_breaker_threshold?: number | null; // Failures before opening circuit (default: 5)
  circuit_breaker_reset_ms?: number | null; // Time before retry after circuit opens (default: 60000)
  // Avatar scan thresholds
  avatar_scan_hard_threshold?: number | null; // NSFW hard evidence threshold (default: 0.8)
  avatar_scan_soft_threshold?: number | null; // NSFW soft evidence threshold (default: 0.5)
  avatar_scan_racy_threshold?: number | null; // Racy content threshold (default: 0.8)
  // Flag rate limiting
  flag_rate_limit_ms?: number | null; // Cooldown between flag commands (default: 2000)
  flag_cooldown_ttl_ms?: number | null; // TTL for flag cooldown cache (default: 3600000)
  // Banner sync toggle
  banner_sync_enabled?: number | null; // 1=enabled, 0=disabled (default: 1)
  // These fields are NOT optional. Ask me how I know.
  // (Hint: it involved a production outage and a missing COALESCE)
  image_search_url_template: string;
  reapply_cooldown_hours: number;
  min_account_age_hours: number;
  min_join_age_hours: number;
  avatar_scan_enabled: number; // 1 = on, 0 = off. Yes, SQLite booleans. Yes, I hate it too.
  // WHY floats in SQLite? Because vision APIs return confidence scores and we store them raw.
  // If you're wondering why 0.6 sometimes becomes 0.6000000001, now you know.
  avatar_scan_nsfw_threshold: number;
  avatar_scan_skin_edge_threshold: number;
  avatar_scan_weight_model: number;
  avatar_scan_weight_edge: number;
  welcome: {
    infoChannelId?: string;
    rulesChannelId?: string;
    extraPingRoleId?: string;
    generalChannelId: string;
    cardStyle: "default";
  };
};

/*
 * LRU cache with TTL and bounded size to prevent unbounded memory growth.
 * Max 1000 guilds cached; excess guilds evicted LRU-style.
 *
 * CACHE CONSISTENCY NOTES:
 * - TTL-based invalidation means stale data can be served during concurrent updates
 * - Maximum staleness window: CACHE_TTL_MS (5 minutes)
 * - This is ACCEPTABLE for guild config because:
 *   * Updates are infrequent (typically one-time setup)
 *   * Config fields are non-critical convenience settings
 *   * SQLite handles concurrent writes (no data corruption)
 *   * Single-node deployment reduces actual concurrency
 * - If you need stronger consistency, see Option B in docs/roadmap/043-document-cache-behavior.md
 *
 * WHY 1000 guilds? Because if you're somehow running this bot on more servers,
 * you probably have bigger problems than cache eviction to worry about.
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - short enough to pick up config changes reasonably fast
const CACHE_MAX_SIZE = 1000; // Max guilds to cache - prevents unbounded memory growth
const configCache = new LRUCache<string, GuildConfig>(CACHE_MAX_SIZE, CACHE_TTL_MS);
// If someone changes config and wonders why it's not applying: it's the cache.
// It's always the cache.

/**
 * Track which schema migrations have been applied during this runtime.
 *
 * This Set prevents re-running migrations on every config access. Each ensure
 * function adds its migration name after successful completion. Memory footprint
 * is minimal (~6 strings x 30 bytes = ~180 bytes vs ~6 bytes for booleans).
 *
 * Migration names follow pattern: table_column or table_featurename
 * Examples: "guild_config_welcome_template", "guild_config_mod_roles"
 */
const ensuredMigrations = new Set<string>();

// Allowlist of valid column names for ALTER TABLE migration operations.
// This prevents SQL injection if column name sources ever become dynamic.
// Pattern follows metricsEpoch.ts:101 and config.ts:317 validation approach.
// Yes, we have hardcoded column names in a Set. No, we won't apologize.
// Parameterized queries don't work for column names. This is the way.
const ALLOWED_MIGRATION_COLUMNS = new Set([
  // Welcome channel columns
  "info_channel_id",
  "rules_channel_id",
  "welcome_ping_role_id",
  "welcome_template",
  "unverified_channel_id",

  // Mod roles and modmail columns
  "mod_role_ids",
  "gatekeeper_role_id",
  "modmail_log_channel_id",
  "modmail_delete_on_close",

  // Feature toggle columns
  "dadmode_enabled",
  "dadmode_odds",
  "skullmode_enabled",
  "skullmode_odds",
  "listopen_public_output",
]);

/**
 * validateMigrationColumnName
 * WHAT: Validates column name against allowlist before SQL interpolation
 * WHY: Prevents SQL injection if column names ever become dynamic
 * THROWS: Error with sanitized message if column name is rejected
 */
function validateMigrationColumnName(columnName: string): void {
  if (!ALLOWED_MIGRATION_COLUMNS.has(columnName)) {
    logger.error(
      { columnName, table: "guild_config" },
      "[config] Invalid migration column name rejected - potential SQL injection attempt"
    );
    throw new Error(`Invalid column name for migration: ${columnName}`);
  }
}

// These ensure*Column functions are startup migrations that run once per boot.
// They exist because proper migration files are apparently too scary.
// The pattern: check if column exists via PRAGMA, add if missing, remember we did it.
// It's ugly but it's battle-tested. Don't fix what isn't broken.
export function ensureUnverifiedChannelColumn() {
  if (ensuredMigrations.has("guild_config_unverified_channel")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    if (!cols.some((col) => col.name === "unverified_channel_id")) {
      validateMigrationColumnName("unverified_channel_id"); // Validate before interpolation
      logger.info(
        { table: "guild_config", column: "unverified_channel_id" },
        "[ensure] adding unverified_channel_id column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN unverified_channel_id TEXT`).run();
    }
    ensuredMigrations.add("guild_config_unverified_channel");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure unverified_channel_id column");
  }
}

export function ensureWelcomeTemplateColumn() {
  if (ensuredMigrations.has("guild_config_welcome_template")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    // PRAGMA table_info introspection to add missing welcome_template (migration-lite)
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    if (!cols.some((col) => col.name === "welcome_template")) {
      validateMigrationColumnName("welcome_template"); // Validate before interpolation
      logger.info(
        { table: "guild_config", column: "welcome_template" },
        "[ensure] adding welcome_template column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN welcome_template TEXT`).run();
    }
    ensuredMigrations.add("guild_config_welcome_template");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure welcome_template column");
  }
}

export function ensureWelcomeChannelsColumns() {
  if (ensuredMigrations.has("guild_config_welcome_channels")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    const missing = ["info_channel_id", "rules_channel_id", "welcome_ping_role_id"].filter(
      (col) => !cols.some((c) => c.name === col)
    );
    for (const col of missing) {
      validateMigrationColumnName(col); // Validate before interpolation
      logger.info({ table: "guild_config", column: col }, "[ensure] adding welcome channel column");
      db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
    }
    ensuredMigrations.add("guild_config_welcome_channels");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure welcome channel columns");
  }
}

export function ensureModRolesColumns() {
  /**
   * ensureModRolesColumns
   * WHAT: Migration helper to add mod_role_ids, gatekeeper_role_id, modmail_log_channel_id columns.
   * WHY: Supports new guild-scoped permission system for moderator roles.
   * DOCS:
   *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
   *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
   */
  if (ensuredMigrations.has("guild_config_mod_roles")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    const missing = [
      "mod_role_ids",
      "gatekeeper_role_id",
      "modmail_log_channel_id",
      "modmail_delete_on_close",
    ].filter((col) => !cols.some((c) => c.name === col));
    for (const col of missing) {
      validateMigrationColumnName(col); // Validate before interpolation
      logger.info({ table: "guild_config", column: col }, "[ensure] adding mod roles column");
      // modmail_delete_on_close is INTEGER (boolean), others are TEXT
      const colType = col === "modmail_delete_on_close" ? "INTEGER DEFAULT 1" : "TEXT";
      db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colType}`).run();
    }
    ensuredMigrations.add("guild_config_mod_roles");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure mod roles columns");
  }
}

export function ensureDadModeColumns() {
  /**
   * ensureDadModeColumns
   * WHAT: Migration helper to add dadmode_enabled and dadmode_odds columns.
   * WHY: Supports Dad Mode feature (playful I'm/Im responses).
   * DOCS:
   *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
   *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
   */
  if (ensuredMigrations.has("guild_config_dadmode")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    const missing = ["dadmode_enabled", "dadmode_odds"].filter(
      (col) => !cols.some((c) => c.name === col)
    );
    for (const col of missing) {
      validateMigrationColumnName(col); // Validate before interpolation
      logger.info({ table: "guild_config", column: col }, "[ensure] adding dadmode column");
      // dadmode_enabled is INTEGER (boolean 0/1), dadmode_odds is INTEGER (1 in N)
      const colDef =
        col === "dadmode_enabled" ? "INTEGER DEFAULT 0" : "INTEGER DEFAULT 1000";
      db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colDef}`).run();
    }
    ensuredMigrations.add("guild_config_dadmode");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure dadmode columns");
  }
}

export function ensureSkullModeColumns() {
  /**
   * ensureSkullModeColumns
   * WHAT: Migration helper to add skullmode_enabled and skullmode_odds columns.
   * WHY: Supports Skull Mode feature (random skull emoji reactions).
   * DOCS:
   *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
   *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
   */
  if (ensuredMigrations.has("guild_config_skullmode")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;

    if (!cols.some((col) => col.name === "skullmode_enabled")) {
      logger.info(
        { table: "guild_config", column: "skullmode_enabled" },
        "[ensure] adding skullmode_enabled column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN skullmode_enabled INTEGER DEFAULT 0`).run();
    }

    if (!cols.some((col) => col.name === "skullmode_odds")) {
      logger.info(
        { table: "guild_config", column: "skullmode_odds" },
        "[ensure] adding skullmode_odds column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN skullmode_odds INTEGER DEFAULT 1000`).run();
    }

    ensuredMigrations.add("guild_config_skullmode");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure skullmode columns");
  }
}

export function ensureListopenPublicOutputColumn() {
  /**
   * ensureListopenPublicOutputColumn
   * WHAT: Migration helper to add listopen_public_output column.
   * WHY: Allows guilds to toggle /listopen visibility (public vs ephemeral).
   * DOCS:
   *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
   *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
   */
  if (ensuredMigrations.has("guild_config_listopen_public_output")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    if (!cols.some((col) => col.name === "listopen_public_output")) {
      validateMigrationColumnName("listopen_public_output"); // Validate before interpolation
      logger.info(
        { table: "guild_config", column: "listopen_public_output" },
        "[ensure] adding listopen_public_output column (default 1 = public)"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN listopen_public_output INTEGER DEFAULT 1`).run();
    }
    ensuredMigrations.add("guild_config_listopen_public_output");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure listopen_public_output column");
  }
}

export function ensurePokeConfigColumns() {
  /**
   * ensurePokeConfigColumns
   * WHAT: Migration helper to add poke_category_ids_json and poke_excluded_channel_ids_json columns.
   * WHY: Allows guilds to configure /poke target categories and excluded channels without code changes.
   * DOCS:
   *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
   *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
   *  - Issue #79: docs/roadmap/079-move-poke-category-ids-to-config.md
   */
  if (ensuredMigrations.has("guild_config_poke")) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;

    if (!cols.some((col) => col.name === "poke_category_ids_json")) {
      logger.info(
        { table: "guild_config", column: "poke_category_ids_json" },
        "[ensure] adding poke_category_ids_json column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN poke_category_ids_json TEXT`).run();
    }

    if (!cols.some((col) => col.name === "poke_excluded_channel_ids_json")) {
      logger.info(
        { table: "guild_config", column: "poke_excluded_channel_ids_json" },
        "[ensure] adding poke_excluded_channel_ids_json column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN poke_excluded_channel_ids_json TEXT`).run();
    }

    ensuredMigrations.add("guild_config_poke");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure poke config columns");
  }
}

function invalidateCache(guildId: string) {
  configCache.delete(guildId);
}

/**
 * Clear config cache entry for a guild (called on guildDelete).
 * WHAT: Removes in-memory cache entry when bot leaves a guild
 * WHY: Prevents memory leak from accumulating entries for departed guilds
 * NOTE: Does NOT delete DB row - that data may be useful if bot rejoins
 */
export function clearConfigCache(guildId: string): void {
  const existed = configCache.delete(guildId);
  if (existed) {
    logger.debug({ guildId }, "[config] Cleared cache entry for departed guild");
  }
}

export function upsertConfig(guildId: string, partial: Partial<Omit<GuildConfig, "guild_id">>) {
  /**
   * upsertConfig
   * WHAT: Inserts or updates a guild_config row.
   * WHY: Keeps setup flows idempotent while allowing partial updates.
   * PARAMS:
   *  - guildId: target guild id
   *  - partial: subset of fields to set; other fields default
   * THROWS: Propagates errors; callers typically wrapped by cmdWrap.
   */
  // Prevent test/mock guild IDs from being saved to production database
  // This guards against leftover test data causing stale alert errors (Issue #67)
  // Someone (definitely not me) once shipped test data to prod. Never again.
  if (guildId.startsWith("test-") || guildId.startsWith("mock-")) {
    logger.warn(
      { guildId, partial },
      "[upsertConfig] Blocked attempt to save test guild to database"
    );
    throw new Error("Cannot save test guild to production database");
  }

  // NOTE: Schema ensure functions moved to startup (src/index.ts) for performance
  // Manual upsert pattern because SQLite's INSERT OR REPLACE would nuke columns
  // we didn't specify. This way partial updates actually work as expected.
  // GOTCHA: We SELECT * first even though it's a write path. If you're thinking
  // "that's wasteful," you're right. But SQLite is local and fast, and the
  // alternative is conditional SQL that's even uglier. Pick your battles.
  const existing = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
  if (!existing) {
    // INSERT with COALESCE defaults; schema columns documented near GuildConfig type
    db.prepare(
      `
      INSERT INTO guild_config (
        guild_id, review_channel_id, gate_channel_id, general_channel_id,
        unverified_channel_id, accepted_role_id, reviewer_role_id, welcome_template,
        info_channel_id, rules_channel_id, welcome_ping_role_id, image_search_url_template,
        reapply_cooldown_hours, min_account_age_hours, min_join_age_hours,
        avatar_scan_enabled, avatar_scan_nsfw_threshold, avatar_scan_skin_edge_threshold,
        avatar_scan_weight_model, avatar_scan_weight_edge, listopen_public_output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'https://lens.google.com/uploadbyurl?url={avatarUrl}'), COALESCE(?,24), COALESCE(?,0), COALESCE(?,0), COALESCE(?,1), COALESCE(?,0.60), COALESCE(?,0.18), COALESCE(?,0.7), COALESCE(?,0.3), COALESCE(?,1))
    `
    ).run(
      guildId,
      partial.review_channel_id ?? null,
      partial.gate_channel_id ?? null,
      partial.general_channel_id ?? null,
      partial.unverified_channel_id ?? null,
      partial.accepted_role_id ?? null,
      partial.reviewer_role_id ?? null,
      partial.welcome_template ?? null,
      partial.info_channel_id ?? null,
      partial.rules_channel_id ?? null,
      partial.welcome_ping_role_id ?? null,
      partial.image_search_url_template,
      partial.reapply_cooldown_hours,
      partial.min_account_age_hours,
      partial.min_join_age_hours,
      partial.avatar_scan_enabled ?? 1,
      partial.avatar_scan_nsfw_threshold ?? 0.6,
      partial.avatar_scan_skin_edge_threshold ?? 0.18,
      partial.avatar_scan_weight_model ?? 0.7,
      partial.avatar_scan_weight_edge ?? 0.3,
      partial.listopen_public_output ?? 1
    );
  } else {
    const keys = Object.keys(partial) as Array<keyof typeof partial>;
    if (keys.length === 0) return;

    // Allowlist of valid guild_config columns to prevent SQL injection via column names.
    // Even though keys come from typed partial, we add explicit validation for defense in depth.
    // "But TypeScript already validates this!" Sure, until someone does an `as any` cast.
    // Trust no one. Not even yourself from six months ago.
    const ALLOWED_CONFIG_COLUMNS = new Set([
      "review_channel_id", "gate_channel_id", "general_channel_id", "unverified_channel_id",
      "accepted_role_id", "reviewer_role_id", "welcome_template", "info_channel_id",
      "rules_channel_id", "welcome_ping_role_id", "mod_role_ids", "gatekeeper_role_id",
      "modmail_log_channel_id", "modmail_delete_on_close", "review_roles_mode",
      "dadmode_enabled", "dadmode_odds", "skullmode_enabled", "skullmode_odds",
      "listopen_public_output", "leadership_role_id",
      "ping_dev_on_app", "image_search_url_template", "reapply_cooldown_hours",
      "min_account_age_hours", "min_join_age_hours", "avatar_scan_enabled",
      "avatar_scan_nsfw_threshold", "avatar_scan_skin_edge_threshold",
      "avatar_scan_weight_model", "avatar_scan_weight_edge", "flags_channel_id",
      "silent_first_msg_days", "logging_channel_id", "notify_mode", "notify_role_id",
      "forum_channel_id", "notification_channel_id", "notify_cooldown_seconds",
      "notify_max_per_hour", "support_channel_id", "poke_category_ids_json", "poke_excluded_channel_ids_json",
      "artist_role_id", "ambassador_role_id", "server_artist_channel_id", "artist_ticket_roles_json",
      "artist_ignored_users_json", "backfill_notification_channel_id", "bot_dev_role_id",
      "gate_answer_max_length", "banner_sync_interval_minutes", "modmail_forward_max_size",
      "retry_max_attempts", "retry_initial_delay_ms", "retry_max_delay_ms",
      "circuit_breaker_threshold", "circuit_breaker_reset_ms",
      "avatar_scan_hard_threshold", "avatar_scan_soft_threshold", "avatar_scan_racy_threshold",
      "flag_rate_limit_ms", "flag_cooldown_ttl_ms", "banner_sync_enabled",
    ]);

    const validKeys = keys.filter((k) => ALLOWED_CONFIG_COLUMNS.has(k as string));
    if (validKeys.length !== keys.length) {
      const rejected = keys.filter((k) => !ALLOWED_CONFIG_COLUMNS.has(k as string));
      logger.error({ rejected, guildId }, "[upsertConfig] Invalid column names rejected");
    }
    if (validKeys.length === 0) return;

    // Dynamic SQL construction with validated column names. Values are parameterized.
    // This is the rare case where string interpolation in SQL is actually okay.
    // We validated the column names above, and values go through ? placeholders.
    const sets = validKeys.map((k) => `${k} = ?`).join(", ") + ", updated_at = datetime('now')";
    // SQLite doesn't have boolean type - store as 0/1 integers.
    // Every time I write this conversion, I die a little inside.
    const vals = validKeys.map((k) => {
      const val = partial[k];
      return typeof val === "boolean" ? (val ? 1 : 0) : val;
    });
    db.prepare(`UPDATE guild_config SET ${sets} WHERE guild_id = ?`).run(...vals, guildId);
  }
  invalidateCache(guildId);
  touchSyncMarker("config_upsert");
}

export function getConfig(guildId: string): GuildConfig | undefined {
  /**
   * getConfig
   * WHAT: Returns guild_config (cached for a few minutes).
   * WHY: Avoids repeated SQL on hot paths.
   * THROWS: Never; cache miss simply falls through to DB.
   */
  // NOTE: Schema ensure functions moved to startup (src/index.ts) for performance
  const cached = configCache.get(guildId);
  if (cached) {
    return cached;
  }
  const config = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as
    | (Omit<GuildConfig, "welcome"> & { welcome?: undefined })
    | undefined;

  if (config) {
    // Build the welcome object from flat fields
    const welcome = {
      infoChannelId: config.info_channel_id || undefined,
      rulesChannelId: config.rules_channel_id || undefined,
      extraPingRoleId: config.welcome_ping_role_id || undefined,
      generalChannelId: config.general_channel_id || "",
      cardStyle: "default" as const,
    };
    const fullConfig: GuildConfig = { ...config, welcome };
    configCache.set(guildId, fullConfig);
    return fullConfig;
  }
  return config;
}

export function hasManageGuild(member: GuildMember | APIInteractionGuildMember | null): boolean {
  /**
   * hasManageGuild
   * WHAT: Convenience for checking ManageGuild permission bit on a member.
   * LINK: https://discord.com/developers/docs/topics/permissions
   * NOTE: Returns false for APIInteractionGuildMember (string permissions) - requires full GuildMember.
   */
  if (!isGuildMember(member)) return false;
  return !!member.permissions?.has("ManageGuild");
}

export function hasStaffPermissions(
  member: GuildMember | APIInteractionGuildMember | null,
  guildId: string
): boolean {
  /**
   * hasStaffPermissions
   * WHAT: Checks if a member has staff permissions, including owner override.
   * WHY: Centralizes staff permission logic with owner bypass.
   * NOTE: Accepts both GuildMember and APIInteractionGuildMember but role/permission
   *       checks require full GuildMember - returns false for API members without owner bypass.
   */
  if (isOwner(member?.user?.id ?? "")) return true;
  // hasManageGuild and isReviewer require full GuildMember for role cache access
  if (!isGuildMember(member)) return false;
  return hasManageGuild(member) || isReviewer(guildId, member);
}

export function isReviewer(guildId: string, member: GuildMember | null): boolean {
  /**
   * isReviewer
   * WHAT: Determines if a member is reviewer staff, either via configured role or via visibility of the review channel.
   * WHY: Allows servers to control staff via channel perms without explicit role.
   */
  if (!member) return false;
  const row = db
    .prepare("SELECT review_channel_id, reviewer_role_id FROM guild_config WHERE guild_id = ?")
    .get(guildId) as
    | { review_channel_id?: string | null; reviewer_role_id?: string | null }
    | undefined;

  const reviewerRoleId = row?.reviewer_role_id ?? null;
  const reviewChannelId = row?.review_channel_id ?? null;

  // Legacy path: explicit reviewer role takes precedence if configured.
  // New path: if no role set, we infer reviewer status from channel visibility.
  // This is more flexible but requires careful channel permission setup.
  if (reviewerRoleId) {
    return member.roles.cache.has(reviewerRoleId);
  }

  // Channel-based reviewer detection: if you can see the review channel, you're staff.
  // This works well when review channel is locked to @Staff role - no extra config needed.
  // SECURITY NOTE: This means anyone with ViewChannel on the review channel is "staff."
  // Make sure your channel perms are locked down or randos get mod powers.
  // Yes, a misconfigured channel could make your entire server mods. You've been warned.
  if (!reviewChannelId) return false;

  const channel = member.guild.channels.cache.get(reviewChannelId);
  if (!channel || !("permissionsFor" in channel)) return false;

  const perms = channel.permissionsFor(member);
  return !!perms?.has("ViewChannel");
}

export function canRunAllCommands(member: GuildMember | null, guildId: string): boolean {
  /**
   * canRunAllCommands
   * WHAT: Centralized permission gate that returns true if a user can run all commands.
   * WHY: Unifies owner bypass and mod role checks across all commands.
   * LOGIC:
   *  1. Check if user ID is in OWNER_IDS env var (includes 697169405422862417)
   *  2. Check if member has any role in guild_config.mod_role_ids (CSV)
   * RETURNS: true if user is owner OR has a configured mod role
   * DOCS:
   *  - Discord permissions: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
   *  - Roles: https://discord.js.org/#/docs/discord.js/main/class/GuildMember?scrollTo=roles
   * TRACE: Logs each branch with user id, guild id, and roles checked for debugging
   */
  if (!member) {
    logger.debug(
      { evt: "permission_check", guildId, result: false, reason: "no_member" },
      "[canRunAllCommands] no member provided"
    );
    return false;
  }

  const userId = member.user.id;

  // Check if user is owner (OWNER_IDS from utils/owner.ts)
  // DOCS: https://discord.com/developers/docs/resources/user#user-object
  if (isOwner(userId)) {
    logger.debug(
      { evt: "permission_check", userId, guildId, result: true, reason: "owner" },
      "[canRunAllCommands] user is owner (OWNER_IDS)"
    );
    return true;
  }

  // Check mod_role_ids from guild config
  // DOCS: https://discord.js.org/#/docs/discord.js/main/class/RoleManager
  const config = getConfig(guildId);
  const modRoleIds = config?.mod_role_ids;

  if (!modRoleIds || modRoleIds.trim().length === 0) {
    logger.debug(
      {
        evt: "permission_check",
        userId,
        guildId,
        result: false,
        reason: "no_mod_roles_configured",
      },
      "[canRunAllCommands] no mod roles configured"
    );
    return false;
  }

  // mod_role_ids is stored as comma-separated string in DB. Not ideal for queries
  // but simple and works fine for the typical 1-3 mod roles per server.
  // If you're adding 50 mod roles, maybe reconsider your role hierarchy.
  // Also: no, we won't switch to a JSON array. CSV is readable in sqlite3 CLI.
  // EDGE CASE: trailing/leading commas or double commas are handled by the filter below.
  const modRoleIdList = modRoleIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  for (const roleId of modRoleIdList) {
    if (member.roles.cache.has(roleId)) {
      logger.debug(
        {
          evt: "permission_check",
          userId,
          guildId,
          roleId,
          result: true,
          reason: "has_mod_role",
        },
        "[canRunAllCommands] user has configured mod role"
      );
      return true;
    }
  }

  logger.debug(
    {
      evt: "permission_check",
      userId,
      guildId,
      modRoleIds: modRoleIdList,
      userRoles: Array.from(member.roles.cache.keys()),
      result: false,
      reason: "no_matching_role",
    },
    "[canRunAllCommands] user does not have any configured mod role"
  );
  return false;
}

export function requireStaff(
  interaction: ChatInputCommandInteraction,
  options?: PermissionDenialOptions
): boolean {
  /**
   * requireStaff
   * WHAT: Guards slash command handlers; ephemeral reply if caller lacks permissions.
   * WHY: Avoid noisy channel replies and ensure a predictable UX.
   * RETURNS: true if allowed; false if denied and a reply was attempted.
   * NOTE: Now uses canRunAllCommands for unified permission checking.
   *
   * @param options - Optional permission denial options for custom error messages.
   *                  If provided, shows an embed with specific role requirements.
   *                  If not provided, shows generic "You don't have permission" message.
   */
  const member = interaction.member as GuildMember | null;
  const guildId = interaction.guildId!;

  // Permission hierarchy: owner > mod roles > ManageGuild > reviewer role.
  // This layered check ensures bot owners always work, configured mod roles
  // work without needing server permissions, and falls back gracefully.
  // Why so many layers? Because every Discord server has a different idea of
  // what "staff" means, and we've had to accommodate all of them.
  const canRun = canRunAllCommands(member, guildId);
  if (canRun) {
    return true;
  }

  // Fall back to Discord's native permission (ManageGuild) or reviewer role
  const ok = hasStaffPermissions(member, guildId);
  if (!ok) {
    // Ephemeral reply avoids leaking permission info publicly.
    // Also prevents embarrassing "you're not staff" messages in general chat.
    if (options) {
      // Use new permission card with specific role requirements
      postPermissionDenied(interaction, options).catch((err) =>
        logger.warn({ err, command: options.command }, "Failed to send permission denied card")
      );
    } else {
      // Legacy generic message for backwards compatibility
      interaction
        .reply({
          flags: MessageFlags.Ephemeral,
          content: "You don't have permission to use this command.",
        })
        .catch((err) => logger.warn({ err }, "Failed to send permission denied message"));
    }
  }
  return ok;
}

function getBotOwnerIds(): string[] {
  /**
   * getBotOwnerIds
   * WHAT: Returns list of bot owner user IDs from environment.
   * WHY: Centralizes bot owner ID parsing for permission checks.
   * RETURNS: Array of user IDs (empty array if not configured)
   */
  const raw = env.OWNER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getGuildAdminRoleIds(guildId: string): string[] {
  /**
   * getGuildAdminRoleIds
   * WHAT: Returns list of gate admin role IDs for a guild.
   * WHY: Supports per-guild admin role configuration for gate commands.
   * RETURNS: Array of role IDs (falls back to env GATE_ADMIN_ROLE_IDS if no guild config)
   * FUTURE: Could be enhanced to read from guild_config table instead of env
   */
  // For now, use environment variable as a temporary implementation
  // In the future, this could read from guild_config table
  const raw = env.GATE_ADMIN_ROLE_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function hasGateAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  /**
   * hasGateAdmin
   * WHAT: Checks if user has permission to modify gate questions.
   * WHY: Provides fine-grained permission control for gate administration.
   * LOGIC:
   *  1. Bot owner override (OWNER_IDS env)
   *  2. Guild owner override (guild.ownerId)
   *  3. Configured admin roles (GATE_ADMIN_ROLE_IDS env or guild config)
   *  4. Manage Server permission (ManageGuild fallback)
   * RETURNS: true if user has any of the above permissions
   * DOCS:
   *  - Discord permissions: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
   *  - Guild owner: https://discord.js.org/#/docs/discord.js/main/class/Guild?scrollTo=ownerId
   */
  const userId = interaction.user.id;
  const guild = interaction.guild;
  if (!guild) return false;

  // 1) Bot owner override
  const botOwners = getBotOwnerIds();
  if (botOwners.includes(userId)) {
    logger.debug(
      { evt: "gate_admin_check", userId, guildId: guild.id, result: true, reason: "bot_owner" },
      "[hasGateAdmin] user is bot owner"
    );
    return true;
  }

  // 2) Guild owner override
  const ownerId = guild.ownerId;
  if (userId === ownerId) {
    logger.debug(
      { evt: "gate_admin_check", userId, guildId: guild.id, result: true, reason: "guild_owner" },
      "[hasGateAdmin] user is guild owner"
    );
    return true;
  }

  // 3) Configured admin roles for this guild
  const adminRoleIds = getGuildAdminRoleIds(guild.id);
  const member = interaction.member as GuildMember | null;
  if (member && adminRoleIds.length > 0) {
    for (const roleId of adminRoleIds) {
      if (member.roles.cache.has(roleId)) {
        logger.debug(
          {
            evt: "gate_admin_check",
            userId,
            guildId: guild.id,
            roleId,
            result: true,
            reason: "admin_role",
          },
          "[hasGateAdmin] user has configured admin role"
        );
        return true;
      }
    }
  }

  // 4) Manage Server fallback
  if (member && hasManageGuild(member)) {
    logger.debug(
      {
        evt: "gate_admin_check",
        userId,
        guildId: guild.id,
        result: true,
        reason: "manage_guild",
      },
      "[hasGateAdmin] user has ManageGuild permission"
    );
    return true;
  }

  logger.debug(
    {
      evt: "gate_admin_check",
      userId,
      guildId: guild.id,
      result: false,
      reason: "no_matching_permission",
    },
    "[hasGateAdmin] user does not have gate admin permissions"
  );
  return false;
}

/**
 * requireAdminOrLeadership
 * WHAT: Authorization helper for admin-level slash commands.
 * WHY: Centralizes multi-tier permission checking to avoid duplication and ensure consistent security.
 *
 * PERMISSION HIERARCHY (any one grants access):
 *   1. Bot owner (OWNER_IDS in env) - global override for debugging
 *   2. Guild owner - always has access to their own server
 *   3. Staff permissions (mod_role_ids or ManageGuild) - server admins
 *   4. Leadership role (leadership_role_id in config) - designated oversight role
 *
 * WHY SO MANY CHECKS?
 * Different servers organize their staff differently. Some have a dedicated
 * "Leadership" role for senior mods, others just use ManageGuild for admins.
 * We support all common patterns.
 *
 * The `member.permissions` string check handles an edge case where Discord
 * returns permissions as a bitfield string instead of a Permissions object
 * (happens in some webhook/API contexts).
 *
 * @param interaction - ChatInputCommandInteraction to check
 * @returns Promise<boolean> - true if authorized, false otherwise
 * DOCS:
 *  - Discord permissions: https://discord.com/developers/docs/topics/permissions
 */
export async function requireAdminOrLeadership(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!guildId) {
    return false;
  }

  // Owner override
  if (isOwner(userId)) {
    return true;
  }

  // Guild owner
  if (interaction.guild?.ownerId === userId) {
    return true;
  }

  // Member validation
  // WHY the string check? Discord's API sometimes returns permissions as a bitfield string
  // instead of a Permissions object. This happens in webhook contexts and cached payloads.
  // If you're seeing false negatives in permission checks, this is probably why.
  const member = interaction.member;
  if (!member || typeof member.permissions === "string") {
    return false;
  }

  // Staff permissions - hasStaffPermissions accepts the union type natively
  if (hasStaffPermissions(member, guildId)) {
    return true;
  }

  // Leadership role - need to check if member is a full GuildMember to access roles.cache
  const config = getConfig(guildId);
  if (
    config?.leadership_role_id &&
    isGuildMember(member) &&
    member.roles.cache.has(config.leadership_role_id)
  ) {
    return true;
  }

  return false;
}
