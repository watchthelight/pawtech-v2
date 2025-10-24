// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type TextChannel,
} from "discord.js";
import { logger } from "./logger.js";
import { replyOrEdit } from "./cmdWrap.js";

export type GateConfigCardData = {
  reviewChannelId: string;
  gateChannelId: string;
  generalChannelId: string;
  unverifiedChannelId?: string | null;
  acceptedRoleId: string;
  reviewerRoleId: string | null;
};

export async function postGateConfigCard(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  cfg: GateConfigCardData,
  questionCount: number,
  postChannelId?: string
): Promise<void> {
  const targetChannelId = postChannelId ?? cfg.reviewChannelId;

  const channel = await guild.channels.fetch(targetChannelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error(`Channel ${targetChannelId} is not a valid text channel`);
  }
  const textChannel = channel as TextChannel;

  const reviewerRoleValue = cfg.reviewerRoleId
    ? `<@&${cfg.reviewerRoleId}>`
    : "(not set → using review channel visibility)";

  const unverifiedChannelValue = cfg.unverifiedChannelId
    ? `<#${cfg.unverifiedChannelId}>`
    : "not set";

  const embed = new EmbedBuilder()
    .setTitle("Pawtropolis Tech — Gate Configuration")
    .setDescription("Current gate configuration for this server.")
    .setColor(0x5865f2)
    .addFields(
      { name: "Review Channel", value: `<#${cfg.reviewChannelId}>`, inline: true },
      { name: "Gate Channel", value: `<#${cfg.gateChannelId}>`, inline: true },
      { name: "General Channel", value: `<#${cfg.generalChannelId}>`, inline: true },
      { name: "Unverified Channel", value: unverifiedChannelValue, inline: true },
      { name: "Accepted Role", value: `<@&${cfg.acceptedRoleId}>`, inline: true },
      { name: "Reviewer Role", value: reviewerRoleValue, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: `Guild ID: ${guild.id}` });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open Review")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guild.id}/${cfg.reviewChannelId}`),
    new ButtonBuilder()
      .setLabel("Open Gate")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guild.id}/${cfg.gateChannelId}`),
    new ButtonBuilder()
      .setLabel("Open General")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guild.id}/${cfg.generalChannelId}`)
  );

  const message = await textChannel.send({
    embeds: [embed],
    components: [buttons],
    allowedMentions: { parse: [] },
  });

  let pinned = false;
  try {
    if (!message.pinned) {
      await message.pin();
      pinned = true;
    }
  } catch (err) {
    logger.warn(
      { err, channelId: textChannel.id, messageId: message.id },
      "Failed to pin config card"
    );
  }

  const messageUrl = `https://discord.com/channels/${guild.id}/${textChannel.id}/${message.id}`;
  // Ephemeral ack with link back to the posted card; keeps command output private.
  await replyOrEdit(interaction, {
    content: `✅ Configuration card posted${pinned ? " and pinned" : ""}: ${messageUrl}\n\nQuestions found: ${questionCount}`,
  });
}
