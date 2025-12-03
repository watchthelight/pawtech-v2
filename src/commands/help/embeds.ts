/**
 * Pawtropolis Tech — src/commands/help/embeds.ts
 * WHAT: Embed builders for the help system
 * WHY: Creates mobile-friendly embeds for all help views
 * FLOWS:
 *  - buildOverviewEmbed() → main help overview
 *  - buildCategoryEmbed() → category command list
 *  - buildCommandQuickEmbed() → concise command view
 *  - buildCommandFullEmbed() → detailed command view
 *  - buildSearchResultsEmbed() → search results
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { EmbedBuilder } from "discord.js";
import type { CommandMetadata, CommandCategory } from "./metadata.js";
import { CATEGORY_INFO, COMMANDS_PER_PAGE } from "./metadata.js";

// ============================================================================
// Constants
// ============================================================================

const DIVIDER = "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501";
const EMPTY = "\u200b"; // Zero-width space

const COLORS = {
  primary: 0x1e293b, // slate-800
  category: 0x5865f2, // Discord blurple
  command: 0x57f287, // green
  search: 0xfee75c, // yellow
  error: 0xef4444, // red
};

/**
 * Format permission level for display.
 */
function formatPermission(level: string): string {
  const labels: Record<string, string> = {
    public: "Everyone",
    reviewer: "Reviewer+",
    staff: "Staff+",
    admin: "Admin+",
    owner: "Owner only",
  };
  return labels[level] ?? level;
}

/**
 * Truncate text to max length with ellipsis.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// ============================================================================
// Overview Embed
// ============================================================================

/**
 * Build the main help overview embed.
 */
export function buildOverviewEmbed(
  categoryCounts: Map<CommandCategory, number>,
  totalCommands: number
): EmbedBuilder {
  const lines: string[] = [
    DIVIDER,
    "\uD83D\uDCD6 **Pawtropolis Tech Help**",
    DIVIDER,
    "",
    "Welcome to the interactive help system!",
    "",
    "**Quick Actions:**",
    "\u2022 `/help command:<name>` \u2014 Get detailed command info",
    "\u2022 `/help search:<keyword>` \u2014 Search all commands",
    "\u2022 Click a category below to browse",
    "",
    "**Categories:**",
  ];

  // Add each category with count
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

  for (const cat of categories) {
    const info = CATEGORY_INFO[cat];
    const count = categoryCounts.get(cat) ?? 0;
    if (count > 0) {
      lines.push(`${info.emoji} ${info.label} (${count})`);
    }
  }

  lines.push("");
  lines.push(`-# Showing ${totalCommands} commands available to you`);

  return new EmbedBuilder()
    .setDescription(lines.join("\n"))
    .setColor(COLORS.primary)
    .setTimestamp();
}

// ============================================================================
// Category Embed
// ============================================================================

/**
 * Build a category view embed with paginated command list.
 */
export function buildCategoryEmbed(
  category: CommandCategory,
  commands: CommandMetadata[],
  page: number,
  totalPages: number
): EmbedBuilder {
  const info = CATEGORY_INFO[category];
  const start = page * COMMANDS_PER_PAGE;
  const pageCommands = commands.slice(start, start + COMMANDS_PER_PAGE);

  const lines: string[] = [
    DIVIDER,
    `${info.emoji} **${info.label}**`,
    DIVIDER,
    "",
    info.description,
    "",
  ];

  // List commands
  for (const cmd of pageCommands) {
    lines.push(`**/${cmd.name}** \u2014 ${cmd.description}`);
  }

  // Add category tip if available
  if (info.tip) {
    lines.push("");
    lines.push(`**\uD83D\uDCA1 Tip:** ${info.tip}`);
  }

  lines.push("");
  lines.push(DIVIDER);
  lines.push(`Page ${page + 1}/${totalPages} \u2022 ${commands.length} commands`);

  return new EmbedBuilder()
    .setDescription(lines.join("\n"))
    .setColor(COLORS.category)
    .setTimestamp();
}

// ============================================================================
// Command Quick View Embed
// ============================================================================

/**
 * Build a concise command view embed.
 */
export function buildCommandQuickEmbed(cmd: CommandMetadata): EmbedBuilder {
  const info = CATEGORY_INFO[cmd.category];

  const lines: string[] = [
    DIVIDER,
    `**/${cmd.name}** \u2014 ${cmd.description}`,
    DIVIDER,
    "",
    cmd.description,
    "",
  ];

  // Usage
  if (cmd.usage) {
    lines.push(`**Usage:** \`${cmd.usage}\``);
    lines.push("");
  }

  // Permission and category
  lines.push(`**Permission:** ${formatPermission(cmd.permissionLevel)}`);
  lines.push(`**Category:** ${info.label}`);

  // Related commands
  if (cmd.relatedCommands && cmd.relatedCommands.length > 0) {
    lines.push("");
    lines.push(DIVIDER);
    lines.push(`Related: ${cmd.relatedCommands.map((r) => `/${r}`).join(", ")}`);
  }

  return new EmbedBuilder()
    .setDescription(lines.join("\n"))
    .setColor(COLORS.command)
    .setTimestamp();
}

// ============================================================================
// Command Full View Embed
// ============================================================================

/**
 * Build a detailed command view embed with all documentation.
 */
