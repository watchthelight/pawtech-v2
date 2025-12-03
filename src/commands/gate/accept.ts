/**
 * Pawtropolis Tech -- src/commands/gate/accept.ts
 * WHAT: /accept command for approving applications.
 * WHY: Staff approves applications by short code, user mention, or user ID.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { GuildMember } from "discord.js";
import {
  requireStaff,
  getConfig,
  findAppByShortCode,
  findPendingAppByUserId,
  ensureReviewMessage,
  approveTx,
  approveFlow,
  deliverApprovalDm,
  updateReviewActionMeta,
  getClaim,
  claimGuard,
  postWelcomeCard,
  closeModmailForApplication,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  shortCode,
  logger,
  type ApplicationRow,
} from "./shared.js";

/*
 * Three ways to identify an application: short code, user mention, or raw user ID.
 * None are required, but exactly one must be provided. We validate this in execute().
 * The "uid" option exists for ghost members who left before you could process them.
 */
export const acceptData = new SlashCommandBuilder()
  .setName("accept")
  .setDescription("Approve an application by short code, user mention, or user ID")
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addUserOption((option) =>
    option.setName("user").setDescription("User to accept (@mention or select)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID (if user not in server)").setRequired(false)
  )
  .setDMPermission(false);

export async function executeAccept(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeAccept
   * WHAT: Staff approves an application by HEX6 short code or Discord UID.
   * WHY: Faster than navigating the review card in some cases.
   * RETURNS: Ephemeral confirmation and optional welcome posting result.
   * LINKS: Modal/Buttons are handled in features/review.ts; this is slash-only.
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

  // GOTCHA: Discord doesn't support mutually exclusive options natively.
  // We get to enforce "exactly one" ourselves. Welcome to slash command hell.
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
    // Validate UID format. Snowflakes are actually 17-20 digits these days, but we're
    // generous with the lower bound because who knows what cursed old accounts lurk.
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

  // At this point app is guaranteed to be non-null due to early return above.
  // The non-null assertion is ugly but TypeScript can't follow the control flow
  // through three separate if/else branches with early returns. I've tried.
  const resolvedApp = app!;

  ctx.step("claim_check");
  // WHY: Claims prevent two mods from approving/rejecting simultaneously.
  // Without this, you get fun race conditions where someone gets approved
  // then rejected, or vice versa. Deny politely; chaos later is worse.
  const claim = getClaim(resolvedApp.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError });
    return;
  }

  ctx.step("approve_tx");
  // This is a database transaction. If it succeeds, the app is marked approved
  // regardless of what happens next. We can fail to assign roles, fail to DM,
  // fail to post welcome - the approval still stands. Design choice, not a bug.
  const result = approveTx(resolvedApp.id, interaction.user.id);
  if (result.kind === "already") {
    await replyOrEdit(interaction, { content: "Already approved." });
    return;
  }
  if (result.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${result.status}).` });
    return;
  }
  if (result.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application is not ready for approval." });
    return;
  }

  ctx.step("approve_flow");
  const cfg = getConfig(interaction.guildId);
  let approvedMember: GuildMember | null = null;
  let roleApplied = false;
  let roleError: { code?: number; message?: string } | null = null;
  if (cfg) {
    /*
     * approveFlow handles the Discord side: fetching the member and applying
     * the accepted_role. It returns roleError if the bot lacks permissions
     * (error code 50013) or the role is higher in hierarchy than the bot's role.
     *
     * We proceed even if role assignment fails - the app is marked approved in
     * the database, and we report the failure to the reviewer so they can fix
     * permissions or assign the role manually.
     */
    const flow = await approveFlow(interaction.guild, resolvedApp.user_id, cfg);
    approvedMember = flow.member;
    roleApplied = flow.roleApplied;
    roleError = flow.roleError ?? null;
  }
  // Note: Claim preserved for review card display

  ctx.step("close_modmail");
  const code = shortCode(resolvedApp.id);
  // If there's an open modmail thread, close it. Not fatal if this fails -
  // worst case the mod has to close it manually. Swallow the error and move on.
  try {
    await closeModmailForApplication(interaction.guildId, resolvedApp.user_id, code, {
      reason: "approved",
      client: interaction.client,
      guild: interaction.guild,
    });
  } catch (mmErr) {
    logger.warn({ err: mmErr, appId: resolvedApp.id }, "[accept] Failed to close modmail (non-fatal)");
  }

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, resolvedApp.id);
  } catch (err) {
    logger.warn({ err, appId: resolvedApp.id }, "Failed to refresh review card after /accept");
  }

  ctx.step("dm_and_welcome");
  let dmDelivered = false;
  if (approvedMember) {
    dmDelivered = await deliverApprovalDm(approvedMember, interaction.guild.name);
  }

  let welcomeNote: string | null = null;
  let roleNote: string | null = null;
  // This condition is gnarly: post welcome only if we have config, have a member,
  // AND (either no role is configured, OR the role was successfully applied).
  // We skip welcome if role assignment failed because showing up in general
  // without the verified role looks weird and confuses everyone.
  if (cfg && approvedMember && (cfg.accepted_role_id ? roleApplied : true)) {
    try {
      await postWelcomeCard({
        guild: interaction.guild,
        user: approvedMember,
        config: cfg,
        memberCount: interaction.guild.memberCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      logger.warn(
        { err, guildId: interaction.guildId, userId: approvedMember.id },
        "[accept] failed to post welcome card"
      );
      if (errorMessage.includes("not configured")) {
        welcomeNote = "Welcome message failed: general channel not configured.";
      } else if (errorMessage.includes("missing permissions")) {
        const channelMention = cfg.general_channel_id
          ? `<#${cfg.general_channel_id}>`
          : "the channel";
        welcomeNote = `Welcome message failed: missing permissions in ${channelMention}.`;
      } else {
        welcomeNote = `Welcome message failed: ${errorMessage}`;
      }
    }
  } else if (!cfg?.general_channel_id) {
    welcomeNote = "Welcome message not posted: general channel not configured.";
  }

  // Store metadata about how this approval happened for analytics later.
  // The "via" field helps track whether mods prefer short codes or user IDs.
  updateReviewActionMeta(result.reviewActionId, {
    roleApplied,
    dmDelivered,
    source: "slash",
    via: uidRaw ? "uid" : "code",
  });

  ctx.step("reply");
  // Build the response message. We always say "approved" even if subsequent
  // steps failed, because the database approval is what matters. Everything
  // else is just nice-to-have that we surface as warnings.
  const messages = ["Application approved."];
  if (cfg?.accepted_role_id && roleError) {
    const roleMention = `<@&${cfg.accepted_role_id}>`;
    // 50013 is Discord's "Missing Permissions" error code. We get this when
    // the bot role is lower than the target role in the hierarchy.
    if (roleError.code === 50013) {
      roleNote = `Failed to grant verification role ${roleMention} (missing permissions).`;
    } else {
      const reason = roleError.message ?? "unknown error";
      roleNote = `Failed to grant verification role ${roleMention}: ${reason}.`;
    }
  }
  if (roleNote) messages.push(roleNote);
  if (welcomeNote) messages.push(welcomeNote);
  await replyOrEdit(interaction, { content: messages.join("\n") });
}
