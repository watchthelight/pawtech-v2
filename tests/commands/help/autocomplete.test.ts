/**
 * Pawtropolis Tech — tests/commands/help/autocomplete.test.ts
 * WHAT: Unit tests for help command autocomplete handler.
 * WHY: Verify suggestion filtering, ranking, and permission checks.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockFilterCommandsByPermission, mockSearchCommands } = vi.hoisted(() => ({
  mockFilterCommandsByPermission: vi.fn(),
  mockSearchCommands: vi.fn(),
}));

vi.mock("../../../src/commands/help/cache.js", () => ({
  filterCommandsByPermission: mockFilterCommandsByPermission,
  searchCommands: mockSearchCommands,
}));

vi.mock("../../../src/commands/help/registry.js", () => ({
  COMMAND_REGISTRY: [
    { name: "accept", description: "Approve an application" },
    { name: "reject", description: "Reject an application" },
    { name: "config", description: "Guild configuration" },
    { name: "health", description: "Check bot health" },
  ],
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { handleAutocomplete } from "../../../src/commands/help/autocomplete.js";
import { logger } from "../../../src/lib/logger.js";
import type { AutocompleteInteraction, GuildMember, Guild } from "discord.js";

describe("help/autocomplete", () => {
  let mockInteraction: Partial<AutocompleteInteraction>;
  let mockRespond: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRespond = vi.fn();
    mockFetch = vi.fn();

    mockInteraction = {
      options: {
        getFocused: vi.fn().mockReturnValue({ name: "command", value: "" }),
      } as unknown as AutocompleteInteraction["options"],
      guildId: "guild-123",
      user: { id: "user-456" },
      guild: {
        members: {
          fetch: mockFetch,
        },
      } as unknown as Guild,
      respond: mockRespond,
    };

    mockFilterCommandsByPermission.mockReturnValue([
      { name: "accept", description: "Approve an application" },
      { name: "reject", description: "Reject an application" },
      { name: "config", description: "Guild configuration" },
      { name: "health", description: "Check bot health" },
    ]);

    mockSearchCommands.mockReturnValue([]);
    mockFetch.mockResolvedValue({ id: "user-456" });
  });

  describe("handleAutocomplete", () => {
    it("responds with empty array for non-command option", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "other",
        value: "test",
      });

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it("responds with alphabetically sorted commands when query is empty", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "",
      });

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockRespond).toHaveBeenCalled();
      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].value).toBe("accept");
      expect(suggestions[1].value).toBe("config");
      expect(suggestions[2].value).toBe("health");
      expect(suggestions[3].value).toBe("reject");
    });

    it("includes command description in suggestion name", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "",
      });

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].name).toContain("/accept");
      expect(suggestions[0].name).toContain("Approve an application");
    });

    it("uses search results when query is provided", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "acc",
      });

      mockSearchCommands.mockReturnValue([
        {
          command: { name: "accept", description: "Approve an application" },
          score: 90,
          matchedOn: "name",
        },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockSearchCommands).toHaveBeenCalledWith("acc");
      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].value).toBe("accept");
    });

    it("filters search results by visible commands", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "admin",
      });

      mockFilterCommandsByPermission.mockReturnValue([
        { name: "health", description: "Check bot health" },
      ]);

      mockSearchCommands.mockReturnValue([
        {
          command: { name: "adminonly", description: "Admin command" },
          score: 100,
          matchedOn: "name",
        },
        {
          command: { name: "health", description: "Check bot health" },
          score: 50,
          matchedOn: "description",
        },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].value).toBe("health");
    });

    it("falls back to prefix match when search returns nothing", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "acc",
      });

      mockSearchCommands.mockReturnValue([]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].value).toBe("accept");
    });

    it("prioritizes prefix matches over substring matches", async () => {
      mockFilterCommandsByPermission.mockReturnValue([
        { name: "accept", description: "Approve an application" },
        { name: "reaccept", description: "Accept again" },
      ]);

      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "acc",
      });

      mockSearchCommands.mockReturnValue([]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].value).toBe("accept");
    });

    it("limits suggestions to 25", async () => {
      const manyCommands = Array.from({ length: 30 }, (_, i) => ({
        name: `command${i.toString().padStart(2, "0")}`,
        description: `Command ${i}`,
      }));

      mockFilterCommandsByPermission.mockReturnValue(manyCommands);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions.length).toBe(25);
    });

    it("truncates long descriptions to 80 characters", async () => {
      const longDesc = "A".repeat(100);
      mockFilterCommandsByPermission.mockReturnValue([
        { name: "test", description: longDesc },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].name.length).toBeLessThanOrEqual(100);
    });

    it("handles null guildId (DM context)", async () => {
      mockInteraction.guildId = null;
      mockInteraction.guild = null;

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockFilterCommandsByPermission).toHaveBeenCalledWith(
        null,
        "",
        "user-456"
      );
    });

    it("handles member fetch error gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Fetch failed"));

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockFilterCommandsByPermission).toHaveBeenCalledWith(
        null,
        "guild-123",
        "user-456"
      );
    });

    it("handles member fetch returning null", async () => {
      mockFetch.mockResolvedValue(null);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockRespond).toHaveBeenCalled();
    });

    it("logs errors and responds with empty array", async () => {
      mockFilterCommandsByPermission.mockImplementation(() => {
        throw new Error("Test error");
      });

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(logger.error).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it("handles respond error silently", async () => {
      mockFilterCommandsByPermission.mockImplementation(() => {
        throw new Error("Test error");
      });
      mockRespond.mockRejectedValue(new Error("Already responded"));

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(logger.error).toHaveBeenCalled();
    });

    it("trims and lowercases query", async () => {
      (mockInteraction.options!.getFocused as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "command",
        value: "  ACC  ",
      });

      mockSearchCommands.mockReturnValue([
        {
          command: { name: "accept", description: "Approve" },
          score: 100,
          matchedOn: "name",
        },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockSearchCommands).toHaveBeenCalledWith("acc");
    });

    it("fetches member for permission checking", async () => {
      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockFetch).toHaveBeenCalledWith("user-456");
    });

    it("passes fetched member to filterCommandsByPermission", async () => {
      const mockMember = { id: "user-456" } as GuildMember;
      mockFetch.mockResolvedValue(mockMember);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      expect(mockFilterCommandsByPermission).toHaveBeenCalledWith(
        mockMember,
        "guild-123",
        "user-456"
      );
    });
  });

  describe("suggestion format", () => {
    it("formats suggestion with slash prefix", async () => {
      mockFilterCommandsByPermission.mockReturnValue([
        { name: "accept", description: "Approve" },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].name.startsWith("/accept")).toBe(true);
    });

    it("includes dash separator between name and description", async () => {
      mockFilterCommandsByPermission.mockReturnValue([
        { name: "accept", description: "Approve" },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].name).toContain(" - ");
    });

    it("sets value to command name without slash", async () => {
      mockFilterCommandsByPermission.mockReturnValue([
        { name: "accept", description: "Approve" },
      ]);

      await handleAutocomplete(mockInteraction as AutocompleteInteraction);

      const suggestions = mockRespond.mock.calls[0][0];
      expect(suggestions[0].value).toBe("accept");
    });
  });
});
