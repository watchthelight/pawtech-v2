/**
 * Pawtropolis Tech — src/commands/unblock.ts
 * WHAT: Slash command to remove permanent rejection status from a user
 * WHY: Allows moderators to give users a second chance by lifting permanent bans
 * FLOWS:
 *  - /unblock <target|user_id|username> [reason] — Removes permanent rejection and logs action
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  type User,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { requireStaff } from "../lib/config.js";
import { db } from "../db/db.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { postAuditEmbed } from "../features/logger.js";

// Multiple input options because blocked users often leave the server.
// Priority: target (mention) > user_id (string) > username (DB lookup, not implemented)
// All options are optional because we validate at runtime - can't enforce "at least one" in schema.
export const data = new SlashCommandBuilder()
  .setName("unblock")
  .setDescription("Remove permanent rejection from a user")
  .addUserOption((option) =>
    option
      .setName("target")
      .setDescription("User to unblock (mention or select)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("user_id")
      .setDescription("Discord User ID (if user has left the server)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("username")
      .setDescription("Username (fallback if mention/ID unavailable)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for unblocking (optional)")
      .setRequired(false)
  );

interface PermRejectRow {
  permanently_rejected: number;
  permanent_reject_at: string | null;
  user_id: string;
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId, guild } = interaction;

  if (!guildId || !guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Require staff permissions
  if (!requireStaff(interaction, {
    command: "unblock",
    description: "Removes permanent rejection from a user, allowing them to reapply.",
    requirements: [{ type: "config", field: "mod_role_ids" }],
  })) return;

  // Resolve target user from options
  let targetUser: User | null = null;
  let targetUserId: string | null = null;

  // Priority 1: User mention/selection
  const mentionedUser = interaction.options.getUser("target", false);
  if (mentionedUser) {
    targetUser = mentionedUser;
    targetUserId = mentionedUser.id;
  }

  // Priority 2: User ID string - useful when user left the server
  if (!targetUserId) {
    const userIdStr = interaction.options.getString("user_id", false);
    if (userIdStr) {
      targetUserId = userIdStr.trim();
      // Attempt to resolve user object for DM notifications and display name.
      // This can fail if the user deleted their account or we've never seen them.
      try {
        targetUser = await interaction.client.users.fetch(targetUserId);
      } catch (err) {
        logger.debug({ err, userId: targetUserId }, "[unblock] Could not fetch user by ID");
        // Continue anyway - we can still unblock by ID alone
      }
    }
  }

  // Priority 3: Username (query database for user_id)
  if (!targetUserId) {
    const username = interaction.options.getString("username", false);
    if (username) {
      // Search database for applications with matching username
      // This is a fallback and may not be accurate if usernames change
      logger.warn(
        { guildId, username },
        "[unblock] Username lookup not implemented - use user mention or ID instead"
      );
      await interaction.reply({
        content: "❌ Username lookup is not supported. Please use a user mention or User ID.",
        ephemeral: true,
      });
      return;
    }
  }

  // Validate we have a target
  if (!targetUserId) {
    await interaction.reply({
      content: "❌ Please provide a user via mention, User ID, or username.",
      ephemeral: true,
    });
    return;
  }

  const reason = interaction.options.getString("reason", false) || "none provided";

  // Public reply (ephemeral: false) because unblocking is a moderation action
  // that should be visible to the team. Deferring because DB + API calls follow.
  await interaction.deferReply({ ephemeral: false });

  try {
    // Query database for permanent rejection status
    const permRejectRow = db
      .prepare(
        `SELECT permanently_rejected, permanent_reject_at, user_id
         FROM application
         WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1
         LIMIT 1`
      )
      .get(guildId, targetUserId) as PermRejectRow | undefined;

    if (!permRejectRow) {
      await interaction.editReply({
        content: `ℹ️ User <@${targetUserId}> (ID: ${targetUserId}) is not currently permanently rejected.`,
      });
      return;
    }

    // Clear the permanent rejection flag. Note this updates ALL applications
    // for this user in this guild, not just the most recent one.
    // This is intentional - a permaban applies to the user, not an application.
    const updateResult = db
      .prepare(
        `UPDATE application
         SET permanently_rejected = 0,
             permanent_reject_at = NULL,
             updated_at = datetime('now')
         WHERE guild_id = ? AND user_id = ?`
      )
      .run(guildId, targetUserId);

    if (updateResult.changes === 0) {
      logger.error(
        { guildId, userId: targetUserId, moderatorId: interaction.user.id },
        "[unblock] Database update failed - no rows changed"
      );
      await interaction.editReply({
        content: "❌ Failed to unblock user. Please check the logs.",
      });
      return;
    }

    logger.info(
      {
        guildId,
        userId: targetUserId,
        moderatorId: interaction.user.id,
        reason,
        rowsAffected: updateResult.changes,
      },
      "[unblock] User permanent rejection removed"
    );

    // Log action to audit channel
    await postAuditEmbed(guild, {
      action: "unblock",
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      result: "success",
      details: `Removed permanent rejection for <@${targetUserId}> (ID: ${targetUserId}). Reason: ${reason}`,
    });

    // Send confirmation to moderator (public message as requested)
    const userDisplay = targetUser ? `${targetUser.tag}` : `User ID ${targetUserId}`;
    await interaction.editReply({
      content: `✅ **${userDisplay}** has been unblocked and can reapply or participate again.\n*Reason:* ${reason}`,
    });

    // Best-effort DM notification. Many users have DMs disabled or block bots,
    // so failures here are common and non-fatal.
    if (targetUser) {
      try {
        await targetUser.send({
          content: `Your permanent rejection from **${guild.name}** has been lifted by the moderation team. You may reapply or participate again, subject to the current rules.`,
        });
        logger.info(
          { guildId, userId: targetUserId },
          "[unblock] DM notification sent to user"
        );
      } catch (err) {
        // Common failure modes: DMs disabled, bot blocked, user deleted account
        logger.warn(
          { err, guildId, userId: targetUserId },
          "[unblock] Failed to DM user (may have DMs disabled or blocked bot)"
        );
        // Intentionally not notifying the mod - DM failures are expected
      }
    } else {
      logger.debug(
        { guildId, userId: targetUserId },
        "[unblock] Skipped DM - user not found in Discord API"
      );
    }
  } catch (err) {
    logger.error(
      { err, guildId, userId: targetUserId, moderatorId: interaction.user.id },
      "[unblock] Failed to unblock user"
    );
    await interaction.editReply({
      content: "❌ An error occurred while unblocking the user. Please check the logs.",
    });
  }
}
