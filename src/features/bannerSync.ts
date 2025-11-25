/**
 * Pawtropolis Tech — src/features/bannerSync.ts
 * WHAT: Syncs Discord server banner to bot profile and website
 * WHY: Keep bot and website branding consistent with server banner
 * FLOWS:
 *  - On bot ready: sync banner from guild to bot profile
 *  - On guildUpdate: detect banner changes and update bot profile
 *  - Expose current banner URL via getter for website API
 * DOCS:
 *  - Guild.bannerURL(): https://discord.js.org/docs/packages/discord.js/main/Guild:Class#bannerURL
 *  - ClientUser.setBanner(): https://discord.js.org/docs/packages/discord.js/main/ClientUser:Class#setBanner
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client, Guild } from "discord.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";

// In-memory cache of current banner URL
let cachedBannerURL: string | null = null;
let cachedGuildBannerHash: string | null = null;
let lastSyncTime: number | null = null;

// Rate limiting: don't update bot banner more than once per 10 minutes
const MIN_UPDATE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * getCurrentBannerURL
 * WHAT: Returns the currently cached guild banner URL
 * WHY: Allows website API to serve current banner without Discord API calls
 * RETURNS: Banner URL string or null if no banner set
 */
export function getCurrentBannerURL(): string | null {
  return cachedBannerURL;
}

/**
 * syncBannerFromGuild
 * WHAT: Fetches guild banner and updates bot profile banner
 * WHY: Keep bot profile banner in sync with server branding
 * PARAMS:
 *  - client: Discord.js Client instance
 *  - guild: Guild to sync banner from
 *  - force: Skip rate limiting (default: false)
 * RETURNS: Promise<void>
 */
export async function syncBannerFromGuild(
  client: Client,
  guild: Guild,
  force = false
): Promise<void> {
  try {
    // Get guild banner URL (highest quality)
    const guildBannerURL = guild.bannerURL({
      size: 4096,
      extension: "png",
    });

    // Update cache even if banner is null
    cachedBannerURL = guildBannerURL;

    // Get banner hash for change detection
    const currentBannerHash = guild.banner;

    // If no banner, log and exit
    if (!guildBannerURL || !currentBannerHash) {
      logger.info("Guild has no banner set, skipping bot profile banner update");
      cachedGuildBannerHash = null;
      return;
    }

    // Check if banner changed
    if (cachedGuildBannerHash === currentBannerHash && !force) {
      logger.debug("Guild banner unchanged, skipping update");
      return;
    }

    // Rate limiting: prevent excessive updates
    if (!force && lastSyncTime && Date.now() - lastSyncTime < MIN_UPDATE_INTERVAL_MS) {
      const remainingMs = MIN_UPDATE_INTERVAL_MS - (Date.now() - lastSyncTime);
      const remainingMin = Math.ceil(remainingMs / 1000 / 60);
      logger.info(
        { remainingMin },
        `Banner sync rate limited, next update allowed in ${remainingMin} minutes`
      );
      return;
    }

    logger.info({ guildId: guild.id, guildBannerURL }, "Syncing guild banner to bot profile");

    // Update bot profile banner
    if (!client.user) {
      logger.error("Client user not available, cannot update banner");
      return;
    }

    await client.user.setBanner(guildBannerURL);

    // Update cache and tracking
    cachedGuildBannerHash = currentBannerHash;
    lastSyncTime = Date.now();

    logger.info(
      { guildId: guild.id, bannerHash: currentBannerHash },
      "Bot profile banner updated successfully"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "Failed to sync banner from guild");
  }
}

/**
 * initializeBannerSync
 * WHAT: Sets up banner sync and initializes cache immediately
 * WHY: Automatically keep bot banner in sync with server
 * PARAMS:
 *  - client: Discord.js Client instance
 * RETURNS: Promise<void>
 * NOTE: Called from ready event handler, so executes immediately
 */
export async function initializeBannerSync(client: Client): Promise<void> {
  logger.info("Initializing banner sync feature");

  // Sync banner immediately (we're already in the ready event)
  const guildId = env.GUILD_ID;
  if (!guildId) {
    logger.warn("GUILD_ID not set, banner sync disabled");
    return;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    await syncBannerFromGuild(client, guild, true); // Force initial sync

    // BUGFIX: Force cache update immediately on startup
    // This ensures /api/banner returns current banner after PM2 restart
    const bannerURL = guild.bannerURL({ size: 4096, extension: "png" });
    cachedBannerURL = bannerURL;
    logger.info({ cachedBannerURL }, "[bannerSync] cache initialized on startup");
  } catch (err) {
    logger.error({ err, guildId }, "Failed to initialize banner sync");
  }

  // Periodic check every 6 hours as fallback (in case events are missed)
  const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000; // 6 hours
  setInterval(async () => {
    try {
      logger.debug("Running periodic banner sync check");
      const guild = await client.guilds.fetch(guildId);
      await syncBannerFromGuild(client, guild, false); // Don't force, respect rate limits
    } catch (err) {
      logger.warn({ err, guildId }, "Periodic banner sync check failed");
    }
  }, PERIODIC_CHECK_MS);

  logger.info({ intervalHours: 6 }, "Periodic banner sync check scheduled");

  // Listen for guild updates (including banner changes)
  client.on("guildUpdate", async (oldGuild, newGuild) => {
    // Only sync for the configured guild
    if (newGuild.id !== env.GUILD_ID) return;

    // Check if banner changed
    if (oldGuild.banner !== newGuild.banner) {
      logger.info(
        {
          guildId: newGuild.id,
          oldBanner: oldGuild.banner,
          newBanner: newGuild.banner,
        },
        "Guild banner changed, triggering sync"
      );

      await syncBannerFromGuild(client, newGuild);
    }
  });

  logger.info("Banner sync event listeners registered");
}
