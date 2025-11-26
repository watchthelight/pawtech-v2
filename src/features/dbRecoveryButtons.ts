/**
 * Pawtropolis Tech — src/features/dbRecoveryButtons.ts
 * WHAT: Button interaction handlers for database recovery actions
 * WHY: Separate button logic from command logic for better organization
 * HOW: Handle validate, dry-run restore, and confirm restore button clicks
 * FLOWS:
 *   - Validate: run integrity checks and show validation embed
 *   - Restore (Dry Run): test restore flow without actual DB replacement
 *   - Restore (Confirm): perform actual DB restore with PM2 coordination
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ButtonInteraction } from "discord.js";
import { logger } from "../lib/logger.js";
import { findCandidateById, validateCandidate, restoreCandidate } from "./dbRecovery.js";
import { buildValidationEmbed, buildRestoreSummaryEmbed } from "../ui/dbRecoveryCard.js";
import { logActionPretty } from "../logging/pretty.js";

/**
 * Handle database recovery button interactions
 * Custom ID format: dbrecover:<action>:<candidateId>:<nonce>
 *   - action: validate | restore-dry | restore-confirm
 *   - candidateId: unique candidate ID
 *   - nonce: random hex string for security
 *
 * Design: The nonce exists to prevent replay attacks on recovery buttons and ensures
 * each button click is tied to a specific recovery card generation. Without it,
 * someone could craft a malicious button ID pointing to an arbitrary candidate.
 */
