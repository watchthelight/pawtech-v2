/**
 * Pawtropolis Tech — src/commands/redeemreward.ts
 * WHAT: /redeemreward command for assigning art rewards to users.
 * WHY: Staff can assign the next artist from rotation queue and manage ticket roles.
 * FLOWS:
 *  - Staff runs /redeemreward user:@User type:headshot
 *  - Bot shows confirmation embed with user's ticket roles
 *  - Staff clicks Confirm → Bot removes ticket role, sends $add command, logs assignment
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type GuildMember,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "node:crypto";
import {
  getTicketRoles,
  getArtistRoleId,
  TICKET_ROLE_NAMES,
  ART_TYPE_DISPLAY,
  type ArtType,
  type TicketRolesConfig,
  getNextArtist,
  getArtist,
} from "../features/artistRotation/index.js";

export const data = new SlashCommandBuilder()
  .setName("redeemreward")
  .setDescription("Assign an art reward to a user from the artist rotation queue")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("User redeeming the art reward")
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("type")
      .setDescription("Type of art reward")
      .setRequired(true)
      .addChoices(
        { name: "Headshot", value: "headshot" },
        { name: "Half-body", value: "halfbody" },
        { name: "Emoji", value: "emoji" },
        { name: "Full-body", value: "fullbody" }
      )
  )
  .addUserOption((opt) =>
    opt
      .setName("artist")
      .setDescription("Override: Assign specific artist instead of next in queue")
      .setRequired(false)
  );

/**
 * Inspect a user's ticket roles
 */
function inspectTicketRoles(member: GuildMember, requestedType: ArtType, ticketRoles: TicketRolesConfig) {
  const hasHeadshot = ticketRoles.headshot ? member.roles.cache.has(ticketRoles.headshot) : false;
  const hasHalfbody = ticketRoles.halfbody ? member.roles.cache.has(ticketRoles.halfbody) : false;
  const hasEmoji = ticketRoles.emoji ? member.roles.cache.has(ticketRoles.emoji) : false;
  const hasFullbody = ticketRoles.fullbody ? member.roles.cache.has(ticketRoles.fullbody) : false;

  const requestedRoleId = ticketRoles[requestedType];
  const hasRequestedType = requestedRoleId ? member.roles.cache.has(requestedRoleId) : false;

  const allTicketRoles: string[] = [];
  if (hasHeadshot) allTicketRoles.push("headshot");
  if (hasHalfbody) allTicketRoles.push("halfbody");
  if (hasEmoji) allTicketRoles.push("emoji");
  if (hasFullbody) allTicketRoles.push("fullbody");

  return {
    hasHeadshot,
    hasHalfbody,
    hasEmoji,
    hasFullbody,
    hasRequestedType,
    requestedType,
    matchingRoleId: requestedRoleId,
    allTicketRoles,
    ticketRoles, // Include for later use in building UI
  };
}

