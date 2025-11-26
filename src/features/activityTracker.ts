/**
 * Pawtropolis Tech — src/features/activityTracker.ts
 * WHAT: Tracks user activity (join + first message) for Silent-Since-Join detection.
 * WHY: Enables flagging of accounts that stay silent for N days before first message (entropy detection).
 * FLOWS:
 *  - trackJoin(guildId, userId, joinedAt) → inserts into user_activity
 *  - trackFirstMessage(guildId, userId, messageTimestamp) → updates first_message_at, evaluates threshold
 *  - evaluateAndFlag(guildId, userId, firstMessageAt) → if silent >= threshold, posts flag alert
 * DOCS:
 *  - PR8 specification: docs/context/10_Roadmap_Open_Issues_and_Tasks.md#pr8-silent-since-join-first-message-flagger
 *  - better-sqlite3 prepared statements: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getFlaggerConfig } from "../config/flaggerStore.js";
import type { Guild, Client, Message } from "discord.js";

/**
 * WHAT: Track user join event in user_activity table.
 * WHY: Persists joined_at timestamp for later comparison with first_message_at.
 *
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @param joinedAt - Unix timestamp (seconds) when user joined
 * @example
 * client.on('guildMemberAdd', (member) => {
 *   trackJoin(member.guild.id, member.id, Math.floor(Date.now() / 1000));
 * });
 */
export function trackJoin(guildId: string, userId: string, joinedAt: number): void {
  try {
    // UPSERT pattern: if user rejoins, update joined_at (preserves first_message_at if exists)
    // ON CONFLICT ensures idempotent behavior (safe to call multiple times)
    // Design note: We intentionally reset joined_at on rejoin rather than preserving the original.
    // This handles the case where someone leaves and rejoins to reset their "silent days" counter,
    // which is actually the behavior we want since we care about their most recent join.
    db.prepare(
      `
      INSERT INTO user_activity (guild_id, user_id, joined_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        joined_at = excluded.joined_at
    `
    ).run(guildId, userId, joinedAt);

    logger.debug({ guildId, userId, joinedAt }, "[activity] join tracked");
  } catch (err: any) {
    // Gracefully handle missing table (pre-migration databases)
    if (err?.message?.includes("no such table: user_activity")) {
      logger.debug(
        { err, guildId, userId },
        "[activity] user_activity table missing - migration 005 may not have run yet"
      );
      return;
    }
    // Log other errors but don't throw (activity tracking is non-critical)
    logger.warn({ err, guildId, userId, joinedAt }, "[activity] failed to track join");
  }
}

/**
 * WHAT: Track user's first message in guild.
 * WHY: Updates first_message_at and evaluates silent days threshold for flagging.
 *
 * @param client - Discord.js Client instance (for channel fetching)
 * @param message - Discord message object
 * @example
 * client.on('messageCreate', (message) => {
 *   if (!message.author.bot && message.guildId) {
 *     await trackFirstMessage(client, message);
 *   }
 * });
 */
export async function trackFirstMessage(client: Client, message: Message): Promise<void> {
  if (!message.guildId) return; // DMs don't count
  if (message.author.bot) return; // Ignore bots

  const guildId = message.guildId;
  const userId = message.author.id;
  const messageTimestamp = Math.floor(message.createdTimestamp / 1000); // Convert ms to seconds

  try {
    // Check if user already has first_message_at recorded
    const row = db
      .prepare(
        `SELECT joined_at, first_message_at FROM user_activity WHERE guild_id = ? AND user_id = ?`
      )
      .get(guildId, userId) as { joined_at: number; first_message_at: number | null } | undefined;

    if (!row) {
      // User joined before migration 005 ran, or joined event wasn't tracked
      // Insert row with first_message_at (joined_at unknown, set to message timestamp as fallback)
      // Edge case: Setting joined_at = message timestamp means silentDays = 0, so these users
      // never trigger flags. This is intentional - we can't reliably flag users without knowing
      // their actual join date. False positives here would be worse than missing some lurkers.
      logger.debug(
        { guildId, userId },
        "[activity] user not in user_activity table, inserting with first_message_at (joined_at unknown)"
      );

      db.prepare(
        `
        INSERT INTO user_activity (guild_id, user_id, joined_at, first_message_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          first_message_at = excluded.first_message_at
      `
      ).run(guildId, userId, messageTimestamp, messageTimestamp);

      return; // No threshold evaluation (unknown join time)
    }

    if (row.first_message_at !== null) {
      // User already has first_message_at recorded, skip
      return;
    }

    // Update first_message_at (first time user speaks)
    db.prepare(
      `
      UPDATE user_activity
      SET first_message_at = ?
      WHERE guild_id = ? AND user_id = ?
    `
    ).run(messageTimestamp, guildId, userId);

    logger.debug({ guildId, userId, messageTimestamp }, "[activity] first_message_at recorded");

    // Evaluate threshold and post flag alert if needed
    await evaluateAndFlag(client, guildId, userId, row.joined_at, messageTimestamp, message);
  } catch (err: any) {
    // Gracefully handle missing table (pre-migration databases)
    if (err?.message?.includes("no such table: user_activity")) {
      logger.debug(
        { err, guildId, userId },
        "[activity] user_activity table missing - migration 005 may not have run yet"
      );
      return;
    }
    // Log other errors but don't throw (activity tracking is non-critical)
    logger.warn(
      { err, guildId, userId, messageTimestamp },
      "[activity] failed to track first message"
    );
  }
}

