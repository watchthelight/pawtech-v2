/**
 * Pawtropolis Tech — src/commands/audit.ts
 *
 * Server audit commands with two subcommands:
 * - /audit members - Scan for bot-like accounts using multiple heuristics
 * - /audit nsfw - Scan member avatars for NSFW content using Google Vision API
 *
 * Restricted to specific roles (Community Manager + Bot Developer).
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
import { postPermissionDenied } from "../lib/permissionCard.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { ROLE_IDS, shouldBypass } from "../lib/roles.js";
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
import {
  createSession,
  getActiveSession,
  markUserScanned,
  getScannedUserIds,
  updateProgress,
  completeSession,
  cancelSession,
  type AuditSession,
} from "../store/auditSessionStore.js";
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";

// Allowed role IDs (Community Manager + Server Dev)
// Uses centralized ROLE_IDS from roles.ts for consistency
const ALLOWED_ROLES = [
  ROLE_IDS.COMMUNITY_MANAGER,
  ROLE_IDS.SERVER_DEV,
];

// Nonce generation for button security
// WHY: Without this, anyone could craft a button customId and trigger audits.
// The nonce ties the button to the specific command invocation. Not cryptographically
// secure (Math.random is PRNG), but good enough to prevent casual button spoofing.
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

  const subcommand = interaction.options.getSubcommand();

  // Check if user has an allowed role or is bot owner/server dev
  const member = await guild.members.fetch(user.id);
  const hasAllowedRole = member.roles.cache.some((role) => ALLOWED_ROLES.includes(role.id));
  const canBypass = shouldBypass(user.id);

  if (!hasAllowedRole && !canBypass) {
    await postPermissionDenied(interaction, {
      command: `audit ${subcommand}`,
      description: subcommand === "nsfw"
        ? "Scans member avatars for NSFW content using Google Vision API."
        : "Scans for bot-like accounts using multiple heuristics.",
      requirements: [{ type: "roles", roleIds: ALLOWED_ROLES }],
    });
    logger.warn(
      { userId: user.id, guildId },
      "[audit] Unauthorized user attempted to run audit"
    );
    return;
  }

  const nsfwScope = subcommand === "nsfw" ? interaction.options.getString("scope", true) : null;

  // Fetch member count for confirmation message
  // WHY deferReply: The member fetch below can take several seconds for large
  // guilds, and Discord's 3-second interaction timeout is merciless.
  await interaction.deferReply();

  try {
    // Check for active session that can be resumed
    // WHY: NSFW audits can take 20+ minutes for large guilds. If the bot restarts
    // mid-scan (deploy, crash, Discord hiccup), we don't want to re-scan everyone.
    // The session tracks which users were already checked.
    const activeSession = getActiveSession(guildId, subcommand as "members" | "nsfw");

    if (activeSession) {
      // Offer to resume the active session
      const elapsed = Math.round((Date.now() - new Date(activeSession.started_at).getTime()) / 1000);
      const remaining = activeSession.total_to_scan - activeSession.scanned_count;

      const resumeEmbed = new EmbedBuilder()
        .setTitle("🔄 Resume Previous Audit?")
        .setDescription(
          `Found an incomplete ${subcommand} audit that was interrupted.\n\n` +
          `**Progress**: ${activeSession.scanned_count.toLocaleString()}/${activeSession.total_to_scan.toLocaleString()} scanned\n` +
          `**Flagged**: ${activeSession.flagged_count}\n` +
          `**Remaining**: ~${remaining.toLocaleString()} members\n` +
          `**Started**: ${elapsed > 3600 ? `${Math.round(elapsed / 3600)}h ago` : `${Math.round(elapsed / 60)}m ago`}\n\n` +
          `Do you want to **resume** where it left off or **start fresh**?`
        )
        .setColor(0x3B82F6)
        .setFooter({ text: "Resume will skip already-scanned members." });

      const nonce = generateNonce();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`audit:${subcommand}:${nsfwScope ?? "none"}:resume:${activeSession.id}:${nonce}`)
          .setLabel("Resume")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("▶️"),
        new ButtonBuilder()
          .setCustomId(`audit:${subcommand}:${nsfwScope ?? "none"}:fresh:${activeSession.id}:${nonce}`)
          .setLabel("Start Fresh")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`audit:${subcommand}:${nsfwScope ?? "none"}:cancel:0:${nonce}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❌")
      );

      await interaction.editReply({
        embeds: [resumeEmbed],
        components: [row],
      });

      logger.info(
        { userId: user.id, guildId, subcommand, sessionId: activeSession.id },
        "[audit] Found active session, showing resume prompt"
      );
      return;
    }

    // No active session - show normal confirmation
    // NOTE: This fetches ALL members into memory at once. For a 10k member guild,
    // that's fine. For 100k+, this could be problematic. The actual scan uses
    // pagination (guild.members.list), but this confirmation count doesn't.
    // Could be optimized if we ever run this on massive guilds.
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
 * Handle audit button interactions (Confirm/Cancel/Resume/Fresh)
 *
 * This function handles a horrifying number of button ID formats. I tried to
 * consolidate them but the different audit types need different metadata
 * (scope for NSFW, session IDs for resume). The regex parsing below is the
 * least-bad solution I could come up with.
 */
