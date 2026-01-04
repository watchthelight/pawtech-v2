/**
 * Pawtropolis Tech — tests/lib/roles.test.ts
 * WHAT: Unit tests for role hierarchy and permission helpers.
 * WHY: Verify role checks, hierarchy comparisons, and bypass logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";
import type { GuildMember, Collection, Role } from "discord.js";
import {
  ROLE_IDS,
  BOT_OWNER_UID,
  ROLE_HIERARCHY,
  ROLE_RANK,
  ROLE_NAMES,
  isBotOwner,
  isServerDev,
  shouldBypass,
  hasRole,
  hasAnyRole,
  hasRoleOrAbove,
  getRolesAtOrAbove,
  getRoleName,
  getMinRoleDescription,
  GATEKEEPER_ONLY,
  GATEKEEPER_PLUS,
  JUNIOR_MOD_PLUS,
  MODERATOR_PLUS,
  SENIOR_MOD_PLUS,
  ADMIN_PLUS,
  SENIOR_ADMIN_PLUS,
  COMMUNITY_MANAGER_PLUS,
  SERVER_ARTIST,
  ARTIST_OR_ADMIN,
} from "../../src/lib/roles.js";

// Mock role cache helper
function createMockMember(roleIds: string[]): GuildMember {
  const rolesMap = new Map<string, Role>();
  roleIds.forEach((id) => {
    rolesMap.set(id, { id } as Role);
  });

  return {
    roles: {
      cache: {
        has: (id: string) => rolesMap.has(id),
        size: rolesMap.size,
      } as unknown as Collection<string, Role>,
    },
  } as GuildMember;
}

describe("roles", () => {
  describe("ROLE_IDS constants", () => {
    it("has expected role IDs defined", () => {
      expect(ROLE_IDS.SERVER_OWNER).toBeDefined();
      expect(ROLE_IDS.ADMINISTRATOR).toBeDefined();
      expect(ROLE_IDS.MODERATOR).toBeDefined();
      expect(ROLE_IDS.GATEKEEPER).toBeDefined();
      expect(ROLE_IDS.SERVER_DEV).toBeDefined();
      expect(ROLE_IDS.SERVER_ARTIST).toBeDefined();
    });

    it("role IDs are strings", () => {
      Object.values(ROLE_IDS).forEach((id) => {
        expect(typeof id).toBe("string");
      });
    });
  });

  describe("BOT_OWNER_UID", () => {
    it("is defined", () => {
      expect(BOT_OWNER_UID).toBeDefined();
      expect(typeof BOT_OWNER_UID).toBe("string");
    });
  });

  describe("ROLE_HIERARCHY", () => {
    it("has expected length", () => {
      expect(ROLE_HIERARCHY.length).toBeGreaterThan(0);
    });

    it("starts with SERVER_OWNER (highest)", () => {
      expect(ROLE_HIERARCHY[0]).toBe(ROLE_IDS.SERVER_OWNER);
    });

    it("includes all hierarchy roles", () => {
      expect(ROLE_HIERARCHY).toContain(ROLE_IDS.ADMINISTRATOR);
      expect(ROLE_HIERARCHY).toContain(ROLE_IDS.MODERATOR);
      expect(ROLE_HIERARCHY).toContain(ROLE_IDS.GATEKEEPER);
    });
  });

  describe("ROLE_RANK", () => {
    it("maps role IDs to numeric ranks", () => {
      expect(ROLE_RANK[ROLE_IDS.SERVER_OWNER]).toBe(0);
      expect(typeof ROLE_RANK[ROLE_IDS.ADMINISTRATOR]).toBe("number");
    });

    it("higher roles have lower rank numbers", () => {
      expect(ROLE_RANK[ROLE_IDS.SERVER_OWNER]).toBeLessThan(ROLE_RANK[ROLE_IDS.ADMINISTRATOR]);
      expect(ROLE_RANK[ROLE_IDS.ADMINISTRATOR]).toBeLessThan(ROLE_RANK[ROLE_IDS.MODERATOR]);
      expect(ROLE_RANK[ROLE_IDS.MODERATOR]).toBeLessThan(ROLE_RANK[ROLE_IDS.GATEKEEPER]);
    });
  });

  describe("ROLE_NAMES", () => {
    it("provides display names for roles", () => {
      expect(ROLE_NAMES[ROLE_IDS.SERVER_OWNER]).toBe("Server Owner");
      expect(ROLE_NAMES[ROLE_IDS.ADMINISTRATOR]).toBe("Administrator");
      expect(ROLE_NAMES[ROLE_IDS.MODERATOR]).toBe("Moderator");
    });

    it("has names for all hierarchy roles", () => {
      ROLE_HIERARCHY.forEach((roleId) => {
        expect(ROLE_NAMES[roleId]).toBeDefined();
      });
    });
  });

  describe("isBotOwner", () => {
    it("returns true for bot owner ID", () => {
      expect(isBotOwner(BOT_OWNER_UID)).toBe(true);
    });

    it("returns false for other user IDs", () => {
      expect(isBotOwner("123456789")).toBe(false);
      expect(isBotOwner("")).toBe(false);
    });
  });

  describe("isServerDev", () => {
    it("returns true for member with SERVER_DEV role", () => {
      const member = createMockMember([ROLE_IDS.SERVER_DEV]);
      expect(isServerDev(member)).toBe(true);
    });

    it("returns false for member without SERVER_DEV role", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(isServerDev(member)).toBe(false);
    });

    it("returns false for null member", () => {
      expect(isServerDev(null)).toBe(false);
    });
  });

  describe("shouldBypass", () => {
    it("returns true for bot owner", () => {
      const member = createMockMember([]);
      expect(shouldBypass(BOT_OWNER_UID, member)).toBe(true);
    });

    it("returns true for server dev", () => {
      const member = createMockMember([ROLE_IDS.SERVER_DEV]);
      expect(shouldBypass("other-user", member)).toBe(true);
    });

    it("returns false for regular user", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(shouldBypass("other-user", member)).toBe(false);
    });

    it("returns false for null member and non-owner", () => {
      expect(shouldBypass("other-user", null)).toBe(false);
    });
  });

  describe("hasRole", () => {
    it("returns true when member has the role", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(hasRole(member, ROLE_IDS.MODERATOR)).toBe(true);
    });

    it("returns false when member lacks the role", () => {
      const member = createMockMember([ROLE_IDS.GATEKEEPER]);
      expect(hasRole(member, ROLE_IDS.MODERATOR)).toBe(false);
    });

    it("returns false for null member", () => {
      expect(hasRole(null, ROLE_IDS.MODERATOR)).toBe(false);
    });
  });

  describe("hasAnyRole", () => {
    it("returns true when member has one of the roles", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(hasAnyRole(member, [ROLE_IDS.GATEKEEPER, ROLE_IDS.MODERATOR])).toBe(true);
    });

    it("returns false when member has none of the roles", () => {
      const member = createMockMember([ROLE_IDS.GATEKEEPER]);
      expect(hasAnyRole(member, [ROLE_IDS.MODERATOR, ROLE_IDS.ADMINISTRATOR])).toBe(false);
    });

    it("returns false for null member", () => {
      expect(hasAnyRole(null, [ROLE_IDS.MODERATOR])).toBe(false);
    });

    it("returns false for empty role array", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(hasAnyRole(member, [])).toBe(false);
    });
  });

  describe("hasRoleOrAbove", () => {
    it("returns true when member has exact role", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(hasRoleOrAbove(member, ROLE_IDS.MODERATOR)).toBe(true);
    });

    it("returns true when member has higher role", () => {
      const member = createMockMember([ROLE_IDS.ADMINISTRATOR]);
      expect(hasRoleOrAbove(member, ROLE_IDS.MODERATOR)).toBe(true);
    });

    it("returns false when member has lower role", () => {
      const member = createMockMember([ROLE_IDS.GATEKEEPER]);
      expect(hasRoleOrAbove(member, ROLE_IDS.MODERATOR)).toBe(false);
    });

    it("returns false for null member", () => {
      expect(hasRoleOrAbove(null, ROLE_IDS.MODERATOR)).toBe(false);
    });

    it("falls back to exact check for non-hierarchy roles", () => {
      const member = createMockMember([ROLE_IDS.SERVER_ARTIST]);
      expect(hasRoleOrAbove(member, ROLE_IDS.SERVER_ARTIST)).toBe(true);
    });

    it("returns false for non-hierarchy role not possessed", () => {
      const member = createMockMember([ROLE_IDS.MODERATOR]);
      expect(hasRoleOrAbove(member, ROLE_IDS.SERVER_ARTIST)).toBe(false);
    });
  });

  describe("getRolesAtOrAbove", () => {
    it("returns roles at and above the specified level", () => {
      const roles = getRolesAtOrAbove(ROLE_IDS.ADMINISTRATOR);
      expect(roles).toContain(ROLE_IDS.ADMINISTRATOR);
      expect(roles).toContain(ROLE_IDS.SERVER_OWNER);
      expect(roles).not.toContain(ROLE_IDS.MODERATOR);
    });

    it("returns only SERVER_OWNER for SERVER_OWNER", () => {
      const roles = getRolesAtOrAbove(ROLE_IDS.SERVER_OWNER);
      expect(roles).toEqual([ROLE_IDS.SERVER_OWNER]);
    });

    it("returns all hierarchy roles for lowest role", () => {
      const roles = getRolesAtOrAbove(ROLE_IDS.MOD_TEAM);
      expect(roles.length).toBe(ROLE_HIERARCHY.length);
    });

    it("returns single-element array for non-hierarchy role", () => {
      const roles = getRolesAtOrAbove(ROLE_IDS.SERVER_ARTIST);
      expect(roles).toEqual([ROLE_IDS.SERVER_ARTIST]);
    });
  });

  describe("getRoleName", () => {
    it("returns display name for known role", () => {
      expect(getRoleName(ROLE_IDS.ADMINISTRATOR)).toBe("Administrator");
    });

    it("returns mention format for unknown role", () => {
      const unknownId = "123456789012345678";
      expect(getRoleName(unknownId)).toBe(`<@&${unknownId}>`);
    });
  });

  describe("getMinRoleDescription", () => {
    it("returns role name with 'or above' for hierarchy roles", () => {
      expect(getMinRoleDescription(ROLE_IDS.MODERATOR)).toBe("Moderator or above");
    });

    it("returns just role name for SERVER_OWNER (highest)", () => {
      expect(getMinRoleDescription(ROLE_IDS.SERVER_OWNER)).toBe("Server Owner");
    });

    it("returns 'Unknown role' for unknown role ID", () => {
      expect(getMinRoleDescription("unknown-role-id")).toBe("Unknown role");
    });
  });

  describe("pre-built role sets", () => {
    it("GATEKEEPER_ONLY contains only gatekeeper", () => {
      expect(GATEKEEPER_ONLY).toEqual([ROLE_IDS.GATEKEEPER]);
    });

    it("GATEKEEPER_PLUS contains gatekeeper and above", () => {
      expect(GATEKEEPER_PLUS).toContain(ROLE_IDS.GATEKEEPER);
      expect(GATEKEEPER_PLUS).toContain(ROLE_IDS.MODERATOR);
      expect(GATEKEEPER_PLUS).toContain(ROLE_IDS.ADMINISTRATOR);
    });

    it("JUNIOR_MOD_PLUS starts at junior mod", () => {
      expect(JUNIOR_MOD_PLUS).toContain(ROLE_IDS.JUNIOR_MOD);
      expect(JUNIOR_MOD_PLUS).toContain(ROLE_IDS.MODERATOR);
      expect(JUNIOR_MOD_PLUS).not.toContain(ROLE_IDS.GATEKEEPER);
    });

    it("MODERATOR_PLUS starts at moderator", () => {
      expect(MODERATOR_PLUS).toContain(ROLE_IDS.MODERATOR);
      expect(MODERATOR_PLUS).toContain(ROLE_IDS.ADMINISTRATOR);
      expect(MODERATOR_PLUS).not.toContain(ROLE_IDS.JUNIOR_MOD);
    });

    it("SENIOR_MOD_PLUS starts at senior mod", () => {
      expect(SENIOR_MOD_PLUS).toContain(ROLE_IDS.SENIOR_MOD);
      expect(SENIOR_MOD_PLUS).toContain(ROLE_IDS.ADMINISTRATOR);
      expect(SENIOR_MOD_PLUS).not.toContain(ROLE_IDS.MODERATOR);
    });

    it("ADMIN_PLUS starts at administrator", () => {
      expect(ADMIN_PLUS).toContain(ROLE_IDS.ADMINISTRATOR);
      expect(ADMIN_PLUS).toContain(ROLE_IDS.SERVER_OWNER);
      expect(ADMIN_PLUS).not.toContain(ROLE_IDS.MODERATOR);
    });

    it("SENIOR_ADMIN_PLUS starts at senior admin", () => {
      expect(SENIOR_ADMIN_PLUS).toContain(ROLE_IDS.SENIOR_ADMIN);
      expect(SENIOR_ADMIN_PLUS).toContain(ROLE_IDS.SERVER_OWNER);
      expect(SENIOR_ADMIN_PLUS).not.toContain(ROLE_IDS.ADMINISTRATOR);
    });

    it("COMMUNITY_MANAGER_PLUS starts at community manager", () => {
      expect(COMMUNITY_MANAGER_PLUS).toContain(ROLE_IDS.COMMUNITY_MANAGER);
      expect(COMMUNITY_MANAGER_PLUS).toContain(ROLE_IDS.SERVER_OWNER);
    });

    it("SERVER_ARTIST contains only server artist", () => {
      expect(SERVER_ARTIST).toEqual([ROLE_IDS.SERVER_ARTIST]);
    });

    it("ARTIST_OR_ADMIN contains both artist and admin+", () => {
      expect(ARTIST_OR_ADMIN).toContain(ROLE_IDS.SERVER_ARTIST);
      expect(ARTIST_OR_ADMIN).toContain(ROLE_IDS.ADMINISTRATOR);
      expect(ARTIST_OR_ADMIN).toContain(ROLE_IDS.SERVER_OWNER);
    });
  });
});
