/**
 * Pawtropolis Tech — src/lib/autoDelete.ts
 * WHAT: Auto-delete Discord messages after a delay.
 * WHY: Provides self-cleaning temporary messages (e.g., ping notifications).
 * HOW: Schedules message deletion using setTimeout, gracefully handles races and permission errors.
 * DOCS:
 *  - Message.delete: https://discord.js.org/#/docs/discord.js/main/class/Message?scrollTo=delete
 *  - Message.deletable: https://discord.js.org/#/docs/discord.js/main/class/Message?scrollTo=deletable
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Message } from "discord.js";

/**
 * WHAT: Schedule a message for automatic deletion after a delay.
 * WHY: Keeps channels clean by auto-removing temporary notifications.
 * HOW:
 *  1. Await message (if promise)
 *  2. Schedule deletion after delay
 *  3. Check deletable flag before attempting delete
 *  4. Swallow all errors (already deleted, permissions, etc.)
 *
 * @param messageOrPromise - Message or promise resolving to message
 * @param ms - Delay in milliseconds before deletion (default: 30 seconds)
 *
 * @example
 * const sent = channel.send({ content: "Temporary ping!" });
 * autoDelete(sent, 30_000); // Auto-delete after 30s
 *
 * @example
 * const msg = await channel.send({ content: "Notification" });
 * autoDelete(msg, 10_000); // Auto-delete after 10s
 *
 * @security
 * - Never throws or causes unhandled rejections
 * - Gracefully handles permission errors
 * - Handles race conditions (manual deletion before timeout)
 * - Handles send failures (promise rejection)
 */
export function autoDelete(messageOrPromise: Promise<Message> | Message, ms = 30_000): void {
  // Wrap in async IIFE to avoid unhandled rejection
  (async () => {
    try {
      // Await message if it's a promise
      const msg = await messageOrPromise;

      // Schedule deletion
      setTimeout(async () => {
        try {
          // Check if message is still deletable
          // This handles cases where:
          // - Message was already deleted manually
          // - Bot lost permissions
          // - Message is from another user and bot can't delete it
          if (msg.deletable) {
            await msg.delete();
          }
        } catch {
          // Swallow all deletion errors:
          // - 10008: Unknown Message (already deleted)
          // - 50013: Missing Permissions
          // - 50001: Missing Access
          // - Network errors
          // - Any other Discord API errors
          //
          // Philosophy: Auto-delete is best-effort; failures are expected and harmless
        }
      }, ms);
    } catch {
      // Swallow send failures:
      // - Message send was rejected
      // - Channel became unavailable
      // - Permissions were revoked between send and await
      //
      // If the message never sent, there's nothing to delete
    }
  })();
}
