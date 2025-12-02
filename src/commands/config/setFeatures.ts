/**
 * Pawtropolis Tech -- src/commands/config/setFeatures.ts
 * WHAT: Feature toggle handlers for /config set commands.
 * WHY: Groups all feature configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  upsertConfig,
  getConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  logger,
} from "./shared.js";

export async function executeSetReviewRoles(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Controls role display in review cards. "level_only" shows just the
   * highest progression role which is usually the most relevant for review decisions.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_mode");
  const mode = interaction.options.getString("mode", true);

  if (!["none", "level_only", "all"].includes(mode)) {
    await replyOrEdit(interaction, { content: "Invalid mode. Choose: none, level_only, or all." });
    return;
  }

  ctx.step("persist_mode");
  upsertConfig(interaction.guildId!, { review_roles_mode: mode });

  logger.info(
    { evt: "config_set_review_roles", guildId: interaction.guildId, mode },
    "[config] review roles mode updated"
  );

  ctx.step("reply");
  const modeDescription =
    mode === "none"
      ? "hidden"
      : mode === "level_only"
        ? "only showing highest level role"
        : "showing all roles";

  await replyOrEdit(interaction, {
    content: `Review card role display set to **${mode}** (${modeDescription}).`,
  });
}

export async function executeSetDadMode(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Dad Mode: responds to "I'm tired" with "Hi tired, I'm dad!" (or similar).
   * The odds setting controls how often it triggers - 1 in N messages that match.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const state = interaction.options.getString("state", true); // "on" | "off"
  const chance = interaction.options.getInteger("chance");

  ctx.step("update_config");
  const existingCfg = getConfig(interaction.guildId!);
  let dadmodeEnabled = existingCfg?.dadmode_enabled ?? false;
  let dadmodeOdds = existingCfg?.dadmode_odds ?? 1000;

  if (state === "off") {
    dadmodeEnabled = false;
    upsertConfig(interaction.guildId!, { dadmode_enabled: false });
  } else {
    dadmodeEnabled = true;
    if (chance !== null) {
      const validChance = Math.min(100000, Math.max(2, chance));
      dadmodeOdds = validChance;
      upsertConfig(interaction.guildId!, { dadmode_enabled: true, dadmode_odds: validChance });
    } else {
      if (!dadmodeOdds) {
        dadmodeOdds = 1000;
      }
      upsertConfig(interaction.guildId!, {
        dadmode_enabled: true,
        dadmode_odds: dadmodeOdds,
      });
    }
  }

  ctx.step("reply");
  const statusText = dadmodeEnabled
    ? `**ON** (1 in **${dadmodeOdds ?? 1000}**)`
    : "**OFF**";
  await replyOrEdit(interaction, {
    content: `Dad Mode: ${statusText}`,
  });

  logger.info(
    {
      guildId: interaction.guildId,
      enabled: dadmodeEnabled,
      odds: dadmodeOdds,
      moderatorId: interaction.user.id,
    },
    "[config] dadmode updated"
  );
}

export async function executeSetPingDevOnApp(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Toggle Bot Dev role ping on new applications.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const enabled = interaction.options.getBoolean("enabled", true);

  ctx.step("update_config");
  upsertConfig(interaction.guildId!, { ping_dev_on_app: enabled ? 1 : 0 });

  logger.info(
    {
      guildId: interaction.guildId,
      enabled,
      moderatorId: interaction.user.id,
    },
    "[config] ping_dev_on_app updated"
  );

  ctx.step("reply");
  const statusText = enabled ? "**enabled**" : "**disabled**";
  await replyOrEdit(interaction, {
    content: `Bot Dev role ping on new applications: ${statusText}`,
  });
}

export async function executeSetBannerSyncToggle(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Enables or disables banner sync feature.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const enabled = interaction.options.getBoolean("enabled", true);

  ctx.step("update_config");
  upsertConfig(interaction.guildId!, { banner_sync_enabled: enabled ? 1 : 0 });

  logger.info(
    { evt: "config_set_banner_sync_toggle", guildId: interaction.guildId, enabled },
    "[config] banner sync toggle updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Banner sync **${enabled ? "enabled" : "disabled"}**`,
  });
}

export async function executeSetAvatarScanToggle(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const enabled = interaction.options.getBoolean("enabled", true);
  upsertConfig(interaction.guildId!, { avatar_scan_enabled: enabled });

  logger.info(
    { evt: "config_set_avatar_scan_toggle", guildId: interaction.guildId, enabled },
    "[config] avatar scan toggle updated"
  );

  await replyOrEdit(interaction, {
    content: `Avatar scanning **${enabled ? "enabled" : "disabled"}**`,
  });
}

export async function executeSetListopenOutput(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const mode = interaction.options.getString("mode", true);
  const isPublic = mode === "public";
  upsertConfig(interaction.guildId!, { listopen_public_output: isPublic });

  logger.info(
    { evt: "config_set_listopen_output", guildId: interaction.guildId, mode, isPublic },
    "[config] listopen output mode updated"
  );

  await replyOrEdit(interaction, {
    content: `Listopen output set to **${isPublic ? "public" : "ephemeral"}**`,
  });
}

export async function executeSetModmailDelete(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const enabled = interaction.options.getBoolean("enabled", true);
  upsertConfig(interaction.guildId!, { modmail_delete_on_close: enabled });

  logger.info(
    { evt: "config_set_modmail_delete", guildId: interaction.guildId, enabled },
    "[config] modmail delete on close updated"
  );

  await replyOrEdit(interaction, {
    content: `Modmail threads will ${enabled ? "be deleted" : "**not** be deleted"} when closed`,
  });
}

export async function executeSetNotifyMode(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const mode = interaction.options.getString("mode", true);
  upsertConfig(interaction.guildId!, { notify_mode: mode });

  logger.info(
    { evt: "config_set_notify_mode", guildId: interaction.guildId, mode },
    "[config] notify mode updated"
  );

  const modeDesc = mode === "post" ? "create notification posts" : mode === "dm" ? "send direct messages" : "disabled";
  await replyOrEdit(interaction, {
    content: `Notification mode set to **${mode}** (${modeDesc})`,
  });
}
