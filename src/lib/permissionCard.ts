/**
 * Pawtropolis Tech — src/lib/permissionCard.ts
 * WHAT: Public permission denial embeds with intelligent role resolution.
 * WHY: Provides users with specific, actionable feedback about which roles they need.
 *      Public (not ephemeral) so staff can see unauthorized command attempts.
 * FLOWS:
 *  - Command checks permission → fails → postPermissionDenied() → shows role names
 * DOCS:
 *  - EmbedBuilder: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import { logger } from "./logger.js";
import { ROLE_NAMES, getRolesAtOrAbove, getMinRoleDescription } from "./roles.js";
import { getConfig } from "./config.js";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Defines what permission(s) would grant access to a command.
 * Uses discriminated union for type-safe handling.
 */
export type PermissionRequirement =
  | { type: "roles"; roleIds: string[] }
  | { type: "hierarchy"; minRoleId: string }
  | { type: "config"; field: "mod_role_ids" | "reviewer_role_id" | "artist_role_id" | "leadership_role_id" }
  | { type: "permission"; permission: "ManageGuild" | "ManageRoles" | "ManageMessages" }
  | { type: "owner" };

/**
 * Options for the permission denial embed.
 */
export interface PermissionDenialOptions {
  /** Command name (e.g., "backfill", "audit nsfw") */
  command: string;
  /** Human-readable description of what the command does */
  description: string;
  /** List of permission requirements (OR logic - user needs ANY of these) */
  requirements: PermissionRequirement[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolves role IDs to displayable role mentions or names.
 * Uses role mentions (<@&id>) which Discord renders as role names.
 */
async function resolveRoleDisplay(
  guild: Guild,
  roleIds: string[]
): Promise<string[]> {
  const displays: string[] = [];
  for (const id of roleIds) {
    // Use role mention format - Discord will render it as the role name
    // This works even if the role is deleted (shows as @deleted-role)
    displays.push(`<@&${id}>`);
  }
  return displays;
}

/**
 * Resolves a permission requirement to a list of displayable strings.
 */
async function resolveRequirement(
  guild: Guild,
  guildId: string,
  req: PermissionRequirement
): Promise<string[]> {
  switch (req.type) {
    case "roles": {
      // For explicit role lists, show each role with its name
      const displays: string[] = [];
      for (const id of req.roleIds) {
        const name = ROLE_NAMES[id];
        if (name) {
          displays.push(`<@&${id}> (${name})`);
        } else {
          displays.push(`<@&${id}>`);
        }
      }
      return displays;
    }

    case "hierarchy": {
      // For hierarchical requirements, show "X or above" with role list
      const minDescription = getMinRoleDescription(req.minRoleId);
      const rolesAbove = getRolesAtOrAbove(req.minRoleId);
      const roleNames = rolesAbove.map((id) => {
        const name = ROLE_NAMES[id];
        return name ? `<@&${id}>` : `<@&${id}>`;
      });
      return [`**${minDescription}**\n${roleNames.map((r) => `  ${r}`).join("\n")}`];
    }

    case "config": {
      // Legacy support for config-based roles (will be migrated to explicit roles)
      const config = getConfig(guildId);
      if (!config) return [`*${req.field} not configured*`];

      switch (req.field) {
        case "mod_role_ids": {
          const ids = config.mod_role_ids?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
          if (ids.length === 0) return ["*No staff roles configured*"];
          const roles = await resolveRoleDisplay(guild, ids);
          return roles.map((r) => `${r} (staff)`);
        }
        case "reviewer_role_id": {
          if (!config.reviewer_role_id) return ["*No reviewer role configured*"];
          return [`<@&${config.reviewer_role_id}> (reviewer)`];
        }
        case "artist_role_id": {
          if (!config.artist_role_id) return ["*No artist role configured*"];
          return [`<@&${config.artist_role_id}>`];
        }
        case "leadership_role_id": {
          if (!config.leadership_role_id) return ["*No leadership role configured*"];
          return [`<@&${config.leadership_role_id}> (leadership)`];
        }
        default:
          return [`*Unknown config field*`];
      }
    }

    case "permission":
      switch (req.permission) {
        case "ManageGuild":
          return ["**Manage Server** permission"];
        case "ManageRoles":
          return ["**Manage Roles** permission"];
        case "ManageMessages":
          return ["**Manage Messages** permission"];
        default:
          return [`**${req.permission}** permission`];
      }

    case "owner":
      return ["**Bot Owner** or **Server Dev**"];

    default:
      return ["*Unknown requirement*"];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Posts a public permission denial embed with specific role requirements.
 *
 * @example
 * await postPermissionDenied(interaction, {
 *   command: "backfill",
 *   description: "Backfills historical application data into the database.",
 *   requirements: [
 *     { type: "config", field: "mod_role_ids" },
 *     { type: "permission", permission: "ManageGuild" },
 *   ],
 * });
 */
export async function postPermissionDenied(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  options: PermissionDenialOptions
): Promise<void> {
  const { command, description, requirements } = options;
  const traceId = interaction.id.slice(-8).toUpperCase();

  // Resolve all requirements to displayable strings
  const resolvedReqs: string[] = [];
  if (interaction.guild) {
    for (const req of requirements) {
      const resolved = await resolveRequirement(
        interaction.guild,
        interaction.guildId!,
        req
      );
      resolvedReqs.push(...resolved);
    }
  } else {
    resolvedReqs.push("*Could not resolve requirements (no guild context)*");
  }

  // Build the embed
  const embed = new EmbedBuilder()
    .setColor(0xED4245) // Discord red
    .setTitle("Permission Denied")
    .setDescription(
      `**Command:** \`/${command}\`\n\n` +
      `${description}\n\n` +
      `**You need one of:**\n` +
      resolvedReqs.map((r) => `• ${r}`).join("\n")
    )
    .setFooter({ text: `Trace: ${traceId}` })
    .setTimestamp();

  // Send public reply (visible to all for moderation purposes)
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({
        embeds: [embed],
      });
    }
  } catch (err) {
    logger.warn(
      { err, command, traceId },
      "[permissionCard] Failed to send permission denial embed"
    );
    // Fallback to simple text reply
    try {
      const fallbackMsg = `You don't have permission to use \`/${command}\`. Required: ${resolvedReqs.join(" or ")}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: fallbackMsg });
      } else {
        await interaction.reply({
          content: fallbackMsg,
        });
      }
    } catch (fallbackErr) {
      logger.error(
        { err: fallbackErr, command, traceId },
        "[permissionCard] Fallback reply also failed"
      );
    }
  }

  logger.info(
    {
      command,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      traceId,
    },
    "[permissionCard] Permission denied"
  );
}
