/**
 * Pawtropolis Tech -- src/features/modmail/threadPerms.ts
 * WHAT: Permission checks and setup for modmail threads.
 * WHY: Ensures moderators can participate in modmail threads.
 * DOCS:
 *  - Permissions: https://discord.com/developers/docs/topics/permissions
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-create
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChannelType,
  Client,
  PermissionFlagsBits,
  type ForumChannel,
  type GuildMember as GuildMemberType,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
  type Guild,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { getConfig } from "../../lib/config.js";

// ===== Permission Checks =====

/**
 * WHAT: Precise permission flags required to start a public thread from a message.
 * WHY: ManageThreads is NOT needed to create threads - only to lock/archive/delete.
 * DOCS: https://discord.com/developers/docs/topics/permissions#permissions-for-public-threads
 */
export const NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
] as const;

/**
 * missingPermsForStartThread
 * WHAT: Check what permissions are missing for starting a thread.
 * WHY: Channel overwrites can silently remove perms that appear granted at role level.
 * RETURNS: Array of missing permission names (empty if all granted).
 */
export function missingPermsForStartThread(
  channel: TextChannel | NewsChannel | ForumChannel,
  meId: string
): string[] {
  const perms = channel.permissionsFor(meId);
  if (!perms) return NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE.map((flag) => String(flag));

  const missing: string[] = [];
  for (const flag of NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE) {
    if (!perms.has(flag)) {
      // Convert flag bigint to readable name
      const flagName = Object.keys(PermissionFlagsBits).find(
        (key) => PermissionFlagsBits[key as keyof typeof PermissionFlagsBits] === flag
      );
      missing.push(flagName ?? String(flag));
    }
  }
  return missing;
}

// ===== Thread Permission Setup =====

/**
 * ensureModsCanSpeakInThread
 * WHAT: Ensures moderators have permission to send messages in modmail threads.
 * WHY:
 *  - Public threads: Permissions inherit from parent channel, so no explicit membership is needed.
 *  - Private threads: Require BOTH explicit membership AND SendMessagesInThreads permission on parent.
 * HOW:
 *  1. Always sets SendMessagesInThreads permission on parent channel for all mod roles
 *  2. For PUBLIC threads: Skip adding members; visibility/participation inherits from parent
 *  3. For PRIVATE threads: Add claimer + all mod role members + bot to thread explicitly
 * PARAMS:
 *  - thread: The thread channel to configure (public or private)
 *  - claimerMember: Optional GuildMember who claimed/opened the ticket
 * DOCS:
 *  - Public vs Private threads: https://discord.com/developers/docs/resources/channel#thread-create
 *  - ThreadMemberManager: https://discord.js.org/#/docs/discord.js/main/class/ThreadMemberManager
 *  - Permission overwrites: https://discord.js.org/#/docs/discord.js/main/class/PermissionOverwriteManager
 */
