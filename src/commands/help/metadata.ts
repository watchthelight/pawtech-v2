/**
 * Pawtropolis Tech — src/commands/help/metadata.ts
 * WHAT: Type definitions for the help command system
 * WHY: Provides strongly-typed command metadata for documentation, search, and display
 * FLOWS:
 *  - Types used by registry.ts to define command documentation
 *  - Types used by embeds.ts and components.ts for rendering
 *  - Types used by cache.ts for search indexing
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * Permission levels for command visibility filtering.
 * Each level is cumulative - higher levels can see lower level commands.
 */
export type PermissionLevel = "public" | "reviewer" | "staff" | "admin" | "owner";

/**
 * Command categories for organizing the help system.
 * Maps to visual groupings in the help overview.
 */
export type CommandCategory =
  | "gate"
  | "config"
  | "moderation"
  | "queue"
  | "analytics"
  | "messaging"
  | "roles"
  | "artist"
  | "system";

/**
 * Category display metadata with emoji and description.
 */
export interface CategoryInfo {
  emoji: string;
  label: string;
  description: string;
  tip?: string; // Workflow tip shown in category view
}

/**
 * Full category info mapping for all categories.
 */
export const CATEGORY_INFO: Record<CommandCategory, CategoryInfo> = {
  gate: {
    emoji: "",
    label: "Gate & Verification",
    description: "Member verification and application review commands",
    tip: "Start with `/listopen` to see your pending reviews.",
  },
  config: {
    emoji: "",
    label: "Configuration",
    description: "Server settings and customization",
    tip: "Use `/config view` to see all current settings.",
  },
  moderation: {
    emoji: "",
    label: "Moderation",
    description: "User moderation and audit tools",
    tip: "Flag suspicious users with `/flag` for team visibility.",
  },
  queue: {
    emoji: "",
    label: "Queue Management",
    description: "Application queue and review workflow",
    tip: "Use `/search user:@member` to see application history.",
  },
  analytics: {
    emoji: "",
    label: "Analytics",
    description: "Statistics and performance metrics",
    tip: "Check `/activity` for server engagement heatmaps.",
  },
  messaging: {
    emoji: "",
    label: "Messaging",
    description: "Staff communication tools",
    tip: "Use `/send embed:true` for formatted announcements.",
  },
  roles: {
    emoji: "",
    label: "Role Automation",
    description: "Automated role management",
    tip: "Enable `/panic on` to halt all role changes in emergencies.",
  },
  artist: {
    emoji: "",
    label: "Artist System",
    description: "Artist rotation and rewards",
    tip: "Use `/artistqueue sync` after role changes.",
  },
  system: {
    emoji: "",
    label: "System & Maintenance",
    description: "Bot administration and health",
    tip: "Check `/health` for bot status and latency.",
  },
};

/**
 * Discord slash command option types.
 */
export type OptionType =
  | "string"
  | "integer"
  | "boolean"
  | "user"
  | "channel"
  | "role"
  | "mentionable"
  | "number"
  | "attachment";

/**
 * Command option definition for documentation.
 */
export interface CommandOption {
  name: string;
  description: string;
  type: OptionType;
  required: boolean;
  choices?: Array<{ name: string; value: string }>;
}

/**
 * Subcommand metadata for commands with subcommands.
 */
export interface SubcommandMetadata {
  name: string;
  description: string;
  options?: CommandOption[];
  examples?: string[];
  notes?: string;
}

/**
 * Subcommand group metadata for nested command structures.
 */
export interface SubcommandGroupMetadata {
  name: string;
  description: string;
  subcommands: SubcommandMetadata[];
}

/**
 * Complete command metadata for documentation and search.
 */
export interface CommandMetadata {
  /** Command name (without leading /) */
  name: string;

  /** Brief description shown in command lists */
  description: string;

  /** Category for grouping */
  category: CommandCategory;

  /** Permission level for visibility filtering */
  permissionLevel: PermissionLevel;

  /** Full usage string (e.g., "/accept user:<@user> [reason:<text>]") */
  usage?: string;

  /** Command options */
  options?: CommandOption[];

  /** Subcommand groups (for nested structures like /config set ...) */
  subcommandGroups?: SubcommandGroupMetadata[];

  /** Direct subcommands (for flat structures like /database check) */
  subcommands?: SubcommandMetadata[];

  /** Usage examples */
  examples?: string[];

  /** Important notes about command behavior */
  notes?: string;

  /** Contextual workflow tips */
  workflowTips?: string[];

  /** Related command names for navigation */
  relatedCommands?: string[];

  /** Search aliases (alternative terms users might search for) */
  aliases?: string[];
}

/**
 * Search result with match score for ranking.
 */
export interface SearchResult {
  command: CommandMetadata;
  score: number;
  matchedOn: "name" | "alias" | "description" | "subcommand";
}

/**
 * Parsed help navigation state from button custom IDs.
 */
export type HelpNavigation =
  | { type: "overview" }
  | { type: "category"; category: CommandCategory; page: number }
  | { type: "command"; name: string; full: boolean }
  | { type: "search"; query: string; nonce: string }
  | { type: "search_modal" };

/**
 * Parse a help button custom ID into navigation state.
 * Returns null if the ID doesn't match expected patterns.
 */
export function parseHelpCustomId(customId: string): HelpNavigation | null {
  // help:overview
  if (customId === "help:overview") {
    return { type: "overview" };
  }

  // help:cat:<category> or help:cat:<category>:p<page>
  const catMatch = customId.match(/^help:cat:(\w+)(?::p(\d+))?$/);
  if (catMatch) {
    const category = catMatch[1] as CommandCategory;
    if (category in CATEGORY_INFO) {
      return {
        type: "category",
        category,
        page: catMatch[2] ? parseInt(catMatch[2], 10) : 0,
      };
    }
  }

  // help:cmd:<name> or help:cmd:<name>:full
  const cmdMatch = customId.match(/^help:cmd:([^:]+)(?::full)?$/);
  if (cmdMatch) {
    return {
      type: "command",
      name: cmdMatch[1],
      full: customId.endsWith(":full"),
    };
  }

  // help:search:<nonce>
  const searchMatch = customId.match(/^help:search:([a-f0-9]+)$/);
  if (searchMatch) {
    return {
      type: "search",
      query: "", // Query is stored in cache, not ID
      nonce: searchMatch[1],
    };
  }

  // help:search:modal
  if (customId === "help:search:modal") {
    return { type: "search_modal" };
  }

  return null;
}

/**
 * Generate a help button custom ID from navigation state.
 */
export function buildHelpCustomId(nav: HelpNavigation): string {
  switch (nav.type) {
    case "overview":
      return "help:overview";
    case "category":
      return nav.page > 0 ? `help:cat:${nav.category}:p${nav.page}` : `help:cat:${nav.category}`;
    case "command":
      return nav.full ? `help:cmd:${nav.name}:full` : `help:cmd:${nav.name}`;
    case "search":
      return `help:search:${nav.nonce}`;
    case "search_modal":
      return "help:search:modal";
  }
}

/**
 * Constants for pagination.
 */
export const COMMANDS_PER_PAGE = 10;
export const MAX_SELECT_OPTIONS = 25;
export const MAX_BUTTONS_PER_ROW = 5;
export const MAX_ROWS = 5;
