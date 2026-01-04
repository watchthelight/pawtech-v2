/**
 * Pawtropolis Tech — tests/commands/gate/shared.test.ts
 * WHAT: Unit tests for shared gate command exports.
 * WHY: Verify all expected exports are available and correctly re-exported.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";

// Import the module to verify exports exist
import * as shared from "../../../src/commands/gate/shared.js";

describe("commands/gate/shared", () => {
  describe("exports", () => {
    it("exports requireStaff", () => {
      expect(shared.requireStaff).toBeDefined();
      expect(typeof shared.requireStaff).toBe("function");
    });

    it("exports requireGatekeeper", () => {
      expect(shared.requireGatekeeper).toBeDefined();
      expect(typeof shared.requireGatekeeper).toBe("function");
    });

    it("exports getConfig", () => {
      expect(shared.getConfig).toBeDefined();
      expect(typeof shared.getConfig).toBe("function");
    });

    it("exports findAppByShortCode", () => {
      expect(shared.findAppByShortCode).toBeDefined();
      expect(typeof shared.findAppByShortCode).toBe("function");
    });

    it("exports findPendingAppByUserId", () => {
      expect(shared.findPendingAppByUserId).toBeDefined();
      expect(typeof shared.findPendingAppByUserId).toBe("function");
    });

    it("exports ensureReviewMessage", () => {
      expect(shared.ensureReviewMessage).toBeDefined();
      expect(typeof shared.ensureReviewMessage).toBe("function");
    });

    it("exports approveTx", () => {
      expect(shared.approveTx).toBeDefined();
      expect(typeof shared.approveTx).toBe("function");
    });

    it("exports approveFlow", () => {
      expect(shared.approveFlow).toBeDefined();
      expect(typeof shared.approveFlow).toBe("function");
    });

    it("exports deliverApprovalDm", () => {
      expect(shared.deliverApprovalDm).toBeDefined();
      expect(typeof shared.deliverApprovalDm).toBe("function");
    });

    it("exports updateReviewActionMeta", () => {
      expect(shared.updateReviewActionMeta).toBeDefined();
      expect(typeof shared.updateReviewActionMeta).toBe("function");
    });

    it("exports kickTx", () => {
      expect(shared.kickTx).toBeDefined();
      expect(typeof shared.kickTx).toBe("function");
    });

    it("exports kickFlow", () => {
      expect(shared.kickFlow).toBeDefined();
      expect(typeof shared.kickFlow).toBe("function");
    });

    it("exports rejectTx", () => {
      expect(shared.rejectTx).toBeDefined();
      expect(typeof shared.rejectTx).toBe("function");
    });

    it("exports rejectFlow", () => {
      expect(shared.rejectFlow).toBeDefined();
      expect(typeof shared.rejectFlow).toBe("function");
    });

    it("exports getClaim", () => {
      expect(shared.getClaim).toBeDefined();
      expect(typeof shared.getClaim).toBe("function");
    });

    it("exports clearClaim", () => {
      expect(shared.clearClaim).toBeDefined();
      expect(typeof shared.clearClaim).toBe("function");
    });

    it("exports claimGuard", () => {
      expect(shared.claimGuard).toBeDefined();
      expect(typeof shared.claimGuard).toBe("function");
    });

    it("exports CLAIMED_MESSAGE", () => {
      expect(shared.CLAIMED_MESSAGE).toBeDefined();
      expect(typeof shared.CLAIMED_MESSAGE).toBe("function");
    });

    it("exports postWelcomeCard", () => {
      expect(shared.postWelcomeCard).toBeDefined();
      expect(typeof shared.postWelcomeCard).toBe("function");
    });

    it("exports closeModmailForApplication", () => {
      expect(shared.closeModmailForApplication).toBeDefined();
      expect(typeof shared.closeModmailForApplication).toBe("function");
    });

    it("exports ensureDeferred", () => {
      expect(shared.ensureDeferred).toBeDefined();
      expect(typeof shared.ensureDeferred).toBe("function");
    });

    it("exports replyOrEdit", () => {
      expect(shared.replyOrEdit).toBeDefined();
      expect(typeof shared.replyOrEdit).toBe("function");
    });

    it("exports shortCode", () => {
      expect(shared.shortCode).toBeDefined();
      expect(typeof shared.shortCode).toBe("function");
    });

    it("exports logger", () => {
      expect(shared.logger).toBeDefined();
      expect(typeof shared.logger).toBe("object");
    });
  });
});
