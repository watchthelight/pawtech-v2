/**
 * Pawtropolis Tech -- src/features/modmail/threads.ts
 * WHAT: Thread creation and management for modmail system.
 * WHY: Handles opening, closing, and reopening of modmail threads.
 * DOCS:
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-create
 *  - DMs: https://discord.com/developers/docs/resources/user#create-dm
 *  - Permissions: https://discord.com/developers/docs/topics/permissions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type PrivateThreadChannel,
  type TextChannel,
  type ForumChannel,
  type NewsChannel,
  type ThreadChannel,
  type User,
  type GuildMember as GuildMemberType,
  type Guild,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { shortCode } from "../../lib/ids.js";
import { hasManageGuild, isReviewer, canRunAllCommands, getConfig } from "../../lib/config.js";
import { logActionPretty } from "../../logging/pretty.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import type { GuildMember } from "discord.js";
import type { ModmailTicket } from "./types.js";
import {
  createTicket,
  getOpenTicketByUser,
  getTicketByThread,
  getTicketById,
  closeTicket,
  reopenTicket,
} from "./tickets.js";
import { flushTranscript } from "./transcript.js";

// ===== Open Thread Tracking =====

/**
 * In-memory set to track open modmail threads for efficient routing.
 *
 * Without this, we'd need a DB query on EVERY message to check if it's in a
 * modmail thread. That's expensive at scale. Instead, we keep thread IDs in
 * memory and only query DB when the set says "yes, this is a modmail thread".
 *
 * IMPORTANT: This must stay in sync with the database. We add on thread open,
 * remove on thread close, and hydrate from DB on startup. If the bot crashes
 * mid-operation, startup hydration will fix any inconsistencies.
 */
export const OPEN_MODMAIL_THREADS = new Set<string>();

/**
 * hydrateOpenModmailThreadsOnStartup
 * WHAT: Load all open modmail thread IDs into memory on startup.
 * WHY: Enables fast routing checks without DB queries per message.
 */
export async function hydrateOpenModmailThreadsOnStartup(client: Client) {
  const rows = db
    .prepare(`SELECT thread_id FROM modmail_ticket WHERE status = 'open' AND thread_id IS NOT NULL`)
    .all() as { thread_id: string }[];
  for (const row of rows) {
    OPEN_MODMAIL_THREADS.add(row.thread_id);
  }
  logger.info({ count: OPEN_MODMAIL_THREADS.size }, "[modmail] hydrated open threads");
}

// ===== Permission Checks =====

/**
 * WHAT: Precise permission flags required to start a public thread from a message.
 * WHY: ManageThreads is NOT needed to create threads - only to lock/archive/delete.
 * DOCS: https://discord.com/developers/docs/topics/permissions#permissions-for-public-threads
 */
const NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE = [
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
function missingPermsForStartThread(
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
async function ensureModsCanSpeakInThread(
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

// ===== Thread Registration =====

/**
 * registerModmailThreadTx
 * WHAT: Register the final thread_id after Discord thread creation.
 * WHY: Updates the 'pending' placeholder with the real thread ID.
 *
 * This is the second part of the race-safe open flow. We inserted a 'pending'
 * placeholder earlier; now we update it with the real thread ID.
 *
 * The UPSERT (ON CONFLICT DO UPDATE) makes this idempotent - if something goes
 * wrong and this gets called twice, it won't create duplicate rows.
 */
function registerModmailThreadTx(params: {
  guildId: string;
  userId: string;
  threadId: string;
  ticketId: number;
}): void {
  const { guildId, userId, threadId, ticketId } = params;

  // Update ticket with thread_id
  db.prepare(`UPDATE modmail_ticket SET thread_id = ?, thread_channel_id = ? WHERE id = ?`).run(
    threadId,
    threadId,
    ticketId
  );

  logger.info({ ticketId, threadId }, "[modmail] stored thread_channel_id on ticket");

  // Upsert into open_modmail guard table (idempotent)
  db.prepare(
    `
    INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(guild_id, applicant_id) DO UPDATE SET thread_id=excluded.thread_id
  `
  ).run(guildId, userId, threadId);

  logger.info({ guildId, userId, threadId }, "[modmail] registered in open_modmail guard table");
}

// ===== Open Thread =====

/**
 * openPublicModmailThreadFor
 * WHAT: Open a new modmail thread for an applicant.
 * WHY: Creates a communication channel between staff and applicant.
 * PARAMS:
 *  - interaction: The interaction that triggered this
 *  - userId: The applicant's user ID
 *  - appCode: Optional application code
 *  - reviewMessageId: Optional review message ID
 *  - appId: Optional application ID
 * RETURNS: Success status and message
 */
export async function openPublicModmailThreadFor(params: {
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction;
  userId: string;
  appCode?: string;
  reviewMessageId?: string;
  appId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, userId, appCode, reviewMessageId, appId } = params;

  if (!interaction.guildId || !interaction.guild) {
    return { success: false, message: "Guild only." };
  }

  // Check permissions: owner + mod roles first, then fall back to hasManageGuild/isReviewer
  const member = interaction.member as GuildMember | null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId, member);
  if (!hasPermission) {
    return { success: false, message: "You do not have permission for this." };
  }

  // ======================================================================
  // RACE CONDITION PROTECTION (important, read carefully)
  // ======================================================================
  //
  // Problem: Two mods click "Open Modmail" at the same time for the same user.
  // Without protection, both would create threads, causing confusion.
  //
  // Solution: Use the open_modmail table as a lock. The table has a PRIMARY KEY
  // on (guild_id, applicant_id), so only one row can exist per user per guild.
  //
  // The flow is:
  // 1. Check if row exists (fast path, no lock)
  // 2. Inside transaction, double-check and INSERT with thread_id='pending'
  // 3. Create Discord thread (outside transaction - can't await in db.transaction)
  // 4. UPDATE the row with the real thread_id
  //
  // If step 3 fails, we clean up the 'pending' row so future attempts work.
  // If two mods race past step 1, only one will succeed at step 2 (PRIMARY KEY).
  // ======================================================================

  // Fast path check - avoids transaction overhead for common "already exists" case
  const existingRow = db
    .prepare(`SELECT thread_id FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
    .get(interaction.guildId, userId) as { thread_id: string } | undefined;

  if (existingRow?.thread_id) {
    // Handle 'pending' case - another mod is in the middle of creating the thread
    if (existingRow.thread_id === "pending") {
      return {
        success: false,
        message: "Modmail thread is being created by another moderator. Please wait a moment and try again.",
      };
    }
    return {
      success: false,
      message: `Modmail thread already exists: <#${existingRow.thread_id}>`,
    };
  }

  // Prepare Discord API calls outside transaction (cannot await inside db.transaction)
  let user: User;
  let thread: ThreadChannel;
  let ticketId: number;

  try {
    // Fetch user
    user = await interaction.client.users.fetch(userId);
    const code = appCode ?? shortCode(userId).slice(0, 6);

    // Validate channel
    const channel = interaction.channel;
    if (!channel || channel.type === ChannelType.DM || !("permissionsFor" in channel)) {
      return { success: false, message: "Cannot create thread in this channel." };
    }

    // Only allow Text/News/Forum types
    if (
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(
        channel.type
      )
    ) {
      return {
        success: false,
        message: "Modmail is only supported in text/news/forum channels.",
      };
    }

    // Check precise bot permissions for thread creation
    const me = interaction.guild.members.me;
    if (!me) {
      return { success: false, message: "Bot member not found in guild." };
    }

    const missing = missingPermsForStartThread(
      channel as TextChannel | NewsChannel | ForumChannel,
      me.id
    );

    // Helpful debug log
    logger.info(
      {
        guildId: interaction.guildId,
        channelId: channel.id,
        channelType: channel.type,
        missing,
        botId: me.id,
      },
      "[modmail] permission check for start thread"
    );

    // If missing, return granular error
    if (missing.length) {
      return {
        success: false,
        message: `Cannot open modmail here. Missing: ${missing.join(", ")}.\n- Check channel-specific overwrites on <#${channel.id}> (they override role perms).`,
      };
    }

    // Execute DB writes in a single atomic transaction.
    // This is the critical section for race protection - see comment above.
    const openResult = db.transaction(() => {
      // Double-check guard INSIDE transaction. The fast path check above doesn't
      // hold a lock, so another mod could have snuck in between then and now.
      // This check happens under SQLite's write lock, so it's authoritative.
      const guardCheck = db
        .prepare(`SELECT thread_id FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
        .get(interaction.guildId, userId) as { thread_id: string } | undefined;

      if (guardCheck?.thread_id) {
        return { alreadyExists: true, threadId: guardCheck.thread_id };
      }

      // Create ticket in DB. We do this inside the transaction so that if the
      // INSERT into open_modmail fails (race), we don't leave orphan tickets.
      ticketId = createTicket({
        guildId: interaction.guildId!,
        userId,
        appCode: code,
        reviewMessageId,
      });

      // Insert with 'pending' thread_id to acquire the lock. The PRIMARY KEY
      // constraint will cause this to fail if another transaction beat us.
      // We can't put the real thread_id here because we can't call Discord API
      // inside a synchronous transaction.
      db.prepare(
        `INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
         VALUES (?, ?, 'pending', strftime('%s','now'))`
      ).run(interaction.guildId, userId);

      logger.debug(
        { guildId: interaction.guildId, userId, ticketId },
        "[modmail] Acquired lock in open_modmail with pending thread_id"
      );

      return { alreadyExists: false, ticketId };
    })();

    if (openResult.alreadyExists) {
      // Handle 'pending' case - another mod is in the middle of creating the thread
      if (openResult.threadId === "pending") {
        return {
          success: false,
          message: "Modmail thread is being created by another moderator. Please wait a moment and try again.",
        };
      }
      return {
        success: false,
        message: `Modmail thread already exists: <#${openResult.threadId}>`,
      };
    }

    // openResult.ticketId is guaranteed to exist when alreadyExists is false
    ticketId = openResult.ticketId!;

    // Create Discord thread (outside transaction - cannot await inside)
    // Different creation paths for Forum vs Text/News channels
    const narrowedChannel = channel as TextChannel | NewsChannel | ForumChannel;

    if (narrowedChannel.type === ChannelType.GuildForum) {
      // Forum channels: create a new post (thread) under the forum
      const forum = narrowedChannel as ForumChannel;
      thread = await forum.threads.create({
        name: `Modmail - ${code} - ${user.username}`,
        message: { content: `Opening modmail for <@${userId}> (App #${code}).` },
        autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
        reason: `Modmail for ${user.tag} (${user.id})`,
      });
    } else {
      // Text/News: create a public thread (not attached to a specific message)
      const textChannel = narrowedChannel as TextChannel | NewsChannel;
      thread = await textChannel.threads.create({
        name: `Modmail - ${code} - ${user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
        reason: `Modmail for ${user.tag} (${user.id})`,
      });
    }

    // Add loud assertion logs after thread creation
    logger.info(
      {
        threadId: thread.id,
        threadType: thread.type,
        parentId: thread.parentId,
        guildId: thread.guildId,
        public: thread.type === ChannelType.PublicThread,
        autoArchiveDuration: thread.autoArchiveDuration,
      },
      "[modmail] THREAD CREATED: public modmail thread ready"
    );

    // Ensure moderators can speak in the thread (sets parent perms, no member adds for public)
    await ensureModsCanSpeakInThread(thread, member);

    // Register the real thread_id now that we have it.
    // This updates the 'pending' placeholder we inserted earlier.
    db.transaction(() => {
      registerModmailThreadTx({
        guildId: interaction.guildId!,
        userId,
        threadId: thread.id,
        ticketId,
      });
    })();

    // Add to open threads set
    OPEN_MODMAIL_THREADS.add(thread.id);

    // Log modmail open action with public/private metadata
    if (interaction.guild) {
      await logActionPretty(interaction.guild, {
        appId: appId || undefined,
        appCode: code || undefined,
        actorId: interaction.user.id,
        subjectId: userId,
        action: "modmail_open",
        meta: { public: thread.type === ChannelType.PublicThread },
      }).catch((err) => {
        logger.warn({ err, threadId: thread.id }, "[modmail] failed to log modmail_open");
      });
    }

    // Refresh review card if appId is available
    if (appId) {
      try {
        const { ensureReviewMessage } = await import("../review.js");
        await ensureReviewMessage(interaction.client, appId);
        logger.info({ appId, threadId: thread.id }, "[review] card refreshed");
      } catch (err) {
        logger.warn(
          { err, appId, threadId: thread.id },
          "[review] failed to refresh card after modmail open"
        );
      }
    }

    // Build starter embed
    const avatarUrl = user.displayAvatarURL({ size: 128 });
    const accountAge = user.createdTimestamp
      ? `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`
      : "unknown";

    const lensUrl = avatarUrl
      ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`
      : null;

    const embed = new EmbedBuilder()
      .setTitle(`Modmail Thread`)
      .setDescription(
        `**Applicant:** <@${userId}> (${user.tag})\n**App Code:** ${code}\n**Account Age:** ${accountAge}`
      )
      .setColor(0x5865f2)
      .setThumbnail(avatarUrl)
      .setFooter({ text: `Ticket #${ticketId}` });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:modmail:close:${ticketId}`)
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger)
    );

    if (lensUrl) {
      buttons.addComponents(
        new ButtonBuilder().setLabel("Copy Lens Link").setStyle(ButtonStyle.Link).setURL(lensUrl)
      );
    }

    // Diagnostic logging before first message send
    logger.debug(
      {
        threadId: thread.id,
        threadType: thread.type,
        parentId: thread.parentId,
        guildId: thread.guildId,
        botMemberId: interaction.guild?.members.me?.id,
        claimerId: interaction.user.id,
      },
      "[modmail] about to send first message to thread"
    );

    await thread.send({ embeds: [embed], components: [buttons], allowedMentions: SAFE_ALLOWED_MENTIONS });

    // Try to DM the applicant
    try {
      await user.send({
        content: `Hi, a moderator opened a modmail thread regarding your application to **${interaction.guild.name}**.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch (err) {
      logger.warn({ err, userId, ticketId }, "[modmail] failed to DM applicant on open");
      await thread.send({
        content: "Failed to DM the applicant (their DMs may be closed).",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    }

    logger.info(
      { ticketId, threadId: thread.id, userId, guildId: interaction.guildId },
      "[modmail] thread opened"
    );

    return {
      success: true,
      message: `Modmail thread created: <#${thread.id}>`,
    };
  } catch (err: any) {
    // Transaction rollback is automatic via db.transaction() - no explicit rollback needed

    // Detect race condition: if we hit a PRIMARY KEY constraint, another mod won.
    const isRaceCondition =
      String(err?.message || "").includes("UNIQUE") ||
      String(err?.message || "").includes("PRIMARY KEY") ||
      err?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      err?.code === "SQLITE_CONSTRAINT";

    if (isRaceCondition) {
      // Race detected: another moderator beat us. Look up their thread and link to it.
      const existingThread = db
        .prepare(`SELECT thread_id FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
        .get(interaction.guildId, userId) as { thread_id: string } | undefined;

      if (existingThread?.thread_id && existingThread.thread_id !== "pending") {
        logger.info(
          { guildId: interaction.guildId, userId, threadId: existingThread.thread_id },
          "[modmail] race condition detected - linking to existing thread"
        );
        return {
          success: false,
          message: `Modmail thread already exists: <#${existingThread.thread_id}>`,
        };
      }
      // Edge case: the winner is still in the 'pending' state (creating the thread)
      if (existingThread?.thread_id === "pending") {
        return {
          success: false,
          message: "Modmail thread is being created by another moderator. Please wait a moment and try again.",
        };
      }
    }

    // CRITICAL CLEANUP: If we fail for any reason, we must remove our 'pending' entry.
    try {
      db.prepare(
        `DELETE FROM open_modmail WHERE guild_id = ? AND applicant_id = ? AND thread_id = 'pending'`
      ).run(interaction.guildId, userId);
      logger.debug(
        { guildId: interaction.guildId, userId },
        "[modmail] Cleaned up pending entry after thread creation failure"
      );
    } catch (cleanupErr) {
      logger.warn({ cleanupErr, guildId: interaction.guildId, userId },
        "[modmail] Failed to clean up pending entry - manual cleanup may be required");
    }

    // Unknown error - log and return generic message
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, userId, traceId }, "[modmail] failed to open thread");
    captureException(err, { area: "modmail:openThread", userId, traceId });
    return {
      success: false,
      message: `Failed to create modmail thread (trace: ${traceId}). Check logs.`,
    };
  }
}

// ===== Close Thread Helpers =====

/**
 * trySendClosingMessage
 * WHAT: Best-effort attempt to send a closing message to the modmail thread.
 * WHY: Informs staff that the thread is being closed before archiving/deleting.
 * HOW: Checks last 10 messages for duplicate "Modmail Closed" embeds to avoid spam.
 * RETURNS: 'ok' | 'skip' | 'err' to indicate outcome
 */
async function trySendClosingMessage(
  thread: ThreadChannel,
  reason: string
): Promise<"ok" | "skip" | "err"> {
  try {
    // Check last 10 messages for existing closing notice (idempotency)
    const recent = await thread.messages.fetch({ limit: 10 }).catch(() => null);
    if (recent) {
      const alreadyClosed = recent.some((m) => m.embeds?.[0]?.title?.includes("Modmail Closed"));
      if (alreadyClosed) {
        logger.debug({ threadId: thread.id }, "[modmail] close:closing_message skip (duplicate)");
        return "skip";
      }
    }

    // Build closing embed
    const closeEmbed = new EmbedBuilder()
      .setTitle("Modmail Closed")
      .setDescription(`This modmail thread has been closed.\n\n**Reason:** ${reason}`)
      .setColor(0x808080)
      .setTimestamp();

    await thread.send({ embeds: [closeEmbed], allowedMentions: SAFE_ALLOWED_MENTIONS });
    logger.debug({ threadId: thread.id }, "[modmail] close:closing_message ok");
    return "ok";
  } catch (err) {
    logger.debug({ err, threadId: thread.id }, "[modmail] close:closing_message err");
    return "err";
  }
}

/**
 * archiveOrDeleteThread
 * WHAT: Safe archive+lock or delete operation for public/private threads.
 * WHY: Public threads may lack manageable/editable permissions requiring fallback strategies.
 * RETURNS: { action: 'delete' | 'archive', ok: boolean, err?: any, code?: number }
 */
async function archiveOrDeleteThread(
  thread: ThreadChannel,
  deleteOnClose: boolean,
  client: Client
): Promise<{ action: "delete" | "archive"; ok: boolean; err?: any; code?: number }> {
  // Pre-check permissions
  const me = thread.guild?.members.me;
  const myPerms = me ? thread.permissionsFor(me.id) : null;
  const canManageThreads = myPerms?.has(PermissionFlagsBits.ManageThreads) ?? false;

  if (deleteOnClose) {
    // Check if we can delete
    if (!canManageThreads) {
      logger.info(
        { threadId: thread.id, canManageThreads },
        "[modmail] close:archive skipped delete (insufficient perms) -> falling back to archive"
      );
      // Fall through to archive+lock below
    } else {
      // Try to delete
      try {
        await thread.delete("Modmail closed - transcript flushed");
        logger.debug({ threadId: thread.id }, "[modmail] close:archive action=delete ok");
        return { action: "delete", ok: true };
      } catch (e: any) {
        const code = e?.code;
        logger.warn(
          { err: e, threadId: thread.id, code },
          "[modmail] close:archive action=delete failed -> falling back to archive"
        );

        // On permission errors (50013 Missing Permissions, 50001 Missing Access), fall back to archive
        if (code === 50013 || code === 50001) {
          logger.info(
            { threadId: thread.id, code },
            "[modmail] close:archive fallback due to permission error"
          );
          // Fall through to archive+lock below
        } else {
          // Other error - return failure
          return { action: "delete", ok: false, err: e, code };
        }
      }
    }
  }

  // Archive+lock strategy (either configured or delete fallback)
  try {
    await thread.edit({ archived: true, locked: true });
    logger.debug({ threadId: thread.id }, "[modmail] close:archive action=archive ok");
    return { action: "archive", ok: true };
  } catch (e: any) {
    const code = e?.code;
    logger.warn(
      { err: e, threadId: thread.id, code },
      "[modmail] close:archive action=archive failed"
    );

    // Best effort: remove bot from thread to hide it from sidebar
    try {
      if (client.user) {
        await thread.members.remove(client.user.id).catch((removeErr) => {
          logger.debug({ threadId: thread.id, removeErr }, "[modmail] failed to remove bot from thread (best effort)");
        });
        logger.info(
          { threadId: thread.id },
          "[modmail] close:archive final fallback: removed bot from thread"
        );
      }
    } catch (cleanupErr) {
      logger.debug({ threadId: thread.id, cleanupErr }, "[modmail] cleanup failed during archive fallback");
    }

    return { action: "archive", ok: false, err: e, code };
  }
}

/**
 * cleanupOpenModmail
 * WHAT: Remove ticket from open_modmail guard table and in-memory set.
 * WHY: Ensures subsequent interactions don't think the ticket is still open.
 * IDEMPOTENT: Safe to call multiple times (no-op if already removed).
 */
function cleanupOpenModmail(guildId: string, userId: string, threadId: string | null) {
  try {
    db.prepare(
      `
      DELETE FROM open_modmail
      WHERE guild_id = ? AND applicant_id = ?
    `
    ).run(guildId, userId);

    if (threadId) {
      OPEN_MODMAIL_THREADS.delete(threadId);
    }

    logger.debug(
      { guildId, userId, threadId },
      "[modmail] close:cleanup removed from guard table and in-memory set"
    );
  } catch (err) {
    logger.warn({ err, guildId, userId }, "[modmail] close:cleanup failed (non-fatal)");
  }
}

// ===== Close Thread =====

/**
 * closeModmailThread
 * WHAT: Close a modmail thread.
 * WHY: Ends the modmail conversation and archives/deletes the thread.
 * PARAMS:
 *  - interaction: The interaction that triggered this
 *  - ticketId: Optional ticket ID
 *  - threadId: Optional thread ID
 * RETURNS: Success status, message, and optional log URL
 */
export async function closeModmailThread(params: {
  interaction: ButtonInteraction | ChatInputCommandInteraction;
  ticketId?: number;
  threadId?: string;
}): Promise<{ success: boolean; message?: string; logUrl?: string | null }> {
  const { interaction, ticketId, threadId } = params;

  let ticket: ModmailTicket | null = null;

  if (ticketId) {
    ticket = getTicketById(ticketId);
  } else if (threadId) {
    ticket = getTicketByThread(threadId);
  } else {
    // Use current thread if command run in thread
    if (interaction.channel?.isThread()) {
      ticket = getTicketByThread(interaction.channel.id);
    }
  }

  if (!ticket) {
    return { success: false, message: "Modmail ticket not found." };
  }

  if (ticket.status === "closed") {
    return { success: false, message: "This ticket is already closed." };
  }

  try {
    // Close in DB and clean up guard table in single transaction
    db.transaction(() => {
      closeTicket(ticket.id);

      // Clean up from open_modmail guard table
      if (interaction.guildId && ticket.user_id) {
        db.prepare(
          `
          DELETE FROM open_modmail
          WHERE guild_id = ? AND applicant_id = ?
        `
        ).run(interaction.guildId, ticket.user_id);

        logger.info(
          { guildId: interaction.guildId, userId: ticket.user_id, threadId: ticket.thread_id },
          "[modmail] removed from open_modmail guard table"
        );
      }
    })();

    // Remove from open threads set
    if (ticket.thread_id) {
      OPEN_MODMAIL_THREADS.delete(ticket.thread_id);
    }

    // Store thread reference for later cleanup
    let threadForCleanup: any = null;

    // Lock and archive thread
    if (ticket.thread_id) {
      try {
        const thread = (await interaction.client.channels.fetch(
          ticket.thread_id
        )) as PrivateThreadChannel | null;
        if (thread) {
          await thread.setLocked(true);
          await thread.setArchived(true);
          threadForCleanup = thread;
        }
      } catch (err) {
        // Thread may have been manually deleted or bot lacks permissions
        logger.warn(
          { err, ticketId: ticket.id, threadId: ticket.thread_id },
          "[modmail] failed to archive thread (may already be deleted)"
        );
      }
    }

    // Notify applicant
    try {
      const user = await interaction.client.users.fetch(ticket.user_id);
      await user.send({
        content: `Your modmail thread for **${interaction.guild?.name ?? "the server"}** has been closed by staff.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch (err) {
      logger.warn(
        { err, ticketId: ticket.id, userId: ticket.user_id },
        "[modmail] failed to DM applicant on close"
      );
    }

    // Flush transcript to log channel
    let logMessageId: string | null = null;
    let transcriptLines = 0;
    if (interaction.guildId) {
      const result = await flushTranscript({
        client: interaction.client,
        ticketId: ticket.id,
        guildId: interaction.guildId,
        userId: ticket.user_id,
        appCode: ticket.app_code,
      });
      logMessageId = result.messageId;
      transcriptLines = result.lineCount;
    }

    // Save log_channel_id and log_message_id to ticket
    let logUrl: string | null = null;
    if (logMessageId) {
      const cfg = getConfig(interaction.guildId!);
      const logChannelId = cfg?.modmail_log_channel_id ?? null;

      db.prepare(
        `
        UPDATE modmail_ticket
        SET log_channel_id = ?, log_message_id = ?
        WHERE id = ?
      `
      ).run(logChannelId, logMessageId, ticket.id);

      logger.info(
        { ticketId: ticket.id, logChannelId, logMessageId },
        "[modmail] stored transcript message pointer"
      );

      // Build log URL
      if (logChannelId && interaction.guildId) {
        logUrl = `https://discord.com/channels/${interaction.guildId}/${logChannelId}/${logMessageId}`;
      }
    }

    // Refresh review card after close
    try {
      const { ensureReviewMessage } = await import("../review.js");
      const { findAppByShortCode } = await import("../appLookup.js");
      const app =
        interaction.guildId && ticket.app_code
          ? (findAppByShortCode(interaction.guildId, ticket.app_code) as { id: string } | null)
          : null;
      if (app) {
        await ensureReviewMessage(interaction.client, app.id);
        logger.info({ code: ticket.app_code, appId: app.id }, "[review] card refreshed");
      }
    } catch (err) {
      logger.warn({ err, ticketId: ticket.id }, "[review] failed to refresh card after close");
    }

    logger.info({ ticketId: ticket.id, threadId: ticket.thread_id }, "[modmail] thread closed");

    // Log modmail close action (before auto-delete so we know which action was taken)
    let archiveAction: "delete" | "archive" = "archive";

    // Auto-delete or leave thread based on config (after transcript is flushed)
    if (threadForCleanup && interaction.guildId) {
      const cfg = getConfig(interaction.guildId);
      const preferDelete = cfg?.modmail_delete_on_close !== false; // default true

      try {
        if (preferDelete) {
          archiveAction = "delete";
          await threadForCleanup.delete("Closed by decision - transcript flushed");
          logger.info({ threadId: threadForCleanup.id }, "[modmail] thread deleted after close");
        } else {
          archiveAction = "archive";
          // Fall back: hide it by leaving the thread
          try {
            await threadForCleanup.members.remove(interaction.client.user!.id);
          } catch (leaveErr) {
            logger.debug(
              { err: leaveErr, threadId: threadForCleanup.id },
              "[modmail] bot already not in thread"
            );
          }
          logger.info(
            { threadId: threadForCleanup.id },
            "[modmail] thread archived/locked; bot removed"
          );
        }
      } catch (cleanupErr) {
        logger.warn(
          { err: cleanupErr, threadId: threadForCleanup.id },
          "[modmail] cleanup failed after close (non-fatal)"
        );
      }
    }

    // Log modmail close action with transcript metadata
    if (interaction.guild) {
      await logActionPretty(interaction.guild, {
        appId: undefined,
        appCode: ticket.app_code || undefined,
        actorId: interaction.user.id,
        subjectId: ticket.user_id,
        action: "modmail_close",
        meta: {
          transcriptLines,
          archive: archiveAction,
        },
      }).catch((err) => {
        logger.warn({ err, ticketId: ticket.id }, "[modmail] failed to log modmail_close");
      });
    }

    return {
      success: true,
      message: logUrl ? `Modmail closed. Logs: ${logUrl}` : "Modmail thread closed.",
      logUrl,
    };
  } catch (err) {
    logger.error({ err, ticketId: ticket.id }, "[modmail] failed to close thread");
    captureException(err, { area: "modmail:closeThread", ticketId: ticket.id });
    return { success: false, message: "Failed to close modmail thread. Check logs." };
  }
}

// ===== Reopen Thread =====

/**
 * reopenModmailThread
 * WHAT: Reopen a closed modmail thread.
 * WHY: Allows continuing a conversation after closure (within 7 days).
 * PARAMS:
 *  - interaction: The interaction that triggered this
 *  - userId: Optional user ID
 *  - threadId: Optional thread ID
 * RETURNS: Success status and message
 */
export async function reopenModmailThread(params: {
  interaction: ChatInputCommandInteraction;
  userId?: string;
  threadId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, userId, threadId } = params;

  let ticket: ModmailTicket | null = null;

  if (userId && interaction.guildId) {
    // Find most recent closed ticket for this user
    const row = db
      .prepare(
        `
      SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
      FROM modmail_ticket
      WHERE guild_id = ? AND user_id = ? AND status = 'closed'
      ORDER BY closed_at DESC
      LIMIT 1
    `
      )
      .get(interaction.guildId, userId) as ModmailTicket | undefined;
    ticket = row ?? null;
  } else if (threadId) {
    ticket = getTicketByThread(threadId);
  } else if (interaction.channel?.isThread()) {
    ticket = getTicketByThread(interaction.channel.id);
  }

  if (!ticket) {
    return { success: false, message: "No closed modmail ticket found." };
  }

  if (ticket.status === "open") {
    return { success: false, message: "This ticket is already open." };
  }

  // Check if closed within 7 days
  const closedAt = ticket.closed_at ? new Date(ticket.closed_at).getTime() : 0;
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (now - closedAt > sevenDays) {
    // Create new thread instead
    return await openPublicModmailThreadFor({
      interaction,
      userId: ticket.user_id,
      appCode: ticket.app_code ?? undefined,
      reviewMessageId: ticket.review_message_id ?? undefined,
    });
  }

  try {
    // Reopen in DB and restore guard table in single transaction
    db.transaction(() => {
      reopenTicket(ticket.id);

      // Restore open_modmail guard table entry
      // CRITICAL: Without this, the guard table will think no ticket is open,
      // allowing duplicate threads to be created for this user
      if (interaction.guildId && ticket.user_id && ticket.thread_id) {
        db.prepare(
          `
          INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
          VALUES (?, ?, ?, strftime('%s','now'))
          ON CONFLICT(guild_id, applicant_id) DO UPDATE SET thread_id=excluded.thread_id
        `
        ).run(interaction.guildId, ticket.user_id, ticket.thread_id);

        logger.debug(
          { guildId: interaction.guildId, userId: ticket.user_id, threadId: ticket.thread_id },
          "[modmail] restored open_modmail guard table entry on reopen"
        );
      }
    })();

    // Restore in-memory set for efficient routing
    // CRITICAL: Without this, messageCreate won't recognize the thread as a modmail thread
    if (ticket.thread_id) {
      OPEN_MODMAIL_THREADS.add(ticket.thread_id);
      logger.debug({ threadId: ticket.thread_id }, "[modmail] restored OPEN_MODMAIL_THREADS entry on reopen");
    }

    // Unlock and unarchive thread
    if (ticket.thread_id) {
      const thread = (await interaction.client.channels.fetch(
        ticket.thread_id
      )) as PrivateThreadChannel | null;
      if (thread) {
        await thread.setArchived(false);
        await thread.setLocked(false);
      }
    }

    // Notify applicant
    try {
      const user = await interaction.client.users.fetch(ticket.user_id);
      await user.send({
        content: `Your modmail thread for **${interaction.guild?.name ?? "the server"}** has been reopened by staff.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch (err) {
      logger.warn(
        { err, ticketId: ticket.id, userId: ticket.user_id },
        "[modmail] failed to DM applicant on reopen"
      );
    }

    logger.info({ ticketId: ticket.id, threadId: ticket.thread_id }, "[modmail] thread reopened");

    return {
      success: true,
      message: `Modmail thread reopened: <#${ticket.thread_id}>`,
    };
  } catch (err) {
    logger.error({ err, ticketId: ticket.id }, "[modmail] failed to reopen thread");
    captureException(err, { area: "modmail:reopenThread", ticketId: ticket.id });
    return { success: false, message: "Failed to reopen modmail thread. Check logs." };
  }
}

// ===== Auto-close for Application Decisions =====

/**
 * closeModmailForApplication
 * WHAT: Auto-close modmail for an application when a decision is made.
 * WHY: Ensures audit trail and cleanup on approve/reject decisions.
 * HOW: Ordered sequence - close message -> transcript flush -> archive/delete -> cleanup.
 * SAFETY: Resilient to permission errors; never blocks decision flow.
 * PARAMS:
 *  - guildId: Guild ID
 *  - userId: User ID
 *  - appCode: Application code
 *  - options: Reason, client, and guild
 */
export async function closeModmailForApplication(
  guildId: string,
  userId: string,
  appCode: string,
  options: {
    reason: "approved" | "rejected" | "permanently rejected" | "kicked";
    client: Client;
    guild: Guild;
  }
): Promise<void> {
  const { reason, client, guild } = options;

  logger.info({ guildId, userId, appCode, reason }, "[modmail] close:start auto-close on decision");

  // Guard: if already closed or doesn't exist, nothing to do
  const ticket = getOpenTicketByUser(guildId, userId);
  if (!ticket || ticket.status !== "open") {
    logger.debug({ guildId, userId }, "[modmail] close:start no open ticket (idempotent)");
    return;
  }

  const ticketId = ticket.id;
  const threadId = ticket.thread_id;

  try {
    const reasonText =
      reason === "approved"
        ? "Your application has been approved."
        : reason === "rejected"
          ? "Your application has been rejected."
          : reason === "permanently rejected"
            ? "Your application has been permanently rejected and you cannot apply again."
            : "You have been removed from the server.";

    // ===== PHASE A: Send closing message (best effort, before archive) =====
    let closingMessageResult: "ok" | "skip" | "err" = "skip";
    let thread: ThreadChannel | null = null;

    if (threadId) {
      try {
        const ch = await client.channels.fetch(threadId);
        if (ch?.isThread()) {
          thread = ch as ThreadChannel;
          closingMessageResult = await trySendClosingMessage(thread, reasonText);
        }
      } catch (err) {
        logger.debug({ err, threadId }, "[modmail] close:closing_message fetch failed");
        closingMessageResult = "err";
      }
    }

    logger.info(
      { ticketId, threadId, result: closingMessageResult },
      "[modmail] close:closing_message"
    );

    // ===== PHASE B: Flush transcript to log channel =====
    const { messageId: logMessageId, lineCount: transcriptLines } = await flushTranscript({
      client,
      ticketId,
      guildId,
      userId,
      appCode: ticket.app_code ?? appCode,
    });

    logger.info(
      {
        ticketId,
        threadId,
        lines: transcriptLines,
        logMessageId: logMessageId ?? null,
        ok: !!logMessageId,
      },
      "[modmail] close:transcript"
    );

    // Save log message pointer to DB
    if (logMessageId) {
      const cfg = getConfig(guildId);
      const logChannelId = cfg?.modmail_log_channel_id ?? null;

      db.prepare(
        `
        UPDATE modmail_ticket
        SET log_channel_id = ?, log_message_id = ?
        WHERE id = ?
      `
      ).run(logChannelId, logMessageId, ticketId);
    }

    // ===== PHASE C: Archive/lock or delete thread =====
    let archiveResult: { action: string; ok: boolean; code?: number } = {
      action: "none",
      ok: true,
    };

    if (thread) {
      const cfg = getConfig(guildId);
      const deleteOnClose = cfg?.modmail_delete_on_close !== false; // default true

      archiveResult = await archiveOrDeleteThread(thread, deleteOnClose, client);
      logger.info(
        {
          ticketId,
          threadId,
          action: archiveResult.action,
          ok: archiveResult.ok,
          code: archiveResult.code,
        },
        "[modmail] close:archive"
      );
    }

    // ===== PHASE D: Cleanup guard table and DB status =====
    db.transaction(() => {
      closeTicket(ticketId);
      cleanupOpenModmail(guildId, userId, threadId);
    })();

    logger.info({ ticketId, threadId, guildId, userId }, "[modmail] close:cleanup ok");

    // ===== Best-effort: DM applicant about closure =====
    try {
      const user = await client.users.fetch(userId);
      const closeEmbed = new EmbedBuilder()
        .setTitle("Modmail Closed")
        .setDescription(
          `Your modmail thread for **${guild.name}** has been closed.\n\n**Reason:** ${reasonText}`
        )
        .setColor(0x808080)
        .setTimestamp();

      await user.send({ embeds: [closeEmbed], allowedMentions: SAFE_ALLOWED_MENTIONS });
      logger.debug({ ticketId, userId }, "[modmail] close:dm_user ok");
    } catch (err) {
      logger.debug({ err, ticketId, userId }, "[modmail] close:dm_user err (non-fatal)");
    }

    // ===== Refresh review card =====
    try {
      const { ensureReviewMessage } = await import("../review.js");
      const { findAppByShortCode } = await import("../appLookup.js");
      const app = ticket.app_code
        ? (findAppByShortCode(guildId, ticket.app_code) as { id: string } | null)
        : null;
      if (app) {
        await ensureReviewMessage(client, app.id);
        logger.debug(
          { code: ticket.app_code, appId: app.id },
          "[modmail] close:review_card refreshed"
        );
      }
    } catch (err) {
      logger.debug({ err, ticketId }, "[modmail] close:review_card err (non-fatal)");
    }

    logger.info(
      {
        ticketId,
        threadId,
        userId,
        reason,
        closingMsg: closingMessageResult,
        transcript: transcriptLines,
        archive: archiveResult.action,
      },
      "[modmail] close:complete auto-closed on decision"
    );
  } catch (err) {
    logger.error({ err, ticketId, threadId, reason }, "[modmail] close:fatal unexpected error");
    captureException(err, { area: "modmail:autoClose", ticketId });

    // Best effort: mark closed in DB even if other steps failed
    try {
      db.transaction(() => {
        closeTicket(ticketId);
        cleanupOpenModmail(guildId, userId, threadId);
      })();
      logger.warn({ ticketId }, "[modmail] close:cleanup forced after error");
    } catch (cleanupErr) {
      logger.error({ err: cleanupErr, ticketId }, "[modmail] close:cleanup failed");
    }
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
