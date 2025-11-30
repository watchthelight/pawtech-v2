/**
 * Pawtropolis Tech — src/features/artistRotation/handlers.ts
 * WHAT: Button interaction handlers for /redeemreward confirmation flow.
 * WHY: Handle confirm/cancel buttons, execute assignment, send Ticket Tool command.
 * FLOWS:
 *  - Confirm → Remove ticket role → Send $add command → Move artist to end → Log
 *  - Cancel → Dismiss message
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ButtonInteraction, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  getTicketRoles,
  TICKET_ROLE_NAMES,
  ART_TYPE_DISPLAY,
  type ArtType,
  incrementAssignments,
  logAssignment,
  getArtist,
  getAllArtists,
  processAssignment,
} from "./index.js";

/**
 * Parse redeemreward button customId
 * Format: redeemreward:{confirmId}:confirm:{recipientId}:{artType}:{artistId}:{isOverride}
 * Or: redeemreward:{confirmId}:cancel
 */
function parseCustomId(customId: string) {
  const parts = customId.split(":");
  if (parts.length < 3 || parts[0] !== "redeemreward") {
    return null;
  }

  const confirmId = parts[1];
  const action = parts[2];

  if (action === "cancel") {
    return { confirmId, action: "cancel" as const };
  }

  if (action === "confirm" && parts.length >= 7) {
    return {
      confirmId,
      action: "confirm" as const,
      recipientId: parts[3],
      artType: parts[4] as ArtType,
      artistId: parts[5],
      isOverride: parts[6] === "1",
    };
  }

  return null;
}

/**
 * Handle redeemreward button interactions
 */
export async function handleRedeemRewardButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);

  if (!parsed) {
    logger.warn({ customId: interaction.customId }, "[redeemreward] Invalid button customId");
    await interaction.reply({ content: "Invalid button.", ephemeral: false });
    return;
  }

  if (parsed.action === "cancel") {
    await handleCancel(interaction);
    return;
  }

  if (parsed.action === "confirm") {
    await handleConfirm(interaction, parsed);
    return;
  }
}

/**
 * Handle cancel button
 */
async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: "Redemption cancelled.",
    embeds: [],
    components: [],
  });
}

/**
 * Handle confirm button
 */
async function handleConfirm(
  interaction: ButtonInteraction,
  data: {
    confirmId: string;
    recipientId: string;
    artType: ArtType;
    artistId: string;
    isOverride: boolean;
  }
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This must be done in a server.", ephemeral: false });
    return;
  }

  await interaction.deferUpdate();

  const results: string[] = [];
  let success = true;

  // Step 1: Remove ticket role from recipient (using guild-specific config)
  const ticketRoles = getTicketRoles(guild.id);
  const ticketRoleId = ticketRoles[data.artType];
  if (ticketRoleId) {
    try {
      const member = await guild.members.fetch(data.recipientId);
      if (member.roles.cache.has(ticketRoleId)) {
        await member.roles.remove(ticketRoleId);
        const roleName = TICKET_ROLE_NAMES[ticketRoleId] ?? data.artType;
        results.push(`${roleName} role removed from <@${data.recipientId}>`);
      } else {
        results.push(`*User did not have ticket role*`);
      }
    } catch (err) {
      logger.warn({ err, recipientId: data.recipientId, roleId: ticketRoleId }, "[redeemreward] Failed to remove ticket role");
      results.push(`Failed to remove ticket role (check bot permissions)`);
      success = false;
    }
  } else {
    results.push(`*No ticket role defined for ${data.artType}*`);
  }

  // Step 2: Send $add command to add artist to ticket (Ticket Tool bot)
  const channel = interaction.channel as TextChannel | null;
  if (channel && "send" in channel) {
    try {
      await channel.send(`$add <@${data.artistId}>`);
      results.push(`<@${data.artistId}> added to ticket`);
    } catch (err) {
      logger.warn({ err, artistId: data.artistId }, "[redeemreward] Failed to send $add command");
      results.push(`Failed to send $add command`);
      success = false;
    }
  } else {
    results.push(`Could not send $add command (not a text channel)`);
    success = false;
  }

  // Step 3: Update queue (if not override, move artist to end)
  const artistInfo = getArtist(guild.id, data.artistId);
  const oldPosition = artistInfo?.position ?? null;

  if (!data.isOverride && oldPosition !== null) {
    const result = processAssignment(guild.id, data.artistId);

    if (result) {
      const queueSize = getAllArtists(guild.id).length;
      results.push(`Artist moved from #${result.oldPosition} to #${result.newPosition} in queue (${result.assignmentsCount} total assignments)`);
    } else {
      results.push(`*Failed to update queue - artist not found*`);
      success = false;
    }
  } else if (data.isOverride) {
    // Still increment assignments for override artist
    incrementAssignments(guild.id, data.artistId);
    results.push(`*Override - queue position unchanged*`);
  }

  // Step 4: Log assignment
  logAssignment({
    guildId: guild.id,
    artistId: data.artistId,
    recipientId: data.recipientId,
    ticketType: data.artType,
    ticketRoleId: ticketRoleId ?? null,
    assignedBy: interaction.user.id,
    channelId: channel?.id ?? null,
    override: data.isOverride,
  });
  results.push(`Assignment logged`);

  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle(success ? "Art Reward Assigned" : "Art Reward Assigned (with warnings)")
    .setColor(success ? 0x00cc00 : 0xffaa00)
    .setDescription(
      [
        `**Recipient:** <@${data.recipientId}>`,
        `**Type:** ${ART_TYPE_DISPLAY[data.artType]}`,
        `**Artist:** <@${data.artistId}>`,
        "",
        "**Actions:**",
        ...results.map((r) => `- ${r}`),
      ].join("\n")
    );

  await interaction.editReply({
    embeds: [embed],
    components: [],
  });

  logger.info(
    {
      guildId: guild.id,
      recipientId: data.recipientId,
      artistId: data.artistId,
      artType: data.artType,
      isOverride: data.isOverride,
      assignedBy: interaction.user.id,
      success,
    },
    "[redeemreward] Assignment completed"
  );
}

/**
 * Check if a customId belongs to redeemreward
 */
export function isRedeemRewardButton(customId: string): boolean {
  return customId.startsWith("redeemreward:");
}
