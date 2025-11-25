/**
 * WHAT: Proves error card formatting includes code/message/trace and handles expired interactions.
 * HOW: Mocks replyOrEdit and feeds synthetic Error payloads.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

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

describe("safeReply", () => {
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
    expect(followUp).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

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

describe("postErrorCard", () => {
  it("builds error embed with mapped hint", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      followUp: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    await errorCard.postErrorCard(interaction, {
      traceId: "trace123",
      cmd: "gate factory-reset",
      phase: "drop_or_truncate",
      err: { name: "SqliteError", code: "SQLITE_ERROR", message: "no such table" },
    });

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0];
    expect(payload).toMatchObject({ flags: 64 });
    const embed = payload.embeds?.[0];
    expect(embed).toBeDefined();
    const json = embed?.toJSON();
    expect(json?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Command", value: "/gate factory-reset" }),
        expect.objectContaining({ name: "Phase", value: "drop_or_truncate" }),
        expect.objectContaining({ name: "Code", value: "SQLITE_ERROR" }),
        expect.objectContaining({
          name: "Hint",
          value: "Schema mismatch; avoid legacy __old; use truncate-only reset.",
        }),
        expect.objectContaining({ name: "Trace", value: "trace123" }),
      ])
    );
  });
});
