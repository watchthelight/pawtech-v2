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

// Mock db to avoid database initialization - use hoisted mocks
const { mockDbGet, mockDbRun, mockDbAll, mockDbPrepare } = vi.hoisted(() => ({
  mockDbGet: vi.fn(),
  mockDbRun: vi.fn(),
  mockDbAll: vi.fn(),
  mockDbPrepare: vi.fn(),
}));

mockDbPrepare.mockReturnValue({
  get: mockDbGet,
  run: mockDbRun,
  all: mockDbAll,
});

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: mockDbPrepare },
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

// Mock reqctx
vi.mock("../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

// Mock constants
vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

// Import after mocks are set up
import {
  markForwarded,
  isForwarded,
  _testing,
  buildStaffToUserEmbed,
  buildUserToStaffEmbed,
  routeThreadToDm,
  routeDmToThread,
  handleInboundDmForModmail,
  handleInboundThreadMessageForModmail,
} from "../../../src/features/modmail/routing.js";
import { getTicketByThread } from "../../../src/features/modmail/tickets.js";

const mockGetTicketByThread = getTicketByThread as ReturnType<typeof vi.fn>;

// ===== Size-Based Eviction Tests =====

/*
 * forwardedMessages is a Map that tracks which messages we've already forwarded
 * from DMs to mod threads (and vice versa). Without size limits, a busy server
 * could grow this Map forever until the bot OOMs. The eviction tests verify we
 * don't let that happen.
 */
describe("forwardedMessages size-based eviction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish db mock after clearAllMocks
    mockDbPrepare.mockReturnValue({
      get: mockDbGet,
      run: mockDbRun,
      all: mockDbAll,
    });
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

  // The eviction strategy is "delete oldest half when we hit the limit".
  // This is simpler and faster than true LRU for our use case since we don't
  // need to track access order, just insertion order (which Map gives us free).
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

  // Raid scenario: server gets hit with hundreds of DMs at once.
  // The eviction logic should kick in repeatedly and keep memory bounded.
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

// These tests exist because we got bitten by slow eviction in prod once.
// The old implementation used Array.from() which is O(n) for large Maps.
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

  // WHY 100ms: CI machines are slow and inconsistent. We originally had 50ms
  // but it flaked on GitHub Actions under load. 100ms is still fast enough
  // to not cause noticeable lag during message handling.
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

    // Eviction should take less than 100ms (relaxed for CI variability)
    expect(duration).toBeLessThan(100);
  });
});

// ===== Embed Builder Tests =====

describe("buildStaffToUserEmbed", () => {
  it("creates embed with correct color", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "Hello",
    });

    expect(embed.data.color).toBe(0x2b2d31);
  });

  it("sets description from content", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "Test message",
    });

    expect(embed.data.description).toBe("Test message");
  });

  it("uses space for empty content", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "",
    });

    expect(embed.data.description).toBe(" ");
  });

  it("sets footer with guild name", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "Hello",
      guildName: "Test Server",
      guildIconUrl: "https://cdn.example.com/icon.png",
    });

    expect(embed.data.footer?.text).toBe("Test Server");
    expect(embed.data.footer?.icon_url).toBe("https://cdn.example.com/icon.png");
  });

  it("uses default guild name if not provided", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "Hello",
    });

    expect(embed.data.footer?.text).toBe("Pawtropolis Tech");
  });

  it("sets image when provided", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "Hello",
      imageUrl: "https://example.com/image.png",
    });

    expect(embed.data.image?.url).toBe("https://example.com/image.png");
  });

  it("has timestamp", () => {
    const embed = buildStaffToUserEmbed({
      staffDisplayName: "Mod",
      content: "Hello",
    });

    expect(embed.data.timestamp).toBeDefined();
  });
});

describe("buildUserToStaffEmbed", () => {
  it("creates embed with correct color", () => {
    const embed = buildUserToStaffEmbed({
      userDisplayName: "User",
      content: "Hello",
    });

    expect(embed.data.color).toBe(0x5865f2);
  });

  it("sets description from content", () => {
    const embed = buildUserToStaffEmbed({
      userDisplayName: "User",
      content: "Test message",
    });

    expect(embed.data.description).toBe("Test message");
  });

  it("uses space for empty content", () => {
    const embed = buildUserToStaffEmbed({
      userDisplayName: "User",
      content: "",
    });

    expect(embed.data.description).toBe(" ");
  });

  it("sets footer with user name", () => {
    const embed = buildUserToStaffEmbed({
      userDisplayName: "TestUser",
      userAvatarUrl: "https://cdn.example.com/avatar.png",
      content: "Hello",
    });

    expect(embed.data.footer?.text).toBe("TestUser");
    expect(embed.data.footer?.icon_url).toBe("https://cdn.example.com/avatar.png");
  });

  it("sets image when provided", () => {
    const embed = buildUserToStaffEmbed({
      userDisplayName: "User",
      content: "Hello",
      imageUrl: "https://example.com/image.png",
    });

    expect(embed.data.image?.url).toBe("https://example.com/image.png");
  });

  it("has timestamp", () => {
    const embed = buildUserToStaffEmbed({
      userDisplayName: "User",
      content: "Hello",
    });

    expect(embed.data.timestamp).toBeDefined();
  });
});

