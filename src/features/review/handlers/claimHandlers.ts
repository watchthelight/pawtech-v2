/**
 * Pawtropolis Tech -- src/features/review/handlers/claimHandlers.ts
 * WHAT: Claim and unclaim handlers for review applications.
 * WHY: Manages claim lifecycle for preventing concurrent review conflicts.
 * DOCS:
 *  - Claim system: src/features/review/claims.ts
 *  - Atomic operations: src/features/reviewActions.ts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ButtonInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "../../../db/db.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import { replyOrEdit } from "../../../lib/cmdWrap.js";
import { shortCode } from "../../../lib/ids.js";
import { logActionPretty } from "../../../logging/pretty.js";

import type { ApplicationRow } from "../types.js";
import { ensureReviewMessage } from "../../review.js";

// ===== Claim Handlers =====

/**
 * handleClaimToggle
 * WHAT: Handles claim button using atomic claimTx().
 * WHY: Prevents race conditions when two mods click "Claim" simultaneously.
 */
export async function handleClaimToggle(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic claim function
  const { claimTx, ClaimError: ClaimTxError } = await import("../../reviewActions.js");

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
      }).catch((replyErr) => {
        logger.debug({ err: replyErr, appId: app.id, action: "claim" }, "[review] claim-error reply failed");
      });

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected claim error");
    await replyOrEdit(interaction, {
      content: "An unexpected error occurred. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, appId: app.id, action: "claim" }, "[review] unexpected-error reply failed");
    });
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
    }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "claim" }, "[review] perm-rejected reply failed");
    });
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

  // Update the review card message content to show who claimed it
  await replyOrEdit(interaction, {
    content: `<@${interaction.user.id}> has claimed this application.`,
  }).catch((err) => {
    logger.debug({ err, appId: app.id, action: "claim" }, "[review] claim-success reply failed");
  });
}

/**
 * handleUnclaimAction
 * WHAT: Handles unclaim button using atomic unclaimTx().
 * WHY: Releases claim so other moderators can review.
 */
export async function handleUnclaimAction(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic unclaim function
  const { unclaimTx, ClaimError: ClaimTxError } = await import("../../reviewActions.js");

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
      }).catch((replyErr) => {
        logger.debug({ err: replyErr, appId: app.id, action: "unclaim" }, "[review] unclaim-error reply failed");
      });

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected unclaim error");
    await replyOrEdit(interaction, {
      content: "An unexpected error occurred. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch((replyErr) => {
      logger.debug({ err: replyErr, appId: app.id, action: "unclaim" }, "[review] unexpected-error reply failed");
    });
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
  }).catch((err) => {
    logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] unclaim-success reply failed");
  });
}
