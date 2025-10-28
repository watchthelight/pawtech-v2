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
initializeSentry();

import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  MessageFlags,
  ChannelType,
  type ChatInputCommandInteraction,
  Events,
} from "discord.js";
import { newTrace, tlog, withStep } from "./lib/tracer.js";
import { isOwner } from "./utils/owner.js";
import { TRACE_INTERACTIONS, OWNER_IDS } from "./config.js";
import type { ModalSubmitInteraction } from "discord.js";
import { logger } from "./lib/logger.js";
import { env } from "./lib/env.js";
import { requireEnv } from "./util/ensureEnv.js";
import * as health from "./commands/health.js";
import * as gate from "./commands/gate.js";
import * as statusupdate from "./commands/statusupdate.js";
import * as config from "./commands/config.js";
import { handleStartButton, handleGateModalSubmit, handleDoneButton } from "./features/gate.js";
import {
  handleReviewButton,
  handleRejectModal,
  handlePermRejectButton,
  handlePermRejectModal,
  handleCopyUidButton,
  handleAvatarViewSourceButton,
  handleAvatarConfirmModal,
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
} from "./features/modmail.js";
import { initializeBannerSync } from "./features/bannerSync.js";
import { armWatchdog, ensureDeferred, wrapCommand } from "./lib/cmdWrap.js";
import { db } from "./db/db.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ctx as reqCtx, newTraceId, runWithCtx } from "./lib/reqctx.js";
import { postErrorCard } from "./lib/errorCard.js";
import {
  BTN_DECIDE_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_VIEW_SRC_RE,
  identifyModalRoute,
} from "./lib/modalPatterns.js";
import { REST, Routes } from "discord.js";
import { syncCommandsToAllGuilds, syncCommandsToGuild } from "./commands/sync.js";
import { logActionPretty } from "./logging/pretty.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
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
commands.set(statusupdate.data.name, wrapCommand("statusupdate", statusupdate.execute));
commands.set(config.data.name, wrapCommand("config", config.execute));
commands.set("modmail", wrapCommand("modmail", executeModmailCommand));

// Analytics commands
import {
  executeAnalyticsCommand,
  executeAnalyticsExportCommand,
} from "./features/analytics/command.js";
commands.set("analytics", wrapCommand("analytics", executeAnalyticsCommand));
commands.set("analytics-export", wrapCommand("analytics-export", executeAnalyticsExportCommand));

// Modstats command
import * as modstats from "./commands/modstats.js";
commands.set(modstats.data.name, wrapCommand("modstats", modstats.execute));

// Send command (anonymous staff messages)
import * as send from "./commands/send.js";
commands.set(send.data.name, wrapCommand("send", send.execute));

// Resetdata command (metrics epoch reset)
import * as resetdata from "./commands/resetdata.js";
commands.set(resetdata.data.name, wrapCommand("resetdata", resetdata.execute));

