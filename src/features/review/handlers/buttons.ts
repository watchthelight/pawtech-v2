/**
 * Pawtropolis Tech -- src/features/review/handlers/buttons.ts
 * WHAT: Button interaction handlers for review system.
 * WHY: Handles all button clicks on review cards.
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ButtonInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { db } from "../../../db/db.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import { getConfig } from "../../../lib/config.js";
import { replyOrEdit, ensureDeferred } from "../../../lib/cmdWrap.js";
import { shortCode } from "../../../lib/ids.js";
import {
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_MODMAIL_RE,
} from "../../../lib/modalPatterns.js";
import { nowUtc } from "../../../lib/time.js";
import { autoDelete } from "../../../lib/autoDelete.js";
import { findAppByShortCode } from "../../appLookup.js";
import { SAFE_ALLOWED_MENTIONS } from "../../../lib/constants.js";

import {
  BUTTON_RE,
  isStaff,
  requireInteractionStaff,
  resolveApplication,
  openRejectModal,
  openAcceptModal,
  openPermRejectModal,
  openKickModal,
  openUnclaimModal,
} from "./helpers.js";

import { runKickAction } from "./actionRunners.js";
import { handleClaimToggle, handleUnclaimAction } from "./claimHandlers.js";

// ===== Exported Button Handlers =====

/**
 * handleReviewButton
 * WHAT: Main router for review card button interactions.
 * WHY: Central dispatch point for all review button actions.
 * PATTERN: v1:decide:<action>:code<HEXCODE>
 * DESIGN: reject/accept open modals (no defer), kick/claim/unclaim defer immediately.
 */
export async function handleReviewButton(interaction: ButtonInteraction) {
  const match = BUTTON_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const [, action, code] = match;

  try {
    // reject opens modal; no defer needed yet
    if (action === "reject") {
      const app = await resolveApplication(interaction, code);
      if (!app) return;
      await openRejectModal(interaction, app);
      return;
    }

    // accept/approve opens modal for optional reason (acts as confirmation too)
    if (action === "approve" || action === "accept") {
      const app = await resolveApplication(interaction, code);
      if (!app) return;
      await openAcceptModal(interaction, app);
      return;
    }

    // kick opens modal for confirmation with optional reason
    if (action === "kick") {
      const app = await resolveApplication(interaction, code);
      if (!app) return;
      await openKickModal(interaction, app);
      return;
    }

    // unclaim opens modal for confirmation
    if (action === "unclaim") {
      const app = await resolveApplication(interaction, code);
      if (!app) return;
      await openUnclaimModal(interaction, app);
      return;
    }

    // Acknowledge button without visible bubble for claim
    // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch((err) => {
        logger.debug({ err, action, code, interactionId: interaction.id }, "[review] deferUpdate failed");
      });
    }

    const app = await resolveApplication(interaction, code);
    if (!app) return;

    if (action === "claim") {
      await handleClaimToggle(interaction, app);
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, action, code, traceId }, "Review button handling failed");
    captureException(err, { area: "handleReviewButton", action, code, traceId });
    // Modal-opening actions (reject, approve, accept, kick, unclaim) don't defer
    const modalActions = ["reject", "approve", "accept", "kick", "unclaim"];
    if (!interaction.deferred && !interaction.replied && !modalActions.includes(action)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch((deferErr) => {
        logger.debug({ err: deferErr, action, code, traceId }, "[review] error-deferReply failed");
      });
    }
    await replyOrEdit(interaction, {
      content: `Failed to process action (trace: ${traceId}). Try again or check logs.`,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, action, code, traceId }, "[review] error-reply failed");
    });
  }
}

/**
 * handleModmailButton
 * WHAT: Opens modmail thread for an application.
 * WHY: Allows staff to communicate with applicant directly.
 */
