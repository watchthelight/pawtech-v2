// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/suggestions/embeds.ts
 * WHAT: Embed builders for the suggestion box feature
 * WHY: Centralized UI rendering for suggestion cards
 * DOCS:
 *  - EmbedBuilder: https://discord.js.org/#/docs/builders/main/class/EmbedBuilder
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
} from "discord.js";
import type { Suggestion, SuggestionStatus } from "./store.js";

// ============================================================================
// Constants
// ============================================================================

const STATUS_EMOJI: Record<SuggestionStatus, string> = {
  open: "\u23F3", // hourglass
  approved: "\u2705", // white check mark
  denied: "\u274C", // cross mark
  implemented: "\u2728", // sparkles
};

const STATUS_COLOR: Record<SuggestionStatus, number> = {
  open: 0x5865F2, // Discord blurple
  approved: 0x57F287, // Green
  denied: 0xED4245, // Red
  implemented: 0xFEE75C, // Yellow/Gold
};

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  open: "Open",
  approved: "Approved",
  denied: "Denied",
  implemented: "Implemented",
};

// ============================================================================
// Embed Builders
// ============================================================================

/**
 * buildSuggestionEmbed
 * WHAT: Creates the suggestion embed for display in the suggestions channel
 * WHY: Consistent formatting across all suggestion cards
 */
export function buildSuggestionEmbed(
  suggestion: Suggestion,
  submitterTag?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`\uD83E\uDD16 Bot Feature Suggestion #${suggestion.id}`)
    .setDescription(suggestion.content)
    .setColor(STATUS_COLOR[suggestion.status as SuggestionStatus])
    .setTimestamp(new Date(suggestion.created_at * 1000));

  // Add submitter info
  const submitterText = submitterTag
    ? `Submitted by ${submitterTag}`
    : `Submitted by <@${suggestion.user_id}>`;
  embed.setFooter({ text: submitterText });

  // Add vote counts
  embed.addFields({
    name: "Votes",
    value: `\uD83D\uDC4D ${suggestion.upvotes}  \uD83D\uDC4E ${suggestion.downvotes}`,
    inline: true,
  });

  // Add status
  embed.addFields({
    name: "Status",
    value: `${STATUS_EMOJI[suggestion.status as SuggestionStatus]} ${STATUS_LABEL[suggestion.status as SuggestionStatus]}`,
    inline: true,
  });

  // Add staff response if present
  if (suggestion.staff_response && suggestion.responded_by) {
    embed.addFields({
      name: "Staff Response",
      value: `"${suggestion.staff_response}"\n\u2014 <@${suggestion.responded_by}>`,
      inline: false,
    });
  }

  return embed;
}

/**
 * buildVoteButtons
 * WHAT: Creates the upvote/downvote button row
 * WHY: Allows users to vote on suggestions
 */
export function buildVoteButtons(suggestionId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion:vote:up:${suggestionId}`)
      .setLabel("Upvote")
      .setEmoji("\uD83D\uDC4D")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`suggestion:vote:down:${suggestionId}`)
      .setLabel("Downvote")
      .setEmoji("\uD83D\uDC4E")
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * buildSuggestionListEmbed
 * WHAT: Creates an embed showing a list of suggestions
 * WHY: For /suggestions command pagination
 */
export function buildSuggestionListEmbed(
  suggestions: Suggestion[],
  options: {
    guildName: string;
    status?: SuggestionStatus;
    page: number;
    totalPages: number;
    total: number;
  }
): EmbedBuilder {
  const { guildName, status, page, totalPages, total } = options;

  const embed = new EmbedBuilder()
    .setTitle(`\uD83D\uDCDD Bot Feature Suggestions`)
    .setColor(0x5865F2)
    .setFooter({ text: `Page ${page}/${totalPages} | ${total} total suggestions` });

  if (status) {
    embed.setDescription(`Showing ${STATUS_EMOJI[status]} **${STATUS_LABEL[status]}** suggestions`);
  } else {
    embed.setDescription("Showing all suggestions");
  }

  if (suggestions.length === 0) {
    embed.addFields({
      name: "No suggestions found",
      value: status
        ? `No ${status} suggestions yet. Be the first to suggest a feature!`
        : "No suggestions yet. Use `/suggest` to submit a feature idea!",
    });
  } else {
    for (const suggestion of suggestions) {
      const statusIcon = STATUS_EMOJI[suggestion.status as SuggestionStatus];
      const voteScore = suggestion.upvotes - suggestion.downvotes;
      const voteDisplay = voteScore >= 0 ? `+${voteScore}` : `${voteScore}`;

      // Truncate content for list view
      const truncatedContent = suggestion.content.length > 100
        ? suggestion.content.slice(0, 97) + "..."
        : suggestion.content;

      embed.addFields({
        name: `#${suggestion.id} ${statusIcon} [${voteDisplay}]`,
        value: truncatedContent,
        inline: false,
      });
    }
  }

  return embed;
}

/**
 * buildListPaginationButtons
 * WHAT: Creates pagination buttons for the suggestion list
 */
export function buildListPaginationButtons(
  page: number,
  totalPages: number,
  status?: SuggestionStatus
): ActionRowBuilder<ButtonBuilder> {
  const statusParam = status ?? "all";

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion:list:prev:${page}:${statusParam}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`suggestion:list:next:${page}:${statusParam}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );
}

/**
 * buildDmNotificationEmbed
 * WHAT: Creates a DM notification embed for the suggester
 * WHY: Users should be notified when their suggestion is resolved
 */
export function buildDmNotificationEmbed(
  suggestion: Suggestion,
  guildName: string,
  messageLink?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Your suggestion was ${suggestion.status}!`)
    .setColor(STATUS_COLOR[suggestion.status as SuggestionStatus])
    .setDescription(suggestion.content)
    .setTimestamp();

  embed.addFields({
    name: "Server",
    value: guildName,
    inline: true,
  });

  embed.addFields({
    name: "Status",
    value: `${STATUS_EMOJI[suggestion.status as SuggestionStatus]} ${STATUS_LABEL[suggestion.status as SuggestionStatus]}`,
    inline: true,
  });

  if (suggestion.staff_response) {
    embed.addFields({
      name: "Staff Response",
      value: suggestion.staff_response,
      inline: false,
    });
  }

  if (messageLink) {
    embed.addFields({
      name: "Original Suggestion",
      value: `[View in channel](${messageLink})`,
      inline: false,
    });
  }

  return embed;
}
