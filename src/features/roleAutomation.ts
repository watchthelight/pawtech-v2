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

  // Check role hierarchy
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

// ============================================================================
// Audit Trail Logging
// ============================================================================

/**
 * Log role assignment to audit trail
 */
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
export async function assignRole(
  guild: Guild,
  userId: string,
  roleId: string,
  reason: string,
  triggeredBy: string
): Promise<RoleAssignmentResult> {
  try {
    // Fetch member
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
