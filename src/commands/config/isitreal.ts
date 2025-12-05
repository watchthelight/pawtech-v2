/**
 * Pawtropolis Tech — src/commands/config/isitreal.ts
 * WHAT: Interactive configuration wizard for AI detection services.
 * WHY: Simplifies setup of API keys with testing and .env injection.
 * FLOWS:
 *  - /config isitreal → Shows status, setup buttons for each service
 *  - Button click → Modal to enter API key(s)
 *  - Modal submit → Tests key, offers to save if valid
 *  - Save → Appends to .env and updates runtime env
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  MessageFlags,
} from "discord.js";
import { type CommandContext } from "../../lib/cmdWrap.js";
import { isOwner } from "../../lib/owner.js";
import { requireAdminOrLeadership, getConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import {
  getServiceStatus,
  testAllConfigured,
  testHive,
  testRapidAI,
  testSightEngine,
  testOptic,
  type ServiceHealth,
} from "../../features/aiDetection/health.js";
import { getEnabledServices } from "../../store/aiDetectionToggles.js";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Constants
// ============================================================================

const BUTTON_PREFIX = "isitreal_setup_";
const MODAL_PREFIX = "isitreal_modal_";
const SAVE_PREFIX = "isitreal_save_";
const CANCEL_PREFIX = "isitreal_cancel_";

/**
 * Check if user is authorized to configure AI detection (server owner, leadership, or bot owner).
 * Works with any interaction type.
 */
async function isAuthorizedForConfig(
  interaction: ButtonInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Bot owner always authorized
  if (isOwner(userId)) {
    return true;
  }

  if (!guildId || !interaction.guild) {
    return false;
  }

  // Guild owner
  if (interaction.guild.ownerId === userId) {
    return true;
  }

  // Leadership role
  const config = getConfig(guildId);
  if (config?.leadership_role_id && interaction.member) {
    const member = interaction.member;
    if ("roles" in member && "cache" in member.roles) {
      return member.roles.cache.has(config.leadership_role_id);
    }
  }

  return false;
}

const SERVICE_INFO: Record<string, { name: string; description: string; signupUrl: string }> = {
  hive: {
    name: "Hive Moderation",
    description: "AI-generated media detection with high accuracy",
    signupUrl: "https://thehive.ai/",
  },
  rapidai: {
    name: "RapidAPI AI Art Detection",
    description: "AI image detection via RapidAPI marketplace",
    signupUrl: "https://rapidapi.com/hammas.majeed/api/ai-generated-image-detection-api",
  },
  sightengine: {
    name: "SightEngine",
    description: "Image moderation with GenAI detection",
    signupUrl: "https://sightengine.com/",
  },
  optic: {
    name: "Optic AI Or Not",
    description: "Simple AI vs human image classification",
    signupUrl: "https://aiornot.com/",
  },
};

// ============================================================================
// Main Command Handler
// ============================================================================