export async function handleModmailButton(interaction: ButtonInteraction) {
  const match = BTN_MODMAIL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const code = match[1];

  // Defer update to acknowledge button
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch((err) => {
      logger.debug({ err, code, interactionId: interaction.id }, "[review] modmail-button deferUpdate failed");
    });
  }

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    // Import and call modmail function
    const { openPublicModmailThreadFor } = await import("../../modmail.js");
    const result = await openPublicModmailThreadFor({
      interaction,
      userId: app.user_id,
      appCode: code,
      appId: app.id,
    });

    // Provide feedback
    if (result.success) {
      // Public confirmation in the review channel if available
      if (interaction.channel && "send" in interaction.channel) {
        try {
          await interaction.channel.send({
            content: result.message ?? "Modmail thread created.",
            allowedMentions: SAFE_ALLOWED_MENTIONS,
          });
        } catch (err) {
          logger.warn({ err, code }, "[modmail] failed to post public thread creation message");
        }
      }
    } else {
      // Ephemeral explanation to the clicking moderator
      const msg = result.message || "Failed to create modmail thread. Check bot permissions.";
      await interaction
        .followUp({
          flags: MessageFlags.Ephemeral,
          content: `Warning: ${msg}`,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        })
        .catch((followUpErr) => {
          logger.debug({ err: followUpErr, code }, "[review] modmail-warning followUp failed");
        });
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Modmail button handling failed");
    captureException(err, { area: "handleModmailButton", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to open modmail (trace: ${traceId}).`,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] modmail-error reply failed");
    });
  }
}

/**
 * handlePermRejectButton
 * WHAT: Opens permanent reject modal.
 * WHY: Allows staff to permanently ban user from reapplying.
 */
export async function handlePermRejectButton(interaction: ButtonInteraction) {
  const match = BTN_PERM_REJECT_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const code = match[2];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;
    await openPermRejectModal(interaction, app);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Permanent reject button handling failed");
    captureException(err, { area: "handlePermRejectButton", code, traceId });
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch((deferErr) => {
        logger.debug({ err: deferErr, code, traceId }, "[review] perm-reject-button deferReply failed");
      });
    }
    await replyOrEdit(interaction, {
      content: `Failed to open permanent reject modal (trace: ${traceId}).`,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] perm-reject-button error-reply failed");
    });
  }
}

/**
 * handleCopyUidButton
 * WHAT: Copies user ID to clipboard (ephemeral reply).
 * WHY: Allows mobile-friendly UID copying for moderation purposes.
 */
export async function handleCopyUidButton(interaction: ButtonInteraction) {
  const match = BTN_COPY_UID_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const [, code, userId] = match;

  try {
    // Verify the application exists for security
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Guild context required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const appRow = findAppByShortCode(interaction.guildId, code) as { id: string } | null;
    if (!appRow) {
      await interaction.reply({
        content: `No application with code ${code}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Reply with UID only (no title) for easy mobile copying
    await interaction.reply({
      content: userId,
      flags: MessageFlags.Ephemeral,
    });

    // Log the action to audit trail
    logger.info(
      { moderatorId: interaction.user.id, userId, appId: appRow.id, guildId: interaction.guildId },
      "[review] Moderator copied user ID"
    );

    // Insert audit trail
    try {
      db.prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, message_link, meta)
        VALUES (?, ?, 'copy_uid', ?, NULL, NULL, NULL)
        `
      ).run(appRow.id, interaction.user.id, nowUtc());
    } catch (auditErr: unknown) {
      logger.error({ err: auditErr, appId: appRow.id }, "[review] Failed to log copy_uid action");
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, userId, traceId }, "Copy UID button handling failed");
    captureException(err, { area: "handleCopyUidButton", code, userId, traceId });
    await interaction
      .reply({
        content: `Failed to copy UID (trace: ${traceId}).`,
        flags: MessageFlags.Ephemeral,
      })
      .catch((replyErr) => {
        logger.debug({ err: replyErr, code, userId, traceId }, "[review] copy-uid error-reply failed");
      });
  }
}

/**
 * handlePingInUnverified
 * WHAT: Posts a ping in the unverified channel.
 * WHY: Notifies user about their pending application.
 * FLOW: Posts ping -> replies ephemerally with link -> auto-deletes after 30s.
 */
export async function handlePingInUnverified(interaction: ButtonInteraction) {
  const legacy = /^v1:ping:(.+)$/.exec(interaction.customId);
  const modern = /^review:ping_unverified:code([0-9A-F]{6})(?::user(\d+))?$/.exec(interaction.customId);
  if (!legacy && !modern) return;

  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." }).catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[review] ping guild-only reply failed");
    });
    return;
  }

  // Check Gatekeeper permissions
  const member = interaction.member as GuildMember | null;
  if (!isStaff(member, interaction.user.id)) {
    await replyOrEdit(interaction, {
      content: "You do not have the Gatekeeper role required for this.",
    }).catch((err) => {
      logger.debug({ err, interactionId: interaction.id, guildId: interaction.guildId }, "[review] ping permission reply failed");
    });
    return;
  }

  await ensureDeferred(interaction);

  let userId: string | null = null;
  if (modern) {
    userId = modern[2] ?? null;
  } else {
    const [, payload] = legacy!;
    const userMatch = /user([0-9]+)/.exec(payload);
    userId = userMatch ? userMatch[1] : null;
  }

  if (!userId) {
    await replyOrEdit(interaction, { content: "Invalid ping button data." }).catch((err) => {
      logger.debug({ err, interactionId: interaction.id, guildId: interaction.guildId }, "[review] invalid-ping reply failed");
    });
    return;
  }
  const cfg = getConfig(interaction.guildId);

  if (!cfg?.unverified_channel_id) {
    await replyOrEdit(interaction, {
      content: "Unverified channel not configured. Run `/gate setup` to configure it.",
    }).catch((err) => {
      logger.debug({ err, userId, guildId: interaction.guildId }, "[review] unverified-not-configured reply failed");
    });
    return;
  }

  try {
    // Fetch the unverified channel
    const channel = await interaction.guild.channels.fetch(cfg.unverified_channel_id);
    if (!channel || !channel.isTextBased()) {
      await replyOrEdit(interaction, {
        content: "Unverified channel is not a valid text channel.",
      }).catch((err) => {
        logger.debug({ err, userId, guildId: interaction.guildId, channelId: cfg.unverified_channel_id }, "[review] invalid-channel reply failed");
      });
      return;
    }

    // Check bot permissions
    const me = interaction.guild.members.me;
    const missingPerms: string[] = [];
    let canManage = false;

    if (me) {
      const perms = channel.permissionsFor(me);
      const canView = perms?.has(PermissionFlagsBits.ViewChannel) ?? false;
      const canSend = perms?.has(PermissionFlagsBits.SendMessages) ?? false;
      const canEmbed = perms?.has(PermissionFlagsBits.EmbedLinks) ?? false;
      canManage = perms?.has(PermissionFlagsBits.ManageMessages) ?? false;

      if (!canView) missingPerms.push("ViewChannel");
      if (!canSend) missingPerms.push("SendMessages");
      if (!canEmbed) missingPerms.push("EmbedLinks");

      // Critical permissions - cannot proceed
      if (missingPerms.length > 0) {
        logger.warn(
          { guildId: interaction.guildId, channelId: channel.id, missingPerms },
          "[review] cannot ping unverified: missing critical permissions"
        );
        await replyOrEdit(interaction, {
          content: `Bot is missing required permissions in <#${cfg.unverified_channel_id}>: **${missingPerms.join(", ")}**\n\nPlease check channel permissions.`,
        }).catch((err) => {
          logger.debug({ err, userId, guildId: interaction.guildId, channelId: channel.id }, "[review] missing-perms reply failed");
        });
        return;
      }

      // Warn if ManageMessages is missing (auto-delete won't work)
      if (!canManage) {
        logger.warn(
          { guildId: interaction.guildId, channelId: channel.id },
          "[review] ping will be sent but cannot auto-delete (missing ManageMessages)"
        );
      }
    }

    // Post the ping message
    // WHY: Notifies user in unverified channel; auto-deletes to keep channel clean
    // SAFETY: allowedMentions restricted to only the target user (no @everyone/@here risk)
    const pingMessage = await channel.send({
      content: `<@${userId}>`,
      allowedMentions: { users: [userId], parse: [] }, // ONLY mention the specific user, no mass pings
    });

    // Schedule auto-deletion after 30 seconds (only if bot has ManageMessages permission)
    // WHY: Keeps channel clean while giving user time to see notification
    // SAFETY: Gracefully handles races and permission errors
    if (canManage) {
      autoDelete(pingMessage, 30_000);
    }

    // Reply with link
    const messageUrl = `https://discord.com/channels/${interaction.guildId}/${channel.id}/${pingMessage.id}`;
    const deleteNote = canManage
      ? "The ping will auto-delete after 30 seconds."
      : "Warning: Bot lacks ManageMessages permission - ping will not auto-delete.";

    await replyOrEdit(interaction, {
      content: `Ping posted: ${messageUrl}\n\n${deleteNote}`,
    }).catch((err) => {
      logger.debug({ err, userId, guildId: interaction.guildId, channelId: channel.id }, "[review] ping-success reply failed");
    });

    logger.info(
      {
        userId,
        channelId: channel.id,
        messageId: pingMessage.id,
        moderatorId: interaction.user.id,
        autoDelete: canManage,
      },
      `[review] ping posted in unverified${canManage ? " (auto-deletes after 30s)" : " (no auto-delete)"}`
    );
  } catch (err) {
    const isPermissionError =
      err && typeof err === "object" && "code" in err && (err.code === 50013 || err.code === "50013");

    logger.error(
      {
        err,
        userId,
        guildId: interaction.guildId,
        channelId: cfg.unverified_channel_id,
        isPermissionError,
      },
      "[review] failed to post ping in unverified"
    );

    captureException(err, {
      area: "review:pingInUnverified",
      userId,
      guildId: interaction.guildId,
      channelId: cfg.unverified_channel_id,
    });

    // Provide helpful error message
    let errorMsg = "Failed to post ping in unverified channel.";
    if (isPermissionError) {
      errorMsg +=
        "\n\n**Cause:** Bot is missing permissions in the unverified channel.\n**Fix:** Check channel permissions and ensure the bot has ViewChannel, SendMessages, and EmbedLinks.";
    } else {
      errorMsg += "\n\nCheck bot logs for details.";
    }

    await replyOrEdit(interaction, { content: errorMsg }).catch((replyErr) => {
      logger.debug({ err: replyErr, userId, guildId: interaction.guildId, channelId: cfg.unverified_channel_id }, "[review] ping-error reply failed");
    });
  }
}