export async function handleDbRecoveryButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild } = interaction;

  // Parse custom ID with strict regex to prevent injection.
  // The nonce is 8 hex chars - short enough for Discord's customId limit,
  // long enough to be impractical to brute force within button expiry.
  const match = customId.match(/^dbrecover:([a-zA-Z\-]+):([a-zA-Z0-9\-]+):([a-f0-9]{8})$/);
  if (!match) {
    logger.warn({ customId }, "[dbRecovery] Invalid button custom ID format");
    await interaction.reply({
      content: "❌ Invalid button ID format. Please use `/database recover` to generate a new recovery card.",
      ephemeral: true,
    });
    return;
  }

  const [, action, candidateId, nonce] = match;

  logger.info(
    { action, candidateId, nonce, userId: user.id, guildId: guild?.id },
    "[dbRecovery] Button interaction received"
  );

  // Defer immediately - validation and restore ops can take 5-30s depending on
  // DB size and whether PM2 coordination is involved. Discord kills interactions
  // after 3s without acknowledgment.
  await interaction.deferReply({ ephemeral: true });

  try {
    // Find candidate
    const candidate = await findCandidateById(candidateId);
    if (!candidate) {
      await interaction.editReply({
        content: `❌ Backup candidate not found: \`${candidateId}\`\n\nIt may have been removed from the backups directory.`,
      });
      return;
    }

    // Handle action
    switch (action) {
      case "validate": {
        logger.info({ candidateId, userId: user.id }, "[dbRecovery] Validating candidate");

        const validation = await validateCandidate(candidateId);
        const embed = buildValidationEmbed(candidate, validation);

        await interaction.editReply({
          embeds: [embed],
        });

        // Log action
        if (guild) {
          await logActionPretty(guild, {
            actorId: user.id,
            action: "db_recover_validate" as any, // Will be added to ActionType
            meta: {
              candidateId,
              filename: candidate.filename,
              validationOk: validation.ok,
              integrityResult: validation.integrity_result,
              fkViolations: validation.foreign_key_violations,
            },
          });
        }

        logger.info(
          { candidateId, validationOk: validation.ok },
          "[dbRecovery] Validation complete"
        );
        break;
      }

      case "restore-dry": {
        logger.info({ candidateId, userId: user.id }, "[dbRecovery] Starting dry-run restore");

        await interaction.editReply({
          content: `🧪 Running dry-run restore for \`${candidate.filename}\`...\n\nThis will test the restore flow without replacing the live database.`,
        });

        const result = await restoreCandidate(candidateId, {
          dryRun: true,
          pm2Coord: false,
          actorId: user.id,
          notes: `Dry-run restore by ${user.tag} (${user.id})`,
        });

        const embed = buildRestoreSummaryEmbed(candidate, result, user.id);

        await interaction.editReply({
          content: null,
          embeds: [embed],
        });

        // Log action
        if (guild) {
          await logActionPretty(guild, {
            actorId: user.id,
            action: "db_recover_restore" as any,
            meta: {
              candidateId,
              filename: candidate.filename,
              dryRun: true,
              success: result.success,
              preRestoreBackup: result.preRestoreBackupPath,
            },
          });
        }

        logger.info(
          { candidateId, success: result.success },
          "[dbRecovery] Dry-run restore complete"
        );
        break;
      }

      case "restore-confirm": {
        // CRITICAL PATH: This is the only code path that actually replaces the live DB.
        // We log at warn level because this is a high-risk operation that warrants attention
        // in log aggregation dashboards even during normal operation.
        logger.warn(
          { candidateId, userId: user.id, guildId: guild?.id },
          "[dbRecovery] LIVE RESTORE INITIATED"
        );

        await interaction.editReply({
          content: `⚠️ **LIVE RESTORE IN PROGRESS** ⚠️\n\nRestoring database from \`${candidate.filename}\`...\n\n**DO NOT INTERRUPT THIS PROCESS**\n\nThe bot may become unavailable during this operation.`,
        });

        // pm2Coord: true ensures the bot gracefully stops, performs the restore, then restarts.
        // Without this, SQLite connections could hold locks and corrupt the restore.
        const result = await restoreCandidate(candidateId, {
          dryRun: false,
          pm2Coord: true,
          confirm: true,
          actorId: user.id,
          notes: `Live restore by ${user.tag} (${user.id}) at ${new Date().toISOString()}`,
        });

        const embed = buildRestoreSummaryEmbed(candidate, result, user.id);

        await interaction.editReply({
          content: result.success
            ? `✅ **RESTORE COMPLETE**\n\nDatabase has been restored from \`${candidate.filename}\`.\n\n⚠️ **IMPORTANT**: Verify bot functionality immediately.\n\nIf issues occur, restore from pre-restore backup: \`${result.preRestoreBackupPath ? result.preRestoreBackupPath.split(/[\\/]/).pop() : "unknown"}\``
            : `❌ **RESTORE FAILED**\n\nReview the error messages below and check logs.\n\nThe database may have been restored from the pre-restore backup automatically.`,
          embeds: [embed],
        });

        // Log action to audit trail. The "if (guild)" check is unfortunate - means
        // DM-initiated restores (if ever supported) won't have audit logs. Consider
        // storing guild ID in the button's customId for future-proofing.
        if (guild) {
          await logActionPretty(guild, {
            actorId: user.id,
            action: "db_recover_restore" as any,
            meta: {
              candidateId,
              filename: candidate.filename,
              dryRun: false,
              confirm: true,
              success: result.success,
              preRestoreBackup: result.preRestoreBackupPath,
              verificationOk: result.verificationResult?.ok,
            },
          });
        }

        logger.warn(
          {
            candidateId,
            success: result.success,
            userId: user.id,
            preRestoreBackup: result.preRestoreBackupPath,
          },
          "[dbRecovery] LIVE RESTORE COMPLETE"
        );

        break;
      }

      default: {
        logger.warn({ action, customId }, "[dbRecovery] Unknown button action");
        await interaction.editReply({
          content: `❌ Unknown action: \`${action}\``,
        });
      }
    }
  } catch (err) {
    logger.error(
      { err, action, candidateId, userId: user.id },
      "[dbRecovery] Button handler error"
    );

    await interaction.editReply({
      content: `❌ Error during \`${action}\`: ${err}\n\nCheck logs for details.`,
    });
  }
}
