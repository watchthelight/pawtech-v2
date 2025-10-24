/**
 * WHAT: Tests upsertQuestion and getQuestions functions from gate/questions.ts
 * HOW: Uses in-memory better-sqlite3 to test question CRUD operations
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Mock logger before importing questions module
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  redact: (v: string) => v,
}));

// Mock db module
let testDb: Database.Database;
vi.mock("../../src/db/db.js", () => ({
  get db() {
    return testDb;
  },
}));

import { getQuestions, upsertQuestion, getQuestionCount } from "../../src/features/gate/questions.js";

describe("gate questions", () => {
  const testDbPath = path.join(process.cwd(), "tests", "test-gate-questions.db");

  beforeEach(() => {
    // Create fresh test database
    testDb = new Database(testDbPath);
    testDb.pragma("foreign_keys = ON");

    // Create guild_config table (referenced by guild_question FK)
    testDb.exec(`
      CREATE TABLE guild_config (
        guild_id TEXT NOT NULL PRIMARY KEY,
        review_channel_id TEXT,
        gate_channel_id TEXT,
        general_channel_id TEXT,
        accepted_role_id TEXT
      )
    `);

    // Create guild_question table
    testDb.exec(`
      CREATE TABLE guild_question (
        guild_id TEXT NOT NULL,
        q_index INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
        PRIMARY KEY (guild_id, q_index),
        FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
      )
    `);

    // Insert test guild
    testDb.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").run("guild123");
  });

  afterEach(() => {
    testDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("getQuestions", () => {
    it("returns empty array when no questions exist", () => {
      const result = getQuestions("guild123");
      expect(result).toEqual([]);
    });

    it("returns questions ordered by q_index", () => {
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 2, "Question 3", 1);
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 0, "Question 1", 1);
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 1, "Question 2", 0);

      const result = getQuestions("guild123");

      expect(result).toHaveLength(3);
      expect(result[0].q_index).toBe(0);
      expect(result[0].prompt).toBe("Question 1");
      expect(result[0].required).toBe(1);
      expect(result[1].q_index).toBe(1);
      expect(result[1].prompt).toBe("Question 2");
      expect(result[1].required).toBe(0);
      expect(result[2].q_index).toBe(2);
      expect(result[2].prompt).toBe("Question 3");
    });

    it("only returns questions for the specified guild", () => {
      testDb.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").run("guild456");
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 0, "Guild 123 Q1", 1);
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild456", 0, "Guild 456 Q1", 1);

      const result = getQuestions("guild123");

      expect(result).toHaveLength(1);
      expect(result[0].prompt).toBe("Guild 123 Q1");
    });
  });

  describe("getQuestionCount", () => {
    it("returns 0 when no questions exist", () => {
      const result = getQuestionCount("guild123");
      expect(result).toBe(0);
    });

    it("returns correct count of questions", () => {
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 0, "Q1", 1);
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 1, "Q2", 1);
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 2, "Q3", 1);

      const result = getQuestionCount("guild123");
      expect(result).toBe(3);
    });
  });

  describe("upsertQuestion", () => {
    it("inserts a new question when it doesn't exist", () => {
      upsertQuestion("guild123", 0, "What is your age?", 1);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(1);
      expect(questions[0].q_index).toBe(0);
      expect(questions[0].prompt).toBe("What is your age?");
      expect(questions[0].required).toBe(1);
    });

    it("updates existing question when it exists", () => {
      // Insert initial question
      testDb.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run("guild123", 0, "Old question", 1);

      // Update via upsert
      upsertQuestion("guild123", 0, "New question", 0);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(1);
      expect(questions[0].prompt).toBe("New question");
      expect(questions[0].required).toBe(0);
    });

    it("allows multiple questions with different indices", () => {
      upsertQuestion("guild123", 0, "Question 1", 1);
      upsertQuestion("guild123", 1, "Question 2", 1);
      upsertQuestion("guild123", 2, "Question 3", 0);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(3);
    });

    it("updates only the prompt when upserting existing question", () => {
      upsertQuestion("guild123", 0, "First version", 1);
      upsertQuestion("guild123", 0, "Second version", 1);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(1);
      expect(questions[0].prompt).toBe("Second version");
    });

    it("validates q_index is between 0 and 4", () => {
      expect(() => upsertQuestion("guild123", -1, "Invalid", 1)).toThrow("Question index must be between 0 and 4");
      expect(() => upsertQuestion("guild123", 5, "Invalid", 1)).toThrow("Question index must be between 0 and 4");
      expect(() => upsertQuestion("guild123", 10, "Invalid", 1)).toThrow("Question index must be between 0 and 4");
    });

    it("allows q_index 0 and 4 as boundary values", () => {
      upsertQuestion("guild123", 0, "Question 0", 1);
      upsertQuestion("guild123", 4, "Question 4", 1);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(2);
      expect(questions[0].q_index).toBe(0);
      expect(questions[1].q_index).toBe(4);
    });
  });

  describe("partial update scenario", () => {
    it("updates only q2 and q4, leaving others unchanged", () => {
      // Seed initial questions
      upsertQuestion("guild123", 0, "Q1 original", 1);
      upsertQuestion("guild123", 1, "Q2 original", 1);
      upsertQuestion("guild123", 2, "Q3 original", 1);
      upsertQuestion("guild123", 3, "Q4 original", 1);

      // Update only q2 and q4 (indices 1 and 3)
      upsertQuestion("guild123", 1, "Q2 updated", 1);
      upsertQuestion("guild123", 3, "Q4 updated", 1);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(4);
      expect(questions[0].prompt).toBe("Q1 original"); // Unchanged
      expect(questions[1].prompt).toBe("Q2 updated");   // Updated
      expect(questions[2].prompt).toBe("Q3 original"); // Unchanged
      expect(questions[3].prompt).toBe("Q4 updated");   // Updated
    });

    it("setting q1 twice overwrites the previous prompt", () => {
      upsertQuestion("guild123", 0, "First value", 1);
      upsertQuestion("guild123", 0, "Second value", 1);
      upsertQuestion("guild123", 0, "Third value", 1);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(1);
      expect(questions[0].prompt).toBe("Third value");
    });

    it("omitted inputs don't delete questions", () => {
      // Seed 5 questions
      for (let i = 0; i < 5; i++) {
        upsertQuestion("guild123", i, `Question ${i + 1}`, 1);
      }

      // Update only q1 (index 0)
      upsertQuestion("guild123", 0, "Updated Q1", 1);

      const questions = getQuestions("guild123");
      expect(questions).toHaveLength(5); // All 5 still exist
      expect(questions[0].prompt).toBe("Updated Q1");
      expect(questions[1].prompt).toBe("Question 2"); // Unchanged
    });
  });

  describe("multi-guild isolation", () => {
    it("questions are isolated per guild", () => {
      testDb.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").run("guild456");

      upsertQuestion("guild123", 0, "Guild 123 Question", 1);
      upsertQuestion("guild456", 0, "Guild 456 Question", 1);

      const questions123 = getQuestions("guild123");
      const questions456 = getQuestions("guild456");

      expect(questions123).toHaveLength(1);
      expect(questions456).toHaveLength(1);
      expect(questions123[0].prompt).toBe("Guild 123 Question");
      expect(questions456[0].prompt).toBe("Guild 456 Question");
    });
  });
});
