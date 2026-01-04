/**
 * Pawtropolis Tech — tests/listeners/messageSkullMode.test.ts
 * WHAT: Unit tests for Skull Mode message listener.
 * WHY: Verify filtering, odds calculation, and reaction logic.
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
  SKULLMODE_ODDS_MIN: 1,
  SKULLMODE_ODDS_MAX: 10000,
}));

import { name, execute } from "../../src/listeners/messageSkullMode.js";
import { getConfig } from "../../src/lib/config.js";
import { logger } from "../../src/lib/logger.js";

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;

function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    guild: { id: "guild-123" },
    author: { bot: false },
    webhookId: null,
    channel: { id: "channel-456" },
    id: "message-789",
    react: vi.fn(),
    ...overrides,
  };
}

describe("messageSkullMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks(); // Restore Math.random spy
    mockGetConfig.mockResolvedValue({
      skullmode_enabled: true,
      skullmode_odds: 1, // Always trigger for tests
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
      expect(message.react).not.toHaveBeenCalled();
    });

    it("skips bot messages", async () => {
      const message = createMockMessage({ author: { bot: true } });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });

    it("skips webhook messages", async () => {
      const message = createMockMessage({ webhookId: "webhook-123" });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });
  });

  describe("config checks", () => {
    it("skips if skullmode is not enabled", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: false });
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).not.toHaveBeenCalled();
    });

    it("handles config error gracefully", async () => {
      mockGetConfig.mockRejectedValue(new Error("DB error"));
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.error).toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });

    it("skips if config is null", async () => {
      mockGetConfig.mockResolvedValue(null);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).not.toHaveBeenCalled();
    });
  });

  describe("odds handling", () => {
    it("reacts when roll is zero", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}"); // Skull emoji
    });

    it("does not react when roll is non-zero", async () => {
      vi.restoreAllMocks(); // Clear the beforeEach spy
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).not.toHaveBeenCalled();
    });

    it("clamps odds to minimum", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true, skullmode_odds: 0 });
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalled();
    });

    it("clamps odds to maximum", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true, skullmode_odds: 100000 });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalled();
    });

    it("uses default odds when not configured", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalled();
    });
  });

  describe("reaction behavior", () => {
    it("reacts with skull emoji", async () => {
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}");
    });

    it("logs successful reaction", async () => {
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("logs warning when reaction fails", async () => {
      const message = createMockMessage();
      message.react.mockRejectedValue(new Error("Missing permissions"));

      await execute(message as any);

      expect(logger.warn).toHaveBeenCalled();
    });

    it("includes error code in warning log", async () => {
      const message = createMockMessage();
      const error = new Error("Missing permissions") as Error & { code: number };
      error.code = 50013;
      message.react.mockRejectedValue(error);

      await execute(message as any);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 50013 }),
        expect.any(String)
      );
    });
  });
});
