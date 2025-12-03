/**
 * Pawtropolis Tech — src/commands/help/index.ts
 * WHAT: Main handler for the /help command
 * WHY: Provides interactive, searchable help for all bot commands
 * FLOWS:
 *  - /help → overview with category buttons
 *  - /help command:X → detailed command view
 *  - /help search:X → search results
 *  - /help category:X → category listing
 *  - Button/Select interactions → navigation between views
 * DOCS:
 *  - Discord slash commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  GuildMember,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";
import { logger } from "../../lib/logger.js";

// Data exports
export { data } from "./data.js";

// Autocomplete export
export { handleAutocomplete } from "./autocomplete.js";

// Internal imports
import { getCommand } from "./registry.js";
import type { CommandCategory } from "./metadata.js";
import {
  parseHelpCustomId,
  CATEGORY_INFO,
  COMMANDS_PER_PAGE,
} from "./metadata.js";
import {
  filterCommandsByPermission,
  getVisibleCommandsInCategory,
  countCommandsByCategory,
  searchCommands,
  generateNonce,
  storeSearchSession,
  getSearchSession,
} from "./cache.js";
import {
  buildOverviewEmbed,
  buildCategoryEmbed,
  buildCommandQuickEmbed,
  buildCommandFullEmbed,
  buildSearchResultsEmbed,
  buildErrorEmbed,
} from "./embeds.js";
import {
  buildOverviewComponents,
  buildCategoryComponents,
  buildCommandComponents,
  buildSearchComponents,
  buildSearchModal,
  buildErrorComponents,
} from "./components.js";

// ============================================================================
// Main Execute Handler
// ============================================================================

/**
 * Main execute handler for /help command.
 */
export async function execute(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;

  ctx.step("parse_options");
  const commandName = interaction.options.getString("command");
  const searchQuery = interaction.options.getString("search");
  const categoryOption = interaction.options.getString("category") as CommandCategory | null;

  const guildId = interaction.guildId ?? "";
  const userId = interaction.user.id;

  // Get member for permission filtering
  let member: GuildMember | null = null;
  if (interaction.guild) {
    try {
      member = (await interaction.guild.members.fetch(userId).catch(() => null)) as GuildMember | null;
    } catch {
      // Continue without member - will show public commands only
    }
  }

  try {
    // Route based on options provided
    if (commandName) {
      ctx.step("command_detail");
      await showCommandDetail(interaction, commandName, member, guildId, userId, false);
    } else if (searchQuery) {
      ctx.step("search");
      await showSearchResults(interaction, searchQuery, member, guildId, userId);
    } else if (categoryOption) {
      ctx.step("category");
      await showCategory(interaction, categoryOption, 0, member, guildId, userId);
    } else {
      ctx.step("overview");
      await showOverview(interaction, member, guildId, userId);
    }
  } catch (err) {
    logger.error({ err }, "[help] execute error");
    const embed = buildErrorEmbed("An error occurred while loading help. Please try again.");
    const components = buildErrorComponents();

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
  }
}

// ============================================================================
// View Handlers
// ============================================================================

/**
 * Show the main help overview.
 */
async function showOverview(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  member: GuildMember | null,
  guildId: string,
  userId: string
): Promise<void> {
  const counts = countCommandsByCategory(member, guildId, userId);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const embed = buildOverviewEmbed(counts, total);
  const components = buildOverviewComponents(counts);

  if ("replied" in interaction && (interaction.replied || interaction.deferred)) {
    await interaction.editReply({ embeds: [embed], components });
  } else if ("update" in interaction) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components });
  }
}

/**
 * Show a category with command listing.
 */
async function showCategory(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  category: CommandCategory,
  page: number,
  member: GuildMember | null,
  guildId: string,
  userId: string
): Promise<void> {
  // Validate category
  if (!(category in CATEGORY_INFO)) {
    const embed = buildErrorEmbed(`Unknown category: ${category}`);
    const components = buildErrorComponents();

    if ("update" in interaction) {
      await interaction.update({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const commands = getVisibleCommandsInCategory(category, member, guildId, userId);
  const totalPages = Math.max(1, Math.ceil(commands.length / COMMANDS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const embed = buildCategoryEmbed(category, commands, safePage, totalPages);
  const components = buildCategoryComponents(category, commands, safePage, totalPages);

  if ("replied" in interaction && (interaction.replied || interaction.deferred)) {
    await interaction.editReply({ embeds: [embed], components });
  } else if ("update" in interaction) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components });
  }
}

/**
 * Show command detail view.
 */
async function showCommandDetail(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  commandName: string,
  member: GuildMember | null,
  guildId: string,
  userId: string,
  fullMode: boolean
): Promise<void> {
  const cmd = getCommand(commandName);

  if (!cmd) {
    const embed = buildErrorEmbed(`Command not found: /${commandName}`);
    const components = buildErrorComponents();

    if ("update" in interaction) {
      await interaction.update({ embeds: [embed], components });
    } else if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // Check if user has permission to view this command
  const visibleCommands = filterCommandsByPermission(member, guildId, userId);
  const canView = visibleCommands.some((c) => c.name === cmd.name);

  if (!canView) {
    const embed = buildErrorEmbed(`You don't have permission to view /${commandName}.`);
    const components = buildErrorComponents();

    if ("update" in interaction) {
      await interaction.update({ embeds: [embed], components });
    } else if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components });
    } else {
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const embed = fullMode ? buildCommandFullEmbed(cmd) : buildCommandQuickEmbed(cmd);
  const components = buildCommandComponents(cmd, fullMode);

  if ("update" in interaction) {
    await interaction.update({ embeds: [embed], components });
  } else if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components });
  }
}

