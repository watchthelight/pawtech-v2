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
  Role,
} from "discord.js";
import { type CommandContext, withStep, withSql, ensureDeferred } from "../lib/cmdWrap.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getRoleTiers, canManageRoleSync, type RoleTier, type LevelReward } from "../features/roleAutomation.js";

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
      .setName("add-game-tier")
      .setDescription("Add a game night attendance tier")
      .addStringOption((opt) =>
        opt.setName("tier_name").setDescription("Tier name (e.g., Game Champion)").setRequired(true)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("The tier role").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("games_required").setDescription("Number of game nights needed").setRequired(true).setMinValue(1)
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
            { name: "Movie Tiers", value: "movie_night" },
            { name: "Game Tiers", value: "game_night" }
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
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove-game-tier")
      .setDescription("Remove a game tier")
      .addStringOption((opt) =>
        opt.setName("tier_name").setDescription("Tier name to remove").setRequired(true)
      )
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

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
  const hasPermission = await withStep(ctx, "permission_check", async () => {
    const member = interaction.member;
    return member && typeof member.permissions !== "string" && member.permissions.has("ManageRoles");
  });

  if (!hasPermission) {
    await interaction.reply({
      content: "❌ You need the **Manage Roles** permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "add-level-tier":
      await handleAddLevelTier(ctx);
      break;
    case "add-level-reward":
      await handleAddLevelReward(ctx);
      break;
    case "add-movie-tier":
      await handleAddMovieTier(ctx);
      break;
    case "add-game-tier":
      await handleAddGameTier(ctx);
      break;
    case "list":
      await handleList(ctx);
      break;
    case "remove-level-tier":
      await handleRemoveLevelTier(ctx);
      break;
    case "remove-level-reward":
      await handleRemoveLevelReward(ctx);
      break;
    case "remove-movie-tier":
      await handleRemoveMovieTier(ctx);
      break;
    case "remove-game-tier":
      await handleRemoveGameTier(ctx);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

async function handleAddLevelTier(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);

  // Pre-flight check: verify bot can manage this role
  const check = canManageRoleSync(guild, role as Role);
  if (!check.canManage) {
    await interaction.reply({
      content: `Cannot configure this role: ${check.reason}\n\nPlease choose a role that is below the bot's highest role.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await withStep(ctx, "insert_tier", async () => {
      // INSERT OR REPLACE ensures idempotent updates - running the same command twice
      // doesn't create duplicates. The unique constraint is on (guild_id, tier_type, threshold).
      // We store role.name for display purposes but role.id is the actual reference.
      const query = `
        INSERT OR REPLACE INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold)
        VALUES (?, 'level', ?, ?, ?)
      `;
      withSql(ctx, query, () => {
        db.prepare(query).run(guild.id, role.name, role.id, level);
      });

      logger.info({
        evt: "add_level_tier",
        guildId: guild.id,
        level,
        roleId: role.id,
        roleName: role.name,
        invokedBy: interaction.user.id,
      }, `Added level tier: ${role.name} at level ${level}`);
    });

    await withStep(ctx, "reply", async () => {
      await interaction.reply({
        content: `✅ Mapped level **${level}** to role **${role.name}**`,
        ephemeral: true,
      });
    });
  } catch (err) {
    logger.error({ evt: "add_level_tier_error", err }, "Error adding level tier");
    await interaction.reply({
      content: `❌ Failed to add level tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleAddLevelReward(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);

  // Pre-flight check: verify bot can manage this role
  const check = canManageRoleSync(guild, role as Role);
  if (!check.canManage) {
    await interaction.reply({
      content: `Cannot configure this role: ${check.reason}\n\nPlease choose a role that is below the bot's highest role.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await withStep(ctx, "insert_reward", async () => {
      const query = `
        INSERT OR REPLACE INTO level_rewards (guild_id, level, role_id, role_name)
        VALUES (?, ?, ?, ?)
      `;
      withSql(ctx, query, () => {
        db.prepare(query).run(guild.id, level, role.id, role.name);
      });

      logger.info({
        evt: "add_level_reward",
        guildId: guild.id,
        level,
        roleId: role.id,
        roleName: role.name,
        invokedBy: interaction.user.id,
      }, `Added level reward: ${role.name} at level ${level}`);
    });

    await withStep(ctx, "reply", async () => {
      await interaction.reply({
        content: `✅ Added reward **${role.name}** for level **${level}**`,
        ephemeral: true,
      });
    });
  } catch (err) {
    logger.error({ evt: "add_level_reward_error", err }, "Error adding level reward");
    await interaction.reply({
      content: `❌ Failed to add level reward: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleAddMovieTier(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const tierName = interaction.options.getString("tier_name", true);
  const role = interaction.options.getRole("role", true);
  const moviesRequired = interaction.options.getInteger("movies_required", true);

  // Pre-flight check: verify bot can manage this role
  const check = canManageRoleSync(guild, role as Role);
  if (!check.canManage) {
    await interaction.reply({
      content: `Cannot configure this role: ${check.reason}\n\nPlease choose a role that is below the bot's highest role.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await withStep(ctx, "insert_tier", async () => {
      const query = `
        INSERT OR REPLACE INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold)
        VALUES (?, 'movie_night', ?, ?, ?)
      `;
      withSql(ctx, query, () => {
        db.prepare(query).run(guild.id, tierName, role.id, moviesRequired);
      });

      logger.info({
        evt: "add_movie_tier",
        guildId: guild.id,
        tierName,
        roleId: role.id,
        moviesRequired,
        invokedBy: interaction.user.id,
      }, `Added movie tier: ${tierName} (${moviesRequired} movies)`);
    });

    await withStep(ctx, "reply", async () => {
      await interaction.reply({
        content: `✅ Added movie tier **${tierName}** (${moviesRequired} movies) → **${role.name}**`,
        ephemeral: true,
      });
    });
  } catch (err) {
    logger.error({ evt: "add_movie_tier_error", err }, "Error adding movie tier");
    await interaction.reply({
      content: `❌ Failed to add movie tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleList(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const filterType = interaction.options.getString("type");

  // Defer because we're making multiple DB queries. Discord gives us 3 seconds
  // to respond, and these queries could take longer on large configs.
  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ ephemeral: true });
  });

  const { embed, configuredRoleIds } = await withStep(ctx, "fetch_config", async () => {
    const e = new EmbedBuilder()
      .setTitle("Role Automation Configuration")
      .setColor(0x5865F2)
      .setTimestamp();

    // Collect all configured role IDs for warning checks
    const roleIds: Set<string> = new Set();

    // Level tiers - these map Amaribot level numbers to the roles our bot should assign.
    // The <@&roleId> syntax makes Discord render the role mention with proper formatting.
    if (!filterType || filterType === "level") {
      const levelTiers = getRoleTiers(guild.id, "level");
      if (levelTiers.length > 0) {
        const lines = levelTiers.map(t => `Level ${t.threshold}: <@&${t.role_id}>`);
        e.addFields({ name: "Level Tiers (Amaribot Roles)", value: lines.join("\n") || "None" });
        levelTiers.forEach(t => roleIds.add(t.role_id));
      } else if (!filterType) {
        e.addFields({ name: "Level Tiers (Amaribot Roles)", value: "None configured" });
      }
    }

    // Level rewards
    if (!filterType || filterType === "level_reward") {
      const query = `SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC`;
      const rewards = withSql(ctx, query, () => {
        return db.prepare(query).all(guild.id) as LevelReward[];
      });

      if (rewards.length > 0) {
        const lines = rewards.map(r => `Level ${r.level}: <@&${r.role_id}>`);
        e.addFields({ name: "Level Rewards (Tokens/Tickets)", value: lines.join("\n") || "None" });
        rewards.forEach(r => roleIds.add(r.role_id));
      } else if (!filterType) {
        e.addFields({ name: "Level Rewards (Tokens/Tickets)", value: "None configured" });
      }
    }

    // Movie tiers
    if (!filterType || filterType === "movie_night") {
      const movieTiers = getRoleTiers(guild.id, "movie_night");
      if (movieTiers.length > 0) {
        const lines = movieTiers.map(t => `${t.tier_name} (${t.threshold} movies): <@&${t.role_id}>`);
        e.addFields({ name: "Movie Night Tiers", value: lines.join("\n") || "None" });
        movieTiers.forEach(t => roleIds.add(t.role_id));
      } else if (!filterType) {
        e.addFields({ name: "Movie Night Tiers", value: "None configured" });
      }
    }

    // Game tiers
    if (!filterType || filterType === "game_night") {
      const gameTiers = getRoleTiers(guild.id, "game_night");
      if (gameTiers.length > 0) {
        const lines = gameTiers.map(t => `${t.tier_name} (${t.threshold} games): <@&${t.role_id}>`);
        e.addFields({ name: "Game Night Tiers", value: lines.join("\n") || "None" });
        gameTiers.forEach(t => roleIds.add(t.role_id));
      } else if (!filterType) {
        e.addFields({ name: "Game Night Tiers", value: "None configured" });
      }
    }

    return { embed: e, configuredRoleIds: roleIds };
  });

  await withStep(ctx, "check_warnings", async () => {
    // Check for misconfigured roles and collect warnings
    const warnings: string[] = [];
    for (const roleId of Array.from(configuredRoleIds)) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        const check = canManageRoleSync(guild, role);
        if (!check.canManage) {
          warnings.push(`${role.name}: ${check.reason}`);
        }
      } else {
        warnings.push(`<@&${roleId}>: Role not found (may have been deleted)`);
      }
    }

    // Add warnings field if any issues found
    if (warnings.length > 0) {
      embed.addFields({
        name: "Configuration Warnings",
        value: warnings.join("\n"),
        inline: false,
      });
    }

    // Show bot role position info in footer for context
    const botMember = guild.members.me;
    const botHighestRole = botMember?.roles.highest;
    embed.setFooter({
      text: `Bot can manage roles below position ${botHighestRole?.position ?? 0} (${botHighestRole?.name ?? "unknown"})`,
    });
  });

  await withStep(ctx, "reply", async () => {
    await interaction.editReply({ embeds: [embed] });
  });
}

async function handleRemoveLevelTier(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);

  try {
    const result = await withStep(ctx, "delete_tier", async () => {
      const query = `
        DELETE FROM role_tiers
        WHERE guild_id = ? AND tier_type = 'level' AND threshold = ?
      `;
      return withSql(ctx, query, () => {
        return db.prepare(query).run(guild.id, level);
      });
    });

    await withStep(ctx, "reply", async () => {
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
    });
  } catch (err) {
    logger.error({ evt: "remove_level_tier_error", err }, "Error removing level tier");
    await interaction.reply({
      content: `❌ Failed to remove level tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleRemoveLevelReward(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const level = interaction.options.getInteger("level", true);
  const role = interaction.options.getRole("role", true);

  try {
    const result = await withStep(ctx, "delete_reward", async () => {
      const query = `
        DELETE FROM level_rewards
        WHERE guild_id = ? AND level = ? AND role_id = ?
      `;
      return withSql(ctx, query, () => {
        return db.prepare(query).run(guild.id, level, role.id);
      });
    });

    await withStep(ctx, "reply", async () => {
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
    });
  } catch (err) {
    logger.error({ evt: "remove_level_reward_error", err }, "Error removing level reward");
    await interaction.reply({
      content: `❌ Failed to remove level reward: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleRemoveMovieTier(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const tierName = interaction.options.getString("tier_name", true);

  try {
    const result = await withStep(ctx, "delete_tier", async () => {
      const query = `
        DELETE FROM role_tiers
        WHERE guild_id = ? AND tier_type = 'movie_night' AND tier_name = ?
      `;
      return withSql(ctx, query, () => {
        return db.prepare(query).run(guild.id, tierName);
      });
    });

    await withStep(ctx, "reply", async () => {
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
    });
  } catch (err) {
    logger.error({ evt: "remove_movie_tier_error", err }, "Error removing movie tier");
    await interaction.reply({
      content: `❌ Failed to remove movie tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleAddGameTier(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const tierName = interaction.options.getString("tier_name", true);
  const role = interaction.options.getRole("role", true);
  const gamesRequired = interaction.options.getInteger("games_required", true);

  // Pre-flight check: verify bot can manage this role
  const check = canManageRoleSync(guild, role as Role);
  if (!check.canManage) {
    await interaction.reply({
      content: `Cannot configure this role: ${check.reason}\n\nPlease choose a role that is below the bot's highest role.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await withStep(ctx, "insert_tier", async () => {
      const query = `
        INSERT OR REPLACE INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold)
        VALUES (?, 'game_night', ?, ?, ?)
      `;
      withSql(ctx, query, () => {
        db.prepare(query).run(guild.id, tierName, role.id, gamesRequired);
      });

      logger.info({
        evt: "add_game_tier",
        guildId: guild.id,
        tierName,
        roleId: role.id,
        gamesRequired,
        invokedBy: interaction.user.id,
      }, `Added game tier: ${tierName} (${gamesRequired} games)`);
    });

    await withStep(ctx, "reply", async () => {
      await interaction.reply({
        content: `✅ Added game tier **${tierName}** (${gamesRequired} game nights) → **${role.name}**`,
        ephemeral: true,
      });
    });
  } catch (err) {
    logger.error({ evt: "add_game_tier_error", err }, "Error adding game tier");
    await interaction.reply({
      content: `❌ Failed to add game tier: ${err}`,
      ephemeral: true,
    });
  }
}

async function handleRemoveGameTier(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const tierName = interaction.options.getString("tier_name", true);

  try {
    const result = await withStep(ctx, "delete_tier", async () => {
      const query = `
        DELETE FROM role_tiers
        WHERE guild_id = ? AND tier_type = 'game_night' AND tier_name = ?
      `;
      return withSql(ctx, query, () => {
        return db.prepare(query).run(guild.id, tierName);
      });
    });

    await withStep(ctx, "reply", async () => {
      if (result.changes > 0) {
        logger.info({
          evt: "remove_game_tier",
          guildId: guild.id,
          tierName,
          invokedBy: interaction.user.id,
        }, `Removed game tier ${tierName}`);

        await interaction.reply({
          content: `✅ Removed game tier **${tierName}**`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `⚠️ No game tier found with name **${tierName}**`,
          ephemeral: true,
        });
      }
    });
  } catch (err) {
    logger.error({ evt: "remove_game_tier_error", err }, "Error removing game tier");
    await interaction.reply({
      content: `❌ Failed to remove game tier: ${err}`,
      ephemeral: true,
    });
  }
}
