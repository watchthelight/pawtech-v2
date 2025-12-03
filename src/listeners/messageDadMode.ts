/**
 * Pawtropolis Tech — src/listeners/messageDadMode.ts
 * WHAT: Dad Mode message listener - responds to "I'm/Im/I am..." with dad jokes.
 * WHY: Adds playful guild personality and community engagement.
 * HOW: Matches regex pattern, checks guild config for enabled state and odds, replies with "Hi <name>, I'm dad."
 * SECURITY:
 *  - Only triggers in guild text channels (not DMs)
 *  - Skips bots, webhooks, and command-like messages
 *  - Escapes @/# mentions to prevent pings
 *  - Rate-limited by configurable odds (default 1 in 1000)
 * DOCS:
 *  - Discord.js Message: https://discord.js.org/#/docs/discord.js/main/class/Message
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { Events, type Message } from "discord.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { DADMODE_ODDS_MIN, DADMODE_ODDS_MAX } from "../lib/constants.js";

/**
 * WHAT: Regex to match "I'm/Im/I am..." at the start of messages.
 * WHY: Captures the text after "I'm" for the dad joke response.
 * HOW: Case-insensitive, allows leading whitespace/punctuation, captures until first sentence end or EOL.
 * PATTERN:
 *  - ^(?:[\s"'`(\[\{<~\-:*_]*) — Leading whitespace and common message decorations
 *  - (?:i\s*'?m|i\s*am) — Matches "I'm", "Im", "I am" with optional spaces
 *  - \s+(.+?) — Captures text after "I'm" (non-greedy)
 *  - \s*([.!?]|$) — Stops at sentence end or EOL
 */
/*
 * GOTCHA: This regex was forged in the fires of edge case hell.
 * Don't simplify it. Someone already tried. It did not go well.
 * The leading character class catches Discord's creative formatting.
 */
const DAD_RE = /^(?:[\s"'`(\[\{<~\-:*_]*)(?:i\s*'?m|i\s*am)\s+(.+?)\s*([.!?]|$)/i;

export const name = Events.MessageCreate;

export async function execute(message: Message) {
  // Skip non-guild messages (DMs)
  if (!message.guild) return;

  // Skip bots and webhooks
  if (message.author.bot || message.webhookId) return;

  // Get message content
  const content = message.content?.trim();
  if (!content) return;

  // Skip command-like messages (starting with /, !, .)
  if (/^[!./]/.test(content)) return;

  // Get guild config
  let cfg;
  try {
    cfg = await getConfig(message.guild.id);
  } catch (err) {
    logger.error({ err, guildId: message.guild.id }, "[dadmode] failed to get guild config");
    return;
  }

  // Skip if dad mode is not enabled
  if (!cfg?.dadmode_enabled) {
    logger.debug({ guildId: message.guild.id, dadmode_enabled: cfg?.dadmode_enabled }, "[dadmode] skipped (not enabled)");
    return;
  }

  logger.debug({ guildId: message.guild.id, contentLength: content.length, odds: cfg.dadmode_odds }, "[dadmode] checking message");

  // Get odds (default 1 in 1000, clamped to valid range)
  // WHY: 1 in 1000 is the sweet spot between "fun surprise" and "please stop"
  const odds = Math.max(DADMODE_ODDS_MIN, Math.min(DADMODE_ODDS_MAX, Number(cfg.dadmode_odds || 1000)));

  // Roll the dice - only proceed if we hit 0
  // Rolls dice BEFORE regex match. This is intentional - regex is more expensive
  // than Math.random(), and we reject 999/1000 messages here anyway.
  const roll = Math.floor(Math.random() * odds);
  if (roll !== 0) {
    return;
  }

  logger.debug({
    guildId: message.guild.id,
    contentLength: content.length,
    contentPreview: content.slice(0, 30).replace(/\S{20,}/g, '[REDACTED]')
  }, "[dadmode] dice roll HIT! Checking pattern...");

  // Match the pattern
  const match = content.match(DAD_RE);
  if (!match) {
    logger.debug({
      guildId: message.guild.id,
      contentLength: content.length
    }, "[dadmode] pattern did not match");
    return;
  }

  logger.info({ guildId: message.guild.id, matched: match[1] }, "[dadmode] pattern matched!");

  // Extract captured text
  const raw = match[1] ?? "";

  // Normalize: collapse multiple spaces, trim, escape mentions
  // SECURITY: That @/# strip is load-bearing. Without it, users could craft
  // messages that make the bot ping @everyone or reference channels.
  // Yes, someone tried this. No, it wasn't funny when it happened.
  let name = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[@#]/g, "");

  // Skip if name is empty after normalization
  if (!name) return;

  // Discord message limit is 2000 characters
  // Our response format is "Hi {name}, I'm dad." which adds 14 characters
  // Edge case: Someone will absolutely type "I'm " followed by 3000 characters
  // of shitpost. When they do, we'll be ready.
  const DISCORD_LIMIT = 2000;
  const RESPONSE_OVERHEAD = 14; // "Hi " (3) + ", I'm dad." (11) = 14
  const maxNameLength = DISCORD_LIMIT - RESPONSE_OVERHEAD;

  // Truncate name if needed to fit within Discord's limit
  if (name.length > maxNameLength) {
    name = name.slice(0, maxNameLength);
  }

  // Send dad joke reply
  // The template literal here is deceptively simple. That simplicity was earned.
  try {
    await message.reply({ content: `Hi ${name}, I'm dad.` });
    logger.info(
      {
        guildId: message.guild.id,
        channelId: message.channel.id,
        messageId: message.id,
        name,
        odds,
      },
      "[dadmode] triggered dad joke"
    );
  } catch (err) {
    // Log permission and rate limit failures so operators can diagnose issues
    // If you're seeing a lot of these, the bot probably lost SEND_MESSAGES
    // permission in some channel. Check the errorCode for 50013 (Missing Permissions).
    logger.warn(
      {
        err,
        guildId: message.guild.id,
        channelId: message.channel.id,
        messageId: message.id,
        errorCode: (err as any)?.code,
      },
      "[dadmode] failed to send dad joke"
    );
  }
}
