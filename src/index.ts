/**
 * Pawtropolis Tech — src/index.ts
 * WHAT: Main process entrypoint. Boots the Discord client, routes interactions, and syncs commands.
 * WHY: Central orchestration so future-me can see startup and hot path routing in one place.
 * DISCLAIMER: if you're reading this at 2am, go to bed
 * FLOWS:
 *  - Ready: ensure schema → log identity → per‑guild command sync
 *  - Interaction: detect kind → run wrapped handler → error card on failure
 *  - Router: customId regexes for buttons/modals (HEX6 codes for humans)
 * DOCS:
 *  - discord.js v14 (interactions): https://discord.js.org/#/docs/discord.js/main/class/Interaction
 *  - Slash commands (Discord dev docs): https://discord.com/developers/docs/interactions/application-commands
 *  - Interaction replies (flags, ephemeral): https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - REST Routes utility: https://discord.js.org/#/docs/rest/main/class/REST
 *  - Node ESM modules: https://nodejs.org/api/esm.html
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 *
 * NOTE: comments here are intentionally noisy. I like future-me to have breadcrumbs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  initializeSentry,
  addBreadcrumb,
  setUser,
  setTag,
  captureException,
} from "./lib/sentry.js";
import { UNCAUGHT_EXCEPTION_EXIT_DELAY_MS } from "./lib/constants.js";
initializeSentry();

import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  MessageFlags,
  ChannelType,
  Options,
  type ChatInputCommandInteraction,
  Events,
} from "discord.js";
import { logger } from "./lib/logger.js";

// ===== Global Error Handlers =====
// WHAT: Catch unhandled rejections and exceptions at process level
// WHY: Prevents silent crashes, ensures errors are logged and reported to Sentry
// DOCS: https://nodejs.org/api/process.html#event-uncaughtexception

process.on("unhandledRejection", (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error(
    { evt: "unhandled_rejection", err: error, promise },
    "[process] Unhandled promise rejection"
  );
  captureException(error, { context: "unhandledRejection" });
  // Don't exit - Discord.js can recover from most rejections
});

process.on("uncaughtException", (error, origin) => {
  logger.error(
    { evt: "uncaught_exception", err: error, origin },
    "[process] Uncaught exception - bot may be in unstable state"
  );
  captureException(error, { context: "uncaughtException", origin });
  // For uncaught exceptions, we should exit after logging
  // Give Sentry time to flush, then exit
  setTimeout(() => process.exit(1), UNCAUGHT_EXCEPTION_EXIT_DELAY_MS);
});

import { isOwner } from "./lib/owner.js";
import { TRACE_INTERACTIONS, OWNER_IDS } from "./config.js";
import type { ModalSubmitInteraction } from "discord.js";
import { wrapEvent } from "./lib/eventWrap.js";
import { env } from "./lib/env.js";
import * as health from "./commands/health.js";
import * as gate from "./commands/gate.js";
import * as update from "./commands/update.js";
import * as config from "./commands/config.js";
import * as database from "./commands/database.js";
import { handleStartButton, handleGateModalSubmit, handleDoneButton } from "./features/gate.js";
import {
  handleReviewButton,
  handleRejectModal,
  handleAcceptModal,
  handleKickModal,
  handleUnclaimModal,
  handleModmailButton,
  handlePermRejectButton,
  handlePermRejectModal,
  handleCopyUidButton,
  handlePingInUnverified,
  handleDeletePing,
} from "./features/review.js";
import {
  handleModmailOpenButton,
  handleModmailCloseButton,
  executeModmailCommand,
  getOpenTicketByUser,
  getTicketByThread,
  routeThreadToDm,
  routeDmToThread,
  retrofitAllGuildsOnStartup,
  hydrateOpenModmailThreadsOnStartup,
  OPEN_MODMAIL_THREADS,
} from "./features/modmail.js";
import type { ModmailTicket } from "./features/modmail/types.js";
import { initializeBannerSync } from "./features/bannerSync.js";
import { forumPostNotify } from "./events/forumPostNotify.js";
import { armWatchdog, ensureDeferred, wrapCommand } from "./lib/cmdWrap.js";
import { db } from "./db/db.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ctx as reqCtx, newTraceId, runWithCtx } from "./lib/reqctx.js";
import { postErrorCard } from "./lib/errorCard.js";
import {
  BTN_DECIDE_RE,
  BTN_MODMAIL_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_PING_UNVERIFIED_RE,
  BTN_DBRECOVER_RE,
  BTN_AUDIT_RE,
  identifyModalRoute,
} from "./lib/modalPatterns.js";
import { REST, Routes } from "discord.js";
import { syncCommandsToAllGuilds, syncCommandsToGuild } from "./commands/sync.js";
import { logActionPretty } from "./logging/pretty.js";
import { handleDbRecoveryButton } from "./features/dbRecoveryButtons.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // For movie night attendance tracking
  ],
  partials: [Partials.Channel],
  // Cache limits to prevent unbounded memory growth in large servers
  // See: https://discordjs.guide/popular-topics/caching.html#limiting-cache-size
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    // Keep reasonable limits for commonly accessed data
    MessageManager: 200,        // Recent messages per channel
    GuildMemberManager: 500,    // Members per guild (we need members for role checks)
    UserManager: 500,           // Users across all guilds
    PresenceManager: 0,         // We don't use presence data
    VoiceStateManager: 200,     // For movie night tracking
    ReactionManager: 0,         // We don't use reactions
    ReactionUserManager: 0,     // We don't use reaction users
    GuildStickerManager: 0,     // We don't use stickers
    GuildScheduledEventManager: 0, // We don't use scheduled events
    StageInstanceManager: 0,    // We don't use stages
    ThreadMemberManager: 50,    // Minimal thread member caching
  }),
});

const commands = new Collection<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
>();
commands.set(health.data.name, wrapCommand("health", health.execute));
commands.set(gate.data.name, wrapCommand("gate", gate.execute));
commands.set(gate.acceptData.name, wrapCommand("accept", gate.executeAccept));
commands.set(gate.rejectData.name, wrapCommand("reject", gate.executeReject));
commands.set(gate.kickData.name, wrapCommand("kick", gate.executeKick));
commands.set(gate.unclaimData.name, wrapCommand("unclaim", gate.executeUnclaim));
commands.set(update.data.name, wrapCommand("update", update.execute));
commands.set(config.data.name, wrapCommand("config", config.execute));
commands.set(database.data.name, wrapCommand("database", database.execute));
commands.set("modmail", wrapCommand("modmail", executeModmailCommand));

// Stats command (consolidated analytics)
import * as stats from "./commands/stats/index.js";
commands.set(stats.data.name, wrapCommand("stats", stats.execute));

// Send command (anonymous staff messages)
import * as send from "./commands/send.js";
commands.set(send.data.name, wrapCommand("send", send.execute));

// Resetdata command (metrics epoch reset)
import * as resetdata from "./commands/resetdata.js";
commands.set(resetdata.data.name, wrapCommand("resetdata", resetdata.execute));

// Flag command (manual user flagging)
import * as flag from "./commands/flag.js";
commands.set(flag.data.name, wrapCommand("flag", flag.execute));

// Audit command (bot account detection)
import * as audit from "./commands/audit.js";
commands.set(audit.data.name, wrapCommand("audit", audit.execute));

// AI detection command
import * as isitreal from "./commands/isitreal.js";
commands.set(isitreal.data.name, wrapCommand("isitreal", isitreal.execute));

// Unblock command (remove permanent rejection)
import * as unblock from "./commands/unblock.js";
commands.set(unblock.data.name, wrapCommand("unblock", unblock.execute));


// Backfill command (populate message_activity table)
import * as backfill from "./commands/backfill.js";
commands.set(backfill.data.name, wrapCommand("backfill", backfill.execute));

import * as sample from "./commands/sample.js";
commands.set(sample.data.name, wrapCommand("sample", sample.execute));

// Listopen command (moderator's claimed apps)
import * as listopen from "./commands/listopen.js";
commands.set(listopen.data.name, wrapCommand("listopen", listopen.execute));

// Purge command (bulk message deletion with password)
import * as purge from "./commands/purge.js";
commands.set(purge.data.name, wrapCommand("purge", purge.execute));


// Poke command (owner-only multi-channel ping)
import * as poke from "./commands/poke.js";
commands.set(poke.data.name, wrapCommand("poke", poke.execute));

// Forum post notification config commands (admin-only)
import * as setNotifyConfig from "./commands/review/setNotifyConfig.js";
import * as getNotifyConfig from "./commands/review/getNotifyConfig.js";
commands.set(setNotifyConfig.data.name, wrapCommand("review-set-notify-config", setNotifyConfig.execute));
commands.set(getNotifyConfig.data.name, wrapCommand("review-get-notify-config", getNotifyConfig.execute));

// Listopen output mode command (admin-only)
import * as reviewSetListopenOutput from "./commands/review-set-listopen-output.js";
commands.set(reviewSetListopenOutput.data.name, wrapCommand("review-set-listopen-output", reviewSetListopenOutput.execute));

// Role automation commands
import * as movie from "./commands/movie.js";
import * as roles from "./commands/roles.js";
import * as panic from "./commands/panic.js";
import * as event from "./commands/event/index.js";
commands.set(movie.data.name, wrapCommand("movie", movie.execute));
commands.set(roles.data.name, wrapCommand("roles", roles.execute));
commands.set(panic.data.name, wrapCommand("panic", panic.execute));
commands.set(event.data.name, wrapCommand("event", event.execute));

// Search command (user application history lookup)
import * as search from "./commands/search.js";
commands.set(search.data.name, wrapCommand("search", search.execute));


// Artist rotation commands
import * as artistqueue from "./commands/artistqueue.js";
import * as redeemreward from "./commands/redeemreward.js";
import * as art from "./commands/art.js";
commands.set(artistqueue.data.name, wrapCommand("artistqueue", artistqueue.execute));
commands.set(redeemreward.data.name, wrapCommand("redeemreward", redeemreward.execute));
commands.set(art.data.name, wrapCommand("art", art.execute));

// Help command (interactive help system)
import * as help from "./commands/help/index.js";
commands.set(help.data.name, wrapCommand("help", help.execute));

client.once(Events.ClientReady, async () => {
  // schema self-heal before anything else
  // sudo make it work
  try {
    const {
      ensureAvatarScanSchema,
      ensureApplicationPermaRejectColumn,
      ensureOpenModmailTable,
      ensureReviewActionFreeText,
      ensureApplicationStatusIndex,
      ensureActionLogSchema,
      ensureActionLogFreeText,
      ensureManualFlagColumns,
      ensureSearchIndexes,
      ensurePanicModeColumn,
      ensureApplicationStaleAlertColumns,
      ensureArtistRotationConfigColumns,
    } = await import("./db/ensure.js");
    const { ensureBotStatusSchema } = await import("./features/statusStore.js");
    const {
      ensureUnverifiedChannelColumn,
      ensureWelcomeTemplateColumn,
      ensureWelcomeChannelsColumns,
      ensureModRolesColumns,
      ensureDadModeColumns,
      ensureSkullModeColumns,
      ensureListopenPublicOutputColumn,
    } = await import("./lib/config.js");
    ensureAvatarScanSchema();
    ensureApplicationPermaRejectColumn();
    ensureOpenModmailTable();
    ensureReviewActionFreeText();
    ensureApplicationStatusIndex();
    ensureActionLogSchema();
    ensureActionLogFreeText();
    ensureManualFlagColumns();
    ensureSearchIndexes();
    ensurePanicModeColumn();
    ensureApplicationStaleAlertColumns();
    ensureArtistRotationConfigColumns();
    ensureBotStatusSchema();
    // Config column migrations (moved from getConfig/upsertConfig for performance)
    ensureUnverifiedChannelColumn();
    ensureWelcomeTemplateColumn();
    ensureWelcomeChannelsColumns();
    ensureModRolesColumns();
    ensureDadModeColumns();
    ensureSkullModeColumns();
    ensureListopenPublicOutputColumn();
  } catch (err) {
    logger.error({ err }, "[startup] schema ensure failed");
  }

  // Load panic mode state from database (survives restarts now)
  try {
    const { loadPanicState } = await import("./features/panicStore.js");
    loadPanicState();
  } catch (err) {
    logger.error({ err }, "[startup] panic state load failed");
  }

  // Recover movie night sessions from database (crash recovery)
  try {
    const { recoverPersistedSessions, startSessionPersistence } =
      await import("./features/movieNight.js");
    const { events, sessions } = recoverPersistedSessions();
    if (events > 0) {
      logger.info({ events, sessions }, "[startup] Recovered movie night sessions");
    }
    startSessionPersistence();
  } catch (err) {
    logger.error({ err }, "[startup] Movie session recovery failed");
  }

  // Recover game night sessions from database (crash recovery)
  try {
    const { recoverPersistedGameSessions, startGameSessionPersistence } =
      await import("./features/events/gameNight.js");
    const { events, sessions } = recoverPersistedGameSessions();
    if (events > 0) {
      logger.info({ events, sessions }, "[startup] Recovered game night sessions");
    }
    startGameSessionPersistence();
  } catch (err) {
    logger.error({ err }, "[startup] Game session recovery failed");
  }

  // Hydrate open modmail threads from database into memory
  // WHAT: Populates OPEN_MODMAIL_THREADS set from open_modmail table
  // WHY: Enables efficient O(1) lookups in messageCreate to route modmail messages
  // WHEN: Must run before message handlers start processing
  try {
    await hydrateOpenModmailThreadsOnStartup(client);
  } catch (err) {
    logger.error({ err }, "[startup] modmail thread hydration failed");
  }

  // Heal legacy parent overwrites so moderators can speak in older modmail threads
  // WHAT: Ensures parent channels grant SendMessagesInThreads to configured mod roles
  // WHY: Private threads require BOTH thread membership AND parent channel permissions
  // WHEN: Run once at startup to retrofit existing threads
  // DOCS: See retrofitAllGuildsOnStartup in src/features/modmail.ts
  try {
    await retrofitAllGuildsOnStartup(client);
  } catch (err) {
    logger.error({ err }, "[startup] modmail retrofit failed");
  }

  // Startup permission check: verify logging channel access
  // WHAT: Check if bot has permissions to post to configured logging channels
  // WHY: Warn early if logging will fail; allows admins to fix perms before actions occur
  // HOW: For each guild, resolve logging channel + validate SendMessages + EmbedLinks
  // DOCS: See getLoggingChannel in src/features/logger.ts
  try {
    const { getLoggingChannel } = await import("./features/logger.js");
    for (const [guildId, guild] of client.guilds.cache) {
      const channel = await getLoggingChannel(guild);
      if (!channel) {
        const { getLoggingChannelId } = await import("./config/loggingStore.js");
        const configuredChannelId = getLoggingChannelId(guildId);
        if (configuredChannelId) {
          logger.warn(
            { guildId, channelId: configuredChannelId },
            "[startup] logging channel configured but unavailable - check channel exists and bot has SendMessages + EmbedLinks permissions"
          );
        } else if (!process.env.LOGGING_CHANNEL) {
          logger.info(
            { guildId },
            "[startup] no logging channel configured - actions will be logged as JSON to console"
          );
        }
      } else {
        logger.info(
          { guildId, channelId: channel.id, channelName: channel.name },
          "[startup] logging channel verified"
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "[startup] logging channel check failed");
  }

  // ========================================
  // WEB SERVER REMOVED - 2025-11-18
  // ========================================
  // The web control panel has been removed.
  // All bot functionality remains via Discord slash commands.
  // Archive: /home/ubuntu/archives/pawtropolis-web-archive-20251118-143353
  // See: ARCHITECTURE-DIAGRAMS.md for system documentation
  // ========================================

  // ===== Scheduler Initialization =====
  // Start mod metrics periodic refresh scheduler
  // WHAT: Recalculates mod_metrics table every 15 minutes
  // WHY: Keeps performance analytics current without manual triggers
  // DOCS: See src/scheduler/modMetricsScheduler.ts
  try {
    const { startModMetricsScheduler } = await import("./scheduler/modMetricsScheduler.js");
    startModMetricsScheduler(client);
  } catch (err) {
    logger.warn(
      { err },
      "[startup] mod metrics scheduler failed to start - continuing without periodic refresh"
    );
  }

  // Start ops health periodic check scheduler
  // WHAT: Runs health checks every 60s (configurable) to monitor bot health
  // WHY: Early detection of issues (high queue backlog, WS ping, PM2 down, DB corruption)
  // DOCS: See src/scheduler/opsHealthScheduler.ts
  try {
    const { startOpsHealthScheduler } = await import("./scheduler/opsHealthScheduler.js");
    const { setHealthClient } = await import("./features/opsHealth.js");
    setHealthClient(client);
    startOpsHealthScheduler(client);
  } catch (err) {
    logger.warn(
      { err },
      "[startup] ops health scheduler failed to start - continuing without health monitoring"
    );
  }

  // Start stale application alert scheduler
  // WHAT: Checks for unclaimed applications every 30 minutes
  // WHY: Alerts Gatekeepers when applications have been waiting 24+ hours
  // DOCS: See src/scheduler/staleApplicationCheck.ts
  try {
    const { startStaleApplicationScheduler } = await import("./scheduler/staleApplicationCheck.js");
    startStaleApplicationScheduler(client);
  } catch (err) {
    logger.warn(
      { err },
      "[startup] stale application scheduler failed to start - continuing without stale alerts"
    );
  }

  // Initialize banner sync (bot profile + website)
  try {
    await initializeBannerSync(client);
  } catch (err) {
    logger.warn(
      { err },
      "[startup] banner sync failed to initialize - continuing without banner sync"
    );
  }

  // ===== Coordinated Graceful Shutdown =====
  // WHAT: Single handler for SIGTERM/SIGINT that shuts down all subsystems in order
  // WHY: Prevents data loss, ensures transcripts are flushed, stops schedulers cleanly
  // ORDER: 1) Log, 2) Stop schedulers, 3) Cleanup features, 4) Remove listeners, 5) Destroy client, 6) Close DB
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, "[shutdown] Already shutting down, ignoring");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, "[shutdown] Graceful shutdown initiated");

    try {
      // 1. Stop schedulers
      const { stopModMetricsScheduler } = await import("./scheduler/modMetricsScheduler.js");
      stopModMetricsScheduler();

      const { stopOpsHealthScheduler } = await import("./scheduler/opsHealthScheduler.js");
      stopOpsHealthScheduler();

      const { stopStaleApplicationScheduler } = await import("./scheduler/staleApplicationCheck.js");
      stopStaleApplicationScheduler();

      // 2. Flush message activity buffer before shutdown
      try {
        const { flushOnShutdown } = await import("./features/messageActivityLogger.js");
        flushOnShutdown();
        logger.debug("[shutdown] Message activity buffer flushed");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Message activity flush failed (non-fatal)");
      }

      // 3. Cleanup banner sync listeners
      try {
        const { cleanupBannerSync } = await import("./features/bannerSync.js");
        cleanupBannerSync(client);
        logger.debug("[shutdown] Banner sync listeners cleaned up");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Banner sync cleanup failed (non-fatal)");
      }

      // 4. Cleanup notify limiter (stops cleanup interval)
      try {
        const { notifyLimiter, InMemoryNotifyLimiter } = await import("./lib/notifyLimiter.js");
        if (notifyLimiter instanceof InMemoryNotifyLimiter) {
          notifyLimiter.destroy();
          logger.debug("[shutdown] Notify limiter cleanup interval stopped");
        }
      } catch (err) {
        logger.warn({ err }, "[shutdown] Notify limiter cleanup failed (non-fatal)");
      }

      // 5. Cleanup command-level intervals (flag cooldowns, modstats rate limiter)
      try {
        const { cleanupFlagCooldowns } = await import("./commands/flag.js");
        cleanupFlagCooldowns();
        logger.debug("[shutdown] Flag cooldowns cleanup complete");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Flag cooldowns cleanup failed (non-fatal)");
      }

      try {
        const { cleanupStatsRateLimiter } = await import("./commands/stats/index.js");
        cleanupStatsRateLimiter();
        logger.debug("[shutdown] Stats rate limiter cleanup complete");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Stats rate limiter cleanup failed (non-fatal)");
      }

      // 6. Persist movie sessions before shutdown
      try {
        const { persistAllSessions, stopSessionPersistence } =
          await import("./features/movieNight.js");
        persistAllSessions();
        stopSessionPersistence();
        logger.debug("[shutdown] Movie sessions persisted");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Movie session persist failed (non-fatal)");
      }

      // 7. Remove all event listeners before destroying client
      // WHY: Explicit cleanup prevents race conditions and makes shutdown behavior predictable
      client.removeAllListeners();
      logger.debug("[shutdown] Event listeners removed");

      // 8. Destroy Discord client (closes WebSocket connection)
      client.destroy();
      logger.debug("[shutdown] Discord client destroyed");

      // 9. Close database
      try {
        db.close();
        logger.debug("[shutdown] Database closed");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Database close failed (non-fatal)");
      }

      logger.info("[shutdown] Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "[shutdown] Error during graceful shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  logger.info({ tag: client.user?.tag, id: client.user?.id }, "Bot ready");

  if (client.user) {
    setTag("bot_id", client.user.id);
    setTag("bot_username", client.user.username);
  }

  addBreadcrumb({
    message: "Bot successfully connected to Discord",
    category: "bot",
    level: "info",
  });

  // Restore saved bot status/presence from DB
  // WHAT: Load last status from /update status and apply it
  // WHY: Keeps status consistent across restarts
  // DOCS: See src/features/statusStore.ts
  try {
    const { getStatus } = await import("./features/statusStore.js");
    const saved = getStatus("global");
    if (saved && client.user) {
      const activities = [];

      // Add regular activity if present
      if (saved.activityType !== null && saved.activityText) {
        activities.push({ type: saved.activityType, name: saved.activityText });
      }

      // Add custom status if present (Custom type uses 'name' field)
      if (saved.customStatus) {
        activities.push({ type: 4, name: saved.customStatus }); // ActivityType.Custom = 4
      }

      if (activities.length > 0) {
        await client.user.setPresence({
          status: saved.status,
          activities,
        });
        logger.info(
          {
            activityType: saved.activityType,
            activityText: saved.activityText,
            customStatus: saved.customStatus,
            status: saved.status,
          },
          "[startup] bot presence restored from DB"
        );
      } else {
        logger.debug("[startup] no activities to restore, using default");
      }
    } else {
      logger.debug("[startup] no saved presence found, using default");
    }
  } catch (err) {
    logger.warn({ err }, "[startup] failed to restore bot presence - continuing with default");
  }

  logger.info({ ownerIds: OWNER_IDS }, "[startup] configured owners");
  logger.info({ enabled: TRACE_INTERACTIONS }, "[startup] interaction tracing");

  // speedrun% finding legacy SQL before prod does (only in dev, skip in prod/tests)
  // Skip in production to avoid runtime scanning overhead
  // Skip in tests to reduce noise
  const isVitest = !!process.env.VITEST_WORKER_ID;
  if (env.NODE_ENV !== "production" && !isVitest) {
    try {
      const bad: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile() && full.endsWith(".js")) {
            const text = readFileSync(full, "utf8");
            const hasLegacy = /__old/.test(text) && !/legacyRe/.test(text);
            const hasRename = /RENAME\s+TO/i.test(text);
            if (hasLegacy || hasRename) bad.push(full);
          }
        }
      };
      const distRoot = join(process.cwd(), "dist");
      if (existsSync(distRoot)) {
        walk(distRoot);
        if (bad.length) {
          logger.warn(
            { evt: "dist_scan_legacy_sql", files: bad },
            "dist contains __old references"
          );
        }
      }
    } catch {
      // best-effort scan only
    }
  }

  const questionStats = db
    .prepare(
      `
    SELECT guild_id, COUNT(*) as count
    FROM guild_question
    GROUP BY guild_id
    ORDER BY count DESC
  `
    )
    .all() as Array<{ guild_id: string; count: number }>;

  if (questionStats.length > 0) {
    for (const stat of questionStats) {
      logger.info(
        {
          evt: "gate_startup_questions",
          guildId: stat.guild_id,
          count: stat.count,
        },
        `[gate] loaded questions: ${stat.count} for guild ${stat.guild_id}`
      );
    }
  } else {
    logger.warn(
      {
        evt: "gate_startup_no_questions",
      },
      "[gate] No questions found in any guild. Insert rows into guild_question to configure."
    );
  }

  if (env.NODE_ENV === "development") {
    logger.info("Dev mode: use `npm run deploy:cmds`.");
  } else {
    logger.info("Prod mode: `npm run deploy:cmds`");
  }

  // Startup hydration: sync commands to all current guilds for instant availability.
  // Per-guild sync is fast (<1m) vs global commands (up to 1h propagation delay).
  // Docs: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-guild-application-commands
  const guildIds = Array.from(client.guilds.cache.keys());
  try {
    await syncCommandsToAllGuilds(guildIds);
  } catch (err) {
    logger.error({ err }, "[cmdsync] FAILED – see above; bot still starting");
  }
});

client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
  // Only allow Pawtropolis - auto-leave any other server
  const ALLOWED_GUILD = "896070888594759740";
  if (guild.id !== ALLOWED_GUILD) {
    logger.info({ guildId: guild.id, guildName: guild.name }, "[guild] auto-leaving unauthorized server");
    await guild.leave();
    return;
  }
  await syncCommandsToGuild(guild.id);
}));

// Optional: Clear commands on guildDelete to avoid leaving stale commands.
// Docs: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildDelete
client.on("guildDelete", wrapEvent("guildDelete", async (guild) => {
  // goodbye, old friend
  // Overwrite with empty array to clear commands.
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, guild.id), {
    body: [],
  });
  logger.info({ guildId: guild.id }, "[cmdsync] cleared commands for removed guild");

  // Cleanup guild-specific caches to prevent memory leaks (Issue #86)
  // WHAT: Remove in-memory cache entries for departed guild
  // WHY: Prevents unbounded memory growth from accumulating stale entries
  // NOTE: DB rows are preserved in case bot rejoins the guild
  try {
    const { clearPanicCache } = await import("./features/panicStore.js");
    const { clearConfigCache } = await import("./lib/config.js");
    const { clearLoggingCache } = await import("./config/loggingStore.js");
    const { clearFlaggerCache } = await import("./config/flaggerStore.js");

    clearPanicCache(guild.id);
    clearConfigCache(guild.id);
    clearLoggingCache(guild.id);
    clearFlaggerCache(guild.id);

    logger.info({ guildId: guild.id }, "[guildDelete] Cleared all caches for departed guild");
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[guildDelete] Cache cleanup failed (non-fatal)");
  }
}));

// Track member joins for join→submit ratio metrics + activity tracking (PR8)
// WHY: Enables analysis of verification funnel (how many joiners attempt verification)
// WHY (PR8): Track joined_at timestamp for Silent-Since-Join detection
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberAdd
client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => {
  if (!member.guild) return;

  await logActionPretty(member.guild, {
    actorId: member.id,
    action: "member_join",
  });

  logger.debug({ userId: member.id, guildId: member.guild.id }, "[metrics] member join logged");

  // Track join for Silent-Since-Join detection (PR8)
  const { trackJoin } = await import("./features/activityTracker.js");
  const joinedAt = Math.floor((member.joinedTimestamp || Date.now()) / 1000);
  trackJoin(member.guild.id, member.id, joinedAt);

  // Scan avatar for NSFW content on join
  // WHY: Catch NSFW avatars immediately when members join
  try {
    const { handleMemberJoin } = await import("./features/avatarNsfwMonitor.js");
    await handleMemberJoin(member);
  } catch (err) {
    logger.error({
      err,
      userId: member.id,
      guildId: member.guild.id,
    }, "[guildMemberAdd] Failed to scan avatar for NSFW");
  }
}));

// REVIEW CARD: Refresh pending apps when user leaves server
// WHY: Shows "Left server" warning on review cards so moderators know user is no longer in server
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberRemove
client.on("guildMemberRemove", wrapEvent("guildMemberRemove", async (member) => {
  if (!member.guild) return;

  // Find pending applications for this user
  const pendingApps = db.prepare(`
    SELECT id FROM application
    WHERE guild_id = ? AND user_id = ? AND status = 'submitted'
  `).all(member.guild.id, member.id) as Array<{ id: string }>;

  if (pendingApps.length === 0) return;

  logger.info({
    userId: member.id,
    guildId: member.guild.id,
    pendingApps: pendingApps.length,
  }, "[guildMemberRemove] refreshing review cards for departed user");

  // Refresh each pending application's review card
  const { ensureReviewMessage } = await import("./features/review/card.js");
  for (const app of pendingApps) {
    try {
      await ensureReviewMessage(client, app.id);
    } catch (err) {
      logger.error({
        err,
        appId: app.id,
        userId: member.id,
        guildId: member.guild.id,
      }, "[guildMemberRemove] failed to refresh review card");
    }
  }
}));

// Safety cleanup: Remove from open_modmail table AND OPEN_MODMAIL_THREADS set if thread is deleted
// WHY: Prevents orphaned entries and stale in-memory state if a thread is deleted outside the normal close flow
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-threadDelete
client.on("threadDelete", wrapEvent("threadDelete", async (thread) => {
  if (!thread.guildId) return;

  // Remove from in-memory set (fast, always succeeds)
  const wasInSet = OPEN_MODMAIL_THREADS.delete(thread.id);

  // Remove from database guard table
  const result = db
    .prepare(
      `
    DELETE FROM open_modmail
    WHERE thread_id = ?
  `
    )
    .run(thread.id);

  if (result.changes > 0 || wasInSet) {
    logger.info(
      { threadId: thread.id, guildId: thread.guildId, dbDeleted: result.changes > 0, setRemoved: wasInSet },
      "[modmail] cleaned up orphaned modmail state on threadDelete"
    );
  }
}));

// ROLE AUTOMATION: Level rewards when Amaribot assigns level roles
// WHY: Automatically grant token/ticket rewards when users level up
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberUpdate
import { handleLevelRoleAdded } from "./features/levelRewards.js";
import { handleArtistRoleChange } from "./features/artistRotation/index.js";
import { handleAvatarChange } from "./features/avatarNsfwMonitor.js";

client.on("guildMemberUpdate", wrapEvent("guildMemberUpdate", async (oldMember, newMember) => {
  // Server Artist role detection (handles both add and remove)
  await handleArtistRoleChange(oldMember, newMember);

  // NSFW Avatar monitoring: scan new server avatars
  // WHY: Detect NSFW avatars as soon as users change them
  // DOCS: See src/features/avatarNsfwMonitor.ts
  try {
    await handleAvatarChange(oldMember, newMember);
  } catch (err) {
    logger.error({
      err,
      userId: newMember.id,
      guildId: newMember.guild.id,
    }, "[guildMemberUpdate] Failed to scan avatar for NSFW");
  }

  // Detect newly added roles for level rewards
  const addedRoles = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id)
  );

  if (addedRoles.size === 0) return;

  // Check each new role to see if it's a level role
  // Process independently so one failure doesn't block others
  for (const [roleId, role] of addedRoles) {
    try {
      await handleLevelRoleAdded(newMember.guild, newMember, roleId);
    } catch (err) {
      logger.error({
        err,
        roleId,
        userId: newMember.id,
        guildId: newMember.guild.id,
      }, "[guildMemberUpdate] Failed to process level role reward");
      // Continue to next role
    }
  }
}));

// ROLE AUTOMATION: Event attendance tracking (movie nights + game nights)
// WHY: Track VC participation for event tier roles
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-voiceStateUpdate
import {
  getActiveMovieEvent,
  handleMovieVoiceJoin,
  handleMovieVoiceLeave,
} from "./features/movieNight.js";
import {
  getActiveGameEvent,
  handleGameVoiceJoin,
  handleGameVoiceLeave,
} from "./features/events/gameNight.js";

client.on("voiceStateUpdate", wrapEvent("voiceStateUpdate", async (oldState, newState) => {
  const guildId = newState.guild?.id;
  if (!guildId) return;

  const userId = newState.member?.id;
  if (!userId) return;

  // Check for active movie event
  const movieEvent = getActiveMovieEvent(guildId);
  if (movieEvent) {
    const joined = !oldState.channelId && newState.channelId === movieEvent.channelId;
    const left = oldState.channelId === movieEvent.channelId && !newState.channelId;

    if (joined) {
      handleMovieVoiceJoin(guildId, userId);
    } else if (left) {
      handleMovieVoiceLeave(guildId, userId);
    }
  }

  // Check for active game event
  const gameEvent = getActiveGameEvent(guildId);
  if (gameEvent) {
    const joined = !oldState.channelId && newState.channelId === gameEvent.channelId;
    const left = oldState.channelId === gameEvent.channelId && !newState.channelId;

    if (joined) {
      handleGameVoiceJoin(guildId, userId);
    } else if (left) {
      handleGameVoiceLeave(guildId, userId);
    }
  }
}));

// GOTCHA: This handler is ~700 lines of pure routing logic. If you're adding a new
// button/modal, scroll to the bottom of the isButton() block and add it there.
// The order matters less than you'd think because we early-return on every match,
// but good luck finding your handler in six months.
client.on("interactionCreate", wrapEvent("interactionCreate", async (interaction) => {
  // Global owner override: allow owners to bypass permission checks
  if (isOwner(interaction.user.id)) {
    logger.info(
      {
        evt: "owner_override",
        userId: interaction.user.id,
        kind: interaction.isChatInputCommand()
          ? "slash"
          : interaction.isButton()
            ? "button"
            : interaction.isModalSubmit()
              ? "modal"
              : interaction.isStringSelectMenu()
                ? "select"
                : "other",
        cmd: interaction.isChatInputCommand()
          ? interaction.commandName
          : (interaction as any).customId,
      },
      "Owner override activated - bypassing permission checks"
    );
  }

  // router map: slash -> button -> modal -> select -> autocomplete -> contextMenu; anything else early-return
  // WHY the ternary chain instead of a switch? TypeScript's type narrowing actually works
  // better this way - each branch preserves the interaction type for later checks.
  const kind = interaction.isChatInputCommand()
    ? "slash"
    : interaction.isButton()
      ? "button"
      : interaction.isModalSubmit()
        ? "modal"
        : interaction.isStringSelectMenu()
          ? "select"
          : interaction.isAutocomplete()
            ? "autocomplete"
            : interaction.isContextMenuCommand()
              ? "contextMenu"
              : "other";

  if (kind === "other") {
    return;
  }

  const traceId = newTraceId();
  const cmdId =
    kind === "slash" || kind === "autocomplete"
      ? interaction.isChatInputCommand() || interaction.isAutocomplete()
        ? interaction.commandName
        : "unknown"
      : interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()
        ? interaction.customId
        : "unknown";

  await runWithCtx(
    {
      traceId,
      kind,
      cmd: cmdId,
      userId: interaction.user?.id,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId ?? null,
    },
    async () => {
      setUser({
        id: interaction.user.id,
        username: interaction.user.username,
      });

      const startedAt = Date.now();
      logger.info(
        {
          evt: "ix_enter",
          traceId,
          kind,
          cmd: cmdId,
          userId: interaction.user.id,
          guildId: interaction.guildId ?? null,
          channelId: interaction.channelId ?? null,
        },
        "interaction enter"
      );

      if (kind === "modal" && interaction.isModalSubmit()) {
        const fields = Array.from(interaction.fields.fields.values()).map((field) => ({
          customId: field.customId,
          len:
            typeof (field as { value?: string }).value === "string"
              ? (field as { value?: string }).value!.length
              : 0,
        }));
        logger.info(
          {
            evt: "modal_fields",
            count: fields.length,
            fields,
            traceId,
          },
          "modal fields received"
        );
        if (process.env.VERBOSE_PAYLOADS === "1") {
          const verbose = Array.from(interaction.fields.fields.values()).map((field) => {
            const raw =
              typeof (field as { value?: string }).value === "string"
                ? (field as { value?: string }).value!
                : "";
            const truncated = raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
            return { customId: field.customId, value: truncated, len: raw.length };
          });
          logger.debug(
            {
              evt: "modal_field_values",
              fields: verbose,
              traceId,
            },
            "modal values"
          );
        }
        logger.info(
          {
            evt: "modal_summary",
            id: interaction.customId,
            count: fields.length,
            first: fields[0]?.customId,
            traceId,
          },
          "modal summary"
        );
      }

      // The watchdog barks (logs a warning) if we don't respond within Discord's 3-second SLA.
      // It doesn't actually cancel anything - just yells at you in the logs. Worth it.
      const cancelWatchdog = armWatchdog(interaction);
      let succeeded = false;

      try {
        // Autocomplete interactions - these have a different timeout (no 3s SLA) but still
        // need to be fast or Discord shows "no results found" to the user. Currently only
        // help uses this. If you add more, consider a command->handler map like slash commands.
        if (interaction.isAutocomplete()) {
          const { commandName } = interaction;
          if (commandName === "help") {
            await help.handleAutocomplete(interaction);
          }
          succeeded = true;
          return;
        }

        if (interaction.isChatInputCommand()) {
          const executor = commands.get(interaction.commandName);
          if (!executor) {
            addBreadcrumb({
              message: `Unknown command attempted: ${interaction.commandName}`,
              category: "command",
              level: "warning",
              data: { commandName: interaction.commandName },
            });
            // respond fast or Discord returns 10062: Unknown interaction (3s SLA).
            // docs: https://discord.com/developers/docs/interactions/receiving-and-responding
            // We use MessageFlags.Ephemeral to avoid noisy public errors.
            // CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
            await interaction
              .reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral })
              .catch((err) =>
                logger.warn({ err, traceId }, "Failed to reply with unknown command message")
              );
            succeeded = true;
            return;
          }

          addBreadcrumb({
            message: `Executing command: ${interaction.commandName}`,
            category: "command",
            level: "info",
            data: {
              commandName: interaction.commandName,
              guildId: interaction.guildId,
              userId: interaction.user.id,
            },
          });

          await executor(interaction);

          addBreadcrumb({
            message: `Command completed: ${interaction.commandName}`,
            category: "command",
            level: "info",
          });
          succeeded = true;
          return;
        }

        if (interaction.isButton()) {
          const { customId } = interaction;

          /*
           * Button routing: the regex gauntlet begins.
           * Each button type has a customId format like "v1:action:code" or "action:hash:extra".
           * We match against regex patterns defined in lib/modalPatterns.js.
           * If your button isn't firing, check: (1) customId format, (2) regex escape issues,
           * (3) whether you're returning early before your handler. Ask me how I know.
           */

          // Check if this is a sample card button (non-functional preview)
          if (customId.includes("SAMPLE")) {
            await interaction.reply({
              content: "⚠️ This is a sample preview card. Buttons are non-functional.",
              ephemeral: true,
            });
            succeeded = true;
            return;
          }

          // if this regex breaks, I cry
          const decideMatch = customId.match(BTN_DECIDE_RE);
          if (decideMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "review_decide",
                action: decideMatch[1],
                code: decideMatch[2],
                traceId,
              },
              "route: review decide"
            );
            await handleReviewButton(interaction);
            succeeded = true;
            return;
          }

          const modmailMatch = customId.match(BTN_MODMAIL_RE);
          if (modmailMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "review_modmail",
                code: modmailMatch[1],
                traceId,
              },
              "route: review modmail"
            );
            await handleModmailButton(interaction);
            succeeded = true;
            return;
          }

          const permRejectMatch = customId.match(BTN_PERM_REJECT_RE);
          if (permRejectMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "review_perm_reject",
                code: permRejectMatch[2],
                traceId,
              },
              "route: permanent reject"
            );
            await handlePermRejectButton(interaction);
            succeeded = true;
            return;
          }

          const copyUidMatch = customId.match(BTN_COPY_UID_RE);
          if (copyUidMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "review_copy_uid",
                code: copyUidMatch[1],
                userId: copyUidMatch[2],
                traceId,
              },
              "route: copy UID"
            );
            await handleCopyUidButton(interaction);
            succeeded = true;
            return;
          }

          // Gate flow buttons - the v1: prefix is legacy but we're stuck with it now.
          // "done" finishes verification, "start" begins the multi-page questionnaire.
          if (customId === "v1:done") {
            await handleDoneButton(interaction);
            succeeded = true;
            return;
          }
          if (customId.startsWith("v1:start")) {
            await handleStartButton(interaction);
            succeeded = true;
            return;
          }

          // Database recovery buttons
          const dbRecoverMatch = customId.match(BTN_DBRECOVER_RE);
          if (dbRecoverMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "db_recovery",
                action: dbRecoverMatch[1],
                candidateId: dbRecoverMatch[2],
                traceId,
              },
              "route: database recovery"
            );
            await handleDbRecoveryButton(interaction);
            succeeded = true;
            return;
          }

          // Audit buttons (confirm/cancel for bot audit)
          const auditMatch = customId.match(BTN_AUDIT_RE);
          if (auditMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "audit",
                action: auditMatch[1],
                traceId,
              },
              "route: audit"
            );
            await audit.handleAuditButton(interaction);
            succeeded = true;
            return;
          }

          // Listopen pagination buttons (with optional view mode: :all or :drafts)
          // That 8-char hex is a session ID to prevent button hijacking across users.
          // Yes, someone tried clicking someone else's pagination buttons. No, it didn't end well.
          if (customId.match(/^listopen:[a-f0-9]{8}:(prev|next):\d+(:(all|drafts))?$/)) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "listopen_pagination",
                id: customId,
                traceId,
              },
              "route: listopen pagination"
            );
            await listopen.handleListOpenPagination(interaction);
            succeeded = true;
            return;
          }

          // Modmail buttons
          if (customId.startsWith("v1:modmail:open:")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "modmail_open",
                id: customId,
                traceId,
              },
              "route: modmail open"
            );
            await handleModmailOpenButton(interaction);
            succeeded = true;
            return;
          }
          if (customId.startsWith("v1:modmail:close:")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "modmail_close",
                id: customId,
                traceId,
              },
              "route: modmail close"
            );
            await handleModmailCloseButton(interaction);
            succeeded = true;
            return;
          }
          if (customId.startsWith("v1:ping:delete:")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "ping_delete",
                id: customId,
                traceId,
              },
              "route: delete ping"
            );
            await handleDeletePing(interaction);
            succeeded = true;
            return;
          }

          const pingMatch = customId.match(BTN_PING_UNVERIFIED_RE);
          if (pingMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "ping_unverified",
                id: customId,
                traceId,
              },
              "route: ping in unverified"
            );
            await handlePingInUnverified(interaction);
            succeeded = true;
            return;
          }

          // AI detection service configuration buttons
          if (customId.startsWith("isitreal_")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "isitreal_config",
                id: customId,
                traceId,
              },
              "route: isitreal config"
            );
            const { isIsitRealInteraction, routeIsitRealInteraction } = await import("./commands/config/isitreal.js");
            if (isIsitRealInteraction(customId)) {
              await routeIsitRealInteraction(interaction);
            }
            succeeded = true;
            return;
          }

          // AI detection API toggle buttons
          if (customId.startsWith("toggleapi_")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "toggleapi",
                id: customId,
                traceId,
              },
              "route: toggle api"
            );
            const { handleToggleApiButton } = await import("./commands/config/toggleapis.js");
            await handleToggleApiButton(interaction);
            succeeded = true;
            return;
          }

          // Art reward redemption buttons
          if (customId.startsWith("redeemreward:")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "redeemreward",
                id: customId,
                traceId,
              },
              "route: redeem reward"
            );
            const { handleRedeemRewardButton } = await import("./features/artistRotation/index.js");
            await handleRedeemRewardButton(interaction);
            succeeded = true;
            return;
          }

          // Help navigation buttons - catch-all for the help system.
          // GOTCHA: This must come AFTER more specific help: patterns if we add any.
          if (customId.startsWith("help:")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "help_nav",
                id: customId,
                traceId,
              },
              "route: help navigation"
            );
            await help.handleHelpButton(interaction);
            succeeded = true;
            return;
          }
          succeeded = true;
          return;
        }

        // Select menu interactions - only two of these exist currently.
        // If you're adding a third, maybe consider a routing map?
        if (interaction.isStringSelectMenu()) {
          const { customId } = interaction;

          // Listopen drafts page select menu
          if (customId.match(/^listopen:[a-f0-9]{8}:page:drafts$/)) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "select_menu",
                route: "listopen_page_select",
                id: customId,
                traceId,
              },
              "route: listopen page select"
            );
            await listopen.handleListOpenPageSelect(interaction);
            succeeded = true;
            return;
          }

          // Help command select menus
          if (customId.startsWith("help:select:")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "select_menu",
                route: "help_select",
                id: customId,
                traceId,
              },
              "route: help select menu"
            );
            await help.handleHelpSelectMenu(interaction);
            succeeded = true;
            return;
          }

          succeeded = true;
          return;
        }

        if (interaction.isModalSubmit()) {
          const { customId } = interaction;

          // Modal routing is where things get spicy. Modals can come from buttons OR
          // from showModal() calls, so the customId has to encode enough state to know
          // what to do. The identifyModalRoute() helper parses these - don't roll your own.

          // Help search modal
          if (customId === "help:modal:search") {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "modal",
                route: "help_search",
                id: customId,
                traceId,
              },
              "route: help search modal"
            );
            await help.handleHelpModal(interaction);
            succeeded = true;
            return;
          }

          // yes, HEX6 on purpose (humans > uuids)
          // The 6-char hex codes are used for application codes - short enough to read aloud
          // during debugging calls, long enough to be unique within a reasonable timeframe.
          if (customId.startsWith("v1:modal:") || customId.startsWith("v1:avatar:confirm18:")) {
            const route = identifyModalRoute(customId);

            if (route?.type === "gate_submit_page") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "gate_submit_page",
                  pageIndex: route.pageIndex,
                  id: customId,
                  traceId,
                },
                "route: modal page"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "gate_submit_page",
                async (commandCtx) => {
                  await handleGateModalSubmit(commandCtx.interaction, commandCtx, route.pageIndex);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

            if (route?.type === "review_reject") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "review_reject",
                  id: customId,
                  code: route.code,
                  traceId,
                },
                "route: reject modal"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "review_reject",
                async (commandCtx) => {
                  await handleRejectModal(commandCtx.interaction);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

            if (route?.type === "review_perm_reject") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "review_perm_reject",
                  id: customId,
                  code: route.code,
                  traceId,
                },
                "route: permanent reject modal"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "review_perm_reject",
                async (commandCtx) => {
                  await handlePermRejectModal(commandCtx.interaction);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

            if (route?.type === "review_accept") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "review_accept",
                  id: customId,
                  code: route.code,
                  traceId,
                },
                "route: accept modal"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "review_accept",
                async (commandCtx) => {
                  await handleAcceptModal(commandCtx.interaction);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

            if (route?.type === "review_kick") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "review_kick",
                  id: customId,
                  code: route.code,
                  traceId,
                },
                "route: kick modal"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "review_kick",
                async (commandCtx) => {
                  await handleKickModal(commandCtx.interaction);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

            if (route?.type === "review_unclaim") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "review_unclaim",
                  id: customId,
                  code: route.code,
                  traceId,
                },
                "route: unclaim modal"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "review_unclaim",
                async (commandCtx) => {
                  await handleUnclaimModal(commandCtx.interaction);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

            // If we got here, someone submitted a modal we don't recognize.
            // This usually means a new modal was added but the route wasn't registered,
            // or there's a typo in the customId. Either way, the user sees an error card.
            logger.error(
              {
                evt: "ix_route_miss",
                kind: "modal",
                id: customId,
                traceId,
              },
              "unhandled modal customId pattern"
            );
            await postErrorCard(interaction, {
              cmd: "modal",
              phase: "route_miss",
              err: { name: "RouteError", message: `Unhandled modal: ${customId}` },
              lastSql: null,
              traceId,
            });
            succeeded = false;
            return;
          }

          if (customId.startsWith("v1:gate:reset:")) {
            const { handleResetModal } = await import("./commands/gate.js");
            await handleResetModal(interaction);
            succeeded = true;
            return;
          }

          // AI detection service configuration modals
          if (customId.startsWith("isitreal_modal_")) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "modal",
                route: "isitreal_config",
                id: customId,
                traceId,
              },
              "route: isitreal config modal"
            );
            const { routeIsitRealInteraction } = await import("./commands/config/isitreal.js");
            await routeIsitRealInteraction(interaction);
            succeeded = true;
            return;
          }
          succeeded = true;
        }

        // Context menu commands
        if (kind === "contextMenu" && interaction.isMessageContextMenuCommand()) {
          if (interaction.commandName === "Is It Real?") {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "contextMenu",
                route: "isitreal",
                commandName: interaction.commandName,
                traceId,
              },
              "route: isitreal context menu"
            );
            await isitreal.handleIsItRealContextMenu(interaction);
            succeeded = true;
            return;
          }
        }
      } catch (err) {
        // The catch-all safety net. If any handler throws and doesn't catch its own error,
        // we land here. The user gets an error card, Sentry gets notified, and the traceId
        // lets us correlate everything in the logs. Not elegant, but effective.
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(
          {
            evt: "ix_error",
            traceId,
            kind,
            cmd: cmdId,
            err: {
              name: error.name,
              code: (err as { code?: unknown })?.code,
              message: error.message,
              stack: error.stack,
            },
          },
          "interaction handler error"
        );
        captureException(error, {
          kind,
          cmd: cmdId,
          traceId,
        });
        try {
          // ensureDeferred prevents "interaction has already been acknowledged" errors
          // when we try to send the error card after a partial failure.
          await ensureDeferred(interaction as never);
          const { postErrorCard } = await import("./lib/errorCard.js");
          await postErrorCard(interaction as never, {
            traceId,
            cmd: cmdId,
            phase: "router",
            err: {
              name: error.name,
              code: (err as { code?: unknown })?.code,
              message: error.message,
              stack: error.stack,
            },
            lastSql: null,
          });
        } catch (cardErr) {
          logger.error(
            { err: cardErr, traceId, evt: "router_error_card_fail" },
            "failed to deliver router error card"
          );
        }
      } finally {
        cancelWatchdog();
        // Only log success metrics if we actually succeeded. Failed interactions
        // already logged their errors above, and we don't want to pollute ix_ok stats.
        if (succeeded) {
          const duration = Date.now() - startedAt;
          logger.info({ evt: "ix_ok", kind, id: cmdId, ms: duration, traceId }, "interaction ok");
        }
      }
    }
  );
}));

