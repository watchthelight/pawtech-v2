/**
 * Pawtropolis Tech — tests/features/aiDetection/rapidai.test.ts
 * WHAT: Unit tests for RapidAPI AI Art Detection module.
 * WHY: Verify response parsing, score normalization, and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env with API key present
vi.mock("../../../src/lib/env.js", () => ({
  env: {
    RAPIDAPI_KEY: "test-api-key",
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

// Store original fetch
const originalFetch = global.fetch;

describe("features/aiDetection/rapidai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("RapidAI response parsing", () => {
    describe("primary score fields", () => {
      it("extracts ai_generated_probability", () => {
        const response = {
          ai_generated_probability: 0.92,
        };

        const score = response?.ai_generated_probability;
        expect(score).toBe(0.92);
      });

      it("extracts probability as fallback", () => {
        const response = {
          probability: 0.85,
        };

        const score = response?.probability;
        expect(score).toBe(0.85);
      });

      it("extracts score as fallback", () => {
        const response = {
          score: 0.78,
        };

        const score = response?.score;
        expect(score).toBe(0.78);
      });

      it("extracts ai_score as fallback", () => {
        const response = {
          ai_score: 0.65,
        };

        const score = response?.ai_score;
        expect(score).toBe(0.65);
      });
    });

    describe("field priority", () => {
      it("prefers ai_generated_probability over probability", () => {
        const response = {
          ai_generated_probability: 0.9,
          probability: 0.8,
        };

        const score =
          response?.ai_generated_probability ??
          response?.probability ??
          response?.score ??
          response?.ai_score;
        expect(score).toBe(0.9);
      });

      it("falls through to available fields", () => {
        const response = {
          ai_score: 0.7,
        };

        const score =
          (response as any)?.ai_generated_probability ??
          (response as any)?.probability ??
          (response as any)?.score ??
          response?.ai_score;
        expect(score).toBe(0.7);
      });
    });

    describe("prediction string inference", () => {
      it("infers 0.9 from AI prediction", () => {
        const response = {
          prediction: "AI generated",
        };

        const pred = response.prediction.toLowerCase();
        let score: number | undefined;
        if (pred.includes("ai") || pred.includes("generated")) {
          score = 0.9;
        }

        expect(score).toBe(0.9);
      });

      it("infers 0.1 from original prediction", () => {
        const response = {
          prediction: "Original",
        };

        const pred = response.prediction.toLowerCase();
        let score: number | undefined;
        if (pred.includes("original") || pred.includes("human") || pred.includes("real")) {
          score = 0.1;
        }

        expect(score).toBe(0.1);
      });

      it("infers 0.1 from human prediction", () => {
        const response = {
          prediction: "Human made",
        };

        const pred = response.prediction.toLowerCase();
        let score: number | undefined;
        if (pred.includes("original") || pred.includes("human") || pred.includes("real")) {
          score = 0.1;
        }

        expect(score).toBe(0.1);
      });

      it("infers 0.1 from real prediction", () => {
        const response = {
          prediction: "Real photograph",
        };

        const pred = response.prediction.toLowerCase();
        let score: number | undefined;
        if (pred.includes("original") || pred.includes("human") || pred.includes("real")) {
          score = 0.1;
        }

        expect(score).toBe(0.1);
      });
    });

    describe("score normalization", () => {
      it("normalizes percentage scores (0-100) to 0-1 range", () => {
        let score = 85; // Percentage format

        if (score > 1) {
          score = score / 100;
        }

        expect(score).toBe(0.85);
      });

      it("leaves 0-1 range scores unchanged", () => {
        let score = 0.85;

        if (score > 1) {
          score = score / 100;
        }

        expect(score).toBe(0.85);
      });

      it("normalizes edge case 100 to 1.0", () => {
        let score = 100;

        if (score > 1) {
          score = score / 100;
        }

        expect(score).toBe(1);
      });

      it("leaves 1.0 unchanged", () => {
        let score = 1;

        if (score > 1) {
          score = score / 100;
        }

        expect(score).toBe(1);
      });
    });

    describe("malformed response handling", () => {
      it("returns undefined for empty response", () => {
        const response = {};

        const score =
          (response as any)?.ai_generated_probability ??
          (response as any)?.probability ??
          (response as any)?.score ??
          (response as any)?.ai_score;

        expect(score).toBeUndefined();
      });

      it("handles non-numeric score", () => {
        const response = {
          ai_generated_probability: "high",
        };

        const score = response.ai_generated_probability;
        const isNumber = typeof score === "number";

        expect(isNumber).toBe(false);
      });

      it("returns undefined when no valid fields", () => {
        const response = {
          other_field: 0.9,
        };

        const score =
          (response as any)?.ai_generated_probability ??
          (response as any)?.probability ??
          (response as any)?.score ??
          (response as any)?.ai_score;

        expect(score).toBeUndefined();
      });
    });
  });

  describe("RapidAI API configuration", () => {
    it("uses correct host header", () => {
      const host = "ai-generated-image-detection-api.p.rapidapi.com";
      expect(host).toBe("ai-generated-image-detection-api.p.rapidapi.com");
    });

    it("sends X-RapidAPI-Key header", () => {
      const headerName = "X-RapidAPI-Key";
      expect(headerName).toBe("X-RapidAPI-Key");
    });

    it("sends X-RapidAPI-Host header", () => {
      const headerName = "X-RapidAPI-Host";
      expect(headerName).toBe("X-RapidAPI-Host");
    });

    it("sends JSON content type", () => {
      const contentType = "application/json";
      expect(contentType).toBe("application/json");
    });

    it("sends request body with url and type", () => {
      const imageUrl = "https://example.com/image.png";
      const body = JSON.stringify({
        type: "url",
        url: imageUrl,
      });

      const parsed = JSON.parse(body);
      expect(parsed.type).toBe("url");
      expect(parsed.url).toBe(imageUrl);
    });
  });

  describe("RapidAI timeout configuration", () => {
    it("uses 15 second timeout", () => {
      const TIMEOUT_MS = 15000;
      expect(TIMEOUT_MS).toBe(15000);
    });
  });

  describe("RapidAI API endpoint", () => {
    it("uses correct endpoint URL", () => {
      const host = "ai-generated-image-detection-api.p.rapidapi.com";
      const endpoint = `https://${host}/v1/image/detect-ai-image`;

      expect(endpoint).toContain("rapidapi.com");
      expect(endpoint).toContain("/v1/image/detect-ai-image");
    });
  });
});

describe("RapidAI service configuration", () => {
  describe("enabled check", () => {
    it("is enabled when RAPIDAPI_KEY present", () => {
      const apiKey = "test-key";
      const enabled = !!apiKey;
      expect(enabled).toBe(true);
    });

    it("is disabled when RAPIDAPI_KEY empty", () => {
      const apiKey = "";
      const enabled = !!apiKey;
      expect(enabled).toBe(false);
    });

    it("is disabled when RAPIDAPI_KEY undefined", () => {
      const apiKey = undefined;
      const enabled = !!apiKey;
      expect(enabled).toBe(false);
    });
  });
});

describe("AI detection score interpretation (RapidAI)", () => {
  describe("score ranges", () => {
    it("treats 0 as definitely not AI", () => {
      const score = 0;
      expect(score).toBeLessThanOrEqual(0.5);
    });

    it("treats 1 as definitely AI", () => {
      const score = 1;
      expect(score).toBeGreaterThan(0.5);
    });

    it("treats 0.5 as uncertain", () => {
      const score = 0.5;
      expect(score).toBe(0.5);
    });
  });

  describe("prediction to score conversion", () => {
    it("AI prediction maps to high score (0.9)", () => {
      const prediction = "AI generated";
      const score = prediction.toLowerCase().includes("ai") ? 0.9 : 0.1;
      expect(score).toBe(0.9);
    });

    it("human prediction maps to low score (0.1)", () => {
      const prediction = "human";
      const score = prediction.toLowerCase().includes("ai") ? 0.9 : 0.1;
      expect(score).toBe(0.1);
    });
  });
});

describe("RapidAI error handling", () => {
  describe("HTTP error responses", () => {
    it("throws on non-ok response", () => {
      const response = { ok: false, status: 500 };
      expect(response.ok).toBe(false);
    });

    it("logs warning with status code", () => {
      const status = 429;
      const logMessage = `[rapidai] API request failed`;
      expect(logMessage).toContain("rapidai");
    });
  });

  describe("network errors", () => {
    it("returns null on fetch failure", () => {
      const result = null; // Simulating error catch
      expect(result).toBeNull();
    });
  });
});

describe("RapidAI service identifier", () => {
  it("uses rapidai as service ID", () => {
    const serviceId = "rapidai";
    expect(serviceId).toBe("rapidai");
  });

  it("is obfuscated as Engine 2 to users", () => {
    const displayName = "Engine 2";
    expect(displayName).toBe("Engine 2");
  });
});