export function buildCommandFullEmbed(cmd: CommandMetadata): EmbedBuilder {
  const info = CATEGORY_INFO[cmd.category];

  const lines: string[] = [
    DIVIDER,
    `**/${cmd.name}** \u2014 ${cmd.description}`,
    DIVIDER,
    "",
    cmd.description,
    "",
  ];

  // Usage
  if (cmd.usage) {
    lines.push("**Usage:**");
    lines.push(`\`${cmd.usage}\``);
    lines.push("");
  }

  // Options
  if (cmd.options && cmd.options.length > 0) {
    lines.push("**Options:**");
    for (const opt of cmd.options) {
      const req = opt.required ? "(required)" : "(optional)";
      lines.push(`\u2022 \`${opt.name}\` ${req} \u2014 ${opt.description}`);
    }
    lines.push("");
  }

  // Subcommands
  if (cmd.subcommands && cmd.subcommands.length > 0) {
    lines.push("**Subcommands:**");
    for (const sc of cmd.subcommands.slice(0, 8)) {
      // Limit to 8 to avoid embed limits
      lines.push(`\u2022 \`${sc.name}\` \u2014 ${sc.description}`);
    }
    if (cmd.subcommands.length > 8) {
      lines.push(`\u2022 _...and ${cmd.subcommands.length - 8} more_`);
    }
    lines.push("");
  }

  // Subcommand groups
  if (cmd.subcommandGroups && cmd.subcommandGroups.length > 0) {
    for (const group of cmd.subcommandGroups.slice(0, 3)) {
      // Limit groups
      lines.push(`**${group.name}** subcommands:`);
      for (const sc of group.subcommands.slice(0, 5)) {
        lines.push(`\u2022 \`${sc.name}\` \u2014 ${sc.description}`);
      }
      if (group.subcommands.length > 5) {
        lines.push(`\u2022 _...and ${group.subcommands.length - 5} more_`);
      }
      lines.push("");
    }
    if (cmd.subcommandGroups.length > 3) {
      lines.push(`_...and ${cmd.subcommandGroups.length - 3} more groups_`);
      lines.push("");
    }
  }

  // Examples
  if (cmd.examples && cmd.examples.length > 0) {
    lines.push("**Examples:**");
    for (const ex of cmd.examples.slice(0, 3)) {
      lines.push(`\u2022 \`${ex}\``);
    }
    lines.push("");
  }

  // Notes
  if (cmd.notes) {
    lines.push("**Notes:**");
    lines.push(cmd.notes);
    lines.push("");
  }

  // Workflow tips
  if (cmd.workflowTips && cmd.workflowTips.length > 0) {
    lines.push("**\uD83D\uDCA1 Workflow Tips:**");
    for (const tip of cmd.workflowTips) {
      lines.push(`\u2022 ${tip}`);
    }
    lines.push("");
  }

  // Permission and category
  lines.push(`**Permission:** ${formatPermission(cmd.permissionLevel)}`);
  lines.push(`**Category:** ${info.label}`);

  // Related commands
  if (cmd.relatedCommands && cmd.relatedCommands.length > 0) {
    lines.push("");
    lines.push(DIVIDER);
    lines.push(`Related: ${cmd.relatedCommands.map((r) => `/${r}`).join(", ")}`);
  }

  // Truncate if too long (Discord has 4096 char limit for embed description)
  let description = lines.join("\n");
  if (description.length > 4000) {
    // Remove sections from the end until we fit
    const essential = lines.slice(0, -3).join("\n");
    description = truncate(essential, 3950) + "\n\n" + lines.slice(-3).join("\n");
  }

  return new EmbedBuilder()
    .setDescription(description)
    .setColor(COLORS.command)
    .setTimestamp();
}

// ============================================================================
// Search Results Embed
// ============================================================================

/**
 * Build a search results embed.
 */
export function buildSearchResultsEmbed(
  query: string,
  results: CommandMetadata[]
): EmbedBuilder {
  const lines: string[] = [
    DIVIDER,
    `\uD83D\uDD0D **Search Results: "${truncate(query, 30)}"**`,
    DIVIDER,
    "",
  ];

  if (results.length === 0) {
    lines.push("No commands found matching your search.");
    lines.push("");
    lines.push("**Suggestions:**");
    lines.push("\u2022 Try different keywords");
    lines.push("\u2022 Check command aliases (e.g., 'approve' for 'accept')");
    lines.push("\u2022 Browse by category instead");
  } else {
    lines.push(`Found ${results.length} command${results.length === 1 ? "" : "s"} matching "${query}":`);
    lines.push("");

    // List results (limit to 15 for embed size)
    for (const cmd of results.slice(0, 15)) {
      lines.push(`**/${cmd.name}** \u2014 ${truncate(cmd.description, 60)}`);
    }

    if (results.length > 15) {
      lines.push("");
      lines.push(`_...and ${results.length - 15} more results_`);
    }
  }

  lines.push("");
  lines.push(DIVIDER);
  lines.push(`${results.length} results`);

  return new EmbedBuilder()
    .setDescription(lines.join("\n"))
    .setColor(results.length > 0 ? COLORS.search : COLORS.error)
    .setTimestamp();
}

// ============================================================================
// Error Embed
// ============================================================================

/**
 * Build an error embed for missing commands or invalid states.
 */
export function buildErrorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(
      [DIVIDER, "\u274C **Error**", DIVIDER, "", message].join("\n")
    )
    .setColor(COLORS.error)
    .setTimestamp();
}
