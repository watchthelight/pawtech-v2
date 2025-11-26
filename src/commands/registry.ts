/**
 * Pawtropolis Tech — src/commands/registry.ts
 * WHAT: Command registry loader for slash commands.
 * WHY: Centralizes command loading and provides getAllSlashCommands() for sync operations.
 * FLOWS: Load all command modules → return array of SlashCommandBuilders or serialized JSON
 * DOCS:
 *  - Slash command deployment best practices: https://discordjs.guide/interactions/deploying-commands.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { buildCommands } from "./buildCommands.js";

/**
 * Returns all slash commands for registration with Discord's API.
 *
 * This is the single source of truth for command definitions. The sync script
 * (typically scripts/sync-commands.ts) calls this to push commands to Discord.
 *
 * Design note: This thin wrapper exists so consumers don't need to know about
 * buildCommands internals. If we need to add caching, filtering by guild, or
 * other logic, it goes here - not in buildCommands.
 */
export function getAllSlashCommands() {
  return buildCommands();
}