// Flag command (manual user flagging)
import * as flag from "./commands/flag.js";
commands.set(flag.data.name, wrapCommand("flag", flag.execute));

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
      ensureManualFlagColumns,
    } = await import("./db/ensure.js");
    const { ensureBotStatusSchema } = await import("./features/statusStore.js");
    ensureAvatarScanSchema();
    ensureApplicationPermaRejectColumn();
    ensureOpenModmailTable();
    ensureReviewActionFreeText();
    ensureApplicationStatusIndex();
    ensureActionLogSchema();
    ensureManualFlagColumns();
    ensureBotStatusSchema();
  } catch (err) {
    logger.error({ err }, "[startup] schema ensure failed");
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

  // Start web control panel (Fastify server)
  // WHAT: OAuth2-secured admin dashboard with APIs + static site hosting
  // WHY: Provides web interface for logs, metrics, and config management
  // PORT: Configurable via DASHBOARD_PORT env var (default: 3000)
  // DOCS: See src/web/server.ts
  try {
    const { startWebServer } = await import("./web/server.js");
    const port = parseInt(process.env.DASHBOARD_PORT || "3000", 10);
    await startWebServer(port);
  } catch (err) {
    logger.warn({ err }, "[startup] web server failed to start - continuing without dashboard");
  }

  // Start mod metrics periodic refresh scheduler
  // WHAT: Recalculates mod_metrics table every 15 minutes
  // WHY: Keeps performance analytics current without manual triggers
  // DOCS: See src/scheduler/modMetricsScheduler.ts
  try {
    const { startModMetricsScheduler } = await import("./scheduler/modMetricsScheduler.js");
    const metricsInterval = startModMetricsScheduler(client);

    // Graceful shutdown: stop scheduler on SIGTERM
    process.on("SIGTERM", () => {
      const { stopModMetricsScheduler } = require("./scheduler/modMetricsScheduler.js");
      stopModMetricsScheduler(metricsInterval);
    });
  } catch (err) {
    logger.warn(
      { err },
      "[startup] mod metrics scheduler failed to start - continuing without periodic refresh"
    );
  }

  // Initialize banner sync (bot profile + website)
  try {
    initializeBannerSync(client);
  } catch (err) {
    logger.warn(
      { err },
      "[startup] banner sync failed to initialize - continuing without banner sync"
    );
  }

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
  // WHAT: Load last status from /statusupdate and apply it
  // WHY: Keeps status consistent across restarts
  // DOCS: See src/features/statusStore.ts
  try {
    const { getStatus } = await import("./features/statusStore.js");
    const saved = getStatus("global");
    if (saved && client.user) {
      await client.user.setPresence({
        status: saved.status,
        activities: [{ type: saved.activityType, name: saved.activityText }],
      });
      logger.info(
        {
          activityType: saved.activityType,
          activityText: saved.activityText,
          status: saved.status,
        },
        "[startup] bot presence restored from DB"
      );
    } else {
      logger.debug("[startup] no saved presence found, using default");
    }
  } catch (err) {
    logger.warn({ err }, "[startup] failed to restore bot presence - continuing with default");
  }

  console.info("[owner] configured owners", { OWNER_IDS });
  console.info("[trace] interaction tracing enabled", { TRACE_INTERACTIONS });

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
          logger.warn({ evt: "dist_scan_legacy_sql", files: bad }, "dist contains __old references");
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

client.on("guildCreate", async (guild) => {
  try {
    await syncCommandsToGuild(guild.id);
  } catch (err) {
    logger.warn({ guildId: guild.id, err }, "[cmdsync] sync on guildCreate failed");
  }
});

// Optional: Clear commands on guildDelete to avoid leaving stale commands.
// Docs: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildDelete
client.on("guildDelete", async (guild) => {
  try {
    // goodbye, old friend
    // Overwrite with empty array to clear commands.
    const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, guild.id), {
      body: [],
    });
    logger.info({ guildId: guild.id }, "[cmdsync] cleared commands for removed guild");
  } catch (err) {
    logger.warn({ guildId: guild.id, err }, "[cmdsync] failed to clear commands on guildDelete");
  }
});

// Track member joins for join→submit ratio metrics + activity tracking (PR8)
// WHY: Enables analysis of verification funnel (how many joiners attempt verification)
// WHY (PR8): Track joined_at timestamp for Silent-Since-Join detection
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberAdd
client.on("guildMemberAdd", async (member) => {
  if (!member.guild) return;

  try {
    await logActionPretty(member.guild, {
      actorId: member.id,
      action: "member_join",
    });

    logger.debug({ userId: member.id, guildId: member.guild.id }, "[metrics] member join logged");
  } catch (err) {
    logger.warn(
      { err, userId: member.id, guildId: member.guild.id },
      "[metrics] failed to log member join"
    );
  }

  // Track join for Silent-Since-Join detection (PR8)
  try {
    const { trackJoin } = await import("./features/activityTracker.js");
    const joinedAt = Math.floor((member.joinedTimestamp || Date.now()) / 1000);
    trackJoin(member.guild.id, member.id, joinedAt);
  } catch (err) {
    logger.warn(
      { err, userId: member.id, guildId: member.guild.id },
      "[activity] failed to track join"
    );
  }
});

// Safety cleanup: Remove from open_modmail table if thread is deleted/archived manually
// WHY: Prevents orphaned entries if a thread is deleted outside the normal close flow
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-threadDelete
client.on("threadDelete", (thread) => {
  if (!thread.guildId) return;

  try {
    const result = db
      .prepare(
        `
      DELETE FROM open_modmail
      WHERE thread_id = ?
    `
      )
      .run(thread.id);

    if (result.changes > 0) {
      logger.info(
        { threadId: thread.id, guildId: thread.guildId },
        "[modmail] cleaned up orphaned open_modmail entry on threadDelete"
      );
    }
  } catch (err) {
    logger.warn(
      { err, threadId: thread.id },
      "[modmail] failed to clean up open_modmail on threadDelete"
    );
  }
});

