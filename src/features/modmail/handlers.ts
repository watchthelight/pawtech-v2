/**
 * Pawtropolis Tech -- src/features/modmail/handlers.ts
 * WHAT: Button, context menu, and message routing handlers for modmail.
 * WHY: Separate handler logic from core modmail operations for cleaner organization.
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 *  - MessageContextMenuCommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/MessageContextMenuCommandInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  MessageFlags,
  type ButtonInteraction,
  type MessageContextMenuCommandInteraction,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// ===== Button Handlers =====

/**
 * handleModmailOpenButton
 * WHAT: Handles the "Open Modmail" button click on review cards.
 * WHY: Creates a modmail thread for applicant communication.
 * PARAMS:
 *  - interaction: The button interaction from Discord
 * DOCS:
 *  - Button customId format: v1:modmail:open:code{HEX6}:msg{messageId}
 */
export async function handleModmailOpenButton(interaction: ButtonInteraction) {
  const match = /^v1:modmail:open:(.+)$/.exec(interaction.customId);
  if (!match) return;

  const [, payload] = match;
  // Payload format: "code{HEX6}:msg{messageId}"
  const codeMatch = /code([A-F0-9]{6})/.exec(payload);
  const msgMatch = /msg([0-9]+)/.exec(payload);

  const appCode = codeMatch ? codeMatch[1] : undefined;
  const reviewMessageId = msgMatch ? msgMatch[1] : undefined;

  // Extract userId from review card or button context
  // For now, we need to look up the application by code
  if (!appCode || !interaction.guildId) {
    // Ensure the clicker gets immediate feedback (ephemeral)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => undefined);
    }
    await interaction
      .followUp({
        flags: MessageFlags.Ephemeral,
        content: "Invalid modmail button data.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => undefined);
    return;
  }

  // Find application by short code
  const { findAppByShortCode } = await import("../appLookup.js");
  const app = findAppByShortCode(interaction.guildId, appCode) as
    | { id: string; user_id: string }
    | null;
  if (!app) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => undefined);
    }
    await interaction
      .followUp({
        flags: MessageFlags.Ephemeral,
        content: `No application found with code ${appCode}.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => undefined);
    return;
  }

  // Acknowledge the button click without creating a visible "Only you can see this" bubble.
  // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
  await interaction.deferUpdate();

  // Import from threads module
  const { openPublicModmailThreadFor } = await import("./threads.js");

  const result = await openPublicModmailThreadFor({
    interaction,
    userId: app.user_id,
    appCode,
    reviewMessageId,
    appId: app.id,
  });

  // Always provide visible feedback:
  if (result.success) {
    // Public confirmation in the review channel if available
    if (interaction.channel && "send" in interaction.channel) {
      try {
        await interaction.channel.send({
          content: result.message ?? "Modmail thread created.",
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
      } catch (err) {
        logger.warn({ err, appCode }, "[modmail] failed to post public thread creation message");
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
      .catch(() => undefined);
  }
}

/**
 * handleModmailCloseButton
 * WHAT: Handles the "Close Modmail" button click in threads.
 * WHY: Closes the modmail conversation and notifies the applicant.
 * PARAMS:
 *  - interaction: The button interaction from Discord
 * DOCS:
 *  - Button customId format: v1:modmail:close:{ticketId}
 */
export async function handleModmailCloseButton(interaction: ButtonInteraction) {
  const match = /^v1:modmail:close:([0-9]+)$/.exec(interaction.customId);
  if (!match) return;

  // Acknowledge the button click without creating a visible "Only you can see this" bubble.
  // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
  await interaction.deferUpdate();

  const ticketId = parseInt(match[1], 10);

  // Import from threads module
  const { closeModmailThread } = await import("./threads.js");

  const result = await closeModmailThread({ interaction, ticketId });

  // Post public message for modmail close
  if (result.success && interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: result.message ?? "Modmail thread closed.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch (err) {
      logger.warn({ err, ticketId }, "[modmail] failed to post public close message");
    }
  }
}

// ===== Context Menu Handler =====

/**
 * handleModmailContextMenu
 * WHAT: Handles the "Modmail: Open" context menu command on messages.
 * WHY: Allows staff to quickly open modmail from any message.
 * PARAMS:
 *  - interaction: The context menu interaction from Discord
 * DOCS:
 *  - Context menus: https://discord.com/developers/docs/interactions/application-commands#message-commands
 */
export async function handleModmailContextMenu(
  interaction: MessageContextMenuCommandInteraction
) {
  await interaction.deferReply();

  const targetMessage = interaction.targetMessage;
  const userId = targetMessage.author.id;

  // Try to find app code from the message content or embeds
  let appCode: string | undefined;
  const { findAppByShortCode } = await import("../appLookup.js");

  // Check if the message is a review message by looking for app code in content or embeds
  const content = targetMessage.content;
  const embeds = targetMessage.embeds;

  // Look for app code in content (e.g., "App Code: ABC123")
  const contentMatch = /App Code:\s*([A-F0-9]{6})/i.exec(content);
  if (contentMatch) {
    appCode = contentMatch[1];
  } else {
    // Look in embeds
    for (const embed of embeds) {
      const embedMatch = /App Code:\s*([A-F0-9]{6})/i.exec(embed.description || "");
      if (embedMatch) {
        appCode = embedMatch[1];
        break;
      }
    }
  }

  // Import from threads module
  const { openPublicModmailThreadFor } = await import("./threads.js");

  const result = await openPublicModmailThreadFor({
    interaction,
    userId,
    appCode,
    reviewMessageId: targetMessage.id,
  });

  await interaction.editReply({ content: result.message ?? "Unknown error." });
}
