/**
 * Pawtropolis Tech — src/commands/art.ts
 * WHAT: /art command for Server Artists to manage their art jobs.
 * WHY: Allow artists to view, update, and complete their assigned art jobs.
 * FLOWS:
 *  - /art jobs → View current active jobs
 *  - /art bump <id|user+type> [stage] → Update job status
 *  - /art finish <id|user+type> → Mark job complete
 *  - /art view <id|user+type> → View job details
 *  - /art leaderboard → View monthly and all-time stats
 *  - /art all → Staff only: view all active jobs
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  GuildMember,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { requireStaff } from "../lib/config.js";
import { getArtistConfig, ART_TYPE_DISPLAY } from "../features/artistRotation/index.js";
import {
  getActiveJobsForArtist,
  getActiveJobsForRecipient,
  getAllActiveJobs,
  getJobByArtistNumber,
  getJobByRecipient,
  updateJobStatus,
  finishJob,
  getMonthlyLeaderboard,
  getAllTimeLeaderboard,
  formatJobNumber,
  JOB_STATUSES,
  type ArtJobRow,
  type JobStatus,
} from "../features/artJobs/index.js";

export const data = new SlashCommandBuilder()
  .setName("art")
  .setDescription("Manage your art jobs as a Server Artist")
  .addSubcommand((sub) =>
    sub.setName("jobs").setDescription("View your current active jobs")
  )
  .addSubcommand((sub) =>
    sub
      .setName("bump")
      .setDescription("Update the status of a job")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Your job number (e.g., 1)").setMinValue(1)
      )
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Client (alternative to id)")
      )
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Ticket type (required if using user)")
          .addChoices(
            { name: "Headshot", value: "headshot" },
            { name: "Half-body", value: "halfbody" },
            { name: "Emoji", value: "emoji" },
            { name: "Full-body", value: "fullbody" }
          )
      )
      .addStringOption((opt) =>
        opt
          .setName("stage")
          .setDescription("New status")
          .addChoices(
            { name: "Sketching", value: "sketching" },
            { name: "Lining", value: "lining" },
            { name: "Coloring", value: "coloring" }
          )
      )
      .addStringOption((opt) =>
        opt.setName("notes").setDescription("Custom notes about your progress")
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("finish")
      .setDescription("Mark a job as complete")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Your job number (e.g., 1)").setMinValue(1)
      )
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Client (alternative to id)")
      )
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Ticket type (required if using user)")
          .addChoices(
            { name: "Headshot", value: "headshot" },
            { name: "Half-body", value: "halfbody" },
            { name: "Emoji", value: "emoji" },
            { name: "Full-body", value: "fullbody" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("view")
      .setDescription("View details of a specific job")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Your job number (e.g., 1)").setMinValue(1)
      )
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Client (alternative to id)")
      )
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Ticket type (required if using user)")
          .addChoices(
            { name: "Headshot", value: "headshot" },
            { name: "Half-body", value: "halfbody" },
            { name: "Emoji", value: "emoji" },
            { name: "Full-body", value: "fullbody" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("leaderboard").setDescription("View artist completion stats")
  )
  .addSubcommand((sub) =>
    sub.setName("all").setDescription("View all active jobs (staff only)")
  )
  .addSubcommand((sub) =>
    sub
      .setName("assign")
      .setDescription("Manually assign a job to an artist (staff only)")
      .addUserOption((opt) =>
        opt.setName("artist").setDescription("Artist to assign the job to").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("scope")
          .setDescription("Type of assignment")
          .setRequired(true)
          .addChoices(
            { name: "User (art for a user)", value: "user" },
            { name: "Special (custom task)", value: "special" }
          )
      )
      .addUserOption((opt) =>
        opt.setName("recipient").setDescription("User receiving art (for scope:user)")
      )
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Art type (for scope:user)")
          .addChoices(
            { name: "Headshot", value: "headshot" },
            { name: "Half-body", value: "halfbody" },
            { name: "Emoji", value: "emoji" },
            { name: "Full-body", value: "fullbody" }
          )
      )
      .addStringOption((opt) =>
        opt.setName("description").setDescription("Task description (for scope:special)")
      )
  )
  .addSubcommand((sub) =>
    sub.setName("getstatus").setDescription("Check the progress of your art reward")
  );

/**
 * Execute /art command
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  ctx.step(`subcommand:${subcommand}`);

  switch (subcommand) {
    case "jobs":
      await handleJobs(interaction, ctx);
      break;
    case "bump":
      await handleBump(interaction, ctx);
      break;
    case "finish":
      await handleFinish(interaction, ctx);
      break;
    case "view":
      await handleView(interaction, ctx);
      break;
    case "leaderboard":
      await handleLeaderboard(interaction, ctx);
      break;
    case "all":
      await handleAll(interaction, ctx);
      break;
    case "assign":
      await handleAssign(interaction, ctx);
      break;
    case "getstatus":
      await handleGetStatus(interaction, ctx);
      break;
    default:
      await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}

/**
 * Check if user is a Server Artist
 */
