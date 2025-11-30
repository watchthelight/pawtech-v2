/**
 * Pawtropolis Tech -- tests/features/modmail/routing.test.ts
 * WHAT: Tests for modmail routing size-based eviction.
 * WHY: Verify that forwardedMessages Map doesn't grow unbounded under high load.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ===== Mock Setup =====

// Mock logger before importing routing module
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

// Mock db to avoid database initialization
vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(),
    }),
  },
}));

// Mock sentry
vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

// Mock tickets module
vi.mock("../../../src/features/modmail/tickets.js", () => ({
  insertModmailMessage: vi.fn(),
  getThreadIdForDmReply: vi.fn(),
  getDmIdForThreadReply: vi.fn(),
  getTicketByThread: vi.fn(),
}));

// Mock transcript module
vi.mock("../../../src/features/modmail/transcript.js", () => ({
  appendTranscript: vi.fn(),
  formatContentWithAttachments: vi.fn((content) => content),
}));

// Import after mocks are set up
import {
  markForwarded,
  isForwarded,
  _testing,
} from "../../../src/features/modmail/routing.js";

// ===== Size-Based Eviction Tests =====

describe("forwardedMessages size-based eviction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the Map before each test
    _testing.clearForwardedMessages();
  });

  afterEach(() => {
    // Clean up after each test
    _testing.clearForwardedMessages();
  });

  describe("basic functionality", () => {
    it("should mark and detect forwarded messages", () => {
      const messageId = "test-msg-1";

      expect(isForwarded(messageId)).toBe(false);

      markForwarded(messageId);

      expect(isForwarded(messageId)).toBe(true);
    });

    it("should track Map size correctly", () => {
      expect(_testing.getForwardedMessagesSize()).toBe(0);

      markForwarded("msg-1");
      expect(_testing.getForwardedMessagesSize()).toBe(1);

      markForwarded("msg-2");
      expect(_testing.getForwardedMessagesSize()).toBe(2);
    });
  });

  describe("size limit enforcement", () => {
    it("should evict oldest entries when size exceeds threshold", () => {
      const evictionSize = _testing.FORWARDED_EVICTION_SIZE;

      // Add entries up to the eviction threshold + 1 to trigger eviction
      for (let i = 0; i <= evictionSize; i++) {
        markForwarded(`msg-${i}`);
      }

      // Map should be reduced to half the eviction size after eviction
      const expectedSize = evictionSize / 2;
      expect(_testing.getForwardedMessagesSize()).toBe(expectedSize);
    });

    it("should maintain newest entries during eviction", () => {
      const evictionSize = _testing.FORWARDED_EVICTION_SIZE;

      // Add entries with sequential IDs
      for (let i = 0; i <= evictionSize; i++) {
        markForwarded(`msg-${i}`);
      }

      // The newest entries should still be present
      // After eviction, we keep the newest evictionSize/2 entries
      const keptCount = evictionSize / 2;
      const firstKeptIndex = evictionSize + 1 - keptCount;

      // Check that newest entries are preserved
      expect(isForwarded(`msg-${evictionSize}`)).toBe(true);
      expect(isForwarded(`msg-${evictionSize - 1}`)).toBe(true);

      // Check that oldest entries are evicted
      expect(isForwarded(`msg-0`)).toBe(false);
      expect(isForwarded(`msg-1`)).toBe(false);
    });

    it("should never exceed MAX_SIZE under normal operation", () => {
      const maxSize = _testing.FORWARDED_MAX_SIZE;

      // Add a large number of entries
      for (let i = 0; i < maxSize; i++) {
        markForwarded(`msg-${i}`);
      }

      // Size should never exceed eviction threshold (eviction happens at threshold)
      expect(_testing.getForwardedMessagesSize()).toBeLessThanOrEqual(
        _testing.FORWARDED_EVICTION_SIZE
      );
    });
  });

  describe("eviction logging", () => {
    it("should log eviction events", () => {
      const evictionSize = _testing.FORWARDED_EVICTION_SIZE;

      // Add entries to trigger eviction
      for (let i = 0; i <= evictionSize; i++) {
        markForwarded(`msg-${i}`);
      }

      // Check that debug log was called for eviction
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          removed: expect.any(Number),
          remaining: expect.any(Number),
        }),
        "[modmail] size-based eviction"
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty Map gracefully", () => {
      expect(_testing.getForwardedMessagesSize()).toBe(0);
      expect(isForwarded("nonexistent")).toBe(false);
    });

    it("should handle single entry Map", () => {
      markForwarded("single-msg");
      expect(_testing.getForwardedMessagesSize()).toBe(1);
      expect(isForwarded("single-msg")).toBe(true);
    });

    it("should handle exactly at threshold (no eviction)", () => {
      const evictionSize = _testing.FORWARDED_EVICTION_SIZE;

      // Add entries exactly up to threshold (not exceeding)
      for (let i = 0; i < evictionSize; i++) {
        markForwarded(`msg-${i}`);
      }

      // Should not trigger eviction
      expect(_testing.getForwardedMessagesSize()).toBe(evictionSize);
    });

    it("should handle duplicate message IDs", () => {
      markForwarded("same-msg");
      markForwarded("same-msg");
      markForwarded("same-msg");

      // Should still be just one entry
      expect(_testing.getForwardedMessagesSize()).toBe(1);
      expect(isForwarded("same-msg")).toBe(true);
    });
  });

  describe("rapid message bursts", () => {
    it("should handle 1000+ messages added quickly", () => {
      const burstSize = 1500;

      for (let i = 0; i < burstSize; i++) {
        markForwarded(`burst-msg-${i}`);
      }

      // Size should be bounded after eviction
      expect(_testing.getForwardedMessagesSize()).toBeLessThanOrEqual(
        _testing.FORWARDED_EVICTION_SIZE
      );
    });
  });
});

// ===== Performance Tests =====

describe("forwardedMessages performance", () => {
  beforeEach(() => {
    _testing.clearForwardedMessages();
  });

  afterEach(() => {
    _testing.clearForwardedMessages();
  });

  it("should handle 10,000 entries without significant degradation", () => {
    const start = Date.now();

    for (let i = 0; i < 10000; i++) {
      markForwarded(`perf-msg-${i}`);
    }

    const duration = Date.now() - start;

    // Should complete in under 1 second
    expect(duration).toBeLessThan(1000);

    // Map should be bounded
    expect(_testing.getForwardedMessagesSize()).toBeLessThanOrEqual(
      _testing.FORWARDED_EVICTION_SIZE
    );
  });

  it("should complete eviction operation quickly", () => {
    const evictionSize = _testing.FORWARDED_EVICTION_SIZE;

    // Fill up to just below threshold
    for (let i = 0; i < evictionSize; i++) {
      markForwarded(`pre-evict-${i}`);
    }

    // Time the eviction trigger
    const start = Date.now();
    markForwarded("trigger-eviction");
    const duration = Date.now() - start;

    // Eviction should take less than 10ms
    expect(duration).toBeLessThan(10);
  });
});