// ===== Message Routing Tests =====

describe("routeThreadToDm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish db mock after clearAllMocks
    mockDbPrepare.mockReturnValue({
      get: mockDbGet,
      run: mockDbRun,
      all: mockDbAll,
    });
    _testing.clearForwardedMessages();
  });

  it("skips bot messages", async () => {
    const message = {
      author: { bot: true },
      id: "msg-123",
    } as any;

    const ticket = { id: 1, user_id: "user-456" } as any;
    const client = {} as any;

    await routeThreadToDm(message, ticket, client);

    // Should return early without processing
  });

  it("skips already forwarded messages", async () => {
    markForwarded("msg-123");

    const message = {
      author: { bot: false },
      id: "msg-123",
    } as any;

    const ticket = { id: 1, user_id: "user-456" } as any;
    const client = {} as any;

    await routeThreadToDm(message, ticket, client);

    // Should return early
  });

  it("skips empty messages", async () => {
    const message = {
      author: { bot: false },
      id: "msg-123",
      content: "",
      attachments: { size: 0 },
    } as any;

    const ticket = { id: 1, user_id: "user-456" } as any;
    const client = {} as any;

    await routeThreadToDm(message, ticket, client);

    // Should return early
  });

  it("sends embed to user DM", async () => {
    const mockUserSend = vi.fn().mockResolvedValue({ id: "dm-msg-123" });
    const mockMemberFetch = vi.fn().mockResolvedValue({
      displayName: "Mod Name",
      user: { globalName: "Mod", username: "mod" },
      displayAvatarURL: vi.fn().mockReturnValue("https://avatar.url"),
    });

    const message = {
      author: { bot: false, id: "staff-1", globalName: "Staff", username: "staff" },
      id: "msg-123",
      content: "Hello user",
      attachments: new Map(),
      guild: {
        name: "Test Guild",
        iconURL: vi.fn().mockReturnValue("https://icon.url"),
        members: { fetch: mockMemberFetch },
      },
      reference: null,
    } as any;

    const ticket = { id: 1, user_id: "user-456" } as any;
    const client = {
      users: { fetch: vi.fn().mockResolvedValue({ send: mockUserSend }) },
    } as any;

    await routeThreadToDm(message, ticket, client);

    expect(mockUserSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it("handles user DM failure", async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const mockMemberFetch = vi.fn().mockResolvedValue({
      displayName: "Mod",
      user: {},
      displayAvatarURL: vi.fn().mockReturnValue(null),
    });

    const message = {
      author: { bot: false, id: "staff-1", globalName: null, username: "staff" },
      id: "msg-123",
      content: "Hello",
      attachments: new Map(),
      guild: {
        name: "Test",
        iconURL: vi.fn().mockReturnValue(null),
        members: { fetch: mockMemberFetch },
      },
      reference: null,
      reply: mockReply,
    } as any;

    const ticket = { id: 1, user_id: "user-456" } as any;
    const client = {
      users: {
        fetch: vi.fn().mockResolvedValue({
          send: vi.fn().mockRejectedValue(new Error("DMs closed")),
        }),
      },
    } as any;

    await routeThreadToDm(message, ticket, client);

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Failed to deliver"),
      })
    );
  });
});

