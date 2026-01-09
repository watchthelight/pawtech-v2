/**
 * Pawtropolis Tech — tests/lib/typeGuards.test.ts
 * WHAT: Unit tests for Discord type guards.
 * WHY: Verify type narrowing logic for GuildMember vs APIInteractionGuildMember.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { isGuildMember, requireGuildMember } from "../../src/lib/typeGuards.js";
import type { GuildMember, APIInteractionGuildMember, PermissionsBitField } from "discord.js";

describe("typeGuards", () => {
  describe("isGuildMember", () => {
    describe("returns false for invalid inputs", () => {
      it("returns false for null", () => {
        expect(isGuildMember(null)).toBe(false);
      });

      it("returns false for undefined", () => {
        expect(isGuildMember(undefined)).toBe(false);
      });
    });

    describe("identifies GuildMember correctly", () => {
      it("returns true for object with non-string permissions and roles", () => {
        const mockMember = {
          permissions: { bitfield: 0n } as PermissionsBitField,
          roles: { cache: new Map() },
          user: { id: "123" },
        } as unknown as GuildMember;

        expect(isGuildMember(mockMember)).toBe(true);
      });

      it("returns true for GuildMember with PermissionsBitField", () => {
        const mockMember = {
          permissions: {
            bitfield: 123456789n,
            has: () => true,
            toArray: () => [],
          } as unknown as PermissionsBitField,
          roles: {
            cache: new Map(),
            highest: {},
          },
          user: { id: "123", username: "test" },
          guild: { id: "456" },
        } as unknown as GuildMember;

        expect(isGuildMember(mockMember)).toBe(true);
      });
    });

    describe("identifies APIInteractionGuildMember correctly", () => {
      it("returns false for object with string permissions", () => {
        const apiMember: APIInteractionGuildMember = {
          permissions: "123456789",
          roles: ["role1", "role2"],
          user: { id: "123", username: "test", discriminator: "0", avatar: null, global_name: null },
          joined_at: "2024-01-01T00:00:00.000Z",
          deaf: false,
          mute: false,
          flags: 0,
        };

        expect(isGuildMember(apiMember)).toBe(false);
      });

      it("returns false for partial API member", () => {
        const apiMember = {
          permissions: "0",
          roles: [],
          joined_at: "2024-01-01T00:00:00.000Z",
        } as unknown as APIInteractionGuildMember;

        expect(isGuildMember(apiMember)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("returns false for object without roles property", () => {
        const invalidMember = {
          permissions: { bitfield: 0n },
          user: { id: "123" },
        } as unknown as GuildMember;

        expect(isGuildMember(invalidMember)).toBe(false);
      });

      it("returns false for object with string permissions but roles object", () => {
        const weirdMember = {
          permissions: "123456789",
          roles: { cache: new Map() },
        } as unknown as GuildMember;

        expect(isGuildMember(weirdMember)).toBe(false);
      });
    });
  });

  describe("requireGuildMember", () => {
    describe("returns member when valid", () => {
      it("returns the member when it is a GuildMember", () => {
        const mockMember = {
          permissions: { bitfield: 0n } as PermissionsBitField,
          roles: { cache: new Map() },
          user: { id: "123" },
        } as unknown as GuildMember;

        const result = requireGuildMember(mockMember, "test context");

        expect(result).toBe(mockMember);
      });
    });

    describe("throws when invalid", () => {
      it("throws for null member", () => {
        expect(() => requireGuildMember(null, "permission check")).toThrow(
          "permission check: Full GuildMember required but not available"
        );
      });

      it("throws for undefined member", () => {
        expect(() => requireGuildMember(undefined, "role assignment")).toThrow(
          "role assignment: Full GuildMember required but not available"
        );
      });

      it("throws for APIInteractionGuildMember", () => {
        const apiMember: APIInteractionGuildMember = {
          permissions: "123456789",
          roles: ["role1"],
          user: { id: "123", username: "test", discriminator: "0", avatar: null, global_name: null },
          joined_at: "2024-01-01T00:00:00.000Z",
          deaf: false,
          mute: false,
          flags: 0,
        };

        expect(() => requireGuildMember(apiMember, "kick command")).toThrow(
          "kick command: Full GuildMember required but not available"
        );
      });

      it("includes context in error message", () => {
        try {
          requireGuildMember(null, "my special context");
          expect.fail("Should have thrown");
        } catch (err) {
          expect((err as Error).message).toContain("my special context");
        }
      });

      it("includes guidance about caching in error message", () => {
        try {
          requireGuildMember(null, "test");
          expect.fail("Should have thrown");
        } catch (err) {
          expect((err as Error).message).toContain("member isn't cached");
        }
      });
    });

    describe("type narrowing", () => {
      it("narrows type to GuildMember after successful call", () => {
        const mockMember = {
          permissions: { bitfield: 0n } as PermissionsBitField,
          roles: { cache: new Map() },
          user: { id: "123" },
          kick: () => Promise.resolve(mockMember),
        } as unknown as GuildMember;

        const result = requireGuildMember(mockMember, "test");

        // TypeScript should allow GuildMember methods after narrowing
        expect(typeof result.kick).toBe("function");
      });
    });
  });
});
