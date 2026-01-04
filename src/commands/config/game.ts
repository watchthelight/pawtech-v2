/**
 * Pawtropolis Tech -- src/commands/config/game.ts
 * WHAT: Game night configuration handlers.
 * WHY: Groups all game night system configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  MessageFlags,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  logger,
} from "./shared.js";
import {
  getGameConfig,
  setGameQualificationPercentage,
} from "../../store/gameConfigStore.js";

export async function executeSetGameThreshold(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the game night qualification percentage threshold.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_percentage");
  const percentage = interaction.options.getInteger("percentage", true);

  // Validation: reasonable range (10-90%)
  if (percentage < 10 || percentage > 90 || !Number.isInteger(percentage)) {
    await replyOrEdit(interaction, {
      content: "Percentage must be between 10 and 90.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("persist_threshold");
  setGameQualificationPercentage(interaction.guildId!, percentage);

  logger.info(
    {
      evt: "game_threshold_updated",
      guildId: interaction.guildId,
      threshold: percentage,
      userId: interaction.user.id,
    },
    "Game qualification percentage updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Game night qualification threshold set to **${percentage}%**.\n\nMembers must attend at least ${percentage}% of the event duration to qualify.`,
  });
}

export async function executeGetGameConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows current game night configuration.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_game_config");
  const config = getGameConfig(interaction.guildId!);

  const modeDescription = config.attendanceMode === "continuous"
    ? "Longest single session must exceed threshold (stricter)"
    : "Total time across all sessions must exceed threshold (more forgiving)";

  ctx.step("reply");
  await replyOrEdit(interaction, {
    embeds: [{
      title: "Game Night Configuration",
      color: 0x9B59B6,
      fields: [
        {
          name: "Attendance Mode",
          value: `\`${config.attendanceMode}\`\n${modeDescription}`,
          inline: false,
        },
        {
          name: "Qualification Threshold",
          value: `**${config.qualificationPercentage}%** of event duration\nMembers must attend at least ${config.qualificationPercentage}% of the game night to qualify.`,
          inline: false,
        },
      ],
      footer: { text: "Use /config set game_threshold to change threshold" },
    }],
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}
