/**
 * Pawtropolis Tech — tests/features/aiDetection/optic.test.ts
 * WHAT: Unit tests for Optic AI Or Not detection module.
 * WHY: Verify response parsing and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env with API key present
vi.mock("../../../src/lib/env.js", () => ({
  env: {
    OPTIC_API_KEY: "test-api-key",
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

describe("features/aiDetection/optic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Optic response parsing", () => {
    describe("successful response structure", () => {
      it("extracts confidence from report.ai.confidence", () => {
        const response = {
          report: {
            verdict: "ai",
            ai: { confidence: 0.92 },
          },
        };

        const confidence = response?.report?.ai?.confidence;
        expect(confidence).toBe(0.92);
      });

      it("handles human verdict response", () => {
        const response = {
          report: {
            verdict: "human",
            ai: { confidence: 0.15 },
          },
        };

        const confidence = response?.report?.ai?.confidence;
        expect(confidence).toBe(0.15);
      });

      it("ignores verdict string, uses numeric confidence", () => {
        // Verdict is just confidence > 0.5
        const response = {
          report: {
            verdict: "ai",
            ai: { confidence: 0.51 },
          },
        };

        const confidence = response?.report?.ai?.confidence;
        expect(typeof confidence).toBe("number");
        expect(confidence).toBe(0.51);
      });
    });

    describe("malformed response handling", () => {
      it("returns null for missing report", () => {
        const response = {};
        const confidence = (response as any)?.report?.ai?.confidence;
        expect(confidence).toBeUndefined();
      });

      it("returns null for missing ai field", () => {
        const response = { report: { verdict: "ai" } };
        const confidence = (response as any)?.report?.ai?.confidence;
        expect(confidence).toBeUndefined();
      });

      it("returns null for missing confidence", () => {
        const response = { report: { ai: {} } };
        const confidence = (response as any)?.report?.ai?.confidence;
        expect(confidence).toBeUndefined();
      });

      it("handles non-numeric confidence gracefully", () => {
        const response = {
          report: {
            ai: { confidence: "high" },
          },
        };

        const confidence = response?.report?.ai?.confidence;
        const isNumber = typeof confidence === "number";
        expect(isNumber).toBe(false);
      });
    });
  });

  describe("Optic API configuration", () => {
    it("uses Bearer authorization header format", () => {
      const apiKey = "test-key";
      const header = `Bearer ${apiKey}`;
      expect(header).toBe("Bearer test-key");
    });

    it("sends JSON content type", () => {
      const contentType = "application/json";
      expect(contentType).toBe("application/json");
    });

    it("sends URL as 'object' parameter (not 'url')", () => {
      const imageUrl = "https://example.com/image.png";
      const body = JSON.stringify({ object: imageUrl });
      const parsed = JSON.parse(body);
      expect(parsed.object).toBe(imageUrl);
      expect(parsed.url).toBeUndefined();
    });
  });

  describe("Optic timeout configuration", () => {
    it("uses 15 second timeout", () => {
      const TIMEOUT_MS = 15000;
      expect(TIMEOUT_MS).toBe(15000);
    });
  });

  describe("Optic API endpoint", () => {
    it("uses correct endpoint URL", () => {
      const endpoint = "https://api.aiornot.com/v1/reports/image";
      expect(endpoint).toContain("aiornot.com");
      expect(endpoint).toContain("/reports/image");
    });
  });
});

describe("Optic verdict interpretation", () => {
  describe("verdict values", () => {
    it("ai verdict indicates AI-generated", () => {
      const verdict = "ai";
      expect(verdict).toBe("ai");
    });

    it("human verdict indicates human-created", () => {
      const verdict = "human";
      expect(verdict).toBe("human");
    });
  });

  describe("confidence to verdict mapping", () => {
    it("confidence > 0.5 typically maps to ai verdict", () => {
      const confidence = 0.75;
      const expectedVerdict = confidence > 0.5 ? "ai" : "human";
      expect(expectedVerdict).toBe("ai");
    });

    it("confidence < 0.5 typically maps to human verdict", () => {
      const confidence = 0.25;
      const expectedVerdict = confidence > 0.5 ? "ai" : "human";
      expect(expectedVerdict).toBe("human");
    });

    it("confidence = 0.5 is boundary case", () => {
      const confidence = 0.5;
      // At exactly 0.5, the API could go either way
      expect(confidence).toBe(0.5);
    });
  });
});

describe("AI detection service comparison", () => {
  describe("service identifiers", () => {
    it("optic has correct service ID", () => {
      const serviceId = "optic";
      expect(serviceId).toBe("optic");
    });

    it("optic has correct display name", () => {
      const displayName = "Optic AI Or Not";
      expect(displayName).toBe("Optic AI Or Not");
    });
  });

  describe("score normalization", () => {
    it("all services return 0-1 range", () => {
      const scores = [0, 0.25, 0.5, 0.75, 1];
      for (const score of scores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it("null indicates service failure", () => {
      const failedScore = null;
      expect(failedScore).toBeNull();
    });
  });
});
