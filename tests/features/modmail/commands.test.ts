/**
 * Pawtropolis Tech — tests/features/modmail/commands.test.ts
 * WHAT: Unit tests for modmail slash commands.
 * WHY: Verify command structure and execution logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApplicationCommandType } from "discord.js";

// Use vi.hoisted for all mock functions
const {
  mockReplyOrEdit,
  mockEnsureDeferred,
  mockHasManageGuild,
  mockIsReviewer,
  mockCanRunAllCommands,
  mockCloseModmailThread,
  mockReopenModmailThread,
} = vi.hoisted(() => ({
  mockReplyOrEdit: vi.fn(),
  mockEnsureDeferred: vi.fn(),
  mockHasManageGuild: vi.fn(),
  mockIsReviewer: vi.fn(),
  mockCanRunAllCommands: vi.fn(),
  mockCloseModmailThread: vi.fn(),
  mockReopenModmailThread: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: mockReplyOrEdit,
  ensureDeferred: mockEnsureDeferred,
}));

vi.mock("../../../src/lib/config.js", () => ({
  hasManageGuild: mockHasManageGuild,
  isReviewer: mockIsReviewer,
  canRunAllCommands: mockCanRunAllCommands,
}));

vi.mock("../../../src/features/modmail/threads.js", () => ({
  closeModmailThread: mockCloseModmailThread,
  reopenModmailThread: mockReopenModmailThread,
}));

import {
  modmailCommand,
  executeModmailCommand,
  modmailContextMenu,
} from "../../../src/features/modmail/commands.js";

describe("features/modmail/commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanRunAllCommands.mockReturnValue(true);
    mockHasManageGuild.mockReturnValue(true);
    mockIsReviewer.mockReturnValue(true);
  });

  describe("modmailCommand", () => {
    it("has correct name", () => {
      expect(modmailCommand.name).toBe("modmail");
    });

    it("has description", () => {
      expect(modmailCommand.description).toBe("Modmail management");
    });

    it("is guild-only (no DM)", () => {
      expect(modmailCommand.dm_permission).toBe(false);
    });

    it("has close subcommand", () => {
      const options = modmailCommand.options as any[];
      const closeSubcommand = options.find((o) => o.name === "close");
      expect(closeSubcommand).toBeDefined();
    });

    it("has reopen subcommand", () => {
      const options = modmailCommand.options as any[];
      const reopenSubcommand = options.find((o) => o.name === "reopen");
      expect(reopenSubcommand).toBeDefined();
    });

    it("close subcommand has optional thread option", () => {
      const options = modmailCommand.options as any[];
      const closeSubcommand = options.find((o) => o.name === "close");
      const threadOption = closeSubcommand.options?.find((o: any) => o.name === "thread");
      expect(threadOption).toBeDefined();
      expect(threadOption.required).toBe(false);
    });

    it("reopen subcommand has optional user and thread options", () => {
      const options = modmailCommand.options as any[];
      const reopenSubcommand = options.find((o) => o.name === "reopen");
      const userOption = reopenSubcommand.options?.find((o: any) => o.name === "user");
      const threadOption = reopenSubcommand.options?.find((o: any) => o.name === "thread");
      expect(userOption).toBeDefined();
      expect(userOption.required).toBe(false);
      expect(threadOption).toBeDefined();
      expect(threadOption.required).toBe(false);
    });
  });

  describe("modmailContextMenu", () => {
    it("has correct name", () => {
      expect(modmailContextMenu.name).toBe("Modmail: Open");
    });

    it("is a Message command", () => {
      expect(modmailContextMenu.type).toBe(ApplicationCommandType.Message);
    });

    it("is guild-only (no DM)", () => {
      expect(modmailContextMenu.dm_permission).toBe(false);
    });
  });

  describe("executeModmailCommand", () => {
    describe("permission checks", () => {
      it("rejects when not in guild", async () => {
        const ctx = {
          interaction: {
            guildId: null,
            guild: null,
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockReplyOrEdit).toHaveBeenCalledWith(
          ctx.interaction,
          { content: "Guild only." }
        );
      });

      it("rejects when user lacks all permissions", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(false);

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockReplyOrEdit).toHaveBeenCalledWith(
          ctx.interaction,
          { content: "You do not have permission for this." }
        );
      });

      it("allows users with canRunAllCommands", async () => {
        mockCanRunAllCommands.mockReturnValue(true);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(false);
        mockCloseModmailThread.mockResolvedValue({ message: "Closed" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockEnsureDeferred).toHaveBeenCalled();
      });

      it("allows users with hasManageGuild", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(true);
        mockIsReviewer.mockReturnValue(false);
        mockCloseModmailThread.mockResolvedValue({ message: "Closed" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockEnsureDeferred).toHaveBeenCalled();
      });

      it("allows users with isReviewer", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(true);
        mockCloseModmailThread.mockResolvedValue({ message: "Closed" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockEnsureDeferred).toHaveBeenCalled();
      });
    });

    describe("close subcommand", () => {
      it("calls closeModmailThread with threadId from options", async () => {
        mockCloseModmailThread.mockResolvedValue({ message: "Closed successfully" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue("thread-789"),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockCloseModmailThread).toHaveBeenCalledWith({
          interaction: ctx.interaction,
          threadId: "thread-789",
        });
        expect(mockReplyOrEdit).toHaveBeenCalledWith(
          ctx.interaction,
          { content: "Closed successfully" }
        );
      });

      it("handles undefined threadId", async () => {
        mockCloseModmailThread.mockResolvedValue({ message: "Closed" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockCloseModmailThread).toHaveBeenCalledWith({
          interaction: ctx.interaction,
          threadId: undefined,
        });
      });

      it("handles undefined result message", async () => {
        mockCloseModmailThread.mockResolvedValue({ message: undefined });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockReplyOrEdit).toHaveBeenCalledWith(
          ctx.interaction,
          { content: "Unknown error." }
        );
      });
    });

    describe("reopen subcommand", () => {
      it("calls reopenModmailThread with user and threadId from options", async () => {
        mockReopenModmailThread.mockResolvedValue({ message: "Reopened successfully" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("reopen"),
              getUser: vi.fn().mockReturnValue({ id: "target-user" }),
              getString: vi.fn().mockReturnValue("thread-789"),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockReopenModmailThread).toHaveBeenCalledWith({
          interaction: ctx.interaction,
          userId: "target-user",
          threadId: "thread-789",
        });
        expect(mockReplyOrEdit).toHaveBeenCalledWith(
          ctx.interaction,
          { content: "Reopened successfully" }
        );
      });

      it("handles null user option", async () => {
        mockReopenModmailThread.mockResolvedValue({ message: "Reopened" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("reopen"),
              getUser: vi.fn().mockReturnValue(null),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockReopenModmailThread).toHaveBeenCalledWith({
          interaction: ctx.interaction,
          userId: undefined,
          threadId: undefined,
        });
      });

      it("handles undefined result message", async () => {
        mockReopenModmailThread.mockResolvedValue({ message: undefined });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("reopen"),
              getUser: vi.fn().mockReturnValue(null),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockReplyOrEdit).toHaveBeenCalledWith(
          ctx.interaction,
          { content: "Unknown error." }
        );
      });
    });

    describe("interaction deferral", () => {
      it("defers interaction before processing", async () => {
        mockCloseModmailThread.mockResolvedValue({ message: "Done" });

        const ctx = {
          interaction: {
            guildId: "guild-123",
            guild: { id: "guild-123" },
            member: { id: "user-456" },
            options: {
              getSubcommand: vi.fn().mockReturnValue("close"),
              getString: vi.fn().mockReturnValue(null),
            },
          },
        } as any;

        await executeModmailCommand(ctx);

        expect(mockEnsureDeferred).toHaveBeenCalledWith(ctx.interaction);
        // ensureDeferred should be called before closeModmailThread
        const deferCallIndex = mockEnsureDeferred.mock.invocationCallOrder[0];
        const closeCallIndex = mockCloseModmailThread.mock.invocationCallOrder[0];
        expect(deferCallIndex).toBeLessThan(closeCallIndex);
      });
    });
  });
});
