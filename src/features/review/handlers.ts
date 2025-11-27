/**
 * Pawtropolis Tech -- src/features/review/handlers.ts
 * WHAT: Button and modal interaction handlers for review system.
 * WHY: Centralizes all Discord interaction handling for review flows.
 * FLOWS:
 *  - Buttons: approve/reject/kick/claim/unclaim/modmail/copy_uid/ping
 *  - Modals: reject reason, accept reason, permanent reject reason
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 *  - ModalSubmitInteraction: https://discord.js.org/#/docs/discord.js/main/class/ModalSubmitInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { getConfig, hasStaffPermissions } from "../../lib/config.js";
import { replyOrEdit, ensureDeferred } from "../../lib/cmdWrap.js";
import { shortCode } from "../../lib/ids.js";
import { logActionPretty } from "../../logging/pretty.js";
import {
  BTN_DECIDE_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_MODMAIL_RE,
  MODAL_REJECT_RE,
  MODAL_PERM_REJECT_RE,
  MODAL_ACCEPT_RE,
} from "../../lib/modalPatterns.js";
import { closeModmailForApplication } from "../modmail.js";
import { nowUtc } from "../../lib/time.js";
import { autoDelete } from "../../utils/autoDelete.js";
import { findAppByShortCode } from "../appLookup.js";
import { postWelcomeCard } from "../welcome.js";

import type {
  ApplicationRow,
  ReviewStaffInteraction,
  ReviewActionInteraction,
  ApproveFlowResult,
} from "./types.js";

import {
  getClaim,
  claimGuard,
  clearClaim,
  CLAIMED_MESSAGE,
} from "./claims.js";

import {
  loadApplication,
  updateReviewActionMeta,
} from "./queries.js";

// Import transaction and flow functions from flows module
import {
  approveTx,
  rejectTx,
  kickTx,
  approveFlow,
  rejectFlow,
  kickFlow,
  deliverApprovalDm,
} from "./flows/index.js";

// Import card functions from main review module
// NOTE: ensureReviewMessage will be extracted to a separate module in future refactoring
import { ensureReviewMessage } from "../review.js";

// ===== Constants =====

const BUTTON_RE = BTN_DECIDE_RE;
const MODAL_RE = MODAL_REJECT_RE;
const ACCEPT_MODAL_RE = MODAL_ACCEPT_RE;

// ===== Helper Functions =====

/**
 * isStaff
 * WHAT: Check if a member has staff permissions for a guild.
 * WHY: Gate handler access to authorized moderators only.
 */
function isStaff(guildId: string, member: GuildMember | null) {
  return hasStaffPermissions(member, guildId);
}

/**
 * requireInteractionStaff
 * WHAT: Validates that an interaction is from a staff member in a guild.
 * WHY: Guards all handler entry points against unauthorized access.
 * RETURNS: true if valid, false if rejected (reply sent).
 */
function requireInteractionStaff(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
  if (!interaction.inGuild() || !interaction.guildId) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "Guild only." })
      .catch(() => undefined);
    return false;
  }
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "You do not have permission for this." })
      .catch(() => undefined);
    return false;
  }
  return true;
}

/**
 * resolveApplication
 * WHAT: Resolves an application from a short code, with validation.
 * WHY: Common pattern across all handlers - validates guild match and existence.
 * RETURNS: ApplicationRow or null if not found (reply sent).
 */
async function resolveApplication(
  interaction: ReviewStaffInteraction,
  code: string
): Promise<ApplicationRow | null> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyOrEdit(interaction, { content: "Guild only." }).catch(() => undefined);
    return null;
  }

  const row = findAppByShortCode(guildId, code) as { id: string } | null;
  if (!row) {
    await replyOrEdit(interaction, { content: `No application with code ${code}.` }).catch(
      () => undefined
    );
    return null;
  }

  const app = loadApplication(row.id);
  if (!app) {
    await replyOrEdit(interaction, { content: "Application not found." }).catch(() => undefined);
    return null;
  }
  if (app.guild_id !== guildId) {
    await replyOrEdit(interaction, { content: "Guild mismatch for application." }).catch(
      () => undefined
    );
    return null;
  }

  return app;
}

// ===== Modal Opening Functions =====

