/**
 * Pawtropolis Tech — src/commands/database.ts
 * WHAT: Database health check command (/database check)
 * WHY: Allows staff to verify database integrity of both local and remote databases
 * HOW: Runs integrity checks, displays stats, and shows sync status in a pretty embed
 * DOCS:
 *  - Slash commands: https://discord.com/developers/docs/interactions/application-commands
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { requireStaff } from "../lib/config.js";
import {
  wrapCommand,
  type CommandContext,
  replyOrEdit,
} from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { checkDatabaseHealth } from "../lib/dbHealthCheck.js";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import { listCandidates, validateCandidate, restoreCandidate, findCandidateById } from "../features/dbRecovery.js";
import { buildCandidateListEmbed, buildValidationEmbed, buildRestoreSummaryEmbed, buildCandidateActionRow } from "../ui/dbRecoveryCard.js";
import { randomBytes } from "crypto";
import { env } from "../lib/env.js";
import { secureCompare } from "../lib/secureCompare.js";

const execAsync = promisify(exec);

interface BackupInfo {
  count: number;
  totalSize: number;
  oldestDate: Date | null;
  newestDate: Date | null;
  files: Array<{ name: string; size: number; date: Date }>;
}

/**
 * Scans a directory for .db backup files and collects metadata.
 * Used for both local and remote backup analysis in the health report.
 *
 * The function is intentionally synchronous because it's reading local fs
 * and we want the whole health check to be a single atomic snapshot.
 */
function analyzeBackups(backupDir: string): BackupInfo {
  const result: BackupInfo = {
    count: 0,
    totalSize: 0,
    oldestDate: null,
    newestDate: null,
    files: [],
  };

  if (!fs.existsSync(backupDir)) {
    return result;
  }

  // Only count .db files. WAL/SHM files are SQLite internals, not backups.
  const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db"));

  for (const file of files) {
    const filePath = path.join(backupDir, file);
    try {
      const stats = fs.statSync(filePath);
      result.files.push({
        name: file,
        size: stats.size,
        date: stats.mtime,
      });
      result.totalSize += stats.size;
    } catch (err) {
      logger.debug({ err, file }, "[database] Could not stat backup file");
    }
  }

  result.count = result.files.length;
  result.files.sort((a, b) => b.date.getTime() - a.date.getTime());

  if (result.files.length > 0) {
    result.newestDate = result.files[0].date;
    result.oldestDate = result.files[result.files.length - 1].date;
  }

  return result;
}

function calculateBackupFrequency(backups: BackupInfo): string {
  if (backups.count < 2 || !backups.newestDate || !backups.oldestDate) {
    return "Unknown";
  }

  const spanMs = backups.newestDate.getTime() - backups.oldestDate.getTime();
  const spanHours = spanMs / (1000 * 60 * 60);
  const avgHoursBetween = spanHours / (backups.count - 1);

  if (avgHoursBetween < 1) {
    return `~${Math.round(avgHoursBetween * 60)}m between backups`;
  } else if (avgHoursBetween < 24) {
    return `~${Math.round(avgHoursBetween)}h between backups`;
  } else {
    return `~${Math.round(avgHoursBetween / 24)}d between backups`;
  }
}

/**
 * Detects if we're running on the production server vs a dev machine.
 * This matters because we skip SSH-to-remote checks when already on remote
 * (no point SSH'ing to yourself, and it would probably fail anyway).
 *
 * The heuristics are fragile - they assume the prod server is Ubuntu on AWS.
 * If the deployment changes, update these checks.
 */
function isRunningOnRemote(): boolean {
  const hostname = os.hostname().toLowerCase();
  const cwd = process.cwd();

  return (
    hostname.includes("ubuntu") ||
    hostname.includes("aws") ||
    hostname.includes("ec2") ||
    cwd.includes("/home/ubuntu") ||
    cwd.includes("pawtech-v2")
  );
}

