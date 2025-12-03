/**
 * Pawtropolis Tech — src/commands/help/components.ts
 * WHAT: Button and select menu builders for help navigation
 * WHY: Creates interactive components for navigating the help system
 * FLOWS:
 *  - buildOverviewComponents() → category buttons + search button
 *  - buildCategoryComponents() → back/pagination + command select
 *  - buildCommandComponents() → back + details toggle + related commands
 *  - buildSearchComponents() → back + new search + result select
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { CommandMetadata, CommandCategory } from "./metadata.js";
import {
  CATEGORY_INFO,
  COMMANDS_PER_PAGE,
  MAX_SELECT_OPTIONS,
  buildHelpCustomId,
} from "./metadata.js";

/**
 * Truncate text to max length with ellipsis.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// ============================================================================
// Overview Components
// ============================================================================

/**
 * Build navigation components for the main help overview.
 */
export function buildOverviewComponents(
  categoryCounts: Map<CommandCategory, number>
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  // Category buttons - split into two rows (5 buttons max per row)
  const categories: CommandCategory[] = [
    "gate",
    "config",
    "moderation",
    "queue",
    "analytics",
    "messaging",
    "roles",
    "artist",
    "system",
  ];

  const activeCategories = categories.filter((cat) => (categoryCounts.get(cat) ?? 0) > 0);

  // Row 1: First 5 categories
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < Math.min(5, activeCategories.length); i++) {
    const cat = activeCategories[i];
    const info = CATEGORY_INFO[cat];
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(buildHelpCustomId({ type: "category", category: cat, page: 0 }))
        .setLabel(info.label.split(" ")[0]) // First word only for compact buttons
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (row1.components.length > 0) {
    rows.push(row1);
  }

  // Row 2: Remaining categories
  if (activeCategories.length > 5) {
    const row2 = new ActionRowBuilder<ButtonBuilder>();
    for (let i = 5; i < activeCategories.length; i++) {
      const cat = activeCategories[i];
      const info = CATEGORY_INFO[cat];
      row2.addComponents(
        new ButtonBuilder()
          .setCustomId(buildHelpCustomId({ type: "category", category: cat, page: 0 }))
          .setLabel(info.label.split(" ")[0])
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row2);
  }

  // Row 3: Search button
  const searchRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "search_modal" }))
      .setLabel("Search...")
      .setStyle(ButtonStyle.Primary)
  );
  rows.push(searchRow);

  return rows;
}

// ============================================================================
// Category Components
// ============================================================================

/**
 * Build navigation components for a category view.
 */
export function buildCategoryComponents(
  category: CommandCategory,
  commands: CommandMetadata[],
  page: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  // Navigation buttons row
  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "overview" }))
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
  );

  // Pagination buttons
  if (totalPages > 1) {
    if (page > 0) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildHelpCustomId({ type: "category", category, page: page - 1 }))
          .setLabel("Prev")
          .setStyle(ButtonStyle.Secondary)
      );
    }
    if (page < totalPages - 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildHelpCustomId({ type: "category", category, page: page + 1 }))
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
      );
    }
  }

  rows.push(navRow);

  // Command select menu
  const start = page * COMMANDS_PER_PAGE;
  const pageCommands = commands.slice(start, start + COMMANDS_PER_PAGE);

  if (pageCommands.length > 0) {
    const options = pageCommands.slice(0, MAX_SELECT_OPTIONS).map((cmd) => ({
      label: `/${cmd.name}`,
      description: truncate(cmd.description, 50),
      value: cmd.name,
    }));

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`help:select:cmd:${category}`)
        .setPlaceholder("Select a command for details...")
        .addOptions(options)
    );
    rows.push(selectRow);
  }

  return rows;
}

// ============================================================================
// Command Components
// ============================================================================

/**
 * Build navigation components for a command detail view.
 */
export function buildCommandComponents(
  cmd: CommandMetadata,
  fullMode: boolean
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Navigation row
  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "category", category: cmd.category, page: 0 }))
      .setLabel("Back to Category")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "overview" }))
      .setLabel("Overview")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "command", name: cmd.name, full: !fullMode }))
      .setLabel(fullMode ? "Quick View" : "Full Details")
      .setStyle(ButtonStyle.Primary)
  );
  rows.push(navRow);

  // Related commands row (up to 4 buttons)
  if (cmd.relatedCommands && cmd.relatedCommands.length > 0) {
    const relatedRow = new ActionRowBuilder<ButtonBuilder>();
    for (const related of cmd.relatedCommands.slice(0, 4)) {
      relatedRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildHelpCustomId({ type: "command", name: related, full: false }))
          .setLabel(`/${related}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(relatedRow);
  }

  return rows;
}

// ============================================================================
// Search Components
// ============================================================================

/**
 * Build navigation components for search results.
 */
export function buildSearchComponents(
  nonce: string,
  results: CommandMetadata[]
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  // Navigation row
  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "overview" }))
      .setLabel("Back to Overview")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildHelpCustomId({ type: "search_modal" }))
      .setLabel("New Search")
      .setStyle(ButtonStyle.Primary)
  );
  rows.push(navRow);

  // Results select menu
  if (results.length > 0) {
    const options = results.slice(0, MAX_SELECT_OPTIONS).map((cmd) => ({
      label: `/${cmd.name}`,
      description: truncate(cmd.description, 50),
      value: cmd.name,
    }));

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`help:select:search:${nonce}`)
        .setPlaceholder("Select a command for details...")
        .addOptions(options)
    );
    rows.push(selectRow);
  }

  return rows;
}

// ============================================================================
// Search Modal
// ============================================================================

/**
 * Build the search modal for entering search queries.
 */
export function buildSearchModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("help:modal:search")
    .setTitle("Search Commands");

  const input = new TextInputBuilder()
    .setCustomId("help:modal:search:query")
    .setLabel("Enter keywords to search")
    .setPlaceholder("e.g., role, accept, analytics...")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(100);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(row);

  return modal;
}

// ============================================================================
// Error Components
// ============================================================================

/**
 * Build components for error states.
 */
export function buildErrorComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildHelpCustomId({ type: "overview" }))
        .setLabel("Back to Help")
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}
