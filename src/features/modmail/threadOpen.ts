/**
 * Pawtropolis Tech -- src/features/modmail/threadOpen.ts
 * WHAT: Thread opening logic for modmail system.
 * WHY: Creates modmail threads for applicants with race condition protection.
 * DOCS:
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-create
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type ForumChannel,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
  type User,
} from "discord.js";
import type { GuildMember } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { shortCode } from "../../lib/ids.js";
import { hasManageGuild, isReviewer, canRunAllCommands } from "../../lib/config.js";
import { logActionPretty } from "../../logging/pretty.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import { createTicket } from "./tickets.js";
import { addOpenThread } from "./threadState.js";
import { missingPermsForStartThread, ensureModsCanSpeakInThread } from "./threadPerms.js";

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
    addOpenThread(thread.id);

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