export const data = new SlashCommandBuilder()
  .setName("database")
  .setDescription("Database management commands")
  .addSubcommand((sc) =>
    sc.setName("check").setDescription("Check database health and integrity (local and remote)")
  )
  .addSubcommand((sc) =>
    sc
      .setName("recover")
      .setDescription("Interactive database recovery assistant (list, validate, restore backups)")
      .addStringOption((opt) =>
        opt
          .setName("password")
          .setDescription("Admin password (RESET_PASSWORD)")
          .setRequired(true)
      )
  );

async function executeCheck(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Defer reply without ephemeral flag so everyone can see it
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  ctx.step("check_local_db");
  logger.info({ guildId: interaction.guildId }, "[database] Running health check");

  // Detect if we're running on remote
  const runningOnRemote = isRunningOnRemote();
  const hostname = os.hostname();
  const platform = os.platform();

  // Get local database health
  const localHealth = checkDatabaseHealth();

  // Get database file info
  const dbPath = path.resolve("./data/data.db");
  let fileStats: fs.Stats | null = null;
  let fileSizeMB = 0;
  let fileModified = "Unknown";

  try {
    fileStats = fs.statSync(dbPath);
    fileSizeMB = fileStats.size / 1024 / 1024;
    fileModified = fileStats.mtime.toISOString();
  } catch (err) {
    logger.warn({ err }, "[database] Could not stat database file");
  }

  // Get manifest info if available
  let manifest: any = null;
  try {
    const manifestPath = path.resolve("./data/.db-manifest.json");
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    }
  } catch (err) {
    logger.debug({ err }, "[database] Could not read manifest");
  }

  // Analyze local backups
  ctx.step("analyze_local_backups");
  const localBackups = analyzeBackups(path.resolve("./data/backups"));
  const localBackupFreq = calculateBackupFrequency(localBackups);

  // Try to analyze remote backups
  let remoteBackups: BackupInfo | null = null;
  let remoteBackupFreq = "Unknown";

  // Try to check remote database (if SSH configured)
  ctx.step("check_remote_db");
  let remoteHealth: any = null;
  let remoteError: string | null = null;

  try {
    // Check if we have remote config from env
    const remoteAlias = process.env.REMOTE_ALIAS || "pawtech";
    const remotePath = process.env.REMOTE_PATH || "/home/ubuntu/pawtech-v2";

    // Skip remote checks if we're already running on remote
    if (runningOnRemote) {
      remoteError = "Skipped (already running on remote server)";
      throw new Error("Running on remote");
    }

    // SSH options explained:
    // - ConnectTimeout=10: Don't hang forever if server is unreachable
    // - ServerAliveInterval=5: Detect dead connections faster
    // - StrictHostKeyChecking=no: Don't fail on first connect (risky in prod, fine here)
    // - BatchMode=yes: Never prompt for password (fail instead)
    // The inner timeout is a belt-and-suspenders with execAsync timeout.
    const remoteCmd = `ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 -o StrictHostKeyChecking=no -o BatchMode=yes ${remoteAlias} "bash -c 'cd ${remotePath} && timeout 10 node scripts/verify-db-integrity.js data/data.db --verbose 2>&1'"`;

    const { stdout, stderr } = await execAsync(remoteCmd, { timeout: 20000 });

    if (stdout) {
      try {
        remoteHealth = JSON.parse(stdout);
      } catch {
        remoteError = "Could not parse remote health check output";
      }
    } else if (stderr) {
      remoteError = stderr.slice(0, 200);
    }

    // Try to get remote backup info
    try {
      const backupCmd = `ssh -o ConnectTimeout=5 -o BatchMode=yes ${remoteAlias} "bash -c 'cd ${remotePath}/data/backups && find . -maxdepth 1 -name \"*.db\" -type f -exec stat -c \"%n|%s|%Y\" {} \\; 2>/dev/null || true'"`;
      const { stdout: backupStdout } = await execAsync(backupCmd, { timeout: 10000 });

      if (backupStdout) {
        remoteBackups = { count: 0, totalSize: 0, oldestDate: null, newestDate: null, files: [] };
        const lines = backupStdout.trim().split("\n").filter((l) => l);

        for (const line of lines) {
          const [name, size, timestamp] = line.split("|");
          if (name && size && timestamp) {
            const date = new Date(parseInt(timestamp) * 1000);
            remoteBackups.files.push({
              name: name.replace("./", ""),
              size: parseInt(size),
              date,
            });
            remoteBackups.totalSize += parseInt(size);
          }
        }

        remoteBackups.count = remoteBackups.files.length;
        remoteBackups.files.sort((a, b) => b.date.getTime() - a.date.getTime());

        if (remoteBackups.files.length > 0) {
          remoteBackups.newestDate = remoteBackups.files[0].date;
          remoteBackups.oldestDate = remoteBackups.files[remoteBackups.files.length - 1].date;
        }

        remoteBackupFreq = calculateBackupFrequency(remoteBackups);
      }
    } catch (err) {
      logger.debug({ err }, "[database] Could not get remote backup info");
    }
  } catch (err) {
    if (!remoteError) {
      remoteError = "SSH connection failed or not configured";
    }
    logger.debug({ err }, "[database] Remote health check failed");
  }

  // Build embed
  ctx.step("build_embed");
  const contextLabel = runningOnRemote ? "Remote Server" : "Local Machine";

  const embed = new EmbedBuilder()
    .setTitle("Database Health Report")
    .setDescription(`**Running on:** ${contextLabel} (\`${hostname}\` / ${platform})`)
    .setColor(localHealth.healthy ? Colors.Green : Colors.Red)
    .setTimestamp();

  // Local Database Section
  const localStatus = localHealth.healthy ? "Healthy" : "Unhealthy";
  const localIntegrity = localHealth.integrity.toUpperCase();

  let localValue = `**Status:** ${localStatus}\n`;
  localValue += `**Integrity:** ${localIntegrity}\n`;
  localValue += `**Size:** ${fileSizeMB.toFixed(2)} MB\n`;
  localValue += `**Modified:** ${fileModified}\n\n`;

  localValue += `**Tables:**\n`;
  Object.entries(localHealth.tables).forEach(([table, count]) => {
    localValue += `• ${table}: \`${typeof count === "number" ? count.toLocaleString() : count}\`\n`;
  });

  if (localHealth.errors.length > 0) {
    localValue += `\n**Errors (${localHealth.errors.length}):**\n`;
    localHealth.errors.slice(0, 3).forEach((err) => {
      localValue += `• ${err.slice(0, 100)}\n`;
    });
    if (localHealth.errors.length > 3) {
      localValue += `• ...and ${localHealth.errors.length - 3} more\n`;
    }
  }

  if (localHealth.warnings.length > 0) {
    localValue += `\n**Warnings (${localHealth.warnings.length}):**\n`;
    localHealth.warnings.slice(0, 3).forEach((warn) => {
      localValue += `• ${warn.slice(0, 100)}\n`;
    });
    if (localHealth.warnings.length > 3) {
      localValue += `• ...and ${localHealth.warnings.length - 3} more\n`;
    }
  }

  embed.addFields({ name: "Local Database", value: localValue, inline: false });

  // Remote Database Section
  if (remoteHealth) {
    const remoteStatus = remoteHealth.healthy ? "Healthy" : "Unhealthy";
    const remoteIntegrity = remoteHealth.integrity.toUpperCase();

    let remoteValue = `**Status:** ${remoteStatus}\n`;
    remoteValue += `**Integrity:** ${remoteIntegrity}\n`;
    remoteValue += `**Size:** ${(remoteHealth.size / 1024 / 1024).toFixed(2)} MB\n\n`;

    remoteValue += `**Tables:**\n`;
    Object.entries(remoteHealth.tables).forEach(([table, count]) => {
      remoteValue += `• ${table}: \`${typeof count === "number" ? count.toLocaleString() : count}\`\n`;
    });

    if (remoteHealth.errors?.length > 0) {
      remoteValue += `\n**Errors (${remoteHealth.errors.length}):**\n`;
      remoteHealth.errors.slice(0, 2).forEach((err: string) => {
        remoteValue += `• ${err.slice(0, 100)}\n`;
      });
      if (remoteHealth.errors.length > 2) {
        remoteValue += `• ...and ${remoteHealth.errors.length - 2} more\n`;
      }
    }

    embed.addFields({ name: "Remote Database", value: remoteValue, inline: false });
  } else {
    embed.addFields({
      name: "Remote Database",
      value: `**Status:** Unavailable\n**Reason:** ${remoteError || "Unknown"}`,
      inline: false,
    });
  }

  // Sync Status Section
  if (manifest) {
    let syncValue = `**Last Sync:** ${new Date(manifest.synced_at).toLocaleString()}\n`;
    syncValue += `**Mode:** ${manifest.mode}\n\n`;

    syncValue += `**Local at sync:**\n`;
    syncValue += `• Exists: ${manifest.local.exists ? "Yes" : "No"}\n`;
    if (manifest.local.exists) {
      syncValue += `• Size: ${(manifest.local.size / 1024 / 1024).toFixed(2)} MB\n`;
      syncValue += `• SHA256: \`${manifest.local.sha256?.slice(0, 16)}...\`\n`;
    }

    syncValue += `\n**Remote at sync:**\n`;
    syncValue += `• Exists: ${manifest.remote.exists ? "Yes" : "No"}\n`;
    if (manifest.remote.exists) {
      syncValue += `• Size: ${(manifest.remote.size / 1024 / 1024).toFixed(2)} MB\n`;
      syncValue += `• SHA256: \`${manifest.remote.sha256?.slice(0, 16)}...\`\n`;
    }

    embed.addFields({ name: "Last Sync Status", value: syncValue, inline: false });
  }

  // Local Backups Section
  let localBackupValue = `**Total Backups:** ${localBackups.count}\n`;
  localBackupValue += `**Total Size:** ${(localBackups.totalSize / 1024 / 1024).toFixed(2)} MB\n`;
  localBackupValue += `**Frequency:** ${localBackupFreq}\n`;

  if (localBackups.newestDate) {
    const timeSinceNewest = Date.now() - localBackups.newestDate.getTime();
    const hoursSince = timeSinceNewest / (1000 * 60 * 60);
    localBackupValue += `**Newest:** ${localBackups.newestDate.toLocaleString()} (${hoursSince < 24 ? `${Math.round(hoursSince)}h ago` : `${Math.round(hoursSince / 24)}d ago`})\n`;
  }

  if (localBackups.oldestDate) {
    localBackupValue += `**Oldest:** ${localBackups.oldestDate.toLocaleString()}\n`;
  }

  if (localBackups.files.length > 0) {
    localBackupValue += `\n**Recent Backups (top 5):**\n`;
    localBackups.files.slice(0, 5).forEach((file) => {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      const type = file.name.includes(".local.") ? "[L]" : file.name.includes(".remote.") ? "[R]" : "[*]";
      localBackupValue += `${type} \`${file.name.slice(0, 35)}${file.name.length > 35 ? "..." : ""}\` (${sizeMB}MB)\n`;
    });
  }

  embed.addFields({ name: "Local Backups", value: localBackupValue, inline: false });

  // Remote Backups Section (if available)
  if (remoteBackups && remoteBackups.count > 0) {
    let remoteBackupValue = `**Total Backups:** ${remoteBackups.count}\n`;
    remoteBackupValue += `**Total Size:** ${(remoteBackups.totalSize / 1024 / 1024).toFixed(2)} MB\n`;
    remoteBackupValue += `**Frequency:** ${remoteBackupFreq}\n`;

    if (remoteBackups.newestDate) {
      const timeSinceNewest = Date.now() - remoteBackups.newestDate.getTime();
      const hoursSince = timeSinceNewest / (1000 * 60 * 60);
      remoteBackupValue += `**Newest:** ${remoteBackups.newestDate.toLocaleString()} (${hoursSince < 24 ? `${Math.round(hoursSince)}h ago` : `${Math.round(hoursSince / 24)}d ago`})\n`;
    }

    if (remoteBackups.oldestDate) {
      remoteBackupValue += `**Oldest:** ${remoteBackups.oldestDate.toLocaleString()}\n`;
    }

    if (remoteBackups.files.length > 0) {
      remoteBackupValue += `\n**Recent Backups (top 5):**\n`;
      remoteBackups.files.slice(0, 5).forEach((file) => {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        const type = file.name.includes(".local.") ? "[L]" : file.name.includes(".remote.") ? "[R]" : "[*]";
        remoteBackupValue += `${type} \`${file.name.slice(0, 35)}${file.name.length > 35 ? "..." : ""}\` (${sizeMB}MB)\n`;
      });
    }

    embed.addFields({ name: "Remote Backups", value: remoteBackupValue, inline: false });
  }

  // Add footer with recommendations
  let footer = "";
  if (!localHealth.healthy) {
    footer = "Action Required: Local database needs attention. Check logs and consider restoring from backup.";
  } else if (remoteHealth && !remoteHealth.healthy) {
    footer = "Action Required: Remote database needs attention. Consider pushing local to remote.";
  } else if (localHealth.warnings.length > 0) {
    footer = "Warnings detected. Review warnings above for details.";
  } else {
    footer = "All systems healthy.";
  }

  embed.setFooter({ text: footer });

  ctx.step("reply");
  await replyOrEdit(interaction, {
    embeds: [embed],
  });

  logger.info(
    {
      guildId: interaction.guildId,
      localHealthy: localHealth.healthy,
      remoteHealthy: remoteHealth?.healthy ?? null,
      moderatorId: interaction.user.id,
    },
    "[database] Health check completed"
  );
}

