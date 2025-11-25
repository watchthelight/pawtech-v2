/**
 * Pawtropolis Tech — src/commands/poke.ts
 * WHAT: Owner-only /poke command to ping a user across multiple category channels.
 * WHY: Allows owners to get attention from specific users across designated categories.
 * FLOWS:
 *  - Verify owner permission → fetch channels from specified categories → send poke messages
 * DOCS:
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { isOwner } from "../utils/owner.js";
import { logger } from "../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("poke")
  .setDescription("Ping a user across multiple category channels (owner only)")
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to poke").setRequired(true)
  );

// Category IDs to include (all channels in these categories will receive pokes)
const POKE_CATEGORY_IDS = [
  "896070891539169316",
  "1393461646718140436",
  "896070891174260765",
  "1432302478723911781",
  "1210760381946007632",
  "1212353807208685598",
  "899667519105814619",
  "1400346492321009816",
  "896070889462976607",
  "1438539749668425836",
];

// Channel ID to exclude from pokes
const EXCLUDED_CHANNEL_ID = "896958848009637929";

/**
 * execute
 * WHAT: Sends poke messages to all channels in specified categories (except excluded channel).
 * WHY: Allows owners to get user attention across multiple channels.
 * RETURNS: Promise<void>
 * THROWS: Errors are caught by wrapCommand upstream.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Check if user is an owner
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "❌ This command is only available to bot owners.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);

  await withStep(ctx, "defer_reply", async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  });

  const results = await withStep(ctx, "send_pokes", async () => {
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("This command can only be used in a guild");
    }

    const channels = await guild.channels.fetch();
    const targetChannels = channels.filter((channel) => {
      if (!channel) return false;
      if (channel.id === EXCLUDED_CHANNEL_ID) return false;
      if (channel.type !== ChannelType.GuildText) return false;
      if (!channel.parentId) return false;
      return POKE_CATEGORY_IDS.includes(channel.parentId);
    });

    const successfulPokes: string[] = [];
    const failedPokes: Array<{ channelId: string; error: string }> = [];

    for (const [channelId, channel] of targetChannels) {
      try {
        if (channel && channel.isTextBased()) {
          await channel.send(`<@${targetUser.id}> *poke*`);
          successfulPokes.push(channelId);
          logger.info(
            {
              evt: "poke_sent",
              channelId,
              targetUserId: targetUser.id,
              executorId: interaction.user.id,
            },
            "Poke message sent"
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        failedPokes.push({ channelId, error: errorMsg });
        logger.error(
          {
            err: error,
            channelId,
            targetUserId: targetUser.id,
            executorId: interaction.user.id,
          },
          "Failed to send poke message"
        );
      }
    }

    return { successfulPokes, failedPokes, totalChannels: targetChannels.size };
  });

  await withStep(ctx, "reply", async () => {
    const embed = new EmbedBuilder()
      .setTitle("Poke Results")
      .setColor(results.failedPokes.length > 0 ? 0xfee75c : 0x57f287)
      .addFields(
        {
          name: "Target User",
          value: `<@${targetUser.id}> (${targetUser.tag})`,
          inline: false,
        },
        {
          name: "Channels Found",
          value: `${results.totalChannels}`,
          inline: true,
        },
        {
          name: "Successful Pokes",
          value: `${results.successfulPokes.length}`,
          inline: true,
        },
        {
          name: "Failed Pokes",
          value: `${results.failedPokes.length}`,
          inline: true,
        }
      )
      .setTimestamp();

    if (results.failedPokes.length > 0) {
      const failedList = results.failedPokes
        .slice(0, 5)
        .map((f) => `<#${f.channelId}>: ${f.error}`)
        .join("\n");
      embed.addFields({
        name: "Failed Channels (first 5)",
        value: failedList || "None",
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  });
}
