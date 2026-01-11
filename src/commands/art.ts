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
import { type CommandContext, withStep, withSql } from "../lib/cmdWrap.js";
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
  type JobByRecipientResult,
} from "../features/artJobs/index.js";

// The slash command builder graveyard: where dreams of a simple API go to die.
// This thing has 8 subcommands, each with their own option soup. The user-or-id
// pattern repeats 4 times because Discord doesn't have option groups.
// If you're adding another subcommand, maybe ask yourself: "do I really need this?"
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
 *
 * The classic "router switch statement" pattern. Some people would say
 * this should be a lookup table. Those people have never debugged a
 * lookup table at 2am. Switch statements are honest about their ugliness.
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
      // This should be unreachable if Discord is doing its job, but Discord
      // has a habit of delivering options that don't match what you registered.
      await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}

/**
 * Check if user is a Server Artist
 *
 * GOTCHA: This relies on the artist role being configured per-guild.
 * If artistRoleId is undefined/empty, this returns false for everyone,
 * which is probably fine but might confuse staff debugging "why can't
 * this artist use /art jobs?"
 */
function isServerArtist(member: GuildMember, guildId: string): boolean {
  const config = getArtistConfig(guildId);
  return member.roles.cache.has(config.artistRoleId);
}

/**
 * Result type for findJob function.
 */
type FindJobResult =
  | { status: "found"; job: ArtJobRow }
  | { status: "not_found" }
  | { status: "no_identifier" }
  | { status: "multiple"; count: number; jobs: ArtJobRow[] };

/**
 * Find a job by ID or user+type
 *
 * Two ways to identify a job: by the artist's local job number, or by
 * recipient + art type combo. The latter exists because artists kept asking
 * "what's the ID for so-and-so's headshot?" Just let them use the user.
 *
 * EDGE CASE: If someone provides BOTH id AND user+type, we prefer the id.
 * Not documented anywhere. Discovery is left as an exercise for the user.
 */
function findJob(
  guildId: string,
  artistId: string,
  interaction: ChatInputCommandInteraction
): FindJobResult {
  const jobId = interaction.options.getInteger("id");
  const user = interaction.options.getUser("user");
  const ticketType = interaction.options.getString("type");

  if (jobId) {
    const job = getJobByArtistNumber(guildId, artistId, jobId);
    return job ? { status: "found", job } : { status: "not_found" };
  }

  if (user && ticketType) {
    const result = getJobByRecipient(guildId, artistId, user.id, ticketType);
    if (result.status === "found") {
      return { status: "found", job: result.job };
    }
    if (result.status === "multiple") {
      return { status: "multiple", count: result.count, jobs: result.jobs };
    }
    return { status: "not_found" };
  }

  return { status: "no_identifier" };
}

/**
 * Format ticket type for display
 *
 * Special tasks get their description stored as "special:whatever" in the DB.
 * This is a bit cursed but means we don't need a separate column.
 */
function formatTicketType(type: string): string {
  // Handle special tasks
  if (type.startsWith("special:")) {
    return type.substring(8); // Remove "special:" prefix
  }
  // Falls back to the raw string if the type isn't in ART_TYPE_DISPLAY.
  // This is intentional: if someone adds a new art type and forgets to
  // update the display map, at least they'll see something instead of undefined.
  return ART_TYPE_DISPLAY[type as keyof typeof ART_TYPE_DISPLAY] ?? type;
}

