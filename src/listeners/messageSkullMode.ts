/**
 * Pawtropolis Tech — src/listeners/messageSkullMode.ts
 * WHAT: Skull Mode message listener - randomly reacts to messages with a skull emoji.
 * WHY: Adds playful guild personality and community engagement.
 * HOW: Checks guild config for enabled state and odds, then reacts with skull emoji.
 * SECURITY:
 *  - Only triggers in guild text channels (not DMs)
 *  - Skips bots and webhooks
 *  - Rate-limited by configurable odds (default 1 in 1000)
 * DOCS:
 *  - Discord.js Message: https://discord.js.org/#/docs/discord.js/main/class/Message
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { Events, type Message } from "discord.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { SKULLMODE_ODDS_MIN, SKULLMODE_ODDS_MAX } from "../lib/constants.js";

export const name = Events.MessageCreate;

export async function execute(message: Message) {
  // Skip non-guild messages (DMs)
  if (!message.guild) return;

  // Skip bots and webhooks
  if (message.author.bot || message.webhookId) return;

  // Get guild config
  let cfg;
  try {
    cfg = await getConfig(message.guild.id);
  } catch (err) {
    logger.error({ err, guildId: message.guild.id }, "[skullmode] failed to get guild config");
    return;
  }

  // Skip if skull mode is not enabled
  if (!cfg?.skullmode_enabled) {
    return;
  }

  // Get odds (default 1 in 1000, clamped to valid range)
  const odds = Math.max(SKULLMODE_ODDS_MIN, Math.min(SKULLMODE_ODDS_MAX, Number(cfg.skullmode_odds || 1000)));

  // Roll the dice - only proceed if we hit 0
  const roll = Math.floor(Math.random() * odds);
  if (roll !== 0) {
    return;
  }

  // React with skull emoji
  try {
    await message.react("\u{1F480}"); // Skull emoji
    logger.info(
      {
        guildId: message.guild.id,
        channelId: message.channel.id,
        messageId: message.id,
        odds,
      },
      "[skullmode] reacted with skull"
    );
  } catch (err) {
    // Log permission and rate limit failures so operators can diagnose issues
    logger.warn(
      {
        err,
        guildId: message.guild.id,
        channelId: message.channel.id,
        messageId: message.id,
        errorCode: (err as any)?.code,
      },
      "[skullmode] failed to react with skull"
    );
  }
}
