/**
 * Pawtropolis Tech -- src/features/review/handlers/modals.ts
 * WHAT: Modal submission handlers for review system.
 * WHY: Handles all modal submissions for review decisions.
 * DOCS:
 *  - ModalSubmitInteraction: https://discord.js.org/#/docs/discord.js/main/class/ModalSubmitInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ModalSubmitInteraction,
  MessageFlags,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import { replyOrEdit } from "../../../lib/cmdWrap.js";
import { MODAL_PERM_REJECT_RE, MODAL_KICK_RE, MODAL_UNCLAIM_RE } from "../../../lib/modalPatterns.js";

import {
  MODAL_RE,
  ACCEPT_MODAL_RE,
  requireInteractionStaff,
  resolveApplication,
} from "./helpers.js";

import {
  runApproveAction,
  runRejectAction,
  runPermRejectAction,
  runKickAction,
} from "./actionRunners.js";

// ===== Exported Modal Handlers =====

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
    await interaction.deferUpdate().catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[review] reject-modal deferUpdate failed");
    });
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
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] reject-modal error-reply failed");
    });
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
    await interaction.deferUpdate().catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[review] accept-modal deferUpdate failed");
    });
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
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] accept-modal error-reply failed");
    });
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
    await interaction.deferUpdate().catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[review] perm-reject-modal deferUpdate failed");
    });
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
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] perm-reject-modal error-reply failed");
    });
  }
}

/**
 * handleKickModal
 * WHAT: Handles kick confirmation modal submission.
 * WHY: Processes optional reason and triggers kick flow after confirmation.
 */
export async function handleKickModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_KICK_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  // Acknowledge modal without visible bubble
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[review] kick-modal deferUpdate failed");
    });
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    const reasonRaw = interaction.fields.getTextInputValue("v1:modal:kick:reason") ?? "";
    const reason = reasonRaw.trim().slice(0, 500) || null;

    await runKickAction(interaction, app, reason);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Kick modal handling failed");
    captureException(err, { area: "handleKickModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process kick (trace: ${traceId}).`,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] kick-modal error-reply failed");
    });
  }
}

/**
 * handleUnclaimModal
 * WHAT: Handles unclaim confirmation modal submission.
 * WHY: Processes confirmation and triggers unclaim flow.
 */
export async function handleUnclaimModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_UNCLAIM_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  // Acknowledge modal without visible bubble
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch((err) => {
      logger.debug({ err, interactionId: interaction.id }, "[review] unclaim-modal deferUpdate failed");
    });
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    // Validate confirmation text
    const confirmRaw = interaction.fields.getTextInputValue("v1:modal:unclaim:confirm") ?? "";
    const confirm = confirmRaw.trim().toUpperCase();

    if (confirm !== "UNCLAIM") {
      await replyOrEdit(interaction, {
        content: "Unclaim cancelled. You must type `UNCLAIM` to confirm.",
        flags: MessageFlags.Ephemeral,
      }).catch((err) => {
        logger.debug({ err, code }, "[review] unclaim-cancelled reply failed");
      });
      return;
    }

    // Run the unclaim action
    const { handleUnclaimAction } = await import("./claimHandlers.js");
    await handleUnclaimAction(interaction, app);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Unclaim modal handling failed");
    captureException(err, { area: "handleUnclaimModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process unclaim (trace: ${traceId}).`,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, code, traceId }, "[review] unclaim-modal error-reply failed");
    });
  }
}
