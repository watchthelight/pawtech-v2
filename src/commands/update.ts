/**
 * Pawtropolis Tech — src/commands/update.ts
 * WHAT: /update command with activity and status subcommands
 * WHY: Separate control over bot activity (Playing/Watching) vs custom status (green text)
 * FLOWS:
 *  - /update activity: Sets activity with type (Playing/Watching/Listening/Competing)
 *  - /update status: Sets custom status (the green text below username)
 * DOCS:
 *  - Activities: https://discord.js.org/#/docs/discord.js/main/typedef/ActivitiesOptions
 *  - Custom Status: Use ActivityType.Custom with state field
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
import { upsertStatus, getStatus } from "../features/statusStore.js";

export const data = new SlashCommandBuilder()
  .setName("update")
  .setDescription("Update bot activity or status")
  .addSubcommand((sub) =>
    sub
      .setName("activity")
      .setDescription("Update bot activity (Playing, Watching, etc.)")
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Activity type")
          .setRequired(true)
          .addChoices(
            { name: "Playing", value: "playing" },
            { name: "Watching", value: "watching" },
            { name: "Listening to", value: "listening" },
            { name: "Competing in", value: "competing" }
          )
      )
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Activity text")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(128)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Update bot custom status (green text below name)")
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Status text")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(128)
      )
  );

const ACTIVITY_TYPE_MAP: Record<string, ActivityType> = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const subcommand = interaction.options.getSubcommand();

  const user = await withStep(ctx, "load_bot_user", async () => interaction.client.user);
  if (!user) {
    await withStep(ctx, "reply_missing_user", async () => {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Bot user missing.",
      });
    });
    return;
  }

  if (subcommand === "activity") {
    await handleActivityUpdate(ctx, user);
  } else if (subcommand === "status") {
    await handleStatusUpdate(ctx, user);
  }
}

async function handleActivityUpdate(
  ctx: CommandContext<ChatInputCommandInteraction>,
  user: NonNullable<ChatInputCommandInteraction["client"]["user"]>
) {
  const { interaction } = ctx;

  const activityTypeStr = await withStep(ctx, "validate_type", async () =>
    interaction.options.getString("type", true)
  );
  const text = await withStep(ctx, "validate_text", async () =>
    interaction.options.getString("text", true)
  );

  const activityType = ACTIVITY_TYPE_MAP[activityTypeStr];

  await withStep(ctx, "update_presence", async () => {
    // Get existing status to preserve custom status if it exists
    const saved = getStatus("global");
    const activities = [];

    // Add the regular activity
    activities.push({ name: text, type: activityType });

    // Preserve custom status if it exists
    if (saved?.customStatus) {
      activities.push({ type: ActivityType.Custom, state: saved.customStatus });
    }

    await user.setPresence({
      activities,
      status: "online",
    });
  });

  await withStep(ctx, "persist_status", async () => {
    // Get existing saved status to preserve custom status
    const saved = getStatus("global");

    upsertStatus({
      scopeKey: "global",
      activityType,
      activityText: text,
      customStatus: saved?.customStatus ?? null,
      status: "online",
      updatedAt: Date.now(),
    });
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Activity updated to: **${activityTypeStr}** "${text}" (saved for restarts).`,
    });
  });
}

async function handleStatusUpdate(
  ctx: CommandContext<ChatInputCommandInteraction>,
  user: NonNullable<ChatInputCommandInteraction["client"]["user"]>
) {
  const { interaction } = ctx;

  const text = await withStep(ctx, "validate_text", async () =>
    interaction.options.getString("text", true)
  );

  await withStep(ctx, "update_presence", async () => {
    // Get existing status to preserve activity if it exists
    const saved = getStatus("global");
    const activities = [];

    // Preserve regular activity if it exists
    if (saved?.activityType !== null && saved?.activityText) {
      activities.push({ type: saved.activityType, name: saved.activityText });
    }

    // Add custom status
    activities.push({ type: ActivityType.Custom, state: text });

    await user.setPresence({
      activities,
      status: "online",
    });
  });

  await withStep(ctx, "persist_status", async () => {
    // Get existing saved status to preserve activity
    const saved = getStatus("global");

    upsertStatus({
      scopeKey: "global",
      activityType: saved?.activityType ?? null,
      activityText: saved?.activityText ?? null,
      customStatus: text,
      status: "online",
      updatedAt: Date.now(),
    });
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Custom status updated to: "${text}" (saved for restarts).`,
    });
  });
}
