/**
 * Pawtropolis Tech -- src/commands/config/artist.ts
 * WHAT: Artist rotation configuration handlers.
 * WHY: Groups all artist system configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  MessageFlags,
  upsertConfig,
  getConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  logger,
} from "./shared.js";

export async function executeSetArtistRotation(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures artist rotation IDs (roles, channel, ticket roles).
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("gather_options");
  const artistRole = interaction.options.getRole("artist_role");
  const ambassadorRole = interaction.options.getRole("ambassador_role");
  const artistChannel = interaction.options.getChannel("artist_channel");
  const headshotTicket = interaction.options.getRole("headshot_ticket");
  const halfbodyTicket = interaction.options.getRole("halfbody_ticket");
  const emojiTicket = interaction.options.getRole("emoji_ticket");
  const fullbodyTicket = interaction.options.getRole("fullbody_ticket");

  const hasAnyOption = artistRole || ambassadorRole || artistChannel ||
    headshotTicket || halfbodyTicket || emojiTicket || fullbodyTicket;

  if (!hasAnyOption) {
    await replyOrEdit(interaction, {
      content: "Please provide at least one option to configure.\n\nUse `/config get artist_rotation` to view current settings.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("update_config");

  const updates: Record<string, string | null> = {};
  const changes: string[] = [];

  if (artistRole) {
    updates.artist_role_id = artistRole.id;
    changes.push(`Artist Role: <@&${artistRole.id}>`);
  }

  if (ambassadorRole) {
    updates.ambassador_role_id = ambassadorRole.id;
    changes.push(`Ambassador Role: <@&${ambassadorRole.id}>`);
  }

  if (artistChannel) {
    updates.server_artist_channel_id = artistChannel.id;
    changes.push(`Artist Channel: <#${artistChannel.id}>`);
  }

  // Build ticket roles JSON if any ticket role was provided
  const cfg = getConfig(interaction.guildId!);
  let ticketRoles: Record<string, string | null> = {};

  if (cfg?.artist_ticket_roles_json) {
    try {
      ticketRoles = JSON.parse(cfg.artist_ticket_roles_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  let ticketRolesChanged = false;
  if (headshotTicket) {
    ticketRoles.headshot = headshotTicket.id;
    changes.push(`Headshot Ticket: <@&${headshotTicket.id}>`);
    ticketRolesChanged = true;
  }
  if (halfbodyTicket) {
    ticketRoles.halfbody = halfbodyTicket.id;
    changes.push(`Half-body Ticket: <@&${halfbodyTicket.id}>`);
    ticketRolesChanged = true;
  }
  if (emojiTicket) {
    ticketRoles.emoji = emojiTicket.id;
    changes.push(`Emoji Ticket: <@&${emojiTicket.id}>`);
    ticketRolesChanged = true;
  }
  if (fullbodyTicket) {
    ticketRoles.fullbody = fullbodyTicket.id;
    changes.push(`Full-body Ticket: <@&${fullbodyTicket.id}>`);
    ticketRolesChanged = true;
  }

  if (ticketRolesChanged) {
    updates.artist_ticket_roles_json = JSON.stringify(ticketRoles);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    {
      evt: "config_set_artist_rotation",
      guildId: interaction.guildId,
      updates,
      userId: interaction.user.id,
    },
    "[config] artist rotation config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Artist rotation configuration updated:\n\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

export async function executeGetArtistRotation(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows current artist rotation configuration.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_config");
  const cfg = getConfig(interaction.guildId!);

  // Import getArtistConfig to show resolved values
  const { getArtistConfig, ARTIST_ROLE_ID, AMBASSADOR_ROLE_ID, SERVER_ARTIST_CHANNEL_ID, TICKET_ROLES } =
    await import("../../features/artistRotation/constants.js");
  const resolved = getArtistConfig(interaction.guildId!);

  const lines: string[] = ["**Artist Rotation Configuration (Issue #78)**", ""];

  // Show artist role
  if (cfg?.artist_role_id) {
    lines.push(`**Artist Role:** <@&${cfg.artist_role_id}> (configured)`);
  } else {
    lines.push(`**Artist Role:** <@&${ARTIST_ROLE_ID}> (fallback)`);
  }

  // Show ambassador role
  if (cfg?.ambassador_role_id) {
    lines.push(`**Ambassador Role:** <@&${cfg.ambassador_role_id}> (configured)`);
  } else {
    lines.push(`**Ambassador Role:** <@&${AMBASSADOR_ROLE_ID}> (fallback)`);
  }

  // Show artist channel
  if (cfg?.server_artist_channel_id) {
    lines.push(`**Artist Channel:** <#${cfg.server_artist_channel_id}> (configured)`);
  } else {
    lines.push(`**Artist Channel:** <#${SERVER_ARTIST_CHANNEL_ID}> (fallback)`);
  }

  lines.push("");
  lines.push("**Ticket Roles:**");

  // Parse configured ticket roles
  let configuredTickets: Record<string, string | null> = {};
  if (cfg?.artist_ticket_roles_json) {
    try {
      configuredTickets = JSON.parse(cfg.artist_ticket_roles_json);
    } catch {
      // Invalid JSON
    }
  }

  const ticketTypes = ["headshot", "halfbody", "emoji", "fullbody"] as const;
  for (const type of ticketTypes) {
    const configuredId = configuredTickets[type];
    const fallbackId = TICKET_ROLES[type];

    if (configuredId) {
      lines.push(`- ${type}: <@&${configuredId}> (configured)`);
    } else if (fallbackId) {
      lines.push(`- ${type}: <@&${fallbackId}> (fallback)`);
    } else {
      lines.push(`- ${type}: *not configured*`);
    }
  }

  lines.push("");
  lines.push("**To configure:**");
  lines.push("`/config set artist_rotation artist_role:@role ambassador_role:@role ...`");

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: lines.join("\n"),
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

export async function executeSetArtistIgnoredUsers(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Manages the list of users to exclude from the artist queue.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const addUser = interaction.options.getUser("add");
  const removeUser = interaction.options.getUser("remove");

  if (!addUser && !removeUser) {
    // Show current list
    const cfg = getConfig(interaction.guildId!);
    let ignoredIds: string[] = [];
    if (cfg?.artist_ignored_users_json) {
      try {
        ignoredIds = JSON.parse(cfg.artist_ignored_users_json);
      } catch {
        // Invalid JSON
      }
    }

    if (ignoredIds.length === 0) {
      await replyOrEdit(interaction, {
        content: "No users are currently ignored from the artist queue.\n\nUse `/config set artist_ignored_users add:@user` to add users.",
      });
    } else {
      const userList = ignoredIds.map((id) => `<@${id}>`).join("\n");
      await replyOrEdit(interaction, {
        content: `**Users ignored from artist queue (${ignoredIds.length}):**\n${userList}`,
      });
    }
    return;
  }

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);
  let ignoredIds: string[] = [];
  if (cfg?.artist_ignored_users_json) {
    try {
      ignoredIds = JSON.parse(cfg.artist_ignored_users_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  if (addUser) {
    if (ignoredIds.includes(addUser.id)) {
      await replyOrEdit(interaction, {
        content: `<@${addUser.id}> is already in the ignore list.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ignoredIds.push(addUser.id);
    upsertConfig(interaction.guildId!, { artist_ignored_users_json: JSON.stringify(ignoredIds) });
    logger.info(
      { evt: "artist_ignored_user_added", guildId: interaction.guildId, userId: addUser.id },
      "[config] artist ignored user added"
    );
    await replyOrEdit(interaction, {
      content: `Added <@${addUser.id}> to the artist queue ignore list.\n\nTotal ignored: ${ignoredIds.length}`,
    });
  } else if (removeUser) {
    const idx = ignoredIds.indexOf(removeUser.id);
    if (idx === -1) {
      await replyOrEdit(interaction, {
        content: `<@${removeUser.id}> is not in the ignore list.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ignoredIds.splice(idx, 1);
    upsertConfig(interaction.guildId!, { artist_ignored_users_json: JSON.stringify(ignoredIds) });
    logger.info(
      { evt: "artist_ignored_user_removed", guildId: interaction.guildId, userId: removeUser.id },
      "[config] artist ignored user removed"
    );
    await replyOrEdit(interaction, {
      content: `Removed <@${removeUser.id}> from the artist queue ignore list.\n\nRemaining ignored: ${ignoredIds.length}`,
    });
  }
}