function isServerArtist(member: GuildMember, guildId: string): boolean {
  const config = getArtistConfig(guildId);
  return member.roles.cache.has(config.artistRoleId);
}

/**
 * Find a job by ID or user+type
 */
function findJob(
  guildId: string,
  artistId: string,
  interaction: ChatInputCommandInteraction
): ArtJobRow | null {
  const jobId = interaction.options.getInteger("id");
  const user = interaction.options.getUser("user");
  const ticketType = interaction.options.getString("type");

  if (jobId) {
    return getJobByArtistNumber(guildId, artistId, jobId);
  }

  if (user && ticketType) {
    return getJobByRecipient(guildId, artistId, user.id, ticketType);
  }

  return null;
}

/**
 * Format ticket type for display
 */
function formatTicketType(type: string): string {
  // Handle special tasks
  if (type.startsWith("special:")) {
    return type.substring(8); // Remove "special:" prefix
  }
  return ART_TYPE_DISPLAY[type as keyof typeof ART_TYPE_DISPLAY] ?? type;
}

/**
 * Check if job is a special task
 */
function isSpecialJob(job: ArtJobRow): boolean {
  return job.recipient_id === "special" || job.ticket_type.startsWith("special:");
}

/**
 * Format job description for display
 */
function formatJobDescription(job: ArtJobRow): string {
  if (isSpecialJob(job)) {
    return `Special: ${formatTicketType(job.ticket_type)}`;
  }
  return `<@${job.recipient_id}>'s ${formatTicketType(job.ticket_type)}`;
}

/**
 * Format status with emoji
 */
function formatStatus(status: JobStatus): string {
  const statusEmoji: Record<JobStatus, string> = {
    assigned: "📋",
    sketching: "✏️",
    lining: "🖊️",
    coloring: "🎨",
    done: "✅",
  };
  return `${statusEmoji[status]} ${status.charAt(0).toUpperCase() + status.slice(1)}`;
}

/**
 * /art jobs - View active jobs
 */
