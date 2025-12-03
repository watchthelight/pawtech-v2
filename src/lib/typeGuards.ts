/**
 * Pawtropolis Tech — src/lib/typeGuards.ts
 * WHAT: Type guards for Discord.js member types.
 * WHY: Discord provides GuildMember (cached) or APIInteractionGuildMember (uncached).
 *      These guards safely narrow the type without unsafe `as any` casts.
 * DOCS:
 *  - GuildMember: https://discord.js.org/#/docs/discord.js/main/class/GuildMember
 *  - APIInteractionGuildMember: https://discord-api-types.dev/api/discord-api-types-v10/interface/APIInteractionGuildMember
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { GuildMember, APIInteractionGuildMember } from "discord.js";

/**
 * Type guard to check if interaction member is a full GuildMember.
 *
 * Discord provides GuildMember when the member is cached, or APIInteractionGuildMember
 * when only partial API data is available. This guard safely narrows the type.
 *
 * @param member - The interaction member to check
 * @returns true if member is a full GuildMember with role cache access
 */
export function isGuildMember(
  member: GuildMember | APIInteractionGuildMember | null | undefined
): member is GuildMember {
  if (!member) return false;

  // APIInteractionGuildMember has string permissions, GuildMember has PermissionsBitField
  // Also check for roles property which only exists on GuildMember.
  //
  // WHY this roundabout check? Because Discord.js gives you different types depending
  // on cache state. If the member is cached, you get GuildMember with all the methods.
  // If not, you get the raw API shape which has permissions as a string and no role cache.
  // This distinction matters for permission checks - role.cache.has() only works on the real thing.
  return typeof member.permissions !== "string" && "roles" in member;
}

/**
 * Type guard for contexts where we absolutely need a full GuildMember.
 * Throws a descriptive error if member is not available.
 *
 * @param member - The interaction member to check
 * @param context - Description of where this check is used (for error messages)
 * @throws {Error} If member is not a GuildMember
 * @returns The member, narrowed to GuildMember type
 */
export function requireGuildMember(
  member: GuildMember | APIInteractionGuildMember | null | undefined,
  context: string
): GuildMember {
  if (!isGuildMember(member)) {
    // This happens when Discord sends APIInteractionGuildMember (partial data)
    // instead of a full GuildMember. Common causes:
    // - Interaction from a server where bot just joined (cache cold)
    // - Member left the server between interaction creation and handling
    // - Discord API returning partial data under load (rare but happens)
    //
    // Recovery: caller should either handle gracefully or use member.fetch()
    // before calling code that needs roles/permissions.
    throw new Error(
      `${context}: Full GuildMember required but not available. ` +
        `This usually means the member isn't cached.`
    );
  }
  return member;
}