client.on("interactionCreate", async (interaction) => {
  const trace = newTrace("gate", "interactionCreate"); // feature tag "gate" keeps logs grouped

  try {
    // Make traceId available on the object for downstream logs
    (interaction as any).__trace = trace;
    (interaction as any).__ownerBypass = isOwner(interaction.user.id);

    if (TRACE_INTERACTIONS) {
      tlog(trace, "info", "interaction received", {
        kind: interaction.isChatInputCommand()
          ? "slash"
          : interaction.isButton()
            ? "button"
            : interaction.type,
        command: (interaction as any).commandName ?? (interaction as any).customId,
        guildId: interaction.guildId ?? "DM",
        channelType: interaction.channel?.type ?? ChannelType.GuildText,
        userId: interaction.user?.id,
        ownerBypass: (interaction as any).__ownerBypass,
      });
    }

    // … your existing router
  } catch (err) {
    tlog(trace, "error", "interaction handler error", { err });
  }

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
              : "other",
        cmd: interaction.isChatInputCommand()
          ? interaction.commandName
          : (interaction as any).customId,
      },
      "Owner override activated - bypassing permission checks"
    );
  }

  // router map: slash → button → modal; anything else early‑return
  const kind = interaction.isChatInputCommand()
    ? "slash"
    : interaction.isButton()
      ? "button"
      : interaction.isModalSubmit()
        ? "modal"
        : "other";

  if (kind === "other") {
    return;
  }

  const traceId = newTraceId();
  const cmdId =
    kind === "slash"
      ? interaction.isChatInputCommand()
        ? interaction.commandName
        : "unknown"
      : interaction.isButton() || interaction.isModalSubmit()
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

      const cancelWatchdog = armWatchdog(interaction);
      let succeeded = false;

      try {
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

          const permRejectMatch = customId.match(BTN_PERM_REJECT_RE);
          if (permRejectMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "review_perm_reject",
                code: permRejectMatch[1],
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

          const viewSrcMatch = customId.match(BTN_VIEW_SRC_RE);
          if (viewSrcMatch) {
            logger.info(
              {
                evt: "ix_route_match",
                kind: "button",
                route: "avatar_view_src",
                code: viewSrcMatch[1],
                traceId,
              },
              "route: avatar view source"
            );
            await handleAvatarViewSourceButton(interaction);
            succeeded = true;
            return;
          }

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
          if (customId.startsWith("v1:ping:")) {
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
          succeeded = true;
          return;
        }

        if (interaction.isModalSubmit()) {
          const { customId } = interaction;

          // yes, HEX6 on purpose (humans > uuids)
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

            if (route?.type === "avatar_confirm18") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "avatar_confirm18",
                  id: customId,
                  code: route.code,
                  traceId,
                },
                "route: avatar 18+"
              );
              const executor = wrapCommand<ModalSubmitInteraction>(
                "avatar_confirm18",
                async (commandCtx) => {
                  await handleAvatarConfirmModal(commandCtx.interaction);
                }
              );
              await executor(interaction);
              succeeded = true;
              return;
            }

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
          succeeded = true;
        }
      } catch (err) {
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
        if (succeeded) {
          const duration = Date.now() - startedAt;
          logger.info({ evt: "ix_ok", kind, id: cmdId, ms: duration, traceId }, "interaction ok");
        }
      }
    }
  );
});

// Modmail message routing + first-message tracking (PR8)
client.on("messageCreate", async (message) => {
  // begging Discord to send us valid messages
  // Ignore bot messages
  if (message.author.bot) return;

  const traceId = newTraceId();

  try {
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
        SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
        FROM modmail_ticket
        WHERE user_id = ? AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `
        )
        .all(message.author.id) as Array<{
        id: number;
        guild_id: string;
        user_id: string;
        app_code: string | null;
        review_message_id: string | null;
        thread_id: string | null;
        status: string;
        created_at: string;
        closed_at: string | null;
      }>;

      if (tickets.length > 0) {
        const ticket = tickets[0] as any; // Cast to avoid type error
        await routeDmToThread(message, ticket, client);
        return;
      }
    }
  } catch (err) {
    logger.error({ err, traceId, messageId: message.id }, "[modmail] message routing failed");
    captureException(err, { area: "modmail:messageCreate", traceId });
  }
});

async function main() {
  // Step 1: Database health check (fail fast if corrupted)
  // WHAT: Verifies database integrity before bot starts
  // WHY: Prevents running with corrupted data that could cause further issues
  // DOCS: See src/lib/dbHealthCheck.ts
  const { requireHealthyDatabase } = await import("./lib/dbHealthCheck.js");
  requireHealthyDatabase();

  // Step 2: Fail fast if critical env vars are missing
  const DISCORD_TOKEN = requireEnv("DISCORD_TOKEN");
  requireEnv("CLIENT_ID");
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
