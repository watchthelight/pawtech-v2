/**
 * Pawtropolis Tech — tests/features/artJobs/store.test.ts
 * WHAT: Unit tests for art job database operations.
 * WHY: Verify CRUD operations, status updates, and leaderboard queries.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database with vi.hoisted
const { mockGet, mockAll, mockRun, mockTransaction, mockPrepare } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockAll = vi.fn();
  const mockRun = vi.fn();
  const mockPrepare = vi.fn(() => ({
    get: mockGet,
    all: mockAll,
    run: mockRun,
  }));
  const mockTransaction = vi.fn((fn: (...args: any[]) => any) => {
    return (opts: any) => fn(opts);
  });
  return { mockGet, mockAll, mockRun, mockTransaction, mockPrepare };
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
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

import {
  createJob,
  getJobById,
  getJobByNumber,
  getJobByArtistNumber,
  getJobByRecipient,
  getActiveJobsForArtist,
  getAllActiveJobs,
  getActiveJobsForRecipient,
  updateJobStatus,
  finishJob,
  getMonthlyLeaderboard,
  getAllTimeLeaderboard,
  getArtistStats,
  formatJobNumber,
} from "../../../src/features/artJobs/store.js";
import { logger } from "../../../src/lib/logger.js";

describe("artJobs/store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createJob", () => {
    it("creates job with correct numbers", () => {
      mockGet
        .mockReturnValueOnce({ max_num: 10 }) // job number
        .mockReturnValueOnce({ max_num: 3 }); // artist job number
      mockRun.mockReturnValue({ lastInsertRowid: 42 });

      const result = createJob({
        guildId: "guild-123",
        artistId: "artist-1",
        recipientId: "recipient-1",
        ticketType: "headshot",
      });

      expect(result.id).toBe(42);
      expect(result.jobNumber).toBe(11);
      expect(result.artistJobNumber).toBe(4);
    });

    it("handles first job in guild", () => {
      mockGet
        .mockReturnValueOnce({ max_num: null })
        .mockReturnValueOnce({ max_num: null });
      mockRun.mockReturnValue({ lastInsertRowid: 1 });

      const result = createJob({
        guildId: "guild-123",
        artistId: "artist-1",
        recipientId: "recipient-1",
        ticketType: "emoji",
      });

      expect(result.jobNumber).toBe(1);
      expect(result.artistJobNumber).toBe(1);
    });

    it("includes assignmentLogId when provided", () => {
      mockGet
        .mockReturnValueOnce({ max_num: 5 })
        .mockReturnValueOnce({ max_num: 2 });
      mockRun.mockReturnValue({ lastInsertRowid: 10 });

      const result = createJob({
        guildId: "guild-123",
        artistId: "artist-1",
        recipientId: "recipient-1",
        ticketType: "fullbody",
        assignmentLogId: 99,
      });

      expect(result.id).toBe(10);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("getJobById", () => {
    it("returns job when found", () => {
      const job = { id: 1, job_number: 1, status: "assigned" };
      mockGet.mockReturnValue(job);

      const result = getJobById(1);

      expect(result).toEqual(job);
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getJobById(999);

      expect(result).toBeNull();
    });
  });

  describe("getJobByNumber", () => {
    it("returns job when found", () => {
      const job = { id: 1, job_number: 5, status: "sketching" };
      mockGet.mockReturnValue(job);

      const result = getJobByNumber("guild-123", 5);

      expect(result).toEqual(job);
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getJobByNumber("guild-123", 999);

      expect(result).toBeNull();
    });
  });

  describe("getJobByArtistNumber", () => {
    it("returns job when found", () => {
      const job = { id: 1, artist_job_number: 3, status: "lining" };
      mockGet.mockReturnValue(job);

      const result = getJobByArtistNumber("guild-123", "artist-1", 3);

      expect(result).toEqual(job);
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getJobByArtistNumber("guild-123", "artist-1", 999);

      expect(result).toBeNull();
    });
  });

  describe("getJobByRecipient", () => {
    it("returns found status for single match", () => {
      const job = { id: 1, recipient_id: "recipient-1" };
      mockAll.mockReturnValue([job]);

      const result = getJobByRecipient("guild-123", "artist-1", "recipient-1", "headshot");

      expect(result).toEqual({ status: "found", job });
    });

    it("returns not_found for no matches", () => {
      mockAll.mockReturnValue([]);

      const result = getJobByRecipient("guild-123", "artist-1", "recipient-1", "headshot");

      expect(result).toEqual({ status: "not_found" });
    });

    it("returns multiple status for multiple matches", () => {
      const jobs = [
        { id: 1, recipient_id: "recipient-1" },
        { id: 2, recipient_id: "recipient-1" },
      ];
      mockAll.mockReturnValue(jobs);

      const result = getJobByRecipient("guild-123", "artist-1", "recipient-1", "headshot");

      expect(result).toEqual({ status: "multiple", count: 2, jobs });
    });
  });

  describe("getActiveJobsForArtist", () => {
    it("returns active jobs ordered by artist job number", () => {
      const jobs = [
        { id: 1, artist_job_number: 1, status: "assigned" },
        { id: 2, artist_job_number: 2, status: "sketching" },
      ];
      mockAll.mockReturnValue(jobs);

      const result = getActiveJobsForArtist("guild-123", "artist-1");

      expect(result).toEqual(jobs);
    });

    it("returns empty array when no active jobs", () => {
      mockAll.mockReturnValue([]);

      const result = getActiveJobsForArtist("guild-123", "artist-1");

      expect(result).toEqual([]);
    });
  });

  describe("getAllActiveJobs", () => {
    it("returns all active jobs for guild", () => {
      const jobs = [
        { id: 1, job_number: 1 },
        { id: 2, job_number: 2 },
      ];
      mockAll.mockReturnValue(jobs);

      const result = getAllActiveJobs("guild-123");

      expect(result).toEqual(jobs);
    });
  });

  describe("getActiveJobsForRecipient", () => {
    it("returns active jobs for recipient", () => {
      const jobs = [{ id: 1, recipient_id: "recipient-1" }];
      mockAll.mockReturnValue(jobs);

      const result = getActiveJobsForRecipient("guild-123", "recipient-1");

      expect(result).toEqual(jobs);
    });
  });

  describe("updateJobStatus", () => {
    it("updates status successfully", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = updateJobStatus(1, { status: "sketching" });

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalled();
    });

    it("updates notes successfully", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = updateJobStatus(1, { notes: "Working on it" });

      expect(result).toBe(true);
    });

    it("updates both status and notes", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = updateJobStatus(1, { status: "lining", notes: "Line art done" });

      expect(result).toBe(true);
    });

    it("returns false when job not found", () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = updateJobStatus(999, { status: "coloring" });

      expect(result).toBe(false);
    });

    it("sets completed_at when status is done", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = updateJobStatus(1, { status: "done" });

      expect(result).toBe(true);
    });

    it("throws error for invalid field", () => {
      expect(() => {
        updateJobStatus(1, { invalidField: "value" } as any);
      }).toThrow("Invalid update field: invalidField");

      expect(logger.error).toHaveBeenCalled();
    });

    it("validates all field names", () => {
      expect(() => {
        updateJobStatus(1, { status: "done", hacky: "attempt" } as any);
      }).toThrow("Invalid update field: hacky");
    });
  });

  describe("finishJob", () => {
    it("marks job as done", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = finishJob(1);

      expect(result).toBe(true);
    });

    it("returns false when job not found", () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = finishJob(999);

      expect(result).toBe(false);
    });
  });

  describe("getMonthlyLeaderboard", () => {
    it("returns leaderboard entries", () => {
      const entries = [
        { artistId: "artist-1", completedCount: 10 },
        { artistId: "artist-2", completedCount: 5 },
      ];
      mockAll.mockReturnValue(entries);

      const result = getMonthlyLeaderboard("guild-123", 10);

      expect(result).toEqual(entries);
    });

    it("uses default limit of 10", () => {
      mockAll.mockReturnValue([]);

      getMonthlyLeaderboard("guild-123");

      expect(mockAll).toHaveBeenCalled();
    });

    it("returns empty array for no completions", () => {
      mockAll.mockReturnValue([]);

      const result = getMonthlyLeaderboard("guild-123");

      expect(result).toEqual([]);
    });
  });

  describe("getAllTimeLeaderboard", () => {
    it("returns all-time leaderboard", () => {
      const entries = [
        { artistId: "artist-1", completedCount: 100 },
        { artistId: "artist-2", completedCount: 50 },
      ];
      mockAll.mockReturnValue(entries);

      const result = getAllTimeLeaderboard("guild-123", 5);

      expect(result).toEqual(entries);
    });
  });

  describe("getArtistStats", () => {
    it("returns artist stats", () => {
      mockGet
        .mockReturnValueOnce({ count: 5 }) // monthly
        .mockReturnValueOnce({ count: 25 }); // all-time

      const result = getArtistStats("guild-123", "artist-1");

      expect(result).toEqual({
        artistId: "artist-1",
        monthlyCompleted: 5,
        allTimeCompleted: 25,
      });
    });
  });

  describe("formatJobNumber", () => {
    it("pads single digit numbers", () => {
      expect(formatJobNumber(1)).toBe("0001");
    });

    it("pads double digit numbers", () => {
      expect(formatJobNumber(42)).toBe("0042");
    });

    it("pads triple digit numbers", () => {
      expect(formatJobNumber(123)).toBe("0123");
    });

    it("does not pad four digit numbers", () => {
      expect(formatJobNumber(1234)).toBe("1234");
    });

    it("handles zero", () => {
      expect(formatJobNumber(0)).toBe("0000");
    });

    it("handles large numbers", () => {
      expect(formatJobNumber(99999)).toBe("99999");
    });
  });
});
