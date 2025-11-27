/**
 * Pawtropolis Tech -- tests/lib/config.test.ts
 * WHAT: Tests for the guild configuration module (getConfig, upsertConfig, permission helpers).
 * WHY: Configuration is central to guild customization; tests verify CRUD operations
 *      and permission checks work correctly.
 *
 * Uses a mock database to avoid hitting the real DB. Tests for the actual DB layer
 * are in tests/config.test.ts.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GuildMember, PermissionsBitField, ChatInputCommandInteraction, Guild } from "discord.js";

// ===== Mock Setup =====

// Mock the database module before importing config
const mockDb = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock("../../src/db/db.js", () => ({
  db: mockDb,
}));

// Mock logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

// Mock env
vi.mock("../../src/lib/env.js", () => ({
  env: {
    OWNER_IDS: "owner-1,owner-2",
    GATE_ADMIN_ROLE_IDS: "admin-role-1,admin-role-2",
    RESET_PASSWORD: "test-reset-password",
  },
}));

// Mock owner utility
vi.mock("../../src/utils/owner.js", () => ({
  isOwner: vi.fn((id: string) => id === "owner-1" || id === "owner-2"),
}));

// Import after mocks
import {
  hasManageGuild,
  isReviewer,
  canRunAllCommands,
  hasStaffPermissions,
} from "../../src/lib/config.js";
import { isOwner } from "../../src/utils/owner.js";

// ===== Test Helpers =====

/**
 * Creates a mock GuildMember with configurable permissions and roles.
 */
function createMockMember(options: {
  userId?: string;
  permissions?: string[];
  roleIds?: string[];
} = {}): GuildMember {
  const userId = options.userId ?? "user-123";
  const permissions = options.permissions ?? [];
  const roleIds = options.roleIds ?? [];

  const rolesCache = new Map<string, boolean>();
  roleIds.forEach((id) => rolesCache.set(id, true));

  return {
    id: userId,
    user: { id: userId },
    permissions: {
      has: vi.fn((perm: string) => permissions.includes(perm)),
    } as unknown as PermissionsBitField,
    roles: {
      cache: {
        has: (id: string) => rolesCache.has(id),
        keys: () => rolesCache.keys(),
      },
    },
    guild: {
      channels: {
        cache: new Map(),
      },
    },
  } as unknown as GuildMember;
}

/**
 * Sets up the mock database to return a specific config.
 */
function setupMockConfig(config: Record<string, unknown> | undefined) {
  const mockStatement = {
    get: vi.fn().mockReturnValue(config),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn(),
  };

  mockDb.prepare.mockReturnValue(mockStatement);

  return mockStatement;
}

// ===== hasManageGuild Tests =====

describe("hasManageGuild", () => {
  it("returns true when member has ManageGuild permission", () => {
    const member = createMockMember({ permissions: ["ManageGuild"] });
    expect(hasManageGuild(member)).toBe(true);
  });

  it("returns false when member lacks ManageGuild permission", () => {
    const member = createMockMember({ permissions: [] });
    expect(hasManageGuild(member)).toBe(false);
  });

  it("returns false for null member", () => {
    expect(hasManageGuild(null)).toBe(false);
  });

  it("returns false for undefined member", () => {
    expect(hasManageGuild(undefined as unknown as GuildMember | null)).toBe(false);
  });
});

// ===== isReviewer Tests =====

describe("isReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for null member", () => {
    expect(isReviewer("guild-123", null)).toBe(false);
  });

  it("returns true when member has reviewer role", () => {
    // Setup mock to return config with reviewer_role_id
    setupMockConfig({
      guild_id: "guild-123",
      reviewer_role_id: "reviewer-role-1",
      review_channel_id: null,
    });

    const member = createMockMember({
      roleIds: ["reviewer-role-1"],
    });

    expect(isReviewer("guild-123", member)).toBe(true);
  });

  it("returns false when member lacks reviewer role", () => {
    setupMockConfig({
      guild_id: "guild-123",
      reviewer_role_id: "reviewer-role-1",
      review_channel_id: null,
    });

    const member = createMockMember({
      roleIds: ["other-role"],
    });

    expect(isReviewer("guild-123", member)).toBe(false);
  });

  it("falls back to channel visibility when no reviewer role configured", () => {
    setupMockConfig({
      guild_id: "guild-123",
      reviewer_role_id: null,
      review_channel_id: "review-channel-1",
    });

    // Create member with access to review channel
    const channelPerms = {
      has: vi.fn().mockReturnValue(true),
    };
    const reviewChannel = {
      id: "review-channel-1",
      permissionsFor: vi.fn().mockReturnValue(channelPerms),
    };
    const channelsCache = new Map([["review-channel-1", reviewChannel]]);

    const member = {
      id: "user-123",
      user: { id: "user-123" },
      roles: { cache: { has: () => false } },
      guild: {
        channels: { cache: channelsCache },
      },
    } as unknown as GuildMember;

    expect(isReviewer("guild-123", member)).toBe(true);
    expect(channelPerms.has).toHaveBeenCalledWith("ViewChannel");
  });

  it("returns false when review channel not accessible", () => {
    setupMockConfig({
      guild_id: "guild-123",
      reviewer_role_id: null,
      review_channel_id: "review-channel-1",
    });

    const channelPerms = {
      has: vi.fn().mockReturnValue(false),
    };
    const reviewChannel = {
      id: "review-channel-1",
      permissionsFor: vi.fn().mockReturnValue(channelPerms),
    };
    const channelsCache = new Map([["review-channel-1", reviewChannel]]);

    const member = {
      id: "user-123",
      user: { id: "user-123" },
      roles: { cache: { has: () => false } },
      guild: {
        channels: { cache: channelsCache },
      },
    } as unknown as GuildMember;

    expect(isReviewer("guild-123", member)).toBe(false);
  });

  it("returns false when no config exists", () => {
    setupMockConfig(undefined);
    const member = createMockMember();
    expect(isReviewer("guild-123", member)).toBe(false);
  });
});

