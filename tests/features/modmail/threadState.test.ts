/**
 * Pawtropolis Tech — tests/features/modmail/threadState.test.ts
 * WHAT: Unit tests for modmail thread state management.
 * WHY: Verify in-memory thread tracking works correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockAll, mockPrepare } = vi.hoisted(() => ({
  mockAll: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  all: mockAll,
});

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  OPEN_MODMAIL_THREADS,
  addOpenThread,
  removeOpenThread,
  isOpenModmailThread,
  hydrateOpenModmailThreadsOnStartup,
} from "../../../src/features/modmail/threadState.js";

describe("features/modmail/threadState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the set before each test
    OPEN_MODMAIL_THREADS.clear();
    mockPrepare.mockReturnValue({
      all: mockAll,
    });
  });

  afterEach(() => {
    OPEN_MODMAIL_THREADS.clear();
  });

  describe("OPEN_MODMAIL_THREADS", () => {
    it("is a Set", () => {
      expect(OPEN_MODMAIL_THREADS instanceof Set).toBe(true);
    });

    it("starts empty", () => {
      expect(OPEN_MODMAIL_THREADS.size).toBe(0);
    });
  });

  describe("addOpenThread", () => {
    it("adds a thread ID to the set", () => {
      addOpenThread("thread-123");
      expect(OPEN_MODMAIL_THREADS.has("thread-123")).toBe(true);
    });

    it("handles multiple threads", () => {
      addOpenThread("thread-1");
      addOpenThread("thread-2");
      addOpenThread("thread-3");

      expect(OPEN_MODMAIL_THREADS.size).toBe(3);
      expect(OPEN_MODMAIL_THREADS.has("thread-1")).toBe(true);
      expect(OPEN_MODMAIL_THREADS.has("thread-2")).toBe(true);
      expect(OPEN_MODMAIL_THREADS.has("thread-3")).toBe(true);
    });

    it("does not duplicate thread IDs", () => {
      addOpenThread("thread-123");
      addOpenThread("thread-123");
      addOpenThread("thread-123");

      expect(OPEN_MODMAIL_THREADS.size).toBe(1);
    });

    it("handles empty string", () => {
      addOpenThread("");
      expect(OPEN_MODMAIL_THREADS.has("")).toBe(true);
    });
  });

  describe("removeOpenThread", () => {
    it("removes a thread ID from the set", () => {
      OPEN_MODMAIL_THREADS.add("thread-123");
      expect(OPEN_MODMAIL_THREADS.has("thread-123")).toBe(true);

      removeOpenThread("thread-123");
      expect(OPEN_MODMAIL_THREADS.has("thread-123")).toBe(false);
    });

    it("handles removing non-existent thread", () => {
      // Should not throw
      removeOpenThread("non-existent");
      expect(OPEN_MODMAIL_THREADS.size).toBe(0);
    });

    it("only removes the specified thread", () => {
      addOpenThread("thread-1");
      addOpenThread("thread-2");
      addOpenThread("thread-3");

      removeOpenThread("thread-2");

      expect(OPEN_MODMAIL_THREADS.size).toBe(2);
      expect(OPEN_MODMAIL_THREADS.has("thread-1")).toBe(true);
      expect(OPEN_MODMAIL_THREADS.has("thread-2")).toBe(false);
      expect(OPEN_MODMAIL_THREADS.has("thread-3")).toBe(true);
    });
  });

  describe("isOpenModmailThread", () => {
    it("returns true for open threads", () => {
      OPEN_MODMAIL_THREADS.add("thread-123");
      expect(isOpenModmailThread("thread-123")).toBe(true);
    });

    it("returns false for non-existent threads", () => {
      expect(isOpenModmailThread("non-existent")).toBe(false);
    });

    it("returns false after removal", () => {
      addOpenThread("thread-123");
      expect(isOpenModmailThread("thread-123")).toBe(true);

      removeOpenThread("thread-123");
      expect(isOpenModmailThread("thread-123")).toBe(false);
    });

    it("handles empty string", () => {
      expect(isOpenModmailThread("")).toBe(false);
      addOpenThread("");
      expect(isOpenModmailThread("")).toBe(true);
    });
  });

  describe("hydrateOpenModmailThreadsOnStartup", () => {
    it("loads thread IDs from database", async () => {
      mockAll.mockReturnValue([
        { thread_id: "thread-1" },
        { thread_id: "thread-2" },
        { thread_id: "thread-3" },
      ]);

      const mockClient = {} as any;
      await hydrateOpenModmailThreadsOnStartup(mockClient);

      expect(OPEN_MODMAIL_THREADS.size).toBe(3);
      expect(OPEN_MODMAIL_THREADS.has("thread-1")).toBe(true);
      expect(OPEN_MODMAIL_THREADS.has("thread-2")).toBe(true);
      expect(OPEN_MODMAIL_THREADS.has("thread-3")).toBe(true);
    });

    it("handles empty database result", async () => {
      mockAll.mockReturnValue([]);

      const mockClient = {} as any;
      await hydrateOpenModmailThreadsOnStartup(mockClient);

      expect(OPEN_MODMAIL_THREADS.size).toBe(0);
    });

    it("queries correct SQL", async () => {
      mockAll.mockReturnValue([]);

      const mockClient = {} as any;
      await hydrateOpenModmailThreadsOnStartup(mockClient);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT thread_id FROM modmail_ticket")
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("status = 'open'")
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("thread_id IS NOT NULL")
      );
    });

    it("adds to existing threads", async () => {
      // Pre-populate
      addOpenThread("existing-thread");

      mockAll.mockReturnValue([{ thread_id: "new-thread" }]);

      const mockClient = {} as any;
      await hydrateOpenModmailThreadsOnStartup(mockClient);

      expect(OPEN_MODMAIL_THREADS.size).toBe(2);
      expect(OPEN_MODMAIL_THREADS.has("existing-thread")).toBe(true);
      expect(OPEN_MODMAIL_THREADS.has("new-thread")).toBe(true);
    });

    it("handles large number of threads", async () => {
      const threads = Array.from({ length: 1000 }, (_, i) => ({
        thread_id: `thread-${i}`,
      }));
      mockAll.mockReturnValue(threads);

      const mockClient = {} as any;
      await hydrateOpenModmailThreadsOnStartup(mockClient);

      expect(OPEN_MODMAIL_THREADS.size).toBe(1000);
    });
  });

  describe("integration scenarios", () => {
    it("handles full lifecycle: add, check, remove, check", () => {
      // Initially not present
      expect(isOpenModmailThread("thread-lifecycle")).toBe(false);

      // Add
      addOpenThread("thread-lifecycle");
      expect(isOpenModmailThread("thread-lifecycle")).toBe(true);

      // Remove
      removeOpenThread("thread-lifecycle");
      expect(isOpenModmailThread("thread-lifecycle")).toBe(false);
    });

    it("maintains separate thread tracking", () => {
      addOpenThread("thread-a");
      addOpenThread("thread-b");

      removeOpenThread("thread-a");

      expect(isOpenModmailThread("thread-a")).toBe(false);
      expect(isOpenModmailThread("thread-b")).toBe(true);
    });
  });
});