export async function executeIsitreal(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Server owner or leadership only
  const authorized = await requireAdminOrLeadership(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "Only the server owner or community managers can configure AI detection services.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Get enabled services for this guild
  const guildId = interaction.guildId!;
  const enabledServiceIds = getEnabledServices(guildId);

  // Get and test all services, then filter to only enabled ones
  ctx.step("testing_services");
  const allServices = await testAllConfigured();
  const services = allServices.filter((s) => enabledServiceIds.includes(s.service));

  // Build status embed
  const embed = buildStatusEmbed(services, enabledServiceIds.length < 4);

  // Build setup buttons
  const rows = buildSetupButtons(services);

  await interaction.editReply({ embeds: [embed], components: rows });
}

// ============================================================================
// Embed Builders
// ============================================================================

function buildStatusEmbed(services: ServiceHealth[], hasDisabledServices: boolean): EmbedBuilder {
  const configuredCount = services.filter((s) => s.configured).length;
  const healthyCount = services.filter((s) => s.healthy === true).length;
  const totalServices = services.length;

  let description = `Configure API keys for the \`/isitreal\` command.\n\n`;

  if (totalServices === 0) {
    description += `**All services are disabled.** Use \`/config toggleapis\` to enable services.`;
  } else {
    description += `**Status:** ${configuredCount}/${totalServices} services configured, ${healthyCount}/${totalServices} healthy\n\n`;
    description += `Click a button below to configure a service. You'll need to sign up for an API key from each provider.`;
    if (hasDisabledServices) {
      description += `\n\n*Some services are hidden. Use \`/config toggleapis\` to enable them.*`;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("AI Detection Services Configuration")
    .setDescription(description)
    .setColor(totalServices === 0 ? 0xef4444 : configuredCount === 0 ? 0xef4444 : configuredCount === totalServices ? 0x22c55e : 0xf59e0b)
    .setTimestamp();

  for (const svc of services) {
    const info = SERVICE_INFO[svc.service];
    let status: string;

    if (!svc.configured) {
      status = "\u274c Not configured";
    } else if (svc.healthy === true) {
      status = "\u2705 Healthy";
    } else if (svc.healthy === false) {
      status = `\u26a0\ufe0f Error: ${svc.error || "Unknown"}`;
    } else {
      status = "\u2753 Not tested";
    }

    embed.addFields({
      name: `${info.name}`,
      value: `${status}\nEnv: \`${svc.envVars.join("`, `")}\`\n[Sign up](${info.signupUrl})`,
      inline: true,
    });
  }

  return embed;
}

function buildSetupButtons(services: ServiceHealth[]): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = services.map((svc) => {
    const info = SERVICE_INFO[svc.service];
    return new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${svc.service}`)
      .setLabel(svc.configured ? `Update ${info.name}` : `Setup ${info.name}`)
      .setStyle(svc.configured ? ButtonStyle.Secondary : ButtonStyle.Primary);
  });

  // Add refresh button
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}refresh`)
      .setLabel("Refresh Status")
      .setStyle(ButtonStyle.Success)
  );

  // Split into rows (max 5 buttons per row)
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  return rows;
}

// ============================================================================
// Button Handlers
// ============================================================================

export async function handleIsitRealButton(interaction: ButtonInteraction) {
  const customId = interaction.customId;

  // Server owner or leadership only
  const authorized = await isAuthorizedForConfig(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "Only the server owner or community managers can configure AI detection services.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Handle refresh
  if (customId === `${BUTTON_PREFIX}refresh`) {
    await interaction.deferUpdate();
    const services = await testAllConfigured();
    const embed = buildStatusEmbed(services);
    const rows = buildSetupButtons(services);
    await interaction.editReply({ embeds: [embed], components: rows });
    return;
  }

  // Handle service setup
  const service = customId.replace(BUTTON_PREFIX, "");

  if (service === "sightengine") {
    // SightEngine needs two inputs
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}sightengine`)
      .setTitle("Configure SightEngine")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("api_user")
            .setLabel("API User")
            .setPlaceholder("Your SightEngine API user ID")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("api_secret")
            .setLabel("API Secret")
            .setPlaceholder("Your SightEngine API secret")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
  } else {
    // Single API key services
    const info = SERVICE_INFO[service];
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${service}`)
      .setTitle(`Configure ${info.name}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("api_key")
            .setLabel("API Key")
            .setPlaceholder(`Your ${info.name} API key`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
  }
}

// ============================================================================
// Modal Handlers
// ============================================================================

// Temporary storage for pending saves (key: `${userId}_${service}`)
const pendingSaves = new Map<string, { envVars: Record<string, string>; expiresAt: number }>();

export async function handleIsitRealModal(interaction: ModalSubmitInteraction) {
  const customId = interaction.customId;
  const service = customId.replace(MODAL_PREFIX, "");

  // Server owner or leadership only
  const authorized = await isAuthorizedForConfig(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "Only the server owner or community managers can configure AI detection services.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const info = SERVICE_INFO[service];
  let testResult: { success: boolean; error?: string };
  let envVars: Record<string, string>;

  if (service === "sightengine") {
    const apiUser = interaction.fields.getTextInputValue("api_user").trim();
    const apiSecret = interaction.fields.getTextInputValue("api_secret").trim();

    testResult = await testSightEngine(apiUser, apiSecret);
    envVars = {
      SIGHTENGINE_API_USER: apiUser,
      SIGHTENGINE_API_SECRET: apiSecret,
    };
  } else {
    const apiKey = interaction.fields.getTextInputValue("api_key").trim();

    switch (service) {
      case "hive":
        testResult = await testHive(apiKey);
        envVars = { HIVE_API_KEY: apiKey };
        break;
      case "rapidai":
        testResult = await testRapidAI(apiKey);
        envVars = { RAPIDAPI_KEY: apiKey };
        break;
      case "optic":
        testResult = await testOptic(apiKey);
        envVars = { OPTIC_API_KEY: apiKey };
        break;
      default:
        await interaction.editReply({ content: "Unknown service." });
        return;
    }
  }

  if (!testResult.success) {
    const embed = new EmbedBuilder()
      .setTitle(`${info.name} Test Failed`)
      .setDescription(`The API key test failed:\n\n\`${testResult.error}\`\n\nPlease check your credentials and try again.`)
      .setColor(0xef4444);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Test passed - offer to save
  const saveKey = `${interaction.user.id}_${service}`;
  pendingSaves.set(saveKey, {
    envVars,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute expiry
  });

  const embed = new EmbedBuilder()
    .setTitle(`${info.name} Test Passed!`)
    .setDescription(
      `The API key is valid and working.\n\n` +
      `**Ready to save:**\n` +
      Object.entries(envVars).map(([k, v]) => `\`${k}=${v.slice(0, 8)}...\``).join("\n") +
      `\n\nClick **Save to .env** to add these to your environment and enable the service immediately.`
    )
    .setColor(0x22c55e);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SAVE_PREFIX}${service}`)
      .setLabel("Save to .env")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_PREFIX}${service}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ============================================================================
// Save/Cancel Handlers
// ============================================================================

export async function handleIsitRealSave(interaction: ButtonInteraction) {
  const customId = interaction.customId;
  const service = customId.replace(SAVE_PREFIX, "");
  const saveKey = `${interaction.user.id}_${service}`;

  // Server owner or leadership only
  const authorized = await isAuthorizedForConfig(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "Only the server owner or community managers can configure AI detection services.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const pending = pendingSaves.get(saveKey);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingSaves.delete(saveKey);
    await interaction.update({
      content: "This save request has expired. Please configure the service again.",
      embeds: [],
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    // Write to .env file
    const envPath = path.resolve(process.cwd(), ".env");

    // Read existing .env
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    // Update or append each env var
    for (const [key, value] of Object.entries(pending.envVars)) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(envContent)) {
        // Update existing
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        // Append new
        if (!envContent.endsWith("\n")) envContent += "\n";
        envContent += `${key}=${value}\n`;
      }

      // Also update runtime env
      process.env[key] = value;
    }

    // Write back
    fs.writeFileSync(envPath, envContent);

    logger.info(
      { service, keys: Object.keys(pending.envVars) },
      "[isitreal] Saved API keys to .env"
    );

    pendingSaves.delete(saveKey);

    const info = SERVICE_INFO[service];
    const embed = new EmbedBuilder()
      .setTitle(`${info.name} Configured!`)
      .setDescription(
        `Successfully saved to \`.env\` and enabled in runtime.\n\n` +
        `The \`/isitreal\` command will now use ${info.name} for AI detection.\n\n` +
        `**Note:** The keys are loaded into memory. A bot restart is NOT required.`
      )
      .setColor(0x22c55e);

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    logger.error({ err, service }, "[isitreal] Failed to save to .env");

    const embed = new EmbedBuilder()
      .setTitle("Save Failed")
      .setDescription(
        `Could not write to \`.env\` file:\n\n\`${err instanceof Error ? err.message : String(err)}\`\n\n` +
        `You may need to manually add these to your .env file:\n\n` +
        `\`\`\`\n${Object.entries(pending.envVars).map(([k, v]) => `${k}=${v}`).join("\n")}\n\`\`\``
      )
      .setColor(0xef4444);

    await interaction.editReply({ embeds: [embed], components: [] });
  }
}