async function handleJobs(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  if (!isServerArtist(member, guildId)) {
    await interaction.reply({
      content: "You must be a Server Artist to use this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const jobs = getActiveJobsForArtist(guildId, member.id);

  if (jobs.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("Your Art Jobs")
      .setDescription("No active jobs. You'll see jobs here when you're assigned via `/redeemreward`.")
      .setColor(0x2f0099);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const lines: string[] = [];
  for (const job of jobs) {
    const assignedAt = Math.floor(new Date(job.assigned_at).getTime() / 1000);

    lines.push(
      `**#${formatJobNumber(job.artist_job_number)}** | ${formatJobDescription(job)}`
    );
    lines.push(`${formatStatus(job.status)} • Assigned <t:${assignedAt}:R>`);
    if (job.notes) {
      lines.push(`📝 "${job.notes}"`);
    }
    lines.push("");
  }

  const embed = new EmbedBuilder()
    .setTitle("Your Art Jobs")
    .setDescription(lines.join("\n"))
    .setColor(0x2f0099)
    .setFooter({ text: `${jobs.length} active job${jobs.length === 1 ? "" : "s"}` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /art bump - Update job status
 */
async function handleBump(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  if (!isServerArtist(member, guildId)) {
    await interaction.reply({
      content: "You must be a Server Artist to use this command.",
      ephemeral: true,
    });
    return;
  }

  const job = findJob(guildId, member.id, interaction);
  if (!job) {
    await interaction.reply({
      content: "Job not found. Provide either `id` or both `user` and `type`.",
      ephemeral: true,
    });
    return;
  }

  if (job.status === "done") {
    await interaction.reply({
      content: "This job is already completed.",
      ephemeral: true,
    });
    return;
  }

  const stage = interaction.options.getString("stage") as JobStatus | null;
  const notes = interaction.options.getString("notes");

  if (!stage && !notes) {
    await interaction.reply({
      content: "Please provide a `stage` or `notes` to update.",
      ephemeral: true,
    });
    return;
  }

  updateJobStatus(job.id, { status: stage ?? undefined, notes: notes ?? undefined });

  const embed = new EmbedBuilder()
    .setTitle("Job Updated")
    .setDescription(
      `**#${formatJobNumber(job.artist_job_number)}** | ${formatJobDescription(job)}\n\n` +
        (stage ? `Status: ${formatStatus(stage)}\n` : "") +
        (notes ? `Notes: "${notes}"` : "")
    )
    .setColor(0x00cc00);

  await interaction.reply({ embeds: [embed] });
}

/**
 * /art finish - Mark job complete
 */
async function handleFinish(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  if (!isServerArtist(member, guildId)) {
    await interaction.reply({
      content: "You must be a Server Artist to use this command.",
      ephemeral: true,
    });
    return;
  }

  const job = findJob(guildId, member.id, interaction);
  if (!job) {
    await interaction.reply({
      content: "Job not found. Provide either `id` or both `user` and `type`.",
      ephemeral: true,
    });
    return;
  }

  if (job.status === "done") {
    await interaction.reply({
      content: "This job is already completed.",
      ephemeral: true,
    });
    return;
  }

  finishJob(job.id);

  // Calculate time taken
  const assignedAt = new Date(job.assigned_at).getTime();
  const now = Date.now();
  const daysToComplete = Math.floor((now - assignedAt) / (1000 * 60 * 60 * 24));

  const embed = new EmbedBuilder()
    .setTitle("Job Completed!")
    .setDescription(
      `**#${formatJobNumber(job.artist_job_number)}** | ${formatJobDescription(job)}\n\n` +
        `✅ Marked as done\n` +
        `⏱️ Completed in ${daysToComplete} day${daysToComplete === 1 ? "" : "s"}`
    )
    .setColor(0x00cc00);

  await interaction.reply({ embeds: [embed] });
}

/**
 * /art view - View job details
 */
async function handleView(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  if (!isServerArtist(member, guildId)) {
    await interaction.reply({
      content: "You must be a Server Artist to use this command.",
      ephemeral: true,
    });
    return;
  }

  const job = findJob(guildId, member.id, interaction);
  if (!job) {
    await interaction.reply({
      content: "Job not found. Provide either `id` or both `user` and `type`.",
      ephemeral: true,
    });
    return;
  }

  const assignedAt = Math.floor(new Date(job.assigned_at).getTime() / 1000);

  const fields = isSpecialJob(job)
    ? [
        { name: "Task", value: formatTicketType(job.ticket_type), inline: false },
        { name: "Status", value: formatStatus(job.status), inline: true },
        { name: "Assigned", value: `<t:${assignedAt}:f> (<t:${assignedAt}:R>)`, inline: false },
      ]
    : [
        { name: "Client", value: `<@${job.recipient_id}>`, inline: true },
        { name: "Type", value: formatTicketType(job.ticket_type), inline: true },
        { name: "Status", value: formatStatus(job.status), inline: true },
        { name: "Assigned", value: `<t:${assignedAt}:f> (<t:${assignedAt}:R>)`, inline: false },
      ];

  if (job.notes) {
    fields.push({ name: "Notes", value: `"${job.notes}"`, inline: false });
  }

  if (job.completed_at) {
    const completedAt = Math.floor(new Date(job.completed_at).getTime() / 1000);
    fields.push({ name: "Completed", value: `<t:${completedAt}:f>`, inline: false });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Job #${formatJobNumber(job.artist_job_number)} (Global #${formatJobNumber(job.job_number)})`)
    .setColor(job.status === "done" ? 0x00cc00 : 0x2f0099)
    .addFields(fields);

  await interaction.reply({ embeds: [embed] });
}

/**
 * /art leaderboard - View stats
 */
async function handleLeaderboard(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const monthlyStats = getMonthlyLeaderboard(guildId, 10);
  const allTimeStats = getAllTimeLeaderboard(guildId, 10);

  const monthName = new Date().toLocaleString("default", { month: "long", year: "numeric" });

  let description = "";

  if (monthlyStats.length > 0) {
    description += `**This Month (${monthName})**\n`;
    for (let i = 0; i < monthlyStats.length; i++) {
      const entry = monthlyStats[i];
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      description += `${medal} <@${entry.artistId}> - ${entry.completedCount} completed\n`;
    }
  } else {
    description += `**This Month (${monthName})**\nNo completions yet.\n`;
  }

  description += "\n";

  if (allTimeStats.length > 0) {
    description += "**All Time**\n";
    for (let i = 0; i < allTimeStats.length; i++) {
      const entry = allTimeStats[i];
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      description += `${medal} <@${entry.artistId}> - ${entry.completedCount} completed\n`;
    }
  } else {
    description += "**All Time**\nNo completions yet.\n";
  }

  const embed = new EmbedBuilder()
    .setTitle("Server Artist Leaderboard")
    .setDescription(description)
    .setColor(0xffd700);

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /art all - Staff view all jobs
 */
async function handleAll(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  // Staff only
  if (!requireStaff(interaction)) {
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const jobs = getAllActiveJobs(guildId);

  if (jobs.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("All Active Art Jobs")
      .setDescription("No active jobs in the server.")
      .setColor(0x2f0099);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const lines: string[] = [];
  for (const job of jobs) {
    const assignedAt = Math.floor(new Date(job.assigned_at).getTime() / 1000);

    const jobDesc = isSpecialJob(job)
      ? `Special: ${formatTicketType(job.ticket_type)}`
      : `<@${job.recipient_id}>'s ${formatTicketType(job.ticket_type)}`;
    lines.push(
      `**#${formatJobNumber(job.job_number)}** | <@${job.artist_id}> → ${jobDesc}`
    );
    lines.push(`${formatStatus(job.status)} • <t:${assignedAt}:R>`);
    lines.push("");
  }

  const embed = new EmbedBuilder()
    .setTitle("All Active Art Jobs")
    .setDescription(lines.join("\n"))
    .setColor(0x2f0099)
    .setFooter({ text: `${jobs.length} active job${jobs.length === 1 ? "" : "s"}` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /art assign - Staff manually assign job
 */
async function handleAssign(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  // Staff only
  if (!requireStaff(interaction)) {
    return;
  }

  const artist = interaction.options.getUser("artist", true);
  const scope = interaction.options.getString("scope", true);
  const recipient = interaction.options.getUser("recipient");
  const artType = interaction.options.getString("type");
  const description = interaction.options.getString("description");

  // Validate based on scope
  if (scope === "user") {
    if (!recipient || !artType) {
      await interaction.reply({
        content: "For scope `user`, you must provide both `recipient` and `type`.",
        ephemeral: true,
      });
      return;
    }
  } else if (scope === "special") {
    if (!description) {
      await interaction.reply({
        content: "For scope `special`, you must provide a `description`.",
        ephemeral: true,
      });
      return;
    }
  }

  // Create the job
  const { createJob } = await import("../features/artJobs/index.js");

  const job = createJob({
    guildId,
    artistId: artist.id,
    recipientId: scope === "user" ? recipient!.id : "special",
    ticketType: scope === "user" ? artType! : `special:${description}`,
  });

  const embed = new EmbedBuilder()
    .setTitle("Job Assigned")
    .setColor(0x00cc00);

  if (scope === "user") {
    embed.setDescription(
      `**Job #${formatJobNumber(job.jobNumber)}** created\n\n` +
        `**Artist:** <@${artist.id}>\n` +
        `**Recipient:** <@${recipient!.id}>\n` +
        `**Type:** ${formatTicketType(artType!)}`
    );
  } else {
    embed.setDescription(
      `**Job #${formatJobNumber(job.jobNumber)}** created\n\n` +
        `**Artist:** <@${artist.id}>\n` +
        `**Special Task:** ${description}`
    );
  }

  await interaction.reply({ embeds: [embed] });
}

/**
 * /art getstatus - Recipient checks their art progress
 */
async function handleGetStatus(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const jobs = getActiveJobsForRecipient(guildId, interaction.user.id);

  if (jobs.length === 0) {
    await interaction.editReply({ content: "You don't have any art being worked on!" });
    return;
  }

  const lines: string[] = [];
  for (const job of jobs) {
    const assignedAt = Math.floor(new Date(job.assigned_at).getTime() / 1000);

    lines.push(`**${formatTicketType(job.ticket_type)}** by <@${job.artist_id}>`);
    lines.push(`${formatStatus(job.status)} • Assigned <t:${assignedAt}:R>`);
    if (job.notes) {
      lines.push(`📝 Artist notes: "${job.notes}"`);
    }
    lines.push("");
  }

  const embed = new EmbedBuilder()
    .setTitle("Your Art Status")
    .setDescription(lines.join("\n"))
    .setColor(0x2f0099)
    .setFooter({ text: `${jobs.length} piece${jobs.length === 1 ? "" : "s"} in progress` });

  await interaction.editReply({ embeds: [embed] });
}
