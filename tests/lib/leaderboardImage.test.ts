/**
 * Pawtropolis Tech — tests/lib/leaderboardImage.test.ts
 * WHAT: Unit tests for leaderboard image generation.
 * WHY: Verify image generation and helper functions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock canvas - we're not testing actual canvas rendering
vi.mock("canvas", () => ({
  createCanvas: vi.fn((width: number, height: number) => ({
    getContext: () => ({
      fillStyle: "",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeStyle: "",
      stroke: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      lineWidth: 1,
      lineCap: "",
      lineJoin: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      measureText: vi.fn(() => ({ width: 100 })),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
    }),
    toBuffer: vi.fn(() => Buffer.from("mock-png-image")),
    width,
    height,
  })),
}));

import { generateLeaderboardImage, generateStatsImage, type ModStats } from "../../src/lib/leaderboardImage.js";

describe("leaderboardImage", () => {
  describe("generateLeaderboardImage", () => {
    const mockStats: ModStats[] = [
      {
        rank: 1,
        displayName: "TopMod",
        total: 100,
        approvals: 80,
        rejections: 15,
        modmail: 5,
        avgTimeSeconds: 120,
        roleColor: "#E91E63",
      },
      {
        rank: 2,
        displayName: "SecondMod",
        total: 75,
        approvals: 60,
        rejections: 10,
        modmail: 5,
        avgTimeSeconds: 180,
      },
      {
        rank: 3,
        displayName: "ThirdMod",
        total: 50,
        approvals: 40,
        rejections: 8,
        modmail: 2,
        avgTimeSeconds: 300,
        nameGradient: {
          colors: ["#FF0000", "#0000FF"],
          angle: 90,
        },
      },
    ];

    it("returns a buffer", async () => {
      const result = await generateLeaderboardImage(mockStats);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles empty stats array", async () => {
      const result = await generateLeaderboardImage([]);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles single stat entry", async () => {
      const result = await generateLeaderboardImage([mockStats[0]]);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles stats with zero values", async () => {
      const zeroStats: ModStats[] = [
        {
          rank: 1,
          displayName: "ZeroMod",
          total: 0,
          approvals: 0,
          rejections: 0,
          modmail: 0,
          avgTimeSeconds: 0,
        },
      ];
      const result = await generateLeaderboardImage(zeroStats);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles stats with long display names", async () => {
      const longNameStats: ModStats[] = [
        {
          rank: 1,
          displayName: "ThisIsAVeryLongDisplayNameThatShouldBeTruncated",
          total: 10,
          approvals: 5,
          rejections: 3,
          modmail: 2,
          avgTimeSeconds: 60,
        },
      ];
      const result = await generateLeaderboardImage(longNameStats);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles stats with emoji in display name", async () => {
      const emojiStats: ModStats[] = [
        {
          rank: 1,
          displayName: "Mod 🎉 Name ✨",
          total: 10,
          approvals: 5,
          rejections: 3,
          modmail: 2,
          avgTimeSeconds: 60,
        },
      ];
      const result = await generateLeaderboardImage(emojiStats);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles stats with nitro gradient", async () => {
      const gradientStats: ModStats[] = [
        {
          rank: 1,
          displayName: "NitroUser",
          total: 10,
          approvals: 5,
          rejections: 3,
          modmail: 2,
          avgTimeSeconds: 60,
          nameGradient: {
            colors: ["#FF0000", "#00FF00", "#0000FF"],
            angle: 45,
          },
        },
      ];
      const result = await generateLeaderboardImage(gradientStats);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles stats with black role color (treated as no color)", async () => {
      const blackRoleStats: ModStats[] = [
        {
          rank: 1,
          displayName: "DefaultColorMod",
          total: 10,
          approvals: 5,
          rejections: 3,
          modmail: 2,
          avgTimeSeconds: 60,
          roleColor: "#000000",
        },
      ];
      const result = await generateLeaderboardImage(blackRoleStats);
      expect(result).toBeInstanceOf(Buffer);
    });

    it("handles large time values", async () => {
      const longTimeStats: ModStats[] = [
        {
          rank: 1,
          displayName: "SlowMod",
          total: 10,
          approvals: 5,
          rejections: 3,
          modmail: 2,
          avgTimeSeconds: 7200, // 2 hours
        },
      ];
      const result = await generateLeaderboardImage(longTimeStats);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe("generateStatsImage (legacy alias)", () => {
    it("returns a buffer", async () => {
      const stats: ModStats[] = [
        {
          rank: 1,
          displayName: "Mod",
          total: 10,
          approvals: 8,
          rejections: 2,
          modmail: 0,
          avgTimeSeconds: 60,
        },
      ];
      const result = await generateStatsImage(stats);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe("ModStats interface", () => {
    it("accepts minimal stats object", () => {
      const minimal: ModStats = {
        rank: 1,
        displayName: "Test",
        total: 0,
        approvals: 0,
        rejections: 0,
        modmail: 0,
        avgTimeSeconds: 0,
      };
      expect(minimal.rank).toBe(1);
      expect(minimal.displayName).toBe("Test");
    });

    it("accepts full stats object with all optional fields", () => {
      const full: ModStats = {
        rank: 1,
        displayName: "FullMod",
        total: 100,
        approvals: 80,
        rejections: 15,
        modmail: 5,
        avgTimeSeconds: 120,
        roleColor: "#FF5733",
        nameGradient: {
          colors: ["#FF0000", "#0000FF"],
          angle: 90,
        },
      };
      expect(full.roleColor).toBe("#FF5733");
      expect(full.nameGradient?.colors).toHaveLength(2);
      expect(full.nameGradient?.angle).toBe(90);
    });
  });
});