/**
 * handleDeletePing
 * WHAT: Deletes a ping message posted in the unverified channel.
 * WHY: Allows staff to clean up ping notifications manually.
 */
export async function handleDeletePing(interaction: ButtonInteraction) {
  const match = /^v1:ping:delete:(.+)$/.exec(interaction.customId);
  if (!match) return;

  if (!interaction.guildId || !interaction.guild) {
    await interaction
      .reply({ content: "Guild only.", flags: MessageFlags.Ephemeral })
      .catch((err) => {
        logger.debug({ err, interactionId: interaction.id }, "[review] delete-ping guild-only reply failed");
      });
    return;
  }

  // Check Gatekeeper permissions
  const member = interaction.member as GuildMember | null;
  if (!isStaff(member, interaction.user.id)) {
    await interaction
      .reply({
        content: "You do not have the Gatekeeper role required for this.",
        flags: MessageFlags.Ephemeral,
      })
      .catch((err) => {
        logger.debug({ err, interactionId: interaction.id, guildId: interaction.guildId }, "[review] delete-ping permission reply failed");
      });
    return;
  }

  const [, messageId] = match;

  try {
    // Delete the ping message
    // DOCS: https://discord.js.org/#/docs/discord.js/main/class/Message?scrollTo=delete
    await interaction.message.delete();

    // Acknowledge the deletion ephemerally (can't update a deleted message)
    await interaction
      .reply({
        content: "Ping deleted.",
        flags: MessageFlags.Ephemeral,
      })
      .catch((err) => {
        logger.debug({ err, messageId, guildId: interaction.guildId }, "[review] delete-ping success reply failed");
      });

    logger.info(
      { messageId, moderatorId: interaction.user.id, guildId: interaction.guildId },
      "[review] ping message deleted by staff"
    );
  } catch (err) {
    logger.warn({ err, messageId }, "[review] failed to delete ping message");
    await interaction
      .reply({
        content: "Failed to delete ping message (it may have been already deleted).",
        flags: MessageFlags.Ephemeral,
      })
      .catch((replyErr) => {
        logger.debug({ err: replyErr, messageId, guildId: interaction.guildId }, "[review] delete-ping error reply failed");
      });
  }
}
