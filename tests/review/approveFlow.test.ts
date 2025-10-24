// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Guild, GuildMember } from "discord.js";
import { approveFlow } from "../../src/features/review.js";
import type { GuildConfig } from "../../src/lib/config.js";

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

  it("returns roleError and skips captureException on missing permissions", async () => {
    const error = Object.assign(new Error("Missing Permissions"), {
      code: 50013,
      name: "DiscordAPIError[50013]",
    });

    const memberRoles = {
      cache: new Map<string, true>(),
      add: vi.fn().mockRejectedValue(error),
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

    const cfg = {
      accepted_role_id: "role-1",
    } as unknown as GuildConfig;

    const result = await approveFlow(guild, "member-1", cfg);

    expect(result.roleApplied).toBe(false);
    expect(result.roleError?.code).toBe(50013);
    expect(result.roleError?.message).toContain("Missing Permissions");
    expect(memberRoles.add).toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