export async function handleIsitRealCancel(interaction: ButtonInteraction) {
  const customId = interaction.customId;
  const service = customId.replace(CANCEL_PREFIX, "");
  const saveKey = `${interaction.user.id}_${service}`;

  pendingSaves.delete(saveKey);

  await interaction.update({
    content: "Configuration cancelled.",
    embeds: [],
    components: [],
  });
}

// ============================================================================
// Interaction Router (for index.ts)
// ============================================================================

export function isIsitRealInteraction(customId: string): boolean {
  return (
    customId.startsWith(BUTTON_PREFIX) ||
    customId.startsWith(MODAL_PREFIX) ||
    customId.startsWith(SAVE_PREFIX) ||
    customId.startsWith(CANCEL_PREFIX)
  );
}

export async function routeIsitRealInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction
): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith(SAVE_PREFIX)) {
    await handleIsitRealSave(interaction as ButtonInteraction);
  } else if (customId.startsWith(CANCEL_PREFIX)) {
    await handleIsitRealCancel(interaction as ButtonInteraction);
  } else if (customId.startsWith(MODAL_PREFIX)) {
    await handleIsitRealModal(interaction as ModalSubmitInteraction);
  } else if (customId.startsWith(BUTTON_PREFIX)) {
    await handleIsitRealButton(interaction as ButtonInteraction);
  }
}
