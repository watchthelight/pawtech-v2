/**
 * Pawtropolis Tech -- tests/features/review/approve.test.ts
 * WHAT: Tests for the approval flow (approveTx, approveFlow, deliverApprovalDm).
 * WHY: Approval is a critical path - tests verify role assignment, DM delivery,
 *      and error handling work correctly.
 *
 * Note: tests/review/approveFlow.test.ts already covers permission error handling.
 * This file adds coverage for the transaction and DM delivery paths.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Guild, GuildMember, Role, User } from "discord.js";

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

// Mock Sentry
const mockSentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/sentry.js", () => mockSentry);

// Mock time
vi.mock("../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => "2024-01-15T10:00:00.000Z"),
}));

// Import after mocks
import {
  approveTx,
  approveFlow,
  deliverApprovalDm,
} from "../../../src/features/review/flows/approve.js";
import type { GuildConfig } from "../../../src/lib/config.js";

// ===== Test Helpers =====

function createMockRole(id: string): Role {
  return {
    id,
    name: "Test Role",
  } as unknown as Role;
}

function createMockMember(options: {
  id: string;
  hasRole?: boolean;
  roleAddFails?: boolean;
  roleError?: Error;
  sendFails?: boolean;
} = { id: "member-123" }): GuildMember {
  const rolesCache = new Map<string, Role>();
  if (options.hasRole) {
    rolesCache.set("role-123", createMockRole("role-123"));
  }

  const addFn = options.roleAddFails
    ? vi.fn().mockRejectedValue(options.roleError ?? new Error("Role add failed"))
    : vi.fn().mockResolvedValue(undefined);

  const sendFn = options.sendFails
    ? vi.fn().mockRejectedValue(new Error("Cannot send DMs"))
    : vi.fn().mockResolvedValue(undefined);

  return {
    id: options.id,
    user: { id: options.id } as User,
    roles: {
      cache: rolesCache,
      add: addFn,
    },
    send: sendFn,
  } as unknown as GuildMember;
}

function createMockGuild(options: {
  memberId?: string;
  member?: GuildMember | null;
  roleId?: string;
  role?: Role | null;
  memberFetchFails?: boolean;
} = {}): Guild {
  const memberId = options.memberId ?? "member-123";
  const member = options.member !== undefined ? options.member : createMockMember({ id: memberId });
  const role = options.role !== undefined ? options.role : createMockRole(options.roleId ?? "role-123");

  const membersFetch = options.memberFetchFails
    ? vi.fn().mockRejectedValue(new Error("Member not found"))
    : vi.fn().mockResolvedValue(member);

  const rolesCache = new Map<string, Role>();
  if (role) rolesCache.set(role.id, role);

  return {
    id: "guild-123",
    members: {
      fetch: membersFetch,
    },
    roles: {
      cache: rolesCache,
      fetch: vi.fn().mockResolvedValue(role),
    },
  } as unknown as Guild;
}

function createMockConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guild_id: "guild-123",
    accepted_role_id: "role-123",
    ...overrides,
  } as GuildConfig;
}

// ===== Test Setup =====

beforeEach(() => {
  vi.clearAllMocks();

  // Default transaction mock that returns the inner function's result
  mockTransaction.mockImplementation((fn: () => unknown) => () => fn());

  // Default run mock
  mockDbStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1) });
});

// ===== approveTx Tests =====

describe("approveTx", () => {
  describe("successful approval", () => {
    it("updates application status to approved", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("changed");
      // Verify the UPDATE statement was prepared
      const prepareCalls = mockDb.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
      const hasUpdateCall = prepareCalls.some(
        (sql: string) => sql.includes("UPDATE application") && sql.includes("status = 'approved'")
      );
      expect(hasUpdateCall).toBe(true);
    });

    it("returns reviewActionId on success", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });
      mockDbStatement.run.mockReturnValue({ lastInsertRowid: BigInt(42) });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("changed");
      if (result.kind === "changed") {
        expect(result.reviewActionId).toBe(42);
      }
    });

    it("inserts review_action record", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      approveTx("app-123", "mod-456", "Welcome!");

      // Verify the INSERT statement was prepared
      const prepareCalls = mockDb.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
      const hasInsertCall = prepareCalls.some(
        (sql: string) => sql.includes("INSERT INTO review_action") && sql.includes("'approve'")
      );
      expect(hasInsertCall).toBe(true);
    });

    it("approves from needs_info status", () => {
      mockDbStatement.get.mockReturnValue({ status: "needs_info" });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("changed");
    });

    it("records reason in review_action", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      approveTx("app-123", "mod-456", "Great application!");

      expect(mockDbStatement.run).toHaveBeenCalledWith(
        "app-123",
        "mod-456",
        "2024-01-15T10:00:00.000Z",
        "Great application!"
      );
    });
  });

  describe("already approved", () => {
    it("returns already status when app is already approved", () => {
      mockDbStatement.get.mockReturnValue({ status: "approved" });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("already");
      if (result.kind === "already") {
        expect(result.status).toBe("approved");
      }
    });
  });

  describe("terminal states", () => {
    it("returns terminal for rejected apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "rejected" });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("terminal");
      if (result.kind === "terminal") {
        expect(result.status).toBe("rejected");
      }
    });

    it("returns terminal for kicked apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "kicked" });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("terminal");
    });
  });

  describe("invalid states", () => {
    it("returns invalid for draft apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "draft" });

      const result = approveTx("app-123", "mod-456");

      expect(result.kind).toBe("invalid");
    });
  });

  describe("error cases", () => {
    it("throws when application not found", () => {
      mockDbStatement.get.mockReturnValue(undefined);

      expect(() => approveTx("nonexistent", "mod-456")).toThrow("Application not found");
    });
  });
});

// ===== approveFlow Tests =====

describe("approveFlow", () => {
  describe("successful flow", () => {
    it("fetches member and applies role", async () => {
      const member = createMockMember({ id: "member-123" });
      const guild = createMockGuild({ member });
      const config = createMockConfig();

      const result = await approveFlow(guild, "member-123", config);

      expect(result.roleApplied).toBe(true);
      expect(result.member).toBe(member);
      expect(result.roleError).toBeNull();
      expect(guild.members.fetch).toHaveBeenCalledWith("member-123");
      expect(member.roles.add).toHaveBeenCalled();
    });

    it("skips role add if member already has role", async () => {
      const member = createMockMember({ id: "member-123", hasRole: true });
      // Put the expected role in cache
      member.roles.cache.set("role-123", createMockRole("role-123"));

      const guild = createMockGuild({ member, roleId: "role-123" });
      const config = createMockConfig({ accepted_role_id: "role-123" });

      const result = await approveFlow(guild, "member-123", config);

      expect(result.roleApplied).toBe(true);
      expect(member.roles.add).not.toHaveBeenCalled();
    });
  });

  describe("member fetch failure", () => {
    it("handles member not found", async () => {
      const guild = createMockGuild({ memberFetchFails: true });
      const config = createMockConfig();

      const result = await approveFlow(guild, "nonexistent", config);

      expect(result.member).toBeNull();
      expect(result.roleApplied).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: "nonexistent" }),
        expect.any(String)
      );
    });
  });

  describe("role assignment failure", () => {
    it("captures roleError on permission failure", async () => {
      const permError = Object.assign(new Error("Missing Permissions"), { code: 50013 });
      const member = createMockMember({
        id: "member-123",
        roleAddFails: true,
        roleError: permError,
      });
      const guild = createMockGuild({ member });
      const config = createMockConfig();

      const result = await approveFlow(guild, "member-123", config);

      expect(result.roleApplied).toBe(false);
      expect(result.roleError?.code).toBe(50013);
      expect(result.roleError?.message).toContain("Missing Permissions");
    });

    it("does not report permission errors to Sentry", async () => {
      const permError = Object.assign(new Error("Missing Permissions"), { code: 50013 });
      const member = createMockMember({
        id: "member-123",
        roleAddFails: true,
        roleError: permError,
      });
      const guild = createMockGuild({ member });
      const config = createMockConfig();

      await approveFlow(guild, "member-123", config);

      expect(mockSentry.captureException).not.toHaveBeenCalled();
    });

    it("reports non-permission errors to Sentry", async () => {
      const otherError = Object.assign(new Error("Unknown error"), { code: 50000 });
      const member = createMockMember({
        id: "member-123",
        roleAddFails: true,
        roleError: otherError,
      });
      const guild = createMockGuild({ member });
      const config = createMockConfig();

      await approveFlow(guild, "member-123", config);

      expect(mockSentry.captureException).toHaveBeenCalled();
    });
  });

  describe("no role configured", () => {
    it("skips role assignment when no accepted_role_id", async () => {
      const member = createMockMember({ id: "member-123" });
      const guild = createMockGuild({ member });
      const config = createMockConfig({ accepted_role_id: null });

      const result = await approveFlow(guild, "member-123", config);

      expect(result.member).toBe(member);
      expect(result.roleApplied).toBe(false);
      expect(member.roles.add).not.toHaveBeenCalled();
    });
  });

  describe("role not found", () => {
    it("handles missing role gracefully", async () => {
      const member = createMockMember({ id: "member-123" });
      const guild = createMockGuild({ member, role: null });
      guild.roles.cache.clear();
      (guild.roles.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const config = createMockConfig({ accepted_role_id: "nonexistent-role" });

      const result = await approveFlow(guild, "member-123", config);

      expect(result.roleApplied).toBe(false);
      expect(member.roles.add).not.toHaveBeenCalled();
    });
  });
});

// ===== deliverApprovalDm Tests =====

describe("deliverApprovalDm", () => {
  describe("successful delivery", () => {
    it("sends welcome DM to member", async () => {
      const member = createMockMember({ id: "member-123" });

      const result = await deliverApprovalDm(member, "Test Guild");

      expect(result).toBe(true);
      expect(member.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Test Guild"),
        })
      );
    });

    it("includes guild name in message", async () => {
      const member = createMockMember({ id: "member-123" });

      await deliverApprovalDm(member, "Awesome Server");

      expect(member.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Awesome Server"),
        })
      );
    });

    it("includes reviewer note when provided", async () => {
      const member = createMockMember({ id: "member-123" });

      await deliverApprovalDm(member, "Test Guild", "Great answers!");

      expect(member.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Great answers!"),
        })
      );
    });

    it("includes welcoming message", async () => {
      const member = createMockMember({ id: "member-123" });

      await deliverApprovalDm(member, "Test Guild");

      expect(member.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/welcome|approved/i),
        })
      );
    });
  });

  describe("delivery failure", () => {
    it("returns false when DM fails", async () => {
      const member = createMockMember({ id: "member-123", sendFails: true });

      const result = await deliverApprovalDm(member, "Test Guild");

      expect(result).toBe(false);
    });

    it("logs warning on DM failure", async () => {
      const member = createMockMember({ id: "member-123", sendFails: true });

      await deliverApprovalDm(member, "Test Guild");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "member-123" }),
        expect.stringContaining("DM")
      );
    });

    it("does not throw on DM failure", async () => {
      const member = createMockMember({ id: "member-123", sendFails: true });

      await expect(deliverApprovalDm(member, "Test Guild")).resolves.toBe(false);
    });
  });

  describe("message content", () => {
    it("handles null reason", async () => {
      const member = createMockMember({ id: "member-123" });

      await deliverApprovalDm(member, "Test Guild", null);

      expect(member.send).toHaveBeenCalled();
      // Should not include "Note from reviewer" section
      const sentContent = (member.send as ReturnType<typeof vi.fn>).mock.calls[0][0].content;
      expect(sentContent).not.toContain("Note from reviewer");
    });

    it("handles empty string reason", async () => {
      const member = createMockMember({ id: "member-123" });

      await deliverApprovalDm(member, "Test Guild", "");

      expect(member.send).toHaveBeenCalled();
    });
  });
});
