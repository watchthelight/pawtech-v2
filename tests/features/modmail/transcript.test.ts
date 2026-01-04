/**
 * Pawtropolis Tech — tests/features/modmail/transcript.test.ts
 * WHAT: Unit tests for modmail transcript buffering and persistence.
 * WHY: Verify transcript operations work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("../../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => ({
    modmail_log_channel_id: "log-channel-123",
  })),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

import {
  appendTranscript,
  getTranscriptBuffer,
  clearTranscriptBuffer,
  formatTranscript,
  formatContentWithAttachments,
  flushTranscript,
} from "../../../src/features/modmail/transcript.js";

describe("features/modmail/transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  afterEach(() => {
    // Clear all transcript buffers between tests
    clearTranscriptBuffer(1);
    clearTranscriptBuffer(2);
    clearTranscriptBuffer(123);
    clearTranscriptBuffer(456);
  });

  describe("appendTranscript", () => {
    it("creates a new buffer for new ticket", () => {
      appendTranscript(1, "STAFF", "Hello");

      const buffer = getTranscriptBuffer(1);
      expect(buffer).toBeDefined();
      expect(buffer).toHaveLength(1);
    });

    it("appends to existing buffer", () => {
      appendTranscript(1, "STAFF", "Hello");
      appendTranscript(1, "USER", "Hi there");
      appendTranscript(1, "STAFF", "How can I help?");

      const buffer = getTranscriptBuffer(1);
      expect(buffer).toHaveLength(3);
    });

    it("records timestamp", () => {
      const before = new Date().toISOString();
      appendTranscript(1, "STAFF", "Test");
      const after = new Date().toISOString();

      const buffer = getTranscriptBuffer(1);
      expect(buffer![0].timestamp >= before).toBe(true);
      expect(buffer![0].timestamp <= after).toBe(true);
    });

    it("records author correctly", () => {
      appendTranscript(1, "STAFF", "Staff message");
      appendTranscript(1, "USER", "User message");

      const buffer = getTranscriptBuffer(1);
      expect(buffer![0].author).toBe("STAFF");
      expect(buffer![1].author).toBe("USER");
    });

    it("records content", () => {
      appendTranscript(1, "STAFF", "Test content here");

      const buffer = getTranscriptBuffer(1);
      expect(buffer![0].content).toBe("Test content here");
    });

    it("handles empty content", () => {
      appendTranscript(1, "STAFF", "");

      const buffer = getTranscriptBuffer(1);
      expect(buffer![0].content).toBe("");
    });

    it("handles multiple tickets independently", () => {
      appendTranscript(1, "STAFF", "Ticket 1 message");
      appendTranscript(2, "USER", "Ticket 2 message");

      expect(getTranscriptBuffer(1)![0].content).toBe("Ticket 1 message");
      expect(getTranscriptBuffer(2)![0].content).toBe("Ticket 2 message");
    });
  });

  describe("getTranscriptBuffer", () => {
    it("returns undefined for non-existent ticket", () => {
      const buffer = getTranscriptBuffer(999);
      expect(buffer).toBeUndefined();
    });

    it("returns buffer for existing ticket", () => {
      appendTranscript(1, "STAFF", "Test");

      const buffer = getTranscriptBuffer(1);
      expect(buffer).toBeDefined();
    });
  });

  describe("clearTranscriptBuffer", () => {
    it("removes buffer for ticket", () => {
      appendTranscript(1, "STAFF", "Test");
      expect(getTranscriptBuffer(1)).toBeDefined();

      clearTranscriptBuffer(1);
      expect(getTranscriptBuffer(1)).toBeUndefined();
    });

    it("handles clearing non-existent buffer", () => {
      // Should not throw
      clearTranscriptBuffer(999);
    });

    it("only clears specified ticket", () => {
      appendTranscript(1, "STAFF", "Ticket 1");
      appendTranscript(2, "STAFF", "Ticket 2");

      clearTranscriptBuffer(1);

      expect(getTranscriptBuffer(1)).toBeUndefined();
      expect(getTranscriptBuffer(2)).toBeDefined();
    });
  });

  describe("formatTranscript", () => {
    it("formats single line correctly", () => {
      const lines = [
        {
          timestamp: "2025-01-01T12:00:00.000Z",
          author: "STAFF" as const,
          content: "Hello",
        },
      ];

      const result = formatTranscript(lines);

      expect(result).toBe("[2025-01-01T12:00:00.000Z] STAFF: Hello");
    });

    it("formats multiple lines with newlines", () => {
      const lines = [
        { timestamp: "2025-01-01T12:00:00.000Z", author: "STAFF" as const, content: "Hi" },
        { timestamp: "2025-01-01T12:01:00.000Z", author: "USER" as const, content: "Hello" },
      ];

      const result = formatTranscript(lines);

      expect(result).toBe(
        "[2025-01-01T12:00:00.000Z] STAFF: Hi\n[2025-01-01T12:01:00.000Z] USER: Hello"
      );
    });

    it("handles empty array", () => {
      const result = formatTranscript([]);
      expect(result).toBe("");
    });

    it("handles multiline content", () => {
      const lines = [
        {
          timestamp: "2025-01-01T12:00:00.000Z",
          author: "STAFF" as const,
          content: "Line 1\nLine 2\nLine 3",
        },
      ];

      const result = formatTranscript(lines);

      expect(result).toContain("Line 1\nLine 2\nLine 3");
    });

    it("preserves special characters", () => {
      const lines = [
        {
          timestamp: "2025-01-01T12:00:00.000Z",
          author: "USER" as const,
          content: "Special chars: @#$%^&*()",
        },
      ];

      const result = formatTranscript(lines);

      expect(result).toContain("@#$%^&*()");
    });
  });

  describe("formatContentWithAttachments", () => {
    it("returns content when no attachments", () => {
      const result = formatContentWithAttachments("Hello", undefined);
      expect(result).toBe("Hello");
    });

    it("returns content when empty attachments", () => {
      const emptyMap = new Map();
      const result = formatContentWithAttachments("Hello", emptyMap);
      expect(result).toBe("Hello");
    });

    it("appends attachment URLs to content", () => {
      const attachments = new Map([
        ["1", { url: "https://example.com/image.png", contentType: "image/png" }],
      ]) as any;

      const result = formatContentWithAttachments("Message", attachments);

      expect(result).toContain("Message");
      expect(result).toContain("https://example.com/image.png");
      expect(result).toContain("[image/png]");
    });

    it("handles multiple attachments", () => {
      const attachments = new Map([
        ["1", { url: "https://example.com/1.png", contentType: "image/png" }],
        ["2", { url: "https://example.com/2.pdf", contentType: "application/pdf" }],
      ]) as any;

      const result = formatContentWithAttachments("", attachments);

      expect(result).toContain("https://example.com/1.png");
      expect(result).toContain("https://example.com/2.pdf");
    });

    it("handles attachment without contentType", () => {
      const attachments = new Map([
        ["1", { url: "https://example.com/file", contentType: undefined }],
      ]) as any;

      const result = formatContentWithAttachments("", attachments);

      expect(result).toContain("[file]");
      expect(result).toContain("https://example.com/file");
    });

    it("returns (empty message) for no content and no attachments", () => {
      const result = formatContentWithAttachments("", undefined);
      expect(result).toBe("(empty message)");
    });

    it("separates content and attachments with newline", () => {
      const attachments = new Map([
        ["1", { url: "https://example.com/file", contentType: "text/plain" }],
      ]) as any;

      const result = formatContentWithAttachments("Text content", attachments);

      expect(result).toBe("Text content\n[text/plain] https://example.com/file");
    });
  });

  describe("flushTranscript", () => {
    it("returns early when no log channel configured", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: null });

      const mockClient = {} as any;

      const result = await flushTranscript({
        client: mockClient,
        ticketId: 123,
        guildId: "guild-123",
        userId: "user-456",
        appCode: "ABC123",
      });

      expect(result).toEqual({ messageId: null, lineCount: 0 });
    });

    it("handles non-text log channel", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({ isTextBased: () => false }),
        },
        guilds: {
          fetch: vi.fn().mockResolvedValue({}),
        },
      } as any;

      const result = await flushTranscript({
        client: mockClient,
        ticketId: 123,
        guildId: "guild-123",
        userId: "user-456",
      });

      expect(result).toEqual({ messageId: null, lineCount: 0 });
    });

    it("posts empty log when no transcript lines", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      mockAll.mockReturnValue([]);

      const mockSend = vi.fn().mockResolvedValue({ id: "msg-123" });
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            send: mockSend,
          }),
        },
      } as any;

      const result = await flushTranscript({
        client: mockClient,
        ticketId: 123,
        guildId: "guild-123",
        userId: "user-456",
      });

      expect(result.messageId).toBe("msg-123");
      expect(result.lineCount).toBe(0);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("No transcript content"),
        })
      );
    });

    it("flushes transcript with lines to log channel", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      // Pre-populate buffer
      appendTranscript(456, "STAFF", "Hello");
      appendTranscript(456, "USER", "Hi");

      const mockSend = vi.fn().mockResolvedValue({ id: "msg-456" });
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            send: mockSend,
          }),
        },
      } as any;

      const result = await flushTranscript({
        client: mockClient,
        ticketId: 456,
        guildId: "guild-123",
        userId: "user-456",
        appCode: "XYZ789",
      });

      expect(result.messageId).toBe("msg-456");
      expect(result.lineCount).toBe(2);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          files: expect.any(Array),
        })
      );
    });

    it("clears buffer after successful flush", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      appendTranscript(123, "STAFF", "Test");

      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            send: vi.fn().mockResolvedValue({ id: "msg" }),
          }),
        },
      } as any;

      await flushTranscript({
        client: mockClient,
        ticketId: 123,
        guildId: "guild-123",
        userId: "user-456",
      });

      expect(getTranscriptBuffer(123)).toBeUndefined();
    });

    it("reconstructs transcript from database when buffer is empty", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      mockAll.mockReturnValue([
        { direction: "to_user", content: "DB message 1", created_at: "2025-01-01T00:00:00Z" },
        { direction: "to_staff", content: "DB message 2", created_at: "2025-01-01T00:01:00Z" },
      ]);

      const mockSend = vi.fn().mockResolvedValue({ id: "msg-789" });
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            send: mockSend,
          }),
        },
      } as any;

      const result = await flushTranscript({
        client: mockClient,
        ticketId: 789,
        guildId: "guild-123",
        userId: "user-456",
      });

      expect(result.lineCount).toBe(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT direction, content, created_at")
      );
    });

    it("handles channel fetch error gracefully", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      appendTranscript(123, "STAFF", "Test");

      const mockClient = {
        channels: {
          fetch: vi.fn().mockRejectedValue(new Error("Channel not found")),
        },
        guilds: {
          fetch: vi.fn().mockResolvedValue({}),
        },
      } as any;

      const result = await flushTranscript({
        client: mockClient,
        ticketId: 123,
        guildId: "guild-123",
        userId: "user-456",
      });

      expect(result.messageId).toBeNull();
    });
  });

  describe("transcript file format", () => {
    it("creates filename with app code when available", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      appendTranscript(123, "STAFF", "Test");

      let capturedFiles: any[] = [];
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            send: vi.fn().mockImplementation((opts) => {
              capturedFiles = opts.files;
              return Promise.resolve({ id: "msg" });
            }),
          }),
        },
      } as any;

      await flushTranscript({
        client: mockClient,
        ticketId: 123,
        guildId: "guild-123",
        userId: "user-456",
        appCode: "TESTCODE",
      });

      expect(capturedFiles[0].name).toContain("TESTCODE");
    });

    it("creates filename with ticket ID as fallback", async () => {
      const { getConfig } = await import("../../../src/lib/config.js");
      (getConfig as any).mockReturnValue({ modmail_log_channel_id: "log-123" });

      appendTranscript(999, "STAFF", "Test");

      let capturedFiles: any[] = [];
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            send: vi.fn().mockImplementation((opts) => {
              capturedFiles = opts.files;
              return Promise.resolve({ id: "msg" });
            }),
          }),
        },
      } as any;

      await flushTranscript({
        client: mockClient,
        ticketId: 999,
        guildId: "guild-123",
        userId: "user-456",
        appCode: null,
      });

      expect(capturedFiles[0].name).toContain("999");
    });
  });
});