/**
 * WHAT: Evaluate silent days threshold and post flag alert if exceeded.
 * WHY: Core detection logic for Silent-Since-Join First-Message Flagger.
 *
 * @param client - Discord.js Client instance (for channel fetching)
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @param joinedAt - Unix timestamp (seconds) when user joined
 * @param firstMessageAt - Unix timestamp (seconds) of first message
 * @param message - Discord message object (for link in embed)
 */
async function evaluateAndFlag(
  client: Client,
  guildId: string,
  userId: string,
  joinedAt: number,
  firstMessageAt: number,
  message: Message
): Promise<void> {
  try {
    // Get flagger configuration (channel + threshold)
    const config = getFlaggerConfig(guildId);

    if (!config.channelId) {
      // No flags channel configured, skip flagging
      logger.debug(
        { guildId, userId },
        "[flagger] flags channel not configured, skipping evaluation"
      );
      return;
    }

    // Calculate silent days (delta between join and first message)
    // Note: We floor to full days rather than rounding. A user who waited 6 days 23 hours
    // counts as 6 silent days, not 7. This is slightly more lenient but avoids edge cases
    // where someone joins at 11:59pm and messages at 12:01am getting flagged incorrectly.
    const silentSeconds = firstMessageAt - joinedAt;
    const silentDays = Math.floor(silentSeconds / 86400); // 86400 seconds = 1 day

    logger.debug(
      { guildId, userId, silentDays, threshold: config.silentDays },
      "[flagger] evaluating silent days threshold"
    );

    // Check if silent days meet or exceed threshold
    if (silentDays < config.silentDays) {
      // Below threshold, no flag
      logger.debug(
        { guildId, userId, silentDays, threshold: config.silentDays },
        "[flagger] below threshold, no flag"
      );
      return;
    }

    // Threshold exceeded, post flag alert
    logger.info(
      { guildId, userId, silentDays, threshold: config.silentDays },
      "[flagger] threshold exceeded, posting flag alert"
    );

    // Post alert embed to flags channel
    await postFlagAlert(
      client,
      guildId,
      userId,
      joinedAt,
      firstMessageAt,
      silentDays,
      message,
      config.channelId
    );

    // Update flagged_at timestamp
    db.prepare(
      `
      UPDATE user_activity
      SET flagged_at = ?
      WHERE guild_id = ? AND user_id = ?
    `
    ).run(firstMessageAt, guildId, userId);

    logger.info({ guildId, userId, silentDays }, "[flagger] flag alert posted successfully");
  } catch (err) {
    logger.error({ err, guildId, userId }, "[flagger] failed to evaluate and flag");
  }
}

/**
 * WHAT: Post flag alert embed to configured flags channel.
 * WHY: Notifies moderators of accounts with suspicious activity patterns.
 *
 * @param client - Discord.js Client instance
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @param joinedAt - Unix timestamp (seconds) when user joined
 * @param firstMessageAt - Unix timestamp (seconds) of first message
 * @param silentDays - Calculated silent days
 * @param message - Discord message object (for link)
 * @param channelId - Flags channel ID
 */
async function postFlagAlert(
  client: Client,
  guildId: string,
  userId: string,
  joinedAt: number,
  firstMessageAt: number,
  silentDays: number,
  message: Message,
  channelId: string
): Promise<void> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      logger.warn(
        { guildId, channelId },
        "[flagger] flags channel not found or not text-based, skipping alert"
      );
      return;
    }

    // Check channel permissions (SendMessages + EmbedLinks)
    // Performance note: fetchMe() is cached by discord.js, so this doesn't hit the API every time.
    // We check permissions here rather than at startup because channel permissions can change
    // dynamically, and we'd rather fail gracefully per-flag than crash the whole feature.
    const botMember = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);

    if (!permissions?.has("SendMessages") || !permissions?.has("EmbedLinks")) {
      logger.warn(
        { guildId, channelId },
        "[flagger] missing permissions in flags channel (SendMessages + EmbedLinks), skipping alert"
      );
      // TODO: Implement JSON fallback logging (future enhancement)
      return;
    }

    // Fetch user for display name
    const user = await client.users.fetch(userId);

    // Build embed
    // Dynamic import to avoid circular dependency - embeds.js imports from other features
    // that may depend on activityTracker. This lazy-loads the embed builder only when needed.
    const { buildFlagEmbedSilentFirstMsg } = await import("../logging/embeds.js");
    const embed = buildFlagEmbedSilentFirstMsg({
      user,
      joinedAt,
      firstMessageAt,
      silentDays,
      message,
    });

    // Post embed to flags channel
    await channel.send({ embeds: [embed] });

    logger.info(
      { guildId, userId, channelId, silentDays },
      "[flagger] flag alert posted to channel"
    );
  } catch (err) {
    logger.error({ err, guildId, userId, channelId }, "[flagger] failed to post flag alert");
  }
}
