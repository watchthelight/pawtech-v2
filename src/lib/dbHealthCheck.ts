/**
 * Pawtropolis Tech — Database Health Check
 * WHAT: Verifies database integrity on bot startup
 * WHY: Prevents bot from running with corrupted database
 * HOW: Runs PRAGMA integrity_check and validates critical tables
 */

import { statSync } from "node:fs";
import { logger } from "./logger.js";
import { db } from "../db/db.js";

interface HealthCheckResult {
  healthy: boolean;
  integrity: "ok" | "corrupt" | "error";
  errors: string[];
  warnings: string[];
  tables: Record<string, number | string>;
}

/**
 * Soft thresholds for sanity checking. These catch "probably wrong" scenarios
 * like connecting to a fresh/empty database when you expected prod data.
 * Tune these based on your environment - dev naturally has fewer rows.
 *
 * Note: These generate warnings, not failures. A brand new server legitimately
 * has zero applications.
 */
const HEALTH_THRESHOLDS = {
  review_action: 100, // Lowered from 1000 to work better in dev environments
  mod_metrics: 1,
  application: 1,
};

/**
 * Performs comprehensive database health check.
 * WHAT: Validates database integrity and checks critical tables.
 * WHY: Catches corruption early before it causes data loss.
 * RETURNS: HealthCheckResult with detailed status.
 */
export function checkDatabaseHealth(): HealthCheckResult {
  const result: HealthCheckResult = {
    healthy: false,
    integrity: "unknown" as "ok" | "corrupt" | "error",
    errors: [],
    warnings: [],
    tables: {},
  };

  try {
    // Step 1: PRAGMA integrity_check scans the entire database for corruption.
    // This is thorough but can be slow on large DBs (100MB+ takes several seconds).
    // Worth the cost at startup since catching corruption early prevents data loss.
    logger.info("[healthcheck] Running SQLite integrity check...");
    try {
      const integrityResults = db.prepare("PRAGMA integrity_check").all() as Array<{
        integrity_check: string;
      }>;

      if (integrityResults.length === 1 && integrityResults[0].integrity_check === "ok") {
        result.integrity = "ok";
        logger.info("[healthcheck] ✓ Database integrity: OK");
      } else {
        result.integrity = "corrupt";
        const issues = integrityResults.map((r) => r.integrity_check).join("; ");
        result.errors.push(`Database corruption detected: ${issues}`);
        logger.error({ issues }, "[healthcheck] ✗ Database integrity: CORRUPT");
      }
    } catch (err) {
      result.integrity = "error";
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Integrity check failed: ${errMsg}`);
      logger.error({ err }, "[healthcheck] ✗ Integrity check error");
    }

    // Step 2: Verify critical tables. This catches migration failures or
    // connecting to the wrong database file (surprisingly common in dev).
    const criticalTables = ["review_action", "mod_metrics", "application", "guild_config"];

    logger.info("[healthcheck] Checking critical tables...");
    for (const table of criticalTables) {
      try {
        const countResult = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
          c: number;
        };
        result.tables[table] = countResult.c;

        // Check against thresholds (warnings only, not failures)
        if (HEALTH_THRESHOLDS[table as keyof typeof HEALTH_THRESHOLDS]) {
          const threshold = HEALTH_THRESHOLDS[table as keyof typeof HEALTH_THRESHOLDS];
          if (countResult.c < threshold) {
            result.warnings.push(
              `Table ${table} has ${countResult.c} rows (expected at least ${threshold})`
            );
            logger.warn(
              { table, count: countResult.c, threshold },
              "[healthcheck] Table below threshold"
            );
          }
        }

        logger.info({ table, count: countResult.c }, "[healthcheck] ✓ Table verified");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.tables[table] = "error";
        result.errors.push(`Cannot read table ${table}: ${errMsg}`);
        logger.error({ err, table }, "[healthcheck] ✗ Table check failed");
      }
    }

    // Step 3: Sanity check file size. A production DB with real data should be
    // at least 100KB. Smaller usually means empty/test DB or pointing at wrong file.
    try {
      // better-sqlite3 exposes the file path as .name (undocumented but stable)
      const dbPath = (db as any).name;
      const stats = statSync(dbPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      if (stats.size < 100 * 1024) {
        result.warnings.push(`Database file is unusually small: ${sizeMB} MB`);
        logger.warn({ sizeMB }, "[healthcheck] Database file is small");
      } else {
        logger.info({ sizeMB }, "[healthcheck] ✓ Database size OK");
      }
    } catch (err) {
      logger.warn({ err }, "[healthcheck] Could not check database file size");
    }

    // Healthy = passed integrity check AND no hard errors.
    // Warnings don't fail the check - they're informational for operators.
    result.healthy = result.integrity === "ok" && result.errors.length === 0;

    return result;
  } catch (err) {
    logger.error({ err }, "[healthcheck] Health check failed with exception");
    result.errors.push(`Health check exception: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
}

/**
 * Performs health check and exits process if database is unhealthy.
 * WHAT: Runs checkDatabaseHealth and terminates bot if critical issues found.
 * WHY: Prevents bot from running with corrupted data.
 */
export function requireHealthyDatabase(): void {
  logger.info("[healthcheck] Starting database health check...");

  const result = checkDatabaseHealth();

  if (result.healthy) {
    logger.info(
      {
        integrity: result.integrity,
        tables: result.tables,
        warnings: result.warnings.length,
      },
      "[healthcheck] ✓ Database health check PASSED"
    );

    if (result.warnings.length > 0) {
      logger.warn({ warnings: result.warnings }, "[healthcheck] Health check completed with warnings");
    }

    return;
  }

  // Database is unhealthy - log details and exit
  logger.fatal(
    {
      integrity: result.integrity,
      errors: result.errors,
      tables: result.tables,
    },
    "[healthcheck] ✗ DATABASE HEALTH CHECK FAILED - BOT CANNOT START"
  );

  console.error("\n╔═══════════════════════════════════════════════════════════════╗");
  console.error("║  FATAL: DATABASE HEALTH CHECK FAILED                          ║");
  console.error("║  The database is corrupted or has critical issues.            ║");
  console.error("║  The bot cannot start to prevent further data loss.           ║");
  console.error("╚═══════════════════════════════════════════════════════════════╝\n");

  console.error("Errors:");
  result.errors.forEach((err) => console.error(`  - ${err}`));

  // Recovery guidance for operators. The --recover flag triggers automatic
  // restoration from most recent backup. --local forces fresh sync from remote.
  console.error("\nRecovery steps:");
  console.error("  1. Check database backups in data/backups/");
  console.error("  2. Use: node scripts/verify-db-integrity.js ./data/data.db");
  console.error("  3. Restore from backup or use: start.cmd --recover");
  console.error("  4. If remote has good data: start.cmd --local (will pull from remote)");
  console.error("  5. Contact administrator if issue persists\n");

  // Exit code 1 signals failure to process managers (pm2, systemd, etc.)
  // This ensures the bot doesn't restart in a loop with corrupt data.
  process.exit(1);
}
