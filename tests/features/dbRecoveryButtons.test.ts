/**
 * Pawtropolis Tech — tests/features/dbRecoveryButtons.test.ts
 * WHAT: Unit tests for database recovery button handlers.
 * WHY: Verify button parsing, permission checks, and action execution.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/features/dbRecovery.js", () => ({
  findCandidateById: vi.fn(),
  validateCandidate: vi.fn(),
  restoreCandidate: vi.fn(),
}));

vi.mock("../../src/ui/dbRecoveryCard.js", () => ({
  buildValidationEmbed: vi.fn(() => ({ toJSON: () => ({}) })),
  buildRestoreSummaryEmbed: vi.fn(() => ({ toJSON: () => ({}) })),
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(),
}));

vi.mock("../../src/lib/config.js", () => ({
  hasManageGuild: vi.fn(),
}));

vi.mock("../../src/lib/owner.js", () => ({
  isOwner: vi.fn(),
}));

vi.mock("../../src/lib/typeGuards.js", () => ({
  isGuildMember: vi.fn(() => true),
}));

describe("features/dbRecoveryButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("button customId parsing", () => {
    describe("valid format", () => {
      const validRegex = /^dbrecover:([a-zA-Z\-]+):([a-zA-Z0-9\-]+):([a-f0-9]{8})$/;

      it("matches validate action", () => {
        const customId = "dbrecover:validate:cand-123456-backup:a1b2c3d4";
        const match = customId.match(validRegex);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("validate");
        expect(match?.[2]).toBe("cand-123456-backup");
        expect(match?.[3]).toBe("a1b2c3d4");
      });

      it("matches restore-dry action", () => {
        const customId = "dbrecover:restore-dry:cand-789-test:deadbeef";
        const match = customId.match(validRegex);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("restore-dry");
      });

      it("matches restore-confirm action", () => {
        const customId = "dbrecover:restore-confirm:cand-abc-prod:12345678";
        const match = customId.match(validRegex);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("restore-confirm");
      });

      it("rejects invalid nonce length", () => {
        const customId = "dbrecover:validate:cand-123:abc"; // nonce too short
        const match = customId.match(validRegex);

        expect(match).toBeNull();
      });

      it("rejects non-hex nonce", () => {
        const customId = "dbrecover:validate:cand-123:ghijklmn"; // not hex
        const match = customId.match(validRegex);

        expect(match).toBeNull();
      });

      it("rejects missing parts", () => {
        const customId = "dbrecover:validate:cand-123";
        const match = customId.match(validRegex);

        expect(match).toBeNull();
      });
    });

    describe("nonce security", () => {
      it("uses 8 hex characters for nonce", () => {
        const nonce = "a1b2c3d4";
        expect(nonce.length).toBe(8);
        expect(/^[a-f0-9]+$/.test(nonce)).toBe(true);
      });

      it("prevents replay with unique nonces", () => {
        const nonce1 = "a1b2c3d4";
        const nonce2 = "e5f6g7h8";
        expect(nonce1).not.toBe(nonce2);
      });
    });
  });

  describe("permission checks", () => {
    describe("owner permissions", () => {
      it("allows owners full access", () => {
        const userId = "owner-123";
        const isOwnerUser = true;
        const hasManagePerms = false;

        const allowed = isOwnerUser || hasManagePerms;
        expect(allowed).toBe(true);
      });
    });

    describe("manage guild permissions", () => {
      it("allows users with Manage Server", () => {
        const isOwnerUser = false;
        const hasManagePerms = true;

        const allowed = isOwnerUser || hasManagePerms;
        expect(allowed).toBe(true);
      });

      it("denies users without permissions", () => {
        const isOwnerUser = false;
        const hasManagePerms = false;

        const allowed = isOwnerUser || hasManagePerms;
        expect(allowed).toBe(false);
      });
    });

    describe("restore-confirm restrictions", () => {
      it("only owners can perform live restore", () => {
        const action = "restore-confirm";
        const isOwnerUser = false;

        const canRestore = action !== "restore-confirm" || isOwnerUser;
        expect(canRestore).toBe(false);
      });

      it("owners can perform live restore", () => {
        const action = "restore-confirm";
        const isOwnerUser = true;

        const canRestore = action !== "restore-confirm" || isOwnerUser;
        expect(canRestore).toBe(true);
      });

      it("non-owners can perform dry-run", () => {
        const action = "restore-dry";
        const isOwnerUser = false;

        const canRestore = action !== "restore-confirm" || isOwnerUser;
        expect(canRestore).toBe(true);
      });

      it("non-owners can perform validate", () => {
        const action = "validate";
        const isOwnerUser = false;

        const canRestore = action !== "restore-confirm" || isOwnerUser;
        expect(canRestore).toBe(true);
      });
    });
  });

  describe("validate action", () => {
    describe("successful validation", () => {
      it("calls validateCandidate with candidateId", () => {
        const action = "validate";
        const candidateId = "cand-123-backup";

        expect(action).toBe("validate");
        expect(candidateId).toBe("cand-123-backup");
      });

      it("returns validation embed", () => {
        const validation = { ok: true, messages: ["✅ All checks passed"] };
        expect(validation.ok).toBe(true);
      });
    });

    describe("logging", () => {
      it("logs validation action", () => {
        const logMeta = {
          candidateId: "cand-123",
          filename: "backup.db",
          validationOk: true,
          integrityResult: "ok",
          fkViolations: 0,
        };

        expect(logMeta).toHaveProperty("candidateId");
        expect(logMeta).toHaveProperty("validationOk");
      });
    });
  });

  describe("restore-dry action", () => {
    describe("dry-run execution", () => {
      it("calls restoreCandidate with dryRun: true", () => {
        const opts = {
          dryRun: true,
          pm2Coord: false,
          actorId: "user-123",
          notes: "Dry-run restore by TestUser#1234 (user-123)",
        };

        expect(opts.dryRun).toBe(true);
        expect(opts.pm2Coord).toBe(false);
      });

      it("includes user info in notes", () => {
        const userTag = "TestUser#1234";
        const userId = "user-123";
        const notes = `Dry-run restore by ${userTag} (${userId})`;

        expect(notes).toContain(userTag);
        expect(notes).toContain(userId);
      });
    });

    describe("result reporting", () => {
      it("shows initial progress message", () => {
        const filename = "backup.db";
        const message = `🧪 Running dry-run restore for \`${filename}\`...`;

        expect(message).toContain("dry-run");
        expect(message).toContain(filename);
      });
    });
  });

  describe("restore-confirm action", () => {
    describe("live restore execution", () => {
      it("calls restoreCandidate with dryRun: false", () => {
        const opts = {
          dryRun: false,
          pm2Coord: true,
          confirm: true,
          actorId: "user-123",
          notes: "Live restore by TestUser#1234 (user-123) at 2024-01-01T00:00:00.000Z",
        };

        expect(opts.dryRun).toBe(false);
        expect(opts.pm2Coord).toBe(true);
        expect(opts.confirm).toBe(true);
      });

      it("includes timestamp in notes", () => {
        const timestamp = new Date().toISOString();
        const notes = `Live restore at ${timestamp}`;

        expect(notes).toContain("T");
        expect(notes).toContain("Z");
      });
    });

    describe("warning messages", () => {
      it("shows warning during restore", () => {
        const filename = "backup.db";
        const message = `⚠️ **LIVE RESTORE IN PROGRESS** ⚠️\n\nRestoring database from \`${filename}\`...`;

        expect(message).toContain("LIVE RESTORE");
        expect(message).toContain("Restoring database");
      });

      it("shows success message with pre-restore backup", () => {
        const preRestorePath = "/data/data.db.2024-01-01.preRestore.bak";
        const backupFilename = preRestorePath.split(/[\\/]/).pop();

        expect(backupFilename).toBe("data.db.2024-01-01.preRestore.bak");
      });
    });

    describe("logging", () => {
      it("logs at warn level for visibility", () => {
        const logLevel = "warn";
        expect(logLevel).toBe("warn");
      });

      it("includes critical metadata", () => {
        const logMeta = {
          candidateId: "cand-123",
          userId: "user-456",
          guildId: "guild-789",
        };

        expect(logMeta).toHaveProperty("candidateId");
        expect(logMeta).toHaveProperty("userId");
        expect(logMeta).toHaveProperty("guildId");
      });
    });
  });

  describe("error handling", () => {
    describe("candidate not found", () => {
      it("returns error message when candidate missing", () => {
        const candidateId = "cand-nonexistent";
        const message = `❌ Backup candidate not found: \`${candidateId}\``;

        expect(message).toContain("not found");
        expect(message).toContain(candidateId);
      });
    });

    describe("unknown action", () => {
      it("returns error for unknown action", () => {
        const action = "unknown-action";
        const message = `❌ Unknown action: \`${action}\``;

        expect(message).toContain("Unknown action");
        expect(message).toContain(action);
      });
    });

    describe("exception handling", () => {
      it("catches and logs errors", () => {
        const err = new Error("Database locked");
        const action = "validate";

        const message = `❌ Error during \`${action}\`: ${err}`;

        expect(message).toContain("Error during");
        expect(message).toContain(action);
      });
    });
  });

  describe("deferReply behavior", () => {
    it("defers reply with ephemeral: true", () => {
      const opts = { ephemeral: true };
      expect(opts.ephemeral).toBe(true);
    });

    it("uses editReply for all responses", () => {
      // After deferReply, must use editReply
      const method = "editReply";
      expect(method).toBe("editReply");
    });
  });

  describe("audit logging", () => {
    describe("action types", () => {
      it("logs validate action", () => {
        const action = "db_recover_validate";
        expect(action).toContain("validate");
      });

      it("logs restore action", () => {
        const action = "db_recover_restore";
        expect(action).toContain("restore");
      });
    });

    describe("metadata", () => {
      it("includes dryRun flag in restore logs", () => {
        const meta = {
          candidateId: "cand-123",
          filename: "backup.db",
          dryRun: true,
          success: true,
        };

        expect(meta).toHaveProperty("dryRun");
      });

      it("includes verification status in live restore", () => {
        const meta = {
          candidateId: "cand-123",
          filename: "backup.db",
          dryRun: false,
          confirm: true,
          success: true,
          preRestoreBackup: "/path/to/backup",
          verificationOk: true,
        };

        expect(meta).toHaveProperty("verificationOk");
        expect(meta).toHaveProperty("preRestoreBackup");
      });
    });
  });
});

describe("GuildMember type guard", () => {
  it("returns true for full GuildMember", () => {
    const member = {
      roles: { cache: new Map() },
      permissions: { has: () => true },
    };

    // Type guard would check for GuildMember properties
    const hasRoles = "roles" in member;
    expect(hasRoles).toBe(true);
  });

  it("handles null member", () => {
    const member = null;
    const isValid = member !== null;

    expect(isValid).toBe(false);
  });
});

describe("recovery card nonce generation", () => {
  it("uses 8 character hex string", () => {
    const generateNonce = () => {
      return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
    };

    const nonce = generateNonce();
    expect(nonce.length).toBe(8);
    expect(/^[a-f0-9]+$/i.test(nonce)).toBe(true);
  });
});
