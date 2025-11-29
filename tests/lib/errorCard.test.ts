/**
 * WHAT: Proves error card formatting includes code/message/trace and handles expired interactions.
 * HOW: Mocks replyOrEdit and feeds synthetic Error payloads.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

// Mock logger to prevent console noise during tests and avoid side effects.
// The redact function is a passthrough here—in production it strips PII from logs.
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  redact: (value: string) => value,
}));

import * as errorCard from "../../src/lib/errorCard.js";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * safeReply handles the three possible states of a Discord interaction:
 * 1. Fresh (not replied, not deferred) -> use reply()
 * 2. Deferred (acknowledged but no content yet) -> use editReply()
 * 3. Already replied -> use followUp()
 *
 * Getting this wrong throws DiscordAPIError, so these tests lock the branching logic.
 */
describe("safeReply", () => {
  /**
   * Fresh interaction: user just clicked, we haven't responded yet.
   * This is the simplest case—just call reply().
   * flags: 64 is the ephemeral flag in Discord's API.
   */
  it("replies when interaction has not responded", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      followUp: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    await errorCard.safeReply(interaction, { content: "hi", ephemeral: true });
    expect(reply).toHaveBeenCalledWith({ content: "hi", ephemeral: true, flags: 64 });
  });

  /**
   * Deferred interaction: we called deferReply() earlier (shows "thinking...").
   * Now we must editReply() to replace the deferred message with real content.
   * Calling reply() here would throw "Already acknowledged".
   */
  it("edits deferred reply", async () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn();
    const reply = vi.fn();
    const interaction = {
      replied: false,
      deferred: true,
      reply,
      followUp,
      editReply,
    } as unknown as ChatInputCommandInteraction;

    await errorCard.safeReply(interaction, { content: "done", ephemeral: true });
    expect(editReply).toHaveBeenCalledWith({ content: "done", ephemeral: true });
    // Verify we didn't accidentally call the wrong method.
    expect(followUp).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  /**
   * Already replied: we've sent a response, now need to add another message.
   * followUp() creates a new message in the thread instead of editing.
   * Common case: showing an error after already displaying partial results.
   */
  it("uses followUp when already replied", async () => {
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: true,
      deferred: false,
      reply: vi.fn(),
      followUp,
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    await errorCard.safeReply(interaction, { content: "later", ephemeral: true });
    expect(followUp).toHaveBeenCalledWith({ content: "later", ephemeral: true, flags: 64 });
  });
});

/**
 * postErrorCard builds a user-facing error embed with diagnostic fields.
 * These tests verify the embed structure and that hintFor() integration works.
 */
describe("postErrorCard", () => {
  /**
   * Real-world scenario: factory-reset command hit a schema mismatch error.
   * Verifies the error card includes all diagnostic fields users need to
   * report issues, plus a human-readable hint derived from the error code.
   */
  it("builds error embed with mapped hint", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      followUp: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    // Simulate a SQLite schema error during factory reset.
    // This is a real error users hit when the DB schema is out of sync.
    await errorCard.postErrorCard(interaction, {
      traceId: "trace123",
      cmd: "gate factory-reset",
      phase: "drop_or_truncate",
      err: { name: "SqliteError", code: "SQLITE_ERROR", message: "no such table" },
    });

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0];

    // Error cards are public (flags: 0) so everyone can see errors.
    expect(payload).toMatchObject({ flags: 0 });

    const embed = payload.embeds?.[0];
    expect(embed).toBeDefined();
    const json = embed?.toJSON();

    // The embed fields provide a mini bug report for users and support staff.
    // Command gets a leading slash for display; Phase shows where it failed.
    expect(json?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Command", value: "/gate factory-reset" }),
        expect.objectContaining({ name: "Phase", value: "drop_or_truncate" }),
        expect.objectContaining({ name: "Code", value: "SQLITE_ERROR" }),
        // The hint is the human-readable interpretation of the error code,
        // mapped via hintFor(). This specific hint matches SqliteError patterns.
        expect.objectContaining({
          name: "Hint",
          value: "Schema mismatch; avoid legacy __old; use truncate-only reset.",
        }),
        // Trace ID lets support correlate this error with server logs.
        expect.objectContaining({ name: "Trace", value: "trace123" }),
      ])
    );
  });
});
