// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/suggest.ts
 * WHAT: User command to submit a bot feature suggestion
 * WHY: Allows community members to propose ideas for bot improvements
 * FLOWS:
 *  - /suggest <text> → validate cooldown → create suggestion → post embed → confirm
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  EmbedBuilder,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import {
  createSuggestion,
  getSuggestionChannelId,
  getSuggestionCooldown,
  getUserLastSuggestionTime,
  updateSuggestionMessage,
  ensureSuggestionSchema,
  ensureSuggestionConfigColumns,
} from "../features/suggestions/store.js";
import { buildSuggestionEmbed, buildVoteButtons } from "../features/suggestions/embeds.js";

// Maximum suggestion length (truncated if exceeded)
const MAX_SUGGESTION_LENGTH = 1000;

export const data = new SlashCommandBuilder()
  .setName("suggest")
  .setDescription("Submit a bot feature suggestion")
  .addStringOption((opt) =>
    opt
      .setName("suggestion")
      .setDescription("Your feature idea for the bot (max 1000 characters)")
      .setRequired(true)
      .setMaxLength(MAX_SUGGESTION_LENGTH)
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

  // Ensure schema exists
  ensureSuggestionSchema();
  ensureSuggestionConfigColumns();

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  ctx.step("check_channel");

  // Check if suggestion channel is configured
  const suggestionChannelId = getSuggestionChannelId(guildId);
  if (!suggestionChannelId) {
    await interaction.reply({
      content: "Suggestions are not configured for this server. Ask an admin to set a suggestion channel with `/config suggestion_channel`.",
      ephemeral: true,
    });
    return;
  }

  // Verify channel exists and is accessible
  const suggestionChannel = interaction.guild.channels.cache.get(suggestionChannelId);
  if (!suggestionChannel || !(suggestionChannel instanceof TextChannel)) {
    await interaction.reply({
      content: "The configured suggestion channel is not available. Please contact a server admin.",
      ephemeral: true,
    });
    return;
  }

  ctx.step("check_cooldown");

  // Check cooldown
  const cooldownSeconds = getSuggestionCooldown(guildId);
  const lastSuggestionTime = getUserLastSuggestionTime(guildId, userId);

  if (lastSuggestionTime) {
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - lastSuggestionTime;
    const remaining = cooldownSeconds - elapsed;

    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60);
      await interaction.reply({
        content: `You're on cooldown! Please wait ${minutes} more minute${minutes === 1 ? "" : "s"} before submitting another suggestion.`,
        ephemeral: true,
      });
      return;
    }
  }

  ctx.step("create_suggestion");

  // Get and validate suggestion content
  let content = interaction.options.getString("suggestion", true);

  // Truncate if somehow exceeds limit (shouldn't happen with Discord validation)
  if (content.length > MAX_SUGGESTION_LENGTH) {
    content = content.slice(0, MAX_SUGGESTION_LENGTH);
  }

  // Defer reply since posting to channel might take a moment
  await interaction.deferReply({ ephemeral: true });

  // Create suggestion in database (without message_id initially)
  const suggestion = createSuggestion(guildId, userId, content);

  ctx.step("post_embed");

  try {
    // Build and post the embed
    const embed = buildSuggestionEmbed(suggestion, interaction.user.tag);
    const buttons = buildVoteButtons(suggestion.id);

    const message = await suggestionChannel.send({
      embeds: [embed],
      components: [buttons],
    });

    // Update suggestion with message details
    updateSuggestionMessage(suggestion.id, message.id, suggestionChannel.id);

    ctx.step("reply");

    // Confirm to user
    await interaction.editReply({
      content: `Your suggestion has been submitted! View it here: ${message.url}\n\n**Your suggestion:**\n> ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`,
    });

    logger.info({
      evt: "suggestion_submitted",
      suggestionId: suggestion.id,
      guildId,
      userId,
      channelId: suggestionChannel.id,
      messageId: message.id,
    }, `Suggestion #${suggestion.id} submitted by ${interaction.user.tag}`);
  } catch (err) {
    logger.error({
      evt: "suggestion_post_failed",
      suggestionId: suggestion.id,
      guildId,
      err,
    }, "Failed to post suggestion embed");

    await interaction.editReply({
      content: "Your suggestion was saved, but I couldn't post it to the suggestions channel. Please contact an admin.",
    });
  }
}
