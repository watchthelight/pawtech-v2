// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/suggestions.ts
 * WHAT: User command to view bot feature suggestions
 * WHY: Allows community members to browse and track suggestion status
 * FLOWS:
 *  - /suggestions [status] → fetch paginated list → display embed with navigation
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import {
  listSuggestions,
  ensureSuggestionSchema,
  type SuggestionStatus,
} from "../features/suggestions/store.js";
import {
  buildSuggestionListEmbed,
  buildListPaginationButtons,
} from "../features/suggestions/embeds.js";

// Suggestions per page
const PAGE_SIZE = 5;

// Regex for pagination buttons
// Format: suggestion:list:(prev|next):<currentPage>:<status>
export const SUGGESTION_LIST_RE = /^suggestion:list:(prev|next):(\d+):(\w+)$/;

export const data = new SlashCommandBuilder()
  .setName("suggestions")
  .setDescription("View bot feature suggestions")
  .addStringOption((opt) =>
    opt
      .setName("status")
      .setDescription("Filter by status (default: open)")
      .setRequired(false)
      .addChoices(
        { name: "Open", value: "open" },
        { name: "Approved", value: "approved" },
        { name: "Denied", value: "denied" },
        { name: "Implemented", value: "implemented" },
        { name: "All", value: "all" }
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

  ensureSuggestionSchema();

  const guildId = interaction.guildId!;
  const statusOption = interaction.options.getString("status") ?? "open";
  const status = statusOption === "all" ? undefined : (statusOption as SuggestionStatus);

  ctx.step("fetch_suggestions");

  await interaction.deferReply();

  const { suggestions, total } = listSuggestions(guildId, {
    status,
    limit: PAGE_SIZE,
    offset: 0,
    sortBy: "newest",
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = 1;

  ctx.step("build_response");

  const embed = buildSuggestionListEmbed(suggestions, {
    guildName: interaction.guild.name,
    status,
    page: currentPage,
    totalPages,
    total,
  });

  const buttons = buildListPaginationButtons(currentPage, totalPages, status);

  await interaction.editReply({
    embeds: [embed],
    components: totalPages > 1 ? [buttons] : [],
  });

  logger.info({
    evt: "suggestions_viewed",
    guildId,
    userId: interaction.user.id,
    status: status ?? "all",
    total,
  }, `User viewed suggestions (${status ?? "all"}, ${total} total)`);
}

/**
 * handleSuggestionsListPagination
 * WHAT: Handles pagination button clicks for the suggestions list
 */
export async function handleSuggestionsListPagination(interaction: ButtonInteraction): Promise<void> {
  const match = interaction.customId.match(SUGGESTION_LIST_RE);
  if (!match) {
    logger.warn({
      evt: "suggestion_list_invalid",
      customId: interaction.customId,
    }, "Invalid suggestion list button ID");
    return;
  }

  const direction = match[1] as "prev" | "next";
  const currentPage = parseInt(match[2], 10);
  const statusParam = match[3];

  const status = statusParam === "all" ? undefined : (statusParam as SuggestionStatus);
  const guildId = interaction.guildId!;

  // Calculate new page
  const newPage = direction === "prev" ? currentPage - 1 : currentPage + 1;
  const offset = (newPage - 1) * PAGE_SIZE;

  // Fetch suggestions for new page
  const { suggestions, total } = listSuggestions(guildId, {
    status,
    limit: PAGE_SIZE,
    offset,
    sortBy: "newest",
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Validate page bounds
  if (newPage < 1 || newPage > totalPages) {
    await interaction.reply({
      content: "Invalid page number.",
      ephemeral: true,
    });
    return;
  }

  const embed = buildSuggestionListEmbed(suggestions, {
    guildName: interaction.guild?.name ?? "Server",
    status,
    page: newPage,
    totalPages,
    total,
  });

  const buttons = buildListPaginationButtons(newPage, totalPages, status);

  await interaction.update({
    embeds: [embed],
    components: totalPages > 1 ? [buttons] : [],
  });

  logger.debug({
    evt: "suggestion_list_paginated",
    guildId,
    userId: interaction.user.id,
    page: newPage,
    direction,
  }, `Suggestions list paginated to page ${newPage}`);
}
