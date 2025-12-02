/**
 * Pawtropolis Tech — src/commands/audit.ts
 *
 * Server audit commands with two subcommands:
 * - /audit members - Scan for bot-like accounts using multiple heuristics
 * - /audit nsfw - Scan member avatars for NSFW content using Google Vision API
 *
 * Restricted to specific roles (Community Manager + Bot Developer).
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
  type Guild,
  type GuildMember,
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
import { isAlreadyFlagged, upsertManualFlag, getFlaggedUserIds } from "../store/flagsStore.js";
import { detectNsfwVision } from "../features/googleVision.js";
import { upsertNsfwFlag } from "../store/nsfwFlagsStore.js";
import { googleReverseImageUrl } from "../ui/reviewCard.js";

// Allowed role IDs (Community Manager + Bot Developer)
const ALLOWED_ROLES = [
  "1190093021170114680", // Community Manager
  "1120074045883420753", // Bot Developer
];

// Nonce generation for button security
function generateNonce(): string {
  return Math.random().toString(16).slice(2, 10);
}

export const data = new SlashCommandBuilder()
  .setName("audit")
  .setDescription("Server audit commands")
  .addSubcommand((sub) =>
    sub.setName("members").setDescription("Scan for bot-like accounts")
  )
  .addSubcommand((sub) =>
    sub
      .setName("nsfw")
      .setDescription("Scan member avatars for NSFW content")
      .addStringOption((opt) =>
        opt
          .setName("scope")
          .setDescription("Which members to scan")
          .setRequired(true)
          .addChoices(
            { name: "All members", value: "all" },
            { name: "Flagged members only", value: "flagged" }
          )
      )
  );

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

  // Check if user has an allowed role
  const member = await guild.members.fetch(user.id);
  const hasAllowedRole = member.roles.cache.some((role) => ALLOWED_ROLES.includes(role.id));

  if (!hasAllowedRole) {
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

  const subcommand = interaction.options.getSubcommand();
  const nsfwScope = subcommand === "nsfw" ? interaction.options.getString("scope", true) : null;

  // Fetch member count for confirmation message
  await interaction.deferReply();

  try {
    // Fetch all members to get accurate count
    const members = await guild.members.fetch();
    const memberCount = members.size;

    // For NSFW flagged scope, count flagged members
    let targetCount = memberCount;
    if (nsfwScope === "flagged") {
      const flaggedMembers = getFlaggedUserIds(guildId);
      targetCount = flaggedMembers.length;
    }

    const nonce = generateNonce();

    // Build confirmation embed based on subcommand
    let confirmEmbed: EmbedBuilder;
    if (subcommand === "nsfw") {
      const scopeLabel = nsfwScope === "flagged" ? "flagged" : "all";
      confirmEmbed = new EmbedBuilder()
        .setTitle("⚠️ NSFW Avatar Audit")
        .setDescription(
          `This will scan **${targetCount.toLocaleString()}** ${scopeLabel} member avatars for NSFW content using Google Vision API.\n\n` +
          `**Scope**: ${nsfwScope === "flagged" ? "Flagged members only" : "All members"}\n` +
          `**Threshold**: 80%+ (Hard Evidence)\n` +
          `**Note**: This will make API calls for each member with an avatar.\n\n` +
          `This may send many messages. Are you sure?`
        )
        .setColor(0xE74C3C) // Red for NSFW
        .setFooter({ text: "Flagged users will need manual review." });
    } else {
      confirmEmbed = new EmbedBuilder()
        .setTitle("⚠️ Member Audit")
        .setDescription(
          `This will scan **${memberCount.toLocaleString()}** server members and flag suspicious accounts.\n\n` +
          `This may send many messages. Are you sure?`
        )
        .setColor(0xFBBF24) // Amber warning color
        .setFooter({ text: "This action cannot be easily undone." });
    }

    // Build action row with Confirm/Cancel buttons (include subcommand and scope in customId)
    const customIdBase = nsfwScope ? `audit:${subcommand}:${nsfwScope}` : `audit:${subcommand}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${customIdBase}:confirm:${nonce}`)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setCustomId(`${customIdBase}:cancel:${nonce}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    await interaction.editReply({
      embeds: [confirmEmbed],
      components: [row],
    });

    logger.info(
      { userId: user.id, guildId, memberCount, targetCount, nonce, subcommand, nsfwScope },
      "[audit] Confirmation prompt sent"
    );
  } catch (err) {
    logger.error({ err, guildId, subcommand }, "[audit] Failed to fetch members for confirmation");
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

  // Parse custom ID formats:
  // - audit:members:confirm:nonce
  // - audit:nsfw:all:confirm:nonce
  // - audit:nsfw:flagged:confirm:nonce
  const membersMatch = customId.match(/^audit:members:(confirm|cancel):([a-f0-9]{8})$/);
  const nsfwMatch = customId.match(/^audit:nsfw:(all|flagged):(confirm|cancel):([a-f0-9]{8})$/);

  if (!membersMatch && !nsfwMatch) {
    logger.warn({ customId }, "[audit] Invalid button custom ID format");
    await interaction.reply({
      content: "❌ Invalid button ID format.",
      ephemeral: true,
    });
    return;
  }

  let subcommand: string;
  let action: string;
  let nonce: string;
  let scope: string | null = null;

  if (membersMatch) {
    subcommand = "members";
    action = membersMatch[1];
    nonce = membersMatch[2];
  } else {
    subcommand = "nsfw";
    scope = nsfwMatch![1];
    action = nsfwMatch![2];
    nonce = nsfwMatch![3];
  }

  if (!guild) {
    await interaction.reply({
      content: "❌ This button can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check permissions again
  const member = await guild.members.fetch(user.id);
  const hasAllowedRole = member.roles.cache.some((role) => ALLOWED_ROLES.includes(role.id));

  if (!hasAllowedRole) {
    await interaction.reply({
      content: "❌ You don't have permission to use this button.",
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
    logger.info({ userId: user.id, guildId: guild.id, subcommand }, "[audit] Audit cancelled by user");
    return;
  }

  // action === "confirm"
  logger.info(
    { userId: user.id, guildId: guild.id, nonce, subcommand, scope },
    "[audit] Audit confirmed, starting scan"
  );

  // Update to show starting message
  const scopeLabel = scope === "flagged" ? " (flagged only)" : "";
  const startTitle = subcommand === "nsfw" ? `🔞 Scanning avatars for NSFW content${scopeLabel}...` : "🔍 Auditing members...";
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(startTitle)
        .setDescription(renderProgressBar(0, 1))
        .setColor(subcommand === "nsfw" ? 0xE74C3C : 0x3B82F6),
    ],
    components: [],
  });

  // Run the appropriate audit in background (don't await - would timeout with large member counts)
  if (subcommand === "nsfw") {
    runNsfwAudit(interaction, guild, channel as TextChannel, scope as "all" | "flagged").catch((err) => {
      logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Background audit failed");
    });
  } else {
    runMembersAudit(interaction, guild, channel as TextChannel).catch((err) => {
      logger.error({ err, guildId: guild.id }, "[audit:members] Background audit failed");
    });
  }
}

/**
 * Run the members audit process (bot detection)
 */
