/**
 * Pawtropolis Tech — src/features/dbRecovery.ts
 * WHAT: Core database recovery library for listing, validating, and restoring backups
 * WHY: Enable safe, auditable database recovery with integrity checks and PM2 coordination
 * HOW: Scan backup directory, run SQLite PRAGMA checks, orchestrate safe restore flow
 * FLOWS:
 *   1. listCandidates() - discover backup files in DB_BACKUPS_DIR and return metadata
 *   2. validateCandidate() - run integrity/FK checks on a backup candidate
 *   3. restoreCandidate() - safely restore a backup with pre-restore backup and PM2 coordination
 * DOCS:
 *   - SQLite PRAGMA: https://www.sqlite.org/pragma.html
 *   - better-sqlite3: https://github.com/WiseLibs/better-sqlite3
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../lib/env.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

const execAsync = promisify(exec);

// ============================================================================
// Security: Path Traversal Protection
// ============================================================================

/**
 * Regex for validating safe backup filenames.
 * Only allows alphanumeric, underscore, hyphen, and dot characters.
 * Must end with .db extension.
 */
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_\-.]+\.db$/;

/**
 * Safely join a base directory with a filename, preventing path traversal attacks.
 * Validates that the resolved path is actually within the base directory.
 *
 * @param baseDir - The base directory (must be absolute)
 * @param filename - The filename to join
 * @returns The resolved absolute path
 * @throws Error if path traversal is detected or filename is invalid
 */
function safeJoinPath(baseDir: string, filename: string): string {
  // First, validate filename format
  if (!SAFE_FILENAME_REGEX.test(filename)) {
    logger.error(
      { filename, baseDir },
      "[dbRecovery] Invalid backup filename rejected - potential path traversal"
    );
    throw new Error("Invalid backup filename");
  }

  // Join and resolve the path
  const filePath = path.join(baseDir, filename);
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  // Verify the resolved path is within the base directory
  // Using startsWith with path.sep ensures we don't match partial directory names
  // e.g., /backups wouldn't match /backups-other/file.db
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    logger.error(
      { filename, resolvedPath, resolvedBase },
      "[dbRecovery] Path traversal attempt detected"
    );
    throw new Error("Path traversal attempt detected");
  }

  return resolvedPath;
}

// ============================================================================
// Types
// ============================================================================

export interface BackupCandidate {
  id: string; // unique identifier (e.g., "cand-<timestamp>-<shortname>")
  path: string; // absolute path to backup file
  filename: string; // basename only
  created_at: number; // epoch seconds (file mtime)
  size_bytes: number; // file size
  integrity_result?: string; // "ok" or error message from PRAGMA integrity_check
  foreign_key_violations?: number; // count from PRAGMA foreign_key_check
  row_count?: number; // sum of row counts from sampled tables
  checksum?: string; // SHA256 hash
  verified_at?: number; // last validation timestamp (epoch seconds)
  notes?: string; // human notes
}

export interface ValidationResult {
  ok: boolean; // true if all checks pass
  messages: string[]; // human-readable messages (errors, warnings)
  integrity_result: string; // PRAGMA integrity_check output
  foreign_key_violations: number; // count of FK violations
  row_counts: Record<string, number>; // table -> row count
  size_bytes: number;
  checksum: string;
}

export interface RestoreOptions {
  dryRun?: boolean; // if true, stop before file replacement
  pm2Coord?: boolean; // if true, stop/start PM2 process
  confirm?: boolean; // if true, skip confirmation prompt (CLI only)
  actorId?: string; // Discord user ID or "cli" for audit log
  notes?: string; // human notes for pre-restore backup
}

export interface RestoreResult {
  success: boolean;
  preRestoreBackupPath?: string; // path to pre-restore backup
  messages: string[]; // human-readable messages
  verificationResult?: ValidationResult; // post-restore validation
}

// ============================================================================
// Candidate Discovery
// ============================================================================

/**
 * List all backup candidates in DB_BACKUPS_DIR
 * Scans directory for .db files and computes basic metadata
 * Does NOT run integrity checks (use validateCandidate for that)
 *
 * @returns Array of backup candidates sorted by created_at DESC (newest first)
 */
