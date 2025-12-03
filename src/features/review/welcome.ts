/**
 * Pawtropolis Tech -- src/features/review/welcome.ts
 * WHAT: Welcome message rendering and posting for approved applicants.
 * WHY: Centralizes all welcome message logic for consistent new member greetings.
 * FLOWS:
 *  - renderWelcomeTemplate(): replaces tokens in custom templates
 *  - postWelcomeMessage(): sends welcome to general channel
 *  - buildWelcomeNotice(): returns user-friendly error messages
 *  - logWelcomeFailure(): logs failure details
 * DOCS:
 *  - EmbedBuilder: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *  - Permissions: https://discord.com/developers/docs/topics/permissions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";

import type {
  WelcomeFailureReason,
  WelcomeResult,
  RenderWelcomeTemplateOptions,
} from "./types.js";

// ===== Constants =====

export const DEFAULT_WELCOME_TEMPLATE = "Welcome {applicant.mention} to {guild.name}! wave";

// These Sets act as in-memory deduplication to avoid log spam. The tradeoff is they
// grow unbounded for the lifetime of the process. In practice, the number of guilds
// is small enough that this is fine. If you're running this on 10,000 servers, reconsider.
const invalidWelcomeTemplateWarned = new Set<string>();
const emojiCacheFetched = new Set<string>();

// Token regex for welcome message templates. Supported tokens:
// {applicant.mention} - Discord mention, {applicant.tag} - username#0000, {applicant.display} - nickname
// {guild.name} - server name. Unknown tokens are left as-is (not replaced with empty string).
const WELCOME_TEMPLATE_TOKEN_RE = /\{(applicant\.(?:mention|tag|display)|guild\.name)\}/g;

// ===== Helper Functions =====

// Discord error code 50013 is "Missing Permissions". We check this specifically because
// permission errors are recoverable (tell the admin to fix perms) vs. other errors
// which might be transient network issues or something more sinister.
function isMissingPermissionError(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 50013;
}

function warnInvalidTemplateOnce(guildId: string, detail: string) {
  if (invalidWelcomeTemplateWarned.has(guildId)) return;
  invalidWelcomeTemplateWarned.add(guildId);
  logger.warn({ guildId, detail }, "[welcome] invalid custom template; using default embed");
}

/*
 * Tries to find a custom guild emoji by name, falling back to a standard emoji.
 * WHY: Custom emojis look better and give servers personality. But we can't assume
 * they exist, so we need graceful degradation to Unicode emoji.
 * GOTCHA: The emoji cache is fetched once per guild per process lifetime. If someone
 * adds an emoji after the bot starts, it won't be found until restart.
 */
async function resolveGuildEmoji(
  guild: Guild,
  candidateNames: string[],
  fallback: string
): Promise<string> {
  const lowerCandidates = candidateNames.map((name) => name.toLowerCase());
  try {
    if (!emojiCacheFetched.has(guild.id)) {
      await guild.emojis.fetch();
      emojiCacheFetched.add(guild.id);
    }
  } catch (err) {
    // Mark as fetched anyway to avoid retrying on every welcome message.
    // Better to use the fallback than hammer the API.
    emojiCacheFetched.add(guild.id);
    logger.debug({ err, guildId: guild.id }, "[welcome] emoji fetch failed; using fallback");
  }

  // The type assertion here is ugly, but discord.js's Collection typing is a pain.
  // We know .find exists, but TypeScript doesn't always agree depending on version.
  const cache = guild.emojis.cache as { find?: (fn: (emoji: any) => boolean) => any };
  if (cache?.find) {
    const match = cache.find((emoji) => {
      const name = (emoji?.name ?? "").toLowerCase();
      return lowerCandidates.includes(name);
    });
    if (match && match.id && match.name) {
      // Animated emojis need the 'a' prefix or they render as static images.
      const prefix = match.animated ? "a" : "";
      return `<${prefix}:${match.name}:${match.id}>`;
    }
  }

  return fallback;
}

