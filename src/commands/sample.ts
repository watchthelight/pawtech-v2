/**
 * /sample command - Preview review cards and other UI components
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { ulid } from "ulid";
import {
  buildReviewEmbed,
  buildActionRows,
  type ReviewCardApplication,
  type ReviewClaimRow,
  type AvatarScanRow,
} from "../ui/reviewCard.js";
import {
  SAMPLE_ANSWERS_STANDARD,
  SAMPLE_ANSWERS_LONG,
  SAMPLE_ANSWERS_REJECTED,
  SAMPLE_REJECTION_REASON,
  SAMPLE_HISTORY,
} from "../constants/sampleData.js";
import { canRunAllCommands, hasManageGuild, isReviewer } from "../lib/config.js";

export const data = new SlashCommandBuilder()
  .setName("sample")
  .setDescription("Preview UI components for testing")
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("reviewcard")
      .setDescription("Preview a sample review card")
      .addStringOption((opt) =>
        opt
          .setName("status")
          .setDescription("Application status")
          .setRequired(false)
          .addChoices(
            { name: "Pending", value: "pending" },
            { name: "Accepted", value: "approved" },
            { name: "Rejected", value: "rejected" }
          )
      )
      .addUserOption((opt) =>
        opt
          .setName("applicant")
          .setDescription("Override the sample applicant user")
          .setRequired(false)
      )
      .addUserOption((opt) =>
        opt.setName("claimed_by").setDescription("Override the moderator name").setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName("long")
          .setDescription("Show a version with long, multiline answers")
          .setRequired(false)
      )
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "reviewcard") {
    await handleReviewPreview(interaction);
  }
}

async function handleReviewPreview(interaction: ChatInputCommandInteraction) {
  // Use same permission gating as other commands
  // Checks: OWNER_IDS, mod_role_ids from config, ManageGuild, or reviewer role/channel perms
  const member = interaction.member && "roles" in interaction.member ? interaction.member : null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId!) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId!, member);

  if (!hasPermission) {
    await interaction.reply({
      content: "❌ You don't have permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const status = (interaction.options.getString("status") as "pending" | "approved" | "rejected") ?? "pending";
  const applicantOverride = interaction.options.getUser("applicant");
  const claimedByOverride = interaction.options.getUser("claimed_by");
  const long = interaction.options.getBoolean("long") ?? false;

  // Determine which answers to use
  let answers = SAMPLE_ANSWERS_STANDARD;
  if (status === "rejected") {
    answers = SAMPLE_ANSWERS_REJECTED;
  } else if (long) {
    answers = SAMPLE_ANSWERS_LONG;
  }

  // Build the sample application
  const sampleApp: ReviewCardApplication = {
    id: "SAMPLE01" + ulid().slice(-6), // SAMPLE01 + random suffix
    guild_id: interaction.guildId!,
    user_id: applicantOverride?.id ?? "123456789012345678",
    status: status === "pending" ? "submitted" : status,
    created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(), // 3m ago
    submitted_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    resolved_at: status !== "pending" ? new Date().toISOString() : null,
    resolver_id: status !== "pending" ? (claimedByOverride?.id ?? interaction.user.id) : null,
    resolution_reason: status === "rejected" ? SAMPLE_REJECTION_REASON : null,
    userTag: applicantOverride?.tag ?? "SampleUser#0001",
    avatarUrl: applicantOverride?.displayAvatarURL() ?? "https://cdn.discordapp.com/embed/avatars/0.png",
  };

  // Build claim data
  const sampleClaim: ReviewClaimRow | null = claimedByOverride
    ? {
        reviewer_id: claimedByOverride.id,
        claimed_at: Math.floor(Date.now() / 1000) - 60, // 1m ago
      }
    : {
        reviewer_id: interaction.user.id,
        claimed_at: Math.floor(Date.now() / 1000) - 60, // 1m ago
      };

  // Build avatar scan data
  const sampleAvatarScan: AvatarScanRow = {
    finalPct: 0,
    furry_score: 0.0,
    scalie_score: 0.0,
    reason: "none",
    evidence: {
      hard: [],
      soft: [],
      safe: [],
    },
  };

  // Account created: 5 years 7 months ago
  const accountCreatedAt = Date.now() - (5 * 365 + 7 * 30) * 24 * 60 * 60 * 1000;

  // Build history with actual user IDs
  const sampleHistory = SAMPLE_HISTORY.map((action, idx) => {
    let moderatorId = claimedByOverride?.id ?? interaction.user.id;

    // Alternate moderators for variety
    if (idx === 1) {
      moderatorId = interaction.user.id; // Different mod for approval
    } else if (idx === 2) {
      moderatorId = applicantOverride?.id ?? "123456789012345678"; // Applicant for submit
    }

    return {
      ...action,
      moderator_id: moderatorId,
    };
  });

  // Build the embed
  const embed = buildReviewEmbed(sampleApp, {
    answers,
    flags: [],
    avatarScan: sampleAvatarScan,
    claim: sampleClaim,
    accountCreatedAt,
    modmailTicket: {
      id: 1,
      thread_id: null,
      status: "closed",
      log_channel_id: null,
      log_message_id: null,
    },
    member: null, // Assume user hasn't left
    recentActions: sampleHistory,
    isSample: true,
  });

  // Build action rows
  const components = buildActionRows(sampleApp, sampleClaim);

  // Reply with the sample
  await interaction.reply({
    content: "**Sample Review Card** (buttons are non-functional for preview only)",
    embeds: [embed],
    components,
    ephemeral: true,
  });
}
