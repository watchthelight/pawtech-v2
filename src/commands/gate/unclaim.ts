/**
 * Pawtropolis Tech -- src/commands/gate/unclaim.ts
 * WHAT: /unclaim command for releasing application claims.
 * WHY: Allows moderators to release claims on applications.
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
  getClaim,
  clearClaim,
  CLAIMED_MESSAGE,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  logger,
  type ApplicationRow,
} from "./shared.js";

export const unclaimData = new SlashCommandBuilder()
  .setName("unclaim")
  .setDescription("Release a claim on an application")
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addUserOption((option) =>
    option.setName("user").setDescription("User whose app to unclaim (@mention or select)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID (if user not in server)").setRequired(false)
  )
  .setDMPermission(false);

export async function executeUnclaim(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeUnclaim
   * WHAT: Releases a claim on an application, if the caller is the claimer.
   * WHY: Prevents stalemates; enforced via claimGuard.
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
    app = findPendingAppByUserId(interaction.guildId, userOption.id);
    if (!app) {
      await replyOrEdit(interaction, {
        content: `No pending application found for ${userOption}.`,
      });
      return;
    }
  } else if (uidRaw) {
    const uid = uidRaw.trim();
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

  if (!app) {
    await replyOrEdit(interaction, { content: "Could not find application." });
    return;
  }

  ctx.step("claim_fetch");
  const claim = getClaim(app.id);
  if (!claim) {
    await replyOrEdit(interaction, { content: "This application is not currently claimed." });
    return;
  }

  // claim ≠ forever. use /unclaim like an adult
  if (claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, { content: CLAIMED_MESSAGE(claim.reviewer_id) });
    return;
  }

  ctx.step("clear_claim");
  clearClaim(app.id);

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after /unclaim");
  }

  ctx.step("reply");
  await replyOrEdit(interaction, { content: "Claim removed." });
}