async function runMembersAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel
): Promise<void> {
  const startTime = Date.now();
  const stats: AuditStats = createEmptyStats();
  let flaggedCount = 0;
  let skippedCount = 0;
  let totalScanned = 0;

  try {
    // Paginate through members using list() - much faster than fetch() for large guilds
    logger.info({ guildId: guild.id }, "[audit:members] Starting paginated member scan...");

    let lastMemberId: string | undefined;
    let processedBatches = 0;
    const BATCH_SIZE = 1000;

    // Process members in batches
    while (true) {
      const batch = await guild.members.list({
        limit: BATCH_SIZE,
        after: lastMemberId,
      });

      if (batch.size === 0) break;

      processedBatches++;
      logger.info({
        guildId: guild.id,
        batchNumber: processedBatches,
        batchSize: batch.size,
        totalSoFar: totalScanned + batch.size,
      }, "[audit:members] Processing batch");

      for (const member of batch.values()) {
        totalScanned++;
        lastMemberId = member.id;

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
            .setTitle(`🚨 Suspicious Account [${flaggedCount}]`)
            .setColor(0xED4245) // Red
            .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
            .addFields(
              { name: "User", value: `${member} (\`${member.id}\`)`, inline: true },
              { name: "Score", value: `${result.score}/${MAX_SCORE}`, inline: true },
              { name: "Flags", value: result.reasons.map((r) => `• ${r}`).join("\n") || "None" }
            )
            .setFooter({ text: `Scanned: ${totalScanned.toLocaleString()} members` });

          await channel.send({ embeds: [flagEmbed] });

          // Small delay to avoid rate limits
          await sleep(300);
        }

        // Update progress every 50 members for real-time feedback
        if (totalScanned % 50 === 0) {
          try {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            await interaction.editReply({
              embeds: [
                new EmbedBuilder()
                  .setTitle("🔍 Auditing members...")
                  .setDescription(
                    `**${totalScanned.toLocaleString()}** members scanned\n` +
                    `**${flaggedCount}** flagged · **${skippedCount}** already flagged\n` +
                    `⏱️ ${elapsed}s elapsed`
                  )
                  .setColor(0x3B82F6),
              ],
            });
          } catch {
            // Ignore errors updating progress
          }
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
        { name: "Members Scanned", value: totalScanned.toLocaleString(), inline: true },
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
            .setDescription(`Scanned ${totalScanned.toLocaleString()} members, flagged ${flaggedCount}.`)
            .setColor(0x57F287),
        ],
      });
    } catch {
      // Ignore - message may have been deleted
    }

    logger.info(
      {
        guildId: guild.id,
        totalScanned,
        flaggedCount,
        skippedCount,
        durationSec,
        stats,
      },
      "[audit:members] Audit complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "[audit:members] Audit failed");

    try {
      await channel.send({
        content: `❌ Audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch {
      // Channel might not be accessible
    }
  }
}

/**
 * Run the NSFW avatar audit process
 */
async function runNsfwAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel,
  scope: "all" | "flagged"
): Promise<void> {
  const startTime = Date.now();
  let flaggedCount = 0;
  let totalScanned = 0;
  let apiCallCount = 0;
  let skippedNoAvatar = 0;

  const NSFW_THRESHOLD = 0.8; // 80% = hard evidence

  try {
    logger.info({ guildId: guild.id, scope }, "[audit:nsfw] Starting avatar scan...");

    // Collect members to scan based on scope
    const membersToScan: GuildMember[] = [];

    if (scope === "flagged") {
      // Get flagged user IDs and fetch those members
      const flaggedUserIds = getFlaggedUserIds(guild.id);
      logger.info({ guildId: guild.id, flaggedCount: flaggedUserIds.length }, "[audit:nsfw] Fetching flagged members");

      for (const userId of flaggedUserIds) {
        try {
          const member = await guild.members.fetch(userId);
          membersToScan.push(member);
        } catch {
          // Member may have left the server
        }
      }
    } else {
      // Paginate through all members
      let lastMemberId: string | undefined;
      let processedBatches = 0;
      const BATCH_SIZE = 1000;

      while (true) {
        const batch = await guild.members.list({
          limit: BATCH_SIZE,
          after: lastMemberId,
        });

        if (batch.size === 0) break;

        processedBatches++;
        logger.info({
          guildId: guild.id,
          batchNumber: processedBatches,
          batchSize: batch.size,
        }, "[audit:nsfw] Fetching batch");

        for (const member of batch.values()) {
          membersToScan.push(member);
          lastMemberId = member.id;
        }
      }
    }

    logger.info({ guildId: guild.id, totalMembers: membersToScan.length }, "[audit:nsfw] Starting scan");

    // Process collected members
    for (const member of membersToScan) {
      totalScanned++;

      // Skip bots
      if (member.user.bot) {
        continue;
      }

      // Skip users without custom avatars (default Discord avatars)
      const avatarUrl = member.user.avatar
        ? member.user.displayAvatarURL({ extension: "png", size: 256 })
        : null;

      if (!avatarUrl) {
        skippedNoAvatar++;
        continue;
      }

      // Call Google Vision API
      apiCallCount++;
      const visionResult = await detectNsfwVision(avatarUrl);

      if (!visionResult) {
        // API call failed or disabled, continue to next member
        continue;
      }

      // Check if adult score meets threshold
      if (visionResult.adultScore >= NSFW_THRESHOLD) {
        // Flag the user
        upsertNsfwFlag({
          guildId: guild.id,
          userId: member.user.id,
          avatarUrl,
          nsfwScore: visionResult.adultScore,
          reason: "hard_evidence",
          flaggedBy: interaction.user.id,
        });

        flaggedCount++;

        // Send flag embed to channel
        const reverseSearchUrl = googleReverseImageUrl(avatarUrl);
        const flagEmbed = new EmbedBuilder()
          .setTitle(`🔞 NSFW Avatar Detected [${flaggedCount}]`)
          .setColor(0xE74C3C) // Dark red
          .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
          .addFields(
            { name: "User", value: `${member} (\`${member.id}\`)`, inline: true },
            { name: "Score", value: `${Math.round(visionResult.adultScore * 100)}%`, inline: true },
            { name: "Classification", value: "Hard Evidence (Adult Content)" },
            { name: "Avatar", value: `[Reverse Image Search](${reverseSearchUrl})` }
          )
          .setFooter({ text: `Scanned: ${totalScanned.toLocaleString()} members` });

        await channel.send({ embeds: [flagEmbed] });

        // Small delay to avoid rate limits
        await sleep(300);
      }

      // Small delay between API calls to avoid rate limiting
      await sleep(100);

      // Update progress every 50 members
      if (totalScanned % 50 === 0) {
        try {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🔞 Scanning avatars for NSFW content...")
                .setDescription(
                  `**${totalScanned.toLocaleString()}** members scanned\n` +
                  `**${flaggedCount}** flagged · **${apiCallCount}** API calls\n` +
                  `⏱️ ${elapsed}s elapsed`
                )
                .setColor(0xE74C3C),
            ],
          });
        } catch {
          // Ignore errors updating progress
        }
      }
    }

    // Calculate duration
    const durationSec = Math.round((Date.now() - startTime) / 1000);

    // Send summary embed
    const scopeDesc = scope === "flagged" ? "Flagged members only" : "All members";
    const summaryEmbed = new EmbedBuilder()
      .setTitle("✅ NSFW Audit Complete")
      .setColor(0x57F287) // Green
      .addFields(
        { name: "Scope", value: scopeDesc, inline: true },
        { name: "Avatars Scanned", value: totalScanned.toLocaleString(), inline: true },
        { name: "NSFW Flagged", value: flaggedCount.toString(), inline: true },
        { name: "No Avatar", value: skippedNoAvatar.toString(), inline: true },
        { name: "Duration", value: `${durationSec}s`, inline: true },
        { name: "API Calls", value: apiCallCount.toString(), inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [summaryEmbed] });

    // Update original progress message to show complete
    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ NSFW Audit Complete")
            .setDescription(`Scanned ${totalScanned.toLocaleString()} avatars, flagged ${flaggedCount}.`)
            .setColor(0x57F287),
        ],
      });
    } catch {
      // Ignore - message may have been deleted
    }

    logger.info(
      {
        guildId: guild.id,
        scope,
        totalScanned,
        flaggedCount,
        apiCallCount,
        skippedNoAvatar,
        durationSec,
      },
      "[audit:nsfw] Audit complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Audit failed");

    try {
      await channel.send({
        content: `❌ NSFW audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch {
      // Channel might not be accessible
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
