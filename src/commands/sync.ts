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

/**
 * Syncs slash commands to a specific guild using bulk overwrite.
 * @param guildId The ID of the guild to sync commands to.
 * @returns Promise<void>
 */
export async function syncCommandsToGuild(guildId: string): Promise<void> {
  try {
    const commands = getAllSlashCommands();
    const serialized = commands.map((cmd: any) => (cmd.toJSON ? cmd.toJSON() : cmd)); // Ensure serialization

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
 * @param guildIds Array of guild IDs to sync commands to.
 * @returns Promise<void>
 */
export async function syncCommandsToAllGuilds(guildIds: string[]): Promise<void> {
  for (const guildId of guildIds) {
    await syncCommandsToGuild(guildId);
    // Rate limit protection: wait 650ms between requests
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
}
