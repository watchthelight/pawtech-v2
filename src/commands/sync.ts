/**
 * Pawtropolis Tech — src/commands/sync.ts
 * WHAT: Automatic slash-command sync helpers for guild-scoped commands.
 * WHY: Ensures commands are up-to-date per guild on startup and guild joins, using fast bulk overwrites.
 * FLOWS:
 *  - syncCommandsToGuild: Serialize commands → REST PUT to guild endpoint → log success/error
 *  - syncCommandsToAllGuilds: Loop over guild IDs → call syncCommandsToGuild for each
 * DOCS:
 *  - Bulk overwrite (guild): https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-guild-application-commands
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 *  - REST client: https://discord.js.org/#/docs/rest/main/class/REST
 *  - Routes: https://discord.js.org/#/docs/rest/main/class/Routes
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { REST, Routes } from "discord.js";
import { getAllSlashCommands } from "./registry.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { DISCORD_COMMAND_SYNC_DELAY_MS } from "../lib/constants.js";

/**
 * Syncs slash commands to a specific guild using bulk overwrite.
 *
 * Uses PUT (bulk overwrite) instead of POST (create) or PATCH (update) because:
 * 1. It's atomic - all commands update in one API call
 * 2. It handles additions, updates, AND removals automatically
 * 3. Avoids the "stale command" problem where old commands stick around
 *
 * Guild-scoped commands update instantly. Global commands take up to an hour.
 */
export async function syncCommandsToGuild(guildId: string): Promise<void> {
  try {
    const commands = getAllSlashCommands();
    // Some commands might be raw objects (from JSON), others are builders.
    // toJSON() serializes builders; raw objects pass through unchanged.
    const serialized = commands.map((cmd: any) => (cmd.toJSON ? cmd.toJSON() : cmd));

    const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, guildId), {
      body: serialized,
    });

    logger.info(
      `[cmdsync] synced commands to guild { guildId: "${guildId}", count: ${serialized.length} }`
    );
  } catch (err) {
    logger.warn(`[cmdsync] failed to sync guild { guildId: "${guildId}", err: ${err} }`);
  }
}

/**
 * Syncs slash commands to all provided guilds.
 *
 * Sequential with delays to avoid rate limits. Discord's rate limit for
 * guild command updates is ~2 requests/second per route. The 650ms delay
 * keeps us safely under that.
 *
 * For large bot deployments (100+ guilds), consider batching or using
 * global commands instead.
 */
export async function syncCommandsToAllGuilds(guildIds: string[]): Promise<void> {
  for (const guildId of guildIds) {
    await syncCommandsToGuild(guildId);
    // DISCORD_COMMAND_SYNC_DELAY_MS > 500ms (2/sec limit) gives us headroom for clock skew and jitter
    await new Promise((resolve) => setTimeout(resolve, DISCORD_COMMAND_SYNC_DELAY_MS));
  }
}
