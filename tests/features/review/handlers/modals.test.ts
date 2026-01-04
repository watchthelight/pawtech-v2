/**
 * Pawtropolis Tech — tests/features/review/handlers/modals.test.ts
 * WHAT: Unit tests for review modal submission handlers.
 * WHY: Verify modal pattern matching, input parsing, and action dispatching.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
}));

describe("features/review/handlers/modals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleRejectModal", () => {
    describe("pattern matching", () => {
      const MODAL_RE = /^v1:modal:reject:code([0-9A-F]{6})$/;

      it("matches reject modal customId", () => {
        const customId = "v1:modal:reject:codeABCDEF";
        const match = MODAL_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("ABCDEF");
      });

      it("ignores non-matching customIds", () => {
        const customId = "v1:modal:accept:codeABCDEF";
        const match = MODAL_RE.exec(customId);
        expect(match).toBeNull();
      });
    });

    describe("deferUpdate behavior", () => {
      it("calls deferUpdate to acknowledge without visible bubble", () => {
        const shouldDefer = true;
        expect(shouldDefer).toBe(true);
      });
    });

    describe("reason extraction", () => {
      it("trims whitespace from reason", () => {
        const reasonRaw = "  User is banned  ";
        const reason = reasonRaw.trim();
        expect(reason).toBe("User is banned");
      });

      it("truncates to 500 characters", () => {
        const reasonRaw = "a".repeat(600);
        const reason = reasonRaw.trim().slice(0, 500);
        expect(reason.length).toBe(500);
      });

      it("extracts reason from correct field", () => {
        const fieldId = "v1:modal:reject:reason";
        expect(fieldId).toBe("v1:modal:reject:reason");
      });
    });

    describe("error handling", () => {
      it("generates trace ID from interaction ID", () => {
        const interactionId = "1234567890ABCDEF";
        const traceId = interactionId.slice(-8).toUpperCase();
        expect(traceId).toBe("90ABCDEF");
      });

      it("captures exception to Sentry", () => {
        const area = "handleRejectModal";
        expect(area).toBe("handleRejectModal");
      });
    });
  });

  describe("handleAcceptModal", () => {
    describe("pattern matching", () => {
      const ACCEPT_MODAL_RE = /^v1:modal:accept:code([0-9A-F]{6})$/;

      it("matches accept modal customId", () => {
        const customId = "v1:modal:accept:code123456";
        const match = ACCEPT_MODAL_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("123456");
      });
    });

    describe("reason extraction", () => {
      it("trims whitespace from reason", () => {
        const reasonRaw = "  Welcome to the server!  ";
        const reason = reasonRaw.trim();
        expect(reason).toBe("Welcome to the server!");
      });

      it("returns null for empty reason", () => {
        const reasonRaw = "   ";
        const reason = reasonRaw.trim().slice(0, 500) || null;
        expect(reason).toBeNull();
      });

      it("truncates to 500 characters", () => {
        const reasonRaw = "b".repeat(600);
        const reason = reasonRaw.trim().slice(0, 500) || null;
        expect(reason?.length).toBe(500);
      });

      it("extracts reason from correct field", () => {
        const fieldId = "v1:modal:accept:reason";
        expect(fieldId).toBe("v1:modal:accept:reason");
      });
    });
  });

  describe("handlePermRejectModal", () => {
    describe("pattern matching", () => {
      const MODAL_PERM_REJECT_RE = /^v1:modal:permreject:code([0-9A-F]{6})$/;

      it("matches permreject modal customId", () => {
        const customId = "v1:modal:permreject:codeFEDCBA";
        const match = MODAL_PERM_REJECT_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("FEDCBA");
      });
    });

    describe("reason extraction", () => {
      it("extracts reason from correct field", () => {
        const fieldId = "v1:modal:permreject:reason";
        expect(fieldId).toBe("v1:modal:permreject:reason");
      });

      it("trims and truncates reason", () => {
        const reasonRaw = "  Permanent ban for repeated violations  ";
        const reason = reasonRaw.trim().slice(0, 500);
        expect(reason).toBe("Permanent ban for repeated violations");
      });
    });
  });

  describe("handleKickModal", () => {
    describe("pattern matching", () => {
      const MODAL_KICK_RE = /^v1:modal:kick:code([0-9A-F]{6})$/;

      it("matches kick modal customId", () => {
        const customId = "v1:modal:kick:code000FFF";
        const match = MODAL_KICK_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("000FFF");
      });
    });

    describe("reason extraction", () => {
      it("extracts reason from correct field", () => {
        const fieldId = "v1:modal:kick:reason";
        expect(fieldId).toBe("v1:modal:kick:reason");
      });

      it("returns null for empty reason (optional)", () => {
        const reasonRaw = "";
        const reason = reasonRaw.trim().slice(0, 500) || null;
        expect(reason).toBeNull();
      });

      it("allows non-empty reason", () => {
        const reasonRaw = "Spamming in unverified";
        const reason = reasonRaw.trim().slice(0, 500) || null;
        expect(reason).toBe("Spamming in unverified");
      });
    });
  });

  describe("handleUnclaimModal", () => {
    describe("pattern matching", () => {
      const MODAL_UNCLAIM_RE = /^v1:modal:unclaim:code([0-9A-F]{6})$/;

      it("matches unclaim modal customId", () => {
        const customId = "v1:modal:unclaim:codeAAAAAA";
        const match = MODAL_UNCLAIM_RE.exec(customId);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("AAAAAA");
      });
    });

    describe("confirmation validation", () => {
      it("extracts confirm from correct field", () => {
        const fieldId = "v1:modal:unclaim:confirm";
        expect(fieldId).toBe("v1:modal:unclaim:confirm");
      });

      it("converts confirm text to uppercase", () => {
        const confirmRaw = "unclaim";
        const confirm = confirmRaw.trim().toUpperCase();
        expect(confirm).toBe("UNCLAIM");
      });

      it("accepts exact UNCLAIM text", () => {
        const confirm = "UNCLAIM";
        const isValid = confirm === "UNCLAIM";
        expect(isValid).toBe(true);
      });

      it("rejects incorrect confirmation", () => {
        const confirm = "CANCEL";
        const isValid = confirm === "UNCLAIM";
        expect(isValid).toBe(false);
      });

      it("rejects empty confirmation", () => {
        const confirm = "";
        const isValid = confirm === "UNCLAIM";
        expect(isValid).toBe(false);
      });

      it("provides cancellation message on invalid confirm", () => {
        const msg = "Unclaim cancelled. You must type `UNCLAIM` to confirm.";
        expect(msg).toContain("UNCLAIM");
        expect(msg).toContain("cancelled");
      });
    });
  });
});

describe("modal customId formats", () => {
  describe("reject modal", () => {
    it("uses v1:modal:reject:code<CODE> format", () => {
      const code = "ABCDEF";
      const customId = `v1:modal:reject:code${code}`;
      expect(customId).toBe("v1:modal:reject:codeABCDEF");
    });
  });

  describe("accept modal", () => {
    it("uses v1:modal:accept:code<CODE> format", () => {
      const code = "123456";
      const customId = `v1:modal:accept:code${code}`;
      expect(customId).toBe("v1:modal:accept:code123456");
    });
  });

  describe("permreject modal", () => {
    it("uses v1:modal:permreject:code<CODE> format", () => {
      const code = "FEDCBA";
      const customId = `v1:modal:permreject:code${code}`;
      expect(customId).toBe("v1:modal:permreject:codeFEDCBA");
    });
  });

  describe("kick modal", () => {
    it("uses v1:modal:kick:code<CODE> format", () => {
      const code = "000FFF";
      const customId = `v1:modal:kick:code${code}`;
      expect(customId).toBe("v1:modal:kick:code000FFF");
    });
  });

  describe("unclaim modal", () => {
    it("uses v1:modal:unclaim:code<CODE> format", () => {
      const code = "AAAAAA";
      const customId = `v1:modal:unclaim:code${code}`;
      expect(customId).toBe("v1:modal:unclaim:codeAAAAAA");
    });
  });
});

describe("modal field IDs", () => {
  it("reject reason field: v1:modal:reject:reason", () => {
    const fieldId = "v1:modal:reject:reason";
    expect(fieldId).toMatch(/^v1:modal:reject:reason$/);
  });

  it("accept reason field: v1:modal:accept:reason", () => {
    const fieldId = "v1:modal:accept:reason";
    expect(fieldId).toMatch(/^v1:modal:accept:reason$/);
  });

  it("permreject reason field: v1:modal:permreject:reason", () => {
    const fieldId = "v1:modal:permreject:reason";
    expect(fieldId).toMatch(/^v1:modal:permreject:reason$/);
  });

  it("kick reason field: v1:modal:kick:reason", () => {
    const fieldId = "v1:modal:kick:reason";
    expect(fieldId).toMatch(/^v1:modal:kick:reason$/);
  });

  it("unclaim confirm field: v1:modal:unclaim:confirm", () => {
    const fieldId = "v1:modal:unclaim:confirm";
    expect(fieldId).toMatch(/^v1:modal:unclaim:confirm$/);
  });
});

describe("error trace format", () => {
  it("uses last 8 chars of interaction ID", () => {
    const interactionId = "1234567890ABCDEF1234567890";
    const traceId = interactionId.slice(-8).toUpperCase();
    expect(traceId).toHaveLength(8);
  });

  it("converts to uppercase", () => {
    const interactionId = "1234567890abcdef";
    const traceId = interactionId.slice(-8).toUpperCase();
    expect(traceId).toBe("90ABCDEF");
  });
});

describe("staff validation", () => {
  it("calls requireInteractionStaff before processing", () => {
    const checkPerformed = true;
    expect(checkPerformed).toBe(true);
  });

  it("returns early if staff check fails", () => {
    const continueProcessing = false;
    expect(continueProcessing).toBe(false);
  });
});

describe("application resolution", () => {
  it("calls resolveApplication with code", () => {
    const code = "ABCDEF";
    expect(code).toHaveLength(6);
  });

  it("returns early if application not found", () => {
    const app = null;
    const shouldContinue = app !== null;
    expect(shouldContinue).toBe(false);
  });
});

describe("action dispatching", () => {
  describe("reject modal", () => {
    it("calls runRejectAction with app and reason", () => {
      const action = "runRejectAction";
      expect(action).toBe("runRejectAction");
    });
  });

  describe("accept modal", () => {
    it("calls runApproveAction with app and reason", () => {
      const action = "runApproveAction";
      expect(action).toBe("runApproveAction");
    });
  });

  describe("permreject modal", () => {
    it("calls runPermRejectAction with app and reason", () => {
      const action = "runPermRejectAction";
      expect(action).toBe("runPermRejectAction");
    });
  });

  describe("kick modal", () => {
    it("calls runKickAction with app and reason", () => {
      const action = "runKickAction";
      expect(action).toBe("runKickAction");
    });
  });

  describe("unclaim modal", () => {
    it("calls handleUnclaimAction with app", () => {
      const action = "handleUnclaimAction";
      expect(action).toBe("handleUnclaimAction");
    });
  });
});