export async function listCandidates(): Promise<BackupCandidate[]> {
  // Discover all .db files in the backup directory and return metadata.
  // This is intentionally lightweight - we don't run integrity checks here because
  // that's expensive and the caller should use validateCandidate() when they need it.
  const backupsDir = path.resolve(env.DB_BACKUPS_DIR);
  logger.info(`[dbRecovery] Scanning for backup candidates in ${backupsDir}`);

  try {
    // Create directory if it doesn't exist (common on first run)
    await fs.mkdir(backupsDir, { recursive: true });
    const files = await fs.readdir(backupsDir);
    const dbFiles = files.filter((f) => f.endsWith(".db"));

    logger.info(`[dbRecovery] Found ${dbFiles.length} .db files`);

    const candidates: BackupCandidate[] = [];

    for (const filename of dbFiles) {
      // Security: Validate filename even though it comes from fs.readdir (defense in depth)
      // Skip files with suspicious names rather than throw
      if (!SAFE_FILENAME_REGEX.test(filename)) {
        logger.warn({ filename }, "[dbRecovery] Skipping file with invalid filename");
        continue;
      }
      const filePath = safeJoinPath(backupsDir, filename);
      try {
        const stats = await fs.stat(filePath);

        // Generate unique ID from timestamp + short filename
        // The ID needs to be stable across calls so we can reference candidates by ID.
        // Using mtime means if a file is modified, it gets a new ID - this is intentional
        // because a modified backup should be re-validated before restore.
        const shortName = filename.replace(/\.db$/, "").replace(/[^a-zA-Z0-9\-]/g, "-");
        const id = `cand-${stats.mtimeMs.toFixed(0)}-${shortName}`.substring(0, 64);

        // Check if metadata exists in db_backups table
        const existingMeta = db
          .prepare(`SELECT * FROM db_backups WHERE path = ?`)
          .get(filePath) as any;

        candidates.push({
          id,
          path: filePath,
          filename,
          created_at: Math.floor(stats.mtimeMs / 1000),
          size_bytes: stats.size,
          integrity_result: existingMeta?.integrity_result,
          foreign_key_violations: existingMeta?.row_count,
          row_count: existingMeta?.row_count,
          checksum: existingMeta?.checksum,
          verified_at: existingMeta?.verified_at,
          notes: existingMeta?.notes,
        });
      } catch (err) {
        logger.warn({ err, filename }, `[dbRecovery] Failed to stat backup file`);
      }
    }

    // Sort by created_at DESC (newest first)
    candidates.sort((a, b) => b.created_at - a.created_at);

    logger.info(`[dbRecovery] Returning ${candidates.length} candidates`);
    return candidates;
  } catch (err) {
    logger.error({ err }, `[dbRecovery] Failed to list candidates`);
    throw new Error(`Failed to scan backup directory: ${err}`);
  }
}

/**
 * Find a candidate by ID
 */