type DefaultWelcomeOptions = {
  guild: Guild;
  member: GuildMember;
  socialChannelId?: string | null;
  helpChannelId?: string | null;
};

async function buildDefaultWelcomeMessage(
  options: DefaultWelcomeOptions
): Promise<{ content: string; embeds: EmbedBuilder[] }> {
  const { guild, member, socialChannelId, helpChannelId } = options;
  const content = `<@${member.id}>`;

  const waveEmoji = await resolveGuildEmoji(guild, ["nitro_hand", "nitro-hand", "pawwave"], "👋");
  const checkEmoji = await resolveGuildEmoji(
    guild,
    ["blue_check_mark", "bluecheck", "pawcheck"],
    "✅"
  );
  const includeSocialLine = Boolean(socialChannelId && helpChannelId);
  const linkEmoji = includeSocialLine
    ? await resolveGuildEmoji(guild, ["sociallink", "social_link", "pawlink"], "link")
    : null;

  // 0x22ccaa is a teal/aqua. Different from the 0x00c2ff in the other welcome file.
  // I'm not sure if that's intentional branding or copy-paste drift. Worth checking.
  const embed = new EmbedBuilder()
    .setColor(0x22ccaa)
    .setTitle("Welcome to Pawtropolis 🐾")
    .setFooter({ text: "Bot by watchthelight." });

  const botAvatar = guild.client?.user?.displayAvatarURL({ size: 128, forceStatic: false });
  if (botAvatar) {
    embed.setAuthor({ name: "Paw Guardian (Pawtropolis)", iconURL: botAvatar });
  } else {
    embed.setAuthor({ name: "Paw Guardian (Pawtropolis)" });
  }

  const thumbnail = member.displayAvatarURL({ size: 128, forceStatic: false });
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  const applicantTag = member.user?.tag ?? member.user?.username ?? member.id;
  const descriptionLines = [
    `${waveEmoji} Welcome to Pawtropolis, ${applicantTag}!`,
    `This server now has **${guild.memberCount} Users**!`,
  ];

  if (includeSocialLine && socialChannelId && helpChannelId) {
    const emoji = linkEmoji ?? "link";
    descriptionLines.push(
      `${emoji} Be sure to check out our <#${socialChannelId}> or reach out in <#${helpChannelId}>.`
    );
  }

  descriptionLines.push(`${checkEmoji} Enjoy your stay!`, "Pawtropolis Moderation Team");
  embed.setDescription(descriptionLines.join("\n"));

  return { content, embeds: [embed] };
}

/*
 * Creates a minimal JSON representation of embeds for debug logging.
 * WHY not just log the full embed? Because embed.toJSON() includes a ton of null/undefined
 * fields that clutter the logs. This only captures what's actually set.
 */
function snapshotEmbeds(embeds: EmbedBuilder[]): Array<Record<string, unknown>> {
  return embeds.map((embed) => {
    const json = embed.toJSON();
    const snapshot: Record<string, unknown> = {};
    if (json.title) snapshot.title = json.title;
    if (json.description) snapshot.description = json.description;
    if (json.color !== undefined) snapshot.color = json.color;
    if (json.author?.name) {
      snapshot.author = { name: json.author.name, icon_url: json.author.icon_url };
    }
    if (json.thumbnail?.url) {
      snapshot.thumbnail = { url: json.thumbnail.url };
    }
    if (json.footer?.text) {
      snapshot.footer = { text: json.footer.text };
    }
    if (Array.isArray(json.fields) && json.fields.length > 0) {
      snapshot.fields = json.fields.map((field) => ({
        name: field.name,
        value: field.value,
        inline: field.inline ?? false,
      }));
    }
    return snapshot;
  });
}

// ===== Main Exports =====

