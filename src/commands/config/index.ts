/**
 * Pawtropolis Tech -- src/commands/config/index.ts
 * WHAT: Main execute router for /config command.
 * WHY: Routes subcommands to appropriate handlers.
 * FLOWS:
 *  - /config set <setting> -> Modify a configuration value
 *  - /config set-advanced <setting> -> Modify advanced/timing settings
 *  - /config get <setting> -> View a configuration value
 *  - /config poke <action> -> Manage poke system
 *  - /config view -> View all configuration
 *  - /config isitreal -> Configure AI detection
 *  - /config toggleapis -> Toggle external API integrations
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

// ============================================================================
// HANDLER IMPORTS
// ============================================================================

// Set: Roles
import {
  executeSetModRoles,
  executeSetGatekeeper,
  executeSetReviewerRole,
  executeSetLeadershipRole,
  executeSetBotDevRole,
  executeSetNotifyRole,
} from "./setRoles.js";

// Set: Channels
import {
  executeSetModmailLogChannel,
  executeSetLogging,
  executeSetFlagsChannel,
  executeSetBackfillChannel,
  executeSetForumChannel,
  executeSetNotificationChannel,
  executeSetSupportChannel,
} from "./setChannels.js";

// Set: Features
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

// Set-Advanced: Timing & Thresholds
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

// Artist Rotation
import {
  executeSetArtistRotation,
  executeGetArtistRotation,
  executeSetArtistIgnoredUsers,
} from "./artist.js";

// Movie Night
import {
  executeSetMovieThreshold,
  executeGetMovieConfig,
} from "./movie.js";

// Game Night
import {
  executeSetGameThreshold,
  executeGetGameConfig,
} from "./game.js";

// Poke System
import {
  executePokeAddCategory,
  executePokeRemoveCategory,
  executePokeExcludeChannel,
  executePokeIncludeChannel,
  executePokeList,
} from "./poke.js";

// Get & View
import {
  executeGetLogging,
  executeGetFlags,
  executeView,
} from "./get.js";

// Utilities
import { executeIsitreal } from "./isitreal.js";
import { executeToggleApis } from "./toggleapis.js";

// ============================================================================
// EXECUTE HANDLER
// ============================================================================

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Validate guild scope
  if (!interaction.guildId || !interaction.guild) {
    ctx.step("invalid_scope");
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  // Permission check: Administrator+ role required
  ctx.step("permission_check");
  if (!requireMinRole(interaction, ROLE_IDS.ADMINISTRATOR, {
    command: "config",
    description: "Modifies server configuration settings.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.ADMINISTRATOR }],
  })) return;

  // Build route key for switch-based routing
  ctx.step("route");
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  const routeKey = subcommandGroup ? `${subcommandGroup}:${subcommand}` : subcommand;

  switch (routeKey) {
    // =========================================================================
    // SET GROUP: Basic Configuration
    // =========================================================================
    case "set:mod_roles":
      await executeSetModRoles(ctx);
      break;
    case "set:gatekeeper":
      await executeSetGatekeeper(ctx);
      break;
    case "set:modmail_log_channel":
      await executeSetModmailLogChannel(ctx);
      break;
    case "set:review_roles":
      await executeSetReviewRoles(ctx);
      break;
    case "set:logging":
      await executeSetLogging(ctx);
      break;
    case "set:flags_channel":
      await executeSetFlagsChannel(ctx);
      break;
    case "set:dadmode":
      await executeSetDadMode(ctx);
      break;
    case "set:skullmode":
      await executeSetSkullMode(ctx);
      break;
    case "set:pingdevonapp":
      await executeSetPingDevOnApp(ctx);
      break;
    case "set:movie_threshold":
      await executeSetMovieThreshold(ctx);
      break;
    case "set:artist_rotation":
      await executeSetArtistRotation(ctx);
      break;
    case "set:artist_ignored_users":
      await executeSetArtistIgnoredUsers(ctx);
      break;
    case "set:backfill_channel":
      await executeSetBackfillChannel(ctx);
      break;
    case "set:bot_dev_role":
      await executeSetBotDevRole(ctx);
      break;
    case "set:banner_sync_toggle":
      await executeSetBannerSyncToggle(ctx);
      break;
    case "set:reviewer_role":
      await executeSetReviewerRole(ctx);
      break;
    case "set:leadership_role":
      await executeSetLeadershipRole(ctx);
      break;
    case "set:notify_role":
      await executeSetNotifyRole(ctx);
      break;
    case "set:forum_channel":
      await executeSetForumChannel(ctx);
      break;
    case "set:notification_channel":
      await executeSetNotificationChannel(ctx);
      break;
    case "set:support_channel":
      await executeSetSupportChannel(ctx);
      break;
    case "set:avatar_scan_toggle":
      await executeSetAvatarScanToggle(ctx);
      break;
    case "set:listopen_output":
      await executeSetListopenOutput(ctx);
      break;
    case "set:modmail_delete":
      await executeSetModmailDelete(ctx);
      break;
    case "set:notify_mode":
      await executeSetNotifyMode(ctx);
      break;

    // =========================================================================
    // SET-ADVANCED GROUP: Timing & Thresholds
    // =========================================================================
    case "set-advanced:flags_threshold":
      await executeSetFlagsThreshold(ctx);
      break;
    case "set-advanced:reapply_cooldown":
      await executeSetReapplyCooldown(ctx);
      break;
    case "set-advanced:min_account_age":
      await executeSetMinAccountAge(ctx);
      break;
    case "set-advanced:min_join_age":
      await executeSetMinJoinAge(ctx);
      break;
    case "set-advanced:gate_answer_length":
      await executeSetGateAnswerLength(ctx);
      break;
    case "set-advanced:banner_sync_interval":
      await executeSetBannerSyncInterval(ctx);
      break;
    case "set-advanced:modmail_forward_size":
      await executeSetModmailForwardSize(ctx);
      break;
    case "set-advanced:retry_config":
      await executeSetRetryConfig(ctx);
      break;
    case "set-advanced:circuit_breaker":
      await executeSetCircuitBreaker(ctx);
      break;
    case "set-advanced:flag_rate_limit":
      await executeSetFlagRateLimit(ctx);
      break;
    case "set-advanced:notify_config":
      await executeSetNotifyConfig(ctx);
      break;
    case "set-advanced:avatar_thresholds":
      await executeSetAvatarThresholds(ctx);
      break;
    case "set-advanced:avatar_scan_advanced":
      await executeSetAvatarScanAdvanced(ctx);
      break;
    case "set-advanced:game_threshold":
      await executeSetGameThreshold(ctx);
      break;

    // =========================================================================
    // GET GROUP: View Configuration
    // =========================================================================
    case "get:logging":
      await executeGetLogging(ctx);
      break;
    case "get:flags":
      await executeGetFlags(ctx);
      break;
    case "get:movie_config":
      await executeGetMovieConfig(ctx);
      break;
    case "get:game_config":
      await executeGetGameConfig(ctx);
      break;
    case "get:artist_rotation":
      await executeGetArtistRotation(ctx);
      break;

    // =========================================================================
    // POKE GROUP: Poke System Management
    // =========================================================================
    case "poke:add-category":
      await executePokeAddCategory(ctx);
      break;
    case "poke:remove-category":
      await executePokeRemoveCategory(ctx);
      break;
    case "poke:exclude-channel":
      await executePokeExcludeChannel(ctx);
      break;
    case "poke:include-channel":
      await executePokeIncludeChannel(ctx);
      break;
    case "poke:list":
      await executePokeList(ctx);
      break;

    // =========================================================================
    // TOP-LEVEL SUBCOMMANDS
    // =========================================================================
    case "view":
      await executeView(ctx);
      break;
    case "isitreal":
      await executeIsitreal(ctx);
      break;
    case "toggleapis":
      await executeToggleApis(ctx);
      break;

    // =========================================================================
    // DEFAULT: Unknown Command
    // =========================================================================
    default:
      await interaction.reply({
        content: `Unknown configuration option: \`${routeKey}\``,
        flags: MessageFlags.Ephemeral,
      });
  }
}
