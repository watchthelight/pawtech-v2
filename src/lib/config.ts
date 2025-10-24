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
import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { MessageFlags } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "./logger.js";

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
  image_search_url_template: string;
  reapply_cooldown_hours: number;
  min_account_age_hours: number;
  min_join_age_hours: number;
  avatar_scan_enabled: number;
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

const configCache = new Map<string, { config: GuildConfig; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

let welcomeTemplateEnsured = false;
let welcomeChannelsEnsured = false;
let unverifiedChannelEnsured = false;
let modRolesColumnsEnsured = false;

function ensureUnverifiedChannelColumn() {
  if (unverifiedChannelEnsured) return;
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get() as { name: string } | undefined;
    if (!exists) {
      return;
    }
    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    if (!cols.some((col) => col.name === "unverified_channel_id")) {
      logger.info(
        { table: "guild_config", column: "unverified_channel_id" },
        "[ensure] adding unverified_channel_id column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN unverified_channel_id TEXT`).run();
    }
    unverifiedChannelEnsured = true;
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure unverified_channel_id column");
  }
}

function ensureWelcomeTemplateColumn() {
  if (welcomeTemplateEnsured) return;
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
      logger.info(
        { table: "guild_config", column: "welcome_template" },
        "[ensure] adding welcome_template column"
      );
      db.prepare(`ALTER TABLE guild_config ADD COLUMN welcome_template TEXT`).run();
    }
    welcomeTemplateEnsured = true;
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure welcome_template column");
  }
}

function ensureWelcomeChannelsColumns() {
  if (welcomeChannelsEnsured) return;
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
      logger.info({ table: "guild_config", column: col }, "[ensure] adding welcome channel column");
      db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
    }
    welcomeChannelsEnsured = true;
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure welcome channel columns");
  }
}

function ensureModRolesColumns() {
  /**
   * ensureModRolesColumns
   * WHAT: Migration helper to add mod_role_ids, gatekeeper_role_id, modmail_log_channel_id columns.
   * WHY: Supports new guild-scoped permission system for moderator roles.
   * DOCS:
   *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
   *  - ALTER TABLE: https://sqlite.org/lang_altertable.html
   */
  if (modRolesColumnsEnsured) return;
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
      logger.info({ table: "guild_config", column: col }, "[ensure] adding mod roles column");
      // modmail_delete_on_close is INTEGER (boolean), others are TEXT
      const colType = col === "modmail_delete_on_close" ? "INTEGER DEFAULT 1" : "TEXT";
      db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} ${colType}`).run();
    }
    modRolesColumnsEnsured = true;
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure mod roles columns");
  }
}

function invalidateCache(guildId: string) {
  configCache.delete(guildId);
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
  ensureUnverifiedChannelColumn();
  ensureWelcomeTemplateColumn();
  ensureWelcomeChannelsColumns();
  ensureModRolesColumns();
  // Read presence of row to decide INSERT vs UPDATE
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
        avatar_scan_weight_model, avatar_scan_weight_edge
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'https://lens.google.com/uploadbyurl?url={avatarUrl}'), COALESCE(?,24), COALESCE(?,0), COALESCE(?,0), COALESCE(?,1), COALESCE(?,0.60), COALESCE(?,0.18), COALESCE(?,0.7), COALESCE(?,0.3))
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
      partial.avatar_scan_weight_edge ?? 0.3
    );
  } else {
    const keys = Object.keys(partial) as Array<keyof typeof partial>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ") + ", updated_at = datetime('now')";
    const vals = keys.map((k) => partial[k]);
    // UPDATE path with dynamic SET list; safe values substituted via prepare(...).run(...)
    db.prepare(`UPDATE guild_config SET ${sets} WHERE guild_id = ?`).run(...vals, guildId);
  }
  invalidateCache(guildId);
}

export function getConfig(guildId: string): GuildConfig | undefined {
  /**
   * getConfig
   * WHAT: Returns guild_config (cached for a few minutes).
   * WHY: Avoids repeated SQL on hot paths.
   * THROWS: Never; cache miss simply falls through to DB.
   */
  ensureUnverifiedChannelColumn();
  ensureWelcomeTemplateColumn();
  ensureWelcomeChannelsColumns();
  ensureModRolesColumns();
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.config;
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
    configCache.set(guildId, { config: fullConfig, timestamp: Date.now() });
    return fullConfig;
  }
  return config;
}

export function hasManageGuild(member: GuildMember | null): boolean {
  /**
   * hasManageGuild
   * WHAT: Convenience for checking ManageGuild permission bit on a member.
   * LINK: https://discord.com/developers/docs/topics/permissions
   */
  return !!member?.permissions?.has("ManageGuild");
}

export function hasStaffPermissions(member: GuildMember | null, guildId: string): boolean {
  /**
   * hasStaffPermissions
   * WHAT: Checks if a member has staff permissions, including owner override.
   * WHY: Centralizes staff permission logic with owner bypass.
   */
  const { isOwner } = require("../utils/owner.js");
  if (isOwner(member?.user?.id ?? "")) return true;
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

  // If a reviewer role is configured, use that (old behavior)
  if (reviewerRoleId) {
    return member.roles.cache.has(reviewerRoleId);
  }

  // Otherwise: treat users who can VIEW the review channel as staff
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

  // Import isOwner from utils/owner.ts to check OWNER_IDS
  // DOCS: https://discord.com/developers/docs/resources/user#user-object
  const { isOwner } = require("../utils/owner.js");
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

  // Parse CSV and check if member has any of the configured roles
  // DOCS: https://discord.js.org/#/docs/discord.js/main/class/GuildMemberRoleManager
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

export function requireStaff(interaction: ChatInputCommandInteraction): boolean {
  /**
   * requireStaff
   * WHAT: Guards slash command handlers; ephemeral reply if caller lacks permissions.
   * WHY: Avoid noisy channel replies and ensure a predictable UX.
   * RETURNS: true if allowed; false if denied and a reply was attempted.
   * NOTE: Now uses canRunAllCommands for unified permission checking.
   */
  const member = interaction.member as GuildMember | null;
  const guildId = interaction.guildId!;

  // Try canRunAllCommands first (owner + mod roles)
  const canRun = canRunAllCommands(member, guildId);
  if (canRun) {
    return true;
  }

  // Fall back to hasStaffPermissions (ManageGuild or reviewer role)
  const ok = hasStaffPermissions(member, guildId);
  if (!ok) {
    // Ephemeral reply avoids leaking permission info publicly.
    interaction
      .reply({
        flags: MessageFlags.Ephemeral,
        content: "You don't have permission to manage gate settings.",
      })
      .catch((err) => logger.warn({ err }, "Failed to send permission denied message"));
  }
  return ok;
}
