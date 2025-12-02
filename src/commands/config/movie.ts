/**
 * Pawtropolis Tech -- src/commands/config/movie.ts
 * WHAT: Movie night configuration handlers.
 * WHY: Groups all movie system configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  MessageFlags,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  logger,
  db,
} from "./shared.js";

export async function executeSetMovieThreshold(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the movie night qualification threshold in minutes.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_minutes");
  const minutes = interaction.options.getInteger("minutes", true);

  // Validation: reasonable range (5-180 minutes = 5 min to 3 hours)
  if (minutes < 5 || minutes > 180 || !Number.isInteger(minutes)) {
    await replyOrEdit(interaction, {
      content: "Threshold must be between 5 and 180 minutes.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("persist_threshold");
  const stmt = db.prepare(`
    INSERT INTO guild_movie_config (guild_id, qualification_threshold_minutes, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      qualification_threshold_minutes = excluded.qualification_threshold_minutes,
      updated_at = excluded.updated_at
  `);

  stmt.run(interaction.guildId, minutes);

  logger.info(
    {
      evt: "movie_threshold_updated",
      guildId: interaction.guildId,
      threshold: minutes,
      userId: interaction.user.id,
    },
    "Movie qualification threshold updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Movie night qualification threshold set to **${minutes} minutes**.\n\nMembers must watch for at least ${minutes} minutes to qualify for tier roles.`,
  });
}

export async function executeGetMovieConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows current movie night configuration.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_movie_config");
  const stmt = db.prepare(`
    SELECT attendance_mode, qualification_threshold_minutes
    FROM guild_movie_config
    WHERE guild_id = ?
  `);
  const config = stmt.get(interaction.guildId) as
    { attendance_mode: string; qualification_threshold_minutes: number } | undefined;

  const mode = config?.attendance_mode ?? "cumulative";
  const threshold = config?.qualification_threshold_minutes ?? 30;

  const modeDescription = mode === "continuous"
    ? "Longest single session must exceed threshold (stricter)"
    : "Total time across all sessions must exceed threshold (more forgiving)";

  ctx.step("reply");
  await replyOrEdit(interaction, {
    embeds: [{
      title: "Movie Night Configuration",
      color: 0x5865F2,
      fields: [
        {
          name: "Attendance Mode",
          value: `\`${mode}\`\n${modeDescription}`,
          inline: false,
        },
        {
          name: "Qualification Threshold",
          value: `**${threshold} minutes**\nMembers must watch for at least ${threshold} minutes to qualify.`,
          inline: false,
        },
      ],
      footer: { text: "Use /config set movie_threshold to change threshold" },
    }],
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}
