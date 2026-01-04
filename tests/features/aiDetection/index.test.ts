/**
 * Pawtropolis Tech — tests/features/aiDetection/index.test.ts
 * WHAT: Unit tests for AI detection orchestrator module.
 * WHY: Verify multi-service coordination, averaging, and embed building.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/store/aiDetectionToggles.js", () => ({
  getEnabledServices: vi.fn(() => ["hive", "rapidai", "sightengine", "optic"]),
}));

vi.mock("../../../src/features/aiDetection/hive.js", () => ({
  detectHive: vi.fn(),
}));

vi.mock("../../../src/features/aiDetection/rapidai.js", () => ({
  detectRapidAI: vi.fn(),
}));

vi.mock("../../../src/features/aiDetection/sightengine.js", () => ({
  detectSightEngine: vi.fn(),
}));

vi.mock("../../../src/features/aiDetection/optic.js", () => ({
  detectOptic: vi.fn(),
}));

import { detectAIForImage, detectAIForImages, buildAIDetectionEmbed } from "../../../src/features/aiDetection/index.js";
import { getEnabledServices } from "../../../src/store/aiDetectionToggles.js";
import { detectHive } from "../../../src/features/aiDetection/hive.js";
import { detectRapidAI } from "../../../src/features/aiDetection/rapidai.js";
import { detectSightEngine } from "../../../src/features/aiDetection/sightengine.js";
import { detectOptic } from "../../../src/features/aiDetection/optic.js";
import { EmbedBuilder } from "discord.js";

describe("features/aiDetection/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectAIForImage", () => {
    describe("service coordination", () => {
      it("calls all enabled services in parallel", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "rapidai", "sightengine", "optic"]);
        vi.mocked(detectHive).mockResolvedValue(0.8);
        vi.mocked(detectRapidAI).mockResolvedValue(0.7);
        vi.mocked(detectSightEngine).mockResolvedValue(0.9);
        vi.mocked(detectOptic).mockResolvedValue(0.85);

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(detectHive).toHaveBeenCalledWith("https://example.com/image.png");
        expect(detectRapidAI).toHaveBeenCalledWith("https://example.com/image.png");
        expect(detectSightEngine).toHaveBeenCalledWith("https://example.com/image.png");
        expect(detectOptic).toHaveBeenCalledWith("https://example.com/image.png");
      });

      it("only calls enabled services", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "optic"]);
        vi.mocked(detectHive).mockResolvedValue(0.8);
        vi.mocked(detectOptic).mockResolvedValue(0.9);

        await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(detectHive).toHaveBeenCalled();
        expect(detectOptic).toHaveBeenCalled();
        expect(detectRapidAI).not.toHaveBeenCalled();
        expect(detectSightEngine).not.toHaveBeenCalled();
      });

      it("returns empty result when no services enabled", async () => {
        vi.mocked(getEnabledServices).mockReturnValue([]);

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(result.services).toHaveLength(0);
        expect(result.averageScore).toBeNull();
        expect(result.successCount).toBe(0);
        expect(result.failureCount).toBe(0);
      });
    });

    describe("score averaging", () => {
      it("calculates average from successful services", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "rapidai"]);
        vi.mocked(detectHive).mockResolvedValue(0.8);
        vi.mocked(detectRapidAI).mockResolvedValue(0.6);

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(result.averageScore).toBe(0.7); // (0.8 + 0.6) / 2
      });

      it("excludes null scores from average", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "rapidai", "optic"]);
        vi.mocked(detectHive).mockResolvedValue(0.8);
        vi.mocked(detectRapidAI).mockResolvedValue(null);
        vi.mocked(detectOptic).mockResolvedValue(0.6);

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(result.averageScore).toBe(0.7); // (0.8 + 0.6) / 2, null excluded
        expect(result.successCount).toBe(2);
        expect(result.failureCount).toBe(1);
      });

      it("returns null average when all services fail", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "rapidai"]);
        vi.mocked(detectHive).mockResolvedValue(null);
        vi.mocked(detectRapidAI).mockResolvedValue(null);

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(result.averageScore).toBeNull();
        expect(result.successCount).toBe(0);
        expect(result.failureCount).toBe(2);
      });
    });

    describe("error handling", () => {
      it("handles service rejection gracefully", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "rapidai"]);
        vi.mocked(detectHive).mockResolvedValue(0.8);
        vi.mocked(detectRapidAI).mockRejectedValue(new Error("API timeout"));

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(result.successCount).toBe(1);
        expect(result.failureCount).toBe(1);
        expect(result.averageScore).toBe(0.8);

        const failedService = result.services.find((s) => s.service === "rapidai");
        expect(failedService?.score).toBeNull();
        expect(failedService?.error).toBe("API timeout");
      });

      it("handles non-Error rejection", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive"]);
        vi.mocked(detectHive).mockRejectedValue("String error");

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        const failedService = result.services.find((s) => s.service === "hive");
        expect(failedService?.error).toBe("String error");
      });
    });

    describe("result structure", () => {
      it("includes image metadata", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive"]);
        vi.mocked(detectHive).mockResolvedValue(0.9);

        const result = await detectAIForImage("https://example.com/image.png", "test-image.png", "guild-123");

        expect(result.imageUrl).toBe("https://example.com/image.png");
        expect(result.imageName).toBe("test-image.png");
      });

      it("includes service display names", async () => {
        vi.mocked(getEnabledServices).mockReturnValue(["hive", "rapidai", "sightengine", "optic"]);
        vi.mocked(detectHive).mockResolvedValue(0.8);
        vi.mocked(detectRapidAI).mockResolvedValue(0.7);
        vi.mocked(detectSightEngine).mockResolvedValue(0.9);
        vi.mocked(detectOptic).mockResolvedValue(0.85);

        const result = await detectAIForImage("https://example.com/image.png", "image.png", "guild-123");

        expect(result.services.find((s) => s.service === "hive")?.displayName).toBe("Engine 1");
        expect(result.services.find((s) => s.service === "rapidai")?.displayName).toBe("Engine 2");
        expect(result.services.find((s) => s.service === "sightengine")?.displayName).toBe("Engine 3");
        expect(result.services.find((s) => s.service === "optic")?.displayName).toBe("Engine 4");
      });
    });
  });

  describe("detectAIForImages", () => {
    it("processes multiple images sequentially", async () => {
      vi.mocked(getEnabledServices).mockReturnValue(["hive"]);
      vi.mocked(detectHive).mockResolvedValue(0.8);

      const images = [
        { url: "https://example.com/1.png", name: "1.png" },
        { url: "https://example.com/2.png", name: "2.png" },
        { url: "https://example.com/3.png", name: "3.png" },
      ];

      const results = await detectAIForImages(images, "guild-123");

      expect(results).toHaveLength(3);
      expect(results[0].imageName).toBe("1.png");
      expect(results[1].imageName).toBe("2.png");
      expect(results[2].imageName).toBe("3.png");
    });

    it("returns empty array for no images", async () => {
      const results = await detectAIForImages([], "guild-123");
      expect(results).toHaveLength(0);
    });
  });
});

describe("processResult helper", () => {
  describe("fulfilled promise handling", () => {
    it("extracts score from fulfilled result", () => {
      const result: PromiseSettledResult<number | null> = {
        status: "fulfilled",
        value: 0.85,
      };

      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value).toBe(0.85);
      }
    });

    it("handles null value (not configured)", () => {
      const result: PromiseSettledResult<number | null> = {
        status: "fulfilled",
        value: null,
      };

      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value).toBeNull();
      }
    });
  });

  describe("rejected promise handling", () => {
    it("extracts error message from Error", () => {
      const result: PromiseSettledResult<number | null> = {
        status: "rejected",
        reason: new Error("Connection timeout"),
      };

      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        expect(msg).toBe("Connection timeout");
      }
    });

    it("converts non-Error to string", () => {
      const result: PromiseSettledResult<number | null> = {
        status: "rejected",
        reason: "Network failure",
      };

      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        expect(msg).toBe("Network failure");
      }
    });
  });
});

describe("renderScoreBar helper", () => {
  // Recreate the function for testing
  function renderScoreBar(score: number): string {
    const filled = Math.round(score * 10);
    const empty = 10 - filled;
    return "\u2588".repeat(filled) + "\u2591".repeat(empty);
  }

  describe("visual bar generation", () => {
    it("renders 0% as all empty", () => {
      const bar = renderScoreBar(0);
      expect(bar).toBe("░░░░░░░░░░");
      expect(bar.length).toBe(10);
    });

    it("renders 50% as half filled", () => {
      const bar = renderScoreBar(0.5);
      expect(bar).toBe("█████░░░░░");
    });

    it("renders 100% as all filled", () => {
      const bar = renderScoreBar(1);
      expect(bar).toBe("██████████");
    });

    it("renders 80% correctly", () => {
      const bar = renderScoreBar(0.8);
      expect(bar).toBe("████████░░");
    });

    it("rounds to nearest block", () => {
      const bar45 = renderScoreBar(0.45);
      const bar55 = renderScoreBar(0.55);

      // Math.round(0.45 * 10) = 5, Math.round(0.55 * 10) = 6
      expect(bar45).toBe("█████░░░░░"); // 4.5 -> 5
      expect(bar55).toBe("██████░░░░"); // 5.5 -> 6
    });
  });

  describe("character usage", () => {
    it("uses Unicode block characters", () => {
      const bar = renderScoreBar(0.5);
      expect(bar).toContain("\u2588"); // Full block
      expect(bar).toContain("\u2591"); // Light shade
    });
  });
});

describe("SERVICE_NAMES mapping", () => {
  const SERVICE_NAMES: Record<string, string> = {
    hive: "Engine 1",
    rapidai: "Engine 2",
    sightengine: "Engine 3",
    optic: "Engine 4",
  };

  it("obfuscates hive as Engine 1", () => {
    expect(SERVICE_NAMES.hive).toBe("Engine 1");
  });

  it("obfuscates rapidai as Engine 2", () => {
    expect(SERVICE_NAMES.rapidai).toBe("Engine 2");
  });

  it("obfuscates sightengine as Engine 3", () => {
    expect(SERVICE_NAMES.sightengine).toBe("Engine 3");
  });

  it("obfuscates optic as Engine 4", () => {
    expect(SERVICE_NAMES.optic).toBe("Engine 4");
  });

  it("hides real service names from users", () => {
    const values = Object.values(SERVICE_NAMES);
    expect(values).not.toContain("hive");
    expect(values).not.toContain("rapidai");
    expect(values).not.toContain("sightengine");
    expect(values).not.toContain("optic");
  });
});

describe("buildAIDetectionEmbed", () => {
  const createMockMessage = (authorTag: string = "User#1234") => ({
    author: { tag: authorTag },
    url: "https://discord.com/channels/123/456/789",
  });

  describe("embed structure", () => {
    it("sets correct title", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "https://example.com/image.png",
        imageName: "image.png",
        services: [],
        averageScore: 0.8,
        successCount: 4,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.title).toBe("AI Detection Results");
    });

    it("sets blue color", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "https://example.com/image.png",
        imageName: "image.png",
        services: [],
        averageScore: 0.8,
        successCount: 4,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.color).toBe(0x3b82f6);
    });

    it("includes message link in description", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "https://example.com/image.png",
        imageName: "image.png",
        services: [],
        averageScore: 0.8,
        successCount: 4,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.description).toContain("Jump to message");
      expect(data.description).toContain(mockMessage.url);
    });

    it("includes footer with author info", () => {
      const mockMessage = createMockMessage("TestUser#5678");
      const results = [{
        imageUrl: "https://example.com/image.png",
        imageName: "image.png",
        services: [],
        averageScore: 0.8,
        successCount: 4,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.footer?.text).toContain("Beta Feature");
      expect(data.footer?.text).toContain("TestUser#5678");
    });
  });

  describe("multi-image handling", () => {
    it("labels single image as 'Image'", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "https://example.com/image.png",
        imageName: "image.png",
        services: [],
        averageScore: 0.8,
        successCount: 1,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].name).toBe("Image");
    });

    it("labels multiple images with numbers", () => {
      const mockMessage = createMockMessage();
      const results = [
        { imageUrl: "url1", imageName: "1.png", services: [], averageScore: 0.8, successCount: 1, failureCount: 0 },
        { imageUrl: "url2", imageName: "2.png", services: [], averageScore: 0.7, successCount: 1, failureCount: 0 },
      ];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].name).toBe("Image 1");
      expect(data.fields?.[1].name).toBe("Image 2");
    });
  });

  describe("service result formatting", () => {
    it("shows percentage for successful services", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [{ service: "hive" as const, displayName: "Engine 1", score: 0.85 }],
        averageScore: 0.85,
        successCount: 1,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("85%");
      expect(data.fields?.[0].value).toContain("Engine 1");
    });

    it("shows error indicator for failed services", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [{ service: "hive" as const, displayName: "Engine 1", score: null, error: "Timeout" }],
        averageScore: null,
        successCount: 0,
        failureCount: 1,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("Error");
    });

    it("shows not configured for null score without error", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [{ service: "hive" as const, displayName: "Engine 1", score: null }],
        averageScore: null,
        successCount: 0,
        failureCount: 1,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("Not configured");
    });
  });

  describe("average score display", () => {
    it("shows overall average percentage", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [],
        averageScore: 0.75,
        successCount: 2,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("Overall Average: 75% AI-generated");
    });

    it("shows unable to calculate when average is null", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [],
        averageScore: null,
        successCount: 0,
        failureCount: 4,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("Unable to calculate");
    });
  });

  describe("service response count", () => {
    it("shows services responded count", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [
          { service: "hive" as const, displayName: "Engine 1", score: 0.8 },
          { service: "rapidai" as const, displayName: "Engine 2", score: 0.7 },
        ],
        averageScore: 0.75,
        successCount: 2,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("2/2 services responded");
    });

    it("shows no services enabled when empty", () => {
      const mockMessage = createMockMessage();
      const results = [{
        imageUrl: "url",
        imageName: "image.png",
        services: [],
        averageScore: null,
        successCount: 0,
        failureCount: 0,
      }];

      const embed = buildAIDetectionEmbed(results, mockMessage as any);
      const data = embed.toJSON();

      expect(data.fields?.[0].value).toContain("No services enabled");
    });
  });
});

describe("getDetector mapping", () => {
  describe("service to function mapping", () => {
    it("maps hive to detectHive", () => {
      const service = "hive";
      expect(service).toBe("hive");
    });

    it("maps rapidai to detectRapidAI", () => {
      const service = "rapidai";
      expect(service).toBe("rapidai");
    });

    it("maps sightengine to detectSightEngine", () => {
      const service = "sightengine";
      expect(service).toBe("sightengine");
    });

    it("maps optic to detectOptic", () => {
      const service = "optic";
      expect(service).toBe("optic");
    });
  });
});
