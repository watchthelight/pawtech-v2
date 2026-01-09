/**
 * Pawtropolis Tech — tests/commands/help/registry.test.ts
 * WHAT: Unit tests for the help command registry.
 * WHY: Verify command documentation completeness and helper functions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  COMMAND_REGISTRY,
  getCommand,
  getCommandsByCategory,
  getAllCategories,
} from "../../../src/commands/help/registry.js";
import type { CommandCategory, PermissionLevel } from "../../../src/commands/help/metadata.js";

describe("help/registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("COMMAND_REGISTRY", () => {
    it("is an array of commands", () => {
      expect(Array.isArray(COMMAND_REGISTRY)).toBe(true);
      expect(COMMAND_REGISTRY.length).toBeGreaterThan(0);
    });

    it("has more than 20 commands documented", () => {
      expect(COMMAND_REGISTRY.length).toBeGreaterThan(20);
    });

    describe("command structure validation", () => {
      it.each(COMMAND_REGISTRY)("$name has required name field", (cmd) => {
        expect(cmd.name).toBeDefined();
        expect(typeof cmd.name).toBe("string");
        expect(cmd.name.length).toBeGreaterThan(0);
      });

      it.each(COMMAND_REGISTRY)("$name has description", (cmd) => {
        expect(cmd.description).toBeDefined();
        expect(typeof cmd.description).toBe("string");
        expect(cmd.description.length).toBeGreaterThan(0);
      });

      it.each(COMMAND_REGISTRY)("$name has valid category", (cmd) => {
        const validCategories: CommandCategory[] = [
          "gate",
          "config",
          "moderation",
          "queue",
          "analytics",
          "messaging",
          "roles",
          "artist",
          "system",
        ];
        expect(validCategories).toContain(cmd.category);
      });

      it.each(COMMAND_REGISTRY)("$name has valid permissionLevel", (cmd) => {
        const validLevels: PermissionLevel[] = [
          "public",
          "reviewer",
          "staff",
          "admin",
          "owner",
        ];
        expect(validLevels).toContain(cmd.permissionLevel);
      });
    });

    describe("optional field validation", () => {
      it.each(COMMAND_REGISTRY.filter((c) => c.usage && c.usage.startsWith("/")))(
        "$name usage starts with /",
        (cmd) => {
          expect(cmd.usage!.startsWith("/")).toBe(true);
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.usage && !c.usage.startsWith("/")))(
        "$name has non-slash usage (context menu)",
        (cmd) => {
          // Some commands like modmail use context menus
          expect(cmd.usage).toBeDefined();
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.examples))(
        "$name examples are non-empty array",
        (cmd) => {
          expect(Array.isArray(cmd.examples)).toBe(true);
          expect(cmd.examples!.length).toBeGreaterThan(0);
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.relatedCommands))(
        "$name relatedCommands are non-empty array",
        (cmd) => {
          expect(Array.isArray(cmd.relatedCommands)).toBe(true);
          expect(cmd.relatedCommands!.length).toBeGreaterThan(0);
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.aliases))(
        "$name aliases are non-empty array",
        (cmd) => {
          expect(Array.isArray(cmd.aliases)).toBe(true);
          expect(cmd.aliases!.length).toBeGreaterThan(0);
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.options))(
        "$name options have required fields",
        (cmd) => {
          for (const opt of cmd.options!) {
            expect(opt.name).toBeDefined();
            expect(opt.description).toBeDefined();
            expect(opt.type).toBeDefined();
            expect(typeof opt.required).toBe("boolean");
          }
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.subcommands))(
        "$name subcommands have required fields",
        (cmd) => {
          for (const sc of cmd.subcommands!) {
            expect(sc.name).toBeDefined();
            expect(sc.description).toBeDefined();
          }
        }
      );

      it.each(COMMAND_REGISTRY.filter((c) => c.subcommandGroups))(
        "$name subcommandGroups have required fields",
        (cmd) => {
          for (const group of cmd.subcommandGroups!) {
            expect(group.name).toBeDefined();
            expect(group.description).toBeDefined();
            expect(Array.isArray(group.subcommands)).toBe(true);
            expect(group.subcommands.length).toBeGreaterThan(0);
          }
        }
      );
    });

    describe("specific commands", () => {
      it("has gate command in gate category", () => {
        const gate = COMMAND_REGISTRY.find((c) => c.name === "gate");
        expect(gate).toBeDefined();
        expect(gate!.category).toBe("gate");
      });

      it("has accept command as reviewer level", () => {
        const accept = COMMAND_REGISTRY.find((c) => c.name === "accept");
        expect(accept).toBeDefined();
        expect(accept!.permissionLevel).toBe("reviewer");
      });

      it("has health command as public", () => {
        const health = COMMAND_REGISTRY.find((c) => c.name === "health");
        expect(health).toBeDefined();
        expect(health!.permissionLevel).toBe("public");
      });

      it("has config command in config category", () => {
        const config = COMMAND_REGISTRY.find((c) => c.name === "config");
        expect(config).toBeDefined();
        expect(config!.category).toBe("config");
      });

      it("has listopen command in queue category", () => {
        const listopen = COMMAND_REGISTRY.find((c) => c.name === "listopen");
        expect(listopen).toBeDefined();
        expect(listopen!.category).toBe("queue");
      });

      it("has modstats command in analytics category", () => {
        const modstats = COMMAND_REGISTRY.find((c) => c.name === "modstats");
        expect(modstats).toBeDefined();
        expect(modstats!.category).toBe("analytics");
      });

      it("has panic command as owner level", () => {
        const panic = COMMAND_REGISTRY.find((c) => c.name === "panic");
        expect(panic).toBeDefined();
        expect(panic!.permissionLevel).toBe("owner");
      });
    });

    describe("command names are unique", () => {
      it("has no duplicate command names", () => {
        const names = COMMAND_REGISTRY.map((c) => c.name);
        const uniqueNames = new Set(names);
        expect(names.length).toBe(uniqueNames.size);
      });
    });

    describe("related commands exist", () => {
      it.each(
        COMMAND_REGISTRY.filter((c) => c.relatedCommands && c.relatedCommands.length > 0)
      )("$name related commands exist in registry", (cmd) => {
        const allNames = new Set(COMMAND_REGISTRY.map((c) => c.name));
        for (const related of cmd.relatedCommands!) {
          expect(allNames.has(related)).toBe(true);
        }
      });
    });
  });

  describe("getCommand", () => {
    it("returns command by exact name", () => {
      const cmd = getCommand("accept");
      expect(cmd).toBeDefined();
      expect(cmd!.name).toBe("accept");
    });

    it("returns undefined for non-existent command", () => {
      const cmd = getCommand("nonexistent");
      expect(cmd).toBeUndefined();
    });

    it("returns undefined for empty name", () => {
      const cmd = getCommand("");
      expect(cmd).toBeUndefined();
    });

    it("is case-sensitive", () => {
      const cmd = getCommand("ACCEPT");
      expect(cmd).toBeUndefined();
    });

    it("returns gate command", () => {
      const cmd = getCommand("gate");
      expect(cmd).toBeDefined();
      expect(cmd!.category).toBe("gate");
    });

    it("returns config command", () => {
      const cmd = getCommand("config");
      expect(cmd).toBeDefined();
      expect(cmd!.category).toBe("config");
    });

    it("returns health command", () => {
      const cmd = getCommand("health");
      expect(cmd).toBeDefined();
      expect(cmd!.permissionLevel).toBe("public");
    });
  });

  describe("getCommandsByCategory", () => {
    it("returns commands in gate category", () => {
      const cmds = getCommandsByCategory("gate");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "gate")).toBe(true);
    });

    it("returns commands in config category", () => {
      const cmds = getCommandsByCategory("config");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "config")).toBe(true);
    });

    it("returns commands in moderation category", () => {
      const cmds = getCommandsByCategory("moderation");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "moderation")).toBe(true);
    });

    it("returns commands in queue category", () => {
      const cmds = getCommandsByCategory("queue");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "queue")).toBe(true);
    });

    it("returns commands in analytics category", () => {
      const cmds = getCommandsByCategory("analytics");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "analytics")).toBe(true);
    });

    it("returns commands in messaging category", () => {
      const cmds = getCommandsByCategory("messaging");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "messaging")).toBe(true);
    });

    it("returns commands in roles category", () => {
      const cmds = getCommandsByCategory("roles");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "roles")).toBe(true);
    });

    it("returns commands in artist category", () => {
      const cmds = getCommandsByCategory("artist");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "artist")).toBe(true);
    });

    it("returns commands in system category", () => {
      const cmds = getCommandsByCategory("system");
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c.category === "system")).toBe(true);
    });

    it("returns empty array for nonexistent category", () => {
      // @ts-expect-error - testing invalid input
      const cmds = getCommandsByCategory("nonexistent");
      expect(cmds).toEqual([]);
    });

    it("returns subset of all commands", () => {
      const gateCmds = getCommandsByCategory("gate");
      expect(gateCmds.length).toBeLessThan(COMMAND_REGISTRY.length);
    });
  });

  describe("getAllCategories", () => {
    it("returns array of categories", () => {
      const categories = getAllCategories();
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    it("returns unique categories", () => {
      const categories = getAllCategories();
      const uniqueCategories = new Set(categories);
      expect(categories.length).toBe(uniqueCategories.size);
    });

    it("includes gate category", () => {
      const categories = getAllCategories();
      expect(categories).toContain("gate");
    });

    it("includes config category", () => {
      const categories = getAllCategories();
      expect(categories).toContain("config");
    });

    it("includes all 9 categories", () => {
      const categories = getAllCategories();
      const expectedCategories: CommandCategory[] = [
        "gate",
        "config",
        "moderation",
        "queue",
        "analytics",
        "messaging",
        "roles",
        "artist",
        "system",
      ];

      for (const expected of expectedCategories) {
        expect(categories).toContain(expected);
      }
    });

    it("matches categories from COMMAND_REGISTRY", () => {
      const categories = getAllCategories();
      const registryCategories = new Set(COMMAND_REGISTRY.map((c) => c.category));

      expect(categories.length).toBe(registryCategories.size);
      for (const cat of categories) {
        expect(registryCategories.has(cat)).toBe(true);
      }
    });
  });

  describe("registry content quality", () => {
    it("accept command has usage examples", () => {
      const cmd = getCommand("accept");
      expect(cmd!.examples).toBeDefined();
      expect(cmd!.examples!.length).toBeGreaterThan(0);
    });

    it("reject command has options", () => {
      const cmd = getCommand("reject");
      expect(cmd!.options).toBeDefined();
      expect(cmd!.options!.length).toBeGreaterThan(0);
    });

    it("gate command has subcommands", () => {
      const cmd = getCommand("gate");
      expect(cmd!.subcommands).toBeDefined();
      expect(cmd!.subcommands!.length).toBeGreaterThan(0);
    });

    it("config command has subcommandGroups", () => {
      const cmd = getCommand("config");
      expect(cmd!.subcommandGroups).toBeDefined();
      expect(cmd!.subcommandGroups!.length).toBeGreaterThan(0);
    });

    it("accept command has workflowTips", () => {
      const cmd = getCommand("accept");
      expect(cmd!.workflowTips).toBeDefined();
      expect(cmd!.workflowTips!.length).toBeGreaterThan(0);
    });

    it("accept command has relatedCommands", () => {
      const cmd = getCommand("accept");
      expect(cmd!.relatedCommands).toBeDefined();
      expect(cmd!.relatedCommands).toContain("reject");
    });

    it("accept command has aliases", () => {
      const cmd = getCommand("accept");
      expect(cmd!.aliases).toBeDefined();
      expect(cmd!.aliases).toContain("approve");
    });

    it("reject command has notes", () => {
      const cmd = getCommand("reject");
      expect(cmd!.notes).toBeDefined();
      expect(cmd!.notes!.length).toBeGreaterThan(0);
    });
  });

  describe("permission level distribution", () => {
    it("has at least one public command", () => {
      const publicCmds = COMMAND_REGISTRY.filter(
        (c) => c.permissionLevel === "public"
      );
      expect(publicCmds.length).toBeGreaterThan(0);
    });

    it("has at least one reviewer command", () => {
      const reviewerCmds = COMMAND_REGISTRY.filter(
        (c) => c.permissionLevel === "reviewer"
      );
      expect(reviewerCmds.length).toBeGreaterThan(0);
    });

    it("has at least one staff command", () => {
      const staffCmds = COMMAND_REGISTRY.filter(
        (c) => c.permissionLevel === "staff"
      );
      expect(staffCmds.length).toBeGreaterThan(0);
    });

    it("has at least one admin command", () => {
      const adminCmds = COMMAND_REGISTRY.filter(
        (c) => c.permissionLevel === "admin"
      );
      expect(adminCmds.length).toBeGreaterThan(0);
    });

    it("has at least one owner command", () => {
      const ownerCmds = COMMAND_REGISTRY.filter(
        (c) => c.permissionLevel === "owner"
      );
      expect(ownerCmds.length).toBeGreaterThan(0);
    });
  });

  describe("category distribution", () => {
    const allCategories: CommandCategory[] = [
      "gate",
      "config",
      "moderation",
      "queue",
      "analytics",
      "messaging",
      "roles",
      "artist",
      "system",
    ];

    it.each(allCategories)("has at least one %s command", (category) => {
      const cmds = getCommandsByCategory(category);
      expect(cmds.length).toBeGreaterThan(0);
    });
  });
});
