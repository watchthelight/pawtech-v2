/**
 * Pawtropolis Tech — tests/features/modmail/threadReopen.test.ts
 * WHAT: Unit tests for modmail thread reopening module.
 * WHY: Verify thread reopening logic and 7-day limit.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for ALL mock functions
const {
  mockGet,
  mockRun,
  mockPrepare,
  mockTransaction,
  mockGetTicketByThread,
  mockReopenTicket,
  mockAddOpenThread,
  mockOpenPublicModmailThreadFor,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: Function) => fn()),
  mockGetTicketByThread: vi.fn(),
  mockReopenTicket: vi.fn(),
  mockAddOpenThread: vi.fn(),
  mockOpenPublicModmailThreadFor: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  run: mockRun,
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

vi.mock("../../../src/features/modmail/tickets.js", () => ({
  getTicketByThread: mockGetTicketByThread,
  reopenTicket: mockReopenTicket,
}));

vi.mock("../../../src/features/modmail/threadState.js", () => ({
  addOpenThread: mockAddOpenThread,
}));

vi.mock("../../../src/features/modmail/threadOpen.js", () => ({
  openPublicModmailThreadFor: mockOpenPublicModmailThreadFor,
}));

import { reopenModmailThread } from "../../../src/features/modmail/threadReopen.js";

describe("features/modmail/threadReopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
    });
  });

  describe("reopenModmailThread", () => {
    describe("ticket lookup", () => {
      it("looks up by userId when provided", async () => {
        mockGet.mockReturnValue(null);

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        await reopenModmailThread({
          interaction,
          userId: "user-456",
        });

        expect(mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining("WHERE guild_id = ? AND user_id = ? AND status = 'closed'")
        );
        expect(mockGet).toHaveBeenCalledWith("guild-123", "user-456");
      });

      it("looks up by threadId when provided", async () => {
        mockGetTicketByThread.mockReturnValue(null);

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        await reopenModmailThread({
          interaction,
          threadId: "thread-789",
        });

        expect(mockGetTicketByThread).toHaveBeenCalledWith("thread-789");
      });

      it("uses current channel if in thread and no ID provided", async () => {
        mockGetTicketByThread.mockReturnValue(null);

        const interaction = {
          guildId: "guild-123",
          channel: {
            isThread: () => true,
            id: "current-thread",
          },
        } as any;

        await reopenModmailThread({ interaction });

        expect(mockGetTicketByThread).toHaveBeenCalledWith("current-thread");
      });
    });

    describe("ticket status checks", () => {
      it("rejects when no ticket found", async () => {
        mockGet.mockReturnValue(undefined);
        mockGetTicketByThread.mockReturnValue(null);

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        const result = await reopenModmailThread({
          interaction,
          userId: "user-456",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("No closed modmail ticket found.");
      });

      it("rejects when ticket is already open", async () => {
        mockGetTicketByThread.mockReturnValue({
          id: 123,
          status: "open",
          user_id: "user-456",
        });

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        const result = await reopenModmailThread({
          interaction,
          threadId: "thread-789",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("This ticket is already open.");
      });
    });

    describe("7-day limit", () => {
      it("creates new thread when closed over 7 days ago", async () => {
        const now = Date.now();
        const closedAt = new Date(now - 8 * 24 * 60 * 60 * 1000); // 8 days ago

        mockGetTicketByThread.mockReturnValue({
          id: 123,
          status: "closed",
          user_id: "user-456",
          thread_id: "thread-789",
          app_code: "ABC123",
          review_message_id: "review-msg",
          closed_at: closedAt.toISOString(),
        });

        mockOpenPublicModmailThreadFor.mockResolvedValue({
          success: true,
          message: "New thread created",
        });

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        const result = await reopenModmailThread({
          interaction,
          threadId: "thread-789",
        });

        expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith({
          interaction,
          userId: "user-456",
          appCode: "ABC123",
          reviewMessageId: "review-msg",
        });
        expect(result.success).toBe(true);
        expect(result.message).toBe("New thread created");
      });

      it("handles missing closed_at (treats as very old)", async () => {
        mockGetTicketByThread.mockReturnValue({
          id: 123,
          status: "closed",
          user_id: "user-456",
          thread_id: "thread-789",
          closed_at: null,
        });

        mockOpenPublicModmailThreadFor.mockResolvedValue({
          success: true,
          message: "New thread",
        });

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        await reopenModmailThread({
          interaction,
          threadId: "thread-789",
        });

        expect(mockOpenPublicModmailThreadFor).toHaveBeenCalled();
      });

      it("handles ticket closed exactly 7 days ago (creates new)", async () => {
        const now = Date.now();
        const closedAt = new Date(now - 7 * 24 * 60 * 60 * 1000 - 1000); // Just over 7 days

        mockGetTicketByThread.mockReturnValue({
          id: 123,
          status: "closed",
          user_id: "user-456",
          thread_id: "thread-789",
          closed_at: closedAt.toISOString(),
        });

        mockOpenPublicModmailThreadFor.mockResolvedValue({
          success: true,
          message: "New thread",
        });

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        await reopenModmailThread({
          interaction,
          threadId: "thread-789",
        });

        expect(mockOpenPublicModmailThreadFor).toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("handles unexpected errors", async () => {
        const closedAt = new Date(Date.now() - 1000);

        mockGetTicketByThread.mockReturnValue({
          id: 123,
          status: "closed",
          user_id: "user-456",
          thread_id: "thread-789",
          closed_at: closedAt.toISOString(),
        });

        mockTransaction.mockImplementation(() => {
          throw new Error("DB error");
        });

        const interaction = {
          guildId: "guild-123",
          channel: { isThread: () => false },
        } as any;

        const result = await reopenModmailThread({
          interaction,
          threadId: "thread-789",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("Failed to reopen");
      });
    });
  });
});