// Modmail message routing + first-message tracking (PR8)
client.on("messageCreate", wrapEvent("messageCreate", async (message) => {
  // begging Discord to send us valid messages
  // Ignore bot messages
  if (message.author.bot) return;

  const traceId = newTraceId();

  try {
    // NOTE: Forum post notification moved to threadCreate event
    // See client.on('threadCreate', ...) handler below
    // This prevents duplicate pings for every message in a forum thread

    // Log message activity for heatmap (Migration 020)
    // WHAT: Tracks all server messages for /activity command heatmap visualization
    // WHY: Provides real-time data on message activity patterns
    // DOCS: See src/features/messageActivityLogger.ts
    if (message.guildId) {
      try {
        const { logMessage } = await import("./features/messageActivityLogger.js");
        logMessage(message);
      } catch (err) {
        logger.debug(
          { err, messageId: message.id, guildId: message.guildId },
          "[message_activity] failed to log message"
        );
      }
    }

    // Track first message for Silent-Since-Join detection (PR8)
    // WHAT: Records first_message_at timestamp and evaluates threshold for flagging
    // WHY: Detects accounts that stay silent for N days before posting (entropy indicator)
    // DOCS: See src/features/activityTracker.ts
    if (message.guildId) {
      try {
        const { trackFirstMessage } = await import("./features/activityTracker.js");
        await trackFirstMessage(client, message);
      } catch (err) {
        logger.warn(
          { err, userId: message.author.id, guildId: message.guildId },
          "[activity] failed to track first message"
        );
      }
    }

    // Dad Mode: Respond to "I'm..." messages with dad jokes
    // WHAT: Playful feature that replies "Hi <name>, I'm dad" to messages like "I'm tired"
    // WHY: Adds personality and community engagement in guilds
    // HOW: Checks guild config for enabled state and odds, then triggers dad joke
    // DOCS: See src/listeners/messageDadMode.ts
    if (message.guildId && !message.webhookId) {
      try {
        const { execute: executeDadMode } = await import("./listeners/messageDadMode.js");
        await executeDadMode(message);
      } catch (err) {
        logger.debug({ err, messageId: message.id }, "[dadmode] handler failed");
      }
    }

    // Skull Mode: Random skull emoji reactions
    // WHAT: Randomly reacts to messages with a skull emoji based on configurable odds
    // WHY: Adds playful chaos and community engagement in guilds
    // HOW: Checks guild config for enabled state and odds, then reacts with skull
    // DOCS: See src/listeners/messageSkullMode.ts
    if (message.guildId && !message.webhookId) {
      try {
        const { execute: executeSkullMode } = await import("./listeners/messageSkullMode.js");
        await executeSkullMode(message);
      } catch (err) {
        logger.debug({ err, messageId: message.id }, "[skullmode] handler failed");
      }
    }

    // Check if message is in a modmail thread
    if (message.channel.isThread() && message.guildId) {
      const ticket = getTicketByThread(message.channel.id);
      if (ticket && ticket.status === "open") {
        await routeThreadToDm(message, ticket, client);
        return;
      }
    }

    // Check if message is a DM
    if (message.channel.type === ChannelType.DM) {
      // what if we kissed in the DMs (modmail edition)
      // Find open ticket for this user across all guilds
      const tickets = db
        .prepare(
          `
        SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
        FROM modmail_ticket
        WHERE user_id = ? AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `
        )
        .all(message.author.id) as Array<ModmailTicket>;

      if (tickets.length > 0) {
        const ticket = tickets[0];
        await routeDmToThread(message, ticket, client);
        return;
      }
    }
  } catch (err) {
    logger.error({ err, traceId, messageId: message.id }, "[modmail] message routing failed");
    captureException(err, { area: "modmail:messageCreate", traceId });

    // Notify user their message wasn't delivered
    try {
      await message.reply({
        content: "Sorry, there was an issue delivering your message. Please try again or contact staff through another channel.",
      });
    } catch (replyErr) {
      logger.debug({ err: replyErr }, "[modmail] Failed to notify user of routing failure");
    }
  }
}));