export async function ensureModsCanSpeakInThread(
  thread: ThreadChannel,
  claimerMember?: GuildMemberType | null
) {
  try {
    const config = getConfig(thread.guildId!);

    if (!config?.mod_role_ids || config.mod_role_ids.trim().length === 0) {
      logger.warn(
        { threadId: thread.id, guildId: thread.guildId },
        "[modmail] no mod roles configured, skipping thread permission setup"
      );
      return;
    }

    const modRoleIds = config.mod_role_ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    logger.info(
      { threadId: thread.id, guildId: thread.guildId, modRoleIds, threadType: thread.type },
      "[modmail] setting up thread permissions for mod roles"
    );

    // 1. Set SendMessagesInThreads permission on parent channel for all mod roles
    const parent = thread.parent;
    if (parent) {
      for (const roleId of modRoleIds) {
        try {
          await (parent as TextChannel | ForumChannel).permissionOverwrites.edit(roleId, {
            SendMessagesInThreads: true,
          });
          logger.debug(
            { threadId: thread.id, roleId, parentId: parent.id },
            "[modmail] set SendMessagesInThreads on parent for mod role"
          );
        } catch (err) {
          logger.warn(
            { err, threadId: thread.id, roleId, parentId: parent.id },
            "[modmail] failed to set SendMessagesInThreads for mod role"
          );
        }
      }
    } else {
      logger.warn(
        { threadId: thread.id },
        "[modmail] thread has no parent, cannot set parent permissions"
      );
    }

    // Check if this is a public thread
    const isPublic = thread.type === ChannelType.PublicThread;

    if (isPublic) {
      // Public threads: permissions inherit from parent channel
      // SKIP adding claimer and SKIP adding all role members to thread
      // Only ensure bot is present (usually already is since bot created the thread)
      const guild = thread.guild;
      const me = guild?.members.me;
      if (me) {
        try {
          await thread.members.add(me.id).catch((err) => {
            // Bot is likely already in the thread since it created it
            logger.debug({ threadId: thread.id, err }, "[modmail] bot already in thread (expected)");
          });
        } catch (err) {
          logger.debug({ threadId: thread.id, err }, "[modmail] failed to add bot to thread");
        }
      }
      logger.info(
        { threadId: thread.id, guildId: thread.guildId, threadType: thread.type },
        "[modmail] public thread: using parent perms; no member adds"
      );
      return;
    }

    // Private threads: explicit membership is required
    // 2. Add claimer to thread membership (if provided and not already added)
    if (claimerMember) {
      try {
        await thread.members.add(claimerMember.id);
        logger.debug(
          { threadId: thread.id, claimerId: claimerMember.id },
          "[modmail] added claimer to thread"
        );
      } catch (err) {
        logger.warn(
          { err, threadId: thread.id, claimerId: claimerMember.id },
          "[modmail] failed to add claimer to thread"
        );
      }
    }

    // 3. Add all mod role members to thread
    const guild = thread.guild;
    if (guild) {
      for (const roleId of modRoleIds) {
        try {
          const role = await guild.roles.fetch(roleId);
          if (!role) {
            logger.warn({ threadId: thread.id, roleId }, "[modmail] mod role not found in guild");
            continue;
          }

          // Fetch all members with this role
          const members = role.members;
          logger.debug(
            { threadId: thread.id, roleId, memberCount: members.size },
            "[modmail] adding mod role members to private thread"
          );

          for (const [memberId, member] of members) {
            try {
              await thread.members.add(memberId);
              logger.debug(
                { threadId: thread.id, memberId },
                "[modmail] added mod to private thread"
              );
            } catch (err) {
              logger.warn(
                { err, threadId: thread.id, memberId },
                "[modmail] failed to add mod to private thread"
              );
            }
          }
        } catch (err) {
          logger.warn(
            { err, threadId: thread.id, roleId },
            "[modmail] failed to fetch role or add members to private thread"
          );
        }
      }
    }

    // 4. Ensure bot can send messages in private thread
    const me = guild?.members.me;
    if (me) {
      try {
        await thread.members.add(me.id);
        logger.debug({ threadId: thread.id }, "[modmail] ensured bot in private thread");
      } catch (err) {
        logger.warn({ err, threadId: thread.id }, "[modmail] failed to add bot to thread");
      }
    }

    logger.info(
      { threadId: thread.id, guildId: thread.guildId },
      "[modmail] thread permissions configured successfully"
    );
  } catch (err) {
    logger.error(
      { err, threadId: thread.id },
      "[modmail] failed to ensure mods can speak in thread"
    );
    captureException(err);
  }
}

// ===== Parent Permissions Retrofit =====

/**
 * ensureParentPermsForMods
 * WHAT: Ensure the given parent channel grants "Send Messages In Threads" to all configured mod roles.
 * WHY: Private threads require parent-level SendMessagesInThreads permission in addition to thread membership.
 * HOW: For each configured mod role, check if they have SendMessagesInThreads; if not, grant it plus baseline view/read.
 * PARAMS:
 *  - parent: The TextChannel or ForumChannel that hosts modmail threads
 */
export async function ensureParentPermsForMods(parent: TextChannel | ForumChannel) {
  try {
    const guild = parent.guild;
    const config = getConfig(guild.id);

    // Parse mod role IDs from config
    const modRoleIdsRaw = config?.mod_role_ids ?? "";
    if (!modRoleIdsRaw || modRoleIdsRaw.trim().length === 0) {
      logger.info(
        { parentId: parent.id, guildId: guild.id },
        "[modmail] retrofit: no mod roles configured; skipping parent perms"
      );
      return;
    }

    const modRoleIds = modRoleIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (modRoleIds.length === 0) {
      logger.info(
        { parentId: parent.id, guildId: guild.id },
        "[modmail] retrofit: no valid mod roles after parsing; skipping parent perms"
      );
      return;
    }

    logger.info(
      { parentId: parent.id, guildId: guild.id, modRoleIds },
      "[modmail] retrofit: checking parent perms for mod roles"
    );

    // Make sure each mod role can view + read + SEND MESSAGES IN THREADS on the parent.
    for (const roleId of modRoleIds) {
      try {
        const perms = parent.permissionsFor(roleId);
        const has = perms?.has(PermissionFlagsBits.SendMessagesInThreads) ?? false;

        if (!has) {
          await parent.permissionOverwrites.edit(roleId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessagesInThreads: true,
          });
          logger.debug(
            { parentId: parent.id, roleId },
            "[modmail] retrofit: granted SendMessagesInThreads to mod role"
          );
        } else {
          logger.debug(
            { parentId: parent.id, roleId },
            "[modmail] retrofit: mod role already has SendMessagesInThreads"
          );
        }
      } catch (err) {
        logger.warn(
          { err, parentId: parent.id, roleId },
          "[modmail] retrofit: failed to set perms for mod role"
        );
      }
    }

    // Also make sure the BOT itself can operate in threads under this parent.
    const botId = guild.client.user?.id;
    if (botId) {
      try {
        const botPerms = parent.permissionsFor(botId);
        const botHas = botPerms?.has(PermissionFlagsBits.SendMessagesInThreads) ?? false;

        if (!botHas) {
          await parent.permissionOverwrites.edit(botId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            EmbedLinks: true,
            AttachFiles: true,
            SendMessagesInThreads: true,
          });
          logger.debug(
            { parentId: parent.id, botId },
            "[modmail] retrofit: granted thread perms to bot"
          );
        } else {
          logger.debug(
            { parentId: parent.id, botId },
            "[modmail] retrofit: bot already has SendMessagesInThreads"
          );
        }
      } catch (err) {
        logger.warn(
          { err, parentId: parent.id, botId },
          "[modmail] retrofit: failed to set bot perms"
        );
      }
    }

    logger.info(
      { guildId: guild.id, parentId: parent.id, roles: modRoleIds },
      "[modmail] retrofit: ensured parent SendMessagesInThreads for mod roles"
    );
  } catch (err) {
    logger.warn(
      { err, parentId: parent.id },
      "[modmail] retrofit: ensureParentPermsForMods failed"
    );
    captureException(err);
  }
}

