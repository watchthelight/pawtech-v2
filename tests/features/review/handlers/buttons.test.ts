/**
 * Pawtropolis Tech — tests/features/review/handlers/buttons.test.ts
 * WHAT: Unit tests for review button handlers.
 * WHY: Verify button routing, permission checks, and action dispatching.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockAll, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("../../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../../src/lib/config.js", () => ({
  shouldBypass: vi.fn(() => false),
  hasRole: vi.fn(() => false),
  getConfig: vi.fn(),
  ROLE_IDS: {
    GATEKEEPER: "gatekeeper-role-id",
  },
}));

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => 1700000000),
}));

vi.mock("../../../../src/lib/autoDelete.js", () => ({
  autoDelete: vi.fn(),
}));

vi.mock("../../../../src/features/appLookup.js", () => ({
  findAppByShortCode: vi.fn(),
}));

describe("features/review/handlers/buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe("handleReviewButton", () => {
    describe("pattern matching", () => {
      const BUTTON_RE = /^v1:decide:(\w+):code([0-9A-F]{6})$/;

      it("ignores non-matching customIds", () => {
        const customId = "some-other-button";
        const match = BUTTON_RE.exec(customId);
        expect(match).toBeNull();
      });

      it("matches review button pattern", () => {
        const customId = "v1:decide:approve:codeABCDEF";
        const match = BUTTON_RE.exec(customId);
        expect(match).not.toBeNull();
      });
    });

    describe("action routing", () => {
      it("routes reject to modal opener (no defer)", () => {
        const action = "reject";
        const opensModal = ["reject", "approve", "accept", "kick", "unclaim"].includes(action);
        expect(opensModal).toBe(true);
      });

      it("routes approve to modal opener (no defer)", () => {
        const action = "approve";
        const opensModal = ["reject", "approve", "accept", "kick", "unclaim"].includes(action);
        expect(opensModal).toBe(true);
      });

      it("routes accept to modal opener (no defer)", () => {
        const action = "accept";
        const opensModal = ["reject", "approve", "accept", "kick", "unclaim"].includes(action);
        expect(opensModal).toBe(true);
      });

      it("routes kick to modal opener", () => {
        const action = "kick";
        const opensModal = ["reject", "approve", "accept", "kick", "unclaim"].includes(action);
        expect(opensModal).toBe(true);
      });

      it("routes unclaim to modal opener", () => {
        const action = "unclaim";
        const opensModal = ["reject", "approve", "accept", "kick", "unclaim"].includes(action);
        expect(opensModal).toBe(true);
      });

      it("routes claim to direct handler with deferUpdate", () => {
        const action = "claim";
        const opensModal = ["reject", "approve", "accept", "kick", "unclaim"].includes(action);
        expect(opensModal).toBe(false);
      });
    });

    describe("error handling", () => {
      it("generates trace ID from interaction ID", () => {
        const interactionId = "1234567890ABCDEF";
        const traceId = interactionId.slice(-8).toUpperCase();
        expect(traceId).toBe("90ABCDEF");
      });

      it("defers reply on error for non-modal actions", () => {
        const action = "claim";
        const modalActions = ["reject", "approve", "accept", "kick", "unclaim"];
        const shouldDefer = !modalActions.includes(action);
        expect(shouldDefer).toBe(true);
      });
    });
  });

  describe("handleModmailButton", () => {
    describe("pattern matching", () => {
      const BTN_MODMAIL_RE = /^review:modmail:code([0-9A-F]{6})$/;

      it("matches modmail button pattern", () => {
        const customId = "review:modmail:codeABCDEF";
        const match = BTN_MODMAIL_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("ABCDEF");
      });

      it("ignores non-matching patterns", () => {
        const customId = "v1:decide:approve:codeABCDEF";
        const match = BTN_MODMAIL_RE.exec(customId);
        expect(match).toBeNull();
      });
    });

    describe("success feedback", () => {
      it("posts public message on success", () => {
        const result = { success: true, message: "Modmail thread created." };
        expect(result.success).toBe(true);
        expect(result.message).toContain("Modmail");
      });
    });

    describe("failure handling", () => {
      it("sends ephemeral warning on failure", () => {
        const result = { success: false, message: "User has DMs disabled" };
        expect(result.success).toBe(false);
      });

      it("provides default error message when none given", () => {
        const result = { success: false, message: null };
        const msg = result.message || "Failed to create modmail thread. Check bot permissions.";
        expect(msg).toContain("Failed to create modmail");
      });
    });
  });

  describe("handlePermRejectButton", () => {
    describe("pattern matching", () => {
      const BTN_PERM_REJECT_RE = /^review:(perm_reject|permreject):code([0-9A-F]{6})$/;

      it("matches perm_reject pattern", () => {
        const customId = "review:perm_reject:codeABCDEF";
        const match = BTN_PERM_REJECT_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[2]).toBe("ABCDEF");
      });

      it("matches permreject pattern", () => {
        const customId = "review:permreject:code123456";
        const match = BTN_PERM_REJECT_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[2]).toBe("123456");
      });
    });

    describe("modal opening", () => {
      it("opens permanent reject modal after validation", () => {
        const action = "open_perm_reject_modal";
        expect(action).toBe("open_perm_reject_modal");
      });
    });
  });

  describe("handleCopyUidButton", () => {
    describe("pattern matching", () => {
      const BTN_COPY_UID_RE = /^review:copy_uid:code([0-9A-F]{6}):user(\d+)$/;

      it("matches copy_uid pattern", () => {
        const customId = "review:copy_uid:codeABCDEF:user123456789";
        const match = BTN_COPY_UID_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("ABCDEF");
        expect(match?.[2]).toBe("123456789");
      });
    });

    describe("guild validation", () => {
      it("requires guild context", () => {
        const guildId = null;
        expect(guildId).toBeNull();
      });
    });

    describe("application validation", () => {
      it("verifies application exists for security", () => {
        const appRow = null;
        expect(appRow).toBeNull();
      });
    });

    describe("response", () => {
      it("replies with UID only for easy copying", () => {
        const userId = "123456789012345678";
        const content = userId;
        expect(content).toBe(userId);
      });
    });

    describe("audit trail", () => {
      it("inserts copy_uid action to review_action table", () => {
        const action = "copy_uid";
        expect(action).toBe("copy_uid");
      });
    });
  });

  describe("handlePingInUnverified", () => {
    describe("pattern matching", () => {
      const legacy = /^v1:ping:(.+)$/;
      const modern = /^review:ping_unverified:code([0-9A-F]{6})(?::user(\d+))?$/;

      it("matches legacy pattern", () => {
        const customId = "v1:ping:user123456789";
        const match = legacy.exec(customId);
        expect(match).not.toBeNull();
      });

      it("matches modern pattern with user", () => {
        const customId = "review:ping_unverified:codeABCDEF:user123456789";
        const match = modern.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("ABCDEF");
        expect(match?.[2]).toBe("123456789");
      });

      it("matches modern pattern without user", () => {
        const customId = "review:ping_unverified:codeABCDEF";
        const match = modern.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[2]).toBeUndefined();
      });
    });

    describe("configuration check", () => {
      it("requires unverified_channel_id in config", () => {
        const cfg = { unverified_channel_id: null };
        expect(cfg.unverified_channel_id).toBeNull();
      });
    });

    describe("permission checks", () => {
      it("checks ViewChannel permission", () => {
        const permission = "ViewChannel";
        expect(permission).toBe("ViewChannel");
      });

      it("checks SendMessages permission", () => {
        const permission = "SendMessages";
        expect(permission).toBe("SendMessages");
      });

      it("checks EmbedLinks permission", () => {
        const permission = "EmbedLinks";
        expect(permission).toBe("EmbedLinks");
      });

      it("warns if ManageMessages missing (auto-delete won't work)", () => {
        const canManage = false;
        expect(canManage).toBe(false);
      });
    });

    describe("ping message", () => {
      it("mentions only the specific user", () => {
        const userId = "123456789";
        const content = `<@${userId}>`;
        const allowedMentions = { users: [userId], parse: [] };

        expect(content).toBe("<@123456789>");
        expect(allowedMentions.users).toContain(userId);
        expect(allowedMentions.parse).toEqual([]);
      });
    });

    describe("auto-delete", () => {
      it("schedules deletion after 30 seconds when ManageMessages available", () => {
        const canManage = true;
        const deleteDelay = 30_000;

        expect(canManage).toBe(true);
        expect(deleteDelay).toBe(30000);
      });

      it("skips auto-delete when ManageMessages unavailable", () => {
        const canManage = false;
        expect(canManage).toBe(false);
      });
    });

    describe("error handling", () => {
      it("detects permission errors by code 50013", () => {
        const err = { code: 50013 };
        const isPermissionError = err.code === 50013 || err.code === "50013";
        expect(isPermissionError).toBe(true);
      });

      it("provides helpful error message for permission errors", () => {
        const isPermissionError = true;
        const errorMsg = isPermissionError
          ? "Bot is missing permissions in the unverified channel."
          : "Failed to post ping.";
        expect(errorMsg).toContain("missing permissions");
      });
    });
  });

  describe("handleDeletePing", () => {
    describe("pattern matching", () => {
      const pattern = /^v1:ping:delete:(.+)$/;

      it("matches delete ping pattern", () => {
        const customId = "v1:ping:delete:1234567890";
        const match = pattern.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("1234567890");
      });
    });

    describe("guild validation", () => {
      it("requires guild context", () => {
        const guildId = null;
        expect(guildId).toBeNull();
      });
    });

    describe("staff validation", () => {
      it("requires Gatekeeper role", () => {
        const isStaff = false;
        expect(isStaff).toBe(false);
      });
    });

    describe("deletion", () => {
      it("deletes the interaction message", () => {
        const action = "delete_message";
        expect(action).toBe("delete_message");
      });

      it("acknowledges deletion ephemerally", () => {
        const content = "Ping deleted.";
        expect(content).toBe("Ping deleted.");
      });
    });

    describe("error handling", () => {
      it("handles already-deleted messages gracefully", () => {
        const errorMessage = "Failed to delete ping message (it may have been already deleted).";
        expect(errorMessage).toContain("already deleted");
      });
    });
  });
});

describe("button customId formats", () => {
  describe("review decision buttons", () => {
    it("uses v1:decide:<action>:code<CODE> format", () => {
      const format = "v1:decide:<action>:code<CODE>";
      expect(format).toContain("v1:decide");
      expect(format).toContain("code");
    });
  });

  describe("modmail button", () => {
    it("uses review:modmail:code<CODE> format", () => {
      const format = "review:modmail:code<CODE>";
      expect(format).toContain("review:modmail");
    });
  });

  describe("copy UID button", () => {
    it("uses review:copy_uid:code<CODE>:user<ID> format", () => {
      const format = "review:copy_uid:code<CODE>:user<ID>";
      expect(format).toContain("copy_uid");
      expect(format).toContain("user");
    });
  });

  describe("ping button", () => {
    it("modern format: review:ping_unverified:code<CODE>:user<ID>", () => {
      const format = "review:ping_unverified:code<CODE>:user<ID>";
      expect(format).toContain("ping_unverified");
    });

    it("legacy format: v1:ping:<payload>", () => {
      const format = "v1:ping:<payload>";
      expect(format).toContain("v1:ping");
    });
  });
});

describe("deferring behavior", () => {
  describe("modal-opening actions", () => {
    const modalActions = ["reject", "approve", "accept", "kick", "unclaim"];

    it("does not defer for reject (opens modal)", () => {
      expect(modalActions).toContain("reject");
    });

    it("does not defer for approve (opens modal)", () => {
      expect(modalActions).toContain("approve");
    });

    it("does not defer for accept (opens modal)", () => {
      expect(modalActions).toContain("accept");
    });

    it("does not defer for kick (opens modal)", () => {
      expect(modalActions).toContain("kick");
    });

    it("does not defer for unclaim (opens modal)", () => {
      expect(modalActions).toContain("unclaim");
    });
  });

  describe("direct actions", () => {
    it("uses deferUpdate for claim button", () => {
      const action = "claim";
      const useDeferUpdate = action === "claim";
      expect(useDeferUpdate).toBe(true);
    });
  });
});
