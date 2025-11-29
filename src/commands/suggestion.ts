// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/suggestion.ts
 * WHAT: Staff commands for managing bot feature suggestions
 * WHY: Allows staff to approve, deny, implement, or delete suggestions
 * FLOWS:
 *  - /suggestion approve <id> [response] → update status → update embed → DM user
 *  - /suggestion deny <id> <reason> → update status → update embed → DM user
 *  - /suggestion implement <id> → update status → update embed → DM user
 *  - /suggestion delete <id> → remove suggestion
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { requireStaff } from "../lib/config.js";
import {
  getSuggestionByGuild,
  updateSuggestionStatus,
  deleteSuggestion,
  ensureSuggestionSchema,
  type SuggestionStatus,
} from "../features/suggestions/store.js";
import {
  buildSuggestionEmbed,
  buildDmNotificationEmbed,
} from "../features/suggestions/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("suggestion")
  .setDescription("Staff commands for managing suggestions")
  .addSubcommand((sub) =>
    sub
      .setName("approve")
      .setDescription("Approve a suggestion")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Suggestion ID to approve")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption((opt) =>
        opt
          .setName("response")
          .setDescription("Optional response to the suggester")
          .setRequired(false)
          .setMaxLength(500)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("deny")
      .setDescription("Deny a suggestion")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Suggestion ID to deny")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for denial")
          .setRequired(true)
          .setMaxLength(500)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("implement")
      .setDescription("Mark a suggestion as implemented")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Suggestion ID to mark as implemented")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption((opt) =>
        opt
          .setName("response")
          .setDescription("Optional implementation notes")
          .setRequired(false)
          .setMaxLength(500)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete a suggestion")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Suggestion ID to delete")
          .setRequired(true)
          .setMinValue(1)
      )
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check staff permissions
  if (!requireStaff(interaction)) return;

  ensureSuggestionSchema();

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "approve":
      await handleApprove(ctx);
      break;
    case "deny":
      await handleDeny(ctx);
      break;
    case "implement":
      await handleImplement(ctx);
      break;
    case "delete":
      await handleDelete(ctx);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

