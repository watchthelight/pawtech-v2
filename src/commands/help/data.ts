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

// WHY: Separate file for command data because Discord.js slash command registration
// needs the builder without the execute logic. Keeps the import graph clean when
// deploying commands - we don't drag in half the codebase just to tell Discord
// that /help exists.
export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Interactive help system for Pawtropolis Tech")
  // GOTCHA: setAutocomplete(true) means you MUST implement an autocomplete
  // handler or Discord will show an embarrassing "loading..." forever
  .addStringOption((option) =>
    option
      .setName("command")
      .setDescription("Get detailed help for a specific command")
      .setRequired(false)
      .setAutocomplete(true)
  )
  // No autocomplete here - user types freeform text. Search is implemented
  // server-side which means we actually control what "search" means.
  .addStringOption((option) =>
    option
      .setName("search")
      .setDescription("Search commands by keyword")
      .setRequired(false)
  )
  /*
   * GOTCHA: Discord limits you to 25 choices per option. We're at 9 categories
   * now, so there's room to grow, but if feature creep strikes and you hit
   * the limit, you'll need autocomplete instead of static choices.
   */
  .addStringOption((option) =>
    option
      .setName("category")
      .setDescription("Browse commands by category")
      .setRequired(false)
      .addChoices(
        // These values must match the category slugs used in the help registry.
        // If you add a category here but forget to populate it with commands,
        // users get a sad empty embed. Ask me how I know.
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
  // WHY: DMs disabled because we need guild context to know what commands are
  // available and what permissions the user has. A /help that shows nothing
  // useful is worse than no /help at all.
  .setDMPermission(false);
