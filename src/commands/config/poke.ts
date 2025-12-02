/**
 * Pawtropolis Tech -- src/commands/config/poke.ts
 * WHAT: Poke command configuration handlers.
 * WHY: Groups all poke system configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { EmbedBuilder, Colors, ChannelType } from "discord.js";
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

export async function executePokeAddCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Adds a category to the poke target list.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_category");
  const category = interaction.options.getChannel("category", true);

  // Validate it's actually a category channel
  if (category.type !== ChannelType.GuildCategory) {
    await replyOrEdit(interaction, {
      content: `Channel <#${category.id}> is not a category. Please select a category channel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing category IDs or start fresh
  let categoryIds: string[] = [];
  if (cfg?.poke_category_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_category_ids_json);
      if (Array.isArray(parsed)) {
        categoryIds = parsed;
      }
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Check if already exists
  if (categoryIds.includes(category.id)) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is already in the poke target list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Add and save
  categoryIds.push(category.id);
  upsertConfig(interaction.guildId!, { poke_category_ids_json: JSON.stringify(categoryIds) });

  logger.info(
    {
      evt: "poke_category_added",
      guildId: interaction.guildId,
      categoryId: category.id,
      categoryName: category.name,
      totalCategories: categoryIds.length,
    },
    "[config] poke category added"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Added category **${category.name}** to poke targets.\n\nTotal categories: ${categoryIds.length}`,
  });
}

export async function executePokeRemoveCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Removes a category from the poke target list.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_category");
  const category = interaction.options.getChannel("category", true);

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing category IDs
  let categoryIds: string[] = [];
  if (cfg?.poke_category_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_category_ids_json);
      if (Array.isArray(parsed)) {
        categoryIds = parsed;
      }
    } catch {
      // Invalid JSON, nothing to remove
    }
  }

  // Check if exists
  const idx = categoryIds.indexOf(category.id);
  if (idx === -1) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is not in the poke target list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove and save
  categoryIds.splice(idx, 1);
  upsertConfig(interaction.guildId!, { poke_category_ids_json: JSON.stringify(categoryIds) });

  logger.info(
    {
      evt: "poke_category_removed",
      guildId: interaction.guildId,
      categoryId: category.id,
      categoryName: category.name,
      totalCategories: categoryIds.length,
    },
    "[config] poke category removed"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Removed category **${category.name}** from poke targets.\n\nRemaining categories: ${categoryIds.length}`,
  });
}

export async function executePokeExcludeChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Adds a channel to the poke exclusion list.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing excluded channel IDs or start fresh
  let excludedIds: string[] = [];
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed)) {
        excludedIds = parsed;
      }
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Check if already excluded
  if (excludedIds.includes(channel.id)) {
    await replyOrEdit(interaction, {
      content: `Channel <#${channel.id}> is already excluded from pokes.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Add and save
  excludedIds.push(channel.id);
  upsertConfig(interaction.guildId!, { poke_excluded_channel_ids_json: JSON.stringify(excludedIds) });

  logger.info(
    {
      evt: "poke_channel_excluded",
      guildId: interaction.guildId,
      channelId: channel.id,
      channelName: channel.name,
      totalExcluded: excludedIds.length,
    },
    "[config] poke channel excluded"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Excluded channel **${channel.name}** from poke messages.\n\nTotal excluded: ${excludedIds.length}`,
  });
}

export async function executePokeIncludeChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Removes a channel from the poke exclusion list.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing excluded channel IDs
  let excludedIds: string[] = [];
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed)) {
        excludedIds = parsed;
      }
    } catch {
      // Invalid JSON, nothing to remove
    }
  }

  // Check if exists
  const idx = excludedIds.indexOf(channel.id);
  if (idx === -1) {
    await replyOrEdit(interaction, {
      content: `Channel <#${channel.id}> is not in the exclusion list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove and save
  excludedIds.splice(idx, 1);
  upsertConfig(interaction.guildId!, { poke_excluded_channel_ids_json: JSON.stringify(excludedIds) });

  logger.info(
    {
      evt: "poke_channel_included",
      guildId: interaction.guildId,
      channelId: channel.id,
      channelName: channel.name,
      totalExcluded: excludedIds.length,
    },
    "[config] poke channel re-included"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Re-included channel **${channel.name}** (removed from exclusion list).\n\nRemaining excluded: ${excludedIds.length}`,
  });
}

export async function executePokeList(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Lists current poke configuration (categories + excluded channels).
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse category IDs
  let categoryIds: string[] = [];
  if (cfg?.poke_category_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_category_ids_json);
      if (Array.isArray(parsed)) {
        categoryIds = parsed;
      }
    } catch {
      // Invalid JSON
    }
  }

  // Parse excluded channel IDs
  let excludedIds: string[] = [];
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed)) {
        excludedIds = parsed;
      }
    } catch {
      // Invalid JSON
    }
  }

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle("Poke Configuration")
    .setColor(Colors.Blue)
    .setDescription("Categories and channels configured for the `/poke` command.");

  // Categories field
  const categoryValue = categoryIds.length > 0
    ? categoryIds.map(id => `<#${id}>`).join("\n")
    : "*No categories configured*\n\nUse `/config poke add-category` to add target categories.";
  embed.addFields({ name: `Target Categories (${categoryIds.length})`, value: categoryValue, inline: false });

  // Excluded channels field
  const excludedValue = excludedIds.length > 0
    ? excludedIds.map(id => `<#${id}>`).join("\n")
    : "*No channels excluded*";
  embed.addFields({ name: `Excluded Channels (${excludedIds.length})`, value: excludedValue, inline: false });

  // Usage hint
  embed.setFooter({ text: "Use /config poke add-category, remove-category, exclude-channel, include-channel" });

  ctx.step("reply");
  await replyOrEdit(interaction, { embeds: [embed] });
}
