/**
 * Pawtropolis Tech — src/utils/requireAdminOrLeadership.ts
 * WHAT: Shared authorization helper for admin-level slash commands.
 * WHY: Centralizes multi-tier permission checking to avoid duplication and ensure consistent security.
 * FLOWS:
 *  - Check bot owner override (OWNER_IDS)
 *  - Check guild owner
 *  - Check staff permissions (mod_role_ids or ManageGuild)
 *  - Check leadership role (leadership_role_id)
 * DOCS:
 *  - Discord permissions: https://discord.com/developers/docs/topics/permissions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ChatInputCommandInteraction } from "discord.js";
import { isOwner } from "./owner.js";
import { hasStaffPermissions, getConfig } from "../lib/config.js";
import { isGuildMember } from "./typeGuards.js";

/**
 * Authorization helper for admin-level slash commands.
 *
 * PERMISSION HIERARCHY (any one grants access):
 *   1. Bot owner (OWNER_IDS in env) - global override for debugging
 *   2. Guild owner - always has access to their own server
 *   3. Staff permissions (mod_role_ids or ManageGuild) - server admins
 *   4. Leadership role (leadership_role_id in config) - designated oversight role
 *
 * WHY SO MANY CHECKS?
 * Different servers organize their staff differently. Some have a dedicated
 * "Leadership" role for senior mods, others just use ManageGuild for admins.
 * We support all common patterns.
 *
 * The `member.permissions` string check handles an edge case where Discord
 * returns permissions as a bitfield string instead of a Permissions object
 * (happens in some webhook/API contexts).
 *
 * @param interaction - ChatInputCommandInteraction to check
 * @returns Promise<boolean> - true if authorized, false otherwise
 */
export async function requireAdminOrLeadership(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!guildId) {
    return false;
  }

  // Owner override
  if (isOwner(userId)) {
    return true;
  }

  // Guild owner
  if (interaction.guild?.ownerId === userId) {
    return true;
  }

  // Member validation
  const member = interaction.member;
  if (!member || typeof member.permissions === "string") {
    return false;
  }

  // Staff permissions - hasStaffPermissions now accepts the union type natively
  if (hasStaffPermissions(member, guildId)) {
    return true;
  }

  // Leadership role - need to check if member is a full GuildMember to access roles.cache
  const config = getConfig(guildId);
  if (
    config?.leadership_role_id &&
    isGuildMember(member) &&
    member.roles.cache.has(config.leadership_role_id)
  ) {
    return true;
  }

  return false;
}
