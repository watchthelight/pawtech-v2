/**
 * Pawtropolis Tech — src/commands/test.ts
 * WHAT: Test command that throws an intentional error.
 * WHY: Tests the error handling, logging, and Sentry integration.
 * FLOWS:
 *  - /test -> Throws an error to test error card and wide event logging
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type CommandContext, withStep } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("test")
  .setDescription("Test command - throws an intentional error for logging verification");

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  await withStep(ctx, "intentional_error", async () => {
    throw new Error("Intentional test error - verifying logging system");
  });
}
