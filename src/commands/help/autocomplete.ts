/**
 * Pawtropolis Tech — src/commands/help/autocomplete.ts
 * WHAT: Autocomplete handler for the help command
 * WHY: Provides intelligent command suggestions filtered by permissions
 * FLOWS:
 *  - User types in "command" option
 *  - handleAutocomplete() filters and ranks matching commands
 *  - Returns up to 25 suggestions (Discord limit)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { AutocompleteInteraction, GuildMember } from "discord.js";
import { filterCommandsByPermission, searchCommands } from "./cache.js";
import { COMMAND_REGISTRY } from "./registry.js";
import { logger } from "../../lib/logger.js";

/**
 * Maximum number of autocomplete suggestions (Discord limit).
 * If you bump this past 25, Discord will silently truncate and you'll spend
 * 45 minutes wondering why your 26th result never shows up. Ask me how I know.
 */
const MAX_SUGGESTIONS = 25;

/**
 * Handle autocomplete for the /help command.
 * Filters commands based on user permissions and input query.
 */
export async function handleAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  try {
    const focusedOption = interaction.options.getFocused(true);

    // Only handle "command" option autocomplete
    if (focusedOption.name !== "command") {
      await interaction.respond([]);
      return;
    }

    const query = focusedOption.value.toLowerCase().trim();
    // GOTCHA: guildId can be null for DM autocomplete. We default to empty string,
    // which means permission checks will be lenient. This is intentional - better
    // to show too many commands than hide ones the user might need help with.
    const guildId = interaction.guildId ?? "";
    const userId = interaction.user.id;

    // Get member for permission filtering
    // WHY the double error handling (try/catch AND .catch())? Belt and suspenders.
    // Discord's API can throw in weird ways, and we really don't want autocomplete
    // to fail just because fetching member info had a hiccup.
    let member: GuildMember | null = null;
    if (interaction.guild) {
      try {
        member = await interaction.guild.members.fetch(userId).catch(() => null);
      } catch {
        // Ignore fetch errors - will show all public commands
      }
    }

    // Get visible commands for this user
    const visibleCommands = filterCommandsByPermission(member, guildId, userId);

    let suggestions: Array<{ name: string; value: string }>;

    if (query.length === 0) {
      // No query - show first 25 commands alphabetically.
      // Alphabetical is boring but predictable. Users learn where things are.
      suggestions = visibleCommands
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, MAX_SUGGESTIONS)
        .map((cmd) => ({
          // The 80 char limit is because Discord caps autocomplete option names at 100 chars.
          // We need room for the slash and command name, hence 80 for description.
          name: `/${cmd.name} - ${cmd.description.slice(0, 80)}`,
          value: cmd.name,
        }));
    } else {
      // Search for matching commands
      const searchResults = searchCommands(query);

      // Filter to only visible commands and take top results.
      // We build a Set here because the alternative is O(n*m) hell and
      // nobody wants to explain to users why autocomplete takes 500ms.
      const visibleNames = new Set(visibleCommands.map((c) => c.name));
      const filteredResults = searchResults
        .filter((r) => visibleNames.has(r.command.name))
        .slice(0, MAX_SUGGESTIONS);

      if (filteredResults.length > 0) {
        suggestions = filteredResults.map((r) => ({
          name: `/${r.command.name} - ${r.command.description.slice(0, 80)}`,
          value: r.command.name,
        }));
      } else {
        /*
         * Fallback: prefix match on command names.
         * This fires when fuzzy search returns nothing (rare, but happens with typos).
         * The sorting logic here is: prefix matches beat substring matches, then
         * alphabetical as tiebreaker. Not perfect but good enough for edge cases.
         */
        suggestions = visibleCommands
          .filter((cmd) => cmd.name.toLowerCase().includes(query))
          .sort((a, b) => {
            // Prioritize prefix matches
            const aPrefix = a.name.toLowerCase().startsWith(query);
            const bPrefix = b.name.toLowerCase().startsWith(query);
            if (aPrefix && !bPrefix) return -1;
            if (!aPrefix && bPrefix) return 1;
            return a.name.localeCompare(b.name);
          })
          .slice(0, MAX_SUGGESTIONS)
          .map((cmd) => ({
            name: `/${cmd.name} - ${cmd.description.slice(0, 80)}`,
            value: cmd.name,
          }));
      }
    }

    await interaction.respond(suggestions);
  } catch (err) {
    logger.error({ err }, "[help] autocomplete error");
    // Return empty suggestions on error.
    // GOTCHA: We have to try/catch this because if the interaction timed out
    // or was already responded to, calling respond() throws. And if we let
    // THAT throw, we spam error logs for something we can't do anything about.
    try {
      await interaction.respond([]);
    } catch {
      // Ignore if already responded
    }
  }
}
