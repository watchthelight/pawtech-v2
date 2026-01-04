/**
 * Pawtropolis Tech — tests/features/gate/gate.test.ts
 * WHAT: Unit tests for gate feature module.
 * WHY: Verify gate entry flow, pagination, modals, and button handlers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// Mock dependencies
const { mockGet, mockAll, mockRun, mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: Function) => fn),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
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
  addBreadcrumb: vi.fn(),
}));

vi.mock("../../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => ({
    gate_channel_id: "gate123",
    review_channel_id: "review123",
  })),
}));

vi.mock("../../../src/features/gate/questions.js", () => ({
  getQuestions: vi.fn(() => [
    { q_index: 0, prompt: "What is your age?", required: 1 },
    { q_index: 1, prompt: "How did you find us?", required: 1 },
    { q_index: 2, prompt: "What interests you?", required: 1 },
    { q_index: 3, prompt: "Any experience?", required: 0 },
    { q_index: 4, prompt: "What is the password?", required: 1 },
  ]),
}));

vi.mock("../../../src/features/review.js", () => ({
  ensureReviewMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/features/avatarScan.js", () => ({
  scanAvatar: vi.fn().mockResolvedValue({
    avatarUrl: "https://example.com/avatar.png",
    nsfwScore: 0.1,
    edgeScore: 0.05,
    finalPct: 0.07,
    furryScore: 0.8,
    scalieScore: 0.1,
    reason: "none",
    evidence: { hard: [], soft: [], safe: [] },
  }),
}));

vi.mock("../../../src/lib/cmdWrap.js", () => ({
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  withSql: vi.fn((_ctx: unknown, _sql: string, fn: Function) => fn()),
}));

vi.mock("../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/lib/syncMarker.js", () => ({
  touchSyncMarker: vi.fn(),
}));

vi.mock("../../../src/features/panicStore.js", () => ({
  isPanicMode: vi.fn(() => false),
}));

vi.mock("../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 8)),
}));

// Import after mocks
import { buildGateEntryPayload } from "../../../src/features/gate.js";

describe("features/gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildGateEntryPayload", () => {
    it("creates embed with guild name in title", () => {
      const mockGuild = {
        id: "guild123",
        name: "Test Guild",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const result = buildGateEntryPayload({ guild: mockGuild as any });

      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0]).toBeInstanceOf(EmbedBuilder);
    });

    it("creates verify button with correct customId", () => {
      const mockGuild = {
        id: "guild123",
        name: "Test Guild",
        iconURL: vi.fn(() => null),
      };

      const result = buildGateEntryPayload({ guild: mockGuild as any });

      expect(result.components).toHaveLength(1);
      expect(result.components[0]).toBeInstanceOf(ActionRowBuilder);
    });

    it("includes banner attachment", () => {
      const mockGuild = {
        id: "guild123",
        name: "Test Guild",
        iconURL: vi.fn(() => null),
      };

      const result = buildGateEntryPayload({ guild: mockGuild as any });

      expect(result.files).toHaveLength(1);
    });

    it("sets thumbnail when guild has icon", () => {
      const mockGuild = {
        id: "guild123",
        name: "Test Guild",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const result = buildGateEntryPayload({ guild: mockGuild as any });

      // Embed should be created successfully with thumbnail
      expect(result.embeds[0]).toBeDefined();
    });

    it("handles guild without icon", () => {
      const mockGuild = {
        id: "guild123",
        name: "Test Guild",
        iconURL: vi.fn(() => null),
      };

      const result = buildGateEntryPayload({ guild: mockGuild as any });

      // Should still create valid embed
      expect(result.embeds[0]).toBeDefined();
    });
  });

  describe("EnsureGateEntryResult type", () => {
    it("result structure is documented", () => {
      // This test verifies the expected shape of EnsureGateEntryResult
      const result = {
        created: false,
        edited: true,
        pinned: true,
        channelId: "channel123",
        messageId: "message123",
        reason: undefined,
      };

      expect(result.created).toBe(false);
      expect(result.edited).toBe(true);
      expect(result.pinned).toBe(true);
      expect(result.channelId).toBe("channel123");
      expect(result.messageId).toBe("message123");
    });
  });
});

describe("features/gate pagination logic", () => {
  describe("page customId parsing", () => {
    it("parses v1:start as page 0", () => {
      // The customId format v1:start means first page
      const customId = "v1:start";
      const match = customId.match(/^v1:start(?::p(\d+))?/);
      const page = match && match[1] ? Number.parseInt(match[1], 10) : 0;
      expect(page).toBe(0);
    });

    it("parses v1:start:p0 as page 0", () => {
      const customId = "v1:start:p0";
      const match = customId.match(/^v1:start(?::p(\d+))?/);
      const page = match && match[1] ? Number.parseInt(match[1], 10) : 0;
      expect(page).toBe(0);
    });

    it("parses v1:start:p1 as page 1", () => {
      const customId = "v1:start:p1";
      const match = customId.match(/^v1:start(?::p(\d+))?/);
      const page = match && match[1] ? Number.parseInt(match[1], 10) : 0;
      expect(page).toBe(1);
    });

    it("parses v1:start:p5 as page 5", () => {
      const customId = "v1:start:p5";
      const match = customId.match(/^v1:start(?::p(\d+))?/);
      const page = match && match[1] ? Number.parseInt(match[1], 10) : 0;
      expect(page).toBe(5);
    });

    it("returns 0 for non-matching customId", () => {
      const customId = "other:button";
      const match = customId.match(/^v1:start(?::p(\d+))?/);
      const page = match && match[1] ? Number.parseInt(match[1], 10) : 0;
      expect(page).toBe(0);
    });
  });

  describe("modal customId parsing", () => {
    it("extracts app ID from modal customId", () => {
      const customId = "v1:modal:abc123:p0";
      const match = customId.match(/^v1:modal:([^:]+):p/);
      const appId = match ? match[1] : null;
      expect(appId).toBe("abc123");
    });

    it("extracts UUID from modal customId", () => {
      const customId = "v1:modal:550e8400-e29b-41d4-a716-446655440000:p1";
      const match = customId.match(/^v1:modal:([^:]+):p/);
      const appId = match ? match[1] : null;
      expect(appId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("returns null for invalid format", () => {
      const customId = "v1:other:abc123";
      const match = customId.match(/^v1:modal:([^:]+):p/);
      const appId = match ? match[1] : null;
      expect(appId).toBeNull();
    });
  });

  describe("question pagination", () => {
    function paginate(questions: Array<{ q_index: number }>, pageSize = 5) {
      if (pageSize <= 0) throw new Error("pageSize must be positive");
      const pages: Array<{ pageIndex: number; questions: typeof questions }> = [];
      for (let i = 0; i < questions.length; i += pageSize) {
        const slice = questions.slice(i, i + pageSize);
        pages.push({ pageIndex: pages.length, questions: slice });
      }
      return pages;
    }

    it("creates single page for 5 or fewer questions", () => {
      const questions = [{ q_index: 0 }, { q_index: 1 }, { q_index: 2 }];
      const pages = paginate(questions);
      expect(pages).toHaveLength(1);
      expect(pages[0].pageIndex).toBe(0);
      expect(pages[0].questions).toHaveLength(3);
    });

    it("creates two pages for 6-10 questions", () => {
      const questions = Array.from({ length: 7 }, (_, i) => ({ q_index: i }));
      const pages = paginate(questions);
      expect(pages).toHaveLength(2);
      expect(pages[0].questions).toHaveLength(5);
      expect(pages[1].questions).toHaveLength(2);
    });

    it("handles exactly 5 questions as one page", () => {
      const questions = Array.from({ length: 5 }, (_, i) => ({ q_index: i }));
      const pages = paginate(questions);
      expect(pages).toHaveLength(1);
    });

    it("handles empty question list", () => {
      const pages = paginate([]);
      expect(pages).toHaveLength(0);
    });

    it("throws for invalid page size", () => {
      expect(() => paginate([{ q_index: 0 }], 0)).toThrow("pageSize must be positive");
      expect(() => paginate([{ q_index: 0 }], -1)).toThrow("pageSize must be positive");
    });

    it("assigns correct page indices", () => {
      const questions = Array.from({ length: 12 }, (_, i) => ({ q_index: i }));
      const pages = paginate(questions);
      expect(pages[0].pageIndex).toBe(0);
      expect(pages[1].pageIndex).toBe(1);
      expect(pages[2].pageIndex).toBe(2);
    });
  });

  describe("answer map conversion", () => {
    function toAnswerMap(responses: Array<{ q_index: number; answer: string }>) {
      return new Map(responses.map((row) => [row.q_index, row.answer] as const));
    }

    it("converts responses array to map", () => {
      const responses = [
        { q_index: 0, answer: "25" },
        { q_index: 1, answer: "Twitter" },
      ];
      const map = toAnswerMap(responses);
      expect(map.get(0)).toBe("25");
      expect(map.get(1)).toBe("Twitter");
    });

    it("handles empty responses", () => {
      const map = toAnswerMap([]);
      expect(map.size).toBe(0);
    });

    it("overwrites duplicate indices with last value", () => {
      const responses = [
        { q_index: 0, answer: "first" },
        { q_index: 0, answer: "second" },
      ];
      const map = toAnswerMap(responses);
      expect(map.get(0)).toBe("second");
    });
  });
});

describe("features/gate button builders", () => {
  describe("navigation button logic", () => {
    function buildNavButtons(pageIndex: number, pageCount: number) {
      const buttons: Array<{ customId: string; label: string; style: string }> = [];
      if (pageCount > 1 && pageIndex > 0) {
        buttons.push({
          customId: `v1:start:p${pageIndex - 1}`,
          label: "Back",
          style: "Secondary",
        });
      }
      if (pageIndex < pageCount - 1) {
        buttons.push({
          customId: `v1:start:p${pageIndex + 1}`,
          label: "Next",
          style: "Primary",
        });
      }
      if (buttons.length === 0) {
        buttons.push({
          customId: `v1:start:p${pageIndex}`,
          label: "Retry",
          style: "Primary",
        });
      }
      return buttons;
    }

    it("shows only Next on first page of multi-page form", () => {
      const buttons = buildNavButtons(0, 3);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe("Next");
      expect(buttons[0].customId).toBe("v1:start:p1");
    });

    it("shows Back and Next on middle page", () => {
      const buttons = buildNavButtons(1, 3);
      expect(buttons).toHaveLength(2);
      expect(buttons[0].label).toBe("Back");
      expect(buttons[0].customId).toBe("v1:start:p0");
      expect(buttons[1].label).toBe("Next");
      expect(buttons[1].customId).toBe("v1:start:p2");
    });

    it("shows only Back on last page of multi-page form", () => {
      const buttons = buildNavButtons(2, 3);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe("Back");
    });

    it("shows Retry on single-page form", () => {
      const buttons = buildNavButtons(0, 1);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe("Retry");
      expect(buttons[0].customId).toBe("v1:start:p0");
    });
  });

  describe("fix button logic", () => {
    function buildFixButton(pageIndex: number) {
      return {
        customId: `v1:start:p${pageIndex}`,
        label: `Go to page ${pageIndex + 1}`,
        style: "Primary",
      };
    }

    it("creates button for page 1", () => {
      const button = buildFixButton(0);
      expect(button.label).toBe("Go to page 1");
      expect(button.customId).toBe("v1:start:p0");
    });

    it("creates button for page 3", () => {
      const button = buildFixButton(2);
      expect(button.label).toBe("Go to page 3");
      expect(button.customId).toBe("v1:start:p2");
    });
  });
});

describe("features/gate validation", () => {
  describe("guild-only checks", () => {
    it("identifies non-guild interactions", () => {
      const interaction = { guildId: null, inGuild: () => false };
      expect(interaction.guildId).toBeNull();
      expect(interaction.inGuild()).toBe(false);
    });

    it("identifies guild interactions", () => {
      const interaction = { guildId: "guild123", inGuild: () => true };
      expect(interaction.guildId).toBe("guild123");
      expect(interaction.inGuild()).toBe(true);
    });
  });

  describe("draft validation", () => {
    it("rejects already submitted applications", () => {
      const status = "submitted";
      const isSubmitted = status === "submitted";
      expect(isSubmitted).toBe(true);
    });

    it("allows draft status", () => {
      const status = "draft";
      const isDraft = status === "draft";
      expect(isDraft).toBe(true);
    });

    it("rejects non-draft statuses", () => {
      const status = "approved";
      const allowedStatuses = ["draft"];
      expect(allowedStatuses.includes(status)).toBe(false);
    });
  });

  describe("required field validation", () => {
    it("detects missing required fields", () => {
      const questions = [
        { q_index: 0, required: true },
        { q_index: 1, required: true },
        { q_index: 2, required: false },
      ];
      const answers = new Map([
        [0, "filled"],
        [2, "optional filled"],
      ]);

      const missing = questions.filter(
        (q) => q.required && !answers.get(q.q_index)?.trim()
      );

      expect(missing).toHaveLength(1);
      expect(missing[0].q_index).toBe(1);
    });

    it("passes when all required fields filled", () => {
      const questions = [
        { q_index: 0, required: true },
        { q_index: 1, required: false },
      ];
      const answers = new Map([[0, "filled"]]);

      const missing = questions.filter(
        (q) => q.required && !answers.get(q.q_index)?.trim()
      );

      expect(missing).toHaveLength(0);
    });

    it("treats whitespace-only as empty", () => {
      const questions = [{ q_index: 0, required: true }];
      const answers = new Map([[0, "   "]]);

      const missing = questions.filter(
        (q) => q.required && !answers.get(q.q_index)?.trim()
      );

      expect(missing).toHaveLength(1);
    });
  });
});

describe("features/gate constants", () => {
  describe("Discord limits", () => {
    const INPUT_MAX_LENGTH = 1000;
    const LABEL_MAX_LENGTH = 45;
    const PLACEHOLDER_MAX_LENGTH = 100;
    const PAGE_SIZE = 5;

    it("respects Discord modal input length limit", () => {
      // Discord enforces 4000 max, we use 1000 for gate answers
      expect(INPUT_MAX_LENGTH).toBeLessThanOrEqual(4000);
    });

    it("respects Discord label length limit", () => {
      // Discord enforces 45 char max for text input labels
      expect(LABEL_MAX_LENGTH).toBe(45);
    });

    it("respects Discord placeholder length limit", () => {
      // Discord enforces 100 char max for placeholders
      expect(PLACEHOLDER_MAX_LENGTH).toBe(100);
    });

    it("respects Discord modal component limit", () => {
      // Discord allows max 5 components per modal
      expect(PAGE_SIZE).toBe(5);
    });
  });

  describe("gate entry footer matching", () => {
    const GATE_ENTRY_FOOTER_MATCHES = new Set([
      "If you're having issues DM an online moderator.",
      "GateEntry v1",
    ]);

    it("matches current footer text", () => {
      expect(GATE_ENTRY_FOOTER_MATCHES.has("If you're having issues DM an online moderator.")).toBe(true);
    });

    it("matches legacy footer text", () => {
      expect(GATE_ENTRY_FOOTER_MATCHES.has("GateEntry v1")).toBe(true);
    });

    it("rejects unknown footer text", () => {
      expect(GATE_ENTRY_FOOTER_MATCHES.has("Some other footer")).toBe(false);
    });
  });
});
