// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/roleAutomation.ts
 * WHAT: Core role automation service for level rewards, movie nights, and audit trail
 * WHY: Centralized role assignment with permission checks and full audit logging
 * FLOWS:
 *  - Event triggers → check permissions → assign/remove role → log to audit trail
 * DOCS:
 *  - Discord.js Roles: https://discord.js.org/#/docs/discord.js/main/class/Role
 *  - Discord.js Permissions: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
 */

import type { Guild, GuildMember, Role } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Types
// ============================================================================

// The "skipped" action is doing a lot of heavy lifting here. It means:
// 1. User already had/didn't have the role (no-op)
// 2. Permission error (couldn't do it)
// 3. Member/role not found (target doesn't exist)
// Callers need to check the error field to know which one happened.
export interface RoleAssignmentResult {
  success: boolean;
  roleId: string;
  roleName: string;
  action: "add" | "remove" | "skipped";
  reason?: string;
  error?: string;
}

export interface RoleTier {
  id: number;
  guild_id: string;
  tier_type: "level" | "movie_night" | "activity_reward";
  tier_name: string;
  role_id: string;
  threshold: number;
}

export interface LevelReward {
  id: number;
  guild_id: string;
  level: number;
  role_id: string;
  role_name: string;
}

export interface RoleAssignment {
  id: number;
  guild_id: string;
  user_id: string;
  role_id: string;
  role_name: string | null;
  action: "add" | "remove" | "skipped";
  reason: string | null;
  triggered_by: string;
  details: string | null;
  created_at: number;
}

// ============================================================================
// Permission & Hierarchy Checks
// ============================================================================

/**
 * Check if the bot can manage a specific role
 * @returns true if bot has MANAGE_ROLES and role is below bot's highest role
 */
// Pre-flight check before any role operation. Discord's role hierarchy rules:
// 1. Bot needs MANAGE_ROLES permission (server-level)
// 2. Bot's highest role must be ABOVE the target role (position comparison)
// 3. Server owner bypasses this, but bots never do
// Always call this before add/remove to get a clear error message instead of cryptic 50013.
export async function canManageRole(guild: Guild, roleId: string): Promise<{
  canManage: boolean;
  reason?: string;
}> {
  const botMember = guild.members.me;
  if (!botMember) {
    return { canManage: false, reason: "Bot member not found in guild" };
  }

  // Check MANAGE_ROLES permission
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { canManage: false, reason: "Bot missing MANAGE_ROLES permission" };
  }

  // Check role hierarchy - this is the most common failure mode.
  // Bot's highest role position must be strictly greater than target role's position.
  const targetRole = guild.roles.cache.get(roleId);
  if (!targetRole) {
    return { canManage: false, reason: "Target role not found" };
  }

  const botHighestRole = botMember.roles.highest;
  if (botHighestRole.position <= targetRole.position) {
    return {
      canManage: false,
      reason: `Role hierarchy violation: bot role (${botHighestRole.name} @${botHighestRole.position}) is not above target role (${targetRole.name} @${targetRole.position})`,
    };
  }

  return { canManage: true };
}

/**
 * Synchronous check if the bot can manage a specific role (using Role object directly)
 * @returns object with canManage boolean and optional reason
 *
 * Use this when you already have the Role object (e.g., from command options).
 * This avoids redundant cache lookups and is synchronous since no fetching is needed.
 */
export function canManageRoleSync(guild: Guild, role: Role): {
  canManage: boolean;
  reason?: string;
} {
  const botMember = guild.members.me;
  if (!botMember) {
    return { canManage: false, reason: "Bot member not found in guild" };
  }

  // Check MANAGE_ROLES permission
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { canManage: false, reason: "Bot lacks Manage Roles permission" };
  }

  // Check for @everyone role (position 0)
  // Fun fact: @everyone is technically a role with the same ID as the guild.
  // Discord's API will let you try to assign it, then laugh at you with a 400.
  if (role.id === guild.id) {
    return { canManage: false, reason: "@everyone role cannot be assigned" };
  }

  // Check for managed roles (bot/integration roles)
  // These are the colored roles that bots get automatically (e.g., "MEE6", "Dyno").
  // Discord manages these internally. Trying to assign them is a fool's errand.
  if (role.managed) {
    return { canManage: false, reason: "This is a managed role (bot/integration) and cannot be assigned manually" };
  }

  // Check role hierarchy
  const botHighestRole = botMember.roles.highest;
  if (botHighestRole.position <= role.position) {
    return {
      canManage: false,
      reason: `Role is at position ${role.position}, but bot's highest role (${botHighestRole.name}) is at position ${botHighestRole.position}. The role must be below the bot's highest role.`,
    };
  }

  return { canManage: true };
}