/**
 * Show search results.
 */
async function showSearchResults(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  query: string,
  member: GuildMember | null,
  guildId: string,
  userId: string
): Promise<void> {
  // Search and filter by permissions
  const allResults = searchCommands(query);
  const visibleCommands = filterCommandsByPermission(member, guildId, userId);
  const visibleNames = new Set(visibleCommands.map((c) => c.name));
  const filteredResults = allResults.filter((r) => visibleNames.has(r.command.name));

  // Store session for select menu navigation
  const nonce = generateNonce();
  storeSearchSession(nonce, query, filteredResults);

  const resultCommands = filteredResults.map((r) => r.command);
  const embed = buildSearchResultsEmbed(query, resultCommands);
  const components = buildSearchComponents(nonce, resultCommands);

  if ("update" in interaction) {
    await (interaction as ModalSubmitInteraction).editReply({ embeds: [embed], components });
  } else if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components });
  }
}

// ============================================================================
// Button Handler
// ============================================================================

/**
 * Handle help button interactions.
 */
export async function handleHelpButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const nav = parseHelpCustomId(customId);

  if (!nav) {
    logger.warn({ customId }, "[help] unknown button custom ID");
    await interaction.reply({
      content: "Unknown button. Please use /help to start over.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId ?? "";
  const userId = interaction.user.id;

  // Get member for permission filtering
  let member: GuildMember | null = null;
  if (interaction.guild) {
    try {
      member = (await interaction.guild.members.fetch(userId).catch(() => null)) as GuildMember | null;
    } catch {
      // Continue without member
    }
  }

  try {
    switch (nav.type) {
      case "overview":
        await showOverview(interaction, member, guildId, userId);
        break;

      case "category":
        await showCategory(interaction, nav.category, nav.page, member, guildId, userId);
        break;

      case "command":
        await showCommandDetail(interaction, nav.name, member, guildId, userId, nav.full);
        break;

      case "search_modal":
        const modal = buildSearchModal();
        await interaction.showModal(modal);
        break;

      default:
        await interaction.reply({
          content: "Unknown navigation. Please use /help to start over.",
          flags: MessageFlags.Ephemeral,
        });
    }
  } catch (err) {
    logger.error({ err, customId }, "[help] button handler error");
    const embed = buildErrorEmbed("An error occurred. Please try again.");
    const components = buildErrorComponents();

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components });
      } else {
        await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // Ignore follow-up errors
    }
  }
}

// ============================================================================
// Select Menu Handler
// ============================================================================

/**
 * Handle help select menu interactions.
 */
export async function handleHelpSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const customId = interaction.customId;
  const selected = interaction.values[0];

  const guildId = interaction.guildId ?? "";
  const userId = interaction.user.id;

  // Get member for permission filtering
  let member: GuildMember | null = null;
  if (interaction.guild) {
    try {
      member = (await interaction.guild.members.fetch(userId).catch(() => null)) as GuildMember | null;
    } catch {
      // Continue without member
    }
  }

  try {
    // Command selection from category or search results
    if (customId.startsWith("help:select:cmd:") || customId.startsWith("help:select:search:")) {
      await showCommandDetail(interaction, selected, member, guildId, userId, false);
    } else {
      logger.warn({ customId }, "[help] unknown select menu custom ID");
      await interaction.reply({
        content: "Unknown selection. Please use /help to start over.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    logger.error({ err, customId }, "[help] select menu handler error");
    const embed = buildErrorEmbed("An error occurred. Please try again.");
    const components = buildErrorComponents();

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components });
      } else {
        await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // Ignore follow-up errors
    }
  }
}

// ============================================================================
// Modal Handler
// ============================================================================

/**
 * Handle help search modal submission.
 */
export async function handleHelpModal(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId !== "help:modal:search") {
    logger.warn({ customId }, "[help] unknown modal custom ID");
    await interaction.reply({
      content: "Unknown modal. Please use /help to start over.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer to allow time for search
  await interaction.deferUpdate();

  const query = interaction.fields.getTextInputValue("help:modal:search:query");
  const guildId = interaction.guildId ?? "";
  const userId = interaction.user.id;

  // Get member for permission filtering
  let member: GuildMember | null = null;
  if (interaction.guild) {
    try {
      member = (await interaction.guild.members.fetch(userId).catch(() => null)) as GuildMember | null;
    } catch {
      // Continue without member
    }
  }

  try {
    await showSearchResults(interaction, query, member, guildId, userId);
  } catch (err) {
    logger.error({ err }, "[help] modal handler error");
    const embed = buildErrorEmbed("Search failed. Please try again.");
    const components = buildErrorComponents();

    try {
      await interaction.editReply({ embeds: [embed], components });
    } catch {
      // Ignore follow-up errors
    }
  }
}
