/**
 * Pawtropolis Tech -- src/commands/config/setRoles.ts
 * WHAT: Role-setting handlers for /config set commands.
 * WHY: Groups all role configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  upsertConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  logger,
  retrofitModmailParentsForGuild,
} from "./shared.js";

export async function executeSetModRoles(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetModRoles
   * WHAT: Sets moderator roles in guild config (stores as CSV).
   * WHY: Allows guild admins to specify which roles can run all commands.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("gather_roles");
  const roles = [];
  for (let i = 1; i <= 5; i++) {
    const role = interaction.options.getRole(`role${i}`);
    if (role) {
      roles.push(role.id);
      logger.info(
        {
          evt: "config_set_mod_role",
          guildId: interaction.guildId,
          roleId: role.id,
          roleName: role.name,
        },
        "[config] adding mod role"
      );
    }
  }

  if (roles.length === 0) {
    await replyOrEdit(interaction, { content: "At least one role is required." });
    return;
  }

  ctx.step("persist_roles");
  const csv = roles.join(",");
  upsertConfig(interaction.guildId!, { mod_role_ids: csv });

  logger.info(
    { evt: "config_set_mod_roles", guildId: interaction.guildId, roleIds: roles, csv },
    "[config] mod roles updated"
  );

  // Update permissions on modmail parent channels
  ctx.step("retrofit_modmail_perms");
  try {
    await retrofitModmailParentsForGuild(interaction.guild!);
    logger.info(
      { evt: "config_retrofit_modmail", guildId: interaction.guildId },
      "[config] retrofitted modmail parent permissions after mod roles update"
    );
  } catch (err) {
    logger.warn(
      { err, guildId: interaction.guildId },
      "[config] failed to retrofit modmail permissions"
    );
  }

  ctx.step("reply");
  const roleList = roles.map((id) => `<@&${id}>`).join(", ");
  await replyOrEdit(interaction, {
    content: `Moderator roles updated: ${roleList}\n\nUsers with any of these roles can now run all commands.`,
  });
}

export async function executeSetGatekeeper(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetGatekeeper
   * WHAT: Sets the gatekeeper role in guild config.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_role");
  const role = interaction.options.getRole("role", true);

  ctx.step("persist_role");
  upsertConfig(interaction.guildId!, { gatekeeper_role_id: role.id });

  logger.info(
    {
      evt: "config_set_gatekeeper",
      guildId: interaction.guildId,
      roleId: role.id,
      roleName: role.name,
    },
    "[config] gatekeeper role updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Gatekeeper role set to <@&${role.id}>`,
  });
}

export async function executeSetReviewerRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const role = interaction.options.getRole("role", true);
  upsertConfig(interaction.guildId!, { reviewer_role_id: role.id });

  logger.info(
    { evt: "config_set_reviewer_role", guildId: interaction.guildId, roleId: role.id },
    "[config] reviewer role updated"
  );

  await replyOrEdit(interaction, {
    content: `Reviewer role set to <@&${role.id}>`,
  });
}

export async function executeSetLeadershipRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const role = interaction.options.getRole("role", true);
  upsertConfig(interaction.guildId!, { leadership_role_id: role.id });

  logger.info(
    { evt: "config_set_leadership_role", guildId: interaction.guildId, roleId: role.id },
    "[config] leadership role updated"
  );

  await replyOrEdit(interaction, {
    content: `Leadership role set to <@&${role.id}>`,
  });
}

export async function executeSetBotDevRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the role to ping on new applications (when ping_dev_on_app is enabled).
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_role");
  const role = interaction.options.getRole("role", true);

  ctx.step("persist_role");
  upsertConfig(interaction.guildId!, { bot_dev_role_id: role.id });

  logger.info(
    { evt: "config_set_bot_dev_role", guildId: interaction.guildId, roleId: role.id, roleName: role.name },
    "[config] bot dev role updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Bot Dev role set to <@&${role.id}>\n\nThis role will be pinged on new applications when \`/config set pingdevonapp enabled:true\` is set.`,
  });
}

export async function executeSetNotifyRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const role = interaction.options.getRole("role", true);
  upsertConfig(interaction.guildId!, { notify_role_id: role.id });

  logger.info(
    { evt: "config_set_notify_role", guildId: interaction.guildId, roleId: role.id },
    "[config] notify role updated"
  );

  await replyOrEdit(interaction, {
    content: `Notification role set to <@&${role.id}>`,
  });
}
