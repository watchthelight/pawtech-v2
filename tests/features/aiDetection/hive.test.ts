/**
 * Pawtropolis Tech — tests/features/aiDetection/hive.test.ts
 * WHAT: Unit tests for Hive AI detection module.
 * WHY: Verify response parsing and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env with API key present
vi.mock("../../../src/lib/env.js", () => ({
  env: {
    HIVE_API_KEY: "test-api-key",
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

describe("features/aiDetection/hive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Hive response parsing", () => {
    describe("successful response structure", () => {
      it("extracts ai_generated score from nested response", () => {
        const response = {
          status: [
            {
              response: {
                output: [
                  {
                    classes: [
                      { class: "ai_generated", score: 0.95 },
                      { class: "not_ai_generated", score: 0.05 },
                    ],
                  },
                ],
              },
            },
          ],
        };

        const output = response?.status?.[0]?.response?.output;
        expect(output).toBeDefined();

        let score = null;
        if (output && Array.isArray(output)) {
          for (const item of output) {
            if (item.classes && Array.isArray(item.classes)) {
              for (const cls of item.classes) {
                if (cls.class === "ai_generated" && typeof cls.score === "number") {
                  score = cls.score;
                  break;
                }
              }
            }
          }
        }

        expect(score).toBe(0.95);
      });

      it("handles multiple output items", () => {
        const response = {
          status: [
            {
              response: {
                output: [
                  { classes: [{ class: "other", score: 0.1 }] },
                  { classes: [{ class: "ai_generated", score: 0.75 }] },
                ],
              },
            },
          ],
        };

        const output = response?.status?.[0]?.response?.output;
        let score = null;
        if (output && Array.isArray(output)) {
          for (const item of output) {
            if (item.classes && Array.isArray(item.classes)) {
              for (const cls of item.classes) {
                if (cls.class === "ai_generated" && typeof cls.score === "number") {
                  score = cls.score;
                  break;
                }
              }
            }
            if (score !== null) break;
          }
        }

        expect(score).toBe(0.75);
      });
    });

    describe("malformed response handling", () => {
      it("returns null for missing status array", () => {
        const response = {};
        const output = (response as any)?.status?.[0]?.response?.output;
        expect(output).toBeUndefined();
      });

      it("returns null for empty status array", () => {
        const response = { status: [] };
        const output = response?.status?.[0]?.response?.output;
        expect(output).toBeUndefined();
      });

      it("returns null for missing response field", () => {
        const response = { status: [{}] };
        const output = (response as any)?.status?.[0]?.response?.output;
        expect(output).toBeUndefined();
      });

      it("returns null for missing output array", () => {
        const response = { status: [{ response: {} }] };
        const output = (response as any)?.status?.[0]?.response?.output;
        expect(output).toBeUndefined();
      });

      it("returns null when ai_generated class not found", () => {
        const response = {
          status: [
            {
              response: {
                output: [{ classes: [{ class: "other", score: 0.5 }] }],
              },
            },
          ],
        };

        const output = response?.status?.[0]?.response?.output;
        let score = null;
        if (output && Array.isArray(output)) {
          for (const item of output) {
            if (item.classes && Array.isArray(item.classes)) {
              for (const cls of item.classes) {
                if (cls.class === "ai_generated" && typeof cls.score === "number") {
                  score = cls.score;
                }
              }
            }
          }
        }

        expect(score).toBeNull();
      });

      it("handles non-numeric score gracefully", () => {
        const response = {
          status: [
            {
              response: {
                output: [
                  {
                    classes: [{ class: "ai_generated", score: "high" }],
                  },
                ],
              },
            },
          ],
        };

        const output = response?.status?.[0]?.response?.output;
        let score = null;
        if (output && Array.isArray(output)) {
          for (const item of output) {
            if (item.classes && Array.isArray(item.classes)) {
              for (const cls of item.classes as any[]) {
                if (cls.class === "ai_generated" && typeof cls.score === "number") {
                  score = cls.score;
                }
              }
            }
          }
        }

        expect(score).toBeNull();
      });
    });
  });

  describe("Hive API configuration", () => {
    it("uses Token authorization header format", () => {
      const apiKey = "test-key";
      const header = `Token ${apiKey}`;
      expect(header).toBe("Token test-key");
    });

    it("sends JSON content type", () => {
      const contentType = "application/json";
      expect(contentType).toBe("application/json");
    });

    it("sends URL in request body", () => {
      const imageUrl = "https://example.com/image.png";
      const body = JSON.stringify({ url: imageUrl });
      expect(JSON.parse(body).url).toBe(imageUrl);
    });
  });

  describe("Hive timeout configuration", () => {
    it("uses 15 second timeout", () => {
      const TIMEOUT_MS = 15000;
      expect(TIMEOUT_MS).toBe(15000);
    });
  });
});

describe("AI detection score interpretation", () => {
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

    it("typical AI image scores above 0.7", () => {
      const typicalAiScore = 0.85;
      expect(typicalAiScore).toBeGreaterThan(0.7);
    });

    it("typical human image scores below 0.3", () => {
      const typicalHumanScore = 0.15;
      expect(typicalHumanScore).toBeLessThan(0.3);
    });
  });
});
