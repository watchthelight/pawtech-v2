/**
 * Pawtropolis Tech — tests/lib/modalPatterns.test.ts
 * WHAT: Unit tests for component ID patterns and routing.
 * WHY: Verify regex patterns and modal route identification.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import {
  MODAL_PAGE_RE,
  BTN_DECIDE_RE,
  BTN_MODMAIL_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_PING_UNVERIFIED_RE,
  BTN_DBRECOVER_RE,
  BTN_AUDIT_MEMBERS_RE,
  BTN_AUDIT_NSFW_RE,
  BTN_AUDIT_RE,
  MODAL_REJECT_RE,
  MODAL_PERM_REJECT_RE,
  MODAL_ACCEPT_RE,
  MODAL_KICK_RE,
  MODAL_UNCLAIM_RE,
  MODAL_18_RE,
  identifyModalRoute,
} from "../../src/lib/modalPatterns.js";

describe("modalPatterns", () => {
  describe("MODAL_PAGE_RE", () => {
    it("matches valid modal page IDs", () => {
      expect("v1:modal:session123:p0").toMatch(MODAL_PAGE_RE);
      expect("v1:modal:abc-def:p5").toMatch(MODAL_PAGE_RE);
      expect("v1:modal:12345:p99").toMatch(MODAL_PAGE_RE);
    });

    it("extracts session ID and page index", () => {
      const match = "v1:modal:session123:p0".match(MODAL_PAGE_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("session123");
      expect(match![2]).toBe("0");
    });

    it("does not match invalid formats", () => {
      expect("modal:session123:p0").not.toMatch(MODAL_PAGE_RE);
      expect("v1:modal:session123").not.toMatch(MODAL_PAGE_RE);
      expect("v1:modal:session:with:colons:p0").not.toMatch(MODAL_PAGE_RE);
      expect("v1:modal::p0").not.toMatch(MODAL_PAGE_RE);
    });
  });

  describe("BTN_DECIDE_RE", () => {
    it("matches approve button IDs", () => {
      expect("v1:decide:approve:code98FF66").toMatch(BTN_DECIDE_RE);
      expect("review:approve:code98FF66").toMatch(BTN_DECIDE_RE);
    });

    it("matches accept button IDs (legacy)", () => {
      expect("v1:decide:accept:codeAABBCC").toMatch(BTN_DECIDE_RE);
      expect("review:accept:codeAABBCC").toMatch(BTN_DECIDE_RE);
    });

    it("matches reject button IDs", () => {
      expect("v1:decide:reject:code112233").toMatch(BTN_DECIDE_RE);
      expect("review:reject:code112233").toMatch(BTN_DECIDE_RE);
    });

    it("matches kick button IDs", () => {
      expect("v1:decide:kick:codeFFEEDD").toMatch(BTN_DECIDE_RE);
    });

    it("matches claim/unclaim button IDs", () => {
      expect("v1:decide:claim:code123456").toMatch(BTN_DECIDE_RE);
      expect("v1:decide:unclaim:code654321").toMatch(BTN_DECIDE_RE);
    });

    it("extracts action and code", () => {
      const match = "v1:decide:approve:code98FF66".match(BTN_DECIDE_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("approve");
      expect(match![2]).toBe("98FF66");
    });

    it("requires valid hex code", () => {
      expect("v1:decide:approve:code98FF6").not.toMatch(BTN_DECIDE_RE); // Too short
      expect("v1:decide:approve:code98FF66G").not.toMatch(BTN_DECIDE_RE); // Invalid char
      expect("v1:decide:approve:code98ff66").not.toMatch(BTN_DECIDE_RE); // Lowercase
    });

    it("does not match unknown actions", () => {
      expect("v1:decide:unknown:code98FF66").not.toMatch(BTN_DECIDE_RE);
    });
  });

  describe("BTN_MODMAIL_RE", () => {
    it("matches modmail button IDs", () => {
      expect("v1:decide:modmail:code98FF66").toMatch(BTN_MODMAIL_RE);
      expect("review:modmail:codeAABBCC").toMatch(BTN_MODMAIL_RE);
    });

    it("extracts code", () => {
      const match = "v1:decide:modmail:code98FF66".match(BTN_MODMAIL_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("98FF66");
    });
  });

  describe("BTN_PERM_REJECT_RE", () => {
    it("matches permanent reject button IDs", () => {
      expect("v1:decide:permreject:code98FF66").toMatch(BTN_PERM_REJECT_RE);
      expect("v1:decide:perm_reject:code98FF66").toMatch(BTN_PERM_REJECT_RE);
      expect("review:permreject:codeAABBCC").toMatch(BTN_PERM_REJECT_RE);
    });

    it("extracts action and code", () => {
      const match = "v1:decide:permreject:code98FF66".match(BTN_PERM_REJECT_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("permreject");
      expect(match![2]).toBe("98FF66");
    });
  });

  describe("BTN_COPY_UID_RE", () => {
    it("matches copy user ID button IDs", () => {
      expect("v1:decide:copyuid:code98FF66:user123456789").toMatch(BTN_COPY_UID_RE);
      expect("review:copy_uid:codeAABBCC:user987654321").toMatch(BTN_COPY_UID_RE);
    });

    it("extracts code and user ID", () => {
      const match = "v1:decide:copyuid:code98FF66:user123456789".match(BTN_COPY_UID_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("98FF66");
      expect(match![2]).toBe("123456789");
    });
  });

  describe("BTN_PING_UNVERIFIED_RE", () => {
    it("matches ping unverified button IDs", () => {
      expect("v1:ping:code98FF66:user123456789").toMatch(BTN_PING_UNVERIFIED_RE);
      expect("review:ping_unverified:codeAABBCC:user987654321").toMatch(BTN_PING_UNVERIFIED_RE);
    });

    it("matches without code prefix", () => {
      expect("v1:ping:98FF66:user123456789").toMatch(BTN_PING_UNVERIFIED_RE);
    });

    it("extracts code and user ID", () => {
      const match = "v1:ping:code98FF66:user123456789".match(BTN_PING_UNVERIFIED_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("98FF66");
      expect(match![2]).toBe("123456789");
    });
  });

  describe("BTN_DBRECOVER_RE", () => {
    it("matches database recovery button IDs", () => {
      expect("dbrecover:validate:backup-2024-01-15:ab12cd34").toMatch(BTN_DBRECOVER_RE);
      expect("dbrecover:restore-dry:backup-123:12345678").toMatch(BTN_DBRECOVER_RE);
      expect("dbrecover:restore-confirm:backup-abc:ffffffff").toMatch(BTN_DBRECOVER_RE);
    });

    it("extracts action, backup ID, and nonce", () => {
      const match = "dbrecover:validate:backup-2024-01-15:ab12cd34".match(BTN_DBRECOVER_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("validate");
      expect(match![2]).toBe("backup-2024-01-15");
      expect(match![3]).toBe("ab12cd34");
    });

    it("does not match v1 prefix", () => {
      expect("v1:dbrecover:validate:backup:12345678").not.toMatch(BTN_DBRECOVER_RE);
    });
  });

  describe("BTN_AUDIT_MEMBERS_RE", () => {
    it("matches audit members confirm/cancel buttons", () => {
      expect("audit:members:confirm:ab12cd34").toMatch(BTN_AUDIT_MEMBERS_RE);
      expect("audit:members:cancel:12345678").toMatch(BTN_AUDIT_MEMBERS_RE);
    });

    it("extracts action and nonce", () => {
      const match = "audit:members:confirm:ab12cd34".match(BTN_AUDIT_MEMBERS_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("confirm");
      expect(match![2]).toBe("ab12cd34");
    });
  });

  describe("BTN_AUDIT_NSFW_RE", () => {
    it("matches audit NSFW buttons", () => {
      expect("audit:nsfw:all:confirm:ab12cd34").toMatch(BTN_AUDIT_NSFW_RE);
      expect("audit:nsfw:flagged:cancel:12345678").toMatch(BTN_AUDIT_NSFW_RE);
    });

    it("extracts scope, action, and nonce", () => {
      const match = "audit:nsfw:all:confirm:ab12cd34".match(BTN_AUDIT_NSFW_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("all");
      expect(match![2]).toBe("confirm");
      expect(match![3]).toBe("ab12cd34");
    });
  });

  describe("BTN_AUDIT_RE", () => {
    it("matches any audit button", () => {
      expect("audit:members:confirm:ab12cd34").toMatch(BTN_AUDIT_RE);
      expect("audit:nsfw:all:confirm:ab12cd34").toMatch(BTN_AUDIT_RE);
    });

    it("extracts audit type", () => {
      const match = "audit:members:confirm:ab12cd34".match(BTN_AUDIT_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("members");
    });
  });

  describe("MODAL_REJECT_RE", () => {
    it("matches reject modal IDs", () => {
      expect("v1:modal:reject:code98FF66").toMatch(MODAL_REJECT_RE);
    });

    it("extracts code", () => {
      const match = "v1:modal:reject:code98FF66".match(MODAL_REJECT_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("98FF66");
    });
  });

  describe("MODAL_PERM_REJECT_RE", () => {
    it("matches permanent reject modal IDs", () => {
      expect("v1:modal:permreject:code98FF66").toMatch(MODAL_PERM_REJECT_RE);
    });
  });

  describe("MODAL_ACCEPT_RE", () => {
    it("matches accept modal IDs", () => {
      expect("v1:modal:accept:code98FF66").toMatch(MODAL_ACCEPT_RE);
    });
  });

  describe("MODAL_KICK_RE", () => {
    it("matches kick modal IDs", () => {
      expect("v1:modal:kick:code98FF66").toMatch(MODAL_KICK_RE);
    });
  });

  describe("MODAL_UNCLAIM_RE", () => {
    it("matches unclaim modal IDs", () => {
      expect("v1:modal:unclaim:code98FF66").toMatch(MODAL_UNCLAIM_RE);
    });
  });

  describe("MODAL_18_RE", () => {
    it("matches age verification modal IDs", () => {
      expect("v1:avatar:confirm18:code98FF66").toMatch(MODAL_18_RE);
    });

    it("extracts code", () => {
      const match = "v1:avatar:confirm18:code98FF66".match(MODAL_18_RE);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("98FF66");
    });
  });

  describe("identifyModalRoute", () => {
    describe("gate_submit_page", () => {
      it("routes page modal submissions", () => {
        const route = identifyModalRoute("v1:modal:session123:p0");
        expect(route).toEqual({
          type: "gate_submit_page",
          sessionId: "session123",
          pageIndex: 0,
        });
      });

      it("handles multi-digit page numbers", () => {
        const route = identifyModalRoute("v1:modal:abc:p12");
        expect(route).toEqual({
          type: "gate_submit_page",
          sessionId: "abc",
          pageIndex: 12,
        });
      });
    });

    describe("review_reject", () => {
      it("routes reject modal submissions", () => {
        const route = identifyModalRoute("v1:modal:reject:code98FF66");
        expect(route).toEqual({
          type: "review_reject",
          code: "98FF66",
        });
      });
    });

    describe("review_perm_reject", () => {
      it("routes permanent reject modal submissions", () => {
        const route = identifyModalRoute("v1:modal:permreject:codeAABBCC");
        expect(route).toEqual({
          type: "review_perm_reject",
          code: "AABBCC",
        });
      });
    });

    describe("review_accept", () => {
      it("routes accept modal submissions", () => {
        const route = identifyModalRoute("v1:modal:accept:code112233");
        expect(route).toEqual({
          type: "review_accept",
          code: "112233",
        });
      });
    });

    describe("review_kick", () => {
      it("routes kick modal submissions", () => {
        const route = identifyModalRoute("v1:modal:kick:codeFFEEDD");
        expect(route).toEqual({
          type: "review_kick",
          code: "FFEEDD",
        });
      });
    });

    describe("review_unclaim", () => {
      it("routes unclaim modal submissions", () => {
        const route = identifyModalRoute("v1:modal:unclaim:code123456");
        expect(route).toEqual({
          type: "review_unclaim",
          code: "123456",
        });
      });
    });

    describe("avatar_confirm18", () => {
      it("routes age verification modal submissions", () => {
        const route = identifyModalRoute("v1:avatar:confirm18:codeABCDEF");
        expect(route).toEqual({
          type: "avatar_confirm18",
          code: "ABCDEF",
        });
      });
    });

    describe("unknown modal", () => {
      it("returns null for unrecognized formats", () => {
        expect(identifyModalRoute("unknown:modal:id")).toBeNull();
        expect(identifyModalRoute("v2:modal:reject:code98FF66")).toBeNull();
        expect(identifyModalRoute("")).toBeNull();
        expect(identifyModalRoute("v1:modal")).toBeNull();
      });
    });
  });
});
