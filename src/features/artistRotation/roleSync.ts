/**
 * Pawtropolis Tech — src/features/artistRotation/roleSync.ts
 * WHAT: Detect Server Artist role changes and sync with queue.
 * WHY: Automatically maintain queue when artists are added/removed from program.
 * FLOWS:
 *  - Role added → addArtist to queue → log
 *  - Role removed → removeArtist from queue → log
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild, GuildMember, PartialGuildMember } from "discord.js";
import { logger } from "../../lib/logger.js";
import { logActionPretty } from "../../logging/pretty.js";
import { getArtistRoleId, getIgnoredArtistUsers } from "./constants.js";
import { addArtist, removeArtist, getArtist } from "./queue.js";

/**
 * handleArtistRoleAdded
 * WHAT: Handle when someone receives the Server Artist role.
 * WHY: Add them to the rotation queue and log the event.
 */
export async function handleArtistRoleAdded(
  guild: Guild,
  member: GuildMember
): Promise<void> {
  /*
   * WHY ignore certain users? Some people have the Artist role for other reasons
   * (legacy, special arrangements, bots) but shouldn't be in the queue.
   * Configurable via /config set artist_ignored_users.
   */
  const ignoredUsers = getIgnoredArtistUsers(guild.id);
  if (ignoredUsers.has(member.id)) {
    logger.debug({ guildId: guild.id, userId: member.id }, "[artistRotation] Ignored user, skipping queue add");
    return;
  }

  const position = addArtist(guild.id, member.id);

  if (position === null) {
    // Already in queue. This happens if someone removes and re-adds the role
    // quickly, or if the queue got out of sync. Not harmful, just noisy.
    logger.debug(
      { guildId: guild.id, userId: member.id },
      "[artistRotation] Artist role added but user already in queue"
    );
    return;
  }

  logger.info(
    { guildId: guild.id, userId: member.id, position },
    "[artistRotation] Server Artist role added - user added to queue"
  );

  // Log to Discord audit channel. We attribute to the bot since we can't
  // easily tell who actually added the role (would require audit log fetch).
  const botId = guild.client.user?.id ?? "system";
  await logActionPretty(guild, {
    actorId: botId,
    subjectId: member.id,
    action: "artist_queue_joined",
    meta: { position },
  }).catch((err) => {
    logger.warn(
      { err, guildId: guild.id, userId: member.id },
      "[artistRotation] Failed to log artist join to Discord"
    );
  });
}

/**
 * handleArtistRoleRemoved
 * WHAT: Handle when someone loses the Server Artist role.
 * WHY: Remove them from the rotation queue and log the event.
 */
export async function handleArtistRoleRemoved(
  guild: Guild,
  member: GuildMember | PartialGuildMember
): Promise<void> {
  // Get stats before removal
  const artist = getArtist(guild.id, member.id);
  const assignmentsCount = removeArtist(guild.id, member.id);

  if (assignmentsCount === null) {
    // Wasn't in queue (shouldn't happen normally)
    logger.debug(
      { guildId: guild.id, userId: member.id },
      "[artistRotation] Artist role removed but user not in queue"
    );
    return;
  }

  logger.info(
    { guildId: guild.id, userId: member.id, assignmentsCount },
    "[artistRotation] Server Artist role removed - user removed from queue"
  );

  // Calculate tenure for the departure log. Nice for staff to see
  // "wow, they were with us for 847 days" or "2 days? that was fast".
  let daysInProgram: number | null = null;
  if (artist?.added_at) {
    const addedDate = new Date(artist.added_at);
    const now = new Date();
    daysInProgram = Math.floor((now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Log to Discord audit channel
  const botId = guild.client.user?.id ?? "system";
  await logActionPretty(guild, {
    actorId: botId,
    subjectId: member.id,
    action: "artist_queue_left",
    meta: {
      assignmentsCompleted: assignmentsCount,
      daysInProgram,
    },
  }).catch((err) => {
    logger.warn(
      { err, guildId: guild.id, userId: member.id },
      "[artistRotation] Failed to log artist leave to Discord"
    );
  });
}

/**
 * detectArtistRoleChange
 * WHAT: Check if the Server Artist role was added or removed.
 * WHY: Called from guildMemberUpdate to route to appropriate handler.
 * @returns 'added' | 'removed' | null
 *
 * GOTCHA: oldMember might be a PartialGuildMember if the member wasn't cached.
 * Discord.js will have an incomplete role cache in that case. If the bot just
 * started and someone loses a role, we might miss it. The sync command exists
 * to fix these edge cases.
 */
export function detectArtistRoleChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): "added" | "removed" | null {
  const artistRoleId = getArtistRoleId(newMember.guild.id);
  const hadRole = oldMember.roles.cache.has(artistRoleId);
  const hasRole = newMember.roles.cache.has(artistRoleId);

  if (!hadRole && hasRole) {
    return "added";
  }

  if (hadRole && !hasRole) {
    return "removed";
  }

  return null;
}

/**
 * handleArtistRoleChange
 * WHAT: Main entry point for guildMemberUpdate to handle artist role changes.
 * WHY: Consolidated handler that detects and routes to add/remove handlers.
 */
export async function handleArtistRoleChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  const change = detectArtistRoleChange(oldMember, newMember);

  if (change === "added") {
    await handleArtistRoleAdded(newMember.guild, newMember);
  } else if (change === "removed") {
    // We pass oldMember here to access the user_id. The role is already gone
    // from newMember, so we need the "before" snapshot.
    await handleArtistRoleRemoved(newMember.guild, oldMember);
  }
}
