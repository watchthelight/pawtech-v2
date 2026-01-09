/**
 * Pawtropolis Tech — tests/features/artistRotation/index.test.ts
 * WHAT: Unit tests for artist rotation barrel file exports.
 * WHY: Verify all modules are properly re-exported.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock all the dependencies to avoid import errors
vi.mock("../../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    }),
    transaction: vi.fn((fn) => fn),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(),
}));

vi.mock("../../../src/features/artJobs/index.js", () => ({
  createJob: vi.fn(),
}));

vi.mock("discord.js", () => ({
  EmbedBuilder: class {
    setTitle() { return this; }
    setColor() { return this; }
    setDescription() { return this; }
  },
}));

describe("artistRotation/index", () => {
  it("exports all expected modules", async () => {
    const exports = await import("../../../src/features/artistRotation/index.js");

    // From constants.ts
    expect(exports).toHaveProperty("ARTIST_ROLE_ID");
    expect(exports).toHaveProperty("AMBASSADOR_ROLE_ID");
    expect(exports).toHaveProperty("SERVER_ARTIST_CHANNEL_ID");
    expect(exports).toHaveProperty("TICKET_ROLES");
    expect(exports).toHaveProperty("TICKET_ROLE_NAMES");
    expect(exports).toHaveProperty("ART_TYPES");
    expect(exports).toHaveProperty("ART_TYPE_DISPLAY");
    expect(exports).toHaveProperty("getIgnoredArtistUsers");
    expect(exports).toHaveProperty("getArtistConfig");
    expect(exports).toHaveProperty("getArtistRoleId");
    expect(exports).toHaveProperty("getAmbassadorRoleId");
    expect(exports).toHaveProperty("getTicketRoles");

    // From queue.ts
    expect(exports).toHaveProperty("getQueueLength");
    expect(exports).toHaveProperty("addArtist");
    expect(exports).toHaveProperty("removeArtist");
    expect(exports).toHaveProperty("getArtist");
    expect(exports).toHaveProperty("getAllArtists");
    expect(exports).toHaveProperty("getNextArtist");
    expect(exports).toHaveProperty("moveToPosition");
    expect(exports).toHaveProperty("skipArtist");
    expect(exports).toHaveProperty("unskipArtist");
    expect(exports).toHaveProperty("incrementAssignments");
    expect(exports).toHaveProperty("processAssignment");
    expect(exports).toHaveProperty("logAssignment");
    expect(exports).toHaveProperty("getAssignmentHistory");
    expect(exports).toHaveProperty("getArtistStats");
    expect(exports).toHaveProperty("syncWithRoleMembers");

    // From roleSync.ts
    expect(exports).toHaveProperty("handleArtistRoleAdded");
    expect(exports).toHaveProperty("handleArtistRoleRemoved");
    expect(exports).toHaveProperty("detectArtistRoleChange");
    expect(exports).toHaveProperty("handleArtistRoleChange");

    // From handlers.ts
    expect(exports).toHaveProperty("handleRedeemRewardButton");
    expect(exports).toHaveProperty("isRedeemRewardButton");
  });

  it("exports constants with correct values", async () => {
    const exports = await import("../../../src/features/artistRotation/index.js");

    expect(typeof exports.ARTIST_ROLE_ID).toBe("string");
    expect(typeof exports.AMBASSADOR_ROLE_ID).toBe("string");
    expect(typeof exports.SERVER_ARTIST_CHANNEL_ID).toBe("string");
    expect(Array.isArray(exports.ART_TYPES)).toBe(true);
    expect(exports.ART_TYPES).toContain("headshot");
  });

  it("exports functions that are callable", async () => {
    const exports = await import("../../../src/features/artistRotation/index.js");

    expect(typeof exports.getIgnoredArtistUsers).toBe("function");
    expect(typeof exports.getArtistConfig).toBe("function");
    expect(typeof exports.addArtist).toBe("function");
    expect(typeof exports.removeArtist).toBe("function");
    expect(typeof exports.handleArtistRoleChange).toBe("function");
    expect(typeof exports.isRedeemRewardButton).toBe("function");
  });
});
