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
 * Returns an array of all slash commands, either as SlashCommandBuilders or already-serialized JSON.
 * @returns Array of command definitions ready for registration.
 */
export function getAllSlashCommands() {
  return buildCommands();
}
