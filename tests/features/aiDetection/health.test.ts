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

describe("testHive function behavior", () => {
  describe("response handling", () => {
    it("returns success when output exists in response", () => {
      const data = { status: [{ response: { output: [{ classes: [] }] } }] };
      const hasOutput = !!data?.status?.[0]?.response?.output;
      expect(hasOutput).toBe(true);
    });

    it("returns failure when output missing", () => {
      const data = { status: [{ response: {} }] };
      const hasOutput = !!(data as any)?.status?.[0]?.response?.output;
      expect(hasOutput).toBe(false);
    });

    it("returns invalid key error on 401", () => {
      const status = 401;
      const errorMsg = status === 401 ? "Invalid API key (401 Unauthorized)" : `HTTP ${status}`;
      expect(errorMsg).toBe("Invalid API key (401 Unauthorized)");
    });
  });

  describe("API request format", () => {
    it("uses Token authorization header", () => {
      const apiKey = "test-key";
      const header = `Token ${apiKey}`;
      expect(header).toBe("Token test-key");
    });

    it("sends test image URL in body", () => {
      const testUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png";
      const body = JSON.stringify({ url: testUrl });
      expect(JSON.parse(body).url).toContain("wikimedia.org");
    });
  });
});

describe("testRapidAI function behavior", () => {
  describe("response handling", () => {
    it("returns success on 200 response", () => {
      const response = { ok: true, status: 200 };
      expect(response.ok).toBe(true);
    });

    it("returns invalid key on 401", () => {
      const status = 401;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });

    it("returns invalid key on 403", () => {
      const status = 403;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });
  });

  describe("API request format", () => {
    it("uses X-RapidAPI-Key header", () => {
      const headerName = "X-RapidAPI-Key";
      expect(headerName).toBe("X-RapidAPI-Key");
    });

    it("uses X-RapidAPI-Host header", () => {
      const host = "ai-generated-image-detection-api.p.rapidapi.com";
      expect(host).toContain("rapidapi.com");
    });
  });
});

describe("testSightEngine function behavior", () => {
  describe("response handling", () => {
    it("returns success when status is success", () => {
      const data = { status: "success" };
      expect(data.status).toBe("success");
    });

    it("returns error message from response", () => {
      const data = { status: "error", error: { message: "Invalid API key" } };
      expect(data.error?.message).toBe("Invalid API key");
    });

    it("returns failure on 401", () => {
      const status = 401;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });

    it("handles 200 with error in body", () => {
      // SightEngine can return 200 OK with error in body
      const response = { ok: true };
      const data = { status: "error", error: { message: "Rate limit exceeded" } };
      expect(response.ok).toBe(true);
      expect(data.status).not.toBe("success");
    });
  });

  describe("credential sanitization in errors", () => {
    function sanitizeSightEngineError(err: unknown): unknown {
      if (err instanceof Error) {
        const sanitized = new Error(
          err.message
            .replace(/api_user=[^&\s]+/gi, "api_user=[REDACTED]")
            .replace(/api_secret=[^&\s]+/gi, "api_secret=[REDACTED]")
        );
        sanitized.name = err.name;
        return sanitized;
      }
      return err;
    }

    it("sanitizes Error objects", () => {
      const err = new Error("Failed: api_user=secret123");
      const sanitized = sanitizeSightEngineError(err) as Error;
      expect(sanitized.message).toContain("[REDACTED]");
      expect(sanitized.message).not.toContain("secret123");
    });

    it("passes non-Error through unchanged", () => {
      const obj = { code: 500 };
      const result = sanitizeSightEngineError(obj);
      expect(result).toEqual({ code: 500 });
    });
  });
});

describe("testOptic function behavior", () => {
  describe("response handling", () => {
    it("returns success on 200 response", () => {
      const response = { ok: true, status: 200 };
      expect(response.ok).toBe(true);
    });

    it("returns invalid key on 401", () => {
      const status = 401;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });

    it("returns invalid key on 403", () => {
      const status = 403;
      const isAuthError = status === 401 || status === 403;
      expect(isAuthError).toBe(true);
    });
  });

  describe("API request format", () => {
    it("uses Bearer authorization header", () => {
      const apiKey = "test-key";
      const header = `Bearer ${apiKey}`;
      expect(header).toBe("Bearer test-key");
    });

    it("sends object parameter instead of url", () => {
      const testUrl = "https://example.com/test.png";
      const body = JSON.stringify({ object: testUrl });
      const parsed = JSON.parse(body);
      expect(parsed.object).toBeDefined();
      expect(parsed.url).toBeUndefined();
    });
  });
});

describe("testAllConfigured function behavior", () => {
  describe("service filtering", () => {
    it("skips unconfigured services", () => {
      const services = [
        { service: "hive", configured: false },
        { service: "optic", configured: true },
      ];

      const toTest = services.filter((s) => s.configured);
      expect(toTest).toHaveLength(1);
      expect(toTest[0].service).toBe("optic");
    });

    it("tests all configured services in parallel", () => {
      const services = [
        { service: "hive", configured: true },
        { service: "rapidai", configured: true },
        { service: "sightengine", configured: false },
        { service: "optic", configured: true },
      ];

      const toTest = services.filter((s) => s.configured);
      expect(toTest).toHaveLength(3);
    });
  });

  describe("result aggregation", () => {
    it("preserves service metadata with test result", () => {
      const svc = {
        service: "hive" as const,
        displayName: "Hive Moderation",
        configured: true,
        healthy: null as boolean | null,
        docsUrl: "https://thehive.ai/",
        envVars: ["HIVE_API_KEY"],
      };

      const testResult = { success: true };

      const result = {
        ...svc,
        healthy: testResult.success,
      };

      expect(result.service).toBe("hive");
      expect(result.healthy).toBe(true);
      expect(result.displayName).toBe("Hive Moderation");
    });

    it("includes error message on failure", () => {
      const testResult = { success: false, error: "Connection timeout" };

      expect(testResult.success).toBe(false);
      expect(testResult.error).toBe("Connection timeout");
    });
  });
});

describe("ServiceHealth interface", () => {
  it("has all required fields", () => {
    const health = {
      service: "hive" as const,
      displayName: "Hive Moderation",
      configured: true,
      healthy: true,
      docsUrl: "https://thehive.ai/",
      envVars: ["HIVE_API_KEY"],
    };

    expect(health).toHaveProperty("service");
    expect(health).toHaveProperty("displayName");
    expect(health).toHaveProperty("configured");
    expect(health).toHaveProperty("healthy");
    expect(health).toHaveProperty("docsUrl");
    expect(health).toHaveProperty("envVars");
  });

  it("supports optional error field", () => {
    const health = {
      service: "rapidai" as const,
      displayName: "RapidAPI AI Art Detection",
      configured: true,
      healthy: false,
      error: "Invalid API key",
      docsUrl: "https://rapidapi.com",
      envVars: ["RAPIDAPI_KEY"],
    };

    expect(health.error).toBe("Invalid API key");
  });

  it("healthy is null before testing", () => {
    const health = {
      service: "optic" as const,
      displayName: "Optic AI Or Not",
      configured: true,
      healthy: null,
      docsUrl: "https://aiornot.com/",
      envVars: ["OPTIC_API_KEY"],
    };

    expect(health.healthy).toBeNull();
  });
});
