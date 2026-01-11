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
import { type CommandContext, withStep } from "../lib/cmdWrap.js";
import { requireMinRole, ROLE_IDS, getConfig, upsertConfig } from "../lib/config.js";
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

  // Require Senior Moderator+ role
  const hasPermission = await withStep(ctx, "permission_check", async () => {
    return requireMinRole(interaction, ROLE_IDS.SENIOR_MOD, {
      command: "skullmode",
      description: "Configures skull emoji reaction odds (1-1000).",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.SENIOR_MOD }],
    });
  });
  if (!hasPermission) return;

  const chance = interaction.options.getInteger("chance", true);

  const isEnabled = await withStep(ctx, "update_config", async () => {
    const existingCfg = getConfig(interaction.guildId!);
    const enabled = existingCfg?.skullmode_enabled ?? false;
    upsertConfig(interaction.guildId!, { skullmode_odds: chance });
    return enabled;
  });

  await withStep(ctx, "reply", async () => {
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
  });
}
