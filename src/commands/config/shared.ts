/**
 * Pawtropolis Tech -- src/commands/config/shared.ts
 * WHAT: Shared imports and utilities for config command modules.
 * WHY: Avoids duplication across config handlers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export discord.js types
export { type ChatInputCommandInteraction, MessageFlags } from "discord.js";

// Re-export lib utilities
export { requireStaff, requireMinRole, ROLE_IDS, upsertConfig, getConfig } from "../../lib/config.js";
export { type CommandContext, replyOrEdit, ensureDeferred } from "../../lib/cmdWrap.js";
export { logger } from "../../lib/logger.js";
export { db } from "../../db/db.js";

// Re-export feature functions
export { retrofitModmailParentsForGuild } from "../../features/modmail.js";

// Re-export config stores
export {
  setLoggingChannelId,
  getLoggingChannelId,
} from "../../config/loggingStore.js";
export {
  setFlagsChannelId,
  setSilentFirstMsgDays,
  getFlaggerConfig,
} from "../../config/flaggerStore.js";
