/**
 * Pawtropolis Tech -- src/commands/config/index.ts
 * WHAT: Main execute router for /config command.
 * WHY: Routes subcommands to appropriate handlers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  MessageFlags,
  requireMinRole,
  ROLE_IDS,
  type CommandContext,
} from "./shared.js";

// Re-export command data
export { data } from "./data.js";

// Import handlers
import {
  executeSetModRoles,
  executeSetGatekeeper,
  executeSetReviewerRole,
  executeSetLeadershipRole,
  executeSetBotDevRole,
  executeSetNotifyRole,
} from "./setRoles.js";

import {
  executeSetModmailLogChannel,
  executeSetLogging,
  executeSetFlagsChannel,
  executeSetBackfillChannel,
  executeSetForumChannel,
  executeSetNotificationChannel,
  executeSetSupportChannel,
} from "./setChannels.js";

import {
  executeSetReviewRoles,
  executeSetDadMode,
  executeSetSkullMode,
  executeSetPingDevOnApp,
  executeSetBannerSyncToggle,
  executeSetAvatarScanToggle,
  executeSetListopenOutput,
  executeSetModmailDelete,
  executeSetNotifyMode,
} from "./setFeatures.js";

import {
  executeSetFlagsThreshold,
  executeSetReapplyCooldown,
  executeSetMinAccountAge,
  executeSetMinJoinAge,
  executeSetGateAnswerLength,
  executeSetBannerSyncInterval,
  executeSetModmailForwardSize,
  executeSetRetryConfig,
  executeSetCircuitBreaker,
  executeSetAvatarThresholds,
  executeSetFlagRateLimit,
  executeSetNotifyConfig,
  executeSetAvatarScanAdvanced,
} from "./setAdvanced.js";

import {
  executeSetArtistRotation,
  executeGetArtistRotation,
  executeSetArtistIgnoredUsers,
} from "./artist.js";

import {
  executeSetMovieThreshold,
  executeGetMovieConfig,
} from "./movie.js";

import {
  executePokeAddCategory,
  executePokeRemoveCategory,
  executePokeExcludeChannel,
  executePokeIncludeChannel,
  executePokeList,
} from "./poke.js";

import {
  executeGetLogging,
  executeGetFlags,
  executeView,
} from "./get.js";

import { executeIsitreal } from "./isitreal.js";
import { executeToggleApis } from "./toggleapis.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * execute
   * WHAT: Main command handler for /config — routes to appropriate subcommand.
   * WHY: Provides centralized configuration management.
   */
  const { interaction } = ctx;

  if (!interaction.guildId || !interaction.guild) {
    ctx.step("invalid_scope");
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  ctx.step("permission_check");
  // Require Administrator+ role
  if (!requireMinRole(interaction, ROLE_IDS.ADMINISTRATOR, {
    command: "config",
    description: "Modifies server configuration settings.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.ADMINISTRATOR }],
  })) return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === "set") {
    if (subcommand === "mod_roles") {
      await executeSetModRoles(ctx);
    } else if (subcommand === "gatekeeper") {
      await executeSetGatekeeper(ctx);
    } else if (subcommand === "modmail_log_channel") {
      await executeSetModmailLogChannel(ctx);
    } else if (subcommand === "review_roles") {
      await executeSetReviewRoles(ctx);
    } else if (subcommand === "logging") {
      await executeSetLogging(ctx);
    } else if (subcommand === "flags_channel") {
      await executeSetFlagsChannel(ctx);
    } else if (subcommand === "dadmode") {
      await executeSetDadMode(ctx);
    } else if (subcommand === "skullmode") {
      await executeSetSkullMode(ctx);
    } else if (subcommand === "pingdevonapp") {
      await executeSetPingDevOnApp(ctx);
    } else if (subcommand === "movie_threshold") {
      await executeSetMovieThreshold(ctx);
    } else if (subcommand === "artist_rotation") {
      await executeSetArtistRotation(ctx);
    } else if (subcommand === "artist_ignored_users") {
      await executeSetArtistIgnoredUsers(ctx);
    } else if (subcommand === "backfill_channel") {
      await executeSetBackfillChannel(ctx);
    } else if (subcommand === "bot_dev_role") {
      await executeSetBotDevRole(ctx);
    } else if (subcommand === "banner_sync_toggle") {
      await executeSetBannerSyncToggle(ctx);
    } else if (subcommand === "reviewer_role") {
      await executeSetReviewerRole(ctx);
    } else if (subcommand === "leadership_role") {
      await executeSetLeadershipRole(ctx);
    } else if (subcommand === "notify_role") {
      await executeSetNotifyRole(ctx);
    } else if (subcommand === "forum_channel") {
      await executeSetForumChannel(ctx);
    } else if (subcommand === "notification_channel") {
      await executeSetNotificationChannel(ctx);
    } else if (subcommand === "support_channel") {
      await executeSetSupportChannel(ctx);
    } else if (subcommand === "avatar_scan_toggle") {
      await executeSetAvatarScanToggle(ctx);
    } else if (subcommand === "listopen_output") {
      await executeSetListopenOutput(ctx);
    } else if (subcommand === "modmail_delete") {
      await executeSetModmailDelete(ctx);
    } else if (subcommand === "notify_mode") {
      await executeSetNotifyMode(ctx);
    }
  } else if (subcommandGroup === "set-advanced") {
    // Advanced/timing settings
    if (subcommand === "flags_threshold") {
      await executeSetFlagsThreshold(ctx);
    } else if (subcommand === "reapply_cooldown") {
      await executeSetReapplyCooldown(ctx);
    } else if (subcommand === "min_account_age") {
      await executeSetMinAccountAge(ctx);
    } else if (subcommand === "min_join_age") {
      await executeSetMinJoinAge(ctx);
    } else if (subcommand === "gate_answer_length") {
      await executeSetGateAnswerLength(ctx);
    } else if (subcommand === "banner_sync_interval") {
      await executeSetBannerSyncInterval(ctx);
    } else if (subcommand === "modmail_forward_size") {
      await executeSetModmailForwardSize(ctx);
    } else if (subcommand === "retry_config") {
      await executeSetRetryConfig(ctx);
    } else if (subcommand === "circuit_breaker") {
      await executeSetCircuitBreaker(ctx);
    } else if (subcommand === "flag_rate_limit") {
      await executeSetFlagRateLimit(ctx);
    } else if (subcommand === "notify_config") {
      await executeSetNotifyConfig(ctx);
    } else if (subcommand === "avatar_thresholds") {
      await executeSetAvatarThresholds(ctx);
    } else if (subcommand === "avatar_scan_advanced") {
      await executeSetAvatarScanAdvanced(ctx);
    }
  } else if (subcommandGroup === "get") {
    if (subcommand === "logging") {
      await executeGetLogging(ctx);
    } else if (subcommand === "flags") {
      await executeGetFlags(ctx);
    } else if (subcommand === "movie_config") {
      await executeGetMovieConfig(ctx);
    } else if (subcommand === "artist_rotation") {
      await executeGetArtistRotation(ctx);
    }
  } else if (subcommandGroup === "poke") {
    if (subcommand === "add-category") {
      await executePokeAddCategory(ctx);
    } else if (subcommand === "remove-category") {
      await executePokeRemoveCategory(ctx);
    } else if (subcommand === "exclude-channel") {
      await executePokeExcludeChannel(ctx);
    } else if (subcommand === "include-channel") {
      await executePokeIncludeChannel(ctx);
    } else if (subcommand === "list") {
      await executePokeList(ctx);
    }
  } else if (subcommand === "view") {
    await executeView(ctx);
  } else if (subcommand === "isitreal") {
    await executeIsitreal(ctx);
  } else if (subcommand === "toggleapis") {
    await executeToggleApis(ctx);
  }
}