async function handleApprove(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;
  const guildId = interaction.guildId!;
  const suggestionId = interaction.options.getInteger("id", true);
  const response = interaction.options.getString("response") ?? undefined;

  ctx.step("fetch_suggestion");

  const suggestion = getSuggestionByGuild(suggestionId, guildId);
  if (!suggestion) {
    await interaction.reply({
      content: `Suggestion #${suggestionId} not found.`,
      ephemeral: true,
    });
    return;
  }

  if (suggestion.status !== "open") {
    await interaction.reply({
      content: `Suggestion #${suggestionId} has already been ${suggestion.status}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  ctx.step("update_status");

  updateSuggestionStatus(suggestionId, "approved", interaction.user.id, response);

  // Refresh suggestion data
  const updatedSuggestion = getSuggestionByGuild(suggestionId, guildId)!;

  ctx.step("update_embed");

  await updateSuggestionEmbed(interaction, updatedSuggestion);

  ctx.step("notify_user");

  await notifySuggester(interaction, updatedSuggestion);

  await interaction.editReply({
    content: `Suggestion #${suggestionId} has been approved.${response ? `\nResponse: "${response}"` : ""}`,
  });

  logger.info({
    evt: "suggestion_approved",
    suggestionId,
    guildId,
    staffId: interaction.user.id,
    response,
  }, `Suggestion #${suggestionId} approved by ${interaction.user.tag}`);
}

async function handleDeny(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;
  const guildId = interaction.guildId!;
  const suggestionId = interaction.options.getInteger("id", true);
  const reason = interaction.options.getString("reason", true);

  ctx.step("fetch_suggestion");

  const suggestion = getSuggestionByGuild(suggestionId, guildId);
  if (!suggestion) {
    await interaction.reply({
      content: `Suggestion #${suggestionId} not found.`,
      ephemeral: true,
    });
    return;
  }

  if (suggestion.status !== "open") {
    await interaction.reply({
      content: `Suggestion #${suggestionId} has already been ${suggestion.status}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  ctx.step("update_status");

  updateSuggestionStatus(suggestionId, "denied", interaction.user.id, reason);

  // Refresh suggestion data
  const updatedSuggestion = getSuggestionByGuild(suggestionId, guildId)!;

  ctx.step("update_embed");

  await updateSuggestionEmbed(interaction, updatedSuggestion);

  ctx.step("notify_user");

  await notifySuggester(interaction, updatedSuggestion);

  await interaction.editReply({
    content: `Suggestion #${suggestionId} has been denied.\nReason: "${reason}"`,
  });

  logger.info({
    evt: "suggestion_denied",
    suggestionId,
    guildId,
    staffId: interaction.user.id,
    reason,
  }, `Suggestion #${suggestionId} denied by ${interaction.user.tag}`);
}

async function handleImplement(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;
  const guildId = interaction.guildId!;
  const suggestionId = interaction.options.getInteger("id", true);
  const response = interaction.options.getString("response") ?? "This feature has been implemented!";

  ctx.step("fetch_suggestion");

  const suggestion = getSuggestionByGuild(suggestionId, guildId);
  if (!suggestion) {
    await interaction.reply({
      content: `Suggestion #${suggestionId} not found.`,
      ephemeral: true,
    });
    return;
  }

  // Can implement from open or approved status
  if (suggestion.status === "denied" || suggestion.status === "implemented") {
    await interaction.reply({
      content: `Suggestion #${suggestionId} has already been ${suggestion.status}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  ctx.step("update_status");

  updateSuggestionStatus(suggestionId, "implemented", interaction.user.id, response);

  // Refresh suggestion data
  const updatedSuggestion = getSuggestionByGuild(suggestionId, guildId)!;

  ctx.step("update_embed");

  await updateSuggestionEmbed(interaction, updatedSuggestion);

  ctx.step("notify_user");

  await notifySuggester(interaction, updatedSuggestion);

  await interaction.editReply({
    content: `Suggestion #${suggestionId} has been marked as implemented!\n${response ? `Note: "${response}"` : ""}`,
  });

  logger.info({
    evt: "suggestion_implemented",
    suggestionId,
    guildId,
    staffId: interaction.user.id,
    response,
  }, `Suggestion #${suggestionId} marked as implemented by ${interaction.user.tag}`);
}

async function handleDelete(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;
  const guildId = interaction.guildId!;
  const suggestionId = interaction.options.getInteger("id", true);

  ctx.step("fetch_suggestion");

  const suggestion = getSuggestionByGuild(suggestionId, guildId);
  if (!suggestion) {
    await interaction.reply({
      content: `Suggestion #${suggestionId} not found.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  ctx.step("delete_message");

  // Try to delete the embed message
  if (suggestion.message_id && suggestion.channel_id) {
    try {
      const channel = interaction.guild!.channels.cache.get(suggestion.channel_id);
      if (channel instanceof TextChannel) {
        const message = await channel.messages.fetch(suggestion.message_id).catch(() => null);
        if (message) {
          await message.delete();
        }
      }
    } catch (err) {
      logger.warn({
        evt: "suggestion_message_delete_failed",
        suggestionId,
        messageId: suggestion.message_id,
        err,
      }, "Failed to delete suggestion message");
    }
  }

  ctx.step("delete_from_db");

  deleteSuggestion(suggestionId);

  await interaction.editReply({
    content: `Suggestion #${suggestionId} has been deleted.`,
  });

  logger.info({
    evt: "suggestion_deleted",
    suggestionId,
    guildId,
    staffId: interaction.user.id,
  }, `Suggestion #${suggestionId} deleted by ${interaction.user.tag}`);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * updateSuggestionEmbed
 * WHAT: Updates the suggestion embed in the channel
 * WHY: Reflects the new status after staff action
 */
async function updateSuggestionEmbed(
  interaction: ChatInputCommandInteraction,
  suggestion: { id: number; guild_id: string; message_id: string | null; channel_id: string | null } & Record<string, unknown>
): Promise<void> {
  if (!suggestion.message_id || !suggestion.channel_id) {
    logger.warn({
      evt: "suggestion_no_message",
      suggestionId: suggestion.id,
    }, "Suggestion has no message to update");
    return;
  }

  try {
    const channel = interaction.guild!.channels.cache.get(suggestion.channel_id);
    if (!(channel instanceof TextChannel)) {
      logger.warn({
        evt: "suggestion_channel_not_found",
        suggestionId: suggestion.id,
        channelId: suggestion.channel_id,
      }, "Suggestion channel not found");
      return;
    }

    const message = await channel.messages.fetch(suggestion.message_id).catch(() => null);
    if (!message) {
      logger.warn({
        evt: "suggestion_message_not_found",
        suggestionId: suggestion.id,
        messageId: suggestion.message_id,
      }, "Suggestion message not found");
      return;
    }

    const embed = buildSuggestionEmbed(suggestion as Parameters<typeof buildSuggestionEmbed>[0]);

    // Remove vote buttons for resolved suggestions
    await message.edit({
      embeds: [embed],
      components: [], // Remove buttons after resolution
    });
  } catch (err) {
    logger.error({
      evt: "suggestion_embed_update_failed",
      suggestionId: suggestion.id,
      err,
    }, "Failed to update suggestion embed");
  }
}

/**
 * notifySuggester
 * WHAT: Sends a DM to the suggester about the resolution
 * WHY: Users should know when their suggestion is resolved
 */
async function notifySuggester(
  interaction: ChatInputCommandInteraction,
  suggestion: { id: number; user_id: string; message_id: string | null; channel_id: string | null } & Record<string, unknown>
): Promise<void> {
  try {
    const user = await interaction.client.users.fetch(suggestion.user_id).catch(() => null);
    if (!user) {
      logger.debug({
        evt: "suggestion_user_not_found",
        suggestionId: suggestion.id,
        userId: suggestion.user_id,
      }, "Could not fetch suggester for DM notification");
      return;
    }

    // Build message link
    let messageLink: string | undefined;
    if (suggestion.message_id && suggestion.channel_id && interaction.guildId) {
      messageLink = `https://discord.com/channels/${interaction.guildId}/${suggestion.channel_id}/${suggestion.message_id}`;
    }

    const embed = buildDmNotificationEmbed(
      suggestion as Parameters<typeof buildDmNotificationEmbed>[0],
      interaction.guild!.name,
      messageLink
    );

    await user.send({ embeds: [embed] }).catch((err) => {
      logger.debug({
        evt: "suggestion_dm_failed",
        suggestionId: suggestion.id,
        userId: suggestion.user_id,
        err,
      }, "Could not DM suggester (DMs closed?)");
    });

    logger.info({
      evt: "suggestion_dm_sent",
      suggestionId: suggestion.id,
      userId: suggestion.user_id,
    }, `DM notification sent for suggestion #${suggestion.id}`);
  } catch (err) {
    logger.warn({
      evt: "suggestion_notify_failed",
      suggestionId: suggestion.id,
      err,
    }, "Failed to notify suggester");
  }
}
