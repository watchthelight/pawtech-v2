/**
 * Pawtropolis Tech — src/commands/utility.ts
 * WHAT: One-time command to mass-assign a role to members without level roles
 * WHY: Utility command for giving a base role to members who haven't chatted
 * NOTE: This is a one-time use command, delete after use
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { logger } from "../lib/logger.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { ROLE_IDS } from "../lib/roles.js";

const ENTROPY_USER_ID = "1402989891830153269";
const ROLE_TO_ASSIGN = "1459895384007512311";
const SERVER_DEV_ROLE = ROLE_IDS.SERVER_DEV;

// All level roles - skip anyone who has ANY of these
const LEVEL_ROLES = [
  "896070888712175693", // Eternal Fur LVL 100+
  "1280766667999285329", // Mythic Fur LVL 90
  "1280766659539501117", // Legendary Fur LVL 80
  "1280766451208421407", // Elite Fur LVL 70
  "1214944241050976276", // Veteran Fur LVL 60
  "896070888712175692", // Noble Fur LVL 50
  "1216956340245631006", // Experienced Fur LVL 40
  "896070888712175691", // Known Fur LVL 30
  "896070888712175690", // Active Fur LVL 20
  "1280767926147878962", // Engaged Fur LVL 15
  "896070888712175689", // Chatty Fur LVL 10
  "896070888712175688", // Beginner Fur LVL 5
  "896070888712175687", // Newcomer Fur LVL 1
];

// Helper to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const data = new SlashCommandBuilder()
  .setName("utility")
  .setDescription("Utility command for mass role assignment");

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const userId = interaction.user.id;
  const member = interaction.member;

  // Check if user is Entropy or has Server Dev role
  const hasServerDev = member && "roles" in member && member.roles.cache.has(SERVER_DEV_ROLE);
  const isEntropy = userId === ENTROPY_USER_ID;

  if (!isEntropy && !hasServerDev) {
    await interaction.reply({
      content: "❌ Access denied. This command can only be run by Entropy or Server Dev.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Fake auth check with delay
  await interaction.deferReply();
  await interaction.editReply("🔍 Checking authorization....");
  await sleep(1500);
  await interaction.editReply("🔍 Checking authorization.... authorized ✅");
  await sleep(1000);

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("❌ This command must be run in a server.");
    return;
  }

  await interaction.editReply("📋 Fetching all members...");

  try {
    // Fetch all members
    const members = await guild.members.fetch();
    const role = await guild.roles.fetch(ROLE_TO_ASSIGN);

    if (!role) {
      await interaction.editReply("❌ Role not found.");
      return;
    }

    let assigned = 0;
    let failed = 0;

    // Helper to check if member has any level role
    const hasAnyLevelRole = (m: typeof members extends Map<string, infer V> ? V : never) => {
      return LEVEL_ROLES.some((roleId) => m.roles.cache.has(roleId));
    };

    const eligibleMembers = members.filter((m) => {
      // Skip bots
      if (m.user.bot) return false;
      // Skip if they have any level role (they've chatted)
      if (hasAnyLevelRole(m)) return false;
      // Skip if they already have the role
      if (m.roles.cache.has(ROLE_TO_ASSIGN)) return false;
      return true;
    });

    const totalEligible = eligibleMembers.size;
    const skippedHasLevelRole = members.filter((m) => !m.user.bot && hasAnyLevelRole(m)).size;
    const skippedAlreadyHas = members.filter((m) => !m.user.bot && m.roles.cache.has(ROLE_TO_ASSIGN)).size;

    await interaction.editReply(
      `📋 Found ${members.size} members\n` +
      `✅ Eligible (no level role): ${totalEligible}\n` +
      `⏭️ Skipping (has level role): ${skippedHasLevelRole}\n` +
      `⏭️ Skipping (already has role): ${skippedAlreadyHas}\n\n` +
      `🔄 Assigning role...`
    );

    // Assign role to eligible members
    for (const [, member] of eligibleMembers) {
      try {
        await member.roles.add(ROLE_TO_ASSIGN, "Utility mass role assignment");
        assigned++;

        // Progress update every 50 members
        if (assigned % 50 === 0) {
          await interaction.editReply(
            `🔄 Progress: ${assigned}/${totalEligible} members processed...`
          );
        }

        // Small delay to avoid rate limits
        await sleep(100);
      } catch (err) {
        failed++;
        logger.warn({ err, memberId: member.id }, "[utility] Failed to assign role to member");
      }
    }

    await interaction.editReply(
      `✅ **Role Assignment Complete**\n\n` +
      `📊 **Results:**\n` +
      `• Assigned: ${assigned}\n` +
      `• Skipped (has level role): ${skippedHasLevelRole}\n` +
      `• Skipped (already had role): ${skippedAlreadyHas}\n` +
      `• Failed: ${failed}\n\n` +
      `🎉 Done!`
    );

    logger.info(
      { assigned, skippedHasLevelRole, skippedAlreadyHas, failed, guildId: guild.id },
      "[utility] Mass role assignment complete"
    );
  } catch (err) {
    logger.error({ err }, "[utility] Command failed");
    await interaction.editReply(`❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
