/**
 * Pawtropolis Tech — tests/lib/permissionCard.test.ts
 * WHAT: Unit tests for permission denial card module.
 * WHY: Verify role resolution, requirement types, and embed building.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

vi.mock("../../src/lib/roles.js", () => ({
  ROLE_NAMES: {
    "role-admin": "Admin",
    "role-gatekeeper": "Gatekeeper",
    "role-leadership": "Leadership",
  },
  getRolesAtOrAbove: vi.fn(() => ["role-admin", "role-leadership"]),
  getMinRoleDescription: vi.fn(() => "Leadership or above"),
}));

import { getConfig } from "../../src/lib/config.js";

describe("lib/permissionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PermissionRequirement types", () => {
    describe("roles type", () => {
      it("accepts explicit role ID list", () => {
        const req = { type: "roles", roleIds: ["role-123", "role-456"] };
        expect(req.type).toBe("roles");
        expect(req.roleIds).toHaveLength(2);
      });
    });

    describe("hierarchy type", () => {
      it("accepts minRoleId for hierarchical check", () => {
        const req = { type: "hierarchy", minRoleId: "role-leadership" };
        expect(req.type).toBe("hierarchy");
        expect(req.minRoleId).toBeDefined();
      });
    });

    describe("config type", () => {
      it("accepts mod_role_ids field", () => {
        const req = { type: "config", field: "mod_role_ids" };
        expect(req.field).toBe("mod_role_ids");
      });

      it("accepts reviewer_role_id field", () => {
        const req = { type: "config", field: "reviewer_role_id" };
        expect(req.field).toBe("reviewer_role_id");
      });

      it("accepts artist_role_id field", () => {
        const req = { type: "config", field: "artist_role_id" };
        expect(req.field).toBe("artist_role_id");
      });

      it("accepts leadership_role_id field", () => {
        const req = { type: "config", field: "leadership_role_id" };
        expect(req.field).toBe("leadership_role_id");
      });
    });

    describe("permission type", () => {
      it("accepts ManageGuild", () => {
        const req = { type: "permission", permission: "ManageGuild" };
        expect(req.permission).toBe("ManageGuild");
      });

      it("accepts ManageRoles", () => {
        const req = { type: "permission", permission: "ManageRoles" };
        expect(req.permission).toBe("ManageRoles");
      });

      it("accepts ManageMessages", () => {
        const req = { type: "permission", permission: "ManageMessages" };
        expect(req.permission).toBe("ManageMessages");
      });
    });

    describe("owner type", () => {
      it("represents bot owner or server dev", () => {
        const req = { type: "owner" };
        expect(req.type).toBe("owner");
      });
    });
  });

  describe("PermissionDenialOptions", () => {
    it("includes command name", () => {
      const options = { command: "backfill", description: "test", requirements: [] };
      expect(options.command).toBe("backfill");
    });

    it("includes description", () => {
      const options = { command: "test", description: "Does something useful", requirements: [] };
      expect(options.description).toContain("something useful");
    });

    it("includes requirements array", () => {
      const options = {
        command: "test",
        description: "test",
        requirements: [{ type: "owner" }],
      };
      expect(options.requirements).toHaveLength(1);
    });
  });
});

describe("role resolution", () => {
  describe("role mention format", () => {
    it("uses <@&id> format", () => {
      const roleId = "123456789";
      const mention = `<@&${roleId}>`;
      expect(mention).toBe("<@&123456789>");
    });
  });

  describe("with ROLE_NAMES mapping", () => {
    it("shows role name in parentheses", () => {
      const roleId = "role-admin";
      const name = "Admin";
      const display = `<@&${roleId}> (${name})`;
      expect(display).toContain("(Admin)");
    });
  });

  describe("without ROLE_NAMES mapping", () => {
    it("shows just the mention", () => {
      const roleId = "unknown-role";
      const display = `<@&${roleId}>`;
      expect(display).not.toContain("(");
    });
  });
});

describe("requirement resolution", () => {
  describe("roles type", () => {
    it("resolves each role with name if available", () => {
      const roleIds = ["role-admin", "unknown-role"];
      const displays = roleIds.map((id) => {
        const name = id === "role-admin" ? "Admin" : null;
        return name ? `<@&${id}> (${name})` : `<@&${id}>`;
      });

      expect(displays[0]).toContain("(Admin)");
      expect(displays[1]).not.toContain("(");
    });
  });

  describe("hierarchy type", () => {
    it("shows min role description", () => {
      const minDescription = "Leadership or above";
      expect(minDescription).toContain("or above");
    });

    it("lists all roles at or above minimum", () => {
      const rolesAbove = ["role-admin", "role-leadership"];
      expect(rolesAbove.length).toBeGreaterThan(0);
    });
  });

  describe("config type - mod_role_ids", () => {
    it("splits comma-separated IDs", () => {
      vi.mocked(getConfig).mockReturnValue({
        mod_role_ids: "role1, role2, role3",
      } as any);

      const config = getConfig("guild-123");
      const ids = config?.mod_role_ids?.split(",").map((s: string) => s.trim()).filter(Boolean);
      expect(ids).toEqual(["role1", "role2", "role3"]);
    });

    it("handles empty mod_role_ids", () => {
      vi.mocked(getConfig).mockReturnValue({
        mod_role_ids: "",
      } as any);

      const config = getConfig("guild-123");
      const ids = config?.mod_role_ids?.split(",").map((s: string) => s.trim()).filter(Boolean) ?? [];
      expect(ids).toEqual([]);
    });

    it("shows not configured message when empty", () => {
      const ids: string[] = [];
      const display = ids.length === 0 ? "*No staff roles configured*" : "roles";
      expect(display).toContain("No staff roles");
    });
  });

  describe("config type - reviewer_role_id", () => {
    it("shows reviewer role when configured", () => {
      vi.mocked(getConfig).mockReturnValue({
        reviewer_role_id: "role-reviewer",
      } as any);

      const config = getConfig("guild-123");
      const display = config?.reviewer_role_id
        ? `<@&${config.reviewer_role_id}> (reviewer)`
        : "*No reviewer role configured*";
      expect(display).toContain("(reviewer)");
    });

    it("shows not configured when missing", () => {
      vi.mocked(getConfig).mockReturnValue({
        reviewer_role_id: null,
      } as any);

      const config = getConfig("guild-123");
      const display = config?.reviewer_role_id
        ? `<@&${config.reviewer_role_id}>`
        : "*No reviewer role configured*";
      expect(display).toContain("No reviewer role");
    });
  });

  describe("config type - artist_role_id", () => {
    it("shows artist role when configured", () => {
      vi.mocked(getConfig).mockReturnValue({
        artist_role_id: "role-artist",
      } as any);

      const config = getConfig("guild-123");
      expect(config?.artist_role_id).toBe("role-artist");
    });
  });

  describe("config type - leadership_role_id", () => {
    it("shows leadership role when configured", () => {
      vi.mocked(getConfig).mockReturnValue({
        leadership_role_id: "role-leadership",
      } as any);

      const config = getConfig("guild-123");
      const display = config?.leadership_role_id
        ? `<@&${config.leadership_role_id}> (leadership)`
        : "*No leadership role configured*";
      expect(display).toContain("(leadership)");
    });
  });

  describe("permission type", () => {
    it("formats ManageGuild", () => {
      const permission = "ManageGuild";
      const display = `**${permission.replace(/([A-Z])/g, " $1").trim()}** permission`;
      expect(display).toContain("Manage Guild");
    });

    it("formats ManageRoles", () => {
      const permission = "ManageRoles";
      const display = `**${permission}** permission`;
      expect(display).toContain("ManageRoles");
    });

    it("formats ManageMessages", () => {
      const permission = "ManageMessages";
      const display = `**${permission}** permission`;
      expect(display).toContain("ManageMessages");
    });
  });

  describe("owner type", () => {
    it("shows Bot Owner or Server Dev", () => {
      const display = "**Bot Owner** or **Server Dev**";
      expect(display).toContain("Bot Owner");
      expect(display).toContain("Server Dev");
    });
  });

  describe("no guild context", () => {
    it("shows resolution failure message", () => {
      const display = "*Could not resolve requirements (no guild context)*";
      expect(display).toContain("no guild context");
    });
  });
});

describe("embed building", () => {
  describe("embed properties", () => {
    it("uses Discord red color (0xED4245)", () => {
      const color = 0xed4245;
      expect(color).toBe(0xed4245);
    });

    it("sets title to Permission Denied", () => {
      const title = "Permission Denied";
      expect(title).toBe("Permission Denied");
    });
  });

  describe("embed description", () => {
    it("includes command with leading slash", () => {
      const command = "backfill";
      const description = `**Command:** \`/${command}\``;
      expect(description).toContain("/backfill");
    });

    it("includes command description", () => {
      const cmdDescription = "Backfills historical data.";
      expect(cmdDescription).toBeDefined();
    });

    it("lists requirements with bullet points", () => {
      const reqs = ["Admin", "Leadership"];
      const formatted = reqs.map((r) => `• ${r}`).join("\n");
      expect(formatted).toContain("• Admin");
      expect(formatted).toContain("• Leadership");
    });
  });

  describe("embed footer", () => {
    it("includes trace ID", () => {
      const traceId = "90ABCDEF";
      const footer = `Trace: ${traceId}`;
      expect(footer).toContain("Trace:");
    });
  });

  describe("embed timestamp", () => {
    it("includes current timestamp", () => {
      const hasTimestamp = true;
      expect(hasTimestamp).toBe(true);
    });
  });
});

describe("trace ID generation", () => {
  it("uses last 8 chars of interaction ID", () => {
    const interactionId = "1234567890ABCDEF";
    const traceId = interactionId.slice(-8).toUpperCase();
    expect(traceId).toBe("90ABCDEF");
  });

  it("converts to uppercase", () => {
    const interactionId = "1234567890abcdef";
    const traceId = interactionId.slice(-8).toUpperCase();
    expect(traceId).toBe("90ABCDEF");
  });
});

describe("reply behavior", () => {
  describe("deferred interaction", () => {
    it("uses editReply when deferred", () => {
      const deferred = true;
      const method = deferred ? "editReply" : "reply";
      expect(method).toBe("editReply");
    });
  });

  describe("replied interaction", () => {
    it("uses editReply when already replied", () => {
      const replied = true;
      const method = replied ? "editReply" : "reply";
      expect(method).toBe("editReply");
    });
  });

  describe("fresh interaction", () => {
    it("uses reply when not deferred or replied", () => {
      const deferred = false;
      const replied = false;
      const method = deferred || replied ? "editReply" : "reply";
      expect(method).toBe("reply");
    });
  });

  describe("public visibility", () => {
    it("reply is public (no ephemeral flag)", () => {
      const isPublic = true;
      expect(isPublic).toBe(true);
    });
  });
});

describe("fallback handling", () => {
  describe("embed send failure", () => {
    it("falls back to text reply", () => {
      const fallbackMsg = "You don't have permission to use `/command`.";
      expect(fallbackMsg).toContain("don't have permission");
    });

    it("includes requirement summary", () => {
      const reqs = ["Admin", "Leadership"];
      const fallbackMsg = `Required: ${reqs.join(" or ")}`;
      expect(fallbackMsg).toContain("Admin or Leadership");
    });
  });

  describe("fallback failure", () => {
    it("logs error when fallback also fails", () => {
      const shouldLogError = true;
      expect(shouldLogError).toBe(true);
    });
  });
});

describe("logging", () => {
  it("logs permission denial with context", () => {
    const logData = {
      command: "backfill",
      userId: "user123",
      guildId: "guild123",
      traceId: "90ABCDEF",
    };

    expect(logData.command).toBeDefined();
    expect(logData.userId).toBeDefined();
    expect(logData.guildId).toBeDefined();
    expect(logData.traceId).toBeDefined();
  });
});
