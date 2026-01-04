/**
 * Pawtropolis Tech — tests/constants/sampleData.test.ts
 * WHAT: Unit tests for sample data constants.
 * WHY: Verify data structure integrity and expected values.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import {
  SAMPLE_ANSWERS_STANDARD,
  SAMPLE_ANSWERS_LONG,
  SAMPLE_ANSWERS_REJECTED,
  SAMPLE_REJECTION_REASON,
  SAMPLE_HISTORY,
} from "../../src/constants/sampleData.js";

describe("sampleData", () => {
  describe("SAMPLE_ANSWERS_STANDARD", () => {
    it("has 5 questions", () => {
      expect(SAMPLE_ANSWERS_STANDARD).toHaveLength(5);
    });

    it("has sequential q_index values starting at 1", () => {
      SAMPLE_ANSWERS_STANDARD.forEach((answer, idx) => {
        expect(answer.q_index).toBe(idx + 1);
      });
    });

    it("all answers have question and answer fields", () => {
      SAMPLE_ANSWERS_STANDARD.forEach((answer) => {
        expect(answer.question).toBeDefined();
        expect(answer.answer).toBeDefined();
        expect(typeof answer.question).toBe("string");
        expect(typeof answer.answer).toBe("string");
      });
    });

    it("first question is about age", () => {
      expect(SAMPLE_ANSWERS_STANDARD[0].question.toLowerCase()).toContain("age");
    });

    it("all answers are non-empty", () => {
      SAMPLE_ANSWERS_STANDARD.forEach((answer) => {
        expect(answer.answer.length).toBeGreaterThan(0);
      });
    });
  });

  describe("SAMPLE_ANSWERS_LONG", () => {
    it("has 5 questions", () => {
      expect(SAMPLE_ANSWERS_LONG).toHaveLength(5);
    });

    it("has longer answers than standard", () => {
      const standardTotalLength = SAMPLE_ANSWERS_STANDARD.reduce(
        (sum, a) => sum + a.answer.length,
        0
      );
      const longTotalLength = SAMPLE_ANSWERS_LONG.reduce(
        (sum, a) => sum + a.answer.length,
        0
      );
      expect(longTotalLength).toBeGreaterThan(standardTotalLength);
    });

    it("matches same questions as standard set", () => {
      SAMPLE_ANSWERS_LONG.forEach((answer, idx) => {
        expect(answer.question).toBe(SAMPLE_ANSWERS_STANDARD[idx].question);
      });
    });

    it("has sequential q_index values", () => {
      SAMPLE_ANSWERS_LONG.forEach((answer, idx) => {
        expect(answer.q_index).toBe(idx + 1);
      });
    });
  });

  describe("SAMPLE_ANSWERS_REJECTED", () => {
    it("has 5 questions", () => {
      expect(SAMPLE_ANSWERS_REJECTED).toHaveLength(5);
    });

    it("has shorter/incomplete answers than standard", () => {
      const standardTotalLength = SAMPLE_ANSWERS_STANDARD.reduce(
        (sum, a) => sum + a.answer.length,
        0
      );
      const rejectedTotalLength = SAMPLE_ANSWERS_REJECTED.reduce(
        (sum, a) => sum + a.answer.length,
        0
      );
      expect(rejectedTotalLength).toBeLessThan(standardTotalLength);
    });

    it("last answer is empty string", () => {
      expect(SAMPLE_ANSWERS_REJECTED[4].answer).toBe("");
    });

    it("matches same questions as standard set", () => {
      SAMPLE_ANSWERS_REJECTED.forEach((answer, idx) => {
        expect(answer.question).toBe(SAMPLE_ANSWERS_STANDARD[idx].question);
      });
    });
  });

  describe("SAMPLE_REJECTION_REASON", () => {
    it("is a non-empty string", () => {
      expect(typeof SAMPLE_REJECTION_REASON).toBe("string");
      expect(SAMPLE_REJECTION_REASON.length).toBeGreaterThan(0);
    });

    it("mentions incomplete or inconsistent responses", () => {
      expect(SAMPLE_REJECTION_REASON.toLowerCase()).toMatch(/incomplete|inconsistent/);
    });
  });

  describe("SAMPLE_HISTORY", () => {
    it("has 3 history entries", () => {
      expect(SAMPLE_HISTORY).toHaveLength(3);
    });

    it("contains expected action types", () => {
      const actions = SAMPLE_HISTORY.map((h) => h.action);
      expect(actions).toContain("claim");
      expect(actions).toContain("approved");
      expect(actions).toContain("submitted");
    });

    it("all entries have required fields", () => {
      SAMPLE_HISTORY.forEach((entry) => {
        expect(entry.action).toBeDefined();
        expect(entry.moderator_id).toBeDefined();
        expect(entry.created_at).toBeDefined();
        expect(typeof entry.created_at).toBe("number");
      });
    });

    it("entries are in chronological order (most recent first)", () => {
      for (let i = 0; i < SAMPLE_HISTORY.length - 1; i++) {
        expect(SAMPLE_HISTORY[i].created_at).toBeGreaterThan(
          SAMPLE_HISTORY[i + 1].created_at
        );
      }
    });

    it("timestamps are reasonable Unix timestamps", () => {
      const now = Math.floor(Date.now() / 1000);
      SAMPLE_HISTORY.forEach((entry) => {
        // Should be within last 2 days (86400 * 2 seconds)
        expect(entry.created_at).toBeGreaterThan(now - 86400 * 2);
        expect(entry.created_at).toBeLessThanOrEqual(now);
      });
    });
  });
});
