/**
 * Pawtropolis Tech — src/commands/audit.ts
 *
 * Bot account audit command. Crawls all server members and flags suspicious
 * accounts using multiple heuristics (no avatar, new account, no activity,
 * low level, bot-like username patterns).
 *
 * Restricted to specific user IDs (Community Manager + Bot Developer).
 * Shows live progress updates and a final summary.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import {
  analyzeMember,
  renderProgressBar,
  createEmptyStats,
  updateStats,
  MAX_SCORE,
  type AuditStats,
} from "../features/botDetection.js";
import { isAlreadyFlagged, upsertManualFlag } from "../store/flagsStore.js";

// Allowed user IDs (Community Manager + Bot Developer)
const ALLOWED_USERS = [
  "1190093021170114680", // Community Manager
  "1120074045883420753", // Bot Developer
];

// Nonce generation for button security
function generateNonce(): string {
  return Math.random().toString(16).slice(2, 10);
}

export const data = new SlashCommandBuilder()
  .setName("audit")
  .setDescription("Audit server members for bot-like accounts");

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId, guild, user, channel } = interaction;

  if (!guildId || !guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check if user is allowed
  if (!ALLOWED_USERS.includes(user.id)) {
    await interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
    logger.warn(
      { userId: user.id, guildId },
      "[audit] Unauthorized user attempted to run audit"
    );
    return;
  }

  // Fetch member count for confirmation message
  await interaction.deferReply();

  try {
    // Fetch all members to get accurate count
    const members = await guild.members.fetch();
    const memberCount = members.size;

    const nonce = generateNonce();

    // Build confirmation embed
    const confirmEmbed = new EmbedBuilder()
      .setTitle("⚠️ Member Audit")
      .setDescription(
        `This will scan **${memberCount.toLocaleString()}** server members and flag suspicious accounts.\n\n` +
        `This may send many messages. Are you sure?`
      )
      .setColor(0xFBBF24) // Amber warning color
      .setFooter({ text: "This action cannot be easily undone." });

    // Build action row with Confirm/Cancel buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit:confirm:${nonce}`)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setCustomId(`audit:cancel:${nonce}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    await interaction.editReply({
      embeds: [confirmEmbed],
      components: [row],
    });

    logger.info(
      { userId: user.id, guildId, memberCount, nonce },
      "[audit] Confirmation prompt sent"
    );
  } catch (err) {
    logger.error({ err, guildId }, "[audit] Failed to fetch members for confirmation");
    await interaction.editReply({
      content: "❌ Failed to fetch server members. Please try again.",
    });
  }
}

/**
 * Handle audit button interactions (Confirm/Cancel)
 */
export async function handleAuditButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild, channel } = interaction;

  // Parse custom ID: audit:action:nonce
  const match = customId.match(/^audit:(confirm|cancel):([a-f0-9]{8})$/);
  if (!match) {
    logger.warn({ customId }, "[audit] Invalid button custom ID format");
    await interaction.reply({
      content: "❌ Invalid button ID format.",
      ephemeral: true,
    });
    return;
  }

  const [, action, nonce] = match;

  // Check permissions again
  if (!ALLOWED_USERS.includes(user.id)) {
    await interaction.reply({
      content: "❌ You don't have permission to use this button.",
      ephemeral: true,
    });
    return;
  }

  if (!guild) {
    await interaction.reply({
      content: "❌ This button can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  if (action === "cancel") {
    // Disable buttons and update message
    await interaction.update({
      content: "❌ Audit cancelled.",
      embeds: [],
      components: [],
    });
    logger.info({ userId: user.id, guildId: guild.id }, "[audit] Audit cancelled by user");
    return;
  }

  // action === "confirm"
  logger.info(
    { userId: user.id, guildId: guild.id, nonce },
    "[audit] Audit confirmed, starting scan"
  );

  // Update to show starting message
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔍 Auditing members...")
        .setDescription(renderProgressBar(0, 1))
        .setColor(0x3B82F6), // Blue
    ],
    components: [],
  });

  // Run the audit
  await runAudit(interaction, guild, channel as TextChannel);
}

