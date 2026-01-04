/**
 * Pawtropolis Tech — tests/listeners/messageDadMode.test.ts
 * WHAT: Unit tests for Dad Mode message listener.
 * WHY: Verify pattern matching, odds calculation, and response logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Events } from "discord.js";

// Mock config
vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock constants
vi.mock("../../src/lib/constants.js", () => ({
  DADMODE_ODDS_MIN: 1,
  DADMODE_ODDS_MAX: 10000,
}));

import { name, execute } from "../../src/listeners/messageDadMode.js";
import { getConfig } from "../../src/lib/config.js";
import { logger } from "../../src/lib/logger.js";

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;

function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    guild: { id: "guild-123" },
    author: { bot: false },
    webhookId: null,
    content: "I'm hungry",
    channel: { id: "channel-456" },
    id: "message-789",
    reply: vi.fn(),
    ...overrides,
  };
}

describe("messageDadMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks(); // Restore Math.random spy
    mockGetConfig.mockResolvedValue({
      dadmode_enabled: true,
      dadmode_odds: 1, // Always trigger for tests
    });
    vi.spyOn(Math, "random").mockReturnValue(0); // Always roll 0
  });

  describe("event name", () => {
    it("exports correct event name", () => {
      expect(name).toBe(Events.MessageCreate);
    });
  });

  describe("message filtering", () => {
    it("skips DM messages (no guild)", async () => {
      const message = createMockMessage({ guild: null });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips bot messages", async () => {
      const message = createMockMessage({ author: { bot: true } });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips webhook messages", async () => {
      const message = createMockMessage({ webhookId: "webhook-123" });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips empty content", async () => {
      const message = createMockMessage({ content: "" });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips command-like messages starting with /", async () => {
      const message = createMockMessage({ content: "/help" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("skips command-like messages starting with !", async () => {
      const message = createMockMessage({ content: "!ping" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("skips command-like messages starting with .", async () => {
      const message = createMockMessage({ content: ".help" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("config checks", () => {
    it("skips if dadmode is not enabled", async () => {
      mockGetConfig.mockResolvedValue({ dadmode_enabled: false });
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("handles config error gracefully", async () => {
      mockGetConfig.mockRejectedValue(new Error("DB error"));
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.error).toHaveBeenCalled();
      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("pattern matching", () => {
    it("matches \"I'm hungry\"", async () => {
      const message = createMockMessage({ content: "I'm hungry" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi hungry, I'm dad." });
    });

    it("matches \"Im tired\"", async () => {
      const message = createMockMessage({ content: "Im tired" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi tired, I'm dad." });
    });

    it("matches \"I am happy\"", async () => {
      const message = createMockMessage({ content: "I am happy" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi happy, I'm dad." });
    });

    it("matches with leading whitespace", async () => {
      const message = createMockMessage({ content: "  I'm excited" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi excited, I'm dad." });
    });

    it("matches with leading quotes", async () => {
      const message = createMockMessage({ content: "\"I'm confused\"" });

      await execute(message as any);

      // Note: The regex captures until sentence end, so the closing quote is included
      expect(message.reply).toHaveBeenCalledWith({ content: "Hi confused\", I'm dad." });
    });

    it("does not match \"I'm\" at the end of message", async () => {
      const message = createMockMessage({ content: "tell me I'm" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("does not match non-matching content", async () => {
      const message = createMockMessage({ content: "hello world" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("name sanitization", () => {
    it("removes @ mentions", async () => {
      const message = createMockMessage({ content: "I'm @everyone's friend" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.not.stringContaining("@"),
      }));
    });

    it("removes # channel references", async () => {
      const message = createMockMessage({ content: "I'm in #general now" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.not.stringContaining("#"),
      }));
    });

    it("collapses multiple spaces", async () => {
      const message = createMockMessage({ content: "I'm   very   sleepy" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi very sleepy, I'm dad." });
    });

    it("skips empty name after normalization", async () => {
      // Content with only @ and # that get stripped, plus spaces
      // After stripping @/#, we have "   " which trims to empty
      const message = createMockMessage({ content: "I'm @" });

      await execute(message as any);

      // The name after stripping @ is empty, so no reply
      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("odds handling", () => {
    it("does not reply when roll is non-zero", async () => {
      vi.restoreAllMocks(); // Clear the beforeEach spy
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("clamps odds to minimum", async () => {
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 0 });
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).toHaveBeenCalled();
    });

    it("clamps odds to maximum", async () => {
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 100000 });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("logs warning when reply fails", async () => {
      const message = createMockMessage();
      message.reply.mockRejectedValue(new Error("Missing permissions"));

      await execute(message as any);

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