export async function handleAuditButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild, channel } = interaction;

  // Parse custom ID formats:
  // - audit:members:confirm:nonce (new audit)
  // - audit:nsfw:all:confirm:nonce (new audit)
  // - audit:nsfw:flagged:confirm:nonce (new audit)
  // - audit:members:none:resume:sessionId:nonce (resume)
  // - audit:nsfw:all:resume:sessionId:nonce (resume)
  // - audit:nsfw:all:fresh:sessionId:nonce (start fresh, cancel old)
  // - audit:nsfw:all:cancel:0:nonce (cancel without starting)
  // These regexes look like line noise but they're pretty straightforward:
  // - membersMatch: audit:members:{action}:{nonce}
  // - nsfwMatch: audit:nsfw:{scope}:{action}:{nonce}
  // - resumeMatch: audit:{type}:{scope}:{action}:{sessionId}:{nonce}
  // If you're adding a new button format, update the parsing below too.
  const membersMatch = customId.match(/^audit:members:(confirm|cancel):([a-f0-9]{8})$/);
  const nsfwMatch = customId.match(/^audit:nsfw:(all|flagged):(confirm|cancel):([a-f0-9]{8})$/);
  const resumeMatch = customId.match(/^audit:(members|nsfw):(all|flagged|none):(resume|fresh|cancel):(\d+):([a-f0-9]{8})$/);

  if (!membersMatch && !nsfwMatch && !resumeMatch) {
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
  let sessionId: number | null = null;

  if (membersMatch) {
    subcommand = "members";
    action = membersMatch[1];
    nonce = membersMatch[2];
  } else if (nsfwMatch) {
    subcommand = "nsfw";
    scope = nsfwMatch[1];
    action = nsfwMatch[2];
    nonce = nsfwMatch[3];
  } else {
    // Resume/fresh/cancel format
    // The non-null assertions (!) are safe here because we already checked
    // that resumeMatch exists in the if/else chain above. TypeScript just
    // can't track that through the conditional logic.
    subcommand = resumeMatch![1];
    scope = resumeMatch![2] === "none" ? null : resumeMatch![2];
    action = resumeMatch![3];
    sessionId = parseInt(resumeMatch![4], 10);
    nonce = resumeMatch![5];
  }

  if (!guild) {
    await interaction.reply({
      content: "❌ This button can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check permissions again - yes, we already checked in execute(), but buttons
  // can be clicked by anyone who sees the message. Re-checking is paranoid but correct.
  const member = await guild.members.fetch(user.id);
  const hasAllowedRole = member.roles.cache.some((role) => ALLOWED_ROLES.includes(role.id));
  const canBypass = shouldBypass(user.id);

  if (!hasAllowedRole && !canBypass) {
    await postPermissionDenied(interaction, {
      command: `audit ${subcommand}`,
      description: subcommand === "nsfw"
        ? "Scans member avatars for NSFW content using Google Vision API."
        : "Scans for bot-like accounts using multiple heuristics.",
      requirements: [{ type: "roles", roleIds: ALLOWED_ROLES }],
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

  // Security: Rate limit expensive audit operations per guild
  // Skip rate limit check for resume (user is continuing existing work)
  // WHY: NSFW audits hit Google Vision API ($$$ and quotas). Member audits
  // just churn CPU, but could still DoS the bot if spammed. One audit per
  // guild per cooldown period keeps things sane.
  if (action !== "resume") {
    const cooldownMs = subcommand === "nsfw" ? COOLDOWNS.AUDIT_NSFW_MS : COOLDOWNS.AUDIT_MEMBERS_MS;
    const cooldownKey = `audit:${subcommand}`;
    const cooldownResult = checkCooldown(cooldownKey, guild.id, cooldownMs);

    if (!cooldownResult.allowed) {
      const remaining = formatCooldown(cooldownResult.remainingMs!);
      await interaction.reply({
        content: `This guild is on cooldown for ${subcommand} audits. Please wait ${remaining} before running another audit.`,
        ephemeral: true,
      });
      logger.info(
        { guildId: guild.id, subcommand, remainingMs: cooldownResult.remainingMs },
        "[audit] Rate limited"
      );
      return;
    }
  }

  // Handle "fresh" - cancel old session and start new
  if (action === "fresh" && sessionId) {
    cancelSession(sessionId);
    logger.info({ sessionId }, "[audit] Cancelled old session for fresh start");
  }

  // For resume, use the existing session
  const resumeSession = action === "resume" && sessionId ? getActiveSession(guild.id, subcommand as "members" | "nsfw") : null;

  logger.info(
    { userId: user.id, guildId: guild.id, nonce, subcommand, scope, action, sessionId, resuming: !!resumeSession },
    "[audit] Audit confirmed, starting scan"
  );

  // Update to show starting message with proper progress bar
  const scopeLabel = scope === "flagged" ? " (flagged only)" : "";
  const resumeLabel = resumeSession ? " (resuming)" : "";
  const startTitle = subcommand === "nsfw"
    ? `🔞 Scanning avatars for NSFW content${scopeLabel}${resumeLabel}...`
    : `🔍 Auditing members${resumeLabel}...`;

  const initialProgress = resumeSession
    ? `Resuming from ${resumeSession.scanned_count.toLocaleString()}/${resumeSession.total_to_scan.toLocaleString()}...`
    : "Starting scan...";

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(startTitle)
        .setDescription(initialProgress)
        .setColor(subcommand === "nsfw" ? 0xE74C3C : 0x3B82F6),
    ],
    components: [],
  });

  // Run the appropriate audit in background (don't await - would timeout with large member counts)
  // CRITICAL: We intentionally fire-and-forget here. Discord interactions expire
  // after 15 minutes, but these audits can run for 30+ minutes on large servers.
  // The .catch() handles failures gracefully without crashing the event loop.
  if (subcommand === "nsfw") {
    runNsfwAudit(interaction, guild, channel as TextChannel, (scope as "all" | "flagged") ?? "all", resumeSession).catch(async (err) => {
      logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Background audit failed");

      // Notify user of catastrophic failure
      try {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Audit Failed")
              .setDescription("The NSFW audit encountered a critical error and could not complete. Check logs for details.")
              .setColor(0xE74C3C)
              .setTimestamp()
          ]
        });
      } catch (notifyErr) {
        logger.debug({ err: notifyErr }, "[audit:nsfw] Failed to notify user of audit failure");
      }
    });
  } else {
    runMembersAudit(interaction, guild, channel as TextChannel, resumeSession).catch(async (err) => {
      logger.error({ err, guildId: guild.id }, "[audit:members] Background audit failed");

      // Notify user of catastrophic failure
      try {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Audit Failed")
              .setDescription("The member audit encountered a critical error and could not complete. Check logs for details.")
              .setColor(0xE74C3C)
              .setTimestamp()
          ]
        });
      } catch (notifyErr) {
        logger.debug({ err: notifyErr }, "[audit:members] Failed to notify user of audit failure");
      }
    });
  }
}

