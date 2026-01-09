/**
 * Pawtropolis Tech — tests/commands/help/index.test.ts
 * WHAT: Unit tests for the main help command handler.
 * WHY: Verify execute function and interaction handlers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const {
  mockFilterCommandsByPermission,
  mockGetVisibleCommandsInCategory,
  mockCountCommandsByCategory,
  mockSearchCommands,
  mockGenerateNonce,
  mockStoreSearchSession,
  mockGetSearchSession,
  mockGetCommand,
  mockParseHelpCustomId,
  mockBuildOverviewEmbed,
  mockBuildCategoryEmbed,
  mockBuildCommandQuickEmbed,
  mockBuildCommandFullEmbed,
  mockBuildSearchResultsEmbed,
  mockBuildErrorEmbed,
  mockBuildOverviewComponents,
  mockBuildCategoryComponents,
  mockBuildCommandComponents,
  mockBuildSearchComponents,
  mockBuildSearchModal,
  mockBuildErrorComponents,
} = vi.hoisted(() => ({
  mockFilterCommandsByPermission: vi.fn(),
  mockGetVisibleCommandsInCategory: vi.fn(),
  mockCountCommandsByCategory: vi.fn(),
  mockSearchCommands: vi.fn(),
  mockGenerateNonce: vi.fn(),
  mockStoreSearchSession: vi.fn(),
  mockGetSearchSession: vi.fn(),
  mockGetCommand: vi.fn(),
  mockParseHelpCustomId: vi.fn(),
  mockBuildOverviewEmbed: vi.fn(),
  mockBuildCategoryEmbed: vi.fn(),
  mockBuildCommandQuickEmbed: vi.fn(),
  mockBuildCommandFullEmbed: vi.fn(),
  mockBuildSearchResultsEmbed: vi.fn(),
  mockBuildErrorEmbed: vi.fn(),
  mockBuildOverviewComponents: vi.fn(),
  mockBuildCategoryComponents: vi.fn(),
  mockBuildCommandComponents: vi.fn(),
  mockBuildSearchComponents: vi.fn(),
  mockBuildSearchModal: vi.fn(),
  mockBuildErrorComponents: vi.fn(),
}));

vi.mock("../../../src/commands/help/cache.js", () => ({
  filterCommandsByPermission: mockFilterCommandsByPermission,
  getVisibleCommandsInCategory: mockGetVisibleCommandsInCategory,
  countCommandsByCategory: mockCountCommandsByCategory,
  searchCommands: mockSearchCommands,
  generateNonce: mockGenerateNonce,
  storeSearchSession: mockStoreSearchSession,
  getSearchSession: mockGetSearchSession,
}));

vi.mock("../../../src/commands/help/registry.js", () => ({
  getCommand: mockGetCommand,
}));

vi.mock("../../../src/commands/help/metadata.js", () => ({
  parseHelpCustomId: mockParseHelpCustomId,
  CATEGORY_INFO: {
    gate: { emoji: "🚪", label: "Gate", description: "Gate commands" },
    config: { emoji: "⚙️", label: "Config", description: "Config commands" },
  },
  COMMANDS_PER_PAGE: 10,
}));

vi.mock("../../../src/commands/help/embeds.js", () => ({
  buildOverviewEmbed: mockBuildOverviewEmbed,
  buildCategoryEmbed: mockBuildCategoryEmbed,
  buildCommandQuickEmbed: mockBuildCommandQuickEmbed,
  buildCommandFullEmbed: mockBuildCommandFullEmbed,
  buildSearchResultsEmbed: mockBuildSearchResultsEmbed,
  buildErrorEmbed: mockBuildErrorEmbed,
}));

vi.mock("../../../src/commands/help/components.js", () => ({
  buildOverviewComponents: mockBuildOverviewComponents,
  buildCategoryComponents: mockBuildCategoryComponents,
  buildCommandComponents: mockBuildCommandComponents,
  buildSearchComponents: mockBuildSearchComponents,
  buildSearchModal: mockBuildSearchModal,
  buildErrorComponents: mockBuildErrorComponents,
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("discord.js", async (importOriginal) => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    MessageFlags: {
      Ephemeral: 64,
    },
  };
});

import {
  execute,
  handleHelpButton,
  handleHelpSelectMenu,
  handleHelpModal,
} from "../../../src/commands/help/index.js";
import { logger } from "../../../src/lib/logger.js";
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  Guild,
} from "discord.js";
import type { CommandContext } from "../../../src/lib/cmdWrap.js";

describe("help/index", () => {
  let mockInteraction: Partial<ChatInputCommandInteraction>;
  let mockContext: Partial<CommandContext<ChatInputCommandInteraction>>;
  let mockReply: ReturnType<typeof vi.fn>;
  let mockEditReply: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReply = vi.fn();
    mockEditReply = vi.fn();
    mockFetch = vi.fn().mockResolvedValue({ id: "user-456" });

    mockInteraction = {
      options: {
        getString: vi.fn().mockReturnValue(null),
      } as unknown as ChatInputCommandInteraction["options"],
      guildId: "guild-123",
      user: { id: "user-456" },
      guild: {
        members: {
          fetch: mockFetch,
        },
      } as unknown as Guild,
      reply: mockReply,
      editReply: mockEditReply,
      replied: false,
      deferred: false,
    };

    mockContext = {
      interaction: mockInteraction as ChatInputCommandInteraction,
      step: vi.fn(),
    };

    // Default mock returns
    mockCountCommandsByCategory.mockReturnValue(new Map([["gate", 5]]));
    mockFilterCommandsByPermission.mockReturnValue([
      { name: "accept", description: "Accept", category: "gate", permissionLevel: "reviewer" },
    ]);
    mockGetVisibleCommandsInCategory.mockReturnValue([
      { name: "accept", description: "Accept", category: "gate", permissionLevel: "reviewer" },
    ]);
    mockSearchCommands.mockReturnValue([]);
    mockGenerateNonce.mockReturnValue("abc12345");
    mockBuildOverviewEmbed.mockReturnValue({ data: {} });
    mockBuildCategoryEmbed.mockReturnValue({ data: {} });
    mockBuildCommandQuickEmbed.mockReturnValue({ data: {} });
    mockBuildCommandFullEmbed.mockReturnValue({ data: {} });
    mockBuildSearchResultsEmbed.mockReturnValue({ data: {} });
    mockBuildErrorEmbed.mockReturnValue({ data: {} });
    mockBuildOverviewComponents.mockReturnValue([]);
    mockBuildCategoryComponents.mockReturnValue([]);
    mockBuildCommandComponents.mockReturnValue([]);
    mockBuildSearchComponents.mockReturnValue([]);
    mockBuildSearchModal.mockReturnValue({ data: {} });
    mockBuildErrorComponents.mockReturnValue([]);
    mockGetCommand.mockReturnValue(undefined);
  });

  describe("execute", () => {
    it("shows overview when no options provided", async () => {
      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockBuildOverviewEmbed).toHaveBeenCalled();
      expect(mockBuildOverviewComponents).toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalled();
    });

    it("shows command detail when command option provided", async () => {
      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "command" ? "accept" : null)
      );
      mockGetCommand.mockReturnValue({
        name: "accept",
        description: "Accept",
        category: "gate",
        permissionLevel: "reviewer",
      });

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockBuildCommandQuickEmbed).toHaveBeenCalled();
    });

    it("shows search results when search option provided", async () => {
      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "search" ? "test query" : null)
      );

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockSearchCommands).toHaveBeenCalledWith("test query");
      expect(mockBuildSearchResultsEmbed).toHaveBeenCalled();
    });

    it("shows category when category option provided", async () => {
      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "category" ? "gate" : null)
      );

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockGetVisibleCommandsInCategory).toHaveBeenCalledWith(
        "gate",
        expect.anything(),
        "guild-123",
        "user-456"
      );
      expect(mockBuildCategoryEmbed).toHaveBeenCalled();
    });

    it("calls ctx.step for each stage", async () => {
      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockContext.step).toHaveBeenCalledWith("parse_options");
      expect(mockContext.step).toHaveBeenCalledWith("overview");
    });

    it("handles member fetch error gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Fetch failed"));

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockReply).toHaveBeenCalled();
    });

    it("handles execution error with error embed", async () => {
      mockBuildOverviewEmbed.mockImplementation(() => {
        throw new Error("Build failed");
      });

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(logger.error).toHaveBeenCalled();
      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });

    it("edits reply if already replied", async () => {
      mockInteraction.replied = true;

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockEditReply).toHaveBeenCalled();
      expect(mockReply).not.toHaveBeenCalled();
    });

    it("edits reply if deferred", async () => {
      mockInteraction.deferred = true;

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockEditReply).toHaveBeenCalled();
    });

    it("shows error for command not found", async () => {
      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "command" ? "nonexistent" : null)
      );
      mockGetCommand.mockReturnValue(undefined);

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });

    it("shows error for permission denied on command", async () => {
      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "command" ? "admin-only" : null)
      );
      mockGetCommand.mockReturnValue({
        name: "admin-only",
        description: "Admin command",
        category: "system",
        permissionLevel: "admin",
      });
      mockFilterCommandsByPermission.mockReturnValue([]);

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });

    it("handles null guildId", async () => {
      mockInteraction.guildId = null;
      mockInteraction.guild = null;

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockCountCommandsByCategory).toHaveBeenCalledWith(null, "", "user-456");
    });
  });

  describe("handleHelpButton", () => {
    let mockButtonInteraction: Partial<ButtonInteraction>;
    let mockUpdate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockUpdate = vi.fn();
      mockButtonInteraction = {
        customId: "help:overview",
        user: { id: "user-456" },
        message: {
          interaction: { user: { id: "user-456" } },
        } as unknown as ButtonInteraction["message"],
        guildId: "guild-123",
        guild: {
          members: {
            fetch: mockFetch,
          },
        } as unknown as Guild,
        update: mockUpdate,
        reply: mockReply,
        editReply: mockEditReply,
        replied: false,
        deferred: false,
        showModal: vi.fn(),
      };
    });

    it("rejects interaction from non-original user", async () => {
      mockButtonInteraction.user = { id: "other-user" } as ButtonInteraction["user"];

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Only the person who ran this command"),
        })
      );
    });

    it("handles overview navigation", async () => {
      mockParseHelpCustomId.mockReturnValue({ type: "overview" });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildOverviewEmbed).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("handles category navigation", async () => {
      mockParseHelpCustomId.mockReturnValue({
        type: "category",
        category: "gate",
        page: 0,
      });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildCategoryEmbed).toHaveBeenCalled();
    });

    it("handles command navigation", async () => {
      mockParseHelpCustomId.mockReturnValue({
        type: "command",
        name: "accept",
        full: false,
      });
      mockGetCommand.mockReturnValue({
        name: "accept",
        description: "Accept",
        category: "gate",
        permissionLevel: "reviewer",
      });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildCommandQuickEmbed).toHaveBeenCalled();
    });

    it("handles command full view", async () => {
      mockParseHelpCustomId.mockReturnValue({
        type: "command",
        name: "accept",
        full: true,
      });
      mockGetCommand.mockReturnValue({
        name: "accept",
        description: "Accept",
        category: "gate",
        permissionLevel: "reviewer",
      });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildCommandFullEmbed).toHaveBeenCalled();
    });

    it("handles search modal trigger", async () => {
      mockParseHelpCustomId.mockReturnValue({ type: "search_modal" });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildSearchModal).toHaveBeenCalled();
      expect(mockButtonInteraction.showModal).toHaveBeenCalled();
    });

    it("handles unknown custom ID", async () => {
      mockParseHelpCustomId.mockReturnValue(null);

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(logger.warn).toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Unknown button"),
        })
      );
    });

    it("handles error during navigation", async () => {
      mockParseHelpCustomId.mockReturnValue({ type: "overview" });
      mockBuildOverviewEmbed.mockImplementation(() => {
        throw new Error("Build failed");
      });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(logger.error).toHaveBeenCalled();
      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });

    it("allows interaction when original user is null", async () => {
      mockButtonInteraction.message = {
        interaction: null,
      } as unknown as ButtonInteraction["message"];
      mockParseHelpCustomId.mockReturnValue({ type: "overview" });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("handleHelpSelectMenu", () => {
    let mockSelectInteraction: Partial<StringSelectMenuInteraction>;
    let mockUpdate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockUpdate = vi.fn();
      mockSelectInteraction = {
        customId: "help:select:cmd:gate",
        values: ["accept"],
        user: { id: "user-456" },
        message: {
          interaction: { user: { id: "user-456" } },
        } as unknown as StringSelectMenuInteraction["message"],
        guildId: "guild-123",
        guild: {
          members: {
            fetch: mockFetch,
          },
        } as unknown as Guild,
        update: mockUpdate,
        reply: mockReply,
        editReply: mockEditReply,
        replied: false,
        deferred: false,
      };
    });

    it("rejects interaction from non-original user", async () => {
      mockSelectInteraction.user = { id: "other-user" } as StringSelectMenuInteraction["user"];

      await handleHelpSelectMenu(mockSelectInteraction as StringSelectMenuInteraction);

      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Only the person who ran this command"),
        })
      );
    });

    it("handles command selection from category", async () => {
      mockGetCommand.mockReturnValue({
        name: "accept",
        description: "Accept",
        category: "gate",
        permissionLevel: "reviewer",
      });

      await handleHelpSelectMenu(mockSelectInteraction as StringSelectMenuInteraction);

      expect(mockBuildCommandQuickEmbed).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("handles command selection from search results", async () => {
      mockSelectInteraction.customId = "help:select:search:abc12345";
      mockGetCommand.mockReturnValue({
        name: "accept",
        description: "Accept",
        category: "gate",
        permissionLevel: "reviewer",
      });

      await handleHelpSelectMenu(mockSelectInteraction as StringSelectMenuInteraction);

      expect(mockBuildCommandQuickEmbed).toHaveBeenCalled();
    });

    it("handles unknown custom ID", async () => {
      mockSelectInteraction.customId = "unknown:select";

      await handleHelpSelectMenu(mockSelectInteraction as StringSelectMenuInteraction);

      expect(logger.warn).toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Unknown selection"),
        })
      );
    });

    it("handles error during selection", async () => {
      mockGetCommand.mockImplementation(() => {
        throw new Error("Lookup failed");
      });

      await handleHelpSelectMenu(mockSelectInteraction as StringSelectMenuInteraction);

      expect(logger.error).toHaveBeenCalled();
      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });
  });

  describe("handleHelpModal", () => {
    let mockModalInteraction: Partial<ModalSubmitInteraction>;
    let mockDeferUpdate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockDeferUpdate = vi.fn();
      mockModalInteraction = {
        customId: "help:modal:search",
        user: { id: "user-456" },
        guildId: "guild-123",
        guild: {
          members: {
            fetch: mockFetch,
          },
        } as unknown as Guild,
        fields: {
          getTextInputValue: vi.fn().mockReturnValue("test query"),
        } as unknown as ModalSubmitInteraction["fields"],
        deferUpdate: mockDeferUpdate,
        editReply: mockEditReply,
        reply: mockReply,
        replied: false,
        deferred: false,
      };
    });

    it("handles unknown modal custom ID", async () => {
      mockModalInteraction.customId = "unknown:modal";

      await handleHelpModal(mockModalInteraction as ModalSubmitInteraction);

      expect(logger.warn).toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Unknown modal"),
        })
      );
    });

    it("defers update before search", async () => {
      await handleHelpModal(mockModalInteraction as ModalSubmitInteraction);

      expect(mockDeferUpdate).toHaveBeenCalled();
    });

    it("performs search with query from modal", async () => {
      await handleHelpModal(mockModalInteraction as ModalSubmitInteraction);

      expect(mockSearchCommands).toHaveBeenCalledWith("test query");
      expect(mockBuildSearchResultsEmbed).toHaveBeenCalled();
    });

    it("stores search session for select navigation", async () => {
      mockSearchCommands.mockReturnValue([
        {
          command: { name: "accept", description: "Accept" },
          score: 100,
          matchedOn: "name",
        },
      ]);

      await handleHelpModal(mockModalInteraction as ModalSubmitInteraction);

      expect(mockStoreSearchSession).toHaveBeenCalled();
    });

    it("handles search error", async () => {
      mockSearchCommands.mockImplementation(() => {
        throw new Error("Search failed");
      });

      await handleHelpModal(mockModalInteraction as ModalSubmitInteraction);

      expect(logger.error).toHaveBeenCalled();
      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });

    it("handles null guildId", async () => {
      mockModalInteraction.guildId = null;
      mockModalInteraction.guild = null;

      await handleHelpModal(mockModalInteraction as ModalSubmitInteraction);

      expect(mockFilterCommandsByPermission).toHaveBeenCalledWith(null, "", "user-456");
    });
  });

  describe("invalid category handling", () => {
    it("shows error for unknown category in execute", async () => {
      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "category" ? "nonexistent" : null)
      );

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });

    it("shows error for unknown category in button handler", async () => {
      const mockButtonInteraction: Partial<ButtonInteraction> = {
        customId: "help:cat:nonexistent",
        user: { id: "user-456" },
        message: {
          interaction: { user: { id: "user-456" } },
        } as unknown as ButtonInteraction["message"],
        guildId: "guild-123",
        guild: {
          members: { fetch: mockFetch },
        } as unknown as Guild,
        update: vi.fn(),
        reply: mockReply,
        replied: false,
        deferred: false,
      };

      mockParseHelpCustomId.mockReturnValue({
        type: "category",
        category: "nonexistent",
        page: 0,
      });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildErrorEmbed).toHaveBeenCalled();
    });
  });

  describe("pagination", () => {
    it("calculates total pages correctly", async () => {
      mockGetVisibleCommandsInCategory.mockReturnValue(
        Array.from({ length: 25 }, (_, i) => ({
          name: `cmd${i}`,
          description: `Command ${i}`,
          category: "gate",
          permissionLevel: "reviewer",
        }))
      );

      (mockInteraction.options!.getString as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => (name === "category" ? "gate" : null)
      );

      await execute(mockContext as CommandContext<ChatInputCommandInteraction>);

      expect(mockBuildCategoryEmbed).toHaveBeenCalledWith(
        "gate",
        expect.any(Array),
        0,
        3
      );
    });

    it("clamps page to valid range", async () => {
      mockGetVisibleCommandsInCategory.mockReturnValue([
        { name: "cmd1", description: "Command 1", category: "gate", permissionLevel: "reviewer" },
      ]);

      const mockButtonInteraction: Partial<ButtonInteraction> = {
        customId: "help:cat:gate:p10",
        user: { id: "user-456" },
        message: {
          interaction: { user: { id: "user-456" } },
        } as unknown as ButtonInteraction["message"],
        guildId: "guild-123",
        guild: {
          members: { fetch: mockFetch },
        } as unknown as Guild,
        update: vi.fn(),
        reply: mockReply,
        replied: false,
        deferred: false,
      };

      mockParseHelpCustomId.mockReturnValue({
        type: "category",
        category: "gate",
        page: 10,
      });

      await handleHelpButton(mockButtonInteraction as ButtonInteraction);

      expect(mockBuildCategoryEmbed).toHaveBeenCalledWith(
        "gate",
        expect.any(Array),
        0,
        1
      );
    });
  });
});