/**
 * openRejectModal
 * WHAT: Shows the rejection modal with reason input.
 * WHY: Allows moderators to provide rejection reason before finalizing.
 */
async function openRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:reject:code${shortCode(app.id)}`)
    .setTitle("Reject application");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:reject:reason")
    .setLabel("Reason (max 500 chars)")
    .setRequired(true)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "Failed to show reject modal");
  });
}

/**
 * openAcceptModal
 * WHAT: Shows the accept modal with optional reason/comment field.
 * WHY: Acts as confirmation and allows funny/personal approval messages.
 */
async function openAcceptModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:accept:code${shortCode(app.id)}`)
    .setTitle("Approve Application");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:accept:reason")
    .setLabel("Note/comment (optional, shown to user)")
    .setPlaceholder("Add a personal touch to the approval message...")
    .setRequired(false)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "Failed to show accept modal");
  });
}

/**
 * openPermRejectModal
 * WHAT: Shows the permanent rejection modal.
 * WHY: Requires detailed reason for permanent bans.
 */
async function openPermRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const claim = getClaim(app.id);
  if (claim && claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, {
      content: "You did not claim this application.",
    }).catch(() => undefined);
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:permreject:code${code}`)
    .setTitle("Permanently Reject");
  const input = new TextInputBuilder()
    .setCustomId("v1:modal:permreject:reason")
    .setLabel("Rejection reason")
    .setPlaceholder("Provide a detailed reason for permanent rejection...")
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500);
  const modalRow = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(modalRow);

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "[review] failed to show permanent reject modal");
  });
}

// ===== Action Runner Functions =====

/**
 * runApproveAction
 * WHAT: Orchestrates the full approval flow.
 * WHY: Handles claim guard -> DB transaction -> role assignment -> DM -> welcome card.
 * ORDER: DB write first (status persists even if Discord API fails).
 */
async function runApproveAction(
  interaction: ReviewActionInteraction,
  app: ApplicationRow,
  reason?: string | null
) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await replyOrEdit(interaction, { content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }
  const result = approveTx(app.id, interaction.user.id, reason);
  if (result.kind === "already") {
    await replyOrEdit(interaction, { content: "Already approved." }).catch(() => undefined);
    return;
  }
  if (result.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${result.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (result.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application is not ready for approval." }).catch(
      () => undefined
    );
    return;
  }

  const cfg = getConfig(guild.id);
  let approvedMember: GuildMember | null = null;
  let roleApplied = false;
  let roleError: ApproveFlowResult["roleError"] = null;
  if (cfg) {
    const flow = await approveFlow(guild, app.user_id, cfg);
    approvedMember = flow.member;
    roleApplied = flow.roleApplied;
    roleError = flow.roleError ?? null;
  }

  clearClaim(app.id);

  // Log approve action to action_log (analytics + pretty embed to logging channel)
  // Non-blocking: .catch() prevents logging failures from affecting approval flow
  if (guild) {
    await logActionPretty(guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "approve",
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log approve action");
    });
  }

  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after approval");
    captureException(err, { area: "approve:ensureReviewMessage", appId: app.id });
  }

  let dmDelivered = false;
  if (approvedMember) {
    dmDelivered = await deliverApprovalDm(approvedMember, guild.name, reason);
  }

  let welcomeNote: string | null = null;
  let roleNote: string | null = null;
  if (cfg && approvedMember && (cfg.accepted_role_id ? roleApplied : true)) {
    try {
      await postWelcomeCard({
        guild,
        user: approvedMember,
        config: cfg,
        memberCount: guild.memberCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      logger.warn(
        { err, guildId: guild.id, userId: approvedMember.id },
        "[approve] failed to post welcome card"
      );
      if (errorMessage.includes("not configured")) {
        welcomeNote = "Welcome message failed: general channel not configured.";
      } else if (errorMessage.includes("missing permissions")) {
        const channelMention = cfg.general_channel_id
          ? `<#${cfg.general_channel_id}>`
          : "the channel";
        welcomeNote = `Welcome message failed: missing permissions in ${channelMention}.`;
      } else {
        welcomeNote = `Welcome message failed: ${errorMessage}`;
      }
    }
  } else if (!cfg?.general_channel_id) {
    welcomeNote = "Welcome message not posted: general channel not configured.";
  }

  if (cfg?.accepted_role_id && roleError) {
    const roleMention = `<@&${cfg.accepted_role_id}>`;
    if (roleError.code === 50013) {
      roleNote = `Failed to grant verification role ${roleMention} (missing permissions).`;
    } else {
      const reason = roleError.message ?? "Unknown error";
      roleNote = `Failed to grant verification role ${roleMention}: ${reason}.`;
    }
  }

  updateReviewActionMeta(result.reviewActionId, { roleApplied, dmDelivered });

  // Auto-close modmail on approval
  const code = shortCode(app.id);
  try {
    await closeModmailForApplication(guild.id, app.user_id, code, {
      reason: "approved",
      client: interaction.client,
      guild,
    });
    logger.info({ code, reason: "approved" }, "[review] decision -> modmail auto-close");
  } catch (err) {
    logger.warn({ err, code }, "[review] failed to auto-close modmail on approval");
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const refreshResult = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = refreshResult.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh card after modmail close");
  }

  // Post public approval message as a reply to the review card
  const messages = ["Application approved."];
  if (roleNote) messages.push(roleNote);
  if (welcomeNote) messages.push(welcomeNote);

  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: messages.join("\n"),
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public approval message");
    }
  }
}