/**
 * retrofitModmailParentsForGuild
 * WHAT: Discover parent channels that host modmail threads and retrofit their overwrites.
 * WHY: Legacy threads may have been created before parent permissions were configured properly.
 * PARAMS:
 *  - guild: The guild to retrofit
 */
export async function retrofitModmailParentsForGuild(guild: Guild) {
  try {
    logger.info({ guildId: guild.id }, "[modmail] retrofit: starting for guild");

    const parentIds = new Set<string>();

    // (A) From open tickets in DB
    const rows = db
      .prepare(
        `SELECT thread_id
         FROM modmail_ticket
         WHERE guild_id = ? AND status = 'open' AND thread_id IS NOT NULL`
      )
      .all(guild.id) as { thread_id: string }[];

    logger.debug(
      { guildId: guild.id, ticketCount: rows.length },
      "[modmail] retrofit: found open tickets"
    );

    // Fetch each thread and collect parent IDs
    for (const r of rows) {
      try {
        const channel = await guild.channels.fetch(r.thread_id);
        if (channel && "parentId" in channel && channel.parentId) {
          parentIds.add(channel.parentId);
          logger.debug(
            { threadId: r.thread_id, parentId: channel.parentId },
            "[modmail] retrofit: discovered parent from thread"
          );
        }
      } catch (err) {
        logger.warn({ err, threadId: r.thread_id }, "[modmail] retrofit: failed to fetch thread");
      }
    }

    // (B) Optional: known configured parent if config stores it
    const cfg = getConfig(guild.id);
    const configuredParentId = (cfg as any)?.modmail_parent_channel_id as string | undefined;
    if (configuredParentId) {
      parentIds.add(configuredParentId);
      logger.debug(
        { guildId: guild.id, parentId: configuredParentId },
        "[modmail] retrofit: added configured parent channel"
      );
    }

    logger.info(
      { guildId: guild.id, parentCount: parentIds.size },
      "[modmail] retrofit: discovered parents to process"
    );

    // Retrofit each parent
    for (const parentId of parentIds) {
      try {
        const parent = await guild.channels.fetch(parentId);
        if (!parent) {
          logger.warn(
            { parentId, guildId: guild.id },
            "[modmail] retrofit: parent channel not found"
          );
          continue;
        }

        // Only process TextChannel and ForumChannel parents
        if (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildForum) {
          logger.debug(
            { parentId, type: parent.type },
            "[modmail] retrofit: skipping non-text/forum channel"
          );
          continue;
        }

        await ensureParentPermsForMods(parent as TextChannel | ForumChannel);
      } catch (err) {
        logger.warn(
          { err, parentId, guildId: guild.id },
          "[modmail] retrofit: failed to process parent"
        );
      }
    }

    logger.info(
      { guildId: guild.id, parentCount: parentIds.size },
      "[modmail] retrofit: finished for guild"
    );
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[modmail] retrofit: guild failed");
    captureException(err);
  }
}

/**
 * retrofitAllGuildsOnStartup
 * WHAT: Run retrofit across all guilds at startup.
 * WHY: Ensures existing modmail threads have proper parent permissions for moderators.
 * WHEN: Called once in client "ready" event.
 * PARAMS:
 *  - client: Discord client instance
 */
export async function retrofitAllGuildsOnStartup(client: Client) {
  try {
    logger.info("[modmail] retrofit: starting across all guilds");

    const guilds = await client.guilds.fetch();
    logger.info({ guildCount: guilds.size }, "[modmail] retrofit: discovered guilds");

    for (const [guildId, partialGuild] of guilds) {
      try {
        const guild = await partialGuild.fetch();
        await retrofitModmailParentsForGuild(guild);
      } catch (err) {
        logger.warn({ err, guildId }, "[modmail] retrofit: failed to process guild");
      }
    }

    logger.info({ count: guilds.size }, "[modmail] retrofit: completed across all guilds");
  } catch (err) {
    logger.error({ err }, "[modmail] retrofit: startup retrofit failed");
    captureException(err);
  }
}
