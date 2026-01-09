/**
 * Pawtropolis Tech — tests/lib/csv.test.ts
 * WHAT: Unit tests for CSV utilities.
 * WHY: Verify CSV escaping and formatting comply with RFC 4180.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";
import { formatActionLogRow, generateModHistoryCsv } from "../../src/lib/csv.js";

// Mock dependencies
vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/time.js", () => ({
  tsToIso: vi.fn((ts: number) => new Date(ts * 1000).toISOString()),
}));

describe("csv", () => {
  describe("formatActionLogRow", () => {
    it("formats a basic action log row", () => {
      const row = {
        id: 1,
        action: "approve",
        actor_id: "mod-123",
        subject_id: "user-456",
        target: "app-789",
        created_at_s: 1700000000,
        reason: "Looks good",
        meta_json: null,
        guild_id: "guild-123",
      };

      const result = formatActionLogRow(row);

      expect(result.id).toBe(1);
      expect(result.action).toBe("approve");
      expect(result.actor_id).toBe("mod-123");
      expect(result.subject_id).toBe("user-456");
      expect(result.target).toBe("app-789");
      expect(result.reason).toBe("Looks good");
      expect(result.guild_id).toBe("guild-123");
      expect(result.timestamp).toContain("2023");
    });

    it("parses meta_json when present", () => {
      const row = {
        id: 2,
        action: "claim",
        actor_id: "mod-123",
        subject_id: null,
        target: null,
        created_at_s: 1700000000,
        reason: null,
        meta_json: JSON.stringify({
          appId: "app-123",
          appCode: "ABC123",
          response_ms: 500,
        }),
        guild_id: "guild-123",
      };

      const result = formatActionLogRow(row);

      expect(result.app_id).toBe("app-123");
      expect(result.app_code).toBe("ABC123");
      expect(result.response_ms).toBe(500);
    });

    it("handles malformed meta_json gracefully", () => {
      const row = {
        id: 3,
        action: "reject",
        actor_id: "mod-123",
        subject_id: null,
        target: null,
        created_at_s: 1700000000,
        reason: null,
        meta_json: "not valid json {",
        guild_id: "guild-123",
      };

      const result = formatActionLogRow(row);

      // Should not throw, preserves raw in meta_summary
      expect(result.meta_summary).toContain("not valid json {");
    });

    it("handles null optional fields", () => {
      const row = {
        id: 4,
        action: "view",
        actor_id: "mod-123",
        subject_id: null,
        target: null,
        created_at_s: 1700000000,
        reason: null,
        meta_json: null,
        guild_id: "guild-123",
      };

      const result = formatActionLogRow(row);

      expect(result.subject_id).toBe("");
      expect(result.target).toBe("");
      expect(result.reason).toBe("");
    });

    it("extracts target from meta when not in row", () => {
      const row = {
        id: 5,
        action: "approve",
        actor_id: "mod-123",
        subject_id: null,
        target: null,
        created_at_s: 1700000000,
        reason: null,
        meta_json: JSON.stringify({ target: "meta-target" }),
        guild_id: "guild-123",
      };

      const result = formatActionLogRow(row);

      expect(result.target).toBe("meta-target");
    });
  });

  describe("generateModHistoryCsv", () => {
    it("generates CSV with header and rows", () => {
      const rows = [
        {
          id: 1,
          action: "approve",
          actor_id: "mod-123",
          subject_id: "user-456",
          target: "app-789",
          created_at_s: 1700000000,
          reason: "Test",
          meta_json: null,
          guild_id: "guild-123",
        },
      ];

      const csv = generateModHistoryCsv(rows);

      // Should have header row
      expect(csv).toContain("id,timestamp,action,actor_id");

      // Should have data row
      expect(csv).toContain("approve");
      expect(csv).toContain("mod-123");
    });

    it("escapes fields with commas", () => {
      const rows = [
        {
          id: 1,
          action: "reject",
          actor_id: "mod-123",
          subject_id: null,
          target: null,
          created_at_s: 1700000000,
          reason: "Multiple reasons: A, B, C",
          meta_json: null,
          guild_id: "guild-123",
        },
      ];

      const csv = generateModHistoryCsv(rows);

      // Field with comma should be quoted
      expect(csv).toContain('"Multiple reasons: A, B, C"');
    });

    it("escapes fields with quotes", () => {
      const rows = [
        {
          id: 1,
          action: "reject",
          actor_id: "mod-123",
          subject_id: null,
          target: null,
          created_at_s: 1700000000,
          reason: 'User said "suspicious stuff"',
          meta_json: null,
          guild_id: "guild-123",
        },
      ];

      const csv = generateModHistoryCsv(rows);

      // Quotes should be doubled and field quoted
      expect(csv).toContain('"User said ""suspicious stuff"""');
    });

    it("escapes fields with newlines", () => {
      const rows = [
        {
          id: 1,
          action: "reject",
          actor_id: "mod-123",
          subject_id: null,
          target: null,
          created_at_s: 1700000000,
          reason: "Line 1\nLine 2",
          meta_json: null,
          guild_id: "guild-123",
        },
      ];

      const csv = generateModHistoryCsv(rows);

      // Field with newline should be quoted
      expect(csv).toContain('"Line 1\nLine 2"');
    });

    it("handles empty rows array", () => {
      const csv = generateModHistoryCsv([]);

      // Should have header only
      expect(csv).toContain("id,timestamp,action");
      expect(csv.split("\n").length).toBe(1); // Just header
    });

    it("handles multiple rows", () => {
      const rows = [
        {
          id: 1,
          action: "approve",
          actor_id: "mod-1",
          subject_id: null,
          target: null,
          created_at_s: 1700000000,
          reason: null,
          meta_json: null,
          guild_id: "guild-123",
        },
        {
          id: 2,
          action: "reject",
          actor_id: "mod-2",
          subject_id: null,
          target: null,
          created_at_s: 1700000001,
          reason: null,
          meta_json: null,
          guild_id: "guild-123",
        },
      ];

      const csv = generateModHistoryCsv(rows);

      // Header + 2 data rows
      expect(csv.split("\n").length).toBe(3);
    });

    it("outputs all expected columns", () => {
      const csv = generateModHistoryCsv([]);
      const header = csv.split("\n")[0];
      const columns = header.split(",");

      expect(columns).toContain("id");
      expect(columns).toContain("timestamp");
      expect(columns).toContain("action");
      expect(columns).toContain("actor_id");
      expect(columns).toContain("subject_id");
      expect(columns).toContain("target");
      expect(columns).toContain("reason");
      expect(columns).toContain("response_ms");
      expect(columns).toContain("guild_id");
      expect(columns).toContain("app_id");
      expect(columns).toContain("app_code");
      expect(columns).toContain("meta_summary");
    });
  });
});
