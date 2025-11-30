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
import { getConfig } from "../lib/config.js";

export const data = new SlashCommandBuilder()
  .setName("poke")
  .setDescription("Ping a user across multiple category channels (owner only)")
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to poke").setRequired(true)
  );

/**
 * Fallback category IDs where pokes are sent. Used when no guild-specific
 * config is set. These represent specific organizational categories
 * (staff areas, mod channels, etc.) for the primary guild.
 *
 * Gotcha: If a category is deleted on Discord, it just silently won't
 * match any channels - no error thrown.
 *
 * To configure per-guild: /config poke add-category <category>
 */
const FALLBACK_CATEGORY_IDS = [
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

/**
 * Fallback excluded channel - typically a rules or announcements channel where
 * poke spam would be inappropriate. Used when no guild-specific config is set.
 *
 * To configure per-guild: /config poke exclude-channel <channel>
 */
const FALLBACK_EXCLUDED_CHANNEL_ID = "896958848009637929";

/**
 * getPokeConfig
 * WHAT: Returns poke category IDs and excluded channel IDs for a guild.
 * WHY: Allows per-guild configuration with fallback to hardcoded defaults.
 * PARAMS: guildId - the guild to get config for
 * RETURNS: { categoryIds: string[], excludedChannelIds: string[] }
 * DOCS: Issue #79 - docs/roadmap/079-move-poke-category-ids-to-config.md
 */
function getPokeConfig(guildId: string): { categoryIds: string[]; excludedChannelIds: string[] } {
  const cfg = getConfig(guildId);

  let categoryIds: string[];
  if (cfg?.poke_category_ids_json) {
    try {
      categoryIds = JSON.parse(cfg.poke_category_ids_json);
      if (!Array.isArray(categoryIds)) {
        logger.warn(
          { guildId, value: cfg.poke_category_ids_json },
          "[poke] Invalid poke_category_ids_json (not an array), using fallback"
        );
        categoryIds = FALLBACK_CATEGORY_IDS;
      }
    } catch {
      logger.warn(
        { guildId, value: cfg.poke_category_ids_json },
        "[poke] Failed to parse poke_category_ids_json, using fallback"
      );
      categoryIds = FALLBACK_CATEGORY_IDS;
    }
  } else {
    categoryIds = FALLBACK_CATEGORY_IDS;
  }

  let excludedChannelIds: string[];
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      excludedChannelIds = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (!Array.isArray(excludedChannelIds)) {
        logger.warn(
          { guildId, value: cfg.poke_excluded_channel_ids_json },
          "[poke] Invalid poke_excluded_channel_ids_json (not an array), using fallback"
        );
        excludedChannelIds = [FALLBACK_EXCLUDED_CHANNEL_ID];
      }
    } catch {
      logger.warn(
        { guildId, value: cfg.poke_excluded_channel_ids_json },
        "[poke] Failed to parse poke_excluded_channel_ids_json, using fallback"
      );
      excludedChannelIds = [FALLBACK_EXCLUDED_CHANNEL_ID];
    }
  } else {
    excludedChannelIds = [FALLBACK_EXCLUDED_CHANNEL_ID];
  }

  return { categoryIds, excludedChannelIds };
}

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

    // Get guild-specific poke config (falls back to hardcoded defaults)
    const pokeConfig = getPokeConfig(guild.id);
    const { categoryIds, excludedChannelIds } = pokeConfig;

    // Fetch all channels - discord.js v14 requires await on fetch()
    // Returns Collection<Snowflake, GuildBasedChannel | null> from API
    const channels = await guild.channels.fetch();

    const targetChannels = channels.filter((channel) => {
      if (!channel) return false;
      if (excludedChannelIds.includes(channel.id)) return false;
      if (channel.type !== ChannelType.GuildText) return false;
      if (!channel.parentId) return false;
      return categoryIds.includes(channel.parentId);
    });

    const successfulPokes: string[] = [];
    const failedPokes: Array<{ channelId: string; error: string }> = [];

    // Sequential iteration rather than Promise.all to avoid rate limit
    // hammering. Discord's global rate limit is 50 req/sec, but channel-specific
    // limits are lower. Sequential is slower but safer.
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