/**
 * Database recovery is a dangerous operation - it replaces the live database with a backup.
 * We require a password (RESET_PASSWORD env var) as an extra gate beyond Discord permissions.
 * This prevents accidental recovery and provides an audit trail.
 *
 * The password is passed as a command option rather than DM because we want
 * the whole flow to happen in Discord where it's visible to other staff.
 */
async function executeRecover(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("validate_password");
  const password = interaction.options.getString("password", true).trim();

  if (!env.RESET_PASSWORD) {
    await interaction.reply({
      content: "RESET_PASSWORD not configured in environment.",
      ephemeral: true,
    });
    return;
  }

  // Use constant-time comparison to prevent timing attacks. Probably overkill
  // for a Discord bot, but it's the right habit.
  if (!secureCompare(password, env.RESET_PASSWORD)) {
    logger.warn(
      {
        evt: "db_recover_denied",
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
      "[database] Recovery denied: invalid password"
    );
    await interaction.reply({
      content: "Password incorrect.",
      ephemeral: true,
    });
    return;
  }

  // Password validated - proceed with recovery
  logger.info(
    {
      evt: "db_recover_authorized",
      guildId: interaction.guildId,
      userId: interaction.user.id,
    },
    "[database] Recovery authorized"
  );

  // Ephemeral because the response contains file paths and system info
  // that shouldn't be visible to the whole server.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  ctx.step("list_candidates");
  logger.info({ guildId: interaction.guildId, userId: interaction.user.id }, "[database] Recovery assistant invoked");

  try {
    // List backup candidates
    const candidates = await listCandidates();
    logger.info({ candidateCount: candidates.length }, "[database] Listed backup candidates");

    // Build embed with candidate list
    const embed = buildCandidateListEmbed(candidates, interaction.guild?.name);

    // Discord limits messages to 5 action rows. Each candidate gets its own row
    // with Validate/Restore buttons. The nonce is a CSRF-ish token that ensures
    // button clicks came from this specific invocation (prevents replay attacks
    // if someone saves button customIds and tries to use them later).
    const actionRows = candidates.slice(0, 5).map((c) => {
      const nonce = randomBytes(4).toString("hex");
      return buildCandidateActionRow(c.id, nonce);
    });

    ctx.step("reply_with_candidates");
    await replyOrEdit(interaction, {
      embeds: [embed],
      components: actionRows,
    });

    logger.info(
      { guildId: interaction.guildId, userId: interaction.user.id, candidateCount: candidates.length },
      "[database] Recovery assistant embed sent"
    );
  } catch (err) {
    logger.error({ err, guildId: interaction.guildId, userId: interaction.user.id }, "[database] Recovery assistant failed");

    await replyOrEdit(interaction, {
      content: `❌ Failed to list backup candidates: ${err}`,
    });
  }
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "check") {
    await executeCheck(ctx);
  } else if (subcommand === "recover") {
    await executeRecover(ctx);
  }
}