/**
 * Check if job is a special task
 *
 * Belt and suspenders: we check both the recipient_id sentinel value AND
 * the ticket_type prefix. In theory they should always agree. In practice,
 * data migrations happen, and paranoia has saved us before.
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
 *
 * Discord users love emojis. Who are we to judge.
 * The statusEmoji record is reconstructed every call which is wasteful,
 * but we call this maybe 50 times on a busy day. Not worth a module-level const.
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
 *
 * Public reply (not ephemeral) so artists can flex their workload.
 * This is intentional: transparency builds trust with the community.
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

  const hasPermission = await withStep(ctx, "permission_check", async () => {
    if (!isServerArtist(member, guildId)) {
      await interaction.reply({
        content: "You must be a Server Artist to use this command.",
        ephemeral: true,
      });
      return false;
    }
    return true;
  });
  if (!hasPermission) return;

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ ephemeral: false });
  });

  const jobs = await withStep(ctx, "fetch_jobs", async () => {
    return withSql(ctx, "SELECT * FROM art_jobs WHERE artist_id = ?", () =>
      getActiveJobsForArtist(guildId, member.id)
    );
  });

  if (jobs.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("Your Art Jobs")
      .setDescription("No active jobs. You'll see jobs here when you're assigned via `/redeemreward`.")
      .setColor(0x2f0099);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Build the job list. The empty string at the end of each job creates
  // visual spacing between entries. Yes, there's probably a cleaner way.
  const lines: string[] = [];
  for (const job of jobs) {
    // Discord timestamp magic: divide by 1000 to convert ms to seconds,
    // then use <t:TIMESTAMP:R> for relative time ("3 days ago").
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
    .setFooter({ text: `${jobs.length} active job${jobs.length === 1 ? "" : "s"} • Use /art finish id:1 (just the number, no zeros)` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /art bump - Update job status
 *
 * Lets artists move a job through the pipeline: sketching -> lining -> coloring.
 * They can also just add notes without changing the stage.
 * Called "bump" because "update" was taken and "progress" felt too corporate.
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

  const jobResult = findJob(guildId, member.id, interaction);

  if (jobResult.status === "no_identifier") {
    await interaction.reply({
      content: "Provide either `id` or both `user` and `type`.",
      ephemeral: true,
    });
    return;
  }

  if (jobResult.status === "not_found") {
    await interaction.reply({
      content: "Job not found. Check your job number with `/art jobs`.",
      ephemeral: true,
    });
    return;
  }

  if (jobResult.status === "multiple") {
    const jobList = jobResult.jobs
      .map((j) => `• **#${formatJobNumber(j.artist_job_number)}** — ${formatJobDescription(j)}`)
      .join("\n");
    await interaction.reply({
      content: `You have ${jobResult.count} matching jobs for that user+type. Use the job ID instead:\n\n${jobList}\n\nExample: \`/art bump id:${jobResult.jobs[0].artist_job_number}\``,
      ephemeral: true,
    });
    return;
  }

  const job = jobResult.job;

  if (job.status === "done") {
    await interaction.reply({
      content: "This job is already completed.",
      ephemeral: true,
    });
    return;
  }

  // Fun fact: TypeScript doesn't know that getString returns one of the
  // choices we specified. Hence the cast. Discord guarantees this, we trust them.
  // (Famous last words.)
  const stage = interaction.options.getString("stage") as JobStatus | null;
  const notes = interaction.options.getString("notes");

  if (!stage && !notes) {
    await interaction.reply({
      content: "Please provide a `stage` or `notes` to update.",
      ephemeral: true,
    });
    return;
  }

  // Note: nullish coalescing to undefined because the store function uses
  // undefined to mean "don't update this field" vs null meaning "clear it".
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
 *
 * The money shot. Artist calls this when they're done. Sets status to "done"
 * and records completion timestamp. No confirmation dialog because we trust
 * our artists not to fat-finger this. (And if they do, staff can reassign.)
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

  const jobResult = findJob(guildId, member.id, interaction);

  if (jobResult.status === "no_identifier") {
    await interaction.reply({
      content: "Provide either `id` or both `user` and `type`.",
      ephemeral: true,
    });
    return;
  }

  if (jobResult.status === "not_found") {
    await interaction.reply({
      content: "Job not found. Check your job number with `/art jobs`.",
      ephemeral: true,
    });
    return;
  }

  if (jobResult.status === "multiple") {
    const jobList = jobResult.jobs
      .map((j) => `• **#${formatJobNumber(j.artist_job_number)}** — ${formatJobDescription(j)}`)
      .join("\n");
    await interaction.reply({
      content: `You have ${jobResult.count} matching jobs for that user+type. Use the job ID instead:\n\n${jobList}\n\nExample: \`/art finish id:${jobResult.jobs[0].artist_job_number}\``,
      ephemeral: true,
    });
    return;
  }

  const job = jobResult.job;

  if (job.status === "done") {
    await interaction.reply({
      content: "This job is already completed.",
      ephemeral: true,
    });
    return;
  }

  finishJob(job.id);

  // Calculate time taken. We show this as a fun stat, not to shame anyone.
  // Art takes as long as art takes. Though if it's 0 days, someone might
  // be speedrunning, and that's pretty impressive.
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

  const jobResult = findJob(guildId, member.id, interaction);

  if (jobResult.status === "no_identifier") {
    await interaction.reply({
      content: "Provide either `id` or both `user` and `type`.",
      ephemeral: true,
    });
    return;
  }

  if (jobResult.status === "not_found") {
    await interaction.reply({
      content: "Job not found. Check your job number with `/art jobs`.",
      ephemeral: true,
    });
    return;
  }

  if (jobResult.status === "multiple") {
    const jobList = jobResult.jobs
      .map((j) => `• **#${formatJobNumber(j.artist_job_number)}** — ${formatJobDescription(j)}`)
      .join("\n");
    await interaction.reply({
      content: `You have ${jobResult.count} matching jobs for that user+type. Use the job ID instead:\n\n${jobList}\n\nExample: \`/art view id:${jobResult.jobs[0].artist_job_number}\``,
      ephemeral: true,
    });
    return;
  }

  const job = jobResult.job;
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
 *
 * Gamification 101: put a number next to people's names and watch productivity
 * go up. Monthly + all-time gives both sprinters and marathon runners something
 * to aim for.
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

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ ephemeral: false });
  });

  // Top 10 for both. Could be configurable but nobody's asked.
  const { monthlyStats, allTimeStats } = await withStep(ctx, "fetch_stats", async () => {
    return {
      monthlyStats: withSql(ctx, "SELECT monthly leaderboard", () => getMonthlyLeaderboard(guildId, 10)),
      allTimeStats: withSql(ctx, "SELECT alltime leaderboard", () => getAllTimeLeaderboard(guildId, 10)),
    };
  });

  const monthName = new Date().toLocaleString("default", { month: "long", year: "numeric" });

  let description = "";

  // The medal logic: first three get shiny medals, everyone else gets numbers.
  // Ternary chain of shame, but it reads fine.
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
 *
 * Staff dashboard view. Shows ALL active jobs across ALL artists.
 * Not ephemeral because staff sometimes paste this in staff channels
 * to discuss workload distribution.
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

  // requireStaff handles the "nope" reply internally and returns false.
  // Pattern borrowed from the config commands. Slightly magical but consistent.
  if (!requireStaff(interaction, {
    command: "art all",
    description: "Views all active art jobs across all artists (staff dashboard).",
    requirements: [{ type: "config", field: "mod_role_ids" }],
  })) {
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
 *
 * Escape hatch for when the normal /redeemreward flow doesn't cut it.
 * Two modes: "user" for art-for-a-person, "special" for one-off tasks
 * like "make us a new server banner". The "special" jobs store their
 * description in the ticket_type field with a "special:" prefix, which
 * is janky but works.
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

  if (!requireStaff(interaction, {
    command: "art assign",
    description: "Manually assigns an art job to an artist.",
    requirements: [{ type: "config", field: "mod_role_ids" }],
  })) {
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

  // Dynamic import here to avoid a circular dependency nightmare.
  // artJobs/index.js imports config stuff that imports... you get the idea.
  // TODO: Might be worth refactoring this out, but it works for now.
  const { createJob } = await import("../features/artJobs/index.js");

  // The ! assertions are safe here because we validated above. TypeScript
  // doesn't track control flow across if-return patterns perfectly.
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
 *
 * The "where's my art" command. For people who redeemed a reward and want
 * to know if their artist has started yet. Ephemeral because the recipient's
 * art queue is nobody else's business.
 *
 * This is the only subcommand that doesn't require the artist role - it's
 * for recipients, not artists. Easy to forget when you're copy-pasting
 * permission checks from other handlers.
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

  // Same line-building pattern as handleJobs. Could be extracted but
  // the formatting is slightly different (shows artist instead of recipient),
  // and the DRY police have bigger fish to fry.
  const lines: string[] = [];
  for (const job of jobs) {
    const assignedAt = Math.floor(new Date(job.assigned_at).getTime() / 1000);

    lines.push(`**${formatTicketType(job.ticket_type)}** by <@${job.artist_id}>`);
    lines.push(`${formatStatus(job.status)} • Assigned <t:${assignedAt}:R>`);
    if (job.notes) {
      // Artist notes are public to the recipient. Artists know this.
      // If they want to vent, they should do it in the staff channel.
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
