/**
 * Pawtropolis Tech -- src/features/review/handlers/actionRunners.ts
 * WHAT: Action runner functions for review decisions (approve/reject/kick).
 * WHY: Orchestrates the full flow for each review action.
 * DOCS:
 *  - Review flows: src/features/review/flows/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  GuildMember,
  type Guild,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import { getConfig } from "../../../lib/config.js";
import { replyOrEdit } from "../../../lib/cmdWrap.js";
import { shortCode } from "../../../lib/ids.js";
import { logActionPretty } from "../../../logging/pretty.js";
import { closeModmailForApplication } from "../../modmail.js";
import { SAFE_ALLOWED_MENTIONS } from "../../../lib/constants.js";
import { postWelcomeCard } from "../../welcome.js";

import type {
  ApplicationRow,
  ReviewStaffInteraction,
  ReviewActionInteraction,
  ApproveFlowResult,
} from "../types.js";

import { getClaim, claimGuard } from "../claims.js";
import { updateReviewActionMeta } from "../queries.js";

import {
  approveTx,
  rejectTx,
  kickTx,
  approveFlow,
  rejectFlow,
  kickFlow,
  deliverApprovalDm,
} from "../flows/index.js";

import { ensureReviewMessage } from "../../review.js";

// ===== Action Runner Functions =====

/**
 * runApproveAction
 * WHAT: Orchestrates the full approval flow.
 * WHY: Handles claim guard -> DB transaction -> role assignment -> DM -> welcome card.
 * ORDER: DB write first (status persists even if Discord API fails).
 */
export async function runApproveAction(
  interaction: ReviewActionInteraction,
  app: ApplicationRow,
  reason?: string | null
) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await replyOrEdit(interaction, { content: "Guild not found." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "approve" }, "[review] guild-not-found reply failed");
    });
    return;
  }
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "approve" }, "[review] claim-guard reply failed");
    });
    return;
  }
  const result = approveTx(app.id, interaction.user.id, reason);
  if (result.kind === "already") {
    await replyOrEdit(interaction, { content: "Already approved." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "approve" }, "[review] already-approved reply failed");
    });
    return;
  }
  if (result.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${result.status}).` }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "approve", status: result.status }, "[review] already-resolved reply failed");
    });
    return;
  }
  if (result.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application is not ready for approval." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "approve" }, "[review] invalid-status reply failed");
    });
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

  // Note: We intentionally preserve the claim record after resolution
  // so the review card continues to show who handled the application

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
        allowedMentions: SAFE_ALLOWED_MENTIONS,
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
export async function runRejectAction(
  interaction: ReviewStaffInteraction,
  app: ApplicationRow,
  reason: string
) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] claim-guard reply failed");
    });
    return;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] reason-required reply failed");
    });
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, trimmed);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] already-rejected reply failed");
    });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject", status: tx.status }, "[review] already-resolved reply failed");
    });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] invalid-status reply failed");
    });
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

  // Note: Claim preserved for review card display

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
        allowedMentions: SAFE_ALLOWED_MENTIONS,
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
export async function runPermRejectAction(
  interaction: ReviewStaffInteraction,
  app: ApplicationRow,
  reason: string
) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] claim-guard reply failed");
    });
    return;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] reason-required reply failed");
    });
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, trimmed, true); // permanent = true
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] already-rejected reply failed");
    });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject", status: tx.status }, "[review] already-resolved reply failed");
    });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] invalid-status reply failed");
    });
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

  // Note: Claim preserved for review card display

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
        allowedMentions: SAFE_ALLOWED_MENTIONS,
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
export async function runKickAction(
  interaction: ReviewActionInteraction,
  app: ApplicationRow,
  reason: string | null
) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await replyOrEdit(interaction, { content: "Guild not found." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] guild-not-found reply failed");
    });
    return;
  }
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] claim-guard reply failed");
    });
    return;
  }
  const tx = kickTx(app.id, interaction.user.id, reason);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already kicked." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] already-kicked reply failed");
    });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick", status: tx.status }, "[review] already-resolved reply failed");
    });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not in a kickable state." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] invalid-status reply failed");
    });
    return;
  }

  const flow = await kickFlow(guild, app.user_id, reason ?? undefined);
  updateReviewActionMeta(tx.reviewActionId, flow);

  // Note: Claim preserved for review card display

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
        allowedMentions: SAFE_ALLOWED_MENTIONS,
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public kick message");
    }
  }
}
