// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/levelRewards.ts
 * WHAT: Level rewards handler - grants tokens/tickets when users level up
 * WHY: Automates reward assignment when Amaribot assigns level roles
 * FLOWS:
 *  - guildMemberUpdate detects level role → grant rewards → log to audit trail
 * DOCS:
 *  - Discord.js GuildMember: https://discord.js.org/#/docs/discord.js/main/class/GuildMember
 */

import type { Guild, GuildMember } from "discord.js";
import { logger } from "../lib/logger.js";
import {
  assignRole,
  getLevelRewards,
  getRoleTierByRoleId,
  type RoleAssignmentResult,
} from "./roleAutomation.js";
import { isPanicMode } from "./panicStore.js";
import { logActionPretty } from "../logging/pretty.js";

/**
 * Handle when a user receives a level role from Amaribot
 * This is triggered by guildMemberUpdate when new roles are detected
 */
export async function handleLevelRoleAdded(
  guild: Guild,
  member: GuildMember,
  levelRoleId: string
): Promise<RoleAssignmentResult[]> {
  const results: RoleAssignmentResult[] = [];

  // Check panic mode - emergency shutoff
  if (isPanicMode(guild.id)) {
    logger.warn({
      evt: "level_reward_blocked_panic",
      guildId: guild.id,
      userId: member.id,
      roleId: levelRoleId,
    }, "Level reward blocked - panic mode active");

    // Log to Discord channel
    await logActionPretty(guild, {
      actorId: "system",
      subjectId: member.id,
      action: "role_grant_blocked",
      reason: "Panic mode active",
      meta: { roleId: levelRoleId },
    }).catch(() => {}); // Don't fail if logging fails

    return results;
  }

  try {
    // Get the level tier for this role
    const tier = getRoleTierByRoleId(guild.id, levelRoleId);
    if (!tier) {
      logger.debug({
        evt: "level_role_not_configured",
        guildId: guild.id,
        userId: member.id,
        roleId: levelRoleId,
      }, "Role added but not configured as level tier");
      return results;
    }

    if (tier.tier_type !== "level") {
      logger.warn({
        evt: "unexpected_tier_type",
        guildId: guild.id,
        userId: member.id,
        roleId: levelRoleId,
        tierType: tier.tier_type,
      }, "Role tier is not a level tier");
      return results;
    }

    const level = tier.threshold;
    logger.info({
      evt: "level_up_detected",
      guildId: guild.id,
      userId: member.id,
      username: member.user.username,
      level,
      roleName: tier.tier_name,
    }, `User leveled up to ${level}`);

    // Get rewards for this level
    const rewards = getLevelRewards(guild.id, level);
    if (rewards.length === 0) {
      logger.debug({
        evt: "no_rewards_for_level",
        guildId: guild.id,
        level,
      }, "No rewards configured for this level");
      return results;
    }

    logger.info({
      evt: "granting_level_rewards",
      guildId: guild.id,
      userId: member.id,
      level,
      rewardCount: rewards.length,
    }, `Granting ${rewards.length} rewards for level ${level}`);

    // Grant each reward
    for (const reward of rewards) {
      const result = await assignRole(
        guild,
        member.id,
        reward.role_id,
        `level_${level}_reward`,
        "system"
      );
      results.push(result);

      if (result.action === "add") {
        logger.info({
          evt: "reward_granted",
          guildId: guild.id,
          userId: member.id,
          level,
          rewardRole: reward.role_name,
        }, `Granted reward: ${reward.role_name}`);

        // Log to Discord channel
        await logActionPretty(guild, {
          actorId: "system",
          subjectId: member.id,
          action: "role_grant",
          reason: `Level ${level} reward`,
          meta: { level, roleName: reward.role_name, roleId: reward.role_id },
        }).catch(() => {});
      } else if (result.action === "skipped") {
        logger.info({
          evt: "reward_skipped",
          guildId: guild.id,
          userId: member.id,
          level,
          rewardRole: reward.role_name,
          reason: result.reason,
        }, `Skipped reward: ${reward.role_name} (${result.reason})`);

        // Log skips to Discord channel too
        await logActionPretty(guild, {
          actorId: "system",
          subjectId: member.id,
          action: "role_grant_skipped",
          reason: result.reason || "Already has role",
          meta: { level, roleName: reward.role_name, roleId: reward.role_id },
        }).catch(() => {});
      } else if (!result.success) {
        logger.error({
          evt: "reward_error",
          guildId: guild.id,
          userId: member.id,
          level,
          rewardRole: reward.role_name,
          error: result.error,
        }, `Failed to grant reward: ${reward.role_name}`);

        // Log errors to Discord channel
        await logActionPretty(guild, {
          actorId: "system",
          subjectId: member.id,
          action: "role_grant_blocked",
          reason: result.error || "Unknown error",
          meta: { level, roleName: reward.role_name, roleId: reward.role_id },
        }).catch(() => {});
      }
    }

    return results;
  } catch (err) {
    logger.error({
      evt: "level_reward_error",
      guildId: guild.id,
      userId: member.id,
      levelRoleId,
      err,
    }, "Error handling level rewards");
    return results;
  }
}

