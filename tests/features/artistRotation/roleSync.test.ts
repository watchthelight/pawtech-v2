/**
 * Pawtropolis Tech — tests/features/artistRotation/roleSync.test.ts
 * WHAT: Unit tests for artist role sync handlers.
 * WHY: Verify role change detection and queue synchronization.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies with vi.hoisted
const {
  mockLogActionPretty,
  mockGetArtistRoleId,
  mockGetIgnoredArtistUsers,
  mockAddArtist,
  mockRemoveArtist,
  mockGetArtist,
  mockLogger,
} = vi.hoisted(() => ({
  mockLogActionPretty: vi.fn(),
  mockGetArtistRoleId: vi.fn(),
  mockGetIgnoredArtistUsers: vi.fn(),
  mockAddArtist: vi.fn(),
  mockRemoveArtist: vi.fn(),
  mockGetArtist: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

vi.mock("../../../src/features/artistRotation/constants.js", () => ({
  getArtistRoleId: mockGetArtistRoleId,
  getIgnoredArtistUsers: mockGetIgnoredArtistUsers,
}));

vi.mock("../../../src/features/artistRotation/queue.js", () => ({
  addArtist: mockAddArtist,
  removeArtist: mockRemoveArtist,
  getArtist: mockGetArtist,
}));

import {
  handleArtistRoleAdded,
  handleArtistRoleRemoved,
  detectArtistRoleChange,
  handleArtistRoleChange,
} from "../../../src/features/artistRotation/roleSync.js";

describe("artistRotation/roleSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetArtistRoleId.mockReturnValue("artist-role-id");
    mockGetIgnoredArtistUsers.mockReturnValue(new Set());
    mockLogActionPretty.mockResolvedValue(undefined);
  });

  describe("detectArtistRoleChange", () => {
    it("returns 'added' when role was added", () => {
      const oldMember = {
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(false),
          },
        },
      } as any;

      const newMember = {
        guild: { id: "guild-123" },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      const result = detectArtistRoleChange(oldMember, newMember);

      expect(result).toBe("added");
    });

    it("returns 'removed' when role was removed", () => {
      const oldMember = {
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      const newMember = {
        guild: { id: "guild-123" },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(false),
          },
        },
      } as any;

      const result = detectArtistRoleChange(oldMember, newMember);

      expect(result).toBe("removed");
    });

    it("returns null when role unchanged (had and still has)", () => {
      const oldMember = {
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      const newMember = {
        guild: { id: "guild-123" },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      const result = detectArtistRoleChange(oldMember, newMember);

      expect(result).toBeNull();
    });

    it("returns null when role unchanged (never had)", () => {
      const oldMember = {
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(false),
          },
        },
      } as any;

      const newMember = {
        guild: { id: "guild-123" },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(false),
          },
        },
      } as any;

      const result = detectArtistRoleChange(oldMember, newMember);

      expect(result).toBeNull();
    });
  });

  describe("handleArtistRoleAdded", () => {
    it("adds artist to queue and logs action", async () => {
      mockAddArtist.mockReturnValue(5);

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleAdded(guild, member);

      expect(mockAddArtist).toHaveBeenCalledWith("guild-123", "user-456");
      expect(mockLogActionPretty).toHaveBeenCalledWith(guild, {
        actorId: "bot-123",
        subjectId: "user-456",
        action: "artist_queue_joined",
        meta: { position: 5 },
      });
    });

    it("skips ignored users", async () => {
      mockGetIgnoredArtistUsers.mockReturnValue(new Set(["user-456"]));

      const guild = {
        id: "guild-123",
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleAdded(guild, member);

      expect(mockAddArtist).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("handles user already in queue", async () => {
      mockAddArtist.mockReturnValue(null);

      const guild = {
        id: "guild-123",
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleAdded(guild, member);

      expect(mockLogActionPretty).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("handles logging failure gracefully", async () => {
      mockAddArtist.mockReturnValue(1);
      mockLogActionPretty.mockRejectedValue(new Error("Logging failed"));

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleAdded(guild, member);

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("uses 'system' as actor when bot user is null", async () => {
      mockAddArtist.mockReturnValue(1);

      const guild = {
        id: "guild-123",
        client: { user: null },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleAdded(guild, member);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({ actorId: "system" })
      );
    });
  });

  describe("handleArtistRoleRemoved", () => {
    it("removes artist from queue and logs action", async () => {
      mockGetArtist.mockReturnValue({
        added_at: "2024-01-01T00:00:00Z",
      });
      mockRemoveArtist.mockReturnValue(10);

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleRemoved(guild, member);

      expect(mockRemoveArtist).toHaveBeenCalledWith("guild-123", "user-456");
      expect(mockLogActionPretty).toHaveBeenCalledWith(guild, {
        actorId: "bot-123",
        subjectId: "user-456",
        action: "artist_queue_left",
        meta: expect.objectContaining({
          assignmentsCompleted: 10,
        }),
      });
    });

    it("handles user not in queue", async () => {
      mockRemoveArtist.mockReturnValue(null);

      const guild = {
        id: "guild-123",
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleRemoved(guild, member);

      expect(mockLogActionPretty).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("calculates days in program", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);

      mockGetArtist.mockReturnValue({
        added_at: pastDate.toISOString(),
      });
      mockRemoveArtist.mockReturnValue(5);

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleRemoved(guild, member);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({
          meta: expect.objectContaining({
            daysInProgram: expect.any(Number),
          }),
        })
      );
    });

    it("handles null added_at", async () => {
      mockGetArtist.mockReturnValue({
        added_at: null,
      });
      mockRemoveArtist.mockReturnValue(5);

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleRemoved(guild, member);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({
          meta: expect.objectContaining({
            daysInProgram: null,
          }),
        })
      );
    });

    it("handles logging failure gracefully", async () => {
      mockGetArtist.mockReturnValue({ added_at: "2024-01-01" });
      mockRemoveArtist.mockReturnValue(5);
      mockLogActionPretty.mockRejectedValue(new Error("Logging failed"));

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleRemoved(guild, member);

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("handles getArtist returning null", async () => {
      mockGetArtist.mockReturnValue(null);
      mockRemoveArtist.mockReturnValue(5);

      const guild = {
        id: "guild-123",
        client: { user: { id: "bot-123" } },
      } as any;

      const member = {
        id: "user-456",
      } as any;

      await handleArtistRoleRemoved(guild, member);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({
          meta: expect.objectContaining({
            daysInProgram: null,
          }),
        })
      );
    });
  });

  describe("handleArtistRoleChange", () => {
    it("calls handleArtistRoleAdded when role added", async () => {
      mockGetArtistRoleId.mockReturnValue("artist-role-id");
      mockAddArtist.mockReturnValue(1);

      const oldMember = {
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(false),
          },
        },
      } as any;

      const newMember = {
        id: "user-456",
        guild: {
          id: "guild-123",
          client: { user: { id: "bot-123" } },
        },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      await handleArtistRoleChange(oldMember, newMember);

      expect(mockAddArtist).toHaveBeenCalled();
    });

    it("calls handleArtistRoleRemoved when role removed", async () => {
      mockGetArtistRoleId.mockReturnValue("artist-role-id");
      mockGetArtist.mockReturnValue({ added_at: "2024-01-01" });
      mockRemoveArtist.mockReturnValue(5);

      const oldMember = {
        id: "user-456",
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      const newMember = {
        guild: {
          id: "guild-123",
          client: { user: { id: "bot-123" } },
        },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(false),
          },
        },
      } as any;

      await handleArtistRoleChange(oldMember, newMember);

      expect(mockRemoveArtist).toHaveBeenCalled();
    });

    it("does nothing when role unchanged", async () => {
      mockGetArtistRoleId.mockReturnValue("artist-role-id");

      const oldMember = {
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      const newMember = {
        guild: { id: "guild-123" },
        roles: {
          cache: {
            has: vi.fn().mockReturnValue(true),
          },
        },
      } as any;

      await handleArtistRoleChange(oldMember, newMember);

      expect(mockAddArtist).not.toHaveBeenCalled();
      expect(mockRemoveArtist).not.toHaveBeenCalled();
    });
  });
});
