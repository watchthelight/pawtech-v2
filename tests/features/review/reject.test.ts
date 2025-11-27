/**
 * Pawtropolis Tech -- tests/features/review/reject.test.ts
 * WHAT: Tests for the rejection flow (rejectTx, rejectFlow).
 * WHY: Rejection has two modes (standard and permanent) and requires DM delivery.
 *      These tests verify both paths work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "discord.js";

// ===== Mock Setup =====

// Mock database - use vi.hoisted to ensure proper initialization order
const mockDbStatement = vi.hoisted(() => ({
  get: vi.fn(),
  run: vi.fn(),
}));

const mockTransaction = vi.hoisted(() => vi.fn((fn: () => unknown) => fn));

const mockDb = vi.hoisted(() => ({
  prepare: vi.fn(() => mockDbStatement),
  transaction: mockTransaction,
}));

vi.mock("../../../src/db/db.js", () => ({
  db: mockDb,
}));

// Mock logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

// Mock time
vi.mock("../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => "2024-01-15T10:00:00.000Z"),
}));

// Import after mocks
import { rejectTx, rejectFlow } from "../../../src/features/review/flows/reject.js";

// ===== Test Helpers =====

function createMockUser(options: {
  id?: string;
  sendFails?: boolean;
} = {}): User {
  const sendFn = options.sendFails
    ? vi.fn().mockRejectedValue(new Error("Cannot send DMs"))
    : vi.fn().mockResolvedValue(undefined);

  return {
    id: options.id ?? "user-123",
    send: sendFn,
  } as unknown as User;
}

// ===== Test Setup =====

beforeEach(() => {
  vi.clearAllMocks();

  // Default transaction mock
  mockTransaction.mockImplementation((fn: () => unknown) => () => fn());

  // Default run mock
  mockDbStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1) });
});

// ===== rejectTx Tests =====

describe("rejectTx", () => {
  describe("standard rejection", () => {
    it("updates application status to rejected", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      const result = rejectTx("app-123", "mod-456", "Not enough detail");

      expect(result.kind).toBe("changed");
      // Verify the UPDATE statement was prepared
      const prepareCalls = mockDb.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
      const hasUpdateCall = prepareCalls.some(
        (sql: string) => sql.includes("UPDATE application") && sql.includes("status = 'rejected'")
      );
      expect(hasUpdateCall).toBe(true);
    });

    it("returns reviewActionId on success", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });
      mockDbStatement.run.mockReturnValue({ lastInsertRowid: BigInt(99) });

      const result = rejectTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("changed");
      if (result.kind === "changed") {
        expect(result.reviewActionId).toBe(99);
      }
    });

    it("inserts review_action with reject action", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      rejectTx("app-123", "mod-456", "Low effort application");

      // Check the INSERT was called with 'reject' action
      const insertCall = mockDb.prepare.mock.calls.find((call) =>
        call[0].includes("INSERT INTO review_action")
      );
      expect(insertCall).toBeDefined();

      // Verify the run was called with correct parameters
      expect(mockDbStatement.run).toHaveBeenCalledWith(
        "app-123",
        "mod-456",
        "reject",
        "2024-01-15T10:00:00.000Z",
        "Low effort application"
      );
    });

    it("sets permanently_rejected to 0 for standard rejection", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      rejectTx("app-123", "mod-456", "Try again later", false);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringMatching(/permanently_rejected = \?/)
      );
      // Check the UPDATE run call has 0 for permanently_rejected
      const updateRunCalls = mockDbStatement.run.mock.calls;
      // The UPDATE call includes permanently_rejected as a parameter
      expect(updateRunCalls.some((call) => call.includes(0))).toBe(true);
    });
  });

  describe("permanent rejection", () => {
    it("sets permanently_rejected to 1", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      rejectTx("app-123", "mod-456", "Troll application", true);

      // Check the UPDATE run call has 1 for permanently_rejected
      const updateRunCalls = mockDbStatement.run.mock.calls;
      expect(updateRunCalls.some((call) => call.includes(1))).toBe(true);
    });

    it("inserts review_action with perm_reject action", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      rejectTx("app-123", "mod-456", "Bad actor", true);

      // Verify the run was called with 'perm_reject' action
      expect(mockDbStatement.run).toHaveBeenCalledWith(
        "app-123",
        "mod-456",
        "perm_reject",
        expect.any(String),
        "Bad actor"
      );
    });

    it("sets permanent_reject_at timestamp", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      rejectTx("app-123", "mod-456", "Reason", true);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringMatching(/permanent_reject_at = CASE WHEN/)
      );
    });
  });

  describe("status checks", () => {
    it("returns already for already-rejected apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "rejected" });

      const result = rejectTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("already");
      if (result.kind === "already") {
        expect(result.status).toBe("rejected");
      }
    });

    it("returns terminal for approved apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "approved" });

      const result = rejectTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("terminal");
      if (result.kind === "terminal") {
        expect(result.status).toBe("approved");
      }
    });

    it("returns terminal for kicked apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "kicked" });

      const result = rejectTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("terminal");
    });

    it("returns invalid for draft apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "draft" });

      const result = rejectTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("invalid");
    });
  });

  describe("valid statuses for rejection", () => {
    it("accepts submitted status", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      const result = rejectTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("changed");
    });

    it("accepts needs_info status", () => {
      mockDbStatement.get.mockReturnValue({ status: "needs_info" });

      const result = rejectTx("app-123", "mod-456", "No response");

      expect(result.kind).toBe("changed");
    });
  });

  describe("error cases", () => {
    it("throws when application not found", () => {
      mockDbStatement.get.mockReturnValue(undefined);

      expect(() => rejectTx("nonexistent", "mod-456", "Reason")).toThrow(
        "Application not found"
      );
    });
  });
});

// ===== rejectFlow Tests =====

describe("rejectFlow", () => {
  describe("standard rejection DM", () => {
    it("sends rejection DM to user", async () => {
      const user = createMockUser();

      const result = await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Incomplete application",
      });

      expect(result.dmDelivered).toBe(true);
      expect(user.send).toHaveBeenCalled();
    });

    it("includes guild name in message", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Awesome Community",
        reason: "Not a fit",
      });

      expect(user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Awesome Community"),
        })
      );
    });

    it("includes reason in message", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Application was too short",
      });

      expect(user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Application was too short"),
        })
      );
    });

    it("encourages reapplication for standard rejection", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Try again",
        permanent: false,
      });

      expect(user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/new one|apply again|reapply/i),
        })
      );
    });
  });

  describe("permanent rejection DM", () => {
    it("sends different message for permanent rejection", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Ban evasion",
        permanent: true,
      });

      expect(user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/permanently/i),
        })
      );
    });

    it("indicates user cannot reapply", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Rule violation",
        permanent: true,
      });

      expect(user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/cannot apply|can't apply/i),
        })
      );
    });
  });

  describe("DM delivery failure", () => {
    it("returns dmDelivered: false when DM fails", async () => {
      const user = createMockUser({ sendFails: true });

      const result = await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Reason",
      });

      expect(result.dmDelivered).toBe(false);
    });

    it("logs warning on DM failure", async () => {
      const user = createMockUser({ id: "user-456", sendFails: true });

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Reason",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-456" }),
        expect.stringContaining("DM")
      );
    });

    it("does not throw on DM failure", async () => {
      const user = createMockUser({ sendFails: true });

      await expect(
        rejectFlow(user, {
          guildName: "Test Server",
          reason: "Reason",
        })
      ).resolves.toEqual({ dmDelivered: false });
    });
  });

  describe("message content structure", () => {
    it("standard rejection message is polite", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Answers too brief",
      });

      const sentContent = (user.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .content;
      // Should be professional/polite
      expect(sentContent).toMatch(/thank|hello|hi/i);
    });

    it("permanent rejection message is final", async () => {
      const user = createMockUser();

      await rejectFlow(user, {
        guildName: "Test Server",
        reason: "Violation",
        permanent: true,
      });

      const sentContent = (user.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .content;
      // Should indicate finality
      expect(sentContent).toMatch(/permanently|final|cannot/i);
    });
  });
});

// ===== Integration Tests =====

describe("rejection workflow integration", () => {
  it("full standard rejection flow", async () => {
    // 1. Transaction marks app as rejected
    mockDbStatement.get.mockReturnValue({ status: "submitted" });
    const txResult = rejectTx("app-123", "mod-456", "Not detailed enough");
    expect(txResult.kind).toBe("changed");

    // 2. DM is sent to user
    const user = createMockUser();
    const flowResult = await rejectFlow(user, {
      guildName: "Test Guild",
      reason: "Not detailed enough",
      permanent: false,
    });
    expect(flowResult.dmDelivered).toBe(true);
  });

  it("full permanent rejection flow", async () => {
    // 1. Transaction marks app as permanently rejected
    mockDbStatement.get.mockReturnValue({ status: "submitted" });
    const txResult = rejectTx("app-123", "mod-456", "Bad faith application", true);
    expect(txResult.kind).toBe("changed");

    // 2. DM indicates permanent ban
    const user = createMockUser();
    const flowResult = await rejectFlow(user, {
      guildName: "Test Guild",
      reason: "Bad faith application",
      permanent: true,
    });
    expect(flowResult.dmDelivered).toBe(true);

    const sentContent = (user.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .content;
    expect(sentContent).toMatch(/permanently/i);
  });

  it("rejection with DM failure is non-blocking", async () => {
    mockDbStatement.get.mockReturnValue({ status: "submitted" });
    const txResult = rejectTx("app-123", "mod-456", "Reason");
    expect(txResult.kind).toBe("changed");

    // DM fails but flow completes
    const user = createMockUser({ sendFails: true });
    const flowResult = await rejectFlow(user, {
      guildName: "Test Guild",
      reason: "Reason",
    });

    // Rejection succeeded even though DM failed
    expect(flowResult.dmDelivered).toBe(false);
    // No exception thrown
  });
});
