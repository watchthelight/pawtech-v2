/**
 * Pawtropolis Tech — tests/features/modmail/index.test.ts
 * WHAT: Unit tests for modmail barrel file re-exports.
 * WHY: Verify all public APIs are properly exported.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock all dependencies before importing
vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(),
    }),
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

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

vi.mock("../../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
  hasManageGuild: vi.fn(),
  isReviewer: vi.fn(),
  canRunAllCommands: vi.fn(),
}));

vi.mock("../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 6)),
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

vi.mock("../../../src/lib/syncMarker.js", () => ({
  touchSyncMarker: vi.fn(),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

describe("features/modmail/index", () => {
  describe("ticket exports", () => {
    it("exports createTicket", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.createTicket).toBe("function");
    });

    it("exports getOpenTicketByUser", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.getOpenTicketByUser).toBe("function");
    });

    it("exports getTicketByThread", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.getTicketByThread).toBe("function");
    });

    it("exports getTicketById", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.getTicketById).toBe("function");
    });

    it("exports findModmailTicketForApplication", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.findModmailTicketForApplication).toBe("function");
    });

    it("exports updateTicketThread", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.updateTicketThread).toBe("function");
    });

    it("exports closeTicket", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.closeTicket).toBe("function");
    });

    it("exports reopenTicket", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.reopenTicket).toBe("function");
    });

    it("exports insertModmailMessage", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.insertModmailMessage).toBe("function");
    });

    it("exports getThreadIdForDmReply", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.getThreadIdForDmReply).toBe("function");
    });

    it("exports getDmIdForThreadReply", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.getDmIdForThreadReply).toBe("function");
    });
  });

  describe("transcript exports", () => {
    it("exports appendTranscript", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.appendTranscript).toBe("function");
    });

    it("exports getTranscriptBuffer", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.getTranscriptBuffer).toBe("function");
    });

    it("exports clearTranscriptBuffer", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.clearTranscriptBuffer).toBe("function");
    });

    it("exports formatTranscript", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.formatTranscript).toBe("function");
    });

    it("exports formatContentWithAttachments", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.formatContentWithAttachments).toBe("function");
    });

    it("exports flushTranscript", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.flushTranscript).toBe("function");
    });
  });

  describe("routing exports", () => {
    it("exports buildStaffToUserEmbed", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.buildStaffToUserEmbed).toBe("function");
    });

    it("exports buildUserToStaffEmbed", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.buildUserToStaffEmbed).toBe("function");
    });

    it("exports isForwarded", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.isForwarded).toBe("function");
    });

    it("exports markForwarded", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.markForwarded).toBe("function");
    });

    it("exports routeThreadToDm", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.routeThreadToDm).toBe("function");
    });

    it("exports routeDmToThread", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.routeDmToThread).toBe("function");
    });

    it("exports handleInboundDmForModmail", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.handleInboundDmForModmail).toBe("function");
    });

    it("exports handleInboundThreadMessageForModmail", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.handleInboundThreadMessageForModmail).toBe("function");
    });
  });

  describe("thread operation exports", () => {
    it("exports OPEN_MODMAIL_THREADS", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(modmail.OPEN_MODMAIL_THREADS).toBeDefined();
      expect(modmail.OPEN_MODMAIL_THREADS instanceof Set).toBe(true);
    });

    it("exports hydrateOpenModmailThreadsOnStartup", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.hydrateOpenModmailThreadsOnStartup).toBe("function");
    });

    it("exports retrofitAllGuildsOnStartup", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.retrofitAllGuildsOnStartup).toBe("function");
    });

    it("exports retrofitModmailParentsForGuild", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.retrofitModmailParentsForGuild).toBe("function");
    });

    it("exports ensureParentPermsForMods", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.ensureParentPermsForMods).toBe("function");
    });

    it("exports openPublicModmailThreadFor", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.openPublicModmailThreadFor).toBe("function");
    });

    it("exports closeModmailThread", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.closeModmailThread).toBe("function");
    });

    it("exports reopenModmailThread", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.reopenModmailThread).toBe("function");
    });

    it("exports closeModmailForApplication", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.closeModmailForApplication).toBe("function");
    });
  });

  describe("handler exports", () => {
    it("exports handleModmailOpenButton", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.handleModmailOpenButton).toBe("function");
    });

    it("exports handleModmailCloseButton", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.handleModmailCloseButton).toBe("function");
    });

    it("exports handleModmailContextMenu", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.handleModmailContextMenu).toBe("function");
    });
  });

  describe("command exports", () => {
    it("exports modmailCommand", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(modmail.modmailCommand).toBeDefined();
    });

    it("exports executeModmailCommand", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(typeof modmail.executeModmailCommand).toBe("function");
    });

    it("exports modmailContextMenu", async () => {
      const modmail = await import("../../../src/features/modmail/index.js");
      expect(modmail.modmailContextMenu).toBeDefined();
    });
  });
});