/**
 * renderWelcomeTemplate
 * WHAT: Renders a welcome message template with token substitution.
 * WHY: Allows server admins to customize welcome messages with dynamic values.
 * TOKENS:
 *  - {applicant.mention} - Discord mention
 *  - {applicant.tag} - username#0000
 *  - {applicant.display} - nickname
 *  - {guild.name} - server name
 * Unknown tokens are left as-is (not replaced with empty string).
 */
export function renderWelcomeTemplate(options: RenderWelcomeTemplateOptions): string {
  // Fall back to default if template is missing or whitespace-only.
  // We've had servers set their template to just spaces. People are creative.
  const base =
    typeof options.template === "string" && options.template.trim().length > 0
      ? options.template
      : DEFAULT_WELCOME_TEMPLATE;

  // Cascade of fallbacks: display name -> tag -> raw snowflake ID
  // The ID fallback is mostly theoretical but better safe than "[object Object]"
  const applicantTag =
    options.applicant.tag && options.applicant.tag.trim().length > 0
      ? options.applicant.tag
      : options.applicant.id;
  const applicantDisplay =
    options.applicant.display && options.applicant.display.trim().length > 0
      ? options.applicant.display
      : applicantTag;

  return base.replace(WELCOME_TEMPLATE_TOKEN_RE, (token) => {
    switch (token) {
      case "{applicant.mention}":
        return `<@${options.applicant.id}>`;
      case "{applicant.tag}":
        return applicantTag;
      case "{applicant.display}":
        return applicantDisplay;
      case "{guild.name}":
        return options.guildName;
      default:
        return token;
    }
  });
}

/**
 * postWelcomeMessage
 * WHAT: Posts a welcome message to the configured general channel.
 * WHY: Announces approved applicants to the community.
 * RETURNS: WelcomeResult indicating success or failure reason.
 */
export async function postWelcomeMessage(options: {
  guild: Guild;
  generalChannelId: string | null;
  member: GuildMember;
  template: string | null | undefined;
}): Promise<WelcomeResult> {
  const { guild, generalChannelId, member, template } = options;
  if (!generalChannelId) {
    return { ok: false, reason: "missing_channel" };
  }

  let channel: GuildTextBasedChannel;
  try {
    const fetched = await guild.channels.fetch(generalChannelId);
    if (!fetched || !fetched.isTextBased()) {
      return { ok: false, reason: "invalid_channel" };
    }
    channel = fetched as GuildTextBasedChannel;
  } catch (err) {
    return { ok: false, reason: "fetch_failed", error: err };
  }

  const me = guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    const canView = perms?.has(PermissionFlagsBits.ViewChannel) ?? false;
    const canSend = perms?.has(PermissionFlagsBits.SendMessages) ?? false;
    if (!canView || !canSend) {
      return { ok: false, reason: "missing_permissions" };
    }
  }

  // This block is doing a lot of defensive validation because templates come from
  // user input (config). We've seen everything: undefined, null, empty strings,
  // and once, somehow, a number. Trust nothing.
  const templateIsString = typeof template === "string";
  const trimmedTemplate = templateIsString ? template.trim() : "";
  const hasCustomTemplate = templateIsString && trimmedTemplate.length > 0;

  if (templateIsString && trimmedTemplate.length === 0) {
    warnInvalidTemplateOnce(guild.id, "empty_template");
  } else if (!templateIsString && template !== null && template !== undefined) {
    warnInvalidTemplateOnce(guild.id, "non_string_template");
  }

  let content = "";
  let embeds: EmbedBuilder[] = [];

  if (hasCustomTemplate) {
    const avatarUrl = member.displayAvatarURL({ size: 128, forceStatic: false }) ?? null;
    if (avatarUrl) {
      embeds.push(new EmbedBuilder().setTitle("Welcome!").setThumbnail(avatarUrl));
    }
    content = renderWelcomeTemplate({
      template,
      guildName: guild.name,
      applicant: {
        id: member.id,
        tag: member.user?.tag ?? member.user.username,
        display: member.displayName,
      },
    });
  } else {
    const payload = await buildDefaultWelcomeMessage({
      guild,
      member,
    });
    content = payload.content;
    embeds = payload.embeds;
  }

  const snapshots = snapshotEmbeds(embeds);

  const basePayload = {
    content,
    allowedMentions: { users: [member.id] },
  };

  const payloadWithEmbeds = embeds.length > 0 ? { ...basePayload, embeds } : basePayload;

  try {
    const message = await channel.send(payloadWithEmbeds);
    const meta = {
      guildId: guild.id,
      channelId: generalChannelId,
      userId: member.id,
      messageId: message.id,
    };
    logger.info(meta, "[welcome] posted");
    logger.debug({ ...meta, embeds: snapshots }, "[welcome] embed snapshot");
    return { ok: true, messageId: message.id };
  } catch (err) {
    // Fallback strategy: if embed fails, try again without it. This handles cases
    // where the bot has SendMessages but not EmbedLinks. A plain text welcome is
    // better than no welcome at all.
    if (embeds.length > 0) {
      try {
        const message = await channel.send(basePayload);
        const meta = {
          guildId: guild.id,
          channelId: generalChannelId,
          userId: member.id,
          messageId: message.id,
        };
        logger.info({ ...meta, mode: "fallback_no_embed" }, "[welcome] posted");
        logger.debug({ ...meta, embeds: [] }, "[welcome] embed snapshot");
        return { ok: true, messageId: message.id };
      } catch (fallbackErr) {
        const fallbackReason = isMissingPermissionError(fallbackErr)
          ? "missing_permissions"
          : "send_failed";
        return { ok: false, reason: fallbackReason, error: fallbackErr };
      }
    }
    const reason: WelcomeFailureReason = isMissingPermissionError(err)
      ? "missing_permissions"
      : "send_failed";
    return { ok: false, reason, error: err };
  }
}

