/**
 * Pawtropolis Tech — tests/features/modmail/handlers.test.ts
 * WHAT: Unit tests for modmail button and context menu handlers.
 * WHY: Verify handler logic for open/close buttons and context menus.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageFlags } from "discord.js";

// Mock logger
vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

// Mock the appLookup module
const mockFindAppByShortCode = vi.fn();
vi.mock("../../../src/features/appLookup.js", () => ({
  findAppByShortCode: mockFindAppByShortCode,
}));

// Mock the threads module
const mockOpenPublicModmailThreadFor = vi.fn();
const mockCloseModmailThread = vi.fn();
vi.mock("../../../src/features/modmail/threads.js", () => ({
  openPublicModmailThreadFor: mockOpenPublicModmailThreadFor,
  closeModmailThread: mockCloseModmailThread,
}));

import {
  handleModmailOpenButton,
  handleModmailCloseButton,
  handleModmailContextMenu,
} from "../../../src/features/modmail/handlers.js";

describe("features/modmail/handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleModmailOpenButton", () => {
    it("returns early for non-matching customId", async () => {
      const interaction = {
        customId: "some-other-button",
        deferUpdate: vi.fn(),
      } as any;

      await handleModmailOpenButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it("returns early for invalid customId format", async () => {
      const interaction = {
        customId: "v1:modmail:invalid",
        deferUpdate: vi.fn(),
        deferred: false,
        replied: false,
        followUp: vi.fn(),
      } as any;

      await handleModmailOpenButton(interaction);

      // Should not process invalid format
      expect(mockOpenPublicModmailThreadFor).not.toHaveBeenCalled();
    });

    it("handles missing appCode or guildId", async () => {
      const interaction = {
        customId: "v1:modmail:open:msgSomeId",
        guildId: null,
        deferred: false,
        replied: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      } as any;

      await handleModmailOpenButton(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: MessageFlags.Ephemeral,
          content: "Invalid modmail button data.",
        })
      );
    });

    it("handles application not found", async () => {
      mockFindAppByShortCode.mockReturnValue(null);

      const interaction = {
        customId: "v1:modmail:open:codeABC123:msg12345",
        guildId: "guild-123",
        deferred: false,
        replied: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      } as any;

      await handleModmailOpenButton(interaction);

      expect(mockFindAppByShortCode).toHaveBeenCalledWith("guild-123", "ABC123");
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "No application found with code ABC123.",
        })
      );
    });

    it("successfully opens modmail thread", async () => {
      mockFindAppByShortCode.mockReturnValue({ id: "app-1", user_id: "user-123" });
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Modmail thread created: <#thread-123>",
      });

      const mockSend = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        customId: "v1:modmail:open:codeABC123:msg12345",
        guildId: "guild-123",
        deferred: false,
        replied: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        channel: { send: mockSend },
      } as any;

      await handleModmailOpenButton(interaction);

      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith({
        interaction,
        userId: "user-123",
        appCode: "ABC123",
        reviewMessageId: "12345",
        appId: "app-1",
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Modmail thread created: <#thread-123>",
        })
      );
    });

    it("handles failed thread creation", async () => {
      mockFindAppByShortCode.mockReturnValue({ id: "app-1", user_id: "user-123" });
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: false,
        message: "Thread already exists",
      });

      const interaction = {
        customId: "v1:modmail:open:codeABC123:msg12345",
        guildId: "guild-123",
        deferred: false,
        replied: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        channel: null,
      } as any;

      await handleModmailOpenButton(interaction);

      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: MessageFlags.Ephemeral,
          content: "Warning: Thread already exists",
        })
      );
    });

    it("handles channel without send method", async () => {
      mockFindAppByShortCode.mockReturnValue({ id: "app-1", user_id: "user-123" });
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Created",
      });

      const interaction = {
        customId: "v1:modmail:open:codeABC123:msg12345",
        guildId: "guild-123",
        deferred: false,
        replied: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        channel: { type: "dm" }, // No send method
      } as any;

      // Should not throw
      await handleModmailOpenButton(interaction);
      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalled();
    });
  });

  describe("handleModmailCloseButton", () => {
    it("returns early for non-matching customId", async () => {
      const interaction = {
        customId: "v1:modmail:open:something",
        deferUpdate: vi.fn(),
      } as any;

      await handleModmailCloseButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it("returns early for invalid ticket ID format", async () => {
      const interaction = {
        customId: "v1:modmail:close:abc",
        deferUpdate: vi.fn(),
      } as any;

      await handleModmailCloseButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it("successfully closes modmail thread", async () => {
      mockCloseModmailThread.mockResolvedValue({
        success: true,
        message: "Modmail closed. Logs: https://...",
      });

      const mockSend = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        customId: "v1:modmail:close:123",
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        channel: { send: mockSend },
      } as any;

      await handleModmailCloseButton(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(mockCloseModmailThread).toHaveBeenCalledWith({
        interaction,
        ticketId: 123,
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Modmail closed. Logs: https://...",
        })
      );
    });

    it("handles close failure", async () => {
      mockCloseModmailThread.mockResolvedValue({
        success: false,
        message: "Ticket not found",
      });

      const interaction = {
        customId: "v1:modmail:close:456",
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        channel: null,
      } as any;

      await handleModmailCloseButton(interaction);

      expect(mockCloseModmailThread).toHaveBeenCalledWith({
        interaction,
        ticketId: 456,
      });
      // No send on failure when no channel
    });

    it("handles channel without send method", async () => {
      mockCloseModmailThread.mockResolvedValue({
        success: true,
        message: "Closed",
      });

      const interaction = {
        customId: "v1:modmail:close:789",
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        channel: { type: "dm" }, // No send method
      } as any;

      // Should not throw
      await handleModmailCloseButton(interaction);
      expect(mockCloseModmailThread).toHaveBeenCalled();
    });

    it("parses large ticket IDs correctly", async () => {
      mockCloseModmailThread.mockResolvedValue({ success: true });

      const interaction = {
        customId: "v1:modmail:close:9999999",
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        channel: null,
      } as any;

      await handleModmailCloseButton(interaction);

      expect(mockCloseModmailThread).toHaveBeenCalledWith({
        interaction,
        ticketId: 9999999,
      });
    });
  });

  describe("handleModmailContextMenu", () => {
    it("opens modmail from context menu", async () => {
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Thread created",
      });

      const interaction = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        targetMessage: {
          author: { id: "user-123" },
          id: "msg-456",
          content: "",
          embeds: [],
        },
      } as any;

      await handleModmailContextMenu(interaction);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith({
        interaction,
        userId: "user-123",
        appCode: undefined,
        reviewMessageId: "msg-456",
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "Thread created",
      });
    });

    it("extracts app code from message content", async () => {
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Created",
      });

      const interaction = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        targetMessage: {
          author: { id: "user-123" },
          id: "msg-456",
          content: "App Code: DEF456",
          embeds: [],
        },
      } as any;

      await handleModmailContextMenu(interaction);

      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith(
        expect.objectContaining({
          appCode: "DEF456",
        })
      );
    });

    it("handles embeds without app code", async () => {
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Created",
      });

      const interaction = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        targetMessage: {
          author: { id: "user-123" },
          id: "msg-456",
          content: "",
          embeds: [{ description: "Some other text" }],
        },
      } as any;

      await handleModmailContextMenu(interaction);

      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith(
        expect.objectContaining({
          appCode: undefined,
        })
      );
    });

    it("handles case-insensitive app code matching", async () => {
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Created",
      });

      const interaction = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        targetMessage: {
          author: { id: "user-123" },
          id: "msg-456",
          content: "app code: abc123",
          embeds: [],
        },
      } as any;

      await handleModmailContextMenu(interaction);

      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith(
        expect.objectContaining({
          appCode: "abc123",
        })
      );
    });

    it("handles unknown error", async () => {
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: false,
        message: undefined,
      });

      const interaction = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        targetMessage: {
          author: { id: "user-123" },
          id: "msg-456",
          content: "",
          embeds: [],
        },
      } as any;

      await handleModmailContextMenu(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "Unknown error.",
      });
    });

    it("handles message without app code anywhere", async () => {
      mockOpenPublicModmailThreadFor.mockResolvedValue({
        success: true,
        message: "Created",
      });

      const interaction = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        targetMessage: {
          author: { id: "user-123" },
          id: "msg-456",
          content: "Just some random text",
          embeds: [],
        },
      } as any;

      await handleModmailContextMenu(interaction);

      expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith(
        expect.objectContaining({
          appCode: undefined,
        })
      );
    });
  });

  describe("customId parsing", () => {
    describe("open button format", () => {
      it("extracts code from codeXXXXXX format", async () => {
        mockFindAppByShortCode.mockReturnValue({ id: "app", user_id: "user" });
        mockOpenPublicModmailThreadFor.mockResolvedValue({ success: true });

        const interaction = {
          customId: "v1:modmail:open:codeABCDEF:msg123456",
          guildId: "guild",
          deferred: false,
          replied: false,
          deferUpdate: vi.fn().mockResolvedValue(undefined),
          followUp: vi.fn().mockResolvedValue(undefined),
          channel: null,
        } as any;

        await handleModmailOpenButton(interaction);

        expect(mockFindAppByShortCode).toHaveBeenCalledWith("guild", "ABCDEF");
      });

      it("extracts message ID from msgXXX format", async () => {
        mockFindAppByShortCode.mockReturnValue({ id: "app", user_id: "user" });
        mockOpenPublicModmailThreadFor.mockResolvedValue({ success: true });

        const interaction = {
          customId: "v1:modmail:open:codeABCDEF:msg987654321",
          guildId: "guild",
          deferred: false,
          replied: false,
          deferUpdate: vi.fn().mockResolvedValue(undefined),
          followUp: vi.fn().mockResolvedValue(undefined),
          channel: null,
        } as any;

        await handleModmailOpenButton(interaction);

        expect(mockOpenPublicModmailThreadFor).toHaveBeenCalledWith(
          expect.objectContaining({
            reviewMessageId: "987654321",
          })
        );
      });
    });

    describe("close button format", () => {
      it("handles numeric ticket IDs", async () => {
        mockCloseModmailThread.mockResolvedValue({ success: true });

        const testCases = ["1", "123", "999999"];

        for (const ticketId of testCases) {
          const interaction = {
            customId: `v1:modmail:close:${ticketId}`,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            channel: null,
          } as any;

          await handleModmailCloseButton(interaction);

          expect(mockCloseModmailThread).toHaveBeenCalledWith({
            interaction,
            ticketId: parseInt(ticketId, 10),
          });
        }
      });
    });
  });
});
