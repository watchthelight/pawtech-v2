/**
 * Tests for the approveFlow function which handles the "Accept" decision on applications.
 * This flow assigns roles to approved members and handles Discord API errors gracefully.
 *
 * The Sentry mock is critical here: we DON'T want to report "Missing Permissions" errors
 * to Sentry because they're expected when the bot's role is positioned below the target role.
 * These are configuration issues, not bugs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Guild, GuildMember } from "discord.js";
import { approveFlow } from "../../src/features/review.js";
import type { GuildConfig } from "../../src/lib/config.js";

/**
 * Mock Sentry but preserve the actual module structure. We need captureException
 * to be a spy so we can verify it's NOT called for expected permission errors.
 */
vi.mock("../../src/lib/sentry.js", async () => {
  const actual = (await vi.importActual<typeof import("../../src/lib/sentry.js")>(
    "../../src/lib/sentry.js"
  )) as Record<string, unknown>;
  return {
    ...actual,
    captureException: vi.fn(),
  };
});

/**
 * Mock canManageRole from roleAutomation. This is used for pre-flight permission checks.
 * We need to control this to test both success and failure paths.
 * Use vi.hoisted() to ensure the mock is available before module initialization.
 */
const mockCanManageRole = vi.hoisted(() => vi.fn());
vi.mock("../../src/features/roleAutomation.js", () => ({
  canManageRole: mockCanManageRole,
}));

const sentry = await import("../../src/lib/sentry.js");

describe("approveFlow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Pre-flight permission check failure. This happens when canManageRole detects:
   * - Bot role is lower than the role it's trying to assign
   * - Bot lacks "Manage Roles" permission
   *
   * The flow should surface the error to the UI but NOT attempt the role.add()
   * call since it would fail anyway. This prevents unnecessary API errors.
   */
  it("returns roleError and skips captureException on missing permissions", async () => {
    // Mock canManageRole to return failure - this is the pre-flight check
    mockCanManageRole.mockResolvedValue({
      canManage: false,
      reason: "Role hierarchy violation: bot role (Bot @5) is not above target role (Admin @10)",
    });

    // Minimal GuildMember mock. roles.add() should NOT be called when pre-flight fails.
    const memberRoles = {
      cache: new Map<string, true>(),
      add: vi.fn().mockResolvedValue(undefined),
    };

    const member = {
      id: "member-1",
      roles: memberRoles,
    } as unknown as GuildMember;

    // Guild mock with member fetching and role cache. The role exists in cache
    // so the function won't try to fetch it (that would be a different code path).
    const guild = {
      id: "guild-1",
      members: { fetch: vi.fn().mockResolvedValue(member) },
      roles: {
        cache: new Map([["role-1", { id: "role-1" }]]),
        fetch: vi.fn().mockResolvedValue({ id: "role-1" }),
      },
    } as unknown as Guild;

    // Minimal config - just needs the role ID that gets assigned on approval
    const cfg = {
      accepted_role_id: "role-1",
    } as unknown as GuildConfig;

    const result = await approveFlow(guild, "member-1", cfg);

    // roleApplied: false tells the caller to show a warning in the UI
    expect(result.roleApplied).toBe(false);
    // The error message comes from canManageRole
    expect(result.roleError?.message).toContain("Role hierarchy violation");
    // Pre-flight check prevents the role.add() call entirely
    expect(memberRoles.add).not.toHaveBeenCalled();
    // Permission errors detected by pre-flight should NOT go to Sentry
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  /**
   * Happy path: role assignment succeeds. This is the normal flow when:
   * - Bot has proper permissions
   * - Bot role is positioned above the target role
   * - The role exists and is assignable
   */
  it("successfully approves user and assigns role", async () => {
    // Mock canManageRole to return success - pre-flight check passes
    mockCanManageRole.mockResolvedValue({ canManage: true });

    const memberRoles = {
      cache: new Map<string, true>(),
      add: vi.fn().mockResolvedValue(undefined),
    };

    const member = {
      id: "member-1",
      roles: memberRoles,
    } as unknown as GuildMember;

    const guild = {
      id: "guild-1",
      members: { fetch: vi.fn().mockResolvedValue(member) },
      roles: {
        cache: new Map([["role-1", { id: "role-1" }]]),
        fetch: vi.fn().mockResolvedValue({ id: "role-1" }),
      },
    } as unknown as Guild;

    const cfg = { accepted_role_id: "role-1" } as GuildConfig;

    const result = await approveFlow(guild, "member-1", cfg);

    expect(result.roleApplied).toBe(true);
    expect(result.roleError).toBeNull();
    expect(memberRoles.add).toHaveBeenCalledWith({ id: "role-1" }, "Gate approval");
  });
});
