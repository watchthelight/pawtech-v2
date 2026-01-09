/**
 * Pawtropolis Tech — tests/commands/help/components.test.ts
 * WHAT: Unit tests for help UI component builders.
 * WHY: Verify button/select/modal construction for all help views.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discord.js components
vi.mock("discord.js", () => ({
  ActionRowBuilder: class MockActionRowBuilder {
    components: unknown[] = [];
    addComponents(...components: unknown[]) {
      this.components.push(...components);
      return this;
    }
  },
  ButtonBuilder: class MockButtonBuilder {
    data: {
      custom_id?: string;
      label?: string;
      style?: number;
    } = {};

    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }

    setLabel(label: string) {
      this.data.label = label;
      return this;
    }

    setStyle(style: number) {
      this.data.style = style;
      return this;
    }
  },
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
  StringSelectMenuBuilder: class MockSelectMenuBuilder {
    data: {
      custom_id?: string;
      placeholder?: string;
      options?: Array<{ label: string; description: string; value: string }>;
    } = {};

    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }

    setPlaceholder(placeholder: string) {
      this.data.placeholder = placeholder;
      return this;
    }

    addOptions(options: Array<{ label: string; description: string; value: string }>) {
      this.data.options = options;
      return this;
    }
  },
  ModalBuilder: class MockModalBuilder {
    data: {
      custom_id?: string;
      title?: string;
      components?: unknown[];
    } = {};

    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }

    setTitle(title: string) {
      this.data.title = title;
      return this;
    }

    addComponents(component: unknown) {
      this.data.components = this.data.components || [];
      this.data.components.push(component);
      return this;
    }
  },
  TextInputBuilder: class MockTextInputBuilder {
    data: {
      custom_id?: string;
      label?: string;
      placeholder?: string;
      style?: number;
      required?: boolean;
      min_length?: number;
      max_length?: number;
    } = {};

    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }

    setLabel(label: string) {
      this.data.label = label;
      return this;
    }

    setPlaceholder(placeholder: string) {
      this.data.placeholder = placeholder;
      return this;
    }

    setStyle(style: number) {
      this.data.style = style;
      return this;
    }

    setRequired(required: boolean) {
      this.data.required = required;
      return this;
    }

    setMinLength(length: number) {
      this.data.min_length = length;
      return this;
    }

    setMaxLength(length: number) {
      this.data.max_length = length;
      return this;
    }
  },
  TextInputStyle: {
    Short: 1,
    Paragraph: 2,
  },
}));

import {
  buildOverviewComponents,
  buildCategoryComponents,
  buildCommandComponents,
  buildSearchComponents,
  buildSearchModal,
  buildErrorComponents,
} from "../../../src/commands/help/components.js";
import type { CommandMetadata, CommandCategory } from "../../../src/commands/help/metadata.js";

describe("help/components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildOverviewComponents", () => {
    it("returns array of action rows", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 5],
        ["config", 3],
      ]);

      const result = buildOverviewComponents(counts);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("creates category buttons for non-empty categories", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 5],
        ["config", 0],
        ["moderation", 3],
      ]);

      const result = buildOverviewComponents(counts);

      // First row should have category buttons
      const categoryRow = result[0];
      expect(categoryRow.components.length).toBe(2); // gate and moderation only
    });

    it("splits categories across two rows if more than 5", () => {
      const counts = new Map<CommandCategory, number>([
        ["gate", 1],
        ["config", 1],
        ["moderation", 1],
        ["queue", 1],
        ["analytics", 1],
        ["messaging", 1],
        ["roles", 1],
      ]);

      const result = buildOverviewComponents(counts);

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].components.length).toBe(5);
      expect(result[1].components.length).toBe(2);
    });

    it("includes search button", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const result = buildOverviewComponents(counts);

      const searchRow = result[result.length - 1];
      const searchBtn = searchRow.components[0] as {
        data: { label: string; custom_id: string };
      };
      expect(searchBtn.data.label).toBe("Search...");
      expect(searchBtn.data.custom_id).toBe("help:search:modal");
    });

    it("uses secondary style for category buttons", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const result = buildOverviewComponents(counts);

      const categoryBtn = result[0].components[0] as { data: { style: number } };
      expect(categoryBtn.data.style).toBe(2); // Secondary
    });

    it("uses primary style for search button", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const result = buildOverviewComponents(counts);

      const searchRow = result[result.length - 1];
      const searchBtn = searchRow.components[0] as { data: { style: number } };
      expect(searchBtn.data.style).toBe(1); // Primary
    });

    it("sets correct custom IDs for category buttons", () => {
      const counts = new Map<CommandCategory, number>([["gate", 1]]);

      const result = buildOverviewComponents(counts);

      const categoryBtn = result[0].components[0] as {
        data: { custom_id: string };
      };
      expect(categoryBtn.data.custom_id).toBe("help:cat:gate");
    });

    it("handles empty category counts", () => {
      const counts = new Map<CommandCategory, number>();

      const result = buildOverviewComponents(counts);

      // Should still have search row
      expect(result.length).toBe(1);
    });
  });

  describe("buildCategoryComponents", () => {
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

    it("returns array of action rows", () => {
      const result = buildCategoryComponents("gate", mockCommands, 0, 1);

      expect(Array.isArray(result)).toBe(true);
    });

    it("includes back button", () => {
      const result = buildCategoryComponents("gate", mockCommands, 0, 1);

      const navRow = result[0];
      const backBtn = navRow.components[0] as { data: { label: string } };
      expect(backBtn.data.label).toBe("Back");
    });

    it("includes pagination buttons when multiple pages", () => {
      const result = buildCategoryComponents("gate", mockCommands, 1, 3);

      const navRow = result[0];
      const labels = navRow.components.map(
        (c) => (c as { data: { label: string } }).data.label
      );
      expect(labels).toContain("Prev");
      expect(labels).toContain("Next");
    });

    it("hides Prev on first page", () => {
      const result = buildCategoryComponents("gate", mockCommands, 0, 3);

      const navRow = result[0];
      const labels = navRow.components.map(
        (c) => (c as { data: { label: string } }).data.label
      );
      expect(labels).not.toContain("Prev");
      expect(labels).toContain("Next");
    });

    it("hides Next on last page", () => {
      const result = buildCategoryComponents("gate", mockCommands, 2, 3);

      const navRow = result[0];
      const labels = navRow.components.map(
        (c) => (c as { data: { label: string } }).data.label
      );
      expect(labels).toContain("Prev");
      expect(labels).not.toContain("Next");
    });

    it("hides pagination for single page", () => {
      const result = buildCategoryComponents("gate", mockCommands, 0, 1);

      const navRow = result[0];
      const labels = navRow.components.map(
        (c) => (c as { data: { label: string } }).data.label
      );
      expect(labels).not.toContain("Prev");
      expect(labels).not.toContain("Next");
    });

    it("includes command select menu", () => {
      const result = buildCategoryComponents("gate", mockCommands, 0, 1);

      expect(result.length).toBe(2);
      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { custom_id: string; options: unknown[] };
      };
      expect(select.data.custom_id).toBe("help:select:cmd:gate");
    });

    it("populates select menu with command options", () => {
      const result = buildCategoryComponents("gate", mockCommands, 0, 1);

      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { options: Array<{ label: string; value: string }> };
      };
      expect(select.data.options).toHaveLength(2);
      expect(select.data.options[0].value).toBe("accept");
      expect(select.data.options[1].value).toBe("reject");
    });

    it("truncates long descriptions in select options", () => {
      const longDescCmd: CommandMetadata[] = [
        {
          name: "test",
          description: "A".repeat(100),
          category: "gate",
          permissionLevel: "reviewer",
        },
      ];

      const result = buildCategoryComponents("gate", longDescCmd, 0, 1);

      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { options: Array<{ description: string }> };
      };
      expect(select.data.options[0].description.length).toBeLessThanOrEqual(53);
    });

    it("handles empty commands array", () => {
      const result = buildCategoryComponents("gate", [], 0, 1);

      // Should only have nav row, no select menu
      expect(result.length).toBe(1);
    });

    it("limits select options to 25", () => {
      const manyCommands = Array.from({ length: 30 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
        category: "gate" as CommandCategory,
        permissionLevel: "reviewer" as const,
      }));

      const result = buildCategoryComponents("gate", manyCommands, 0, 1);

      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { options: unknown[] };
      };
      expect(select.data.options.length).toBeLessThanOrEqual(25);
    });
  });

  describe("buildCommandComponents", () => {
    const mockCmd: CommandMetadata = {
      name: "accept",
      description: "Approve an application",
      category: "gate",
      permissionLevel: "reviewer",
      relatedCommands: ["reject", "kick"],
    };

    it("returns array of action rows", () => {
      const result = buildCommandComponents(mockCmd, false);

      expect(Array.isArray(result)).toBe(true);
    });

    it("includes back to category button", () => {
      const result = buildCommandComponents(mockCmd, false);

      const navRow = result[0];
      const backBtn = navRow.components[0] as { data: { label: string } };
      expect(backBtn.data.label).toBe("Back to Category");
    });

    it("includes overview button", () => {
      const result = buildCommandComponents(mockCmd, false);

      const navRow = result[0];
      const overviewBtn = navRow.components[1] as { data: { label: string } };
      expect(overviewBtn.data.label).toBe("Overview");
    });

    it("includes toggle button for quick/full view", () => {
      const result = buildCommandComponents(mockCmd, false);

      const navRow = result[0];
      const toggleBtn = navRow.components[2] as { data: { label: string } };
      expect(toggleBtn.data.label).toBe("Full Details");
    });

    it("shows Quick View button when in full mode", () => {
      const result = buildCommandComponents(mockCmd, true);

      const navRow = result[0];
      const toggleBtn = navRow.components[2] as { data: { label: string } };
      expect(toggleBtn.data.label).toBe("Quick View");
    });

    it("includes related command buttons", () => {
      const result = buildCommandComponents(mockCmd, false);

      expect(result.length).toBe(2);
      const relatedRow = result[1];
      expect(relatedRow.components.length).toBe(2);
    });

    it("limits related command buttons to 4", () => {
      const cmdManyRelated: CommandMetadata = {
        ...mockCmd,
        relatedCommands: ["a", "b", "c", "d", "e", "f"],
      };

      const result = buildCommandComponents(cmdManyRelated, false);

      const relatedRow = result[1];
      expect(relatedRow.components.length).toBe(4);
    });

    it("omits related row when no related commands", () => {
      const cmdNoRelated: CommandMetadata = {
        ...mockCmd,
        relatedCommands: undefined,
      };

      const result = buildCommandComponents(cmdNoRelated, false);

      expect(result.length).toBe(1);
    });

    it("sets correct custom ID for back to category", () => {
      const result = buildCommandComponents(mockCmd, false);

      const navRow = result[0];
      const backBtn = navRow.components[0] as { data: { custom_id: string } };
      expect(backBtn.data.custom_id).toBe("help:cat:gate");
    });

    it("sets correct custom ID for toggle button", () => {
      const resultQuick = buildCommandComponents(mockCmd, false);
      const resultFull = buildCommandComponents(mockCmd, true);

      const toggleQuick = resultQuick[0].components[2] as {
        data: { custom_id: string };
      };
      const toggleFull = resultFull[0].components[2] as {
        data: { custom_id: string };
      };

      expect(toggleQuick.data.custom_id).toBe("help:cmd:accept:full");
      expect(toggleFull.data.custom_id).toBe("help:cmd:accept");
    });

    it("sets correct custom IDs for related command buttons", () => {
      const result = buildCommandComponents(mockCmd, false);

      const relatedRow = result[1];
      const rejectBtn = relatedRow.components[0] as {
        data: { custom_id: string };
      };
      expect(rejectBtn.data.custom_id).toBe("help:cmd:reject");
    });
  });

  describe("buildSearchComponents", () => {
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

    it("returns array of action rows", () => {
      const result = buildSearchComponents("abc12345", mockResults);

      expect(Array.isArray(result)).toBe(true);
    });

    it("includes back to overview button", () => {
      const result = buildSearchComponents("abc12345", mockResults);

      const navRow = result[0];
      const backBtn = navRow.components[0] as { data: { label: string } };
      expect(backBtn.data.label).toBe("Back to Overview");
    });

    it("includes new search button", () => {
      const result = buildSearchComponents("abc12345", mockResults);

      const navRow = result[0];
      const searchBtn = navRow.components[1] as { data: { label: string } };
      expect(searchBtn.data.label).toBe("New Search");
    });

    it("includes result select menu when results exist", () => {
      const result = buildSearchComponents("abc12345", mockResults);

      expect(result.length).toBe(2);
      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { custom_id: string };
      };
      expect(select.data.custom_id).toBe("help:select:search:abc12345");
    });

    it("omits select menu when no results", () => {
      const result = buildSearchComponents("abc12345", []);

      expect(result.length).toBe(1);
    });

    it("populates select menu with result options", () => {
      const result = buildSearchComponents("abc12345", mockResults);

      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { options: Array<{ value: string }> };
      };
      expect(select.data.options).toHaveLength(2);
      expect(select.data.options[0].value).toBe("accept");
    });

    it("limits select options to 25", () => {
      const manyResults = Array.from({ length: 30 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
        category: "gate" as CommandCategory,
        permissionLevel: "reviewer" as const,
      }));

      const result = buildSearchComponents("abc12345", manyResults);

      const selectRow = result[1];
      const select = selectRow.components[0] as {
        data: { options: unknown[] };
      };
      expect(select.data.options.length).toBeLessThanOrEqual(25);
    });
  });

  describe("buildSearchModal", () => {
    it("returns modal with correct custom ID", () => {
      const result = buildSearchModal();

      expect(result.data.custom_id).toBe("help:modal:search");
    });

    it("sets modal title", () => {
      const result = buildSearchModal();

      expect(result.data.title).toBe("Search Commands");
    });

    it("includes text input component", () => {
      const result = buildSearchModal();

      expect(result.data.components).toHaveLength(1);
    });

    it("configures text input with correct custom ID", () => {
      const result = buildSearchModal();

      const row = result.data.components![0] as {
        components: Array<{ data: { custom_id: string } }>;
      };
      const input = row.components[0];
      expect(input.data.custom_id).toBe("help:modal:search:query");
    });

    it("sets text input as required", () => {
      const result = buildSearchModal();

      const row = result.data.components![0] as {
        components: Array<{ data: { required: boolean } }>;
      };
      const input = row.components[0];
      expect(input.data.required).toBe(true);
    });

    it("sets min length of 2", () => {
      const result = buildSearchModal();

      const row = result.data.components![0] as {
        components: Array<{ data: { min_length: number } }>;
      };
      const input = row.components[0];
      expect(input.data.min_length).toBe(2);
    });

    it("sets max length of 100", () => {
      const result = buildSearchModal();

      const row = result.data.components![0] as {
        components: Array<{ data: { max_length: number } }>;
      };
      const input = row.components[0];
      expect(input.data.max_length).toBe(100);
    });
  });

  describe("buildErrorComponents", () => {
    it("returns array with one action row", () => {
      const result = buildErrorComponents();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it("includes back to help button", () => {
      const result = buildErrorComponents();

      const row = result[0];
      const btn = row.components[0] as { data: { label: string } };
      expect(btn.data.label).toBe("Back to Help");
    });

    it("uses primary style for back button", () => {
      const result = buildErrorComponents();

      const row = result[0];
      const btn = row.components[0] as { data: { style: number } };
      expect(btn.data.style).toBe(1); // Primary
    });

    it("sets correct custom ID for back button", () => {
      const result = buildErrorComponents();

      const row = result[0];
      const btn = row.components[0] as { data: { custom_id: string } };
      expect(btn.data.custom_id).toBe("help:overview");
    });
  });
});
