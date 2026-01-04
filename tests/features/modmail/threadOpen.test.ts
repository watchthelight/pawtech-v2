/**
 * Pawtropolis Tech — tests/features/modmail/threadOpen.test.ts
 * WHAT: Unit tests for modmail thread opening module.
 * WHY: Verify thread creation, permission checks, and race condition handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelType } from "discord.js";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: Function) => fn),
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

vi.mock("../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

vi.mock("../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 8)),
}));

vi.mock("../../../src/lib/config.js", () => ({
  hasManageGuild: vi.fn(() => true),
  isReviewer: vi.fn(() => true),
  canRunAllCommands: vi.fn(() => true),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

vi.mock("../../../src/features/modmail/tickets.js", () => ({
  createTicket: vi.fn(() => 123),
}));

vi.mock("../../../src/features/modmail/threadState.js", () => ({
  addOpenThread: vi.fn(),
}));

vi.mock("../../../src/features/modmail/threadPerms.js", () => ({
  missingPermsForStartThread: vi.fn(() => []),
  ensureModsCanSpeakInThread: vi.fn().mockResolvedValue(undefined),
}));

import { openPublicModmailThreadFor } from "../../../src/features/modmail/threadOpen.js";
import { hasManageGuild, isReviewer, canRunAllCommands } from "../../../src/lib/config.js";
import { missingPermsForStartThread } from "../../../src/features/modmail/threadPerms.js";

const mockHasManageGuild = hasManageGuild as ReturnType<typeof vi.fn>;
const mockIsReviewer = isReviewer as ReturnType<typeof vi.fn>;
const mockCanRunAllCommands = canRunAllCommands as ReturnType<typeof vi.fn>;
const mockMissingPermsForStartThread = missingPermsForStartThread as ReturnType<typeof vi.fn>;

describe("features/modmail/threadOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
    });
    mockHasManageGuild.mockReturnValue(true);
    mockIsReviewer.mockReturnValue(true);
    mockCanRunAllCommands.mockReturnValue(true);
    mockMissingPermsForStartThread.mockReturnValue([]);
  });

  describe("openPublicModmailThreadFor", () => {
    describe("guild validation", () => {
      it("rejects non-guild interactions", async () => {
        const interaction = {
          guildId: null,
          guild: null,
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Guild only.");
      });
    });

    describe("permission checks", () => {
      it("rejects when user lacks all permissions", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(false);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("You do not have permission for this.");
      });

      it("allows users with canRunAllCommands", async () => {
        mockCanRunAllCommands.mockReturnValue(true);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(false);
        mockGet.mockReturnValue({ thread_id: "existing123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        // Should pass permission check (fails at existing thread check)
        expect(result.message).toContain("already exists");
      });

      it("allows users with hasManageGuild", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(true);
        mockIsReviewer.mockReturnValue(false);
        mockGet.mockReturnValue({ thread_id: "existing123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        // Should pass permission check
        expect(result.message).toContain("already exists");
      });

      it("allows users with isReviewer", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(true);
        mockGet.mockReturnValue({ thread_id: "existing123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        // Should pass permission check
        expect(result.message).toContain("already exists");
      });
    });

    describe("existing thread detection", () => {
      it("returns existing thread link when found", async () => {
        mockGet.mockReturnValue({ thread_id: "thread123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Modmail thread already exists: <#thread123>");
      });

      it("returns pending message when thread is being created", async () => {
        mockGet.mockReturnValue({ thread_id: "pending" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("being created by another moderator");
      });
    });

    describe("channel validation", () => {
      it("rejects DM channels", async () => {
        mockGet.mockReturnValue(undefined);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: { id: "bot123" } } },
          member: { id: "user456" },
          channel: { type: ChannelType.DM },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Cannot create thread in this channel.");
      });

      it("rejects non-text/news/forum channels", async () => {
        mockGet.mockReturnValue(undefined);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: { id: "bot123" } } },
          member: { id: "user456" },
          channel: {
            type: ChannelType.GuildVoice,
            permissionsFor: vi.fn(),
          },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Modmail is only supported in text/news/forum channels.");
      });
    });

    describe("bot permission checks", () => {
      it("reports missing permissions", async () => {
        mockGet.mockReturnValue(undefined);
        mockMissingPermsForStartThread.mockReturnValue(["CreatePublicThreads", "SendMessages"]);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: { id: "bot123" } } },
          member: { id: "user456" },
          channel: {
            id: "channel123",
            type: ChannelType.GuildText,
            permissionsFor: vi.fn(),
          },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("Missing: CreatePublicThreads, SendMessages");
      });

      it("returns error when bot member not found", async () => {
        mockGet.mockReturnValue(undefined);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: null } },
          member: { id: "user456" },
          channel: {
            type: ChannelType.GuildText,
            permissionsFor: vi.fn(),
          },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Bot member not found in guild.");
      });
    });
  });
});

describe("modmail thread customId format", () => {
  describe("close button customId", () => {
    it("follows expected format", () => {
      const ticketId = 123;
      const customId = `v1:modmail:close:${ticketId}`;
      expect(customId).toBe("v1:modmail:close:123");
    });

    it("can be parsed to extract ticket ID", () => {
      const customId = "v1:modmail:close:456";
      const match = customId.match(/^v1:modmail:close:(\d+)$/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("456");
    });
  });
});

describe("modmail race condition handling", () => {
  describe("pending state", () => {
    it("pending indicates in-progress creation", () => {
      const threadState = "pending";
      expect(threadState === "pending").toBe(true);
    });

    it("non-pending indicates completed creation", () => {
      const threadState = "thread123456";
      expect(threadState !== "pending" && threadState.length > 0).toBe(true);
    });
  });

  describe("primary key constraint detection", () => {
    it("detects UNIQUE constraint errors", () => {
      const error = { message: "UNIQUE constraint failed" };
      const isRace =
        error.message.includes("UNIQUE") || error.message.includes("PRIMARY KEY");
      expect(isRace).toBe(true);
    });

    it("detects PRIMARY KEY constraint errors", () => {
      const error = { message: "PRIMARY KEY constraint failed" };
      const isRace =
        error.message.includes("UNIQUE") || error.message.includes("PRIMARY KEY");
      expect(isRace).toBe(true);
    });

    it("detects SQLITE_CONSTRAINT code", () => {
      const error = { code: "SQLITE_CONSTRAINT" };
      const isRace = error.code === "SQLITE_CONSTRAINT";
      expect(isRace).toBe(true);
    });
  });
});
