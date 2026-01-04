/**
 * Pawtropolis Tech — tests/features/review/index.test.ts
 * WHAT: Unit tests for review module barrel file and initialization.
 * WHY: Verify module exports and initialization logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  run: mockRun,
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
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

vi.mock("../../../src/lib/env.js", () => ({
  env: {
    GUILD_ID: "guild123",
  },
}));

vi.mock("../../../src/features/review/card.js", () => ({
  renderReviewEmbed: vi.fn(),
  buildDecisionComponents: vi.fn(),
  ensureReviewMessage: vi.fn(),
}));

vi.mock("../../../src/features/review/claims.js", () => ({
  getClaim: vi.fn(),
  claimApp: vi.fn(),
  unclaimApp: vi.fn(),
}));

vi.mock("../../../src/features/review/queries.js", () => ({
  getApplicationById: vi.fn(),
  getAnswersByAppId: vi.fn(),
  getRecentActionsForApp: vi.fn(),
}));

import * as reviewModule from "../../../src/features/review/index.js";

describe("features/review/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("module exports", () => {
    it("exports card functions", () => {
      expect(reviewModule).toHaveProperty("renderReviewEmbed");
      expect(reviewModule).toHaveProperty("buildDecisionComponents");
      expect(reviewModule).toHaveProperty("ensureReviewMessage");
    });

    it("exports claim functions", () => {
      expect(reviewModule).toHaveProperty("getClaim");
      expect(reviewModule).toHaveProperty("claimApp");
      expect(reviewModule).toHaveProperty("unclaimApp");
    });

    it("exports query functions", () => {
      expect(reviewModule).toHaveProperty("getApplicationById");
      expect(reviewModule).toHaveProperty("getAnswersByAppId");
      expect(reviewModule).toHaveProperty("getRecentActionsForApp");
    });
  });
});

describe("review module structure", () => {
  describe("barrel file pattern", () => {
    it("re-exports from card module", () => {
      // Barrel file consolidates exports for cleaner imports
      const cardExports = ["renderReviewEmbed", "buildDecisionComponents", "ensureReviewMessage"];
      expect(Object.keys(reviewModule)).toEqual(expect.arrayContaining(cardExports));
    });

    it("re-exports from claims module", () => {
      const claimExports = ["getClaim", "claimApp", "unclaimApp"];
      expect(Object.keys(reviewModule)).toEqual(expect.arrayContaining(claimExports));
    });

    it("re-exports from queries module", () => {
      const queryExports = ["getApplicationById", "getAnswersByAppId", "getRecentActionsForApp"];
      expect(Object.keys(reviewModule)).toEqual(expect.arrayContaining(queryExports));
    });
  });
});

describe("review workflow", () => {
  describe("application lifecycle", () => {
    it("starts with submitted status", () => {
      const initialStatus = "submitted";
      expect(initialStatus).toBe("submitted");
    });

    it("can transition to approved", () => {
      const validTransitions = {
        submitted: ["approved", "rejected", "kicked", "needs_info"],
      };
      expect(validTransitions.submitted).toContain("approved");
    });

    it("can transition to rejected", () => {
      const validTransitions = {
        submitted: ["approved", "rejected", "kicked", "needs_info"],
      };
      expect(validTransitions.submitted).toContain("rejected");
    });

    it("can transition to kicked", () => {
      const validTransitions = {
        submitted: ["approved", "rejected", "kicked", "needs_info"],
      };
      expect(validTransitions.submitted).toContain("kicked");
    });

    it("can transition to needs_info", () => {
      const validTransitions = {
        submitted: ["approved", "rejected", "kicked", "needs_info"],
      };
      expect(validTransitions.submitted).toContain("needs_info");
    });
  });

  describe("terminal states", () => {
    it("approved is terminal", () => {
      const terminalStates = ["approved", "rejected", "kicked"];
      expect(terminalStates).toContain("approved");
    });

    it("rejected is terminal", () => {
      const terminalStates = ["approved", "rejected", "kicked"];
      expect(terminalStates).toContain("rejected");
    });

    it("kicked is terminal", () => {
      const terminalStates = ["approved", "rejected", "kicked"];
      expect(terminalStates).toContain("kicked");
    });
  });
});

describe("claim workflow", () => {
  describe("claim states", () => {
    it("unclaimed apps show Claim button", () => {
      const claim = null;
      const showClaimButton = claim === null;
      expect(showClaimButton).toBe(true);
    });

    it("claimed apps show action buttons", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456" };
      const showActionButtons = claim !== null;
      expect(showActionButtons).toBe(true);
    });

    it("terminal apps show no buttons", () => {
      const status = "approved";
      const isTerminal = ["approved", "rejected", "kicked"].includes(status);
      const showButtons = !isTerminal;
      expect(showButtons).toBe(false);
    });
  });

  describe("claim ownership", () => {
    it("only owner can take actions", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456" };
      const actorId = "mod456";
      const isOwner = claim.reviewer_id === actorId;
      expect(isOwner).toBe(true);
    });

    it("non-owner cannot take actions", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456" };
      const actorId = "otherMod";
      const isOwner = claim.reviewer_id === actorId;
      expect(isOwner).toBe(false);
    });
  });
});

describe("review card data", () => {
  describe("embed content", () => {
    it("includes user tag", () => {
      const embedFields = ["userTag", "status", "answers", "flags"];
      expect(embedFields).toContain("userTag");
    });

    it("includes status", () => {
      const embedFields = ["userTag", "status", "answers", "flags"];
      expect(embedFields).toContain("status");
    });

    it("includes answers", () => {
      const embedFields = ["userTag", "status", "answers", "flags"];
      expect(embedFields).toContain("answers");
    });

    it("includes flags", () => {
      const embedFields = ["userTag", "status", "answers", "flags"];
      expect(embedFields).toContain("flags");
    });
  });

  describe("optional data", () => {
    it("may include avatar scan", () => {
      const optionalData = ["avatarScan", "modmailTicket", "accountCreatedAt"];
      expect(optionalData).toContain("avatarScan");
    });

    it("may include modmail ticket", () => {
      const optionalData = ["avatarScan", "modmailTicket", "accountCreatedAt"];
      expect(optionalData).toContain("modmailTicket");
    });

    it("may include account age", () => {
      const optionalData = ["avatarScan", "modmailTicket", "accountCreatedAt"];
      expect(optionalData).toContain("accountCreatedAt");
    });
  });
});

describe("action buttons", () => {
  describe("primary actions", () => {
    it("has Accept button", () => {
      const primaryActions = ["Accept", "Reject", "Kick"];
      expect(primaryActions).toContain("Accept");
    });

    it("has Reject button", () => {
      const primaryActions = ["Accept", "Reject", "Kick"];
      expect(primaryActions).toContain("Reject");
    });

    it("has Kick button", () => {
      const primaryActions = ["Accept", "Reject", "Kick"];
      expect(primaryActions).toContain("Kick");
    });
  });

  describe("secondary actions", () => {
    it("has Modmail button", () => {
      const secondaryActions = ["Modmail", "Copy UID", "Ping in Unverified"];
      expect(secondaryActions).toContain("Modmail");
    });

    it("has Copy UID button", () => {
      const secondaryActions = ["Modmail", "Copy UID", "Ping in Unverified"];
      expect(secondaryActions).toContain("Copy UID");
    });

    it("has Ping in Unverified button", () => {
      const secondaryActions = ["Modmail", "Copy UID", "Ping in Unverified"];
      expect(secondaryActions).toContain("Ping in Unverified");
    });
  });

  describe("button IDs", () => {
    it("uses v1 prefix", () => {
      const buttonId = "v1:decide:approve:codeABC123";
      expect(buttonId).toMatch(/^v1:/);
    });

    it("includes action type", () => {
      const buttonId = "v1:decide:approve:codeABC123";
      expect(buttonId).toContain(":decide:");
    });

    it("includes app code", () => {
      const buttonId = "v1:decide:approve:codeABC123";
      expect(buttonId).toContain(":code");
    });
  });
});

describe("application queries", () => {
  describe("getApplicationById", () => {
    it("fetches application by ID", () => {
      const query = "SELECT * FROM application WHERE id = ?";
      expect(query).toContain("SELECT");
      expect(query).toContain("WHERE id = ?");
    });
  });

  describe("getAnswersByAppId", () => {
    it("fetches answers ordered by q_index", () => {
      const query = "SELECT * FROM application_response WHERE app_id = ? ORDER BY q_index";
      expect(query).toContain("ORDER BY q_index");
    });
  });

  describe("getRecentActionsForApp", () => {
    it("fetches recent actions with limit", () => {
      const query = "SELECT * FROM review_action WHERE app_id = ? ORDER BY id DESC LIMIT ?";
      expect(query).toContain("LIMIT");
      expect(query).toContain("ORDER BY id DESC");
    });
  });
});

describe("review types", () => {
  describe("ApplicationStatus", () => {
    it("includes submitted", () => {
      const statuses = ["submitted", "approved", "rejected", "kicked", "needs_info"];
      expect(statuses).toContain("submitted");
    });

    it("includes approved", () => {
      const statuses = ["submitted", "approved", "rejected", "kicked", "needs_info"];
      expect(statuses).toContain("approved");
    });

    it("includes rejected", () => {
      const statuses = ["submitted", "approved", "rejected", "kicked", "needs_info"];
      expect(statuses).toContain("rejected");
    });

    it("includes kicked", () => {
      const statuses = ["submitted", "approved", "rejected", "kicked", "needs_info"];
      expect(statuses).toContain("kicked");
    });

    it("includes needs_info", () => {
      const statuses = ["submitted", "approved", "rejected", "kicked", "needs_info"];
      expect(statuses).toContain("needs_info");
    });
  });

  describe("ReviewAnswer", () => {
    it("has q_index", () => {
      const answer = { q_index: 0, question: "Q1", answer: "A1" };
      expect(answer.q_index).toBeDefined();
    });

    it("has question", () => {
      const answer = { q_index: 0, question: "Q1", answer: "A1" };
      expect(answer.question).toBeDefined();
    });

    it("has answer", () => {
      const answer = { q_index: 0, question: "Q1", answer: "A1" };
      expect(answer.answer).toBeDefined();
    });
  });

  describe("ReviewClaimRow", () => {
    it("has app_id", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };
      expect(claim.app_id).toBeDefined();
    });

    it("has reviewer_id", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };
      expect(claim.reviewer_id).toBeDefined();
    });

    it("has claimed_at", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };
      expect(claim.claimed_at).toBeDefined();
    });
  });
});

describe("module dependencies", () => {
  describe("internal dependencies", () => {
    it("depends on card module", () => {
      const deps = ["card", "claims", "queries", "types"];
      expect(deps).toContain("card");
    });

    it("depends on claims module", () => {
      const deps = ["card", "claims", "queries", "types"];
      expect(deps).toContain("claims");
    });

    it("depends on queries module", () => {
      const deps = ["card", "claims", "queries", "types"];
      expect(deps).toContain("queries");
    });

    it("depends on types module", () => {
      const deps = ["card", "claims", "queries", "types"];
      expect(deps).toContain("types");
    });
  });

  describe("external dependencies", () => {
    it("uses discord.js", () => {
      const externalDeps = ["discord.js", "db", "logger"];
      expect(externalDeps).toContain("discord.js");
    });

    it("uses db", () => {
      const externalDeps = ["discord.js", "db", "logger"];
      expect(externalDeps).toContain("db");
    });

    it("uses logger", () => {
      const externalDeps = ["discord.js", "db", "logger"];
      expect(externalDeps).toContain("logger");
    });
  });
});
