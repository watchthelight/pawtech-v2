/**
 * Pawtropolis Tech -- src/features/review/handlers/helpers.ts
 * WHAT: Helper functions and modal openers for review handlers.
 * WHY: Shared utilities extracted from handlers.ts for maintainability.
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 *  - ModalBuilder: https://discord.js.org/#/docs/discord.js/main/class/ModalBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { hasStaffPermissions } from "../../../lib/config.js";
import { replyOrEdit } from "../../../lib/cmdWrap.js";
import { shortCode } from "../../../lib/ids.js";
import { findAppByShortCode } from "../../appLookup.js";
import {
  BTN_DECIDE_RE,
  MODAL_REJECT_RE,
  MODAL_ACCEPT_RE,
  MODAL_KICK_RE,
} from "../../../lib/modalPatterns.js";

import type { ApplicationRow, ReviewStaffInteraction } from "../types.js";
import { getClaim, claimGuard } from "../claims.js";
import { loadApplication } from "../queries.js";

// ===== Constants =====

export const BUTTON_RE = BTN_DECIDE_RE;
export const MODAL_RE = MODAL_REJECT_RE;
export const ACCEPT_MODAL_RE = MODAL_ACCEPT_RE;

// ===== Helper Functions =====

/**
 * isStaff
 * WHAT: Check if a member has staff permissions for a guild.
 * WHY: Gate handler access to authorized moderators only.
 */
export function isStaff(guildId: string, member: GuildMember | null) {
  return hasStaffPermissions(member, guildId);
}

/**
 * requireInteractionStaff
 * WHAT: Validates that an interaction is from a staff member in a guild.
 * WHY: Guards all handler entry points against unauthorized access.
 * RETURNS: true if valid, false if rejected (reply sent).
 */
export function requireInteractionStaff(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
  if (!interaction.inGuild() || !interaction.guildId) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "Guild only." })
      .catch((err) => {
        logger.debug({ err, interactionId: interaction.id }, "[review] guild-only reply failed");
      });
    return false;
  }
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "You do not have permission for this." })
      .catch((err) => {
        logger.debug({ err, interactionId: interaction.id, guildId: interaction.guildId }, "[review] permission reply failed");
      });
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
export async function resolveApplication(
  interaction: ReviewStaffInteraction,
  code: string
): Promise<ApplicationRow | null> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyOrEdit(interaction, { content: "Guild only." }).catch((err) => {
      logger.debug({ err, code, interactionId: interaction.id }, "[review] guild-only reply failed (resolveApplication)");
    });
    return null;
  }

  const row = findAppByShortCode(guildId, code) as { id: string } | null;
  if (!row) {
    await replyOrEdit(interaction, { content: `No application with code ${code}.` }).catch((err) => {
      logger.debug({ err, code, guildId, interactionId: interaction.id }, "[review] no-app reply failed");
    });
    return null;
  }

  const app = loadApplication(row.id);
  if (!app) {
    await replyOrEdit(interaction, { content: "Application not found." }).catch((err) => {
      logger.debug({ err, code, appId: row.id, interactionId: interaction.id }, "[review] app-not-found reply failed");
    });
    return null;
  }
  if (app.guild_id !== guildId) {
    await replyOrEdit(interaction, { content: "Guild mismatch for application." }).catch((err) => {
      logger.debug({ err, code, appId: app.id, guildId, interactionId: interaction.id }, "[review] guild-mismatch reply failed");
    });
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
export async function openRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
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

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "Failed to show reject modal");
  });
}

/**
 * openAcceptModal
 * WHAT: Shows the accept modal with optional reason/comment field.
 * WHY: Acts as confirmation and allows funny/personal approval messages.
 */
export async function openAcceptModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "accept" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "accept" }, "[review] claim-guard reply failed");
    });
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
export async function openPermRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const claim = getClaim(app.id);
  if (claim && claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, {
      content: "You did not claim this application.",
    }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] not-claimed reply failed");
    });
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

/**
 * openKickModal
 * WHAT: Shows the kick confirmation modal with optional reason field.
 * WHY: Prevents accidental kicks by requiring explicit confirmation.
 */
export async function openKickModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] already-resolved reply failed");
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

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:kick:code${code}`)
    .setTitle("Confirm Kick");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:kick:reason")
    .setLabel("Reason (optional)")
    .setPlaceholder("Why are you kicking this user?")
    .setRequired(false)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "[review] failed to show kick modal");
  });
}

/**
 * openUnclaimModal
 * WHAT: Shows the unclaim confirmation modal.
 * WHY: Prevents accidental unclaims by requiring explicit confirmation.
 */
export async function openUnclaimModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  if (!claim) {
    await replyOrEdit(interaction, { content: "This application is not currently claimed." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] not-claimed reply failed");
    });
    return;
  }

  if (claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, { content: "You did not claim this application. Only the claim owner can unclaim it." }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] not-owner reply failed");
    });
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:unclaim:code${code}`)
    .setTitle("Confirm Unclaim");
  const confirmInput = new TextInputBuilder()
    .setCustomId("v1:modal:unclaim:confirm")
    .setLabel("Type UNCLAIM to confirm")
    .setPlaceholder("UNCLAIM")
    .setRequired(true)
    .setMinLength(7)
    .setMaxLength(7)
    .setStyle(TextInputStyle.Short);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput);
  modal.addComponents(row);

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "[review] failed to show unclaim modal");
  });
}
