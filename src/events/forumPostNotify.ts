/**
 * Pawtropolis Tech — src/events/forumPostNotify.ts
 * WHAT: Forum thread creation notifier - pings configured role inside new threads
 * WHY: Notify reviewers when members open forum posts without spamming a separate channel
 * FLOWS:
 *  - threadCreate event → check if parent is configured forum → fetch starter message
 *  - If rate limit OK → ping role inside thread with link to starter
 *  - Log every ping/failure to action_log + logActionPretty
 * SECURITY:
 *  - Uses allowedMentions to restrict pings to configured role only
 *  - Rate limiting prevents abuse (cooldown + hourly cap)
 *  - Only pings on starter message, not subsequent thread messages
 * DOCS:
 *  - discord.js threadCreate: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-threadCreate
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ThreadChannel } from "discord.js";
import { ChannelType } from "discord.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { getNotifyConfig } from "../features/notifyConfig.js";
import { notifyLimiter } from "../lib/notifyLimiter.js";
import { DISCORD_RETRY_DELAY_MS, SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

export async function forumPostNotify(thread: ThreadChannel): Promise<void> {
  try {
    if (thread.parent?.type !== ChannelType.GuildForum && thread.parent?.type !== ChannelType.GuildMedia) {
      return;
    }

    const guildId = thread.guildId;
    if (!guildId) return;

    const config = getNotifyConfig(guildId);
    if (!config.notify_role_id) return;

    if (config.forum_channel_id && thread.parentId !== config.forum_channel_id) return;

    let starterMessage;
    try {
      starterMessage = await thread.fetchStarterMessage();
    } catch (err: any) {
      // Discord race condition: threadCreate fires before starter message exists
      // Retry once after a short delay (error 10008 = Unknown Message)
      if (err.code === 10008) {
        logger.info({ threadId: thread.id, guildId }, "[forumPostNotify] starter message not ready, retrying");
        await new Promise((resolve) => setTimeout(resolve, DISCORD_RETRY_DELAY_MS));
        try {
          starterMessage = await thread.fetchStarterMessage();
        } catch (retryErr) {
          logger.warn({ err: retryErr, threadId: thread.id, guildId }, "[forumPostNotify] failed to fetch starter message after retry");
          return;
        }
      } else {
        logger.warn({ err, threadId: thread.id, guildId }, "[forumPostNotify] failed to fetch starter message");
        return;
      }
    }

    if (!starterMessage || starterMessage.author.bot) return;

    const rateLimitCheck = notifyLimiter.canNotify(guildId, config);
    if (!rateLimitCheck.ok) {
      logger.info({ guildId, threadId: thread.id, reason: rateLimitCheck.reason }, "[forumPostNotify] rate limit exceeded");
      if (thread.guild) {
        await logActionPretty(thread.guild, {
          actorId: starterMessage.author.id,
          action: "forum_post_ping_fail",
          reason: rateLimitCheck.reason || "rate_limited",
          meta: { thread_name: thread.name, starter_message_id: starterMessage.id, suppression_reason: rateLimitCheck.reason },
        });
      }
      return;
    }

    notifyLimiter.recordNotify(guildId);

    const roleId = config.notify_role_id;
    const threadUrl = `https://discord.com/channels/${guildId}/${thread.id}/${starterMessage.id}`;
    const content = `<@&${roleId}> heads up! A member has feedback in ${threadUrl}`;

    let targetChannel: any = thread;
    let notifyMode = config.notify_mode || "post";

    if (notifyMode === "channel" && config.notification_channel_id) {
      try {
        const channel = await thread.client.channels.fetch(config.notification_channel_id);
        if (channel?.isTextBased()) targetChannel = channel;
      } catch (err) {
        logger.warn({ err, channelId: config.notification_channel_id, guildId }, "[forumPostNotify] fallback to thread");
        targetChannel = thread;
        notifyMode = "post";
      }
    }

    try {
      await targetChannel.send({ content, allowedMentions: { roles: [roleId], users: [], repliedUser: false } });
      logger.info({ guildId, threadId: thread.id, roleId, mode: notifyMode }, "[forumPostNotify] ping sent");
      if (thread.guild) {
        await logActionPretty(thread.guild, {
          actorId: starterMessage.author.id,
          action: "forum_post_ping",
          reason: `Pinged <@&${roleId}> in ${notifyMode === "post" ? "thread" : "channel"}`,
          meta: { thread_name: thread.name, starter_message_id: starterMessage.id, role_id: roleId, notify_mode: notifyMode },
        });
      }
    } catch (err: any) {
      logger.error({ err, guildId, threadId: thread.id, roleId }, "[forumPostNotify] failed to send ping");
      let failureReason = "unknown_error";
      if (err.code === 50013) failureReason = "missing_permissions";
      else if (err.message?.includes("mentionable")) failureReason = "role_not_mentionable";
      if (thread.guild) {
        await logActionPretty(thread.guild, {
          actorId: starterMessage.author.id,
          action: "forum_post_ping_fail",
          reason: `Failed: ${failureReason}`,
          meta: { thread_name: thread.name, starter_message_id: starterMessage.id, role_id: roleId, error_code: err.code, failure_reason: failureReason },
        });
      }
      if (failureReason === "role_not_mentionable") {
        try { await thread.send({ content: `New feedback post by ${starterMessage.author} - role <@&${roleId}> (not mentionable): ${threadUrl}`, allowedMentions: SAFE_ALLOWED_MENTIONS }); } catch {}
      }
    }
  } catch (err) {
    logger.error({ err, threadId: thread.id, guildId: thread.guildId }, "[forumPostNotify] unexpected error");
  }
}