/**
 * runRejectAction
 * WHAT: Orchestrates the rejection flow.
 * WHY: Handles validation -> DB transaction -> DM -> modmail close -> card refresh.
 */
async function runRejectAction(
  interaction: ReviewStaffInteraction,
  app: ApplicationRow,
  reason: string
) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." }).catch(() => undefined);
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, trimmed);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." }).catch(
      () => undefined
    );
    return;
  }

  const user = await interaction.client.users.fetch(app.user_id).catch(() => null);
  const guildName = interaction.guild?.name ?? "this server";
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, { guildName, reason: trimmed });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, dmResult);
  } else {
    logger.warn({ userId: app.user_id }, "Failed to fetch user for rejection DM");
    updateReviewActionMeta(tx.reviewActionId, { dmDelivered });
  }

  clearClaim(app.id);

  // Auto-close modmail on rejection
  const guild = interaction.guild;
  const code = shortCode(app.id);

  // Log reject action
  if (guild) {
    await logActionPretty(guild, {
      appId: app.id,
      appCode: code,
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "reject",
      reason: trimmed,
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log reject action");
    });
  }

  if (guild) {
    try {
      await closeModmailForApplication(guild.id, app.user_id, code, {
        reason: "rejected",
        client: interaction.client,
        guild,
      });
      logger.info({ code, reason: "rejected" }, "[review] decision -> modmail auto-close");
    } catch (err) {
      logger.warn({ err, code }, "[review] failed to auto-close modmail on rejection");
    }
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after rejection");
    captureException(err, { area: "reject:ensureReviewMessage", appId: app.id });
  }

  // Post public rejection message as a reply to the review card
  const publicContent = dmDelivered
    ? "Application rejected."
    : "Application rejected. (DM delivery failed)";
  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: publicContent,
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public rejection message");
    }
  }
}

/**
 * runPermRejectAction
 * WHAT: Orchestrates the permanent rejection flow.
 * WHY: Same as reject but sets permanently_rejected flag to block future applications.
 */
