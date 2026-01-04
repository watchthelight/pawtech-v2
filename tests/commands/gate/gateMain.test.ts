/**
 * Pawtropolis Tech — tests/commands/gate/gateMain.test.ts
 * WHAT: Unit tests for /gate command.
 * WHY: Verify gate command routing and subcommand handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageFlags, PermissionFlagsBits } from "discord.js";

// Mock dependencies
vi.mock("../../../src/lib/config.js", () => ({
  requireStaff: vi.fn(() => true),
  upsertConfig: vi.fn(),
  getConfig: vi.fn(),
  hasManageGuild: vi.fn(),
  isReviewer: vi.fn(),
  canRunAllCommands: vi.fn(),
  hasGateAdmin: vi.fn(),
}));

vi.mock("../../../src/features/gate.js", () => ({
  ensureGateEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/features/review.js", () => ({
  renderWelcomeTemplate: vi.fn(() => "Welcome!"),
}));

vi.mock("../../../src/features/welcome.js", () => ({
  postWelcomeCard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/features/gate/questions.js", () => ({
  seedDefaultQuestionsIfEmpty: vi.fn(() => ({ inserted: 0, total: 5 })),
  getQuestions: vi.fn(() => []),
  upsertQuestion: vi.fn(),
}));

vi.mock("../../../src/lib/configCard.js", () => ({
  postGateConfigCard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/lib/cmdWrap.js", () => ({
  wrapCommand: vi.fn((name, fn) => fn),
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  withSql: vi.fn((ctx, sql, fn) => fn()),
}));

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => ({ count: 0 })),
      run: vi.fn(),
    })),
    transaction: vi.fn((fn) => fn),
  },
}));

vi.mock("../../../src/lib/secureCompare.js", () => ({
  secureCompare: vi.fn(),
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
    RESET_PASSWORD: "secret123",
  },
}));

vi.mock("../../../src/lib/typeGuards.js", () => ({
  isGuildMember: vi.fn(() => true),
}));

import { data, execute } from "../../../src/commands/gate/gateMain.js";
import { requireStaff, getConfig, hasGateAdmin } from "../../../src/lib/config.js";
import { replyOrEdit } from "../../../src/lib/cmdWrap.js";

const mockRequireStaff = requireStaff as ReturnType<typeof vi.fn>;
const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;
const mockHasGateAdmin = hasGateAdmin as ReturnType<typeof vi.fn>;
const mockReplyOrEdit = replyOrEdit as ReturnType<typeof vi.fn>;

function createMockContext(subcommand: string, subcommandGroup: string | null = null, overrides: Record<string, unknown> = {}) {
  return {
    interaction: {
      guildId: "guild123",
      guild: { id: "guild123", name: "Test Guild" },
      user: { id: "user456" },
      member: { id: "user456", displayName: "TestUser", user: { tag: "TestUser#1234", username: "testuser" } },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
      options: {
        getSubcommand: vi.fn(() => subcommand),
        getSubcommandGroup: vi.fn(() => subcommandGroup),
        getChannel: vi.fn(() => ({ id: "channel123" })),
        getRole: vi.fn(() => ({ id: "role123" })),
        getString: vi.fn(() => null),
      },
      ...overrides,
    },
    step: vi.fn(),
    requestId: "test-req",
  };
}

describe("commands/gate/gateMain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireStaff.mockReturnValue(true);
    mockGetConfig.mockReturnValue({
      review_channel_id: "review123",
      gate_channel_id: "gate123",
      general_channel_id: "general123",
      accepted_role_id: "role123",
    });
    mockHasGateAdmin.mockResolvedValue(true);
  });

  describe("data", () => {
    it("has correct command name", () => {
      expect(data.name).toBe("gate");
    });

    it("has options defined", () => {
      expect(data.options).toBeDefined();
      expect(data.options.length).toBeGreaterThan(0);
    });

    it("has setup option", () => {
      const json = data.toJSON();
      const setup = json.options?.find((o: any) => o.name === "setup");
      expect(setup).toBeDefined();
    });

    it("has reset option", () => {
      const json = data.toJSON();
      const reset = json.options?.find((o: any) => o.name === "reset");
      expect(reset).toBeDefined();
    });

    it("has status option", () => {
      const json = data.toJSON();
      const status = json.options?.find((o: any) => o.name === "status");
      expect(status).toBeDefined();
    });

    it("has config option", () => {
      const json = data.toJSON();
      const config = json.options?.find((o: any) => o.name === "config");
      expect(config).toBeDefined();
    });

    it("has set-questions option", () => {
      const json = data.toJSON();
      const setQuestions = json.options?.find((o: any) => o.name === "set-questions");
      expect(setQuestions).toBeDefined();
    });

    it("has welcome option group", () => {
      const json = data.toJSON();
      const welcome = json.options?.find((o: any) => o.name === "welcome");
      expect(welcome).toBeDefined();
    });

    it("sets default member permissions", () => {
      expect(data.default_member_permissions).toBe(PermissionFlagsBits.SendMessages.toString());
    });
  });

  describe("execute", () => {
    it("rejects non-guild commands", async () => {
      const ctx = createMockContext("setup");
      ctx.interaction.guildId = null;
      ctx.interaction.guild = null;

      await execute(ctx as any);

      expect(ctx.interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: MessageFlags.Ephemeral,
          content: "Guild only.",
        })
      );
    });

    it("checks staff permission", async () => {
      mockRequireStaff.mockReturnValue(false);
      const ctx = createMockContext("status");

      await execute(ctx as any);

      expect(mockRequireStaff).toHaveBeenCalled();
    });

    it("routes to status subcommand", async () => {
      const ctx = createMockContext("status");

      await execute(ctx as any);

      expect(ctx.step).toHaveBeenCalledWith("query_stats");
    });

    it("routes to config subcommand", async () => {
      const ctx = createMockContext("config");

      await execute(ctx as any);

      expect(ctx.step).toHaveBeenCalledWith("load_config");
    });

    it("handles no config found for config subcommand", async () => {
      mockGetConfig.mockReturnValue(null);
      const ctx = createMockContext("config");

      await execute(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("No configuration found") })
      );
    });

    it("routes to welcome set subcommand", async () => {
      const ctx = createMockContext("set", "welcome");
      ctx.interaction.options.getString = vi.fn(() => "Welcome {applicant.display}!");

      await execute(ctx as any);

      expect(ctx.step).toHaveBeenCalledWith("validate_template");
    });

    it("routes to welcome preview subcommand", async () => {
      const ctx = createMockContext("preview", "welcome");

      await execute(ctx as any);

      expect(ctx.step).toHaveBeenCalledWith("load_config");
    });

    it("routes to welcome channels subcommand", async () => {
      const ctx = createMockContext("channels", "welcome");

      await execute(ctx as any);

      // Should try to process channel options
      expect(ctx.interaction.options.getChannel).toHaveBeenCalled();
    });

    it("routes to welcome role subcommand", async () => {
      const ctx = createMockContext("role", "welcome");
      ctx.interaction.options.getRole = vi.fn(() => ({ id: "role123" }));

      await execute(ctx as any);

      expect(ctx.interaction.options.getRole).toHaveBeenCalledWith("role", true);
    });

    it("routes to set-questions subcommand", async () => {
      const ctx = createMockContext("set-questions");

      await execute(ctx as any);

      expect(ctx.step).toHaveBeenCalledWith("defer");
    });

    it("rejects set-questions without gate admin permission", async () => {
      mockHasGateAdmin.mockResolvedValue(false);
      const ctx = createMockContext("set-questions");

      await execute(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({
          content: expect.stringContaining("owner/admin privileges"),
        })
      );
    });
  });
});
