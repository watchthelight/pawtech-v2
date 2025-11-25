/**
 * Pawtropolis Tech — src/events/forumThreadNotify.ts
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

import type { Client, ThreadChannel } from "discord.js";
import { ChannelType } from "discord.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { getNotifyConfig } from "../features/notifyConfig.js";
import { notifyLimiter } from "../lib/notifyLimiter.js";

/**
 * WHAT: Handle new forum thread creation and send role ping inside thread
 * WHY: Notify configured role when member creates feedback/review post
 *
 * @param client - Discord client
 * @param thread - Newly created thread channel
 */
export async function handleForumThreadCreate(client: Client, thread: ThreadChannel) {
  try {
    // Only handle forum threads (not text channel threads)
    if (
      thread.parent?.type !== ChannelType.GuildForum &&
      thread.parent?.type !== ChannelType.GuildMedia
    ) {
      return;
    }

    const guildId = thread.guildId;
    if (!guildId) {
      return;
    }

    // Get guild notification config
    const config = getNotifyConfig(guildId);
    if (!config.notify_role_id) {
      // No role configured, skip silently
      return;
    }

    // Check if this forum channel is configured for notifications
    if (config.forum_channel_id && thread.parentId !== config.forum_channel_id) {
      // Wrong forum channel, ignore
      return;
    }

    // Fetch starter message
    let starterMessage;
    try {
      starterMessage = await thread.fetchStarterMessage();
    } catch (err) {
      logger.warn(
        { err, threadId: thread.id, guildId },
        "[forumThreadNotify] failed to fetch starter message"
      );
      return;
    }

    if (!starterMessage) {
      logger.warn({ threadId: thread.id, guildId }, "[forumThreadNotify] no starter message");
      return;
    }

    // Ignore if starter author is a bot
    if (starterMessage.author.bot) {
      return;
    }

    // Check rate limits
    const rateLimitCheck = notifyLimiter.canNotify(guildId, config);
    if (!rateLimitCheck.ok) {
      logger.info(
        { guildId, threadId: thread.id, reason: rateLimitCheck.reason },
        "[forumThreadNotify] rate limit exceeded, suppressing ping"
      );

      // Log suppressed ping to action_log
      if (thread.guild) {
        await logActionPretty(thread.guild, {
          actorId: starterMessage.author.id,
          action: "forum_post_ping_fail",
          reason: rateLimitCheck.reason || "rate_limited",
          meta: {
            thread_name: thread.name,
            starter_message_id: starterMessage.id,
            suppression_reason: rateLimitCheck.reason,
          },
        });
      }

      return;
    }

    // Record this notification attempt
    notifyLimiter.recordNotify(guildId);

    // Build ping message
    const roleId = config.notify_role_id;
    const threadUrl = `https://discord.com/channels/${guildId}/${thread.id}/${starterMessage.id}`;
    const content = `<@&${roleId}> heads up! A member has feedback in ${threadUrl}`;

    // Determine where to send notification
    let targetChannel: ThreadChannel | { send: Function } | undefined = thread;
    let notifyMode = config.notify_mode || "post";

    if (notifyMode === "channel" && config.notification_channel_id) {
      // Legacy mode: send to separate channel
      try {
        const channel = await client.channels.fetch(config.notification_channel_id);
        if (channel?.isTextBased()) {
          targetChannel = channel as any;
        }
      } catch (err) {
        logger.warn(
          { err, channelId: config.notification_channel_id, guildId },
          "[forumThreadNotify] failed to fetch notification channel, falling back to thread"
        );
        // Fallback to thread
        targetChannel = thread;
        notifyMode = "post";
      }
    }

    // Send notification
    try {
      await (targetChannel as any).send({
        content,
        allowedMentions: {
          roles: [roleId],
          users: [], // No user mentions
          repliedUser: false,
        },
      });

      logger.info(
        { guildId, threadId: thread.id, roleId, mode: notifyMode },
        "[forumThreadNotify] ping sent successfully"
      );

      // Log successful ping to action_log
      if (thread.guild) {
        await logActionPretty(thread.guild, {
          actorId: starterMessage.author.id,
          action: "forum_post_ping",
          reason: `Pinged <@&${roleId}> in ${notifyMode === "post" ? "thread" : "channel"}`,
          meta: {
            thread_name: thread.name,
            starter_message_id: starterMessage.id,
            role_id: roleId,
            notify_mode: notifyMode,
            target_channel_id: targetChannel === thread ? thread.id : config.notification_channel_id,
          },
        });
      }
    } catch (err: any) {
      logger.error(
        { err, guildId, threadId: thread.id, roleId },
        "[forumThreadNotify] failed to send ping"
      );

      // Determine failure reason
      let failureReason = "unknown_error";
      if (err.code === 50013) {
        failureReason = "missing_permissions";
      } else if (err.message?.includes("mentionable")) {
        failureReason = "role_not_mentionable";
      }

      // Log failure to action_log
      if (thread.guild) {
        await logActionPretty(thread.guild, {
          actorId: starterMessage.author.id,
          action: "forum_post_ping_fail",
          reason: `Failed to ping role: ${failureReason}`,
          meta: {
            thread_name: thread.name,
            starter_message_id: starterMessage.id,
            role_id: roleId,
            error_code: err.code,
            error_message: err.message,
            failure_reason: failureReason,
          },
        });
      }

      // Attempt fallback: post non-mention notification
      if (failureReason === "role_not_mentionable") {
        try {
          await thread.send({
            content: `New feedback post by ${starterMessage.author} - role <@&${roleId}> (not mentionable) should review: ${threadUrl}`,
            allowedMentions: { parse: [] }, // No mentions at all
          });
        } catch {
          // Silent fail on fallback
        }
      }
    }
  } catch (err) {
    logger.error(
      { err, threadId: thread.id, guildId: thread.guildId },
      "[forumThreadNotify] unexpected error"
    );
  }
}

/**
 * WHAT: Register threadCreate event listener
 * WHY: Auto-attach handler when bot starts
 *
 * @param client - Discord client
 */
export function registerForumThreadNotifyHandler(client: Client) {
  client.on("threadCreate", (thread) => {
    handleForumThreadCreate(client, thread);
  });
  logger.info("[forumThreadNotify] registered threadCreate handler");
}