async function runPermRejectAction(
  interaction: ReviewStaffInteraction,
  app: ApplicationRow,
  reason: string
) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." }).catch(() => undefined);
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, trimmed, true); // permanent = true
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." }).catch(
      () => undefined
    );
    return;
  }

  const user = await interaction.client.users.fetch(app.user_id).catch(() => null);
  const guildName = interaction.guild?.name ?? "this server";
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, { guildName, reason: trimmed, permanent: true });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, dmResult);
  } else {
    logger.warn({ userId: app.user_id }, "Failed to fetch user for permanent rejection DM");
    updateReviewActionMeta(tx.reviewActionId, { dmDelivered });
  }

  // Log permanent rejection
  logger.info(
    {
      moderatorId: interaction.user.id,
      userId: app.user_id,
      appId: app.id,
      guildId: interaction.guild?.id,
      reason: trimmed,
    },
    "[review] Permanent rejection applied"
  );

  clearClaim(app.id);

  const guild = interaction.guild;
  const code = shortCode(app.id);

  // Log perm_reject action
  if (guild) {
    await logActionPretty(guild, {
      appId: app.id,
      appCode: code,
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "perm_reject",
      reason: trimmed,
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log perm_reject action");
    });
  }

  // Auto-close modmail on permanent rejection
  if (guild) {
    try {
      await closeModmailForApplication(guild.id, app.user_id, code, {
        reason: "permanently rejected",
        client: interaction.client,
        guild,
      });
      logger.info(
        { code, reason: "permanently rejected" },
        "[review] decision -> modmail auto-close"
      );
    } catch (err) {
      logger.warn({ err, code }, "[review] failed to auto-close modmail on permanent rejection");
    }
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after permanent rejection");
    captureException(err, { area: "permreject:ensureReviewMessage", appId: app.id });
  }

  // Post public permanent rejection message as a reply to the review card
  const publicContent = dmDelivered
    ? "Application permanently rejected."
    : "Application permanently rejected. (DM delivery failed)";
  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: publicContent,
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn(
        { err, appId: app.id },
        "[review] failed to post public permanent rejection message"
      );
    }
  }
}

/**
 * runKickAction
 * WHAT: Orchestrates the kick flow.
 * WHY: Handles validation -> DB transaction -> Discord kick -> modmail close.
 */
async function runKickAction(
  interaction: ReviewActionInteraction,
  app: ApplicationRow,
  reason: string | null
) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await replyOrEdit(interaction, { content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }
  const tx = kickTx(app.id, interaction.user.id, reason);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already kicked." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not in a kickable state." }).catch(
      () => undefined
    );
    return;
  }

  const flow = await kickFlow(guild, app.user_id, reason ?? undefined);
  updateReviewActionMeta(tx.reviewActionId, flow);

  clearClaim(app.id);

  const code = shortCode(app.id);

  // Log kick action
  await logActionPretty(guild, {
    appId: app.id,
    appCode: code,
    actorId: interaction.user.id,
    subjectId: app.user_id,
    action: "kick",
    reason: reason || undefined,
  }).catch((err) => {
    logger.warn({ err, appId: app.id }, "[review] failed to log kick action");
  });

  // Auto-close modmail on kick
  try {
    await closeModmailForApplication(guild.id, app.user_id, code, {
      reason: "kicked",
      client: interaction.client,
      guild,
    });
    logger.info({ code, reason: "kicked" }, "[review] decision -> modmail auto-close");
  } catch (err) {
    logger.warn({ err, code }, "[review] failed to auto-close modmail on kick");
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after kick");
    captureException(err, { area: "kick:ensureReviewMessage", appId: app.id });
  }

  // Post public kick message as a reply to the review card
  const message = flow.kickSucceeded ? "Member kicked." : "Kick attempted; check logs for details.";

  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: message,
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public kick message");
    }
  }
}

// ===== Claim Handlers =====

/**
 * handleClaimToggle
 * WHAT: Handles claim button using atomic claimTx().
 * WHY: Prevents race conditions when two mods click "Claim" simultaneously.
 */
