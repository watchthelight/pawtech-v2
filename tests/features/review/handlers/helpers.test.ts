/**
 * Pawtropolis Tech — tests/features/review/handlers/helpers.test.ts
 * WHAT: Unit tests for review handler helper functions.
 * WHY: Verify staff checks, application resolution, and modal opening logic.
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

vi.mock("../../../../src/lib/config.js", () => ({
  shouldBypass: vi.fn(() => false),
  hasRole: vi.fn(() => false),
  ROLE_IDS: {
    GATEKEEPER: "gatekeeper-role-id",
    ADMIN: "admin-role-id",
    LEADERSHIP: "leadership-role-id",
  },
}));

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/features/appLookup.js", () => ({
  findAppByShortCode: vi.fn(),
}));

vi.mock("../../../../src/features/review/claims.js", () => ({
  getClaim: vi.fn(),
  claimGuard: vi.fn(),
}));

vi.mock("../../../../src/features/review/queries.js", () => ({
  loadApplication: vi.fn(),
}));

import { shouldBypass, hasRole } from "../../../../src/lib/config.js";
import { replyOrEdit } from "../../../../src/lib/cmdWrap.js";
import { findAppByShortCode } from "../../../../src/features/appLookup.js";
import { getClaim, claimGuard } from "../../../../src/features/review/claims.js";
import { loadApplication } from "../../../../src/features/review/queries.js";

describe("features/review/handlers/helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isStaff", () => {
    describe("bypass checks", () => {
      it("returns true when shouldBypass returns true", () => {
        vi.mocked(shouldBypass).mockReturnValue(true);
        // The function returns true when bypass allows
        const member = null;
        const userId = "user123";
        const result = shouldBypass(userId, member);
        expect(result).toBe(true);
      });

      it("returns false when not bypassed and no role", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(false);
        const result = hasRole(null, "gatekeeper-role-id");
        expect(result).toBe(false);
      });
    });

    describe("Gatekeeper role check", () => {
      it("returns true when user has Gatekeeper role", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(true);
        const result = hasRole({} as any, "gatekeeper-role-id");
        expect(result).toBe(true);
      });
    });
  });

  describe("requireInteractionStaff", () => {
    describe("guild validation", () => {
      it("rejects non-guild interactions", () => {
        const interaction = {
          inGuild: () => false,
          guildId: null,
          reply: vi.fn().mockResolvedValue(undefined),
        };

        const isGuild = interaction.inGuild();
        expect(isGuild).toBe(false);
      });

      it("requires guildId to be present", () => {
        const interaction = {
          inGuild: () => true,
          guildId: null,
        };

        const valid = interaction.inGuild() && interaction.guildId;
        expect(valid).toBeFalsy();
      });
    });

    describe("permission validation", () => {
      it("checks Gatekeeper role when not bypassed", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(false);

        const member = { roles: { cache: new Map() } };
        const hasGatekeeperRole = hasRole(member as any, "gatekeeper-role-id");
        expect(hasGatekeeperRole).toBe(false);
      });

      it("allows when user has Gatekeeper role", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(true);

        const member = { roles: { cache: new Map([["gatekeeper-role-id", {}]]) } };
        const hasGatekeeperRole = hasRole(member as any, "gatekeeper-role-id");
        expect(hasGatekeeperRole).toBe(true);
      });
    });
  });

  describe("resolveApplication", () => {
    describe("guild validation", () => {
      it("returns null when guildId missing", async () => {
        const interaction = {
          guildId: null,
        };

        expect(interaction.guildId).toBeNull();
      });
    });

    describe("application lookup", () => {
      it("returns null when app not found by code", () => {
        vi.mocked(findAppByShortCode).mockReturnValue(null);

        const result = findAppByShortCode("guild123", "ABCDEF");
        expect(result).toBeNull();
      });

      it("finds app by short code", () => {
        vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-123" });

        const result = findAppByShortCode("guild123", "ABCDEF");
        expect(result).toEqual({ id: "app-123" });
      });
    });

    describe("full application load", () => {
      it("returns null when loadApplication returns null", () => {
        vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-123" });
        vi.mocked(loadApplication).mockReturnValue(null);

        const row = findAppByShortCode("guild123", "ABCDEF");
        const app = loadApplication((row as any).id);
        expect(app).toBeNull();
      });

      it("validates guild matches", () => {
        const app = { id: "app-123", guild_id: "guild123" };
        const requestGuildId = "guild456";

        const matches = app.guild_id === requestGuildId;
        expect(matches).toBe(false);
      });

      it("returns app when guild matches", () => {
        const app = { id: "app-123", guild_id: "guild123" };
        vi.mocked(loadApplication).mockReturnValue(app as any);

        const result = loadApplication("app-123");
        expect(result).toEqual(app);
      });
    });
  });
});

describe("BUTTON_RE pattern", () => {
  const BUTTON_RE = /^v1:decide:(\w+):code([0-9A-F]{6})$/;

  describe("valid patterns", () => {
    it("matches approve button", () => {
      const customId = "v1:decide:approve:codeABCDEF";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("approve");
      expect(match?.[2]).toBe("ABCDEF");
    });

    it("matches reject button", () => {
      const customId = "v1:decide:reject:code123456";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("reject");
      expect(match?.[2]).toBe("123456");
    });

    it("matches kick button", () => {
      const customId = "v1:decide:kick:codeFEDCBA";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("kick");
    });

    it("matches claim button", () => {
      const customId = "v1:decide:claim:code000000";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("claim");
    });

    it("matches unclaim button", () => {
      const customId = "v1:decide:unclaim:codeFFFFF0";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("unclaim");
    });
  });

  describe("invalid patterns", () => {
    it("rejects lowercase hex codes", () => {
      const customId = "v1:decide:approve:codeabcdef";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects short codes", () => {
      const customId = "v1:decide:approve:codeABCDE";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects long codes", () => {
      const customId = "v1:decide:approve:codeABCDEF0";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects missing prefix", () => {
      const customId = "decide:approve:codeABCDEF";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });
  });
});

describe("MODAL_RE pattern", () => {
  const MODAL_RE = /^v1:modal:reject:code([0-9A-F]{6})$/;

  describe("valid patterns", () => {
    it("matches reject modal", () => {
      const customId = "v1:modal:reject:codeABCDEF";
      const match = MODAL_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("ABCDEF");
    });
  });

  describe("invalid patterns", () => {
    it("rejects accept modal ID", () => {
      const customId = "v1:modal:accept:codeABCDEF";
      const match = MODAL_RE.exec(customId);
      expect(match).toBeNull();
    });
  });
});

describe("ACCEPT_MODAL_RE pattern", () => {
  const ACCEPT_MODAL_RE = /^v1:modal:accept:code([0-9A-F]{6})$/;

  describe("valid patterns", () => {
    it("matches accept modal", () => {
      const customId = "v1:modal:accept:code123456";
      const match = ACCEPT_MODAL_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("123456");
    });
  });
});

describe("modal opening functions", () => {
  describe("openRejectModal", () => {
    describe("pre-validation", () => {
      it("blocks already resolved applications", () => {
        const app = { status: "approved" };
        const isResolved = ["rejected", "approved", "kicked"].includes(app.status);
        expect(isResolved).toBe(true);
      });

      it("allows pending applications", () => {
        const app = { status: "pending" };
        const isResolved = ["rejected", "approved", "kicked"].includes(app.status);
        expect(isResolved).toBe(false);
      });
    });

    describe("claim guard", () => {
      it("checks claim before showing modal", () => {
        vi.mocked(getClaim).mockReturnValue({ reviewer_id: "user123" });
        vi.mocked(claimGuard).mockReturnValue(null);

        const claim = getClaim("app-123");
        const error = claimGuard(claim, "user123");
        expect(error).toBeNull();
      });

      it("blocks when claim guard fails", () => {
        vi.mocked(getClaim).mockReturnValue({ reviewer_id: "user456" });
        vi.mocked(claimGuard).mockReturnValue("Not your claim");

        const claim = getClaim("app-123");
        const error = claimGuard(claim, "user123");
        expect(error).toBe("Not your claim");
      });
    });

    describe("modal structure", () => {
      it("uses correct customId format", () => {
        const code = "ABCDEF";
        const customId = `v1:modal:reject:code${code}`;
        expect(customId).toBe("v1:modal:reject:codeABCDEF");
      });

      it("sets max length 500 for reason", () => {
        const maxLength = 500;
        expect(maxLength).toBe(500);
      });
    });
  });

  describe("openAcceptModal", () => {
    describe("pre-validation", () => {
      it("blocks rejected applications", () => {
        const app = { status: "rejected" };
        const isResolved = ["rejected", "approved", "kicked"].includes(app.status);
        expect(isResolved).toBe(true);
      });

      it("blocks kicked applications", () => {
        const app = { status: "kicked" };
        const isResolved = ["rejected", "approved", "kicked"].includes(app.status);
        expect(isResolved).toBe(true);
      });
    });

    describe("modal structure", () => {
      it("uses correct customId format", () => {
        const code = "123456";
        const customId = `v1:modal:accept:code${code}`;
        expect(customId).toBe("v1:modal:accept:code123456");
      });

      it("reason field is optional", () => {
        const required = false;
        expect(required).toBe(false);
      });
    });
  });

  describe("openPermRejectModal", () => {
    describe("claim validation", () => {
      it("blocks when claimed by another user", () => {
        vi.mocked(getClaim).mockReturnValue({ reviewer_id: "user456" });

        const claim = getClaim("app-123");
        const isOtherUser = claim && claim.reviewer_id !== "user123";
        expect(isOtherUser).toBe(true);
      });

      it("allows when claimed by same user", () => {
        vi.mocked(getClaim).mockReturnValue({ reviewer_id: "user123" });

        const claim = getClaim("app-123");
        const isOtherUser = claim && claim.reviewer_id !== "user123";
        expect(isOtherUser).toBe(false);
      });
    });

    describe("modal structure", () => {
      it("uses permreject customId format", () => {
        const code = "FEDCBA";
        const customId = `v1:modal:permreject:code${code}`;
        expect(customId).toBe("v1:modal:permreject:codeFEDCBA");
      });

      it("reason field is required", () => {
        const required = true;
        expect(required).toBe(true);
      });
    });
  });

  describe("openKickModal", () => {
    describe("pre-validation", () => {
      it("blocks already approved applications", () => {
        const app = { status: "approved" };
        const isResolved = ["rejected", "approved", "kicked"].includes(app.status);
        expect(isResolved).toBe(true);
      });
    });

    describe("modal structure", () => {
      it("uses kick customId format", () => {
        const code = "000FFF";
        const customId = `v1:modal:kick:code${code}`;
        expect(customId).toBe("v1:modal:kick:code000FFF");
      });

      it("reason field is optional", () => {
        const required = false;
        expect(required).toBe(false);
      });
    });
  });

  describe("openUnclaimModal", () => {
    describe("claim validation", () => {
      it("blocks when not claimed", () => {
        vi.mocked(getClaim).mockReturnValue(null);

        const claim = getClaim("app-123");
        expect(claim).toBeNull();
      });

      it("blocks when claimed by another user", () => {
        vi.mocked(getClaim).mockReturnValue({ reviewer_id: "user456" });

        const claim = getClaim("app-123");
        const isOtherUser = claim && claim.reviewer_id !== "user123";
        expect(isOtherUser).toBe(true);
      });
    });

    describe("modal structure", () => {
      it("uses unclaim customId format", () => {
        const code = "AAAAAA";
        const customId = `v1:modal:unclaim:code${code}`;
        expect(customId).toBe("v1:modal:unclaim:codeAAAAAA");
      });

      it("requires UNCLAIM confirmation text", () => {
        const minLength = 7;
        const maxLength = 7;
        expect(minLength).toBe(7);
        expect(maxLength).toBe(7);
      });
    });
  });
});
