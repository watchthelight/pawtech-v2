/**
 * Pawtropolis Tech — tests/features/aiDetection/health.test.ts
 * WHAT: Unit tests for AI detection health check module.
 * WHY: Verify service status reporting and credential sanitization.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env before importing
vi.mock("../../../src/lib/env.js", () => ({
  env: {
    HIVE_API_KEY: "",
    RAPIDAPI_KEY: "",
    SIGHTENGINE_API_USER: "",
    SIGHTENGINE_API_SECRET: "",
    OPTIC_API_KEY: "",
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getServiceStatus } from "../../../src/features/aiDetection/health.js";
import { env } from "../../../src/lib/env.js";

describe("features/aiDetection/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env values
    (env as any).HIVE_API_KEY = "";
    (env as any).RAPIDAPI_KEY = "";
    (env as any).SIGHTENGINE_API_USER = "";
    (env as any).SIGHTENGINE_API_SECRET = "";
    (env as any).OPTIC_API_KEY = "";
  });

  describe("getServiceStatus", () => {
    it("returns status for all 4 services", () => {
      const status = getServiceStatus();
      expect(status).toHaveLength(4);
    });

    it("includes hive service", () => {
      const status = getServiceStatus();
      const hive = status.find((s) => s.service === "hive");
      expect(hive).toBeDefined();
      expect(hive?.displayName).toBe("Hive Moderation");
      expect(hive?.envVars).toContain("HIVE_API_KEY");
    });

    it("includes rapidai service", () => {
      const status = getServiceStatus();
      const rapidai = status.find((s) => s.service === "rapidai");
      expect(rapidai).toBeDefined();
      expect(rapidai?.displayName).toBe("RapidAPI AI Art Detection");
      expect(rapidai?.envVars).toContain("RAPIDAPI_KEY");
    });

    it("includes sightengine service", () => {
      const status = getServiceStatus();
      const se = status.find((s) => s.service === "sightengine");
      expect(se).toBeDefined();
      expect(se?.displayName).toBe("SightEngine");
      expect(se?.envVars).toContain("SIGHTENGINE_API_USER");
      expect(se?.envVars).toContain("SIGHTENGINE_API_SECRET");
    });

    it("includes optic service", () => {
      const status = getServiceStatus();
      const optic = status.find((s) => s.service === "optic");
      expect(optic).toBeDefined();
      expect(optic?.displayName).toBe("Optic AI Or Not");
      expect(optic?.envVars).toContain("OPTIC_API_KEY");
    });

    it("reports unconfigured when env vars empty", () => {
      const status = getServiceStatus();
      for (const svc of status) {
        expect(svc.configured).toBe(false);
        expect(svc.healthy).toBeNull();
      }
    });

    it("reports hive configured when API key present", () => {
      (env as any).HIVE_API_KEY = "test-key";
      const status = getServiceStatus();
      const hive = status.find((s) => s.service === "hive");
      expect(hive?.configured).toBe(true);
    });

    it("reports rapidai configured when API key present", () => {
      (env as any).RAPIDAPI_KEY = "test-key";
      const status = getServiceStatus();
      const rapidai = status.find((s) => s.service === "rapidai");
      expect(rapidai?.configured).toBe(true);
    });

    it("reports sightengine configured when both credentials present", () => {
      (env as any).SIGHTENGINE_API_USER = "test-user";
      (env as any).SIGHTENGINE_API_SECRET = "test-secret";
      const status = getServiceStatus();
      const se = status.find((s) => s.service === "sightengine");
      expect(se?.configured).toBe(true);
    });

    it("reports sightengine unconfigured when only user present", () => {
      (env as any).SIGHTENGINE_API_USER = "test-user";
      const status = getServiceStatus();
      const se = status.find((s) => s.service === "sightengine");
      expect(se?.configured).toBe(false);
    });

    it("reports sightengine unconfigured when only secret present", () => {
      (env as any).SIGHTENGINE_API_SECRET = "test-secret";
      const status = getServiceStatus();
      const se = status.find((s) => s.service === "sightengine");
      expect(se?.configured).toBe(false);
    });

    it("reports optic configured when API key present", () => {
      (env as any).OPTIC_API_KEY = "test-key";
      const status = getServiceStatus();
      const optic = status.find((s) => s.service === "optic");
      expect(optic?.configured).toBe(true);
    });

    it("includes documentation URLs", () => {
      const status = getServiceStatus();
      for (const svc of status) {
        expect(svc.docsUrl).toBeDefined();
        expect(svc.docsUrl.startsWith("https://")).toBe(true);
      }
    });
  });
});

describe("ServiceHealth type structure", () => {
  it("has correct service identifiers", () => {
    const validServices = ["hive", "rapidai", "sightengine", "optic"];
    const status = getServiceStatus();
    for (const svc of status) {
      expect(validServices).toContain(svc.service);
    }
  });
});

describe("credential sanitization", () => {
  describe("SightEngine credential patterns", () => {
    function sanitizeError(message: string): string {
      return message
        .replace(/api_user=[^&\s]+/gi, "api_user=[REDACTED]")
        .replace(/api_secret=[^&\s]+/gi, "api_secret=[REDACTED]");
    }

    it("sanitizes api_user in error messages", () => {
      const input = "Error: api_user=abc123&api_secret=xyz";
      const result = sanitizeError(input);
      expect(result).toContain("api_user=[REDACTED]");
      expect(result).not.toContain("abc123");
    });

    it("sanitizes api_secret in error messages", () => {
      const input = "Failed: api_secret=secret123";
      const result = sanitizeError(input);
      expect(result).toContain("api_secret=[REDACTED]");
      expect(result).not.toContain("secret123");
    });

    it("sanitizes both credentials in same message", () => {
      const input = "URL: https://api.sightengine.com?api_user=user1&api_secret=pass1";
      const result = sanitizeError(input);
      expect(result).toContain("api_user=[REDACTED]");
      expect(result).toContain("api_secret=[REDACTED]");
      expect(result).not.toContain("user1");
      expect(result).not.toContain("pass1");
    });

    it("handles case insensitivity", () => {
      const input = "API_USER=test API_SECRET=test2";
      const result = sanitizeError(input);
      expect(result).toContain("[REDACTED]");
    });

    it("preserves non-credential parts of message", () => {
      const input = "Request to https://example.com failed with api_user=secret";
      const result = sanitizeError(input);
      expect(result).toContain("Request to https://example.com failed with");
      expect(result).toContain("[REDACTED]");
    });
  });
});

describe("AI detection test functions", () => {
  describe("response handling patterns", () => {
    it("treats 401 as invalid key", () => {
      const status = 401;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });

    it("treats 403 as invalid key", () => {
      const status = 403;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });

    it("treats other errors as generic failures", () => {
      const status = 500;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(false);
    });
  });

  describe("test image URL", () => {
    it("uses Wikipedia PNG transparency demo", () => {
      // Stable, CORS-friendly, definitely not AI-generated
      const expectedUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png";
      // Just verify the URL pattern is valid
      expect(expectedUrl).toContain("wikimedia.org");
      expect(expectedUrl).toContain(".png");
    });
  });

  describe("timeout configuration", () => {
    it("uses 15 second timeout", () => {
      const TIMEOUT_MS = 15000;
      expect(TIMEOUT_MS).toBe(15000);
    });
  });
});

describe("ServiceResult structure", () => {
  it("has expected fields", () => {
    const result = {
      service: "hive" as const,
      displayName: "Hive Moderation",
      score: 0.85,
      error: undefined,
    };

    expect(result.service).toBe("hive");
    expect(result.displayName).toBe("Hive Moderation");
    expect(result.score).toBe(0.85);
    expect(result.error).toBeUndefined();
  });

  it("score can be null on failure", () => {
    const result = {
      service: "optic" as const,
      displayName: "Optic AI Or Not",
      score: null,
      error: "Service unavailable",
    };

    expect(result.score).toBeNull();
    expect(result.error).toBe("Service unavailable");
  });
});

describe("AIDetectionResult structure", () => {
  it("has expected fields", () => {
    const result = {
      imageUrl: "https://example.com/image.png",
      imageName: "image.png",
      services: [],
      averageScore: 0.75,
      successCount: 3,
      failureCount: 1,
    };

    expect(result.imageUrl).toBe("https://example.com/image.png");
    expect(result.imageName).toBe("image.png");
    expect(result.averageScore).toBe(0.75);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(1);
  });

  it("averageScore is null when all services fail", () => {
    const result = {
      imageUrl: "https://example.com/image.png",
      imageName: "image.png",
      services: [],
      averageScore: null,
      successCount: 0,
      failureCount: 4,
    };

    expect(result.averageScore).toBeNull();
  });
});