/**
 * buildWelcomeNotice
 * WHAT: Returns a user-friendly error message for welcome failures.
 * WHY: Provides actionable feedback when welcome messages fail.
 */
export function buildWelcomeNotice(reason: WelcomeFailureReason): string {
  switch (reason) {
    case "missing_channel":
      return "Welcome message not posted: general channel not configured.";
    case "invalid_channel":
      return "Welcome message not posted: configured general channel is unavailable.";
    case "missing_permissions":
      return "Welcome message not posted: missing permissions in the configured channel.";
    case "fetch_failed":
      return "Welcome message not posted: failed to resolve the configured general channel.";
    case "send_failed":
    default:
      return "Welcome message not posted: failed to send to the configured general channel.";
  }
}

/**
 * logWelcomeFailure
 * WHAT: Logs welcome message failures with context.
 * WHY: Provides debugging information for welcome issues.
 */
export function logWelcomeFailure(
  reason: WelcomeFailureReason,
  context: { guildId: string; channelId: string | null; error?: unknown }
) {
  const code = (context.error as { code?: unknown })?.code;
  const errInfo =
    context.error instanceof Error
      ? { name: context.error.name, message: context.error.message }
      : undefined;

  const payload: Record<string, unknown> = {
    guildId: context.guildId,
    channelId: context.channelId ?? undefined,
  };
  if (code !== undefined) payload.code = code;
  if (errInfo?.message) payload.message = errInfo.message;
  if (errInfo?.name) payload.errorName = errInfo.name;

  switch (reason) {
    case "missing_channel":
      logger.warn(payload, "[welcome] general channel missing");
      break;
    case "invalid_channel":
      logger.warn(payload, "[welcome] configured general channel unavailable");
      break;
    case "missing_permissions":
      logger.warn(payload, "[welcome] missing permission to send welcome message");
      break;
    case "fetch_failed":
      logger.warn(payload, "[welcome] failed to fetch general channel");
      break;
    case "send_failed":
    default:
      logger.warn(payload, "[welcome] failed to post welcome message");
      break;
  }
}
