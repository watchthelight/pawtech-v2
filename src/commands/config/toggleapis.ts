/**
 * Pawtropolis Tech — src/commands/config/toggleapis.ts
 * WHAT: Toggle AI detection APIs on/off per guild.
 * WHY: Allows admins to disable APIs that aren't working or aren't paid for.
 * FLOWS:
 *  - /config toggleapis → Shows status embed with toggle buttons
 *  - Button click → Toggles the API on/off, updates embed
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  MessageFlags,
} from "discord.js";
import { type CommandContext } from "../../lib/cmdWrap.js";
import { requireAdminOrLeadership } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import {
  getServiceToggles,
  toggleService,
  ALL_SERVICES,
} from "../../store/aiDetectionToggles.js";
import { env } from "../../lib/env.js";
import type { AIDetectionService } from "../../features/aiDetection/types.js";

// Button prefix for interaction routing
const BUTTON_PREFIX = "toggleapi_";

// Service display info
const SERVICE_INFO: Record<AIDetectionService, { name: string; envVar: string }> = {
  hive: { name: "Hive Moderation", envVar: "HIVE_API_KEY" },
  rapidai: { name: "RapidAPI AI Art", envVar: "RAPIDAPI_KEY" },
  sightengine: { name: "SightEngine", envVar: "SIGHTENGINE_API_USER" },
  optic: { name: "Optic AI Or Not", envVar: "OPTIC_API_KEY" },
};

/**
 * Check if a service has its API key configured.
 */
function isServiceConfigured(service: AIDetectionService): boolean {
  switch (service) {
    case "hive":
      return !!env.HIVE_API_KEY;
    case "rapidai":
      return !!env.RAPIDAPI_KEY;
    case "sightengine":
      return !!(env.SIGHTENGINE_API_USER && env.SIGHTENGINE_API_SECRET);
    case "optic":
      return !!env.OPTIC_API_KEY;
    default:
      return false;
  }
}

/**
 * Build the status embed showing all APIs and their toggle state.
 */
function buildStatusEmbed(guildId: string): EmbedBuilder {
  const toggles = getServiceToggles(guildId);

  const enabledCount = ALL_SERVICES.filter((svc) => toggles[svc]).length;
  const configuredCount = ALL_SERVICES.filter((svc) => isServiceConfigured(svc)).length;

  const embed = new EmbedBuilder()
    .setTitle("AI Detection API Toggles")
    .setDescription(
      `Toggle which AI detection APIs are active for this server.\n\n` +
      `**Status:** ${enabledCount}/${ALL_SERVICES.length} enabled, ${configuredCount}/${ALL_SERVICES.length} configured\n\n` +
      `Disabled APIs won't appear in \`/isitreal\` results or \`/config isitreal\`.`
    )
    .setColor(enabledCount === 0 ? 0xef4444 : enabledCount === ALL_SERVICES.length ? 0x22c55e : 0xf59e0b)
    .setTimestamp();

  for (const service of ALL_SERVICES) {
    const info = SERVICE_INFO[service];
    const enabled = toggles[service];
    const configured = isServiceConfigured(service);

    let status: string;
    if (!configured) {
      status = enabled ? "No API key" : "Disabled (no key)";
    } else {
      status = enabled ? "Enabled" : "Disabled";
    }

    const statusIcon = enabled ? (configured ? "\u2705" : "\u26a0\ufe0f") : "\u274c";

    embed.addFields({
      name: `${statusIcon} ${info.name}`,
      value: `Status: ${status}\nEnv: \`${info.envVar}\``,
      inline: true,
    });
  }

  return embed;
}

/**
 * Build toggle buttons for each API.
 */
function buildToggleButtons(guildId: string): ActionRowBuilder<ButtonBuilder>[] {
  const toggles = getServiceToggles(guildId);

  const buttons = ALL_SERVICES.map((service) => {
    const info = SERVICE_INFO[service];
    const enabled = toggles[service];

    return new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${service}`)
      .setLabel(enabled ? `Disable ${info.name}` : `Enable ${info.name}`)
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success);
  });

  // Split into rows (max 5 buttons per row)
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 4) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 4)));
  }

  return rows;
}

// ============================================================================
// Command Handler
// ============================================================================

export async function executeToggleApis(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const guildId = interaction.guildId!;

  // Admin/leadership only
  const authorized = await requireAdminOrLeadership(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "Only server admins or leadership can toggle AI detection APIs.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildStatusEmbed(guildId);
  const rows = buildToggleButtons(guildId);

  await interaction.reply({
    embeds: [embed],
    components: rows,
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================================
// Button Handler
// ============================================================================

export async function handleToggleApiButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Extract service from button ID
  const service = interaction.customId.replace(BUTTON_PREFIX, "") as AIDetectionService;

  if (!ALL_SERVICES.includes(service)) {
    await interaction.reply({
      content: "Unknown service.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Toggle the service
  const newState = toggleService(guildId, service);
  const info = SERVICE_INFO[service];

  logger.info(
    { guildId, service, enabled: newState, userId: interaction.user.id },
    "[toggleapis] API toggle changed"
  );

  // Update the embed and buttons
  const embed = buildStatusEmbed(guildId);
  const rows = buildToggleButtons(guildId);

  await interaction.update({
    embeds: [embed],
    components: rows,
  });
}

// ============================================================================
// Interaction Router
// ============================================================================

export function isToggleApiInteraction(customId: string): boolean {
  return customId.startsWith(BUTTON_PREFIX);
}
