/**
 * Pawtropolis Tech — tests/features/artistRotation/constants.test.ts
 * WHAT: Unit tests for artist rotation constants and config accessors.
 * WHY: Verify config retrieval, fallback behavior, and type safety.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getConfig before importing the module under test
const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

vi.mock("../../../src/lib/config.js", () => ({
  getConfig: mockGetConfig,
}));

import {
  ARTIST_ROLE_ID,
  AMBASSADOR_ROLE_ID,
  SERVER_ARTIST_CHANNEL_ID,
  TICKET_ROLES,
  TICKET_ROLE_NAMES,
  ART_TYPES,
  ART_TYPE_DISPLAY,
  getIgnoredArtistUsers,
  getArtistConfig,
  getArtistRoleId,
  getAmbassadorRoleId,
  getTicketRoles,
  type ArtistRotationConfig,
  type TicketRolesConfig,
  type ArtType,
} from "../../../src/features/artistRotation/constants.js";

describe("artistRotation/constants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("exported constants", () => {
    it("exports ARTIST_ROLE_ID as a string", () => {
      expect(typeof ARTIST_ROLE_ID).toBe("string");
      expect(ARTIST_ROLE_ID).toBe("896070888749940770");
    });

    it("exports AMBASSADOR_ROLE_ID as a string", () => {
      expect(typeof AMBASSADOR_ROLE_ID).toBe("string");
      expect(AMBASSADOR_ROLE_ID).toBe("896070888762535967");
    });

    it("exports SERVER_ARTIST_CHANNEL_ID as a string", () => {
      expect(typeof SERVER_ARTIST_CHANNEL_ID).toBe("string");
      expect(SERVER_ARTIST_CHANNEL_ID).toBe("1131332813585661982");
    });

    it("exports TICKET_ROLES with all art types", () => {
      expect(TICKET_ROLES).toHaveProperty("headshot");
      expect(TICKET_ROLES).toHaveProperty("halfbody");
      expect(TICKET_ROLES).toHaveProperty("emoji");
      expect(TICKET_ROLES).toHaveProperty("fullbody");
    });

    it("exports TICKET_ROLE_NAMES mapping role IDs to display names", () => {
      expect(TICKET_ROLE_NAMES["929950578379993108"]).toBe("OC Headshot Ticket");
      expect(TICKET_ROLE_NAMES["1402298352560902224"]).toBe("OC Half-body Ticket");
      expect(TICKET_ROLE_NAMES["1414982808631377971"]).toBe("OC Emoji Ticket");
      expect(TICKET_ROLE_NAMES["1449799905421033595"]).toBe("OC Full-body Ticket");
    });

    it("exports ART_TYPES array with all valid types", () => {
      expect(ART_TYPES).toContain("headshot");
      expect(ART_TYPES).toContain("halfbody");
      expect(ART_TYPES).toContain("emoji");
      expect(ART_TYPES).toContain("fullbody");
      expect(ART_TYPES).toHaveLength(4);
    });

    it("exports ART_TYPE_DISPLAY with human-readable names", () => {
      expect(ART_TYPE_DISPLAY.headshot).toBe("OC Headshot");
      expect(ART_TYPE_DISPLAY.halfbody).toBe("OC Half-body");
      expect(ART_TYPE_DISPLAY.emoji).toBe("OC Emoji");
      expect(ART_TYPE_DISPLAY.fullbody).toBe("OC Full-body");
    });
  });

  describe("getIgnoredArtistUsers", () => {
    it("returns fallback set when no config exists", () => {
      mockGetConfig.mockReturnValue(null);

      const result = getIgnoredArtistUsers("guild-123");

      expect(result).toBeInstanceOf(Set);
      expect(result.has("840832083084836942")).toBe(true);
      expect(mockGetConfig).toHaveBeenCalledWith("guild-123");
    });

    it("returns fallback set when config has no artist_ignored_users_json", () => {
      mockGetConfig.mockReturnValue({});

      const result = getIgnoredArtistUsers("guild-123");

      expect(result).toBeInstanceOf(Set);
      expect(result.has("840832083084836942")).toBe(true);
    });

    it("parses valid JSON array from config", () => {
      mockGetConfig.mockReturnValue({
        artist_ignored_users_json: JSON.stringify(["user-1", "user-2", "user-3"]),
      });

      const result = getIgnoredArtistUsers("guild-123");

      expect(result).toBeInstanceOf(Set);
      expect(result.has("user-1")).toBe(true);
      expect(result.has("user-2")).toBe(true);
      expect(result.has("user-3")).toBe(true);
      expect(result.size).toBe(3);
    });

    it("returns fallback when JSON is invalid", () => {
      mockGetConfig.mockReturnValue({
        artist_ignored_users_json: "not valid json",
      });

      const result = getIgnoredArtistUsers("guild-123");

      expect(result).toBeInstanceOf(Set);
      expect(result.has("840832083084836942")).toBe(true);
    });

    it("returns fallback when JSON is not an array", () => {
      mockGetConfig.mockReturnValue({
        artist_ignored_users_json: JSON.stringify({ user: "123" }),
      });

      const result = getIgnoredArtistUsers("guild-123");

      expect(result).toBeInstanceOf(Set);
      expect(result.has("840832083084836942")).toBe(true);
    });

    it("returns empty set for empty array in config", () => {
      mockGetConfig.mockReturnValue({
        artist_ignored_users_json: JSON.stringify([]),
      });

      const result = getIgnoredArtistUsers("guild-123");

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });

  describe("getArtistConfig", () => {
    it("returns fallback config when no guild config exists", () => {
      mockGetConfig.mockReturnValue(null);

      const result = getArtistConfig("guild-123");

      expect(result.artistRoleId).toBe(ARTIST_ROLE_ID);
      expect(result.ambassadorRoleId).toBe(AMBASSADOR_ROLE_ID);
      expect(result.serverArtistChannelId).toBe(SERVER_ARTIST_CHANNEL_ID);
      expect(result.ticketRoles).toEqual(TICKET_ROLES);
    });

    it("returns fallback config when guild config is empty", () => {
      mockGetConfig.mockReturnValue({});

      const result = getArtistConfig("guild-123");

      expect(result.artistRoleId).toBe(ARTIST_ROLE_ID);
      expect(result.ambassadorRoleId).toBe(AMBASSADOR_ROLE_ID);
      expect(result.serverArtistChannelId).toBe(SERVER_ARTIST_CHANNEL_ID);
    });

    it("uses guild-specific artist_role_id when provided", () => {
      mockGetConfig.mockReturnValue({
        artist_role_id: "custom-artist-role",
      });

      const result = getArtistConfig("guild-123");

      expect(result.artistRoleId).toBe("custom-artist-role");
      expect(result.ambassadorRoleId).toBe(AMBASSADOR_ROLE_ID);
    });

    it("uses guild-specific ambassador_role_id when provided", () => {
      mockGetConfig.mockReturnValue({
        ambassador_role_id: "custom-ambassador-role",
      });

      const result = getArtistConfig("guild-123");

      expect(result.ambassadorRoleId).toBe("custom-ambassador-role");
    });

    it("uses guild-specific server_artist_channel_id when provided", () => {
      mockGetConfig.mockReturnValue({
        server_artist_channel_id: "custom-channel",
      });

      const result = getArtistConfig("guild-123");

      expect(result.serverArtistChannelId).toBe("custom-channel");
    });

    it("parses valid ticket_roles_json and merges with defaults", () => {
      mockGetConfig.mockReturnValue({
        artist_ticket_roles_json: JSON.stringify({
          headshot: "custom-headshot-role",
          emoji: "custom-emoji-role",
        }),
      });

      const result = getArtistConfig("guild-123");

      expect(result.ticketRoles.headshot).toBe("custom-headshot-role");
      expect(result.ticketRoles.emoji).toBe("custom-emoji-role");
      expect(result.ticketRoles.halfbody).toBe(TICKET_ROLES.halfbody);
      expect(result.ticketRoles.fullbody).toBe(TICKET_ROLES.fullbody);
    });

    it("falls back to defaults when ticket_roles_json is invalid", () => {
      mockGetConfig.mockReturnValue({
        artist_ticket_roles_json: "invalid json",
      });

      const result = getArtistConfig("guild-123");

      expect(result.ticketRoles).toEqual(TICKET_ROLES);
    });

    it("handles null values in ticket_roles_json", () => {
      mockGetConfig.mockReturnValue({
        artist_ticket_roles_json: JSON.stringify({
          headshot: null,
          halfbody: "custom-halfbody",
        }),
      });

      const result = getArtistConfig("guild-123");

      expect(result.ticketRoles.headshot).toBe(TICKET_ROLES.headshot);
      expect(result.ticketRoles.halfbody).toBe("custom-halfbody");
    });

    it("combines all custom config values", () => {
      mockGetConfig.mockReturnValue({
        artist_role_id: "custom-artist",
        ambassador_role_id: "custom-ambassador",
        server_artist_channel_id: "custom-channel",
        artist_ticket_roles_json: JSON.stringify({
          headshot: "custom-headshot",
          halfbody: "custom-halfbody",
          emoji: "custom-emoji",
          fullbody: "custom-fullbody",
        }),
      });

      const result = getArtistConfig("guild-123");

      expect(result.artistRoleId).toBe("custom-artist");
      expect(result.ambassadorRoleId).toBe("custom-ambassador");
      expect(result.serverArtistChannelId).toBe("custom-channel");
      expect(result.ticketRoles.headshot).toBe("custom-headshot");
      expect(result.ticketRoles.halfbody).toBe("custom-halfbody");
      expect(result.ticketRoles.emoji).toBe("custom-emoji");
      expect(result.ticketRoles.fullbody).toBe("custom-fullbody");
    });
  });

  describe("getArtistRoleId", () => {
    it("returns fallback when no config", () => {
      mockGetConfig.mockReturnValue(null);

      const result = getArtistRoleId("guild-123");

      expect(result).toBe(ARTIST_ROLE_ID);
    });

    it("returns custom role ID from config", () => {
      mockGetConfig.mockReturnValue({
        artist_role_id: "custom-role-id",
      });

      const result = getArtistRoleId("guild-123");

      expect(result).toBe("custom-role-id");
    });
  });

  describe("getAmbassadorRoleId", () => {
    it("returns fallback when no config", () => {
      mockGetConfig.mockReturnValue(null);

      const result = getAmbassadorRoleId("guild-123");

      expect(result).toBe(AMBASSADOR_ROLE_ID);
    });

    it("returns custom role ID from config", () => {
      mockGetConfig.mockReturnValue({
        ambassador_role_id: "custom-ambassador",
      });

      const result = getAmbassadorRoleId("guild-123");

      expect(result).toBe("custom-ambassador");
    });
  });

  describe("getTicketRoles", () => {
    it("returns fallback ticket roles when no config", () => {
      mockGetConfig.mockReturnValue(null);

      const result = getTicketRoles("guild-123");

      expect(result).toEqual(TICKET_ROLES);
    });

    it("returns merged ticket roles from config", () => {
      mockGetConfig.mockReturnValue({
        artist_ticket_roles_json: JSON.stringify({
          headshot: "custom-headshot",
        }),
      });

      const result = getTicketRoles("guild-123");

      expect(result.headshot).toBe("custom-headshot");
      expect(result.halfbody).toBe(TICKET_ROLES.halfbody);
    });
  });

  describe("type exports", () => {
    it("ArtType includes all valid art types", () => {
      const validTypes: ArtType[] = ["headshot", "halfbody", "emoji", "fullbody"];
      expect(validTypes).toHaveLength(4);
    });

    it("TicketRolesConfig has correct shape", () => {
      const config: TicketRolesConfig = {
        headshot: "role-1",
        halfbody: "role-2",
        emoji: null,
        fullbody: "role-4",
      };
      expect(config.headshot).toBe("role-1");
      expect(config.emoji).toBeNull();
    });

    it("ArtistRotationConfig has correct shape", () => {
      const config: ArtistRotationConfig = {
        artistRoleId: "artist",
        ambassadorRoleId: "ambassador",
        serverArtistChannelId: "channel",
        ticketRoles: {
          headshot: "h",
          halfbody: "hb",
          emoji: "e",
          fullbody: "fb",
        },
      };
      expect(config.artistRoleId).toBe("artist");
    });
  });
});
