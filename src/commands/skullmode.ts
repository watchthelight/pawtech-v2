/**
 * Pawtropolis Tech — src/commands/skullmode.ts
 * WHAT: /skullmode command to configure skull emoji reaction odds.
 * WHY: Sets the chance (1-1000) for random skull reactions on messages.
 * FLOWS:
 *  - Verify staff permission → update skullmode_odds in guild config → confirm
 * DOCS:
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { requireStaff, getConfig, upsertConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("skullmode")
  .setDescription("Set the skull emoji reaction chance (1-1000)")
  .addIntegerOption((option) =>
    option
      .setName("chance")
      .setDescription("Odds: 1 in N messages get skulled (1 = every message, 1000 = rare)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(1000)
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  if (!interaction.guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "This command can only be used in a server.",
    });
    return;
  }

  ctx.step("permission_check");
  if (!requireStaff(interaction, {
    command: "skullmode",
    description: "Configures skull emoji reaction odds (1-1000).",
    requirements: [{ type: "config", field: "mod_role_ids" }],
  })) return;

  const chance = interaction.options.getInteger("chance", true);

  ctx.step("update_config");
  const existingCfg = getConfig(interaction.guildId);
  const isEnabled = existingCfg?.skullmode_enabled ?? false;

  upsertConfig(interaction.guildId, { skullmode_odds: chance });

  ctx.step("reply");
  const statusNote = isEnabled
    ? `Skull Mode is **ON** - now reacting to 1 in **${chance}** messages.`
    : `Skull Mode odds set to 1 in **${chance}**. Enable it with \`/config set skullmode enabled:true\``;

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: statusNote,
  });

  logger.info(
    {
      guildId: interaction.guildId,
      odds: chance,
      enabled: isEnabled,
      moderatorId: interaction.user.id,
    },
    "[skullmode] odds updated"
  );
}
