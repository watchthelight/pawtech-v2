/**
 * Pawtropolis Tech — tests/features/analytics/command.test.ts
 * WHAT: Unit tests for analytics command handlers.
 * WHY: Verify command parsing, permission checks, and response formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies with vi.hoisted
const {
  mockNowUtc,
  mockTsToIso,
  mockGetActionCountsByMod,
  mockGetTopReasons,
  mockGetVolumeSeries,
  mockGetLeadTimeStats,
  mockGetOpenQueueAge,
  mockStreamReviewActionsCSV,
} = vi.hoisted(() => ({
  mockNowUtc: vi.fn(),
  mockTsToIso: vi.fn(),
  mockGetActionCountsByMod: vi.fn(),
  mockGetTopReasons: vi.fn(),
  mockGetVolumeSeries: vi.fn(),
  mockGetLeadTimeStats: vi.fn(),
  mockGetOpenQueueAge: vi.fn(),
  mockStreamReviewActionsCSV: vi.fn(),
}));

vi.mock("../../../src/lib/time.js", () => ({
  nowUtc: mockNowUtc,
  tsToIso: mockTsToIso,
}));

vi.mock("../../../src/lib/owner.js", () => ({
  isOwner: vi.fn(),
}));

vi.mock("../../../src/lib/config.js", () => ({
  hasStaffPermissions: vi.fn(),
}));

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/features/analytics/queries.js", () => ({
  getActionCountsByMod: mockGetActionCountsByMod,
  getTopReasons: mockGetTopReasons,
  getVolumeSeries: mockGetVolumeSeries,
  getLeadTimeStats: mockGetLeadTimeStats,
  getOpenQueueAge: mockGetOpenQueueAge,
}));

vi.mock("../../../src/lib/csv.js", () => ({
  streamReviewActionsCSV: mockStreamReviewActionsCSV,
}));

// Mock discord.js
vi.mock("discord.js", () => ({
  EmbedBuilder: class {
    data: any = {};
    setTitle(title: string) { this.data.title = title; return this; }
    setColor(color: number) { this.data.color = color; return this; }
    setDescription(desc: string) { this.data.description = desc; return this; }
    setTimestamp() { return this; }
    addFields(...fields: any[]) {
      this.data.fields = [...(this.data.fields || []), ...fields];
      return this;
    }
  },
  AttachmentBuilder: class {
    constructor(public buffer: Buffer, public options: any) {}
  },
  MessageFlags: {
    Ephemeral: 64,
  },
}));

import {
  parseWindow,
  executeAnalyticsCommand,
  executeAnalyticsExportCommand,
} from "../../../src/features/analytics/command.js";
import { isOwner } from "../../../src/lib/owner.js";
import { hasStaffPermissions } from "../../../src/lib/config.js";
import { logger } from "../../../src/lib/logger.js";

describe("analytics/command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNowUtc.mockReturnValue(1704672000);
    mockTsToIso.mockImplementation((ts) => new Date(ts * 1000).toISOString());
  });

  describe("parseWindow", () => {
    it("uses defaults when no params provided", () => {
      const result = parseWindow(1704672000);

      expect(result.to).toBe(1704672000);
      expect(result.from).toBe(1704672000 - 7 * 86400);
    });

    it("uses provided from and to", () => {
      const result = parseWindow(1704672000, 1704067200, 1704672000);

      expect(result.from).toBe(1704067200);
      expect(result.to).toBe(1704672000);
    });

    it("uses provided from with default to", () => {
      const result = parseWindow(1704672000, 1704067200);

      expect(result.from).toBe(1704067200);
      expect(result.to).toBe(1704672000);
    });

    it("uses default from with provided to", () => {
      const result = parseWindow(1704672000, undefined, 1704500000);

      expect(result.to).toBe(1704500000);
      expect(result.from).toBe(1704500000 - 7 * 86400);
    });
  });

  describe("executeAnalyticsCommand", () => {
    const createMockInteraction = (overrides: any = {}) => ({
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      options: {
        getInteger: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
        getString: vi.fn().mockReturnValue(null),
      },
      guildId: "guild-123",
      guild: { name: "Test Guild" },
      user: { id: "user-123" },
      member: { id: "user-123" },
      ...overrides,
    });

    it("defers reply as ephemeral", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockGetActionCountsByMod.mockReturnValue([]);
      mockGetTopReasons.mockReturnValue([]);
      mockGetVolumeSeries.mockReturnValue([]);
      mockGetLeadTimeStats.mockReturnValue({ n: 0, p50: 0, p90: 0, mean: 0 });
      mockGetOpenQueueAge.mockReturnValue({ count: 0 });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    });

    it("rejects invalid time range", async () => {
      const interaction = createMockInteraction({
        options: {
          getInteger: vi.fn().mockImplementation((name: string) => {
            if (name === "from") return 1704672000;
            if (name === "to") return 1704067200;
            return null;
          }),
          getBoolean: vi.fn().mockReturnValue(null),
          getString: vi.fn().mockReturnValue(null),
        },
      });
      (hasStaffPermissions as any).mockReturnValue(true);

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Invalid time range"),
      });
    });

    it("rejects all-guilds for non-owner", async () => {
      const interaction = createMockInteraction({
        options: {
          getInteger: vi.fn().mockReturnValue(null),
          getBoolean: vi.fn().mockImplementation((name: string) => name === "all-guilds"),
          getString: vi.fn().mockReturnValue(null),
        },
      });
      (isOwner as any).mockReturnValue(false);

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("restricted to bot owners"),
      });
    });

    it("allows all-guilds for owner", async () => {
      const interaction = createMockInteraction({
        options: {
          getInteger: vi.fn().mockReturnValue(null),
          getBoolean: vi.fn().mockImplementation((name: string) => name === "all-guilds"),
          getString: vi.fn().mockReturnValue(null),
        },
      });
      (isOwner as any).mockReturnValue(true);
      mockGetActionCountsByMod.mockReturnValue([]);
      mockGetTopReasons.mockReturnValue([]);
      mockGetVolumeSeries.mockReturnValue([]);
      mockGetLeadTimeStats.mockReturnValue({ n: 0, p50: 0, p90: 0, mean: 0 });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
      });
    });

    it("rejects non-staff users", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(false);

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have permission"),
      });
    });

    it("rejects when not in guild", async () => {
      const interaction = createMockInteraction({
        guildId: null,
      });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("must be run in a guild"),
      });
    });

    it("displays analytics summary embed", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockGetActionCountsByMod.mockReturnValue([
        { moderator_id: "mod-1", action: "approve", count: 50 },
        { moderator_id: "mod-1", action: "reject", count: 10 },
      ]);
      mockGetTopReasons.mockReturnValue([
        { reason: "Too young", count: 5 },
      ]);
      mockGetVolumeSeries.mockReturnValue([
        { t0: 1704067200, t1: 1704153600, total: 60, approvals: 50, rejects: 10, permrejects: 0 },
      ]);
      mockGetLeadTimeStats.mockReturnValue({ n: 100, p50: 300, p90: 600, mean: 400 });
      mockGetOpenQueueAge.mockReturnValue({ count: 5, p50_age_sec: 1800, max_age_sec: 7200 });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
      });
    });

    it("handles query failures gracefully", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockGetActionCountsByMod.mockRejectedValue(new Error("DB Error"));
      mockGetTopReasons.mockReturnValue([]);
      mockGetVolumeSeries.mockReturnValue([]);
      mockGetLeadTimeStats.mockReturnValue({ n: 0, p50: 0, p90: 0, mean: 0 });
      mockGetOpenQueueAge.mockReturnValue({ count: 0 });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(logger.warn).toHaveBeenCalled();
    });

    it("handles null member", async () => {
      const interaction = createMockInteraction({
        member: null,
      });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have permission"),
      });
    });

    it("logs errors and shows trace ID on failure", async () => {
      const interaction = createMockInteraction({
        deferReply: vi.fn().mockRejectedValue(new Error("Network error")),
        editReply: vi.fn().mockResolvedValue(undefined),
      });
      (hasStaffPermissions as any).mockReturnValue(true);

      await executeAnalyticsCommand({ interaction, traceId: "trace-123" } as any);

      expect(logger.error).toHaveBeenCalled();
    });

    it("handles empty queue age", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockGetActionCountsByMod.mockReturnValue([]);
      mockGetTopReasons.mockReturnValue([]);
      mockGetVolumeSeries.mockReturnValue([]);
      mockGetLeadTimeStats.mockReturnValue({ n: 0 });
      mockGetOpenQueueAge.mockReturnValue({ count: 0, p50_age_sec: 0, max_age_sec: 0 });

      await executeAnalyticsCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
      });
    });
  });

  describe("executeAnalyticsExportCommand", () => {
    const createMockInteraction = (overrides: any = {}) => ({
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      options: {
        getInteger: vi.fn().mockReturnValue(null),
        getBoolean: vi.fn().mockReturnValue(null),
      },
      guildId: "guild-123",
      guild: { name: "Test Guild" },
      user: { id: "user-123" },
      member: { id: "user-123" },
      ...overrides,
    });

    it("defers reply as ephemeral", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockStreamReviewActionsCSV.mockImplementation((opts, stream) => {
        stream.end();
        return Promise.resolve({ rowCount: 0, bytes: 0 });
      });

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    });

    it("rejects invalid time range", async () => {
      const interaction = createMockInteraction({
        options: {
          getInteger: vi.fn().mockImplementation((name: string) => {
            if (name === "from") return 1704672000;
            if (name === "to") return 1704067200;
            return null;
          }),
          getBoolean: vi.fn().mockReturnValue(null),
        },
      });
      (hasStaffPermissions as any).mockReturnValue(true);

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Invalid time range"),
      });
    });

    it("rejects all-guilds for non-owner", async () => {
      const interaction = createMockInteraction({
        options: {
          getInteger: vi.fn().mockReturnValue(null),
          getBoolean: vi.fn().mockImplementation((name: string) => name === "all-guilds"),
        },
      });
      (isOwner as any).mockReturnValue(false);

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("restricted to bot owners"),
      });
    });

    it("allows all-guilds for owner", async () => {
      const interaction = createMockInteraction({
        options: {
          getInteger: vi.fn().mockReturnValue(null),
          getBoolean: vi.fn().mockImplementation((name: string) => name === "all-guilds"),
        },
      });
      (isOwner as any).mockReturnValue(true);
      mockStreamReviewActionsCSV.mockImplementation((opts, stream) => {
        stream.end();
        return Promise.resolve({ rowCount: 10, bytes: 1024 });
      });

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("10"),
          files: expect.any(Array),
        })
      );
    });

    it("rejects non-staff users", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(false);

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have permission"),
      });
    });

    it("rejects when not in guild", async () => {
      const interaction = createMockInteraction({
        guildId: null,
      });

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("must be run in a guild"),
      });
    });

    it("exports CSV successfully", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockStreamReviewActionsCSV.mockImplementation((opts, stream) => {
        stream.write("col1,col2\n");
        stream.write("val1,val2\n");
        stream.end();
        return Promise.resolve({ rowCount: 1, bytes: 24 });
      });

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("1"),
        files: expect.any(Array),
      });
    });

    it("handles null member", async () => {
      const interaction = createMockInteraction({
        member: null,
      });

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-1" } as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have permission"),
      });
    });

    it("logs errors and shows trace ID on failure", async () => {
      const interaction = createMockInteraction();
      (hasStaffPermissions as any).mockReturnValue(true);
      mockStreamReviewActionsCSV.mockRejectedValue(new Error("Export failed"));

      await executeAnalyticsExportCommand({ interaction, traceId: "trace-123" } as any);

      expect(logger.error).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("trace-123"),
      });
    });
  });
});
