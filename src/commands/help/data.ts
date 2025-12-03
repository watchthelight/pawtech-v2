/**
 * Pawtropolis Tech — src/commands/help/data.ts
 * WHAT: SlashCommandBuilder definition for the /help command
 * WHY: Defines command structure, options, and autocomplete for Discord
 * FLOWS:
 *  - /help → main overview
 *  - /help command:<name> → specific command details (with autocomplete)
 *  - /help search:<query> → full-text search
 *  - /help category:<name> → browse category
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Interactive help system for Pawtropolis Tech")
  .addStringOption((option) =>
    option
      .setName("command")
      .setDescription("Get detailed help for a specific command")
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption((option) =>
    option
      .setName("search")
      .setDescription("Search commands by keyword")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("category")
      .setDescription("Browse commands by category")
      .setRequired(false)
      .addChoices(
        { name: "Gate & Verification", value: "gate" },
        { name: "Configuration", value: "config" },
        { name: "Moderation", value: "moderation" },
        { name: "Queue Management", value: "queue" },
        { name: "Analytics", value: "analytics" },
        { name: "Messaging", value: "messaging" },
        { name: "Role Automation", value: "roles" },
        { name: "Artist System", value: "artist" },
        { name: "System & Maintenance", value: "system" }
      )
  )
  // Visible to everyone - we filter commands at runtime based on permissions
  .setDefaultMemberPermissions(null)
  .setDMPermission(false);