describe("routeDmToThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish db mock after clearAllMocks
    mockDbPrepare.mockReturnValue({
      get: mockDbGet,
      run: mockDbRun,
      all: mockDbAll,
    });
    _testing.clearForwardedMessages();
  });

  it("skips bot messages", async () => {
    const message = { author: { bot: true } } as any;
    const ticket = { id: 1, thread_id: "thread-123" } as any;
    const client = {} as any;

    await routeDmToThread(message, ticket, client);
  });

  it("skips already forwarded messages", async () => {
    markForwarded("msg-123");

    const message = { author: { bot: false }, id: "msg-123" } as any;
    const ticket = { id: 1, thread_id: "thread-123" } as any;
    const client = {} as any;

    await routeDmToThread(message, ticket, client);
  });

  it("skips when thread_id is null", async () => {
    const message = {
      author: { bot: false },
      id: "msg-123",
      content: "Hello",
      attachments: { size: 0 },
    } as any;

    const ticket = { id: 1, thread_id: null } as any;
    const client = {} as any;

    await routeDmToThread(message, ticket, client);

    // Should return early with warning logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 1 }),
      expect.stringContaining("no thread_id")
    );
  });

  it("skips empty messages", async () => {
    const message = {
      author: { bot: false },
      id: "msg-123",
      content: "",
      attachments: { size: 0 },
    } as any;

    const ticket = { id: 1, thread_id: "thread-123" } as any;
    const client = {} as any;

    await routeDmToThread(message, ticket, client);
  });

  it("sends embed to thread", async () => {
    const mockThreadSend = vi.fn().mockResolvedValue({ id: "thread-msg-123" });

    const message = {
      author: {
        bot: false,
        id: "user-123",
        globalName: "User",
        username: "user",
        displayAvatarURL: vi.fn().mockReturnValue("https://avatar.url"),
      },
      id: "dm-msg-123",
      content: "Hello staff",
      attachments: new Map(),
      reference: null,
    } as any;

    const ticket = { id: 1, thread_id: "thread-123" } as any;
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          send: mockThreadSend,
        }),
      },
    } as any;

    await routeDmToThread(message, ticket, client);

    expect(mockThreadSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it("handles thread not found", async () => {
    const message = {
      author: { bot: false },
      id: "dm-msg-123",
      content: "Hello",
      attachments: { size: 0 },
    } as any;

    const ticket = { id: 1, thread_id: "thread-123" } as any;
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue(null),
      },
    } as any;

    await routeDmToThread(message, ticket, client);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-123" }),
      expect.stringContaining("thread not found")
    );
  });
});

describe("handleInboundDmForModmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish db mock after clearAllMocks
    mockDbPrepare.mockReturnValue({
      get: mockDbGet,
      run: mockDbRun,
      all: mockDbAll,
    });
  });

  it("skips bot messages", async () => {
    const message = { author: { bot: true } } as any;
    const client = {} as any;

    await handleInboundDmForModmail(message, client);
  });

  it("does nothing when no open ticket exists", async () => {
    // Mock db.prepare to return undefined for open ticket query
    mockDbGet.mockReturnValue(undefined);

    const message = {
      author: { bot: false, id: "user-123" },
    } as any;
    const client = {} as any;

    await handleInboundDmForModmail(message, client);
  });
});

describe("handleInboundThreadMessageForModmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish db mock after clearAllMocks
    mockDbPrepare.mockReturnValue({
      get: mockDbGet,
      run: mockDbRun,
      all: mockDbAll,
    });
  });

  it("skips bot messages", async () => {
    const message = { author: { bot: true } } as any;
    const client = {} as any;

    await handleInboundThreadMessageForModmail(message, client);
  });

  it("skips non-thread channels", async () => {
    const message = {
      author: { bot: false },
      channel: { isThread: () => false },
    } as any;
    const client = {} as any;

    await handleInboundThreadMessageForModmail(message, client);
  });

  it("skips messages without guildId", async () => {
    const message = {
      author: { bot: false },
      channel: { isThread: () => true },
      guildId: null,
    } as any;
    const client = {} as any;

    await handleInboundThreadMessageForModmail(message, client);
  });

  it("routes message when open ticket exists", async () => {
    mockGetTicketByThread.mockReturnValue({
      id: 1,
      status: "open",
      user_id: "user-123",
      thread_id: "thread-123",
    });

    const message = {
      author: { bot: false, id: "staff-1" },
      id: "msg-123",
      content: "",
      attachments: { size: 0 },
      channel: { isThread: () => true, id: "thread-123" },
      guildId: "guild-123",
    } as any;
    const client = {} as any;

    await handleInboundThreadMessageForModmail(message, client);

    expect(mockGetTicketByThread).toHaveBeenCalledWith("thread-123");
  });

  it("skips closed tickets", async () => {
    mockGetTicketByThread.mockReturnValue({
      id: 1,
      status: "closed",
      user_id: "user-123",
    });

    const message = {
      author: { bot: false },
      channel: { isThread: () => true, id: "thread-123" },
      guildId: "guild-123",
    } as any;
    const client = {} as any;

    await handleInboundThreadMessageForModmail(message, client);
  });
});
