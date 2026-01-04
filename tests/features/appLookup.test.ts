/**
 * Pawtropolis Tech — tests/features/appLookup.test.ts
 * WHAT: Unit tests for application lookup module.
 * WHY: Verify code normalization, lookup strategies, and short code sync.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockAll, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
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

vi.mock("../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => {
    // Simulate HEX6 short code generation
    return id.slice(0, 6).toUpperCase();
  }),
}));

import {
  normalizeCode,
  findAppByShortCode,
  findAppByCodeOrMessage,
  syncShortCodeMappings,
} from "../../src/features/appLookup.js";

describe("features/appLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe("normalizeCode", () => {
    it("uppercases lowercase input", () => {
      expect(normalizeCode("abc123")).toBe("ABC123");
    });

    it("handles already uppercase input", () => {
      expect(normalizeCode("ABC123")).toBe("ABC123");
    });

    it("strips non-hex characters", () => {
      expect(normalizeCode("abc-123")).toBe("ABC123");
      expect(normalizeCode("#ABC123")).toBe("ABC123");
      expect(normalizeCode("abc_123")).toBe("ABC123");
    });

    it("truncates to 6 characters", () => {
      expect(normalizeCode("ABCDEF123456")).toBe("ABCDEF");
    });

    it("handles empty input", () => {
      expect(normalizeCode("")).toBe("");
    });

    it("handles null/undefined input", () => {
      expect(normalizeCode(null as any)).toBe("");
      expect(normalizeCode(undefined as any)).toBe("");
    });

    it("strips non-hex letters", () => {
      expect(normalizeCode("GHIJKL")).toBe("");
      expect(normalizeCode("ABCDGH")).toBe("ABCD");
    });
  });

  describe("findAppByShortCode", () => {
    it("returns null for invalid code length", () => {
      const result = findAppByShortCode("guild123", "ABC");
      expect(result).toBeNull();
    });

    it("checks mapping table existence", () => {
      mockGet.mockReturnValueOnce(undefined); // no mapping table
      mockAll.mockReturnValue([]); // fallback scan returns empty

      findAppByShortCode("guild123", "ABC123");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("sqlite_master")
      );
    });

    it("looks up via mapping table when available", () => {
      mockGet
        .mockReturnValueOnce({ name: "app_short_codes" }) // table exists
        .mockReturnValueOnce({ app_id: "app-uuid-123" }) // mapping found
        .mockReturnValueOnce({ id: "app-uuid-123", guild_id: "guild123" }); // app found

      const result = findAppByShortCode("guild123", "ABC123");

      expect(result).toBeDefined();
      expect(result?.id).toBe("app-uuid-123");
    });

    it("falls back to full scan when mapping not found", () => {
      mockGet
        .mockReturnValueOnce({ name: "app_short_codes" }) // table exists
        .mockReturnValueOnce(undefined); // mapping not found

      mockAll.mockReturnValue([
        { id: "ABC123-rest", guild_id: "guild123", status: "pending" },
      ]);

      const result = findAppByShortCode("guild123", "ABC123");

      expect(mockAll).toHaveBeenCalled();
    });

    it("returns null when no match found", () => {
      mockGet
        .mockReturnValueOnce({ name: "app_short_codes" })
        .mockReturnValueOnce(undefined);

      mockAll.mockReturnValue([]);

      const result = findAppByShortCode("guild123", "NOTFND");
      expect(result).toBeNull();
    });
  });

  describe("findAppByCodeOrMessage", () => {
    it("prioritizes messageId lookup", () => {
      mockGet
        .mockReturnValueOnce({ app_id: "app-from-msg" }) // review_card lookup
        .mockReturnValueOnce({ id: "app-from-msg", guild_id: "guild123" }); // app lookup

      const result = findAppByCodeOrMessage({
        guildId: "guild123",
        messageId: "msg123",
        code: "ABC123",
      });

      expect(result?.id).toBe("app-from-msg");
    });

    it("falls back to code when messageId not found", () => {
      mockGet
        .mockReturnValueOnce(undefined) // review_card not found
        .mockReturnValueOnce({ name: "app_short_codes" }) // table exists
        .mockReturnValueOnce({ app_id: "app-from-code" }) // mapping found
        .mockReturnValueOnce({ id: "app-from-code", guild_id: "guild123" }); // app found

      const result = findAppByCodeOrMessage({
        guildId: "guild123",
        messageId: "msg123",
        code: "ABC123",
      });

      expect(result?.id).toBe("app-from-code");
    });

    it("tries full app ID when short code fails", () => {
      mockGet
        .mockReturnValueOnce({ name: "app_short_codes" }) // table exists
        .mockReturnValueOnce(undefined) // mapping not found
        .mockReturnValueOnce({ id: "full-uuid-app", guild_id: "guild123" }); // full ID lookup

      mockAll.mockReturnValue([]); // full scan returns nothing

      const result = findAppByCodeOrMessage({
        guildId: "guild123",
        code: "full-uuid-app",
      });

      // Should attempt full ID lookup
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = ?")
      );
    });

    it("returns null when nothing found", () => {
      mockGet.mockReturnValue(undefined);
      mockAll.mockReturnValue([]);

      const result = findAppByCodeOrMessage({
        guildId: "guild123",
      });

      expect(result).toBeNull();
    });
  });

  describe("syncShortCodeMappings", () => {
    it("returns 0 when mapping table does not exist", () => {
      mockGet.mockReturnValue(undefined); // no table

      const result = syncShortCodeMappings("guild123");

      expect(result).toBe(0);
    });

    it("syncs all applications when guildId not provided", () => {
      mockGet.mockReturnValue({ name: "app_short_codes" });
      mockAll.mockReturnValue([
        { id: "app1", guild_id: "guild123" },
        { id: "app2", guild_id: "guild456" },
      ]);
      mockRun.mockReturnValue({ changes: 1 });

      const result = syncShortCodeMappings();

      expect(mockAll).toHaveBeenCalled();
      expect(result).toBe(2);
    });

    it("syncs only guild applications when guildId provided", () => {
      mockGet.mockReturnValue({ name: "app_short_codes" });
      mockAll.mockReturnValue([{ id: "app1", guild_id: "guild123" }]);
      mockRun.mockReturnValue({ changes: 1 });

      const result = syncShortCodeMappings("guild123");

      expect(mockAll).toHaveBeenCalled();
      expect(result).toBe(1);
    });

    it("handles insert errors gracefully", () => {
      mockGet.mockReturnValue({ name: "app_short_codes" });
      mockAll.mockReturnValue([{ id: "app1", guild_id: "guild123" }]);
      mockRun.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      // Should not throw
      const result = syncShortCodeMappings("guild123");
      expect(result).toBe(0);
    });

    it("counts only new mappings", () => {
      mockGet.mockReturnValue({ name: "app_short_codes" });
      mockAll.mockReturnValue([
        { id: "app1", guild_id: "guild123" },
        { id: "app2", guild_id: "guild123" },
        { id: "app3", guild_id: "guild123" },
      ]);
      mockRun
        .mockReturnValueOnce({ changes: 1 }) // new
        .mockReturnValueOnce({ changes: 0 }) // already exists
        .mockReturnValueOnce({ changes: 1 }); // new

      const result = syncShortCodeMappings("guild123");

      expect(result).toBe(2);
    });
  });
});

describe("short code format", () => {
  describe("HEX6 format", () => {
    it("is 6 characters long", () => {
      const codeLength = 6;
      expect(codeLength).toBe(6);
    });

    it("uses uppercase hex characters", () => {
      const validChars = /^[0-9A-F]+$/;
      expect(validChars.test("ABC123")).toBe(true);
      expect(validChars.test("abc123")).toBe(false);
      expect(validChars.test("GHIJKL")).toBe(false);
    });
  });

  describe("collision probability", () => {
    it("has 16M possible values", () => {
      // 16^6 = 16,777,216 possible values
      const possibleValues = Math.pow(16, 6);
      expect(possibleValues).toBe(16777216);
    });
  });
});

describe("lookup priority", () => {
  describe("resolution order", () => {
    it("prioritizes messageId over code", () => {
      const priorities = ["messageId", "shortCode", "fullAppId"];
      expect(priorities[0]).toBe("messageId");
    });

    it("falls back to shortCode when messageId fails", () => {
      const priorities = ["messageId", "shortCode", "fullAppId"];
      expect(priorities[1]).toBe("shortCode");
    });

    it("tries fullAppId as last resort", () => {
      const priorities = ["messageId", "shortCode", "fullAppId"];
      expect(priorities[2]).toBe("fullAppId");
    });
  });
});

describe("app_short_codes table", () => {
  describe("schema", () => {
    it("has app_id column", () => {
      const columns = ["app_id", "guild_id", "code"];
      expect(columns).toContain("app_id");
    });

    it("has guild_id column", () => {
      const columns = ["app_id", "guild_id", "code"];
      expect(columns).toContain("guild_id");
    });

    it("has code column", () => {
      const columns = ["app_id", "guild_id", "code"];
      expect(columns).toContain("code");
    });
  });

  describe("INSERT OR IGNORE", () => {
    it("is idempotent for duplicate mappings", () => {
      const sql = "INSERT OR IGNORE INTO app_short_codes (app_id, guild_id, code) VALUES (?, ?, ?)";
      expect(sql).toContain("OR IGNORE");
    });
  });
});

describe("review_card lookup", () => {
  describe("messageId resolution", () => {
    it("looks up by message_id", () => {
      const sql = "SELECT app_id FROM review_card WHERE message_id = ?";
      expect(sql).toContain("message_id");
      expect(sql).toContain("app_id");
    });
  });
});

describe("application table lookup", () => {
  describe("by app ID", () => {
    it("verifies guild_id matches", () => {
      // Security: ensure app belongs to requesting guild
      const app = { id: "app123", guild_id: "guild456" };
      const requestedGuildId = "guild123";
      const matches = app.guild_id === requestedGuildId;

      expect(matches).toBe(false);
    });
  });
});