// Forum post notification: alert moderators of new forum posts (threadCreate event)
// WHAT: Pings admin thread ONCE when a new forum thread (post) is created
// WHY: Ensure timely response to member feedback without duplicate pings for each message
// SAFETY: Uses allowedMentions, permission checks, and audit logging
// DOCS: See src/events/forumPostNotify.ts
// NOTE: This replaced the previous messageCreate approach which incorrectly pinged for every message
client.on("threadCreate", wrapEvent("threadCreate", async (thread) => {
  await forumPostNotify(thread);
}));

async function main() {
  // Step 1: Database health check (fail fast if corrupted)
  // WHAT: Verifies database integrity before bot starts
  // WHY: Prevents running with corrupted data that could cause further issues
  // DOCS: See src/lib/dbHealthCheck.ts
  const { requireHealthyDatabase } = await import("./lib/dbHealthCheck.js");
  requireHealthyDatabase();

  // Step 2: Fail fast if critical env vars are missing
  // env from lib/env.js validates required vars at import time (fail-fast)
  const DISCORD_TOKEN = env.DISCORD_TOKEN;
  // CLIENT_ID is validated by env.ts schema (required, min length 1)
  if (!env.GUILD_ID) {
    logger.warn("[startup] GUILD_ID not set - commands will register globally");
  }

  // Step 3: Login to Discord
  await client.login(DISCORD_TOKEN);
}

// Only start the bot if not running in test environment
if (!process.env.VITEST_WORKER_ID) {
  main().catch((err) => {
    logger.error({ err }, "Fatal startup error");
    process.exit(1);
  });
}
