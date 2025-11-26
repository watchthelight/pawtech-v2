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

const sentry = await import("../../src/lib/sentry.js");

describe("approveFlow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Discord error code 50013 = Missing Permissions. This happens when:
   * - Bot role is lower than the role it's trying to assign
   * - Bot lacks "Manage Roles" permission
   * - Target role is @everyone or a managed role (like Nitro Booster)
   *
   * The flow should surface the error to the UI but NOT report to Sentry.
   * Admins need to fix their role hierarchy, not us.
   */
  it("returns roleError and skips captureException on missing permissions", async () => {
    // Simulating Discord.js error shape. The code property is how we identify
    // permission errors vs other API failures.
    const error = Object.assign(new Error("Missing Permissions"), {
      code: 50013,
      name: "DiscordAPIError[50013]",
    });

    // Minimal GuildMember mock. roles.add() is the method that throws when
    // the bot can't assign the role.
    const memberRoles = {
      cache: new Map<string, true>(),
      add: vi.fn().mockRejectedValue(error),
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
    // The error object is passed through so it can be displayed
    expect(result.roleError?.code).toBe(50013);
    expect(result.roleError?.message).toContain("Missing Permissions");
    // Sanity check: we did try to add the role
    expect(memberRoles.add).toHaveBeenCalled();
    // The key assertion: permission errors should NOT go to Sentry
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