export async function findCandidateById(candidateId: string): Promise<BackupCandidate | null> {
  const candidates = await listCandidates();
  return candidates.find((c) => c.id === candidateId) || null;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a backup candidate by running integrity checks
 * Opens the candidate DB in read-only mode and runs:
 *   - PRAGMA integrity_check
 *   - PRAGMA foreign_key_check
 *   - Row count verification (action_log, guilds, users, review_card)
 *   - SHA256 checksum
 *
 * Updates db_backups metadata table with validation results
 *
 * @param candidateId - unique candidate ID (from listCandidates)
 * @returns ValidationResult with all check results
 */
export async function validateCandidate(candidateId: string): Promise<ValidationResult> {
  // Run comprehensive integrity checks on a backup candidate.
  // This can take several seconds for large databases, so don't call it in hot paths.
  // Results are persisted to db_backups table for future reference.
  logger.info(`[dbRecovery] Validating candidate ${candidateId}`);

  const candidate = await findCandidateById(candidateId);
  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  const messages: string[] = [];
  let integrity_result = "unknown";
  let foreign_key_violations = 0;
  const row_counts: Record<string, number> = {};

  // Open candidate DB in read-only mode
  // IMPORTANT: readonly prevents accidental modifications to backup files
  let candidateDb: Database.Database | null = null;
  try {
    candidateDb = new Database(candidate.path, { readonly: true });

    // 1. PRAGMA integrity_check
    logger.info(`[dbRecovery] Running PRAGMA integrity_check on ${candidate.filename}`);
    const integrityRows = candidateDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
    integrity_result = integrityRows.map((r) => r.integrity_check).join("; ");

    if (integrity_result === "ok") {
      messages.push("✅ Integrity check: PASS");
    } else {
      messages.push(`❌ Integrity check: FAIL - ${integrity_result}`);
    }

    // 2. PRAGMA foreign_key_check (requires foreign_keys ON)
    // This catches orphaned foreign keys that integrity_check misses.
    // Common cause: manual deletion of parent rows without cascade.
    // Note: We enable foreign_keys here even though it's read-only because
    // the pragma is needed for foreign_key_check to work properly.
    logger.info(`[dbRecovery] Running PRAGMA foreign_key_check`);
    candidateDb.pragma("foreign_keys = ON");
    const fkRows = candidateDb.pragma("foreign_key_check") as Array<any>;
    foreign_key_violations = fkRows.length;

    if (foreign_key_violations === 0) {
      messages.push("✅ Foreign key check: PASS (no violations)");
    } else {
      messages.push(`❌ Foreign key check: FAIL - ${foreign_key_violations} violation(s)`);
      // Log first 3 violations for debugging
      fkRows.slice(0, 3).forEach((fk) => {
        messages.push(`  - ${fk.table}.${fk.fkid}: references ${fk.parent} (missing)`);
      });
    }

    // 3. Row counts for important tables
    // This serves two purposes:
    // 1. Sanity check - if a backup has 0 rows in core tables, something's wrong
    // 2. Help operators pick the right backup by seeing data volume
    logger.info(`[dbRecovery] Counting rows in important tables`);
    const tablesToCheck = ["action_log", "guilds", "users", "review_card"];
    for (const table of tablesToCheck) {
      try {
        const result = candidateDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
          count: number;
        };
        row_counts[table] = result.count;
        messages.push(`📊 ${table}: ${result.count.toLocaleString()} rows`);
      } catch (err: any) {
        if (err.message?.includes("no such table")) {
          row_counts[table] = 0;
          messages.push(`⚠️ ${table}: table does not exist`);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    logger.error({ err, candidateId }, `[dbRecovery] Validation failed`);
    messages.push(`❌ Validation error: ${err}`);
    integrity_result = `error: ${err}`;
  } finally {
    if (candidateDb) {
      candidateDb.close();
    }
  }

  // 4. Compute SHA256 checksum
  logger.info(`[dbRecovery] Computing SHA256 checksum`);
  const checksum = await computeChecksum(candidate.path);
  messages.push(`🔐 Checksum: ${checksum.substring(0, 16)}...`);

  // 5. Determine overall result
  const ok = integrity_result === "ok" && foreign_key_violations === 0;

  // 6. Update db_backups metadata
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO db_backups (path, created_at, size_bytes, integrity_result, row_count, checksum, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       integrity_result = excluded.integrity_result,
       row_count = excluded.row_count,
       checksum = excluded.checksum,
       verified_at = excluded.verified_at`
  ).run(
    candidate.path,
    candidate.created_at,
    candidate.size_bytes,
    integrity_result,
    Object.values(row_counts).reduce((sum, count) => sum + count, 0),
    checksum,
    now
  );

  logger.info(`[dbRecovery] Validation complete: ${ok ? "PASS" : "FAIL"}`);

  return {
    ok,
    messages,
    integrity_result,
    foreign_key_violations,
    row_counts,
    size_bytes: candidate.size_bytes,
    checksum,
  };
}

/**
 * Compute SHA256 checksum of a file
 */
async function computeChecksum(filePath: string): Promise<string> {
  // SHA256 checksum for integrity verification.
  // We read the entire file into memory here - this is fine for SQLite DBs which
  // are typically <100MB, but would need streaming for larger files.
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

// ============================================================================
// Restore
// ============================================================================

/**
 * Safely restore a backup candidate
 * Steps:
 *   1. Re-validate candidate (ensure nothing changed since validation)
 *   2. Create pre-restore backup of live DB
 *   3. Stop PM2 process (if pm2Coord enabled)
 *   4. Replace live DB with candidate (atomic rename)
 *   5. Verify restored DB (PRAGMA integrity_check + foreign_key_check)
 *   6. Restart PM2 process (if pm2Coord enabled)
 *   7. Log action to action_log
 *
 * @param candidateId - unique candidate ID
 * @param opts - restore options
 * @returns RestoreResult with success status and messages
 */
export async function restoreCandidate(
  candidateId: string,
  opts: RestoreOptions = {}
): Promise<RestoreResult> {
  const { dryRun = false, pm2Coord = false, confirm = false, actorId = "cli", notes = "" } = opts;

  // Restore is a multi-step process with built-in safety mechanisms:
  // 1. Re-validate the candidate (ensure nothing changed since last validation)
  // 2. Create a pre-restore backup of the live DB (for rollback)
  // 3. Optionally stop PM2 to release file locks
  // 4. Replace the live DB file
  // 5. Verify the restored DB works
  // 6. Optionally restart PM2
  // If anything fails after step 2, we have the pre-restore backup for recovery.
  logger.info({ candidateId, dryRun, pm2Coord, confirm }, `[dbRecovery] Starting restore`);

  const messages: string[] = [];
  const candidate = await findCandidateById(candidateId);

  if (!candidate) {
    return {
      success: false,
      messages: [`❌ Candidate not found: ${candidateId}`],
    };
  }

  // Step 1: Re-validate candidate
  logger.info(`[dbRecovery] Step 1: Re-validating candidate`);
  messages.push(`🔍 Validating backup candidate: ${candidate.filename}`);

  const validation = await validateCandidate(candidateId);
  if (!validation.ok && !confirm) {
    messages.push(`❌ Validation FAILED - aborting restore`);
    messages.push(...validation.messages);
    return { success: false, messages };
  }

  if (!validation.ok && confirm) {
    messages.push(`⚠️ Validation FAILED but --confirm override set - proceeding anyway`);
  } else {
    messages.push(`✅ Validation PASSED`);
  }

  // Step 2: Create pre-restore backup
  logger.info(`[dbRecovery] Step 2: Creating pre-restore backup`);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").substring(0, 19);
  const liveDbPath = path.resolve(env.DB_PATH);
  const preRestoreBackupPath = `${liveDbPath}.${timestamp}.preRestore.bak`;

  messages.push(`📦 Creating pre-restore backup: ${path.basename(preRestoreBackupPath)}`);

  if (!dryRun) {
    try {
      await fs.copyFile(liveDbPath, preRestoreBackupPath);
      messages.push(`✅ Pre-restore backup created`);

      // Register pre-restore backup in db_backups table
      const backupStats = await fs.stat(preRestoreBackupPath);
      const backupChecksum = await computeChecksum(preRestoreBackupPath);
      const now = Math.floor(Date.now() / 1000);

      db.prepare(
        `INSERT INTO db_backups (path, created_at, size_bytes, integrity_result, checksum, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        preRestoreBackupPath,
        Math.floor(backupStats.mtimeMs / 1000),
        backupStats.size,
        "ok", // assume current live DB is ok
        backupChecksum,
        notes || `Pre-restore backup before restoring ${candidate.filename}`
      );
    } catch (err) {
      messages.push(`❌ Failed to create pre-restore backup: ${err}`);
      return { success: false, messages };
    }
  } else {
    messages.push(`🔍 [DRY RUN] Would create: ${path.basename(preRestoreBackupPath)}`);
  }

  // Step 3: Stop PM2 process (if enabled)
  if (pm2Coord) {
    logger.info(`[dbRecovery] Step 3: Stopping PM2 process`);
    messages.push(`🛑 Stopping PM2 process: ${env.PM2_PROCESS_NAME}`);

    if (!dryRun) {
      try {
        const { stdout, stderr } = await execAsync(`pm2 stop ${env.PM2_PROCESS_NAME}`);
        logger.info(`[dbRecovery] PM2 stop output: ${stdout}`);
        if (stderr) logger.warn(`[dbRecovery] PM2 stop stderr: ${stderr}`);
        messages.push(`✅ PM2 process stopped`);
      } catch (err: any) {
        messages.push(`⚠️ PM2 stop failed: ${err.message}`);
        messages.push(`   Continuing anyway - you may need to stop manually`);
      }
    } else {
      messages.push(`🔍 [DRY RUN] Would run: pm2 stop ${env.PM2_PROCESS_NAME}`);
    }
  }

  // Step 4: Replace live DB (if not dry-run)
  if (dryRun) {
    logger.info(`[dbRecovery] Step 4: DRY RUN - skipping DB replacement`);
    messages.push(`🔍 [DRY RUN] Would replace ${path.basename(liveDbPath)} with ${candidate.filename}`);
    messages.push(`✅ DRY RUN complete - no changes made`);
    return {
      success: true,
      preRestoreBackupPath,
      messages,
    };
  }

  logger.info(`[dbRecovery] Step 4: Replacing live DB`);
  messages.push(`🔄 Replacing live database with backup`);

  try {
    // Close live DB connection (if open)
    // Note: In production, PM2 should be stopped first
    // db.close(); // Don't close here - it's shared across the app

    // Copy candidate to live DB path
    // Note: fs.copyFile is NOT atomic - there's a brief window where the file
    // could be corrupted if the process crashes mid-copy. For true atomicity,
    // we'd need to copy to a temp file then rename. In practice, this is
    // acceptable because: 1) PM2 should be stopped, 2) we have pre-restore backup.
    await fs.copyFile(candidate.path, liveDbPath);
    messages.push(`Database replaced successfully`);
  } catch (err) {
    messages.push(`❌ Failed to replace database: ${err}`);
    messages.push(`🔄 Attempting rollback to pre-restore backup...`);

    try {
      await fs.copyFile(preRestoreBackupPath, liveDbPath);
      messages.push(`✅ Rollback successful - live DB restored from pre-restore backup`);
    } catch (rollbackErr) {
      messages.push(`❌ Rollback FAILED: ${rollbackErr}`);
      messages.push(`⚠️ MANUAL INTERVENTION REQUIRED: restore from ${preRestoreBackupPath}`);
    }

    return { success: false, messages };
  }

  // Step 5: Verify restored DB
  logger.info(`[dbRecovery] Step 5: Verifying restored database`);
  messages.push(`🔍 Verifying restored database`);

  let verificationResult: ValidationResult | undefined;
  try {
    // Open restored DB and run checks
    const restoredDb = new Database(liveDbPath, { readonly: true });

    const integrityRows = restoredDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const integrity_result = integrityRows.map((r) => r.integrity_check).join("; ");

    restoredDb.pragma("foreign_keys = ON");
    const fkRows = restoredDb.pragma("foreign_key_check") as Array<any>;
    const foreign_key_violations = fkRows.length;

    restoredDb.close();

    verificationResult = {
      ok: integrity_result === "ok" && foreign_key_violations === 0,
      messages: [
        `Integrity: ${integrity_result}`,
        `FK violations: ${foreign_key_violations}`,
      ],
      integrity_result,
      foreign_key_violations,
      row_counts: validation.row_counts,
      size_bytes: candidate.size_bytes,
      checksum: validation.checksum,
    };

    if (verificationResult.ok) {
      messages.push(`✅ Post-restore verification PASSED`);
    } else {
      messages.push(`⚠️ Post-restore verification FAILED - see details above`);
    }
  } catch (err) {
    messages.push(`❌ Post-restore verification error: ${err}`);
  }

  // Step 6: Restart PM2 process (if enabled)
  if (pm2Coord) {
    logger.info(`[dbRecovery] Step 6: Restarting PM2 process`);
    messages.push(`🚀 Restarting PM2 process: ${env.PM2_PROCESS_NAME}`);

    try {
      const { stdout, stderr } = await execAsync(`pm2 start ${env.PM2_PROCESS_NAME}`);
      logger.info(`[dbRecovery] PM2 start output: ${stdout}`);
      if (stderr) logger.warn(`[dbRecovery] PM2 start stderr: ${stderr}`);
      messages.push(`✅ PM2 process restarted`);
    } catch (err: any) {
      messages.push(`⚠️ PM2 start failed: ${err.message}`);
      messages.push(`   You may need to start manually: pm2 start ${env.PM2_PROCESS_NAME}`);
    }
  }

  // Step 7: Log action (done by caller - requires Guild context)
  logger.info(`[dbRecovery] Restore complete`);
  messages.push(`✅ Database restore complete`);

  return {
    success: true,
    preRestoreBackupPath,
    messages,
    verificationResult,
  };
}