/**
 * Execute /redeemreward command
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: false });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const artType = interaction.options.getString("type", true) as ArtType;
  const overrideArtist = interaction.options.getUser("artist");

  ctx.step("fetch_member");

  // Fetch target member
  let targetMember: GuildMember;
  try {
    targetMember = await guild.members.fetch(targetUser.id);
  } catch {
    await interaction.reply({
      content: `Could not find <@${targetUser.id}> in this server.`,
      ephemeral: false,
    });
    return;
  }

  ctx.step("inspect_roles");

  // Get guild-specific ticket roles config
  const ticketRoles = getTicketRoles(guild.id);

  // Inspect ticket roles
  const ticketInfo = inspectTicketRoles(targetMember, artType, ticketRoles);

  ctx.step("get_artist");

  // Determine which artist to use
  let artistId: string;
  let artistPosition: number | null = null;
  let isOverride = false;

  if (overrideArtist) {
    // Verify override artist has Server Artist role (using guild-specific config)
    const artistRoleId = getArtistRoleId(guild.id);
    const overrideMember = await guild.members.fetch(overrideArtist.id).catch(() => null);
    if (!overrideMember?.roles.cache.has(artistRoleId)) {
      await interaction.reply({
        content: `<@${overrideArtist.id}> does not have the Server Artist role.`,
        ephemeral: false,
      });
      return;
    }
    artistId = overrideArtist.id;
    isOverride = true;

    // Get their position if in queue
    const artistInfo = getArtist(guild.id, artistId);
    artistPosition = artistInfo?.position ?? null;
  } else {
    // Get next artist from queue
    const nextArtist = getNextArtist(guild.id);
    if (!nextArtist) {
      await interaction.reply({
        content: "No artists available in queue. Run `/artistqueue sync` to populate the queue.",
        ephemeral: false,
      });
      return;
    }
    artistId = nextArtist.userId;
    artistPosition = nextArtist.position;
  }

  ctx.step("build_confirmation");

  // Generate unique ID for this confirmation flow
  const confirmId = randomUUID().slice(0, 8);

  // Build confirmation embed
  const embed = new EmbedBuilder()
    .setTitle("Art Reward Redemption")
    .setColor(ticketInfo.hasRequestedType ? 0x00cc00 : 0xffaa00);

  const descLines: string[] = [
    `**Recipient:** <@${targetUser.id}>`,
    `**Requested Type:** ${ART_TYPE_DISPLAY[artType]}`,
    "",
  ];

  // Show ticket role status
  if (ticketInfo.hasRequestedType) {
    const roleName = ticketInfo.matchingRoleId
      ? TICKET_ROLE_NAMES[ticketInfo.matchingRoleId] ?? artType
      : artType;
    descLines.push(`User has: ${roleName}`);
  } else if (ticketInfo.matchingRoleId) {
    const roleName = TICKET_ROLE_NAMES[ticketInfo.matchingRoleId] ?? artType;
    descLines.push(`User does NOT have: ${roleName}`);
  } else {
    descLines.push(`No ticket role defined for ${artType}`);
  }

  // Show other ticket roles user has
  const otherRoles = ticketInfo.allTicketRoles.filter((r) => r !== artType);
  if (otherRoles.length > 0) {
    const otherNames = otherRoles.map((r) => {
      const roleId = ticketInfo.ticketRoles[r as ArtType];
      return roleId ? (TICKET_ROLE_NAMES[roleId] ?? r) : r;
    });
    descLines.push(`*User also has: ${otherNames.join(", ")}*`);
  }

  descLines.push("");

  // Show artist info
  if (isOverride) {
    descLines.push(`**Artist (Override):** <@${artistId}>`);
    if (artistPosition) {
      descLines.push(`*Current queue position: #${artistPosition}*`);
    }
  } else {
    descLines.push(`**Next Artist:** <@${artistId}> (#${artistPosition} in queue)`);
  }

  embed.setDescription(descLines.join("\n"));

  // Warning for mismatched type
  if (!ticketInfo.hasRequestedType && ticketInfo.matchingRoleId) {
    embed.addFields({
      name: "Type Mismatch Warning",
      value: `User does not have the ${ART_TYPE_DISPLAY[artType]} ticket role. Proceed anyway?`,
    });
  }

  // Build buttons
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`redeemreward:${confirmId}:confirm:${targetUser.id}:${artType}:${artistId}:${isOverride ? "1" : "0"}`)
      .setLabel("Confirm & Assign")
      .setStyle(ticketInfo.hasRequestedType ? ButtonStyle.Success : ButtonStyle.Primary)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`redeemreward:${confirmId}:cancel`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("❌")
  );

  await interaction.reply({
    embeds: [embed],
    components: [buttons],
    ephemeral: false,
  });

  logger.info(
    {
      guildId: guild.id,
      recipientId: targetUser.id,
      artType,
      artistId,
      isOverride,
      hasTicketRole: ticketInfo.hasRequestedType,
      confirmId,
    },
    "[redeemreward] Confirmation shown"
  );
}
