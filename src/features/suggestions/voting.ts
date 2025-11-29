// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/suggestions/voting.ts
 * WHAT: Button interaction handler for suggestion voting
 * WHY: Processes upvote/downvote button clicks and updates embeds
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 */

import type { ButtonInteraction } from "discord.js";
import { castVote, getSuggestion, getUserVote } from "./store.js";
import { buildSuggestionEmbed, buildVoteButtons } from "./embeds.js";
import { logger } from "../../lib/logger.js";

// Regex to match suggestion vote buttons
// Format: suggestion:vote:(up|down):<suggestionId>
export const SUGGESTION_VOTE_RE = /^suggestion:vote:(up|down):(\d+)$/;

/**
 * handleSuggestionVote
 * WHAT: Processes vote button clicks
 * WHY: Users can upvote/downvote suggestions
 */
export async function handleSuggestionVote(interaction: ButtonInteraction): Promise<void> {
  const match = interaction.customId.match(SUGGESTION_VOTE_RE);
  if (!match) {
    logger.warn({
      evt: "suggestion_vote_invalid",
      customId: interaction.customId,
    }, "Invalid suggestion vote button ID");
    return;
  }

  const voteType = match[1] as "up" | "down";
  const suggestionId = parseInt(match[2], 10);

  // Get suggestion
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      content: "This suggestion no longer exists.",
      ephemeral: true,
    });
    return;
  }

  // Check if suggestion belongs to this guild
  if (suggestion.guild_id !== interaction.guildId) {
    await interaction.reply({
      content: "This suggestion is from a different server.",
      ephemeral: true,
    });
    return;
  }

  // Check if suggestion is still open for voting
  if (suggestion.status !== "open") {
    await interaction.reply({
      content: `This suggestion has been ${suggestion.status} and is no longer accepting votes.`,
      ephemeral: true,
    });
    return;
  }

  const vote = voteType === "up" ? 1 : -1;
  const currentVote = getUserVote(suggestionId, interaction.user.id);

  // Check if user is trying to cast the same vote
  if (currentVote === vote) {
    const voteWord = vote === 1 ? "upvoted" : "downvoted";
    await interaction.reply({
      content: `You've already ${voteWord} this suggestion.`,
      ephemeral: true,
    });
    return;
  }

  // Cast the vote
  const { upvotes, downvotes, changed } = castVote(suggestionId, interaction.user.id, vote as 1 | -1);

  // Update suggestion object with new counts
  const updatedSuggestion = { ...suggestion, upvotes, downvotes };

  // Update the embed
  try {
    const embed = buildSuggestionEmbed(updatedSuggestion);
    const buttons = buildVoteButtons(suggestionId);

    await interaction.update({
      embeds: [embed],
      components: [buttons],
    });
  } catch (err) {
    logger.error({
      evt: "suggestion_vote_update_failed",
      suggestionId,
      err,
    }, "Failed to update suggestion embed after vote");

    // Still acknowledge the vote worked
    const voteWord = vote === 1 ? "upvote" : "downvote";
    const action = changed ? "changed to" : "recorded";
    await interaction.reply({
      content: `Your ${voteWord} has been ${action}! (Embed update failed, but vote was saved)`,
      ephemeral: true,
    });
  }

  logger.info({
    evt: "suggestion_vote",
    suggestionId,
    userId: interaction.user.id,
    vote: voteType,
    changed,
    newUpvotes: upvotes,
    newDownvotes: downvotes,
  }, `Vote ${changed ? "changed" : "cast"} on suggestion #${suggestionId}`);
}
