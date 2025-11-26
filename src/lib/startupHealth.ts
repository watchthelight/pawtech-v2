/**
 * Pawtropolis Tech — src/lib/startupHealth.ts
 * WHAT: Startup health checks and validation
 * WHY: Catch configuration issues early before they cause runtime failures
 * FLOWS:
 *  - validateCriticalTables() → Check database has required tables
 *  - validateEnvironment() → Check required env vars are set
 *  - logStartupHealth() → Log comprehensive health summary
 * USAGE:
 *  import { validateStartup, logStartupHealth } from "./startupHealth.js";
 *  await validateStartup(); // Throws if critical issues
 *  logStartupHealth(client); // Log summary after ready
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "./logger.js";
import { isSentryEnabled } from "./sentry.js";
import type { Client } from "discord.js";

/**
 * Critical tables that must exist for the bot to function.
 *
 * If ANY of these are missing, the bot should refuse to start. Better to
 * fail loudly at startup than crash halfway through handling a request.
 *
 * When adding new features with their own tables, consider: is the feature
 * critical enough that the bot shouldn't run without it? If yes, add here.
 * If it's optional functionality, skip it.
 */
const CRITICAL_TABLES = [
  "application",
  "guild_config",
  "action_log",
  "modmail_ticket",
] as const;

/**
 * Required environment variables.
 *
 * The bot literally cannot function without these. Missing DISCORD_TOKEN
 * means we can't connect; missing CLIENT_ID means slash commands won't register.
 */
const REQUIRED_ENV_VARS = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
] as const;

/**
 * Optional but recommended environment variables.
 *
 * The bot will work without these, but you're missing out on important
 * functionality (error tracking, audit logs). We warn but don't fail.
 */
const RECOMMENDED_ENV_VARS = [
  "SENTRY_DSN",
  "LOGGING_CHANNEL",
] as const;

export interface StartupHealthResult {
  healthy: boolean;
  criticalIssues: string[];
  warnings: string[];
  summary: {
    tablesOk: number;
    tablesMissing: string[];
    envVarsOk: number;
    envVarsMissing: string[];
    sentryEnabled: boolean;
    guildCount?: number;
  };
}

/**
 * Validate that critical database tables exist.
 *
 * We query sqlite_master directly rather than trying to SELECT from each table.
 * This is safer because it won't fail if the table exists but has schema issues.
 * Schema validation is a separate concern.
 *
 * The try/catch per table ensures one corrupt/inaccessible table doesn't prevent
 * us from checking the others.
 */
export function validateCriticalTables(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const table of CRITICAL_TABLES) {
    try {
      const exists = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table);

      if (!exists) {
        missing.push(table);
      }
    } catch (err) {
      // If we can't even query sqlite_master, something is very wrong
      logger.error({ err, table }, "[startup] Failed to check table existence");
      missing.push(table);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): {
  ok: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  // Check recommended vars
  for (const envVar of RECOMMENDED_ENV_VARS) {
    if (!process.env[envVar]) {
      warnings.push(`${envVar} not set (recommended)`);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Run all startup validations.
 *
 * Call this before connecting to Discord. The function doesn't throw even
 * if validation fails - it returns a result object so the caller can decide
 * how to handle failures (exit, run in degraded mode, etc).
 *
 * For production, you typically want to exit if healthy is false.
 * For development, you might want to continue with warnings.
 */
export function validateStartup(): StartupHealthResult {
  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  // Check environment
  const envResult = validateEnvironment();
  if (!envResult.ok) {
    for (const v of envResult.missing) {
      criticalIssues.push(`Missing required env var: ${v}`);
    }
  }
  warnings.push(...envResult.warnings);

  // Check database tables
  const tableResult = validateCriticalTables();
  if (!tableResult.ok) {
    for (const t of tableResult.missing) {
      criticalIssues.push(`Missing critical table: ${t}`);
    }
  }

  const healthy = criticalIssues.length === 0;

  const result: StartupHealthResult = {
    healthy,
    criticalIssues,
    warnings,
    summary: {
      tablesOk: CRITICAL_TABLES.length - tableResult.missing.length,
      tablesMissing: tableResult.missing,
      envVarsOk: REQUIRED_ENV_VARS.length - envResult.missing.length,
      envVarsMissing: envResult.missing,
      sentryEnabled: isSentryEnabled(),
    },
  };

  // Log the result
  if (!healthy) {
    logger.error(
      {
        evt: "startup_validation_failed",
        criticalIssues,
        warnings,
      },
      "[startup] Critical issues detected during startup validation"
    );
  } else if (warnings.length > 0) {
    logger.warn(
      {
        evt: "startup_validation_warnings",
        warnings,
      },
      "[startup] Startup validation passed with warnings"
    );
  } else {
    logger.info(
      { evt: "startup_validation_ok" },
      "[startup] All startup validations passed"
    );
  }

  return result;
}

/**
 * Log comprehensive startup health summary.
 *
 * Call this AFTER the Discord client emits 'ready'. Before that, cache
 * sizes (guilds, users, channels) won't be accurate.
 *
 * This is purely informational logging - it doesn't return anything or
 * affect control flow. Useful for debugging "bot is acting weird" issues
 * where you want to know the state at startup.
 */
export function logStartupHealth(client: Client): void {
  const tableResult = validateCriticalTables();
  const envResult = validateEnvironment();

  const health = {
    evt: "startup_health_summary",
    process: {
      nodeVersion: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
    },
    discord: {
      guildCount: client.guilds.cache.size,
      userCount: client.users.cache.size,
      channelCount: client.channels.cache.size,
      ready: client.isReady(),
    },
    database: {
      tablesOk: CRITICAL_TABLES.length - tableResult.missing.length,
      tablesMissing: tableResult.missing,
    },
    config: {
      envVarsOk: REQUIRED_ENV_VARS.length,
      sentryEnabled: isSentryEnabled(),
      logLevel: process.env.LOG_LEVEL ?? "info",
    },
    warnings: envResult.warnings,
  };

  logger.info(health, "[startup] Bot health summary");

  // Log individual warnings at warn level
  if (envResult.warnings.length > 0) {
    logger.warn(
      { warnings: envResult.warnings },
      `[startup] ${envResult.warnings.length} configuration warnings`
    );
  }

  // Log Sentry status
  if (!isSentryEnabled()) {
    logger.warn("[startup] Sentry error tracking is disabled (SENTRY_DSN not set)");
  }
}

/**
 * Check if a specific table exists.
 *
 * Use this for runtime checks (e.g., feature flags based on schema).
 * Returns false on any error, which is conservative but safe.
 */
export function tableExists(tableName: string): boolean {
  try {
    const exists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      )
      .get(tableName);
    return !!exists;
  } catch {
    return false;
  }
}

/**
 * Get database schema info for diagnostics.
 *
 * This doesn't track "versions" in the migration sense - it just reports
 * what tables/indexes exist right now. Useful for debugging and for the
 * startup health log.
 *
 * Note: We filter out sqlite_* internal tables/indexes since they're not
 * part of our application schema.
 */
export function getSchemaInfo(): {
  tableCount: number;
  indexCount: number;
  tables: string[];
} {
  try {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string }[];

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string }[];

    return {
      tableCount: tables.length,
      indexCount: indexes.length,
      tables: tables.map((t) => t.name),
    };
  } catch (err) {
    logger.error({ err }, "[startup] Failed to get schema info");
    return { tableCount: 0, indexCount: 0, tables: [] };
  }
}