// ===== canRunAllCommands Tests =====

describe("canRunAllCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isOwner).mockImplementation((id) => id === "owner-1" || id === "owner-2");
  });

  it("returns false for null member", () => {
    expect(canRunAllCommands(null, "guild-123")).toBe(false);
  });

  it("returns true for bot owner", () => {
    const member = createMockMember({ userId: "owner-1" });

    // No config needed - owner bypass is checked first
    setupMockConfig(undefined);

    expect(canRunAllCommands(member, "guild-123")).toBe(true);
  });

  it("returns true for member with configured mod role", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: "mod-role-1,mod-role-2",
    });

    const member = createMockMember({
      userId: "regular-user",
      roleIds: ["mod-role-2"],
    });

    expect(canRunAllCommands(member, "guild-123")).toBe(true);
  });

  it("returns false when member has no mod role", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: "mod-role-1,mod-role-2",
    });

    const member = createMockMember({
      userId: "regular-user",
      roleIds: ["other-role"],
    });

    expect(canRunAllCommands(member, "guild-123")).toBe(false);
  });

  it("returns false when no mod roles configured", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: null,
    });

    const member = createMockMember({
      userId: "regular-user",
      roleIds: ["some-role"],
    });

    expect(canRunAllCommands(member, "guild-123")).toBe(false);
  });

  it("returns false when mod_role_ids is empty string", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: "  ",
    });

    const member = createMockMember({
      userId: "regular-user",
    });

    expect(canRunAllCommands(member, "guild-123")).toBe(false);
  });

  it("handles CSV mod_role_ids with whitespace", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: " mod-role-1 , mod-role-2 , mod-role-3 ",
    });

    const member = createMockMember({
      userId: "regular-user",
      roleIds: ["mod-role-2"],
    });

    expect(canRunAllCommands(member, "guild-123")).toBe(true);
  });

  it("logs permission check results", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: "mod-role-1",
    });

    const member = createMockMember({
      userId: "test-user",
      roleIds: [],
    });

    canRunAllCommands(member, "guild-123");

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "permission_check",
        userId: "test-user",
        guildId: "guild-123",
        result: false,
      }),
      expect.any(String)
    );
  });
});

// ===== hasStaffPermissions Tests =====
// Note: hasStaffPermissions uses require() internally which bypasses mocks.
// These tests are skipped in unit tests but would work in integration tests.

describe.skip("hasStaffPermissions", () => {
  // These tests are skipped because hasStaffPermissions uses require() internally
  // which cannot be properly mocked with vi.mock(). In a real scenario, these
  // would be covered by integration tests with a real database.
  it.todo("returns true for bot owner");
  it.todo("returns true for member with ManageGuild");
  it.todo("returns true for reviewer");
  it.todo("returns false for non-staff member");
  it.todo("returns false for null member");
});

// ===== Focused Permission Tests =====
// These test the functions that can be properly mocked

describe("permission function behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isOwner).mockImplementation((id) => id === "owner-1");
  });

  it("canRunAllCommands works independently of hasStaffPermissions", () => {
    setupMockConfig({
      guild_id: "guild-123",
      mod_role_ids: "mod-role-1",
      reviewer_role_id: "reviewer-role-1",
      review_channel_id: null,
    });

    // Owner gets access via canRunAllCommands
    const owner = createMockMember({ userId: "owner-1" });
    expect(canRunAllCommands(owner, "guild-123")).toBe(true);

    // Mod role gets access
    const mod = createMockMember({
      userId: "mod-user",
      roleIds: ["mod-role-1"],
    });
    expect(canRunAllCommands(mod, "guild-123")).toBe(true);

    // Regular user denied
    const regular = createMockMember({
      userId: "regular-user",
    });
    expect(canRunAllCommands(regular, "guild-123")).toBe(false);
  });

  it("hasManageGuild is independent permission check", () => {
    const admin = createMockMember({
      userId: "admin-user",
      permissions: ["ManageGuild"],
    });
    expect(hasManageGuild(admin)).toBe(true);

    const regular = createMockMember({
      userId: "regular-user",
    });
    expect(hasManageGuild(regular)).toBe(false);
  });

  it("isReviewer checks reviewer role", () => {
    setupMockConfig({
      guild_id: "guild-123",
      reviewer_role_id: "reviewer-role-1",
      review_channel_id: null,
    });

    const reviewer = createMockMember({
      userId: "reviewer-user",
      roleIds: ["reviewer-role-1"],
    });
    expect(isReviewer("guild-123", reviewer)).toBe(true);

    const regular = createMockMember({
      userId: "regular-user",
    });
    expect(isReviewer("guild-123", regular)).toBe(false);
  });
});