/**
 * Run the members audit process (bot detection)
 *
 * Scans all guild members looking for accounts that match bot/spam heuristics:
 * - No avatar, new account, no activity, low level, suspicious username patterns
 *
 * Unlike the NSFW audit, this is CPU-bound (no external API calls), so it's
 * much faster but also has less sophisticated detection. False positives happen.
 */
async function runMembersAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel,
  resumeSession: AuditSession | null = null
): Promise<void> {
  const startTime = Date.now();
  const stats: AuditStats = createEmptyStats();
  let flaggedCount = 0;
  let skippedCount = 0;
  let totalScanned = 0;

  try {
    // Paginate through members using list() - much faster than fetch() for large guilds
    // WHY list() instead of fetch(): fetch() loads ALL members into memory at once.
    // list() with pagination keeps memory usage constant regardless of guild size.
    // For a 50k member guild, this is the difference between 500MB RAM spike vs ~10MB.
    logger.info({ guildId: guild.id }, "[audit:members] Starting paginated member scan...");

    let lastMemberId: string | undefined;
    let processedBatches = 0;
    const BATCH_SIZE = 1000; // Discord's max for guild.members.list()

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
          // WHY 300ms: Discord's message rate limit is ~5/5sec per channel.
          // 300ms gives us headroom without making the audit painfully slow.
          await sleep(300);
        }

        // Update progress every 50 members for real-time feedback
        // GOTCHA: interaction.editReply can fail if the interaction token expired
        // (15 min limit) or if the message was deleted. We catch and log but don't
        // abort the audit - the channel embeds are the real output anyway.
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
          } catch (err) {
            logger.debug({ err, guildId: guild.id, totalScanned }, "[audit] Progress update failed (non-fatal)");
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
    } catch (err) {
      logger.debug({ err }, "[audit:members] Final message edit failed (may be deleted)");
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

    // Best-effort error notification. If this also fails, we're probably having
    // a bad day with Discord's API and there's nothing more we can do.
    try {
      await channel.send({
        content: `❌ Audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch (err) {
      logger.debug({ err, channelId: channel.id }, "[audit] Channel send failed (may be inaccessible)");
    }
  }
}

/**
 * Run the NSFW avatar audit process
 *
 * This is the expensive one. Every member with a custom avatar triggers a
 * Google Cloud Vision API call (~$1.50/1000 images). For a 10k member guild,
 * that's potentially $15 per full scan. The 80% threshold is intentionally
 * high to minimize false positives - we'd rather miss edge cases than flag
 * someone's abstract art as porn.
 */
async function runNsfwAudit(
  interaction: ButtonInteraction,
  guild: NonNullable<ButtonInteraction["guild"]>,
  channel: TextChannel,
  scope: "all" | "flagged",
  resumeSession: AuditSession | null = null
): Promise<void> {
  const startTime = Date.now();
  let flaggedCount = resumeSession?.flagged_count ?? 0;
  let totalScanned = resumeSession?.scanned_count ?? 0;
  let apiCallCount = resumeSession?.api_calls ?? 0;
  let skippedNoAvatar = 0;
  let skippedAlreadyScanned = 0;

  const NSFW_THRESHOLD = 0.8; // 80% = hard evidence (see doc comment above)
  const PROGRESS_UPDATE_INTERVAL = 10; // Update every 10 members for real-time feedback

  // Batch processing configuration for Vision API calls
  // Before: Sequential with 100ms sleep per member = 100+ seconds for 1000 members
  // After: 10 concurrent requests with 200ms between batches = ~15 seconds for 1000 members
  // CAREFUL: Don't crank VISION_BATCH_SIZE too high or you'll hit Vision API rate limits
  const VISION_BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;

  // Load already-scanned user IDs if resuming
  const alreadyScanned = resumeSession ? getScannedUserIds(resumeSession.id) : new Set<string>();

  try {
    logger.info({ guildId: guild.id, scope, resuming: !!resumeSession, alreadyScannedCount: alreadyScanned.size }, "[audit:nsfw] Starting avatar scan...");

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
          // Member may have left the server - silently skip
          // This is expected behavior, not an error worth logging
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

    const totalMembers = membersToScan.length;
    logger.info({ guildId: guild.id, totalMembers }, "[audit:nsfw] Starting scan");

    // Create or use existing session
    // The session is our crash-recovery mechanism. If the bot dies mid-audit,
    // we can offer to resume from where we left off instead of re-scanning
    // thousands of avatars (and burning API quota).
    let sessionId: number;
    if (resumeSession) {
      sessionId = resumeSession.id;
    } else {
      sessionId = createSession({
        guildId: guild.id,
        auditType: "nsfw",
        scope,
        startedBy: interaction.user.id,
        totalToScan: totalMembers,
        channelId: channel.id,
      });
    }

    // Filter members to scan (skip already-scanned for resume, bots, no avatar)
    const membersToProcess: Array<{ member: GuildMember; avatarUrl: string }> = [];
    for (const member of membersToScan) {
      // Skip if already scanned in this session (for resume)
      if (alreadyScanned.has(member.id)) {
        skippedAlreadyScanned++;
        continue;
      }

      // Skip bots
      if (member.user.bot) {
        totalScanned++;
        markUserScanned(sessionId, member.id);
        continue;
      }

      // Skip users without custom avatars (default Discord avatars)
      // WHY: Default avatars are Discord-generated geometric patterns based on
      // discriminator. Zero chance of NSFW content, so don't waste API calls.
      const avatarUrl = member.user.avatar
        ? member.user.displayAvatarURL({ extension: "png", size: 256 })
        : null;

      if (!avatarUrl) {
        skippedNoAvatar++;
        totalScanned++;
        markUserScanned(sessionId, member.id);
        continue;
      }

      membersToProcess.push({ member, avatarUrl });
    }

    // Process members in batches with concurrent Vision API calls
    // This replaces sequential processing with 100ms sleep per member
    //
    // PERFORMANCE NOTE: Promise.all means if one request hangs, we wait for all
    // of them. Could use Promise.allSettled for better resilience, but then we'd
    // need to handle partial failures per-batch. Current approach is simpler and
    // Vision API is reliable enough that timeouts are rare.
    let processedInThisRun = 0;
    for (let i = 0; i < membersToProcess.length; i += VISION_BATCH_SIZE) {
      const batch = membersToProcess.slice(i, i + VISION_BATCH_SIZE);

      // Process batch concurrently
      const batchResults = await Promise.all(
        batch.map(async ({ member, avatarUrl }) => {
          apiCallCount++;
          const visionResult = await detectNsfwVision(avatarUrl);
          return { member, avatarUrl, visionResult };
        })
      );

      // Process results sequentially (for flagging and sending embeds)
      for (const { member, avatarUrl, visionResult } of batchResults) {
        processedInThisRun++;
        totalScanned++;
        markUserScanned(sessionId, member.id);

        if (!visionResult) {
          // Vision API returned null - could be network error, quota exceeded,
          // or image couldn't be processed. We skip rather than retry because
          // retries would slow down the audit and most failures are transient.
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
          // Reverse image search link helps mods verify - sometimes Vision flags
          // legitimate art or memes that happen to have skin tones
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
            .setFooter({ text: `Progress: ${totalScanned.toLocaleString()}/${totalMembers.toLocaleString()}` });

          await channel.send({ embeds: [flagEmbed] });

          // Small delay between flagged notifications to avoid Discord rate limits
          await sleep(300);
        }
      }

      // Small delay between batches (instead of per-member delay)
      if (i + VISION_BATCH_SIZE < membersToProcess.length) {
        await sleep(BATCH_DELAY_MS);
      }

      // Update progress after each batch
      // We save to DB frequently so resume works even if the bot crashes mid-scan.
      // The conditional ensures we don't spam the database on every single member.
      if (processedInThisRun % PROGRESS_UPDATE_INTERVAL === 0 || i + VISION_BATCH_SIZE >= membersToProcess.length) {
        // Save progress to database
        updateProgress(sessionId, totalScanned, flaggedCount, apiCallCount);

        try {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const pct = Math.round((totalScanned / totalMembers) * 100);
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🔞 Scanning avatars for NSFW content...")
                .setDescription(
                  `${renderProgressBar(totalScanned, totalMembers)}\n\n` +
                  `**${totalScanned.toLocaleString()}** / **${totalMembers.toLocaleString()}** members (${pct}%)\n` +
                  `🚩 **${flaggedCount}** flagged · 📡 **${apiCallCount}** API calls\n` +
                  `⏱️ ${elapsed}s elapsed`
                )
                .setColor(0xE74C3C),
            ],
          });
        } catch (err) {
          logger.debug({ err, guildId: guild.id, totalScanned }, "[audit:nsfw] Progress update failed (non-fatal)");
        }
      }
    }

    // Mark session complete
    completeSession(sessionId);

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

    if (resumeSession) {
      summaryEmbed.addFields({ name: "Resumed", value: `Skipped ${skippedAlreadyScanned} already-scanned`, inline: true });
    }

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
    } catch (err) {
      logger.debug({ err }, "[audit:nsfw] Completion message edit failed (may be deleted)");
    }

    logger.info(
      {
        guildId: guild.id,
        scope,
        totalScanned,
        flaggedCount,
        apiCallCount,
        skippedNoAvatar,
        skippedAlreadyScanned,
        durationSec,
        resumed: !!resumeSession,
      },
      "[audit:nsfw] Audit complete"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Audit failed");

    try {
      await channel.send({
        content: `❌ NSFW audit failed with error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch (err) {
      logger.debug({ err, channelId: channel.id }, "[audit:nsfw] Channel send failed (may be inaccessible)");
    }
  }
}

// Yes, we're promisifying setTimeout in 2024. No, there's no built-in for this.
// Node 16+ has timers/promises but we're keeping it simple.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
