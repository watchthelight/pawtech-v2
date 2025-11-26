// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/roles.ts
 * WHAT: Role automation configuration commands
 * WHY: Configure level tiers, level rewards, and movie night tiers
 * FLOWS:
 *  - /roles add-level-tier <level> <role> → map level to level role (Amaribot)
 *  - /roles add-level-reward <level> <role> → map level to reward token
 *  - /roles add-movie-tier <tier> <role> <count> → map movie count to tier role
 *  - /roles list [type] → view current mappings
 *  - /roles remove <type> <id> → remove a mapping
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getRoleTiers, type RoleTier, type LevelReward } from "../features/roleAutomation.js";

// Note: No default permission set here because we do manual ManageRoles check in execute().
// This allows the command to appear for everyone but gate functionality at runtime.
// Trade-off: Users might see the command but get rejected. Worth it for cleaner permission logic.
export const data = new SlashCommandBuilder()
  .setName("roles")
  .setDescription("Configure role automation settings")
  .addSubcommand((sub) =>
    sub
      .setName("add-level-tier")
      .setDescription("Map a level number to its level role (Amaribot's role)")
      .addIntegerOption((opt) =>
        opt.setName("level").setDescription("Level number").setRequired(true).setMinValue(1)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("The level role (e.g., Engaged Fur LVL 15)").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("add-level-reward")
      .setDescription("Add a reward token/ticket for a level")
      .addIntegerOption((opt) =>
        opt.setName("level").setDescription("Level number").setRequired(true).setMinValue(1)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("The reward role (e.g., Byte Token [Common])").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("add-movie-tier")
      .setDescription("Add a movie night attendance tier")
      .addStringOption((opt) =>
        opt.setName("tier_name").setDescription("Tier name (e.g., Popcorn Club)").setRequired(true)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("The tier role").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("movies_required").setDescription("Number of movies needed").setRequired(true).setMinValue(1)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("View configured role mappings")
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Filter by type")
          .setRequired(false)
          .addChoices(
            { name: "Level Tiers", value: "level" },
            { name: "Level Rewards", value: "level_reward" },
            { name: "Movie Tiers", value: "movie_night" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove-level-tier")
      .setDescription("Remove a level tier mapping")
      .addIntegerOption((opt) =>
        opt.setName("level").setDescription("Level to remove").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove-level-reward")
      .setDescription("Remove a level reward")
      .addIntegerOption((opt) =>
        opt.setName("level").setDescription("Level number").setRequired(true)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Reward role to remove").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove-movie-tier")
      .setDescription("Remove a movie tier")
      .addStringOption((opt) =>
        opt.setName("tier_name").setDescription("Tier name to remove").setRequired(true)
      )
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Manual permission check instead of setDefaultMemberPermissions because:
  // 1. We need to handle the case where member.permissions is a string (API permissions)
  // 2. Guild-level command permissions can be overridden; this is our source of truth
  const member = interaction.member;
  if (!member || typeof member.permissions === "string" || !member.permissions.has("ManageRoles")) {
    await interaction.reply({
      content: "❌ You need the **Manage Roles** permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "add-level-tier":
      await handleAddLevelTier(interaction);
      break;
    case "add-level-reward":
      await handleAddLevelReward(interaction);
      break;
    case "add-movie-tier":
      await handleAddMovieTier(interaction);
      break;
    case "list":
      await handleList(interaction);
      break;
    case "remove-level-tier":
      await handleRemoveLevelTier(interaction);
      break;
    case "remove-level-reward":
      await handleRemoveLevelReward(interaction);
      break;
    case "remove-movie-tier":
      await handleRemoveMovieTier(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

async function handleAddLevelTier(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);

  try {
    // INSERT OR REPLACE ensures idempotent updates - running the same command twice
    // doesn't create duplicates. The unique constraint is on (guild_id, tier_type, threshold).
    // We store role.name for display purposes but role.id is the actual reference.
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold)
      VALUES (?, 'level', ?, ?, ?)
    `);
    stmt.run(guild.id, role.name, role.id, level);

    logger.info({
      evt: "add_level_tier",
      guildId: guild.id,
      level,
      roleId: role.id,
      roleName: role.name,
      invokedBy: interaction.user.id,
    }, `Added level tier: ${role.name} at level ${level}`);

    await interaction.reply({
      content: `✅ Mapped level **${level}** to role **${role.name}**`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ evt: "add_level_tier_error", err }, "Error adding level tier");
    await interaction.reply({
      content: `❌ Failed to add level tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleAddLevelReward(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);

  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO level_rewards (guild_id, level, role_id, role_name)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(guild.id, level, role.id, role.name);

    logger.info({
      evt: "add_level_reward",
      guildId: guild.id,
      level,
      roleId: role.id,
      roleName: role.name,
      invokedBy: interaction.user.id,
    }, `Added level reward: ${role.name} at level ${level}`);

    await interaction.reply({
      content: `✅ Added reward **${role.name}** for level **${level}**`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ evt: "add_level_reward_error", err }, "Error adding level reward");
    await interaction.reply({
      content: `❌ Failed to add level reward: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleAddMovieTier(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const tierName = interaction.options.getString("tier_name", true);
  const role = interaction.options.getRole("role", true);
  const moviesRequired = interaction.options.getInteger("movies_required", true);

  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold)
      VALUES (?, 'movie_night', ?, ?, ?)
    `);
    stmt.run(guild.id, tierName, role.id, moviesRequired);

    logger.info({
      evt: "add_movie_tier",
      guildId: guild.id,
      tierName,
      roleId: role.id,
      moviesRequired,
      invokedBy: interaction.user.id,
    }, `Added movie tier: ${tierName} (${moviesRequired} movies)`);

    await interaction.reply({
      content: `✅ Added movie tier **${tierName}** (${moviesRequired} movies) → **${role.name}**`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ evt: "add_movie_tier_error", err }, "Error adding movie tier");
    await interaction.reply({
      content: `❌ Failed to add movie tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const filterType = interaction.options.getString("type");

  // Defer because we're making multiple DB queries. Discord gives us 3 seconds
  // to respond, and these queries could take longer on large configs.
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle("🎭 Role Automation Configuration")
    .setColor(0x5865F2)
    .setTimestamp();

  // Level tiers - these map Amaribot level numbers to the roles our bot should assign.
  // The <@&roleId> syntax makes Discord render the role mention with proper formatting.
  if (!filterType || filterType === "level") {
    const levelTiers = getRoleTiers(guild.id, "level");
    if (levelTiers.length > 0) {
      const lines = levelTiers.map(t => `Level ${t.threshold}: <@&${t.role_id}>`);
      embed.addFields({ name: "📊 Level Tiers (Amaribot Roles)", value: lines.join("\n") || "None" });
    } else if (!filterType) {
      embed.addFields({ name: "📊 Level Tiers (Amaribot Roles)", value: "None configured" });
    }
  }

  // Level rewards
  if (!filterType || filterType === "level_reward") {
    const rewards = db.prepare(`
      SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC
    `).all(guild.id) as LevelReward[];

    if (rewards.length > 0) {
      const lines = rewards.map(r => `Level ${r.level}: <@&${r.role_id}>`);
      embed.addFields({ name: "🎁 Level Rewards (Tokens/Tickets)", value: lines.join("\n") || "None" });
    } else if (!filterType) {
      embed.addFields({ name: "🎁 Level Rewards (Tokens/Tickets)", value: "None configured" });
    }
  }

  // Movie tiers
  if (!filterType || filterType === "movie_night") {
    const movieTiers = getRoleTiers(guild.id, "movie_night");
    if (movieTiers.length > 0) {
      const lines = movieTiers.map(t => `${t.tier_name} (${t.threshold} movies): <@&${t.role_id}>`);
      embed.addFields({ name: "🎬 Movie Night Tiers", value: lines.join("\n") || "None" });
    } else if (!filterType) {
      embed.addFields({ name: "🎬 Movie Night Tiers", value: "None configured" });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemoveLevelTier(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);

  try {
    const result = db.prepare(`
      DELETE FROM role_tiers
      WHERE guild_id = ? AND tier_type = 'level' AND threshold = ?
    `).run(guild.id, level);

    if (result.changes > 0) {
      logger.info({
        evt: "remove_level_tier",
        guildId: guild.id,
        level,
        invokedBy: interaction.user.id,
      }, `Removed level tier for level ${level}`);

      await interaction.reply({
        content: `✅ Removed level tier for level **${level}**`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `⚠️ No level tier found for level **${level}**`,
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ evt: "remove_level_tier_error", err }, "Error removing level tier");
    await interaction.reply({
      content: `❌ Failed to remove level tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleRemoveLevelReward(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);

  try {
    const result = db.prepare(`
      DELETE FROM level_rewards
      WHERE guild_id = ? AND level = ? AND role_id = ?
    `).run(guild.id, level, role.id);

    if (result.changes > 0) {
      logger.info({
        evt: "remove_level_reward",
        guildId: guild.id,
        level,
        roleId: role.id,
        invokedBy: interaction.user.id,
      }, `Removed level reward ${role.name} for level ${level}`);

      await interaction.reply({
        content: `✅ Removed reward **${role.name}** from level **${level}**`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `⚠️ No reward **${role.name}** found for level **${level}**`,
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ evt: "remove_level_reward_error", err }, "Error removing level reward");
    await interaction.reply({
      content: `❌ Failed to remove level reward: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleRemoveMovieTier(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const tierName = interaction.options.getString("tier_name", true);

  try {
    const result = db.prepare(`
      DELETE FROM role_tiers
      WHERE guild_id = ? AND tier_type = 'movie_night' AND tier_name = ?
    `).run(guild.id, tierName);

    if (result.changes > 0) {
      logger.info({
        evt: "remove_movie_tier",
        guildId: guild.id,
        tierName,
        invokedBy: interaction.user.id,
      }, `Removed movie tier ${tierName}`);

      await interaction.reply({
        content: `✅ Removed movie tier **${tierName}**`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `⚠️ No movie tier found with name **${tierName}**`,
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ evt: "remove_movie_tier_error", err }, "Error removing movie tier");
    await interaction.reply({
      content: `❌ Failed to remove movie tier: ${err}`,
      ephemeral: true,
    });
  }
}