/**
 * Run the actual audit process
 */
async function runAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel
): Promise<void> {
  const startTime = Date.now();
  const stats: AuditStats = createEmptyStats();
  let flaggedCount = 0;
  let skippedCount = 0;

  try {
    // Fetch all members
    const members = await guild.members.fetch();
    const total = members.size;
    const membersArray = Array.from(members.values());

    logger.info({ guildId: guild.id, total }, "[audit] Starting member scan");

    // Update progress message reference
    const progressMessage = await interaction.fetchReply();

    // Process members
    let index = 0;
    for (const member of membersArray) {
      index++;

      // Skip bots
      if (member.user.bot) {
        continue;
      }

      // Skip already flagged users
      if (isAlreadyFlagged(guild.id, member.user.id)) {
        skippedCount++;
        continue;
      }

      // Analyze member
      const result = analyzeMember(member, guild.id);

      if (result.shouldFlag) {
        // Flag the user
        const joinedAtSec = member.joinedTimestamp
          ? Math.floor(member.joinedTimestamp / 1000)
          : null;

        upsertManualFlag({
          guildId: guild.id,
          userId: member.user.id,
          reason: `[Audit] ${result.reasons.join(", ")}`,
          flaggedBy: interaction.user.id,
          joinedAt: joinedAtSec,
        });

        flaggedCount++;
        updateStats(stats, result.reasons);

        // Send flag embed to channel
        const flagEmbed = new EmbedBuilder()
          .setTitle(`🚨 Suspicious Account Detected [${index}/${total}]`)
          .setColor(0xED4245) // Red
          .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
          .addFields(
            { name: "User", value: `${member} (\`${member.id}\`)`, inline: true },
            { name: "Score", value: `${result.score}/${MAX_SCORE}`, inline: true },
            { name: "Flags", value: result.reasons.map((r) => `• ${r}`).join("\n") || "None" }
          )
          .setFooter({ text: renderProgressBar(index, total) });

        await channel.send({ embeds: [flagEmbed] });

        // Small delay to avoid rate limits
        await sleep(500);
      }

      // Update progress every 100 members
      if (index % 100 === 0) {
        try {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🔍 Auditing members...")
                .setDescription(renderProgressBar(index, total))
                .setColor(0x3B82F6),
            ],
          });
        } catch {
          // Ignore errors updating progress (may have been deleted)
        }
      }
    }

    // Calculate duration
    const durationSec = Math.round((Date.now() - startTime) / 1000);

    // Send summary embed
    const summaryEmbed = new EmbedBuilder()
      .setTitle("✅ Audit Complete")
      .setColor(0x57F287) // Green
      .addFields(
        { name: "Members Scanned", value: total.toLocaleString(), inline: true },
        { name: "Flagged", value: flaggedCount.toString(), inline: true },
        { name: "Already Flagged", value: skippedCount.toString(), inline: true },
        { name: "Duration", value: `${durationSec}s`, inline: true },
        {
          name: "Detection Breakdown",
          value:
            `• No avatar: ${stats.noAvatar}\n` +
            `• New accounts (<7d): ${stats.newAccount}\n` +
            `• No activity: ${stats.noActivity}\n` +
            `• Low level (<5): ${stats.lowLevel}\n` +
            `• Bot usernames: ${stats.botUsername}`,
        }
      )
      .setTimestamp();

    await channel.send({ embeds: [summaryEmbed] });

    // Update original progress message to show complete
    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Audit Complete")
            .setDescription(`Scanned ${total.toLocaleString()} members, flagged ${flaggedCount}.`)
            .setColor(0x57F287),
        ],
      });
    } catch {
      // Ignore - message may have been deleted
    }

    logger.info(
      {
        guildId: guild.id,
        total,
        flaggedCount,
        skippedCount,
        durationSec,
        stats,
      },
      "[audit] Audit complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "[audit] Audit failed");

    await channel.send({
      content: `❌ Audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
