/**
 * Pawtropolis Tech — src/commands/statusupdate.ts
 * WHAT: Slash command to update the bot presence text.
 * WHY: Admin tool to reflect state; scoped to staff via requireStaff.
 * FLOWS:
 *  - permission check → read input → update presence → ephemeral ack
 * DOCS:
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction replies (flags): https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActivityType,
  MessageFlags,
} from "discord.js";
import { requireStaff } from "../lib/config.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("statusupdate")
  .setDescription("Update the bot's presence text")
  .addStringOption((option) =>
    option
      .setName("text")
      .setDescription("Status text")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(128)
  );

/**
 * execute
 * WHAT: Sets a simple Playing presence with the provided text.
 * RETURNS: Ephemeral "Status updated." message.
 * THROWS: Never; errors are caught by wrapCommand upstream.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const text = await withStep(ctx, "validate_input", async () =>
    interaction.options.getString("text", true)
  );

  const user = await withStep(ctx, "load_bot_user", async () => interaction.client.user);
  if (!user) {
    await withStep(ctx, "reply_missing_user", async () => {
      // ephemeral reply since this is a diagnostic; reply within 3s SLA
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Bot user missing (lol).",
      });
    });
    return;
  }

  await withStep(ctx, "update_presence", async () => {
    await user.setPresence({ activities: [], status: "online" });
    await user.setPresence({
      activities: [{ name: text, type: ActivityType.Playing }],
      status: "online",
    });
  });

  await withStep(ctx, "final_reply", async () => {
    // ephemeral ack keeps channels clean, especially when multiple staff use this command
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Status updated." });
  });
}