// ============================================================================
// Audit Trail Logging
// ============================================================================

/**
 * Log role assignment to audit trail
 */
// Audit logging is synchronous (SQLite). If this becomes a bottleneck, consider:
// 1. Batching writes with a queue
// 2. Moving to async writes with WAL mode
// The details JSON blob is optional but useful for debugging failures.
function logRoleAssignment(
  guildId: string,
  userId: string,
  roleId: string,
  roleName: string,
  action: "add" | "remove" | "skipped",
  reason: string,
  triggeredBy: string,
  details?: Record<string, any>
): void {
  const stmt = db.prepare(`
    INSERT INTO role_assignments (
      guild_id, user_id, role_id, role_name, action, reason, triggered_by, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    guildId,
    userId,
    roleId,
    roleName,
    action,
    reason,
    triggeredBy,
    details ? JSON.stringify(details) : null,
    Math.floor(Date.now() / 1000)
  );

  logger.info(
    {
      evt: "role_assignment",
      guildId,
      userId,
      roleId,
      roleName,
      action,
      reason,
      triggeredBy,
    },
    `Role ${action}: ${roleName}`
  );
}

// ============================================================================
// Core Role Assignment
// ============================================================================

/**
 * Assign a role to a user with full audit trail
 */
// Idempotent: if user already has the role, logs "skipped" and returns success.
// This prevents duplicate role adds from spamming Discord's API and audit log.
// Errors are caught and logged, never thrown - callers check result.success instead.
export async function assignRole(
  guild: Guild,
  userId: string,
  roleId: string,
  reason: string,
  triggeredBy: string
): Promise<RoleAssignmentResult> {
  try {
    // Fetch member - catch handles users who left the server
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      const errorMsg = "Member not found in guild";
      logger.warn({ evt: "role_assign_fail", userId, roleId, reason: errorMsg });
      logRoleAssignment(guild.id, userId, roleId, "Unknown", "skipped", reason, triggeredBy, {
        error: errorMsg,
      });
      return {
        success: false,
        roleId,
        roleName: "Unknown",
        action: "skipped",
        error: errorMsg,
      };
    }

    // Get role
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      const errorMsg = "Role not found in guild";
      logger.warn({ evt: "role_assign_fail", roleId, reason: errorMsg });
      logRoleAssignment(guild.id, userId, roleId, "Unknown", "skipped", reason, triggeredBy, {
        error: errorMsg,
      });
      return {
        success: false,
        roleId,
        roleName: "Unknown",
        action: "skipped",
        error: errorMsg,
      };
    }

    // Check if user already has role
    if (member.roles.cache.has(roleId)) {
      logger.debug({ evt: "role_already_exists", userId, roleId, roleName: role.name });
      logRoleAssignment(guild.id, userId, roleId, role.name, "skipped", reason, triggeredBy, {
        message: "User already has role",
      });
      return {
        success: true,
        roleId,
        roleName: role.name,
        action: "skipped",
        reason: "User already has role",
      };
    }

    // Check permissions and hierarchy
    const permCheck = await canManageRole(guild, roleId);
    if (!permCheck.canManage) {
      logger.error({ evt: "role_assign_perm_fail", roleId, roleName: role.name, reason: permCheck.reason });
      logRoleAssignment(guild.id, userId, roleId, role.name, "skipped", reason, triggeredBy, {
        error: permCheck.reason,
      });
      return {
        success: false,
        roleId,
        roleName: role.name,
        action: "skipped",
        error: permCheck.reason,
      };
    }

    // Assign role
    // The reason string shows up in Discord's audit log. Useful for figuring out
    // "why does this user have 47 roles" six months from now.
    await member.roles.add(roleId, `${reason} (triggered by: ${triggeredBy})`);
    logRoleAssignment(guild.id, userId, roleId, role.name, "add", reason, triggeredBy);

    return {
      success: true,
      roleId,
      roleName: role.name,
      action: "add",
    };
  } catch (err) {
    logger.error({ evt: "role_assign_error", userId, roleId, err }, "Error assigning role");
    logRoleAssignment(guild.id, userId, roleId, "Unknown", "skipped", reason, triggeredBy, {
      error: String(err),
    });
    return {
      success: false,
      roleId,
      roleName: "Unknown",
      action: "skipped",
      error: String(err),
    };
  }
}

/**
 * Remove a role from a user with full audit trail
 */
export async function removeRole(
  guild: Guild,
  userId: string,
  roleId: string,
  reason: string,
  triggeredBy: string
): Promise<RoleAssignmentResult> {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      const errorMsg = "Member not found in guild";
      logger.warn({ evt: "role_remove_fail", userId, roleId, reason: errorMsg });
      return {
        success: false,
        roleId,
        roleName: "Unknown",
        action: "skipped",
        error: errorMsg,
      };
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      const errorMsg = "Role not found in guild";
      logger.warn({ evt: "role_remove_fail", roleId, reason: errorMsg });
      return {
        success: false,
        roleId,
        roleName: "Unknown",
        action: "skipped",
        error: errorMsg,
      };
    }

    // Check if user doesn't have role
    if (!member.roles.cache.has(roleId)) {
      logger.debug({ evt: "role_not_found_on_user", userId, roleId, roleName: role.name });
      logRoleAssignment(guild.id, userId, roleId, role.name, "skipped", reason, triggeredBy, {
        message: "User doesn't have role",
      });
      return {
        success: true,
        roleId,
        roleName: role.name,
        action: "skipped",
        reason: "User doesn't have role",
      };
    }

    // Check permissions
    const permCheck = await canManageRole(guild, roleId);
    if (!permCheck.canManage) {
      logger.error({ evt: "role_remove_perm_fail", roleId, roleName: role.name, reason: permCheck.reason });
      logRoleAssignment(guild.id, userId, roleId, role.name, "skipped", reason, triggeredBy, {
        error: permCheck.reason,
      });
      return {
        success: false,
        roleId,
        roleName: role.name,
        action: "skipped",
        error: permCheck.reason,
      };
    }

    // Remove role
    await member.roles.remove(roleId, `${reason} (triggered by: ${triggeredBy})`);
    logRoleAssignment(guild.id, userId, roleId, role.name, "remove", reason, triggeredBy);

    return {
      success: true,
      roleId,
      roleName: role.name,
      action: "remove",
    };
  } catch (err) {
    logger.error({ evt: "role_remove_error", userId, roleId, err }, "Error removing role");
    return {
      success: false,
      roleId,
      roleName: "Unknown",
      action: "skipped",
      error: String(err),
    };
  }
}

// ============================================================================
// Role Tier & Reward Queries
// ============================================================================

/**
 * Get all role tiers for a guild by type
 */
// Role tiers are the threshold-based role rewards (e.g., "Level 10 = Gold Member").
// When tierType is provided, filters to just that category. Otherwise returns all tiers.
// Results sorted by threshold ASC so progression order is intuitive.
export function getRoleTiers(guildId: string, tierType?: string): RoleTier[] {
  if (tierType) {
    const stmt = db.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND tier_type = ?
      ORDER BY threshold ASC
    `);
    return stmt.all(guildId, tierType) as RoleTier[];
  } else {
    const stmt = db.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ?
      ORDER BY tier_type, threshold ASC
    `);
    return stmt.all(guildId) as RoleTier[];
  }
}

/**
 * Get role tier by role ID (to detect when Amaribot assigns a level role)
 */
// Used for reverse lookup: when we see a role added, check if it's a tier role we track.
// This enables reacting to external bots (like AmariBot) assigning level roles.
export function getRoleTierByRoleId(guildId: string, roleId: string): RoleTier | null {
  const stmt = db.prepare(`
    SELECT * FROM role_tiers
    WHERE guild_id = ? AND role_id = ?
    LIMIT 1
  `);
  return (stmt.get(guildId, roleId) as RoleTier) || null;
}

/**
 * Get level rewards for a specific level
 */
export function getLevelRewards(guildId: string, level: number): LevelReward[] {
  const stmt = db.prepare(`
    SELECT * FROM level_rewards
    WHERE guild_id = ? AND level = ?
  `);
  return stmt.all(guildId, level) as LevelReward[];
}

/**
 * Get assignment history for a user
 *
 * Useful for debugging "why do I have this role?" questions.
 * Default limit of 50 is usually enough - if a user has more than 50 role
 * changes, they're either a mod being tested on or something is very wrong.
 */
export function getAssignmentHistory(
  guildId: string,
  userId: string,
  limit: number = 50
): RoleAssignment[] {
  const stmt = db.prepare(`
    SELECT * FROM role_assignments
    WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(guildId, userId, limit) as RoleAssignment[];
}

/**
 * Get recent role assignments (for admin monitoring)
 */
export function getRecentAssignments(guildId: string, limit: number = 100): RoleAssignment[] {
  const stmt = db.prepare(`
    SELECT * FROM role_assignments
    WHERE guild_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(guildId, limit) as RoleAssignment[];
}
