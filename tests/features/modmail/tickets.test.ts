/**
 * Pawtropolis Tech — tests/features/modmail/tickets.test.ts
 * WHAT: Unit tests for modmail ticket CRUD operations.
 * WHY: Verify database operations work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockAll, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

vi.mock("../../../src/lib/syncMarker.js", () => ({
  touchSyncMarker: vi.fn(),
}));

import {
  createTicket,
  getOpenTicketByUser,
  getTicketByThread,
  getTicketById,
  findModmailTicketForApplication,
  updateTicketThread,
  closeTicket,
  reopenTicket,
  insertModmailMessage,
  getThreadIdForDmReply,
  getDmIdForThreadReply,
} from "../../../src/features/modmail/tickets.js";
import { touchSyncMarker } from "../../../src/lib/syncMarker.js";

describe("features/modmail/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe("createTicket", () => {
    it("creates a ticket with all parameters", () => {
      mockRun.mockReturnValue({ lastInsertRowid: BigInt(123) });

      const ticketId = createTicket({
        guildId: "guild-123",
        userId: "user-456",
        appCode: "ABC123",
        reviewMessageId: "msg-789",
        threadId: "thread-101",
      });

      expect(ticketId).toBe(123);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO modmail_ticket"));
      expect(mockRun).toHaveBeenCalledWith(
        "guild-123",
        "user-456",
        "ABC123",
        "msg-789",
        "thread-101"
      );
    });

    it("creates a ticket with minimal parameters", () => {
      mockRun.mockReturnValue({ lastInsertRowid: BigInt(456) });

      const ticketId = createTicket({
        guildId: "guild-123",
        userId: "user-456",
      });

      expect(ticketId).toBe(456);
      expect(mockRun).toHaveBeenCalledWith(
        "guild-123",
        "user-456",
        null,
        null,
        null
      );
    });

    it("touches sync marker", () => {
      mockRun.mockReturnValue({ lastInsertRowid: BigInt(1) });

      createTicket({ guildId: "g", userId: "u" });

      expect(touchSyncMarker).toHaveBeenCalledWith("modmail_ticket_create");
    });

    it("handles BigInt conversion correctly", () => {
      mockRun.mockReturnValue({ lastInsertRowid: BigInt(9007199254740991) });

      const ticketId = createTicket({ guildId: "g", userId: "u" });

      expect(typeof ticketId).toBe("number");
    });
  });

  describe("getOpenTicketByUser", () => {
    it("returns ticket when found", () => {
      const mockTicket = {
        id: 123,
        guild_id: "guild-123",
        user_id: "user-456",
        status: "open",
      };
      mockGet.mockReturnValue(mockTicket);

      const result = getOpenTicketByUser("guild-123", "user-456");

      expect(result).toEqual(mockTicket);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE guild_id = ? AND user_id = ? AND status = 'open'")
      );
      expect(mockGet).toHaveBeenCalledWith("guild-123", "user-456");
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getOpenTicketByUser("guild-123", "user-456");

      expect(result).toBeNull();
    });

    it("orders by created_at DESC", () => {
      mockGet.mockReturnValue(undefined);

      getOpenTicketByUser("guild-123", "user-456");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY created_at DESC")
      );
    });

    it("limits to 1 result", () => {
      mockGet.mockReturnValue(undefined);

      getOpenTicketByUser("guild-123", "user-456");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT 1")
      );
    });
  });

  describe("getTicketByThread", () => {
    it("returns ticket when found", () => {
      const mockTicket = {
        id: 123,
        thread_id: "thread-123",
        status: "open",
      };
      mockGet.mockReturnValue(mockTicket);

      const result = getTicketByThread("thread-123");

      expect(result).toEqual(mockTicket);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE thread_id = ?")
      );
      expect(mockGet).toHaveBeenCalledWith("thread-123");
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getTicketByThread("thread-123");

      expect(result).toBeNull();
    });

    it("returns both open and closed tickets", () => {
      const closedTicket = { id: 123, thread_id: "thread-123", status: "closed" };
      mockGet.mockReturnValue(closedTicket);

      const result = getTicketByThread("thread-123");

      expect(result?.status).toBe("closed");
    });
  });

  describe("getTicketById", () => {
    it("returns ticket when found", () => {
      const mockTicket = { id: 123, status: "open" };
      mockGet.mockReturnValue(mockTicket);

      const result = getTicketById(123);

      expect(result).toEqual(mockTicket);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = ?")
      );
      expect(mockGet).toHaveBeenCalledWith(123);
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getTicketById(999);

      expect(result).toBeNull();
    });
  });

  describe("findModmailTicketForApplication", () => {
    it("returns ticket when found", () => {
      const mockTicket = {
        id: 123,
        guild_id: "guild-123",
        app_code: "ABC123",
      };
      mockGet.mockReturnValue(mockTicket);

      const result = findModmailTicketForApplication("guild-123", "ABC123");

      expect(result).toEqual(mockTicket);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE guild_id = ? AND app_code = ?")
      );
      expect(mockGet).toHaveBeenCalledWith("guild-123", "ABC123");
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = findModmailTicketForApplication("guild-123", "ABC123");

      expect(result).toBeNull();
    });

    it("orders by id DESC", () => {
      mockGet.mockReturnValue(undefined);

      findModmailTicketForApplication("guild-123", "ABC123");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY id DESC")
      );
    });
  });

  describe("updateTicketThread", () => {
    it("updates the thread_id", () => {
      updateTicketThread(123, "new-thread-id");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE modmail_ticket SET thread_id = ? WHERE id = ?")
      );
      expect(mockRun).toHaveBeenCalledWith("new-thread-id", 123);
    });
  });

  describe("closeTicket", () => {
    it("marks ticket as closed with timestamp", () => {
      closeTicket(123);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE modmail_ticket SET status = 'closed'")
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("closed_at = datetime('now')")
      );
      expect(mockRun).toHaveBeenCalledWith(123);
    });
  });

  describe("reopenTicket", () => {
    it("marks ticket as open and clears closed_at", () => {
      reopenTicket(123);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE modmail_ticket SET status = 'open'")
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("closed_at = NULL")
      );
      expect(mockRun).toHaveBeenCalledWith(123);
    });
  });

  describe("insertModmailMessage", () => {
    it("inserts a message with all fields", () => {
      insertModmailMessage({
        ticketId: 123,
        direction: "to_user",
        threadMessageId: "thread-msg-1",
        dmMessageId: "dm-msg-1",
        replyToThreadMessageId: "reply-thread-1",
        replyToDmMessageId: "reply-dm-1",
        content: "Test message content",
      });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO modmail_message")
      );
      expect(mockRun).toHaveBeenCalledWith({
        ticketId: 123,
        direction: "to_user",
        threadMessageId: "thread-msg-1",
        dmMessageId: "dm-msg-1",
        replyToThreadMessageId: "reply-thread-1",
        replyToDmMessageId: "reply-dm-1",
        content: "Test message content",
      });
    });

    it("handles to_staff direction", () => {
      insertModmailMessage({
        ticketId: 123,
        direction: "to_staff",
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "to_staff" })
      );
    });

    it("uses ON CONFLICT for idempotent inserts", () => {
      insertModmailMessage({ ticketId: 1, direction: "to_user" });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT(thread_message_id) DO UPDATE")
      );
    });
  });

  describe("getThreadIdForDmReply", () => {
    it("returns thread_message_id when found", () => {
      mockGet.mockReturnValue({ thread_message_id: "thread-msg-123" });

      const result = getThreadIdForDmReply("dm-msg-456");

      expect(result).toBe("thread-msg-123");
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE dm_message_id = ?")
      );
      expect(mockGet).toHaveBeenCalledWith("dm-msg-456");
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getThreadIdForDmReply("dm-msg-456");

      expect(result).toBeNull();
    });

    it("returns null when thread_message_id is null", () => {
      mockGet.mockReturnValue({ thread_message_id: null });

      const result = getThreadIdForDmReply("dm-msg-456");

      expect(result).toBeNull();
    });
  });

  describe("getDmIdForThreadReply", () => {
    it("returns dm_message_id when found", () => {
      mockGet.mockReturnValue({ dm_message_id: "dm-msg-123" });

      const result = getDmIdForThreadReply("thread-msg-456");

      expect(result).toBe("dm-msg-123");
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE thread_message_id = ?")
      );
      expect(mockGet).toHaveBeenCalledWith("thread-msg-456");
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getDmIdForThreadReply("thread-msg-456");

      expect(result).toBeNull();
    });

    it("returns null when dm_message_id is null", () => {
      mockGet.mockReturnValue({ dm_message_id: null });

      const result = getDmIdForThreadReply("thread-msg-456");

      expect(result).toBeNull();
    });
  });

  describe("SQL query structure", () => {
    it("selects all required fields for tickets", () => {
      getOpenTicketByUser("g", "u");

      const expectedFields = [
        "id",
        "guild_id",
        "user_id",
        "app_code",
        "review_message_id",
        "thread_id",
        "thread_channel_id",
        "status",
        "created_at",
        "closed_at",
      ];

      const callArg = mockPrepare.mock.calls[0][0];
      for (const field of expectedFields) {
        expect(callArg).toContain(field);
      }
    });
  });
});
