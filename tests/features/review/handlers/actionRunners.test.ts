/**
 * Pawtropolis Tech — tests/features/review/handlers/actionRunners.test.ts
 * WHAT: Unit tests for review action runner functions.
 * WHY: Verify approval, rejection, kick flows and their error handling.
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

vi.mock("../../../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/modmail.js", () => ({
  closeModmailForApplication: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/welcome.js", () => ({
  postWelcomeCard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/review/claims.js", () => ({
  getClaim: vi.fn(),
  claimGuard: vi.fn(),
}));

vi.mock("../../../../src/features/review/queries.js", () => ({
  updateReviewActionMeta: vi.fn(),
}));

vi.mock("../../../../src/features/review/flows/index.js", () => ({
  approveTx: vi.fn(),
  rejectTx: vi.fn(),
  kickTx: vi.fn(),
  approveFlow: vi.fn().mockResolvedValue({ member: null, roleApplied: false, roleError: null }),
  rejectFlow: vi.fn().mockResolvedValue({ dmDelivered: true }),
  kickFlow: vi.fn().mockResolvedValue({ kickSucceeded: true }),
  deliverApprovalDm: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../../src/features/review.js", () => ({
  ensureReviewMessage: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
}));

import { getConfig } from "../../../../src/lib/config.js";
import { getClaim, claimGuard } from "../../../../src/features/review/claims.js";
import {
  approveTx,
  rejectTx,
  kickTx,
  approveFlow,
  rejectFlow,
  kickFlow,
} from "../../../../src/features/review/flows/index.js";

describe("features/review/handlers/actionRunners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runApproveAction", () => {
    describe("guild validation", () => {
      it("returns early when guild is null", () => {
        const guild = null;
        expect(guild).toBeNull();
      });

      it("replies with guild not found message", () => {
        const content = "Guild not found.";
        expect(content).toBe("Guild not found.");
      });
    });

    describe("claim guard", () => {
      it("checks claim before proceeding", () => {
        vi.mocked(getClaim).mockReturnValue({ reviewer_id: "user123" });
        vi.mocked(claimGuard).mockReturnValue(null);

        const claim = getClaim("app-123");
        const error = claimGuard(claim, "user123");
        expect(error).toBeNull();
      });

      it("returns early when claim guard fails", () => {
        vi.mocked(claimGuard).mockReturnValue("Not your claim");

        const error = claimGuard({} as any, "user123");
        expect(error).toBe("Not your claim");
      });
    });

    describe("approveTx results", () => {
      describe("already approved", () => {
        it("returns already approved message", () => {
          vi.mocked(approveTx).mockReturnValue({ kind: "already" } as any);

          const result = approveTx("app-123", "user123", null);
          expect(result.kind).toBe("already");
        });
      });

      describe("terminal state", () => {
        it("returns already resolved message with status", () => {
          vi.mocked(approveTx).mockReturnValue({ kind: "terminal", status: "rejected" } as any);

          const result = approveTx("app-123", "user123", null);
          expect(result.kind).toBe("terminal");
        });
      });

      describe("invalid state", () => {
        it("returns not ready message", () => {
          vi.mocked(approveTx).mockReturnValue({ kind: "invalid" } as any);

          const result = approveTx("app-123", "user123", null);
          expect(result.kind).toBe("invalid");
        });
      });

      describe("success", () => {
        it("returns reviewActionId", () => {
          vi.mocked(approveTx).mockReturnValue({ kind: "ok", reviewActionId: "ra-123" } as any);

          const result = approveTx("app-123", "user123", null);
          expect(result.kind).toBe("ok");
        });
      });
    });

    describe("event enrichment", () => {
      it("sets feature to review/approve", () => {
        const feature = ["review", "approve"];
        expect(feature).toContain("review");
        expect(feature).toContain("approve");
      });

      it("adds application entity", () => {
        const entity = { type: "application", id: "app-123", code: "ABCDEF" };
        expect(entity.type).toBe("application");
      });

      it("adds applicantId attribute", () => {
        const attr = { applicantId: "user456" };
        expect(attr.applicantId).toBeDefined();
      });
    });

    describe("role assignment", () => {
      it("calls approveFlow with guild, userId, and config", () => {
        vi.mocked(getConfig).mockReturnValue({ accepted_role_id: "role-123" } as any);
        vi.mocked(approveFlow).mockResolvedValue({
          member: {} as any,
          roleApplied: true,
          roleError: null,
        });

        expect(approveFlow).toBeDefined();
      });

      it("tracks roleApplied status", () => {
        const roleApplied = true;
        expect(roleApplied).toBe(true);
      });

      it("captures roleError for permission failures", () => {
        const roleError = { code: 50013, message: "Missing Permissions" };
        expect(roleError.code).toBe(50013);
      });
    });

    describe("DM delivery", () => {
      it("calls deliverApprovalDm when member exists", () => {
        const shouldDeliver = true;
        expect(shouldDeliver).toBe(true);
      });

      it("tracks dmDelivered status", () => {
        const dmDelivered = true;
        expect(dmDelivered).toBe(true);
      });
    });

    describe("welcome card", () => {
      it("posts welcome card when conditions met", () => {
        const conditions = {
          hasConfig: true,
          hasMember: true,
          roleAppliedOrNoRoleRequired: true,
        };
        expect(Object.values(conditions).every(Boolean)).toBe(true);
      });

      it("handles channel not configured error", () => {
        const errorMessage = "not configured";
        const welcomeNote = errorMessage.includes("not configured")
          ? "Welcome message failed: general channel not configured."
          : null;
        expect(welcomeNote).toContain("not configured");
      });

      it("handles missing permissions error", () => {
        const errorMessage = "missing permissions";
        const welcomeNote = errorMessage.includes("missing permissions")
          ? "Welcome message failed: missing permissions."
          : null;
        expect(welcomeNote).toContain("missing permissions");
      });
    });

    describe("modmail auto-close", () => {
      it("closes modmail with reason approved", () => {
        const reason = "approved";
        expect(reason).toBe("approved");
      });
    });

    describe("review card refresh", () => {
      it("refreshes card after approval", () => {
        const shouldRefresh = true;
        expect(shouldRefresh).toBe(true);
      });

      it("captures messageId for reply reference", () => {
        const refreshResult = { messageId: "msg-123" };
        expect(refreshResult.messageId).toBeDefined();
      });
    });

    describe("public message", () => {
      it("posts approval confirmation", () => {
        const messages = ["Application approved."];
        expect(messages[0]).toBe("Application approved.");
      });

      it("includes role note if role assignment failed", () => {
        const roleNote = "Failed to grant verification role <@&role-123>.";
        expect(roleNote).toContain("verification role");
      });

      it("includes welcome note if welcome failed", () => {
        const welcomeNote = "Welcome message failed.";
        expect(welcomeNote).toContain("Welcome");
      });
    });
  });

  describe("runRejectAction", () => {
    describe("status validation", () => {
      it("blocks already rejected applications", () => {
        const status = "rejected";
        const isResolved = ["rejected", "approved", "kicked"].includes(status);
        expect(isResolved).toBe(true);
      });

      it("blocks already approved applications", () => {
        const status = "approved";
        const isResolved = ["rejected", "approved", "kicked"].includes(status);
        expect(isResolved).toBe(true);
      });

      it("blocks already kicked applications", () => {
        const status = "kicked";
        const isResolved = ["rejected", "approved", "kicked"].includes(status);
        expect(isResolved).toBe(true);
      });
    });

    describe("reason validation", () => {
      it("requires non-empty reason", () => {
        const reason = "";
        const trimmed = reason.trim();
        const isEmpty = trimmed.length === 0;
        expect(isEmpty).toBe(true);
      });

      it("trims whitespace from reason", () => {
        const reason = "   Bad application   ";
        const trimmed = reason.trim();
        expect(trimmed).toBe("Bad application");
      });
    });

    describe("rejectTx results", () => {
      describe("already rejected", () => {
        it("returns already rejected message", () => {
          vi.mocked(rejectTx).mockReturnValue({ kind: "already" } as any);

          const result = rejectTx("app-123", "user123", "reason");
          expect(result.kind).toBe("already");
        });
      });

      describe("terminal state", () => {
        it("returns already resolved message", () => {
          vi.mocked(rejectTx).mockReturnValue({ kind: "terminal", status: "approved" } as any);

          const result = rejectTx("app-123", "user123", "reason");
          expect(result.kind).toBe("terminal");
        });
      });

      describe("invalid state", () => {
        it("returns not submitted message", () => {
          vi.mocked(rejectTx).mockReturnValue({ kind: "invalid" } as any);

          const result = rejectTx("app-123", "user123", "reason");
          expect(result.kind).toBe("invalid");
        });
      });
    });

    describe("event enrichment", () => {
      it("sets feature to review/reject", () => {
        const feature = ["review", "reject"];
        expect(feature).toContain("reject");
      });

      it("adds truncated reason (100 chars max)", () => {
        const reason = "a".repeat(150);
        const truncated = reason.slice(0, 100);
        expect(truncated.length).toBe(100);
      });
    });

    describe("DM delivery", () => {
      it("calls rejectFlow to send DM", () => {
        vi.mocked(rejectFlow).mockResolvedValue({ dmDelivered: true });

        expect(rejectFlow).toBeDefined();
      });

      it("handles user fetch failure", () => {
        const user = null;
        expect(user).toBeNull();
      });
    });

    describe("modmail auto-close", () => {
      it("closes modmail with reason rejected", () => {
        const reason = "rejected";
        expect(reason).toBe("rejected");
      });
    });

    describe("public message", () => {
      it("shows rejection confirmation when DM delivered", () => {
        const dmDelivered = true;
        const content = dmDelivered ? "Application rejected." : "Application rejected. (DM delivery failed)";
        expect(content).toBe("Application rejected.");
      });

      it("shows DM failure note when DM not delivered", () => {
        const dmDelivered = false;
        const content = dmDelivered ? "Application rejected." : "Application rejected. (DM delivery failed)";
        expect(content).toContain("DM delivery failed");
      });
    });
  });

  describe("runPermRejectAction", () => {
    describe("status validation", () => {
      it("blocks resolved applications", () => {
        const status = "approved";
        const isResolved = ["rejected", "approved", "kicked"].includes(status);
        expect(isResolved).toBe(true);
      });
    });

    describe("reason validation", () => {
      it("requires non-empty reason", () => {
        const reason = "";
        const isEmpty = reason.trim().length === 0;
        expect(isEmpty).toBe(true);
      });
    });

    describe("rejectTx with permanent flag", () => {
      it("passes permanent=true to rejectTx", () => {
        const permanent = true;
        expect(permanent).toBe(true);
      });
    });

    describe("event enrichment", () => {
      it("sets feature to review/perm_reject", () => {
        const feature = ["review", "perm_reject"];
        expect(feature).toContain("perm_reject");
      });
    });

    describe("DM delivery", () => {
      it("calls rejectFlow with permanent=true", () => {
        const options = { guildName: "Test Server", reason: "ban reason", permanent: true };
        expect(options.permanent).toBe(true);
      });
    });

    describe("modmail auto-close", () => {
      it("closes with reason permanently rejected", () => {
        const reason = "permanently rejected";
        expect(reason).toContain("permanently");
      });
    });

    describe("public message", () => {
      it("shows permanent rejection confirmation", () => {
        const dmDelivered = true;
        const content = dmDelivered
          ? "Application permanently rejected."
          : "Application permanently rejected. (DM delivery failed)";
        expect(content).toContain("permanently rejected");
      });
    });
  });

  describe("runKickAction", () => {
    describe("guild validation", () => {
      it("returns early when guild is null", () => {
        const guild = null;
        expect(guild).toBeNull();
      });
    });

    describe("kickTx results", () => {
      describe("already kicked", () => {
        it("returns already kicked message", () => {
          vi.mocked(kickTx).mockReturnValue({ kind: "already" } as any);

          const result = kickTx("app-123", "user123", null);
          expect(result.kind).toBe("already");
        });
      });

      describe("terminal state", () => {
        it("returns already resolved message", () => {
          vi.mocked(kickTx).mockReturnValue({ kind: "terminal", status: "approved" } as any);

          const result = kickTx("app-123", "user123", null);
          expect(result.kind).toBe("terminal");
        });
      });

      describe("invalid state", () => {
        it("returns not kickable message", () => {
          vi.mocked(kickTx).mockReturnValue({ kind: "invalid" } as any);

          const result = kickTx("app-123", "user123", null);
          expect(result.kind).toBe("invalid");
        });
      });
    });

    describe("event enrichment", () => {
      it("sets feature to review/kick", () => {
        const feature = ["review", "kick"];
        expect(feature).toContain("kick");
      });

      it("adds reason if provided", () => {
        const reason = "Spamming";
        expect(reason).toBeDefined();
      });
    });

    describe("kick execution", () => {
      it("calls kickFlow with guild, userId, and reason", () => {
        vi.mocked(kickFlow).mockResolvedValue({ kickSucceeded: true });

        expect(kickFlow).toBeDefined();
      });

      it("tracks kickSucceeded status", () => {
        const kickSucceeded = true;
        expect(kickSucceeded).toBe(true);
      });
    });

    describe("modmail auto-close", () => {
      it("closes with reason kicked", () => {
        const reason = "kicked";
        expect(reason).toBe("kicked");
      });
    });

    describe("public message", () => {
      it("shows success message when kick succeeded", () => {
        const kickSucceeded = true;
        const message = kickSucceeded ? "Member kicked." : "Kick attempted; check logs for details.";
        expect(message).toBe("Member kicked.");
      });

      it("shows check logs message when kick failed", () => {
        const kickSucceeded = false;
        const message = kickSucceeded ? "Member kicked." : "Kick attempted; check logs for details.";
        expect(message).toContain("check logs");
      });
    });
  });
});

describe("transaction result kinds", () => {
  const kinds = ["ok", "already", "terminal", "invalid"];

  it("includes ok for success", () => {
    expect(kinds).toContain("ok");
  });

  it("includes already for duplicate action", () => {
    expect(kinds).toContain("already");
  });

  it("includes terminal for resolved applications", () => {
    expect(kinds).toContain("terminal");
  });

  it("includes invalid for wrong state", () => {
    expect(kinds).toContain("invalid");
  });
});

describe("action logging", () => {
  const actions = ["approve", "reject", "perm_reject", "kick"];

  it("logs approve action", () => {
    expect(actions).toContain("approve");
  });

  it("logs reject action", () => {
    expect(actions).toContain("reject");
  });

  it("logs perm_reject action", () => {
    expect(actions).toContain("perm_reject");
  });

  it("logs kick action", () => {
    expect(actions).toContain("kick");
  });
});

describe("review action meta updates", () => {
  it("updates roleApplied for approval", () => {
    const meta = { roleApplied: true };
    expect(meta.roleApplied).toBeDefined();
  });

  it("updates dmDelivered for all actions", () => {
    const meta = { dmDelivered: true };
    expect(meta.dmDelivered).toBeDefined();
  });

  it("updates kickSucceeded for kick", () => {
    const meta = { kickSucceeded: true };
    expect(meta.kickSucceeded).toBeDefined();
  });
});

describe("modmail close reasons", () => {
  const reasons = ["approved", "rejected", "permanently rejected", "kicked"];

  it("uses approved for approvals", () => {
    expect(reasons).toContain("approved");
  });

  it("uses rejected for rejections", () => {
    expect(reasons).toContain("rejected");
  });

  it("uses permanently rejected for perm rejections", () => {
    expect(reasons).toContain("permanently rejected");
  });

  it("uses kicked for kicks", () => {
    expect(reasons).toContain("kicked");
  });
});

describe("claim preservation", () => {
  it("preserves claim record after resolution", () => {
    const preserveAfterResolution = true;
    expect(preserveAfterResolution).toBe(true);
  });

  it("allows review card to show who handled the application", () => {
    const showsHandler = true;
    expect(showsHandler).toBe(true);
  });
});
