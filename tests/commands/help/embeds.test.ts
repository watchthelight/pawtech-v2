/**
 * Pawtropolis Tech — tests/commands/help/embeds.test.ts
 * WHAT: Unit tests for help embed builders.
 * WHY: Verify embed construction for all help views.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discord.js EmbedBuilder
vi.mock("discord.js", () => ({
  EmbedBuilder: class MockEmbedBuilder {
    data: {
      color?: number;
      description?: string;
      timestamp?: number;
    } = {};

    setDescription(description: string) {
      this.data.description = description;
      return this;
    }

    setColor(color: number) {
      this.data.color = color;
      return this;
    }

    setTimestamp(timestamp?: number) {
      this.data.timestamp = timestamp ?? Date.now();
      return this;
    }
  },
}));

import {
  buildOverviewEmbed,
  buildCategoryEmbed,
  buildCommandQuickEmbed,
  buildCommandFullEmbed,
  buildSearchResultsEmbed,
  buildErrorEmbed,
} from "../../../src/commands/help/embeds.js";
import type { CommandMetadata, CommandCategory } from "../../../src/commands/help/metadata.js";

describe("help/embeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildOverviewEmbed", () => {
    it("returns embed with description", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 5],
        ["config", 3],
      ]);

      const embed = buildOverviewEmbed(counts, 8);

      expect(embed.data.description).toBeDefined();
    });

    it("includes Pawtropolis Tech Help title", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const embed = buildOverviewEmbed(counts, 1);

      expect(embed.data.description).toContain("Pawtropolis Tech Help");
    });

    it("includes quick actions", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const embed = buildOverviewEmbed(counts, 1);

      expect(embed.data.description).toContain("/help command:");
      expect(embed.data.description).toContain("/help search:");
    });

    it("lists categories with counts", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 5],
        ["config", 3],
      ]);

      const embed = buildOverviewEmbed(counts, 8);

      expect(embed.data.description).toContain("Gate & Verification");
      expect(embed.data.description).toContain("(5)");
      expect(embed.data.description).toContain("Configuration");
      expect(embed.data.description).toContain("(3)");
    });

    it("omits categories with zero count", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 5],
        ["config", 0],
      ]);

      const embed = buildOverviewEmbed(counts, 5);

      expect(embed.data.description).toContain("Gate & Verification");
      expect(embed.data.description).not.toContain("Configuration (0)");
    });

    it("includes total command count", () => {
      const counts = new Map<CommandCategory, number>([["gate", 5]]);

      const embed = buildOverviewEmbed(counts, 5);

      expect(embed.data.description).toContain("5 commands");
    });

    it("sets primary color", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const embed = buildOverviewEmbed(counts, 1);

      expect(embed.data.color).toBe(0x1e293b);
    });

    it("sets timestamp", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const embed = buildOverviewEmbed(counts, 1);

      expect(embed.data.timestamp).toBeDefined();
    });

    it("includes category emojis", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 1],
        ["moderation", 1],
      ]);

      const embed = buildOverviewEmbed(counts, 2);

      // Check that emojis are present (they're defined in CATEGORY_INFO)
      expect(embed.data.description).toMatch(/[^\x00-\x7F]/); // Non-ASCII chars
    });
  });

  describe("buildCategoryEmbed", () => {
    const mockCommands: CommandMetadata[] = [
      {
        name: "accept",
        description: "Approve an application",
        category: "gate",
        permissionLevel: "reviewer",
      },
      {
        name: "reject",
        description: "Reject an application",
        category: "gate",
        permissionLevel: "reviewer",
      },
    ];

    it("returns embed with description", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 0, 1);

      expect(embed.data.description).toBeDefined();
    });

    it("includes category name in title", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 0, 1);

      expect(embed.data.description).toContain("Gate & Verification");
    });

    it("lists commands with descriptions", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 0, 1);

      expect(embed.data.description).toContain("/accept");
      expect(embed.data.description).toContain("Approve an application");
      expect(embed.data.description).toContain("/reject");
    });

    it("shows page info", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 1, 3);

      expect(embed.data.description).toContain("Page 2/3");
    });

    it("includes total command count", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 0, 1);

      expect(embed.data.description).toContain("2 commands");
    });

    it("includes category tip if available", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 0, 1);

      expect(embed.data.description).toContain("Tip:");
      expect(embed.data.description).toContain("listopen");
    });

    it("sets category color", () => {
      const embed = buildCategoryEmbed("gate", mockCommands, 0, 1);

      expect(embed.data.color).toBe(0x5865f2); // Discord blurple
    });

    it("paginates commands correctly", () => {
      const manyCommands = Array.from({ length: 15 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
        category: "gate" as CommandCategory,
        permissionLevel: "reviewer" as const,
      }));

      const page1 = buildCategoryEmbed("gate", manyCommands, 0, 2);
      const page2 = buildCategoryEmbed("gate", manyCommands, 1, 2);

      expect(page1.data.description).toContain("/cmd0");
      expect(page1.data.description).not.toContain("/cmd10");
      expect(page2.data.description).toContain("/cmd10");
      expect(page2.data.description).not.toContain("/cmd0");
    });
  });

  describe("buildCommandQuickEmbed", () => {
    const mockCmd: CommandMetadata = {
      name: "accept",
      description: "Approve an application and grant verified role",
      category: "gate",
      permissionLevel: "reviewer",
      usage: "/accept [app:<code>] [user:<@user>]",
      relatedCommands: ["reject", "kick"],
    };

    it("returns embed with description", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toBeDefined();
    });

    it("includes command name", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toContain("/accept");
    });

    it("includes command description", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toContain("Approve an application");
    });

    it("includes usage if provided", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toContain("Usage:");
      expect(embed.data.description).toContain("/accept [app:<code>]");
    });

    it("shows permission level", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toContain("Permission:");
      expect(embed.data.description).toContain("Reviewer+");
    });

    it("shows category", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toContain("Category:");
      expect(embed.data.description).toContain("Gate & Verification");
    });

    it("includes related commands", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.description).toContain("Related:");
      expect(embed.data.description).toContain("/reject");
      expect(embed.data.description).toContain("/kick");
    });

    it("omits related section if none", () => {
      const cmdNoRelated: CommandMetadata = {
        ...mockCmd,
        relatedCommands: undefined,
      };

      const embed = buildCommandQuickEmbed(cmdNoRelated);

      expect(embed.data.description).not.toContain("Related:");
    });

    it("omits usage if not provided", () => {
      const cmdNoUsage: CommandMetadata = {
        ...mockCmd,
        usage: undefined,
      };

      const embed = buildCommandQuickEmbed(cmdNoUsage);

      expect(embed.data.description).not.toContain("Usage:");
    });

    it("sets command color", () => {
      const embed = buildCommandQuickEmbed(mockCmd);

      expect(embed.data.color).toBe(0x57f287); // green
    });

    it("formats permission levels correctly", () => {
      const publicCmd: CommandMetadata = { ...mockCmd, permissionLevel: "public" };
      const staffCmd: CommandMetadata = { ...mockCmd, permissionLevel: "staff" };
      const adminCmd: CommandMetadata = { ...mockCmd, permissionLevel: "admin" };
      const ownerCmd: CommandMetadata = { ...mockCmd, permissionLevel: "owner" };

      expect(buildCommandQuickEmbed(publicCmd).data.description).toContain("Everyone");
      expect(buildCommandQuickEmbed(staffCmd).data.description).toContain("Staff+");
      expect(buildCommandQuickEmbed(adminCmd).data.description).toContain("Admin+");
      expect(buildCommandQuickEmbed(ownerCmd).data.description).toContain("Owner only");
    });
  });

  describe("buildCommandFullEmbed", () => {
    const mockCmd: CommandMetadata = {
      name: "accept",
      description: "Approve an application and grant verified role",
      category: "gate",
      permissionLevel: "reviewer",
      usage: "/accept [app:<code>] [user:<@user>]",
      options: [
        {
          name: "app",
          description: "Application short code",
          type: "string",
          required: false,
        },
        {
          name: "user",
          description: "User to accept",
          type: "user",
          required: false,
        },
      ],
      examples: ["/accept app:A1B2C3", "/accept user:@JohnDoe"],
      notes: "Provide exactly one identifier.",
      workflowTips: ["Use the app code for fastest workflow"],
      relatedCommands: ["reject", "kick"],
    };

    it("returns embed with description", () => {
      const embed = buildCommandFullEmbed(mockCmd);

      expect(embed.data.description).toBeDefined();
    });

    it("includes all quick view content", () => {
      const embed = buildCommandFullEmbed(mockCmd);

      expect(embed.data.description).toContain("/accept");
      expect(embed.data.description).toContain("Permission:");
      expect(embed.data.description).toContain("Category:");
    });

    it("includes options", () => {
      const embed = buildCommandFullEmbed(mockCmd);

      expect(embed.data.description).toContain("Options:");
      expect(embed.data.description).toContain("`app`");
      expect(embed.data.description).toContain("(optional)");
    });

    it("includes examples", () => {
      const embed = buildCommandFullEmbed(mockCmd);

      expect(embed.data.description).toContain("Examples:");
      expect(embed.data.description).toContain("/accept app:A1B2C3");
    });

    it("includes notes", () => {
      const embed = buildCommandFullEmbed(mockCmd);

      expect(embed.data.description).toContain("Notes:");
      expect(embed.data.description).toContain("exactly one identifier");
    });

    it("includes workflow tips", () => {
      const embed = buildCommandFullEmbed(mockCmd);

      expect(embed.data.description).toContain("Workflow Tips:");
      expect(embed.data.description).toContain("fastest workflow");
    });

    it("includes subcommands", () => {
      const cmdWithSubcmds: CommandMetadata = {
        ...mockCmd,
        subcommands: [
          { name: "setup", description: "Initialize config" },
          { name: "view", description: "View current config" },
        ],
      };

      const embed = buildCommandFullEmbed(cmdWithSubcmds);

      expect(embed.data.description).toContain("Subcommands:");
      expect(embed.data.description).toContain("`setup`");
      expect(embed.data.description).toContain("`view`");
    });

    it("includes subcommand groups", () => {
      const cmdWithGroups: CommandMetadata = {
        ...mockCmd,
        subcommandGroups: [
          {
            name: "set",
            description: "Set values",
            subcommands: [{ name: "mod_roles", description: "Set mod roles" }],
          },
        ],
      };

      const embed = buildCommandFullEmbed(cmdWithGroups);

      expect(embed.data.description).toContain("set");
      expect(embed.data.description).toContain("`mod_roles`");
    });

    it("limits subcommands to 8", () => {
      const cmdManySubcmds: CommandMetadata = {
        ...mockCmd,
        subcommands: Array.from({ length: 15 }, (_, i) => ({
          name: `sub${i}`,
          description: `Subcommand ${i}`,
        })),
      };

      const embed = buildCommandFullEmbed(cmdManySubcmds);

      expect(embed.data.description).toContain("...and 7 more");
    });

    it("limits subcommand groups to 3", () => {
      const cmdManyGroups: CommandMetadata = {
        ...mockCmd,
        subcommandGroups: Array.from({ length: 5 }, (_, i) => ({
          name: `group${i}`,
          description: `Group ${i}`,
          subcommands: [{ name: "sub", description: "Sub" }],
        })),
      };

      const embed = buildCommandFullEmbed(cmdManyGroups);

      expect(embed.data.description).toContain("...and 2 more groups");
    });

    it("truncates if description exceeds 4000 chars", () => {
      const cmdLong: CommandMetadata = {
        ...mockCmd,
        notes: "A".repeat(5000),
      };

      const embed = buildCommandFullEmbed(cmdLong);

      expect(embed.data.description!.length).toBeLessThanOrEqual(4100);
    });

    it("marks required options", () => {
      const cmdReqOpt: CommandMetadata = {
        ...mockCmd,
        options: [
          {
            name: "required_opt",
            description: "Required option",
            type: "string",
            required: true,
          },
        ],
      };

      const embed = buildCommandFullEmbed(cmdReqOpt);

      expect(embed.data.description).toContain("(required)");
    });
  });

  describe("buildSearchResultsEmbed", () => {
    const mockResults: CommandMetadata[] = [
      {
        name: "accept",
        description: "Approve an application",
        category: "gate",
        permissionLevel: "reviewer",
      },
      {
        name: "reject",
        description: "Reject an application",
        category: "gate",
        permissionLevel: "reviewer",
      },
    ];

    it("returns embed with description", () => {
      const embed = buildSearchResultsEmbed("test", mockResults);

      expect(embed.data.description).toBeDefined();
    });

    it("includes search query in title", () => {
      const embed = buildSearchResultsEmbed("application", mockResults);

      expect(embed.data.description).toContain("application");
    });

    it("truncates long query", () => {
      const longQuery = "A".repeat(50);
      const embed = buildSearchResultsEmbed(longQuery, mockResults);

      expect(embed.data.description).toContain("...");
    });

    it("lists matching commands", () => {
      const embed = buildSearchResultsEmbed("test", mockResults);

      expect(embed.data.description).toContain("/accept");
      expect(embed.data.description).toContain("/reject");
    });

    it("shows result count", () => {
      const embed = buildSearchResultsEmbed("test", mockResults);

      expect(embed.data.description).toContain("2 results");
      expect(embed.data.description).toContain("Found 2 command");
    });

    it("uses singular for 1 result", () => {
      const embed = buildSearchResultsEmbed("test", [mockResults[0]]);

      expect(embed.data.description).toContain("1 command");
    });

    it("shows suggestions when no results", () => {
      const embed = buildSearchResultsEmbed("xyznonexistent", []);

      expect(embed.data.description).toContain("No commands found");
      expect(embed.data.description).toContain("Suggestions:");
      expect(embed.data.description).toContain("Try different keywords");
    });

    it("sets search color for results", () => {
      const embed = buildSearchResultsEmbed("test", mockResults);

      expect(embed.data.color).toBe(0xfee75c); // yellow
    });

    it("sets error color for no results", () => {
      const embed = buildSearchResultsEmbed("test", []);

      expect(embed.data.color).toBe(0xef4444); // red
    });

    it("limits displayed results to 15", () => {
      const manyResults = Array.from({ length: 20 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
        category: "gate" as CommandCategory,
        permissionLevel: "reviewer" as const,
      }));

      const embed = buildSearchResultsEmbed("test", manyResults);

      expect(embed.data.description).toContain("...and 5 more results");
    });

    it("truncates long descriptions", () => {
      const resultLongDesc: CommandMetadata[] = [
        {
          name: "test",
          description: "A".repeat(100),
          category: "gate",
          permissionLevel: "reviewer",
        },
      ];

      const embed = buildSearchResultsEmbed("test", resultLongDesc);

      // Description should be truncated with ellipsis
      expect(embed.data.description).toContain("...");
    });
  });

  describe("buildErrorEmbed", () => {
    it("returns embed with description", () => {
      const embed = buildErrorEmbed("Test error");

      expect(embed.data.description).toBeDefined();
    });

    it("includes error message", () => {
      const embed = buildErrorEmbed("Command not found");

      expect(embed.data.description).toContain("Command not found");
    });

    it("includes Error header", () => {
      const embed = buildErrorEmbed("Test error");

      expect(embed.data.description).toContain("Error");
    });

    it("sets error color", () => {
      const embed = buildErrorEmbed("Test error");

      expect(embed.data.color).toBe(0xef4444); // red
    });

    it("sets timestamp", () => {
      const embed = buildErrorEmbed("Test error");

      expect(embed.data.timestamp).toBeDefined();
    });

    it("includes divider", () => {
      const embed = buildErrorEmbed("Test error");

      // Box drawing characters for divider
      expect(embed.data.description).toMatch(/[━]+/);
    });
  });
});
