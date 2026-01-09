/**
 * Pawtropolis Tech — tests/commands/stats/data.test.ts
 * WHAT: Unit tests for /stats command builder configuration.
 * WHY: Verify command structure, subcommands, and options are correctly defined.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies to allow importing data
vi.mock("discord.js", async () => {
  const actual = await vi.importActual("discord.js");
  return actual;
});

import { data } from "../../../src/commands/stats/data.js";

describe("stats/data (SlashCommandBuilder)", () => {
  describe("command metadata", () => {
    it("has correct name", () => {
      expect(data.name).toBe("stats");
    });

    it("has correct description", () => {
      expect(data.description).toBe("Analytics and performance metrics");
    });

    it("is not usable in DMs", () => {
      expect(data.dm_permission).toBe(false);
    });

    it("has null default member permissions (checked at runtime)", () => {
      expect(data.default_member_permissions).toBeNull();
    });
  });

  describe("subcommands", () => {
    const getSubcommand = (name: string) => {
      return data.options.find((opt: any) => opt.name === name);
    };

    describe("activity subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("activity");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("activity");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("activity");
        expect(subcommand?.description).toBe("View server activity heatmap with trends analysis");
      });

      it("has weeks option", () => {
        const subcommand = getSubcommand("activity");
        const weeksOption = subcommand?.options?.find((opt: any) => opt.name === "weeks");
        expect(weeksOption).toBeDefined();
        expect(weeksOption?.required).toBe(false);
        expect(weeksOption?.min_value).toBe(1);
        expect(weeksOption?.max_value).toBe(8);
      });
    });

    describe("approval-rate subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("approval-rate");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("approval-rate");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("approval-rate");
        expect(subcommand?.description).toBe("View server-wide approval/rejection rate analytics");
      });

      it("has days option", () => {
        const subcommand = getSubcommand("approval-rate");
        const daysOption = subcommand?.options?.find((opt: any) => opt.name === "days");
        expect(daysOption).toBeDefined();
        expect(daysOption?.required).toBe(false);
        expect(daysOption?.min_value).toBe(1);
        expect(daysOption?.max_value).toBe(365);
      });
    });

    describe("leaderboard subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("leaderboard");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("leaderboard");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("leaderboard");
        expect(subcommand?.description).toBe("Show leaderboard of moderators by decisions");
      });

      it("has days option", () => {
        const subcommand = getSubcommand("leaderboard");
        const daysOption = subcommand?.options?.find((opt: any) => opt.name === "days");
        expect(daysOption).toBeDefined();
        expect(daysOption?.required).toBe(false);
        expect(daysOption?.min_value).toBe(1);
        expect(daysOption?.max_value).toBe(365);
      });

      it("has export option", () => {
        const subcommand = getSubcommand("leaderboard");
        const exportOption = subcommand?.options?.find((opt: any) => opt.name === "export");
        expect(exportOption).toBeDefined();
        expect(exportOption?.required).toBe(false);
      });
    });

    describe("user subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("user");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("user");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("user");
        expect(subcommand?.description).toBe("Show detailed stats for a specific moderator");
      });

      it("has required moderator option", () => {
        const subcommand = getSubcommand("user");
        const moderatorOption = subcommand?.options?.find((opt: any) => opt.name === "moderator");
        expect(moderatorOption).toBeDefined();
        expect(moderatorOption?.required).toBe(true);
      });

      it("has optional days option", () => {
        const subcommand = getSubcommand("user");
        const daysOption = subcommand?.options?.find((opt: any) => opt.name === "days");
        expect(daysOption).toBeDefined();
        expect(daysOption?.required).toBe(false);
        expect(daysOption?.min_value).toBe(1);
        expect(daysOption?.max_value).toBe(365);
      });
    });

    describe("export subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("export");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("export");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("export");
        expect(subcommand?.description).toBe("Export all moderator metrics as CSV");
      });

      it("has days option", () => {
        const subcommand = getSubcommand("export");
        const daysOption = subcommand?.options?.find((opt: any) => opt.name === "days");
        expect(daysOption).toBeDefined();
        expect(daysOption?.required).toBe(false);
        expect(daysOption?.min_value).toBe(1);
        expect(daysOption?.max_value).toBe(365);
      });
    });

    describe("reset subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("reset");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("reset");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("reset");
        expect(subcommand?.description).toBe("Clear and rebuild moderator statistics (password required)");
      });

      it("has required password option", () => {
        const subcommand = getSubcommand("reset");
        const passwordOption = subcommand?.options?.find((opt: any) => opt.name === "password");
        expect(passwordOption).toBeDefined();
        expect(passwordOption?.required).toBe(true);
      });
    });

    describe("history subcommand", () => {
      it("exists with correct name", () => {
        const subcommand = getSubcommand("history");
        expect(subcommand).toBeDefined();
        expect(subcommand?.name).toBe("history");
      });

      it("has correct description", () => {
        const subcommand = getSubcommand("history");
        expect(subcommand?.description).toBe("View moderator action history (leadership only)");
      });

      it("has required moderator option", () => {
        const subcommand = getSubcommand("history");
        const moderatorOption = subcommand?.options?.find((opt: any) => opt.name === "moderator");
        expect(moderatorOption).toBeDefined();
        expect(moderatorOption?.required).toBe(true);
      });

      it("has optional days option", () => {
        const subcommand = getSubcommand("history");
        const daysOption = subcommand?.options?.find((opt: any) => opt.name === "days");
        expect(daysOption).toBeDefined();
        expect(daysOption?.required).toBe(false);
        expect(daysOption?.min_value).toBe(1);
        expect(daysOption?.max_value).toBe(365);
      });

      it("has optional export option", () => {
        const subcommand = getSubcommand("history");
        const exportOption = subcommand?.options?.find((opt: any) => opt.name === "export");
        expect(exportOption).toBeDefined();
        expect(exportOption?.required).toBe(false);
      });
    });
  });

  describe("subcommand count", () => {
    it("has exactly 7 subcommands", () => {
      expect(data.options).toHaveLength(7);
    });

    it("all options are subcommands", () => {
      // Verify by checking that options have name and description (subcommand properties)
      for (const option of data.options) {
        expect((option as any).name).toBeDefined();
        expect((option as any).description).toBeDefined();
      }
    });
  });

  describe("serialization", () => {
    it("can be serialized to JSON", () => {
      expect(() => data.toJSON()).not.toThrow();
    });

    it("produces valid JSON structure", () => {
      const json = data.toJSON();
      expect(json.name).toBe("stats");
      expect(json.description).toBe("Analytics and performance metrics");
      expect(json.options).toHaveLength(7);
    });
  });
});
