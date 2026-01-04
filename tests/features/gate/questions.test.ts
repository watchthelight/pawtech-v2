/**
 * Pawtropolis Tech — tests/features/gate/questions.test.ts
 * WHAT: Unit tests for gate questions module.
 * WHY: Verify question CRUD operations and seeding logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mock functions that are available during mock hoisting
const { mockGet, mockAll, mockRun } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
}));

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    })),
    transaction: vi.fn((fn: Function) => fn), // Return the function, don't call it
  },
}));

vi.mock("../../../src/lib/cmdWrap.js", () => ({
  withSql: vi.fn((_ctx: unknown, _sql: string, fn: Function) => fn()),
}));

import {
  DEFAULT_QUESTIONS,
  getQuestions,
  getQuestionCount,
  upsertQuestion,
  seedDefaultQuestionsIfEmpty,
} from "../../../src/features/gate/questions.js";

describe("features/gate/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DEFAULT_QUESTIONS", () => {
    it("has 5 default questions", () => {
      expect(DEFAULT_QUESTIONS).toHaveLength(5);
    });

    it("has questions with sequential indexes 0-4", () => {
      const indexes = DEFAULT_QUESTIONS.map((q) => q.q_index);
      expect(indexes).toEqual([0, 1, 2, 3, 4]);
    });

    it("has all questions marked as required", () => {
      for (const q of DEFAULT_QUESTIONS) {
        expect(q.required).toBe(1);
      }
    });

    it("has non-empty prompts for all questions", () => {
      for (const q of DEFAULT_QUESTIONS) {
        expect(q.prompt.length).toBeGreaterThan(0);
      }
    });

    it("includes age question as first question", () => {
      expect(DEFAULT_QUESTIONS[0].prompt).toContain("age");
    });

    it("includes password question as last question", () => {
      expect(DEFAULT_QUESTIONS[4].prompt).toContain("password");
    });
  });

  describe("getQuestions", () => {
    it("queries database with guild ID", () => {
      mockAll.mockReturnValue([]);

      getQuestions("guild123");

      expect(mockAll).toHaveBeenCalledWith("guild123");
    });

    it("returns empty array for unknown guild", () => {
      mockAll.mockReturnValue([]);

      const result = getQuestions("unknown-guild");

      expect(result).toEqual([]);
    });

    it("returns questions ordered by q_index", () => {
      mockAll.mockReturnValue([
        { q_index: 0, prompt: "Q1", required: 1 },
        { q_index: 1, prompt: "Q2", required: 1 },
        { q_index: 2, prompt: "Q3", required: 0 },
      ]);

      const result = getQuestions("guild123");

      expect(result).toHaveLength(3);
      expect(result[0].q_index).toBe(0);
      expect(result[1].q_index).toBe(1);
      expect(result[2].q_index).toBe(2);
    });
  });

  describe("getQuestionCount", () => {
    it("returns count from database", () => {
      mockGet.mockReturnValue({ n: 5 });

      const result = getQuestionCount("guild123");

      expect(result).toBe(5);
    });

    it("returns 0 when no questions exist", () => {
      mockGet.mockReturnValue({ n: 0 });

      const result = getQuestionCount("guild123");

      expect(result).toBe(0);
    });

    it("returns 0 when query returns undefined", () => {
      mockGet.mockReturnValue(undefined);

      const result = getQuestionCount("guild123");

      expect(result).toBe(0);
    });
  });

  describe("upsertQuestion", () => {
    it("validates q_index range", () => {
      expect(() => upsertQuestion("guild123", -1, "Prompt", 1)).toThrow("between 0 and 4");
      expect(() => upsertQuestion("guild123", 5, "Prompt", 1)).toThrow("between 0 and 4");
    });

    it("validates prompt is non-empty string", () => {
      expect(() => upsertQuestion("guild123", 0, "", 1)).toThrow("non-empty string");
      expect(() => upsertQuestion("guild123", 0, "   ", 1)).toThrow("empty or whitespace");
    });

    it("validates prompt length limit (45 chars)", () => {
      const longPrompt = "A".repeat(50);
      expect(() => upsertQuestion("guild123", 0, longPrompt, 1)).toThrow("45 characters or less");
    });

    it("validates required is 0 or 1", () => {
      expect(() => upsertQuestion("guild123", 0, "Prompt", 2 as 0 | 1)).toThrow("0 or 1");
    });

    it("validates guild ID is non-empty", () => {
      expect(() => upsertQuestion("", 0, "Prompt", 1)).toThrow("non-empty string");
      expect(() => upsertQuestion("   ", 0, "Prompt", 1)).toThrow("non-empty string");
    });

    it("trims prompt before saving", () => {
      mockRun.mockReturnValue({ changes: 1 });

      upsertQuestion("guild123", 0, "  Trimmed Prompt  ", 1);

      expect(mockRun).toHaveBeenCalledWith("guild123", 0, "Trimmed Prompt", 1);
    });

    it("executes upsert SQL", () => {
      mockRun.mockReturnValue({ changes: 1 });

      upsertQuestion("guild123", 2, "Test Question", 1);

      expect(mockRun).toHaveBeenCalledWith("guild123", 2, "Test Question", 1);
    });

    it("uses withSql when context provided", () => {
      mockRun.mockReturnValue({ changes: 1 });
      const mockCtx = { step: vi.fn() };

      upsertQuestion("guild123", 0, "Test", 1, mockCtx as unknown as Parameters<typeof upsertQuestion>[4]);

      // Function should complete without error
      expect(mockRun).toHaveBeenCalled();
    });

    it("accepts required=0 for optional questions", () => {
      mockRun.mockReturnValue({ changes: 1 });

      upsertQuestion("guild123", 3, "Optional Question", 0);

      expect(mockRun).toHaveBeenCalledWith("guild123", 3, "Optional Question", 0);
    });
  });

  describe("seedDefaultQuestionsIfEmpty", () => {
    it("validates guild ID", () => {
      expect(() => seedDefaultQuestionsIfEmpty("")).toThrow("non-empty string");
    });

    it("returns early if questions already exist", () => {
      mockGet.mockReturnValue({ n: 3 });

      const result = seedDefaultQuestionsIfEmpty("guild123");

      expect(result).toEqual({ inserted: 0, total: 3 });
    });

    it("seeds default questions when count is 0", () => {
      mockGet
        .mockReturnValueOnce({ n: 0 }) // First call: check count
        .mockReturnValueOnce({ n: 5 }); // Second call: verify after seed
      mockRun.mockReturnValue({ changes: 1 });

      const result = seedDefaultQuestionsIfEmpty("guild123");

      expect(result.inserted).toBe(5);
      expect(result.total).toBe(5);
    });

    it("inserts all default questions", () => {
      mockGet
        .mockReturnValueOnce({ n: 0 })
        .mockReturnValueOnce({ n: 5 });
      mockRun.mockReturnValue({ changes: 1 });

      seedDefaultQuestionsIfEmpty("guild123");

      // Should run for each default question
      expect(mockRun).toHaveBeenCalledTimes(5);
    });

    it("uses context for SQL tracking when provided", () => {
      mockGet
        .mockReturnValueOnce({ n: 0 })
        .mockReturnValueOnce({ n: 5 });
      mockRun.mockReturnValue({ changes: 1 });
      const mockCtx = { step: vi.fn() };

      seedDefaultQuestionsIfEmpty("guild123", mockCtx as unknown as Parameters<typeof seedDefaultQuestionsIfEmpty>[1]);

      // Should complete without error
      expect(mockRun).toHaveBeenCalled();
    });

    it("re-queries count after seeding to verify", () => {
      mockGet
        .mockReturnValueOnce({ n: 0 })
        .mockReturnValueOnce({ n: 5 });
      mockRun.mockReturnValue({ changes: 1 });

      const result = seedDefaultQuestionsIfEmpty("guild123");

      // getQuestionCount called twice: before and after
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(5);
    });
  });
});
