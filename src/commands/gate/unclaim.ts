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
  requireGatekeeper,
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

/*
 * Three ways to specify the target: short code, @mention, or raw user ID.
 * All optional, but exactly one must be provided. We do the validation
 * ourselves in execute because Discord's slash command system doesn't
 * support "one of these three is required" constraints natively.
 */
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
  if (!requireGatekeeper(
    interaction,
    "unclaim",
    "Releases a claim on an application so others can review it."
  )) return;

  // Defer early. Even though this command is fast, we might hit Discord API
  // latency on the review card refresh, and the 3-second SLA is unforgiving.
  ctx.step("defer");
  await ensureDeferred(interaction);

  const codeRaw = interaction.options.getString("app", false);
  const userOption = interaction.options.getUser("user", false);
  const uidRaw = interaction.options.getString("uid", false);

  // Count how many identifier options were provided
  // GOTCHA: filter(Boolean) counts truthy values, so empty strings would be excluded.
  // Thankfully Discord returns null for unset options, not empty strings.
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
  // Yes, this could be a switch or early-return chain. The if-else ladder
  // is ugly but explicit, and matches the other gate commands. Consistency > elegance.
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
    // Discord snowflakes are 18-19 digits currently, but the spec allows for growth.
    // 5 is a floor to catch obvious typos; 20 gives us headroom until 2090 or so.
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

  // Defensive check. If we get here with null, the if-else above has a hole.
  // TypeScript can't prove exhaustiveness here because of the early returns.
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
  // Only the person who claimed it can release it. No stealing claims,
  // no "helpful" unclaiming of someone else's work. Admins can go touch the DB directly.
  if (claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, { content: CLAIMED_MESSAGE(claim.reviewer_id) });
    return;
  }

  ctx.step("clear_claim");
  clearClaim(app.id);

  ctx.step("refresh_review");
  // Refresh the review card so other mods see it's available again.
  // If Discord's having a bad day, we still report success -- the claim
  // is cleared, and the card will catch up eventually.
  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after /unclaim");
  }

  ctx.step("reply");
  await replyOrEdit(interaction, { content: "Claim removed." });
}
