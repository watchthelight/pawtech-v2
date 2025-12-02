/**
 * Pawtropolis Tech -- src/commands/gate/reject.ts
 * WHAT: /reject command for rejecting applications.
 * WHY: Staff rejects applications by short code, user mention, or user ID with a reason.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  requireStaff,
  findAppByShortCode,
  findPendingAppByUserId,
  ensureReviewMessage,
  updateReviewActionMeta,
  getClaim,
  claimGuard,
  rejectTx,
  rejectFlow,
  closeModmailForApplication,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  shortCode,
  logger,
  type ApplicationRow,
} from "./shared.js";

export const rejectData = new SlashCommandBuilder()
  .setName("reject")
  .setDescription("Reject an application by short code, user mention, or user ID")
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for rejection (max 500 chars)")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addUserOption((option) =>
    option.setName("user").setDescription("User to reject (@mention or select)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID (if user not in server)").setRequired(false)
  )
  .addBooleanOption((option) =>
    option.setName("perm").setDescription("Permanently reject (can't re-apply)").setRequired(false)
  )
  .setDMPermission(false);

export async function executeReject(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeReject
   * WHAT: Staff rejects an application by HEX6 short code or Discord UID with a reason.
   * WHY: Supports both workflow types; optional permanent rejection.
   * PITFALLS: DMs can fail; we annotate the review action meta accordingly.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireStaff(interaction)) return;

  ctx.step("defer");
  await ensureDeferred(interaction);

  const codeRaw = interaction.options.getString("app", false);
  const userOption = interaction.options.getUser("user", false);
  const uidRaw = interaction.options.getString("uid", false);
  const reasonRaw = interaction.options.getString("reason", true);
  const permanent = interaction.options.getBoolean("perm", false) ?? false;

  // Count how many identifier options were provided
  const providedCount = [codeRaw, userOption, uidRaw].filter(Boolean).length;
  if (providedCount === 0) {
    await replyOrEdit(interaction, {
      content: "Please provide one of: `app` (short code), `user` (@mention), or `uid` (user ID).",
    });
    return;
  }
  if (providedCount > 1) {
    await replyOrEdit(interaction, {
      content: "Please provide only one option: `app`, `user`, or `uid`.",
    });
    return;
  }

  const reason = reasonRaw.trim().slice(0, 500);
  if (reason.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." });
    return;
  }

  ctx.step("lookup_app");
  let app: ApplicationRow | null = null;
  if (codeRaw) {
    const code = codeRaw.trim().toUpperCase();
    app = findAppByShortCode(interaction.guildId, code);
    if (!app) {
      await replyOrEdit(interaction, { content: `No application with code ${code}.` });
      return;
    }
  } else if (userOption) {
    // User mention/picker - get their ID
    app = findPendingAppByUserId(interaction.guildId, userOption.id);
    if (!app) {
      await replyOrEdit(interaction, {
        content: `No pending application found for ${userOption}.`,
      });
      return;
    }
  } else if (uidRaw) {
    const uid = uidRaw.trim();
    // Validate UID format
    if (!/^[0-9]{5,20}$/.test(uid)) {
      await replyOrEdit(interaction, { content: "Invalid user ID. Must be 5-20 digits." });
      return;
    }
    app = findPendingAppByUserId(interaction.guildId, uid);
    if (!app) {
      await replyOrEdit(interaction, {
        content: `No pending application found for user ID ${uid}.`,
      });
      return;
    }
  }

  // At this point app is guaranteed to be non-null due to early return above
  const resolvedApp = app!;

  ctx.step("claim_check");
  const claim = getClaim(resolvedApp.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError });
    return;
  }

  ctx.step("reject_tx");
  const tx = rejectTx(resolvedApp.id, interaction.user.id, reason, permanent);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." });
    return;
  }

  ctx.step("reject_flow");
  const user = await interaction.client.users.fetch(resolvedApp.user_id).catch(() => null);
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, {
      guildName: interaction.guild.name,
      reason,
      permanent,
    });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, {
      ...dmResult,
      source: "slash",
      via: uidRaw ? "uid" : "code",
    });
  } else {
    logger.warn({ userId: resolvedApp.user_id }, "Failed to fetch user for rejection DM");
    updateReviewActionMeta(tx.reviewActionId, {
      dmDelivered,
      source: "slash",
      via: uidRaw ? "uid" : "code",
    });
  }

  // Note: Claim preserved for review card display

  ctx.step("close_modmail");
  const code = shortCode(resolvedApp.id);
  try {
    await closeModmailForApplication(interaction.guildId, resolvedApp.user_id, code, {
      reason: permanent ? "permanently rejected" : "rejected",
      client: interaction.client,
      guild: interaction.guild,
    });
  } catch (mmErr) {
    logger.warn({ err: mmErr, appId: resolvedApp.id }, "[reject] Failed to close modmail (non-fatal)");
  }

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, resolvedApp.id);
  } catch (err) {
    logger.warn({ err, appId: resolvedApp.id }, "Failed to refresh review card after /reject");
  }

  ctx.step("reply");
  const rejectType = permanent ? "permanently rejected" : "rejected";
  await replyOrEdit(interaction, {
    content: dmDelivered
      ? `Application ${rejectType}.`
      : `Application ${rejectType}. (DM delivery failed)`,
  });
}