async function handleClaimToggle(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic claim function
  const { claimTx, ClaimError: ClaimTxError } = await import("../reviewActions.js");

  // Note: deferUpdate() already called by parent handleReviewButton, so don't call again

  // Attempt atomic claim (includes validation and transaction)
  try {
    claimTx(app.id, interaction.user.id, app.guild_id);
  } catch (err) {
    if (err instanceof ClaimTxError) {
      let msg = "Failed to claim application";
      if (err.code === "ALREADY_CLAIMED") {
        msg = "This application is already claimed by another moderator.";
      } else if (err.code === "INVALID_STATUS") {
        msg = `Cannot claim: application is already **${err.message.split(" ")[2]}**.`;

        // Refresh card to show current state
        try {
          await ensureReviewMessage(interaction.client, app.id);
        } catch (refreshErr) {
          logger.warn({ err: refreshErr, appId: app.id }, "[review] failed to refresh card after blocked claim");
        }
      } else if (err.code === "APP_NOT_FOUND") {
        msg = "Application not found.";
      }

      await replyOrEdit(interaction, {
        content: msg,
        flags: MessageFlags.Ephemeral,
      }).catch(() => undefined);

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected claim error");
    await replyOrEdit(interaction, {
      content: "An unexpected error occurred. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
    return;
  }

  // Check if user is permanently rejected (additional validation)
  const permRejectCheck = db
    .prepare(
      `SELECT permanently_rejected FROM application WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1`
    )
    .get(app.guild_id, app.user_id) as { permanently_rejected: number } | undefined;

  if (permRejectCheck) {
    await replyOrEdit(interaction, {
      content: `This user has been permanently rejected from **${interaction.guild?.name ?? "this server"}** and cannot reapply.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
    logger.info(
      { userId: app.user_id, guildId: app.guild_id, moderatorId: interaction.user.id },
      "[review] Claim attempt blocked - user permanently rejected"
    );
    return;
  }

  // Note: review_action INSERT is now inside claimTx() for atomicity

  logger.info(
    {
      appId: app.id,
      claimerId: interaction.user.id,
      guildId: app.guild_id,
    },
    "[review] application claimed successfully"
  );

  // Log claim action via pretty embed
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "claim",
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log claim action");
    });
  }

  // Refresh the review card to show the claim
  try {
    await ensureReviewMessage(interaction.client, app.id);
    logger.info({ appId: app.id }, "[review] card refreshed after claim");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh review card after claim");
    captureException(err, { area: "claim:ensureReviewMessage", appId: app.id });
  }

  // Send single ephemeral feedback to confirm claim (no public message)
  await replyOrEdit(interaction, {
    content: "Application claimed successfully.",
    flags: MessageFlags.Ephemeral,
  }).catch(() => undefined);
}

/**
 * handleUnclaimAction
 * WHAT: Handles unclaim button using atomic unclaimTx().
 * WHY: Releases claim so other moderators can review.
 */
async function handleUnclaimAction(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic unclaim function
  const { unclaimTx, ClaimError: ClaimTxError } = await import("../reviewActions.js");

  // Note: deferUpdate() already called by parent handleReviewButton, so don't call again

  // Attempt atomic unclaim (includes validation and transaction)
  try {
    unclaimTx(app.id, interaction.user.id, app.guild_id);
  } catch (err) {
    if (err instanceof ClaimTxError) {
      let msg = "Failed to unclaim application";
      if (err.code === "NOT_CLAIMED") {
        msg = "This application is not currently claimed.";
      } else if (err.code === "NOT_OWNER") {
        msg = "You did not claim this application. Only the claim owner can unclaim it.";
      } else if (err.code === "APP_NOT_FOUND") {
        msg = "Application not found.";
      }

      await replyOrEdit(interaction, {
        content: msg,
        flags: MessageFlags.Ephemeral,
      }).catch(() => undefined);

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected unclaim error");
    await replyOrEdit(interaction, {
      content: "An unexpected error occurred. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
    return;
  }

  // NOTE: unclaimTx already inserts into review_action table inside its transaction,
  // so we don't need to insert again here. The audit trail is complete from unclaimTx.

  logger.info(
    {
      appId: app.id,
      moderatorId: interaction.user.id,
      guildId: app.guild_id,
    },
    "[review] application unclaimed successfully"
  );

  // Log unclaim action via pretty embed
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "unclaim",
      meta: { type: "unclaim" },
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log unclaim action");
    });
  }

  // Refresh the review card to show unclaimed state
  try {
    await ensureReviewMessage(interaction.client, app.id);
    logger.info({ appId: app.id }, "[review] card refreshed after unclaim");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh review card after unclaim");
    captureException(err, { area: "unclaim:ensureReviewMessage", appId: app.id });
  }

  // Send single ephemeral feedback to confirm unclaim (no public message)
  await replyOrEdit(interaction, {
    content: `Application \`${shortCode(app.id)}\` unclaimed successfully.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => undefined);
}

// ===== Exported Handler Functions =====

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

    // Acknowledge button without visible bubble for kick/claim/unclaim
    // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => undefined);
    }

    const app = await resolveApplication(interaction, code);
    if (!app) return;

    if (action === "kick") {
      await runKickAction(interaction, app, null);
    } else if (action === "claim") {
      await handleClaimToggle(interaction, app);
    } else if (action === "unclaim") {
      await handleUnclaimAction(interaction, app);
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, action, code, traceId }, "Review button handling failed");
    captureException(err, { area: "handleReviewButton", action, code, traceId });
    if (!interaction.deferred && !interaction.replied && action !== "reject" && action !== "approve" && action !== "accept") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    await replyOrEdit(interaction, {
      content: `Failed to process action (trace: ${traceId}). Try again or check logs.`,
    }).catch(() => undefined);
  }
}

/**
 * handleRejectModal
 * WHAT: Handles rejection modal submission.
 * WHY: Processes rejection reason and triggers reject flow.
 */
export async function handleRejectModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  // Acknowledge modal without visible bubble
  // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    const reasonRaw = interaction.fields.getTextInputValue("v1:modal:reject:reason") ?? "";
    const reason = reasonRaw.trim().slice(0, 500);

    await runRejectAction(interaction, app, reason);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Reject modal handling failed");
    captureException(err, { area: "handleRejectModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process rejection (trace: ${traceId}).`,
    }).catch(() => undefined);
  }
}

/**
 * handleAcceptModal
 * WHAT: Handles acceptance modal submission.
 * WHY: Processes optional approval comment and triggers approve flow.
 */
export async function handleAcceptModal(interaction: ModalSubmitInteraction) {
  const match = ACCEPT_MODAL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    const reasonRaw = interaction.fields.getTextInputValue("v1:modal:accept:reason") ?? "";
    const reason = reasonRaw.trim().slice(0, 500) || null;

    await runApproveAction(interaction, app, reason);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Accept modal handling failed");
    captureException(err, { area: "handleAcceptModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process approval (trace: ${traceId}).`,
    }).catch(() => undefined);
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
    await interaction.deferUpdate().catch(() => undefined);
  }

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    // Import and call modmail function
    const { openPublicModmailThreadFor } = await import("../modmail.js");
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
            allowedMentions: { parse: [] },
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
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Modmail button handling failed");
    captureException(err, { area: "handleModmailButton", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to open modmail (trace: ${traceId}).`,
    }).catch(() => undefined);
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    await replyOrEdit(interaction, {
      content: `Failed to open permanent reject modal (trace: ${traceId}).`,
    }).catch(() => undefined);
  }
}

/**
 * handlePermRejectModal
 * WHAT: Handles permanent rejection modal submission.
 * WHY: Processes reason and triggers permanent reject flow.
 */
export async function handlePermRejectModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_PERM_REJECT_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  // Acknowledge modal without visible bubble
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    const reasonRaw = interaction.fields.getTextInputValue("v1:modal:permreject:reason") ?? "";
    const reason = reasonRaw.trim().slice(0, 500);

    await runPermRejectAction(interaction, app, reason);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Permanent reject modal handling failed");
    captureException(err, { area: "handlePermRejectModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process permanent rejection (trace: ${traceId}).`,
    }).catch(() => undefined);
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
      .catch(() => undefined);
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
    await replyOrEdit(interaction, { content: "Guild only." }).catch(() => undefined);
    return;
  }

  // Check staff permissions
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    await replyOrEdit(interaction, {
      content: "You do not have permission for this.",
    }).catch(() => undefined);
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
    await replyOrEdit(interaction, { content: "Invalid ping button data." }).catch(() => undefined);
    return;
  }
  const cfg = getConfig(interaction.guildId);

  if (!cfg?.unverified_channel_id) {
    await replyOrEdit(interaction, {
      content: "Unverified channel not configured. Run `/gate setup` to configure it.",
    }).catch(() => undefined);
    return;
  }

  try {
    // Fetch the unverified channel
    const channel = await interaction.guild.channels.fetch(cfg.unverified_channel_id);
    if (!channel || !channel.isTextBased()) {
      await replyOrEdit(interaction, {
        content: "Unverified channel is not a valid text channel.",
      }).catch(() => undefined);
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
        }).catch(() => undefined);
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
    }).catch(() => undefined);

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

    await replyOrEdit(interaction, { content: errorMsg }).catch(() => undefined);
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
      .catch(() => undefined);
    return;
  }

  // Check staff permissions
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    await interaction
      .reply({
        content: "You do not have permission for this.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
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
      .catch(() => undefined);

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
      .catch(() => undefined);
  }
}
